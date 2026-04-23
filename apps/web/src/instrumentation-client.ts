// Client-side Sentry initialisation.
// Next.js loads this file lazily after the page is interactive, so it does NOT
// contribute to the critical First Load JS chunk — unlike sentry.client.config.ts
// which is injected by withSentryConfig into every page bundle.
//
// See: https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation-client

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Performance monitoring: sample 10% of transactions in production
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Session replay: capture 1% of sessions, 100% on error
  replaysSessionSampleRate: 0.01,
  replaysOnErrorSampleRate: 1.0,

  integrations: [Sentry.replayIntegration()],

  // Don't send errors in development
  enabled: process.env.NODE_ENV === 'production',

  // Filter out noisy errors
  ignoreErrors: [
    'ResizeObserver loop',
    'AbortError',
    'Network request failed',
    'Load failed',
  ],
});

// Re-export onRouterTransitionStart so Next.js can wire up navigation tracing.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
