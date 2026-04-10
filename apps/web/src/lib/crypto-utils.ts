import { timingSafeEqual } from 'crypto';

/**
 * Timing-safe string comparison to prevent timing attacks on token validation.
 */
export function safeCompare(a: string, b: string): boolean {
  if (!a || !b) return false;
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Authenticate a request using Bearer token against service key or webhook secret.
 * Returns true if the token matches any configured secret.
 */
export function authenticateServiceRequest(authHeader: string | null): boolean {
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!bearerToken) return false;

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const webhookSecret = process.env.INTERNAL_WEBHOOK_SECRET ?? '';

  if (serviceKey && safeCompare(bearerToken, serviceKey)) return true;
  if (webhookSecret && safeCompare(bearerToken, webhookSecret)) return true;

  return false;
}
