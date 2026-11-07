create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete restrict,
  invoice_number text not null unique check (length(invoice_number) between 1 and 80),
  description text not null check (length(description) between 1 and 500),
  amount_cents bigint not null check (amount_cents between 1 and 9007199254740991),
  currency text not null default 'COP' check (currency = 'COP'),
  status text not null default 'open' check (status in ('open', 'paid', 'void')),
  due_date date,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create index invoices_user_created_at_idx
  on public.invoices (user_id, created_at desc);

create table public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  reference text not null unique,
  wompi_transaction_id text unique,
  amount_cents bigint not null check (amount_cents between 1 and 9007199254740991),
  currency text not null default 'COP' check (currency = 'COP'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index invoice_payments_invoice_created_at_idx
  on public.invoice_payments (invoice_id, created_at desc);

create unique index invoice_payments_one_pending_per_invoice_idx
  on public.invoice_payments (invoice_id)
  where status = 'pending';

alter table public.invoices enable row level security;
alter table public.invoice_payments enable row level security;

revoke all on table public.invoices, public.invoice_payments from anon, authenticated;
grant select on table public.invoices, public.invoice_payments to authenticated;
grant all on table public.invoices, public.invoice_payments to service_role;

create policy "Customers can read their invoices"
  on public.invoices
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Customers can read their invoice payments"
  on public.invoice_payments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.invoices
      where invoices.id = invoice_payments.invoice_id
        and invoices.user_id = (select auth.uid())
    )
  );
