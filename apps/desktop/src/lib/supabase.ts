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
 * PURE TOKEN AUTH (v1.8.0+): Main process is the SINGLE SOURCE OF TRUTH.
 * The renderer asks main process for a fresh token via IPC.
 * No passwords stored anywhere. If token is expired and refresh fails,
 * the user is prompted to log in again (QF-AUTH-001).
 */
export async function ensureAuth(): Promise<string> {
  const sb = await getSupabase();

  // Ask main process for a valid token (single source of truth)
  // Retry once after a short delay — main process may still be refreshing on cold start
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await window.qf.auth.getToken();
      if (result?.ok && result.token) {
        await sb.auth.setSession({
          access_token: result.token,
          refresh_token: '', // Main process manages refresh tokens
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
 * Listen for token refresh events from main process and update
 * the renderer's Supabase client immediately. Call once on app init.
 */
export function listenForTokenRefresh(): () => void {
  return window.qf.auth.onTokenRefreshed(async (token: string) => {
    try {
      const sb = await getSupabase();
      await sb.auth.setSession({
        access_token: token,
        refresh_token: '', // Main process manages refresh tokens
      });
    } catch (err) {
      console.warn('[supabase] Failed to apply refreshed token from main process', err);
    }
  });
}

export { supabase };
