'use client';

import { useI18n } from '@/components/providers/locale-provider';

interface QueueStopDialogProps {
  isOpen: boolean;
  isStopping: boolean;
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function QueueStopDialog({
  isOpen,
  isStopping,
  title = 'Leave this queue?',
  description = 'This removes the ticket from the queue and stops live updates on this device.',
  confirmLabel = 'Leave queue',
  cancelLabel = 'Stay in line',
  onCancel,
  onConfirm,
}: QueueStopDialogProps) {
  const { t } = useI18n();
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/70 px-4 pb-6 pt-10 backdrop-blur-sm">
      <div className="w-full max-w-sm overflow-hidden rounded-[28px] border border-white/10 bg-slate-950 shadow-[0_28px_90px_rgba(15,23,42,0.55)]">
        <div className="border-b border-white/10 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 px-5 py-5">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-500/15 text-rose-200">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636l-1.414 1.414M7.05 16.95l-1.414 1.414M5.636 5.636l1.414 1.414M16.95 16.95l1.414 1.414M12 3v2m0 14v2m9-9h-2M5 12H3" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-white">{t(title)}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">{t(description)}</p>
        </div>

        <div className="grid grid-cols-2 gap-3 px-5 py-5">
          <button
            type="button"
            onClick={onCancel}
            disabled={isStopping}
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t(cancelLabel)}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isStopping}
            className="rounded-2xl bg-rose-500 px-4 py-3 text-sm font-semibold text-white shadow-[0_18px_40px_rgba(244,63,94,0.35)] transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isStopping ? t('Stopping...') : t(confirmLabel)}
          </button>
        </div>
      </div>
    </div>
  );
}
