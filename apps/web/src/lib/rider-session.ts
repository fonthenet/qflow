import 'server-only';
import crypto from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Long-lived rider sessions. The bearer token is 32 bytes of CSPRNG
 * data, base64url-encoded. We store sha256(token) — never the
 * plaintext — so a leak of `rider_sessions` doesn't grant access.
 *
 * Verify performs:
 *   1. sha256 the bearer token
 *   2. SELECT rider_sessions WHERE token_hash = ? AND revoked_at IS NULL
 *   3. confirm rider is_active
 *   4. bump last_seen_at (sliding window for future idle timeout)
 *
 * Revocation = set revoked_at. The row stays for audit. The partial
 * index on (token_hash WHERE revoked_at IS NULL) keeps the lookup O(1)
 * even after thousands of revoked sessions accumulate.
 */

const TOKEN_BYTES = 32;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export interface RiderSession {
  sessionId: string;
  riderId: string;
  organizationId: string;
  riderName: string;
  riderPhone: string;
}

export async function mintRiderSession(riderId: string, deviceLabel?: string | null): Promise<{ token: string; sessionId: string } | null> {
  const supabase = createAdminClient() as any;
  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  const tokenHash = hashToken(token);
  const { data, error } = await supabase
    .from('rider_sessions')
    .insert({
      rider_id: riderId,
      token_hash: tokenHash,
      device_label: deviceLabel?.slice(0, 80) ?? null,
    })
    .select('id')
    .single();
  if (error || !data) {
    console.warn('[rider-session] mint failed', error?.message);
    return null;
  }
  return { token, sessionId: data.id };
}

/**
 * Read a Bearer token off the request, verify, and return the
 * associated rider. Returns null on any failure (no token, revoked,
 * inactive rider, expired). Never throws — auth shouldn't 500.
 */
export async function verifyRiderSession(authHeader: string | null | undefined): Promise<RiderSession | null> {
  if (!authHeader) return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const token = m[1].trim();
  if (!token) return null;
  const tokenHash = hashToken(token);

  const supabase = createAdminClient() as any;
  const { data: session } = await supabase
    .from('rider_sessions')
    .select('id, rider_id, riders(id, organization_id, name, phone, is_active)')
    .eq('token_hash', tokenHash)
    .is('revoked_at', null)
    .maybeSingle();
  if (!session?.riders || !session.riders.is_active) return null;

  // Best-effort sliding update — fire-and-forget, never block auth.
  void supabase
    .from('rider_sessions')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', session.id)
    .then(() => {}, () => {});

  return {
    sessionId: session.id,
    riderId: session.riders.id,
    organizationId: session.riders.organization_id,
    riderName: session.riders.name,
    riderPhone: session.riders.phone,
  };
}

export async function revokeRiderSession(sessionId: string): Promise<void> {
  const supabase = createAdminClient() as any;
  await supabase
    .from('rider_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', sessionId);
}

export async function revokeAllRiderSessions(riderId: string): Promise<void> {
  const supabase = createAdminClient() as any;
  await supabase
    .from('rider_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('rider_id', riderId)
    .is('revoked_at', null);
}
