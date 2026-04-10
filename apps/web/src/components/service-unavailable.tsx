'use client';

/**
 * Fallback UI shown when Supabase (or any backend service) is unreachable.
 * Used on public-facing pages (booking, check-in, display) so customers see
 * a branded message instead of a raw 500 error.
 */
export function ServiceUnavailable({
  title = 'Service temporarily unavailable',
  message = 'We\'re experiencing a temporary issue. Please try again in a few minutes or contact the office directly.',
  showRetry = true,
}: {
  title?: string;
  message?: string;
  showRetry?: boolean;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-lg">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100">
          <svg
            className="h-8 w-8 text-amber-600"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
            />
          </svg>
        </div>
        <h1 className="mb-2 text-xl font-semibold text-gray-900">{title}</h1>
        <p className="mb-6 text-sm text-gray-600">{message}</p>
        {showRetry && (
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
