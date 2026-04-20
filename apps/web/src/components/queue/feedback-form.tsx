'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import { useI18n } from '@/components/providers/locale-provider';

type Ticket = Database['public']['Tables']['tickets']['Row'];

interface FeedbackFormProps {
  ticket: Ticket;
  officeName: string;
  serviceName: string;
  onDone?: () => Promise<void> | void;
}

function getFeedbackStorageKey(ticketId: string) {
  return `qflo:feedback:${ticketId}`;
}

function readStoredFeedback(ticketId: string) {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(getFeedbackStorageKey(ticketId));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as {
      rating?: number;
      comment?: string | null;
      submitted?: boolean;
    };

    if (!parsed.submitted || typeof parsed.rating !== 'number') {
      return null;
    }

    return {
      rating: parsed.rating,
      comment: parsed.comment ?? '',
    };
  } catch {
    return null;
  }
}

function storeFeedback(ticketId: string, rating: number, comment: string) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(
      getFeedbackStorageKey(ticketId),
      JSON.stringify({
        submitted: true,
        rating,
        comment,
      })
    );
  } catch {
    // Ignore storage failures.
  }
}

function RatingLabel({ rating, t }: { rating: number; t: (key: string) => string }) {
  if (rating === 1) return t('Poor');
  if (rating === 2) return t('Fair');
  if (rating === 3) return t('Good');
  if (rating === 4) return t('Very Good');
  if (rating === 5) return t('Excellent');
  return null;
}

export function FeedbackForm({
  ticket,
  officeName,
  serviceName,
  onDone,
}: FeedbackFormProps) {
  const { t, dir } = useI18n();
  const [rating, setRating] = useState(0);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [existingRating, setExistingRating] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isFinishing, setIsFinishing] = useState(false);
  const [isCheckingExisting, setIsCheckingExisting] = useState(true);
  const compactLabelClass = dir === 'rtl' ? 'tracking-normal normal-case' : 'uppercase tracking-[0.28em]';
  const compactPillClass = dir === 'rtl' ? 'tracking-normal normal-case' : 'uppercase tracking-[0.18em]';
  const compactMetaClass = dir === 'rtl' ? 'tracking-normal normal-case' : 'uppercase tracking-[0.24em]';
  const compactFooterClass = dir === 'rtl' ? 'tracking-normal normal-case' : 'uppercase tracking-[0.28em]';

  useEffect(() => {
    const storedFeedback = readStoredFeedback(ticket.id);
    if (storedFeedback) {
      setExistingRating(storedFeedback.rating);
      setRating(storedFeedback.rating);
      setComment(storedFeedback.comment);
      setIsSubmitted(true);
      setIsCheckingExisting(false);
    }

    const checkExisting = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from('feedback')
          .select('rating, comment')
          .eq('ticket_id', ticket.id)
          .maybeSingle();
        if (data) {
          setExistingRating(data.rating);
          setRating(data.rating);
          setComment(data.comment ?? '');
          setIsSubmitted(true);
          storeFeedback(ticket.id, data.rating, data.comment ?? '');
        }
      } finally {
        setIsCheckingExisting(false);
      }
    };
    void checkExisting();
  }, [ticket.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rating === 0) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const supabase = createClient();
      const { error: insertError } = await supabase.from('feedback').insert({
        ticket_id: ticket.id,
        service_id: ticket.service_id,
        staff_id: ticket.called_by_staff_id,
        rating,
        comment: comment.trim() || null,
      });

      if (insertError) throw insertError;

      setExistingRating(rating);
      setIsSubmitted(true);
      storeFeedback(ticket.id, rating, comment.trim());
    } catch {
      setError(t('Failed to submit feedback. Please try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFinish = async () => {
    setIsFinishing(true);
    try {
      if (onDone) {
        await onDone();
      }
    } finally {
      setIsFinishing(false);
    }
  };

  const ratingLabel = <RatingLabel rating={hoveredRating || rating} t={t} />;

  if (isCheckingExisting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(34,197,94,0.08),_transparent_40%),linear-gradient(180deg,_#f8fafc_0%,_#eef2f7_100%)] px-4 py-10 dark:bg-[radial-gradient(circle_at_top,_rgba(34,197,94,0.18),_transparent_40%),linear-gradient(180deg,_#020617_0%,_#0f172a_100%)]">
        <div className="w-full max-w-sm rounded-[34px] border border-slate-200 bg-white/90 p-7 text-center shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur dark:border-white/10 dark:bg-slate-950/88 dark:shadow-[0_30px_110px_rgba(15,23,42,0.65)]">
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('Loading...')}</p>
        </div>
      </div>
    );
  }

  if (isSubmitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(34,197,94,0.08),_transparent_40%),linear-gradient(180deg,_#f8fafc_0%,_#eef2f7_100%)] px-4 py-10 dark:bg-[radial-gradient(circle_at_top,_rgba(34,197,94,0.20),_transparent_40%),linear-gradient(180deg,_#020617_0%,_#0f172a_100%)]">
        <div className="w-full max-w-sm rounded-[34px] border border-slate-200 bg-white/90 p-7 text-center shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur dark:border-white/10 dark:bg-slate-950/88 dark:shadow-[0_30px_110px_rgba(15,23,42,0.65)]">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[22px] bg-emerald-100 text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-200">
            <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <h1 className="mt-5 text-2xl font-semibold text-slate-900 dark:text-white">{t('Visit complete')}</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {t('Thanks for sharing your feedback. Your visit on ticket {number} is all wrapped up.', {
              number: ticket.ticket_number,
            })}
          </p>

          <div className="mt-4 rounded-[18px] border border-slate-200 bg-slate-50 px-3.5 py-2.5 dark:border-white/10 dark:bg-white/5">
            <div className="flex items-center justify-between gap-3">
              <p className={`text-[10px] font-semibold text-slate-500 dark:text-slate-400 ${compactPillClass}`}>{t('Your rating')}</p>
              <div className="flex justify-center gap-0.5">
              {[1, 2, 3, 4, 5].map((star) => (
                <svg
                  key={star}
                  className={`h-4 w-4 ${star <= (existingRating ?? rating) ? 'text-amber-500 dark:text-amber-300' : 'text-slate-300 dark:text-slate-600'}`}
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              ))}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleFinish()}
            disabled={isFinishing}
            className="mt-6 w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
          >
            {isFinishing ? t('Closing...') : t('Done')}
          </button>

          <p className={`mt-5 text-xs text-slate-500 ${compactFooterClass}`}>POWERED BY QFLO</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-[radial-gradient(circle_at_top,_rgba(34,197,94,0.08),_transparent_40%),linear-gradient(180deg,_#f8fafc_0%,_#eef2f7_100%)] dark:bg-[radial-gradient(circle_at_top,_rgba(34,197,94,0.18),_transparent_40%),linear-gradient(180deg,_#020617_0%,_#0f172a_100%)]">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-8">
        <div className="rounded-[34px] border border-slate-200 bg-white/90 p-7 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur dark:border-white/10 dark:bg-slate-950/80 dark:shadow-[0_30px_110px_rgba(15,23,42,0.55)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className={`text-xs font-semibold text-slate-500 dark:text-slate-400 ${compactLabelClass}`}>{officeName}</p>
              <h1 className="mt-3 whitespace-nowrap text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">{t('Thanks for visiting')}</h1>
              <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                {t('Ticket {number} is complete. If you have a moment, tell us how this visit felt.', {
                  number: ticket.ticket_number,
                })}
              </p>
            </div>
            <div className={`rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-100 ${compactPillClass}`}>
              {t('Complete')}
            </div>
          </div>

          <form onSubmit={handleSubmit} className="mt-8">
            <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5 dark:border-white/10 dark:bg-white/5">
              <p className={`text-xs font-semibold text-slate-500 dark:text-slate-400 ${compactMetaClass}`}>{t('Your rating')}</p>
              <div className="mt-5 flex justify-center gap-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    className="rounded-xl p-1 transition-transform hover:scale-110 active:scale-95"
                    onMouseEnter={() => setHoveredRating(star)}
                    onMouseLeave={() => setHoveredRating(0)}
                    onClick={() => setRating(star)}
                    aria-label={t('Rate {count} star(s)', { count: star })}
                  >
                    <svg
                      className={`h-11 w-11 transition-colors ${
                        star <= (hoveredRating || rating)
                          ? 'text-amber-500 drop-shadow-[0_6px_14px_rgba(252,211,77,0.35)] dark:text-amber-300 dark:drop-shadow-[0_6px_14px_rgba(252,211,77,0.2)]'
                          : 'text-slate-300 dark:text-slate-700'
                      }`}
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                    </svg>
                  </button>
                ))}
              </div>

              {ratingLabel ? (
                <p className="mt-4 text-center text-sm font-semibold text-slate-700 dark:text-slate-200">{ratingLabel}</p>
              ) : null}
            </div>

            <div className="mt-4 rounded-[28px] border border-slate-200 bg-slate-50 p-5 dark:border-white/10 dark:bg-white/5">
              <label htmlFor="comment" className="text-sm font-semibold text-slate-900 dark:text-white">
                {t('Anything we should know?')}
              </label>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{t('Optional notes help the team improve the next visit.')}</p>
              <textarea
                id="comment"
                rows={4}
                className="mt-4 w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-200 dark:border-white/10 dark:bg-slate-950/70 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-sky-300/40 dark:focus:ring-sky-300/20"
                placeholder={t('Share what went well or what could be smoother...')}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </div>

            {error ? (
              <div className="mt-4 rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-100">
                {error}
              </div>
            ) : null}

            <div className="mt-6 grid gap-3">
              <button
                type="submit"
                disabled={rating === 0 || isSubmitting}
                className="w-full rounded-2xl bg-slate-900 px-6 py-4 text-base font-semibold text-white shadow-[0_18px_45px_rgba(15,23,42,0.10)] transition hover:bg-slate-800 active:scale-[0.99] disabled:opacity-40 dark:bg-white dark:text-slate-950 dark:shadow-[0_18px_45px_rgba(255,255,255,0.10)] dark:hover:bg-slate-100"
              >
                {isSubmitting ? t('Submitting...') : t('Submit feedback')}
              </button>

              <button
                type="button"
                onClick={() => void handleFinish()}
                disabled={isFinishing}
                className="w-full rounded-2xl border border-slate-200 bg-white/80 px-6 py-4 text-sm font-semibold text-slate-700 transition hover:bg-white disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:hover:bg-white/8"
              >
                {isFinishing ? t('Closing...') : t('Finish without feedback')}
              </button>
            </div>
          </form>
        </div>

        <div className="mt-auto pt-6 text-center">
          <p className={`text-xs text-slate-500 ${compactFooterClass}`}>POWERED BY QFLO</p>
        </div>
      </div>
    </div>
  );
}
