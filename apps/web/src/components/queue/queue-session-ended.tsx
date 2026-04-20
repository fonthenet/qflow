'use client';

import { useI18n } from '@/components/providers/locale-provider';

interface QueueSessionEndedProps {
  title?: string;
  description?: string;
  detail?: string;
  onResume?: () => void;
}

export function QueueSessionEnded({
  title = 'Tracking stopped',
  description = 'This visit has been cleared from this device. You can reopen the ticket page any time if you still need it.',
  detail,
  onResume,
}: QueueSessionEndedProps) {
  const { t, dir } = useI18n();
  const compactFooterClass = dir === 'rtl' ? 'tracking-normal normal-case' : 'uppercase tracking-[0.24em]';
  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.08),_transparent_45%),linear-gradient(180deg,_#f8fafc_0%,_#eef2f7_100%)] px-4 py-10 dark:bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.22),_transparent_45%),linear-gradient(180deg,_#020617_0%,_#0f172a_100%)]">
      <div className="w-full max-w-sm rounded-[32px] border border-slate-200 bg-white/90 p-7 text-center shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur dark:border-white/10 dark:bg-slate-950/85 dark:shadow-[0_30px_110px_rgba(15,23,42,0.65)]">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[22px] bg-emerald-100 text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-200">
          <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h1 className="mt-5 text-2xl font-semibold text-slate-900 dark:text-white">{t(title)}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{t(description)}</p>

        {detail ? (
          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
            {detail}
          </div>
        ) : null}

        {onResume ? (
          <button
            type="button"
            onClick={onResume}
            className="mt-6 w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
          >
            {t('Reopen tracking')}
          </button>
        ) : null}

        <p className={`mt-5 text-xs text-slate-500 ${compactFooterClass}`}>POWERED BY QFLO</p>
      </div>
    </div>
  );
}
