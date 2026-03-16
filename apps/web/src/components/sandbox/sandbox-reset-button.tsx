'use client';

import { RotateCcw } from 'lucide-react';
import { setSandboxResetFeedback } from '@/components/sandbox/sandbox-reset-feedback';

export function SandboxResetButton({ resetHref }: { resetHref: string }) {
  function handleReset() {
    const separator = resetHref.includes('?') ? '&' : '?';
    setSandboxResetFeedback();
    window.location.assign(`${resetHref}${separator}reset=${Date.now()}`);
  }

  return (
    <button
      type="button"
      onClick={handleReset}
      className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-white px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
    >
      <RotateCcw className="h-4 w-4" />
      Reset test data
    </button>
  );
}
