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
 * Tries: 1) refreshSession  2) setSession with stored tokens  3) signInWithPassword
 * Returns the access token or empty string.
 */
export async function ensureAuth(stored?: {
  access_token?: string;
  refresh_token?: string;
  email?: string;
  password?: string;
}): Promise<string> {
  const sb = await getSupabase();
  // 1. Try refresh
  try {
    const { data: { session } } = await sb.auth.refreshSession();
    if (session?.access_token) return session.access_token;
  } catch { /* ignore */ }
  // 2. Try setSession with stored tokens
  if (stored?.refresh_token) {
    try {
      const { data: { session } } = await sb.auth.setSession({
        access_token: stored.access_token ?? '',
        refresh_token: stored.refresh_token,
      });
      if (session?.access_token) return session.access_token;
    } catch { /* ignore */ }
  }
  // 3. Last resort: password re-auth
  if (stored?.email && stored?.password) {
    try {
      const { data: { session } } = await sb.auth.signInWithPassword({
        email: stored.email,
        password: stored.password,
      });
      if (session?.access_token) return session.access_token;
    } catch { /* ignore */ }
  }
  return '';
}

export { supabase };
