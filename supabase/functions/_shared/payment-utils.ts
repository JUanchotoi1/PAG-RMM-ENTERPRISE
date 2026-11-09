import { createClient } from 'npm:@supabase/supabase-js@2.119.0';

export function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function wompiEnvironment(): 'test' | 'prod' {
  const publicKey = requiredEnv('WOMPI_PUBLIC_KEY');
  if (publicKey.startsWith('pub_test_')) return 'test';
  if (publicKey.startsWith('pub_prod_')) return 'prod';
  throw new Error('WOMPI_PUBLIC_KEY must be a Wompi test or production public key.');
}

export function createAdminClient() {
  const rawKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  let secretKey: string | undefined;

  if (rawKeys) {
    const keys: unknown = JSON.parse(rawKeys);
    if (keys && typeof keys === 'object' && 'default' in keys && typeof keys.default === 'string') {
      secretKey = keys.default;
    }
  }

  secretKey ??= Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secretKey) throw new Error('Supabase server secret is not configured.');

  return createClient(requiredEnv('SUPABASE_URL'), secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function getSiteUrl(): URL {
  const siteUrl = new URL(requiredEnv('SITE_URL'));
  if (siteUrl.protocol !== 'https:' && siteUrl.hostname !== 'localhost' && siteUrl.hostname !== '127.0.0.1') {
    throw new Error('SITE_URL must use HTTPS outside local development.');
  }
  if (siteUrl.username || siteUrl.password || siteUrl.search || siteUrl.hash) {
    throw new Error('SITE_URL must not contain credentials, query parameters, or a fragment.');
  }
  return siteUrl;
}

export function getCorsHeaders(origin: string | null): Record<string, string> | null {
  const allowedOrigin = getSiteUrl().origin;
  if (origin && origin !== allowedOrigin) return null;

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

export function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function constantTimeHexEqual(left: string, right: string): boolean {
  if (!/^[\da-f]{64}$/i.test(left) || !/^[\da-f]{64}$/i.test(right)) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.toLowerCase().charCodeAt(index) ^ right.toLowerCase().charCodeAt(index);
  }
  return difference === 0;
}
