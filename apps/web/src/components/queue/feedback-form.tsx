'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';

type Ticket = Database['public']['Tables']['tickets']['Row'];

interface FeedbackFormProps {
  ticket: Ticket;
  officeName: string;
  serviceName: string;
  onDone?: () => Promise<void> | void;
}

function RatingLabel({ rating }: { rating: number }) {
  if (rating === 1) return 'Poor';
  if (rating === 2) return 'Fair';
  if (rating === 3) return 'Good';
  if (rating === 4) return 'Very Good';
  if (rating === 5) return 'Excellent';
  return null;
}

export function FeedbackForm({
  ticket,
  officeName,
  serviceName,
  onDone,
}: FeedbackFormProps) {
  const [rating, setRating] = useState(0);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [existingRating, setExistingRating] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isFinishing, setIsFinishing] = useState(false);

  useEffect(() => {
    const checkExisting = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('feedback')
        .select('rating')
        .eq('ticket_id', ticket.id)
        .maybeSingle();
      if (data) {
        setExistingRating(data.rating);
        setRating(data.rating);
        setIsSubmitted(true);
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

      setIsSubmitted(true);
    } catch {
      setError('Failed to submit feedback. Please try again.');
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

  const ratingLabel = <RatingLabel rating={hoveredRating || rating} />;

  if (isSubmitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(34,197,94,0.20),_transparent_40%),linear-gradient(180deg,_#020617_0%,_#0f172a_100%)] px-4 py-10">
        <div className="w-full max-w-sm rounded-[34px] border border-white/10 bg-slate-950/88 p-7 text-center shadow-[0_30px_110px_rgba(15,23,42,0.65)] backdrop-blur">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[22px] bg-emerald-500/12 text-emerald-200">
            <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <h1 className="mt-5 text-2xl font-semibold text-white">Visit complete</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Thanks for sharing your feedback. Your visit on ticket {ticket.ticket_number} is all wrapped up.
          </p>

          <div className="mt-6 rounded-[26px] border border-white/10 bg-white/5 px-5 py-5">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Your rating</p>
            <div className="mt-4 flex justify-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <svg
                  key={star}
                  className={`h-7 w-7 ${star <= (existingRating ?? rating) ? 'text-amber-300' : 'text-slate-600'}`}
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleFinish()}
            disabled={isFinishing}
            className="mt-6 w-full rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-100 disabled:opacity-60"
          >
            {isFinishing ? 'Closing...' : 'Done'}
          </button>

          <p className="mt-5 text-xs uppercase tracking-[0.28em] text-slate-500">
            {officeName} · Qflo
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-[radial-gradient(circle_at_top,_rgba(34,197,94,0.18),_transparent_40%),linear-gradient(180deg,_#020617_0%,_#0f172a_100%)]">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-8">
        <div className="rounded-[34px] border border-white/10 bg-slate-950/80 p-7 shadow-[0_30px_110px_rgba(15,23,42,0.55)] backdrop-blur">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">{officeName}</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">Thanks for visiting</h1>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                Ticket {ticket.ticket_number} is complete. If you have a moment, tell us how this visit felt.
              </p>
            </div>
            <div className="rounded-full bg-emerald-500/12 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-100">
              Complete
            </div>
          </div>

          <form onSubmit={handleSubmit} className="mt-8">
            <div className="rounded-[28px] border border-white/10 bg-white/5 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Your rating</p>
              <div className="mt-5 flex justify-center gap-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    className="rounded-xl p-1 transition-transform hover:scale-110 active:scale-95"
                    onMouseEnter={() => setHoveredRating(star)}
                    onMouseLeave={() => setHoveredRating(0)}
                    onClick={() => setRating(star)}
                    aria-label={`Rate ${star} star${star > 1 ? 's' : ''}`}
                  >
                    <svg
                      className={`h-11 w-11 transition-colors ${
                        star <= (hoveredRating || rating)
                          ? 'text-amber-300 drop-shadow-[0_6px_14px_rgba(252,211,77,0.2)]'
                          : 'text-slate-700'
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
                <p className="mt-4 text-center text-sm font-semibold text-slate-200">{ratingLabel}</p>
              ) : null}
            </div>

            <div className="mt-4 rounded-[28px] border border-white/10 bg-white/5 p-5">
              <label htmlFor="comment" className="text-sm font-semibold text-white">
                Anything we should know?
              </label>
              <p className="mt-1 text-sm text-slate-300">Optional notes help the team improve the next visit.</p>
              <textarea
                id="comment"
                rows={4}
                className="mt-4 w-full resize-none rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-base text-white outline-none transition-colors placeholder:text-slate-500 focus:border-sky-300/40 focus:ring-2 focus:ring-sky-300/20"
                placeholder="Share what went well or what could be smoother..."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </div>

            {error ? (
              <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                {error}
              </div>
            ) : null}

            <div className="mt-6 grid gap-3">
              <button
                type="submit"
                disabled={rating === 0 || isSubmitting}
                className="w-full rounded-2xl bg-white px-6 py-4 text-base font-semibold text-slate-950 shadow-[0_18px_45px_rgba(255,255,255,0.10)] transition hover:bg-slate-100 active:scale-[0.99] disabled:opacity-40"
              >
                {isSubmitting ? 'Submitting...' : 'Submit feedback'}
              </button>

              <button
                type="button"
                onClick={() => void handleFinish()}
                disabled={isFinishing}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-6 py-4 text-sm font-semibold text-slate-100 transition hover:bg-white/8 disabled:opacity-60"
              >
                {isFinishing ? 'Closing...' : 'Finish without feedback'}
              </button>
            </div>
          </form>
        </div>

        <div className="mt-auto pt-6 text-center">
          <p className="text-xs uppercase tracking-[0.28em] text-slate-500">{serviceName} · Qflo</p>
        </div>
      </div>
    </div>
  );
}
