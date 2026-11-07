import {
  createAdminClient,
  getCorsHeaders,
  getSiteUrl,
  jsonResponse,
  requiredEnv,
  sha256Hex,
  wompiEnvironment,
} from '../_shared/payment-utils.ts';

function checkoutUrl(reference: string, amountCents: number, currency: string): Promise<string> {
  return sha256Hex(`${reference}${amountCents}${currency}${requiredEnv('WOMPI_INTEGRITY_SECRET')}`)
    .then((integritySignature) => {
      const url = new URL('https://checkout.wompi.co/p/');
      url.searchParams.set('public-key', requiredEnv('WOMPI_PUBLIC_KEY'));
      url.searchParams.set('currency', currency);
      url.searchParams.set('amount-in-cents', String(amountCents));
      url.searchParams.set('reference', reference);
      url.searchParams.set('signature:integrity', integritySignature);
      url.searchParams.set('redirect-url', getSiteUrl().toString());
      return url.toString();
    });
}

Deno.serve(async (request) => {
  let corsHeaders: Record<string, string>;
  try {
    const headers = getCorsHeaders(request.headers.get('origin'));
    if (!headers) return jsonResponse({ error: 'Origin not allowed.' }, 403);
    corsHeaders = headers;
  } catch (error) {
    console.error('Payment checkout configuration error', error);
    return jsonResponse({ error: 'Payment service is not configured.' }, 500);
  }

  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405, corsHeaders);

  try {
    const authorization = request.headers.get('authorization');
    const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!accessToken) return jsonResponse({ error: 'Authentication required.' }, 401, corsHeaders);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid request body.' }, 400, corsHeaders);
    }
    if (!body || typeof body !== 'object' || !('invoice_id' in body)) {
      return jsonResponse({ error: 'An invoice ID is required.' }, 400, corsHeaders);
    }

    const invoiceId = body.invoice_id;
    if (typeof invoiceId !== 'string' || !/^[\da-f]{8}-([\da-f]{4}-){3}[\da-f]{12}$/i.test(invoiceId)) {
      return jsonResponse({ error: 'Invalid invoice ID.' }, 400, corsHeaders);
    }

    const admin = createAdminClient();
    const { data: userResult, error: authError } = await admin.auth.getUser(accessToken);
    if (authError || !userResult.user) return jsonResponse({ error: 'Authentication required.' }, 401, corsHeaders);

    const { data: invoice, error: invoiceError } = await admin
      .from('invoices')
      .select('id, user_id, amount_cents, currency, status')
      .eq('id', invoiceId)
      .eq('user_id', userResult.user.id)
      .maybeSingle();

    if (invoiceError) throw invoiceError;
    if (!invoice) return jsonResponse({ error: 'Invoice not found.' }, 404, corsHeaders);
    if (invoice.status !== 'open') return jsonResponse({ error: 'Invoice is not payable.' }, 409, corsHeaders);

    const amountCents = Number(invoice.amount_cents);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || invoice.currency !== 'COP') {
      throw new Error('Invoice amount or currency is invalid.');
    }
    wompiEnvironment();

    const { data: pendingPayment, error: pendingError } = await admin
      .from('invoice_payments')
      .select('reference, amount_cents, currency')
      .eq('invoice_id', invoice.id)
      .eq('status', 'pending')
      .maybeSingle();

    if (pendingError) throw pendingError;
    if (pendingPayment) {
      if (Number(pendingPayment.amount_cents) !== amountCents || pendingPayment.currency !== invoice.currency) {
        return jsonResponse({ error: 'A pending payment exists for a different invoice amount.' }, 409, corsHeaders);
      }
      return jsonResponse({
        checkout_url: await checkoutUrl(pendingPayment.reference, amountCents, invoice.currency),
      }, 200, corsHeaders);
    }

    const reference = `RMM-${crypto.randomUUID()}`;
    const { error: insertError } = await admin.from('invoice_payments').insert({
      invoice_id: invoice.id,
      reference,
      amount_cents: amountCents,
      currency: invoice.currency,
    });

    if (insertError?.code === '23505') {
      const { data: concurrentPayment, error: concurrentError } = await admin
        .from('invoice_payments')
        .select('reference, amount_cents, currency')
        .eq('invoice_id', invoice.id)
        .eq('status', 'pending')
        .maybeSingle();

      if (concurrentError) throw concurrentError;
      if (concurrentPayment && Number(concurrentPayment.amount_cents) === amountCents && concurrentPayment.currency === invoice.currency) {
        return jsonResponse({
          checkout_url: await checkoutUrl(concurrentPayment.reference, amountCents, invoice.currency),
        }, 200, corsHeaders);
      }
    }
    if (insertError) throw insertError;

    return jsonResponse({ checkout_url: await checkoutUrl(reference, amountCents, invoice.currency) }, 200, corsHeaders);
  } catch (error) {
    console.error('Failed to create Wompi checkout', error);
    return jsonResponse({ error: 'Unable to prepare payment. Please try again later.' }, 500, corsHeaders);
  }
});
