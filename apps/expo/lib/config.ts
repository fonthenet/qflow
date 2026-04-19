/**
 * Centralized configuration — single source of truth for URLs and settings.
 * All files should import from here instead of hardcoding URLs.
 */

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL || 'https://qflo.net';

export const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://ofyyzuocifigyyhqxxqw.supabase.co';

// Supabase anon key is a public, RLS-gated JWT — safe to ship in a mobile
// bundle. Source of truth is EAS env (see eas.json). The hardcoded fallback
// is the same public key, kept only so `expo start` works without env config.
const DEV_FALLBACK_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9meXl6dW9jaWZpZ3l5aHF4eHF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyNjcwNDMsImV4cCI6MjA4ODg0MzA0M30.WzFn3aNgu7amI8ddplcnJJeD2Kilfy-HrsxrFTAWgeQ';

export const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || DEV_FALLBACK_ANON_KEY;

export const SUPPORT_EMAIL = 'support@qflo.net';

export const PRIVACY_URL = `${API_BASE_URL}/privacy`;
export const TERMS_URL = `${API_BASE_URL}/terms`;
