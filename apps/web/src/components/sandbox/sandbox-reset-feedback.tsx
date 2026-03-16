'use client';

import { CheckCircle2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

const SANDBOX_RESET_KEY = 'queueflow:sandbox-reset-feedback';

export function setSandboxResetFeedback() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(
    SANDBOX_RESET_KEY,
    'Sandbox test data reset to the default preview.'
  );
}

export function SandboxResetFeedback() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const nextMessage = window.sessionStorage.getItem(SANDBOX_RESET_KEY);
    if (!nextMessage) return;
    setMessage(nextMessage);
    window.sessionStorage.removeItem(SANDBOX_RESET_KEY);
  }, []);

  if (!message) return null;

  return (
    <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-3">
      <div className="mx-auto flex max-w-6xl items-start justify-between gap-3 text-sm text-emerald-800 sm:px-2">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{message}</span>
        </div>
        <button
          type="button"
          onClick={() => setMessage(null)}
          className="rounded-md p-1 text-emerald-700 hover:bg-emerald-100"
          aria-label="Dismiss reset message"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
