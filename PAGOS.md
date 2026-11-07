# Configuración del centro de pagos

El portal usa Supabase para el acceso y las facturas, y Wompi Web Checkout para cobrar. La página no guarda información de tarjetas. El estado de una factura solo cambia después de validar la firma del webhook de Wompi.

El centro de pagos no puede cobrar hasta que se configuren las cuentas de Supabase y Wompi. Los medios disponibles dependen de los habilitados en la cuenta de comercio de Wompi.

El portal está en `pagos.html`: requiere inicio de sesión para mostrar las facturas, permite seleccionar una factura pendiente y presenta su total antes de abrir el checkout. Cada pago corresponde a una factura.

## Preparar el sitio

1. Instala Node.js y ejecuta `npm install`.
2. Copia `.env.example` a `.env.local` y configura `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` con los datos públicos del proyecto Supabase.
3. Ejecuta `npm run dev` para probar el sitio y `npm run build` para generar las páginas en `dist/`, incluida `dist/pagos.html`.
4. Después de cambiar `.env.local`, vuelve a generar y desplegar el sitio. El valor publishable/anon de Supabase puede estar en el navegador; nunca pongas una llave `service_role`, `sb_secret`, ni secretos de Wompi en variables `VITE_`.

## Preparar Supabase

1. Crea un proyecto Supabase y ejecuta [`supabase/migrations/20261105000100_payment_portal.sql`](./supabase/migrations/20261105000100_payment_portal.sql) en el SQL Editor del proyecto.
2. Instala la [Supabase CLI](https://supabase.com/docs/guides/cli) y vincula el proyecto con `supabase link --project-ref <PROJECT_REF>`.
3. Despliega las funciones:

   ```text
   supabase functions deploy create-wompi-checkout
   supabase functions deploy wompi-webhook
   ```

4. En **Edge Functions → Secrets**, configura:
   - `SITE_URL`: URL HTTPS completa de `pagos.html`, sin parámetros ni fragmento.
   - `WOMPI_PUBLIC_KEY`: llave pública del entorno de pruebas (`pub_test_...`) o producción (`pub_prod_...`).
   - `WOMPI_PRIVATE_KEY`: llave privada del mismo entorno; el webhook la usa para verificar la transacción directamente con Wompi.
   - `WOMPI_INTEGRITY_SECRET`: secreto de integridad del mismo entorno.
   - `WOMPI_EVENTS_SECRET`: secreto de eventos del mismo entorno.

   Supabase entrega a las funciones la llave de servidor en `SUPABASE_SECRET_KEYS`. No la copies al sitio web ni la publiques.

5. En la consola de Wompi, registra como URL de eventos:

   ```text
   https://<PROJECT_REF>.supabase.co/functions/v1/wompi-webhook
   ```

   Habilita `transaction.updated`. Usa secretos y llaves del mismo entorno (pruebas o producción) en Wompi y Supabase.

## Cuentas y facturas

- Crea o invita cada cliente desde **Supabase → Authentication**. No hay registro público.
- Añade facturas desde una sesión administrativa/SQL Editor; el UUID debe corresponder al usuario de autenticación. Por ejemplo:

  ```sql
  insert into public.invoices (user_id, invoice_number, description, amount_cents, due_date)
  values ('<AUTH_USER_UUID>', 'RMM-2026-001', 'Servicio RMM', 11900000, '2026-11-30');
  ```

  `amount_cents` debe expresarse en centavos, como espera Wompi. Los clientes solo tienen permiso para leer sus propias facturas y pagos; no pueden cambiar montos ni marcar facturas como pagadas.
- Envía al cliente el acceso a su cuenta. Si debe crear o cambiar su contraseña, podrá usar **Olvidé mi contraseña**; configura la plantilla y el proveedor de correo de Supabase, y permite la URL del sitio en los redirect URLs de Auth.
- Prueba primero con llaves y eventos de sandbox, incluyendo pagos aprobados, rechazados y pendientes. Solo cambia a producción después de verificar el webhook. No uses la URL de retorno como prueba de pago: la confirmación válida llega del webhook firmado.
