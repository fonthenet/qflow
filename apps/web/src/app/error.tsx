'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
    console.error('[error-boundary]', error);
  }, [error]);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif',
      background: '#f8fafc', color: '#1e293b', padding: '2rem',
    }}>
      <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>Something went wrong</h1>
      <p style={{ color: '#64748b', marginTop: '0.5rem', textAlign: 'center', maxWidth: '400px' }}>
        An unexpected error occurred. Please try again.
      </p>
      <button
        onClick={reset}
        style={{
          marginTop: '2rem', padding: '0.75rem 2rem', background: '#3b82f6', color: 'white',
          borderRadius: '0.5rem', border: 'none', cursor: 'pointer', fontWeight: 500, fontSize: '0.95rem',
        }}
      >
        Try Again
      </button>
      {error.digest && (
        <p style={{ marginTop: '1rem', fontSize: '0.75rem', color: '#94a3b8' }}>
          Error ID: {error.digest}
        </p>
      )}
      <p style={{ marginTop: '3rem', fontSize: '0.8rem', color: '#94a3b8' }}>Qflo — Smart Queue Management</p>
    </div>
  );
}
