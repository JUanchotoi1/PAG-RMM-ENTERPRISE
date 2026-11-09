import { constantTimeHexEqual, sha256Hex } from './payment-utils.ts';

Deno.test('Wompi checkout integrity matches the documented sample', async () => {
  const signature = await sha256Hex(
    'sk8-438k4-xmxm392-sn2m2490000COPprod_integrity_Z5mMke9x0k8gpErbDqwrJXMqsI6SFli6',
  );
  if (signature !== '37c8407747e595535433ef8f6a811d853cd943046624a0ec04662b17bbf33bf5') {
    throw new Error('Checkout integrity signature did not match the Wompi sample.');
  }
});

Deno.test('SHA-256 helper matches the standard test vector', async () => {
  const digest = await sha256Hex('abc');
  if (digest !== 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad') {
    throw new Error('SHA-256 digest did not match the standard test vector.');
  }
});

Deno.test('constant-time checksum comparison rejects malformed values', () => {
  if (!constantTimeHexEqual('a'.repeat(64), 'A'.repeat(64))) {
    throw new Error('Equal checksums should compare successfully.');
  }
  if (constantTimeHexEqual('not-a-checksum', 'A'.repeat(64))) {
    throw new Error('Malformed checksums must be rejected.');
  }
});
