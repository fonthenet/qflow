declare module '@sentry/electron/main' {
  export function init(options: { dsn: string; tracesSampleRate?: number }): void;
}
