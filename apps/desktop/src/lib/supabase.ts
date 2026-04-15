import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabase: SupabaseClient | null = null;

export async function getSupabase(): Promise<SupabaseClient> {
  if (supabase) return supabase;
  const config = await window.qf.getConfig();
  supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false },
  });
  return supabase;
}

/** Restore auth session on the shared client so RLS policies work */
export async function restoreSession(accessToken: string, refreshToken: string): Promise<void> {
  const sb = await getSupabase();
  await sb.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
}

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
 */
export async function ensureAuth(): Promise<string> {
  const sb = await getSupabase();

  // 1. Check existing session — lets Supabase auto-refresh work
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session?.access_token) {
      return session.access_token;
    }
  } catch {}

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
