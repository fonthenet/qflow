import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabase: SupabaseClient | null = null;

export async function getSupabase(): Promise<SupabaseClient> {
  if (supabase) return supabase;
  const config = await window.qf.getConfig();
  // CRITICAL: autoRefreshToken MUST be false. The main process is the
  // sole authority for refreshing — it owns the DB-persisted refresh
  // token and pushes fresh access tokens to the renderer via
  // listenForTokenRefresh. If the renderer also auto-refreshes, both
  // sides race on the same refresh_token (Supabase rotates on every
  // refresh), one wins, the other gets "already used" → session dies →
  // QF-AUTH-001 popup fires repeatedly. This was the cause of the
  // 2026-04-21 regression where Call/Seat buttons did nothing.
  supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return supabase;
}

/** Restore auth session on the shared client so RLS policies work */
export async function restoreSession(accessToken: string, refreshToken: string): Promise<void> {
  const sb = await getSupabase();
  await sb.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
}

/**
 * Refresh-skew window. Tokens within this many ms of expiry are
 * treated as stale so callers don't hit a 401 mid-flight. Bumped
 * from 60s → 5min so we proactively refresh well before any
 * long-running query (Station Settings load, Business Admin
 * reload, kiosk session bootstrap) collides with expiry.
 */
const TOKEN_REFRESH_SKEW_MS = 5 * 60_000;

/**
 * Ensure the Supabase client has a valid auth session (for RLS).
 *
 * Strategy:
 * 1. First check if the Supabase client already has a valid session.
 *    This allows auto-refresh to work when restoreSession() was called
 *    with both access_token + refresh_token (critical for HTTP bridge / kiosk).
 * 2. If no valid session, ask the main process for a fresh token via IPC
 *    (Electron) or the auth-token HTTP endpoint (kiosk bridge).
 *    CRITICAL: always request AND apply refresh_token so the renderer can
 *    auto-refresh on its own without depending on IPC pushes.
 *
 * @param force  When true, skip the cache check and always pull a fresh
 *   token from the main process. Used by withAuthRetry() after a 401.
 */
export async function ensureAuth(force = false): Promise<string> {
  const sb = await getSupabase();

  // 1. Use the current session if it is still fresh. With autoRefresh
  // disabled we MUST refuse expired tokens here, otherwise every query
  // 401s silently. Treat anything within TOKEN_REFRESH_SKEW_MS of
  // expiry as stale so we proactively refresh well before any
  // long-running operation finishes.
  if (!force) {
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (session?.access_token) {
        const expiresAt = session.expires_at ? session.expires_at * 1000 : 0;
        const freshForMs = expiresAt - Date.now();
        if (freshForMs > TOKEN_REFRESH_SKEW_MS) {
          return session.access_token;
        }
        console.warn('[supabase] cached token expires in', freshForMs, 'ms — fetching fresh from main');
      }
    } catch {}
  }

  // 2. No valid session — ask main process for a fresh token
  // Retry once after a short delay — main process may still be refreshing on cold start
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await window.qf.auth.getToken();
      if (result?.ok && result.token) {
        // CRITICAL: use refresh_token from main process so renderer can auto-refresh
        // The main process always reads the latest refresh_token from SQLite
        await sb.auth.setSession({
          access_token: result.token,
          refresh_token: result.refresh_token || '',
        });
        return result.token;
      }
    } catch (err) {
      console.warn('[supabase] IPC auth:get-token failed', err);
    }
    // First attempt failed — wait 2s for main process token refresh to complete
    if (attempt === 0) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.error('[supabase] Auth failed (QF-AUTH-001) — queries will return empty results');
  return '';
}

/**
 * Wrap a Supabase call so an auth-shaped failure forces a fresh
 * token fetch from main process and retries the call once.
 *
 * Handles both shapes:
 *   - Thrown exceptions whose message matches AUTH_FAILURE_RE
 *   - PostgrestResponse-like results where `.error` is set and matches
 *
 * Usage:
 *   const { data, error } = await withAuthRetry(() =>
 *     sb.from('offices').select('id').eq('organization_id', orgId)
 *   );
 *
 * Why a wrapper rather than monkey-patching the supabase fetch: keeps
 * the retry surface explicit. Callers that don't need it (one-shot
 * checks, fire-and-forget telemetry) opt out by skipping the wrap.
 */
const AUTH_FAILURE_RE = /jwt|auth|expired|unauth|forbidden|invalid token|401/i;

/**
 * The generic `T` is inferred from whatever the supabase builder
 * resolves to (a `PostgrestSingleResponse<…>` shape with `data` /
 * `error`). We don't constrain it on the input side because the
 * builder isn't strictly a `Promise` — it's a thenable. Awaiting
 * the call yields the resolved shape, and we reach into `.error`
 * with an `as any` cast for the auth-shape check.
 */
export async function withAuthRetry<T>(fn: () => PromiseLike<T>): Promise<T> {
  await ensureAuth();
  try {
    const r = await fn();
    const errMsg = (r as any)?.error?.message;
    if (typeof errMsg === 'string' && AUTH_FAILURE_RE.test(errMsg)) {
      console.warn('[supabase] auth error in response — forcing token refresh', errMsg);
      await ensureAuth(true);
      return await fn();
    }
    return r;
  } catch (e: any) {
    const msg = String(e?.message ?? '');
    if (AUTH_FAILURE_RE.test(msg)) {
      console.warn('[supabase] auth error thrown — forcing token refresh', msg);
      await ensureAuth(true);
      return await fn();
    }
    throw e;
  }
}

/**
 * SAFETY NET: Verify the Supabase session can actually read data.
 * Call after ensureAuth() — if this returns false, auth is silently broken
 * (the exact bug class that caused the kiosk data loss regression).
 *
 * Usage: const ok = await verifyAuthWorks(); if (!ok) show warning
 */
export async function verifyAuthWorks(): Promise<boolean> {
  try {
    const sb = await getSupabase();
    const { data: { session } } = await sb.auth.getSession();
    if (!session?.access_token) return false;
    // Quick RLS smoke test: count offices the user can see (should be ≥ 1 if logged in)
    const { count, error } = await sb.from('offices').select('id', { count: 'exact', head: true });
    if (error || count === null || count === 0) {
      console.error('[supabase] Auth verification FAILED — session exists but RLS blocks queries. Token may be expired.', { error: error?.message, count });
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Listen for token refresh events from main process and update
 * the renderer's Supabase client immediately. Call once on app init.
 *
 * CRITICAL: always apply refresh_token so the renderer's Supabase client
 * can auto-refresh JWTs on its own. Previously this set refresh_token: ''
 * which destroyed auto-refresh — the root cause of data disappearance
 * after ~1 hour of inactivity.
 */
export function listenForTokenRefresh(): () => void {
  return window.qf.auth.onTokenRefreshed(async (token: string, refreshToken?: string) => {
    try {
      const sb = await getSupabase();
      // Use provided refresh_token; if not available, preserve existing one
      let rt = refreshToken || '';
      if (!rt) {
        try {
          const { data: { session } } = await sb.auth.getSession();
          rt = session?.refresh_token || '';
        } catch {}
      }
      await sb.auth.setSession({
        access_token: token,
        refresh_token: rt,
      });
    } catch (err) {
      console.warn('[supabase] Failed to apply refreshed token from main process', err);
    }
  });
}

export { supabase };
