import {
  constantTimeHexEqual,
  createAdminClient,
  jsonResponse,
  requiredEnv,
  sha256Hex,
  wompiEnvironment,
} from '../_shared/payment-utils.ts';

function getDataProperty(data: unknown, path: string): unknown {
  let value = data;
  for (const segment of path.split('.')) {
    if (!value || typeof value !== 'object' || !(segment in value)) return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

async function verifyEvent(event: Record<string, unknown>, request: Request): Promise<boolean> {
  const signature = event.signature;
  if (!signature || typeof signature !== 'object') return false;

  const signatureData = signature as Record<string, unknown>;
  const properties = signatureData.properties;
  const timestamp = event.timestamp;
  const bodyChecksum = signatureData.checksum;
  const headerChecksum = request.headers.get('x-event-checksum');

  if (!Array.isArray(properties) || properties.length === 0 || !Number.isSafeInteger(timestamp)) return false;
  if (!properties.includes('transaction.id')) return false;
  if (typeof bodyChecksum !== 'string' && !headerChecksum) return false;
  if (bodyChecksum !== undefined && typeof bodyChecksum !== 'string') return false;
  if (headerChecksum && bodyChecksum && headerChecksum.toLowerCase() !== bodyChecksum.toLowerCase()) return false;

  let signedValues = '';
  for (const property of properties) {
    if (typeof property !== 'string' || !property) return false;
    const value = getDataProperty(event.data, property);
    if (typeof value !== 'string' && typeof value !== 'number') return false;
    signedValues += String(value);
  }

  const expected = await sha256Hex(`${signedValues}${timestamp}${requiredEnv('WOMPI_EVENTS_SECRET')}`);
  const checksums = [bodyChecksum, headerChecksum].filter((value): value is string => typeof value === 'string');
  return checksums.every((checksum) => constantTimeHexEqual(expected, checksum));
}

async function fetchVerifiedTransaction(transactionId: string): Promise<Record<string, unknown>> {
  if (!/^[\da-z-]{1,128}$/i.test(transactionId)) throw new Error('Invalid Wompi transaction ID.');

  const environment = wompiEnvironment();
  const privateKey = requiredEnv('WOMPI_PRIVATE_KEY');
  const expectedPrivateKeyPrefix = environment === 'test' ? 'prv_test_' : 'prv_prod_';
  if (!privateKey.startsWith(expectedPrivateKeyPrefix)) {
    throw new Error('Wompi public and private keys must belong to the same environment.');
  }

  const apiHost = environment === 'test' ? 'https://sandbox.wompi.co' : 'https://production.wompi.co';
  const response = await fetch(`${apiHost}/v1/transactions/${encodeURIComponent(transactionId)}`, {
    headers: { Authorization: `Bearer ${privateKey}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Wompi transaction verification failed with status ${response.status}.`);

  const result: unknown = await response.json();
  if (!result || typeof result !== 'object' || !('data' in result)) {
    throw new Error('Wompi transaction verification returned an invalid response.');
  }
  const transaction = result.data;
  if (!transaction || typeof transaction !== 'object') {
    throw new Error('Wompi transaction verification returned no transaction.');
  }
  return transaction as Record<string, unknown>;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405);

  try {
    const rawBody = await request.text();
    if (rawBody.length > 1_000_000) return jsonResponse({ error: 'Request body is too large.' }, 413);

    let event: unknown;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return jsonResponse({ error: 'Invalid event body.' }, 400);
    }
    if (!event || typeof event !== 'object') return jsonResponse({ error: 'Invalid event body.' }, 400);

    const wompiEvent = event as Record<string, unknown>;
    if (!await verifyEvent(wompiEvent, request)) {
      return jsonResponse({ error: 'Invalid event signature.' }, 401);
    }
    if (wompiEvent.event !== 'transaction.updated') return jsonResponse({ received: true, ignored: true }, 200);

    const expectedEnvironment = wompiEnvironment();
    if (wompiEvent.environment !== expectedEnvironment) {
      return jsonResponse({ error: 'Event environment does not match the configured payment account.' }, 400);
    }

    const data = wompiEvent.data;
    const transactionId = getDataProperty(data, 'transaction.id');
    if (
      typeof transactionId !== 'string' ||
      !transactionId
    ) {
      return jsonResponse({ error: 'Transaction details are invalid.' }, 400);
    }

    const transaction = await fetchVerifiedTransaction(transactionId);
    if (transaction.id !== transactionId) {
      return jsonResponse({ error: 'Verified transaction ID does not match the event.' }, 400);
    }

    const reference = transaction.reference;
    const amountCents = Number(transaction.amount_in_cents);
    const currency = transaction.currency;
    const wompiStatus = transaction.status;
    if (
      typeof reference !== 'string' ||
      !Number.isSafeInteger(amountCents) ||
      typeof currency !== 'string' ||
      typeof wompiStatus !== 'string'
    ) {
      return jsonResponse({ error: 'Verified transaction details are invalid.' }, 400);
    }

    const statusByWompi: Record<string, 'pending' | 'approved' | 'rejected'> = {
      PENDING: 'pending',
      APPROVED: 'approved',
      DECLINED: 'rejected',
      VOIDED: 'rejected',
      ERROR: 'rejected',
    };
    const paymentStatus = statusByWompi[wompiStatus];
    if (!paymentStatus) return jsonResponse({ received: true, ignored: true }, 200);

    const admin = createAdminClient();
    const { data: payment, error: paymentError } = await admin
      .from('invoice_payments')
      .select('id, invoice_id, amount_cents, currency, status, wompi_transaction_id')
      .eq('reference', reference)
      .maybeSingle();

    if (paymentError) throw paymentError;
    if (!payment) {
      console.warn('Received a valid Wompi event for an unknown payment reference.');
      return jsonResponse({ received: true, ignored: true }, 200);
    }
    if (Number(payment.amount_cents) !== amountCents || payment.currency !== currency) {
      console.error('Wompi transaction amount or currency does not match the payment record.');
      return jsonResponse({ error: 'Transaction does not match the payment record.' }, 400);
    }
    if (payment.status === 'approved' && paymentStatus !== 'approved') {
      return jsonResponse({ received: true }, 200);
    }

    const updatedAt = new Date().toISOString();
    const { error: updatePaymentError } = await admin
      .from('invoice_payments')
      .update({
        status: paymentStatus,
        wompi_transaction_id: transactionId,
        updated_at: updatedAt,
      })
      .eq('id', payment.id)
      .neq('status', 'approved');

    if (updatePaymentError) throw updatePaymentError;

    if (paymentStatus === 'approved') {
      const { error: updateInvoiceError } = await admin
        .from('invoices')
        .update({ status: 'paid', paid_at: updatedAt })
        .eq('id', payment.invoice_id);
      if (updateInvoiceError) throw updateInvoiceError;
    }

    return jsonResponse({ received: true }, 200);
  } catch (error) {
    console.error('Failed to process Wompi webhook', error);
    return jsonResponse({ error: 'Unable to process payment event.' }, 500);
  }
});
