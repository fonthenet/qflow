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
 * STRATEGY (v1.5.87+): Main process is the SINGLE SOURCE OF TRUTH for tokens.
 * The renderer asks main process for a fresh token via IPC instead of
 * managing its own refresh logic. This eliminates token drift between
 * the SyncEngine and the renderer's Supabase client.
 *
 * Fallback: if IPC fails (shouldn't happen), tries local refresh.
 */
export async function ensureAuth(stored?: {
  access_token?: string;
  refresh_token?: string;
  email?: string;
  password?: string;
}): Promise<string> {
  const sb = await getSupabase();

  // ── PRIMARY: Ask main process for a valid token ──
  try {
    const result = await window.qf.auth.getToken();
    if (result?.ok && result.token) {
      // Set the token on the renderer's Supabase client
      await sb.auth.setSession({
        access_token: result.token,
        refresh_token: stored?.refresh_token ?? '',
      });
      return result.token;
    }
  } catch (err) {
    console.warn('[supabase] IPC auth:get-token failed, falling back to local refresh', err);
  }

  // ── FALLBACK 1: Try local refresh (if renderer still has a valid session) ──
  try {
    const { data: { session } } = await sb.auth.refreshSession();
    if (session?.access_token) return session.access_token;
  } catch { /* ignore */ }

  // ── FALLBACK 2: Try setSession with stored tokens ──
  if (stored?.refresh_token) {
    try {
      const { data: { session } } = await sb.auth.setSession({
        access_token: stored.access_token ?? '',
        refresh_token: stored.refresh_token,
      });
      if (session?.access_token) return session.access_token;
    } catch { /* ignore */ }
  }

  // ── FALLBACK 3: Password re-auth ──
  if (stored?.email && stored?.password) {
    try {
      const { data: { session } } = await sb.auth.signInWithPassword({
        email: stored.email,
        password: stored.password,
      });
      if (session?.access_token) return session.access_token;
    } catch { /* ignore */ }
  }

  console.error('[supabase] All auth methods failed — queries will return empty results');
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
