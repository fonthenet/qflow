'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minHeight: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif',
          background: '#f8fafc', color: '#1e293b', padding: '2rem',
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ color: '#64748b', marginTop: '0.5rem' }}>An unexpected error occurred.</p>
          <button
            onClick={reset}
            style={{
              marginTop: '2rem', padding: '0.75rem 2rem', background: '#3b82f6', color: 'white',
              borderRadius: '0.5rem', border: 'none', cursor: 'pointer', fontWeight: 500,
            }}
          >
            Try Again
          </button>
        </div>
      </body>
    </html>
  );
}
