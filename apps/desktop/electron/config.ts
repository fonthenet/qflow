// ── Centralized configuration ─────────────────────────────────────
// Single source of truth for all configurable values.
// In future, these can be read from environment or a config file.

export const CONFIG = {
  // Supabase
  SUPABASE_URL: 'https://ofyyzuocifigyyhqxxqw.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9meXl6dW9jaWZpZ3l5aHF4eHF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyNjcwNDMsImV4cCI6MjA4ODg0MzA0M30.WzFn3aNgu7amI8ddplcnJJeD2Kilfy-HrsxrFTAWgeQ',

  // Cloud
  CLOUD_URL: 'https://qflo.net',

  // Kiosk server
  KIOSK_PORT: 80,

  // Sync intervals (ms)
  HEALTH_CHECK_INTERVAL: 10_000,
  SYNC_PUSH_INTERVAL: 10_000,   // push local changes every 10s (fallback; pushImmediate handles urgent)
  SYNC_PULL_INTERVAL: 5_000,    // pull cloud changes every 5s (fallback; Realtime WS handles instant)
  AUTO_RESOLVE_INTERVAL: 60_000,

  // App
  APP_NAME: 'Qflo Station',
  APP_VERSION: '1.0.22',
} as const;
