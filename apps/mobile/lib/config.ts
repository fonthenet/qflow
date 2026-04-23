/**
 * Centralized configuration — single source of truth for env vars.
 *
 * Env vars are prefixed with EXPO_PUBLIC_ so Metro strips them into the bundle.
 * Set them in a .env.local file (gitignored) during development.
 *
 * Required env vars:
 *   EXPO_PUBLIC_SUPABASE_URL
 *   EXPO_PUBLIC_SUPABASE_ANON_KEY
 *   EXPO_PUBLIC_API_URL        (optional, defaults to https://qflo.net)
 */

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'https://qflo.net';

export const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
  'https://ofyyzuocifigyyhqxxqw.supabase.co';

// The anon key is a public, RLS-gated JWT — safe to ship in the mobile bundle.
// It only permits operations allowed by row-level security policies.
const DEV_FALLBACK_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9meXl6dW9jaWZpZ3l5aHF4eHF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyNjcwNDMsImV4cCI6MjA4ODg0MzA0M30.WzFn3aNgu7amI8ddplcnJJeD2Kilfy-HrsxrFTAWgeQ';

export const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? DEV_FALLBACK_ANON_KEY;

export const APP_SCHEME = 'qflo';
export const UNIVERSAL_LINK_DOMAIN = 'qflo.com';

export const SUPPORT_EMAIL = 'support@qflo.net';
export const PRIVACY_URL = `${API_BASE_URL}/privacy`;
export const TERMS_URL = `${API_BASE_URL}/terms`;

/** Deep link base — used for WhatsApp/Messenger join links. */
export const JOIN_BASE_URL = `${API_BASE_URL}/join/`;
