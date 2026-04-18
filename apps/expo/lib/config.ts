/**
 * Centralized configuration — single source of truth for URLs and settings.
 * All files should import from here instead of hardcoding URLs.
 */

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL || 'https://qflo.net';

export const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://ofyyzuocifigyyhqxxqw.supabase.co';

// Supabase anon key is a public, RLS-gated JWT — safe to ship in a mobile
// bundle. We still require it to come from env at build time so it can be
// rotated without a code change. A missing value fails loudly rather than
// silently shipping a stale hardcoded key.
const anonKeyFromEnv = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!anonKeyFromEnv && !__DEV__) {
  // In release builds this would break auth immediately — fail the bundle
  // with a clear message instead.
  throw new Error(
    'EXPO_PUBLIC_SUPABASE_ANON_KEY is not set. Configure it in EAS project secrets before building.',
  );
}
export const SUPABASE_ANON_KEY = anonKeyFromEnv || '';

export const SUPPORT_EMAIL = 'support@qflo.net';

export const PRIVACY_URL = `${API_BASE_URL}/privacy`;
export const TERMS_URL = `${API_BASE_URL}/terms`;
