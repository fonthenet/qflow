'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';

type Ticket = Database['public']['Tables']['tickets']['Row'];

interface FeedbackFormProps {
  ticket: Ticket;
  officeName: string;
  serviceName: string;
}

export function FeedbackForm({ ticket, officeName, serviceName }: FeedbackFormProps) {
  const [rating, setRating] = useState(0);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [existingRating, setExistingRating] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Check if feedback was already submitted for this ticket
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
    checkExisting();
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

  if (isSubmitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted p-4">
        <div className="w-full max-w-sm text-center">
          <div className="rounded-xl bg-card p-8 shadow-lg">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
              <svg
                className="h-8 w-8 text-success"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h1 className="mb-2 text-2xl font-bold text-foreground">Thank You!</h1>
            <p className="mb-4 text-muted-foreground">
              Your feedback helps us improve our service.
            </p>
            <div className="flex justify-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <svg
                  key={star}
                  className={`h-6 w-6 ${
                    star <= rating ? 'text-warning' : 'text-muted'
                  }`}
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              ))}
            </div>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            {officeName} &middot; {serviceName}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-muted">
      <div className="mx-auto w-full max-w-sm flex-1 px-4 py-8">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <svg
              className="h-7 w-7 text-primary"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h1 className="mb-1 text-xl font-bold text-foreground">Service Complete</h1>
          <p className="text-sm text-muted-foreground">
            Ticket {ticket.ticket_number} &middot; {serviceName}
          </p>
        </div>

        {/* Feedback form */}
        <form onSubmit={handleSubmit} className="rounded-xl bg-card p-6 shadow-lg">
          <h2 className="mb-1 text-center text-lg font-semibold text-foreground">
            How was your experience?
          </h2>
          <p className="mb-6 text-center text-sm text-muted-foreground">
            Rate your visit today
          </p>

          {/* Star rating */}
          <div className="mb-6 flex justify-center gap-2">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                className="rounded-lg p-1 transition-transform hover:scale-110 active:scale-95"
                onMouseEnter={() => setHoveredRating(star)}
                onMouseLeave={() => setHoveredRating(0)}
                onClick={() => setRating(star)}
                aria-label={`Rate ${star} star${star > 1 ? 's' : ''}`}
              >
                <svg
                  className={`h-10 w-10 transition-colors ${
                    star <= (hoveredRating || rating)
                      ? 'text-warning drop-shadow-sm'
                      : 'text-border'
                  }`}
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              </button>
            ))}
          </div>

          {/* Rating label */}
          {rating > 0 && (
            <p className="mb-4 text-center text-sm font-medium text-muted-foreground">
              {rating === 1 && 'Poor'}
              {rating === 2 && 'Fair'}
              {rating === 3 && 'Good'}
              {rating === 4 && 'Very Good'}
              {rating === 5 && 'Excellent'}
            </p>
          )}

          {/* Comment */}
          <div className="mb-6">
            <label
              htmlFor="comment"
              className="mb-1.5 block text-sm font-medium text-foreground"
            >
              Comments{' '}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <textarea
              id="comment"
              rows={3}
              className="w-full resize-none rounded-lg border border-input bg-background px-4 py-3 text-base outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
              placeholder="Tell us about your experience..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>

          {error && (
            <div className="mb-4 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={rating === 0 || isSubmitting}
            className="w-full rounded-xl bg-primary px-6 py-4 text-base font-semibold text-primary-foreground shadow-lg transition-all active:scale-[0.98] disabled:opacity-40"
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                Submitting...
              </span>
            ) : (
              'Submit Feedback'
            )}
          </button>

          {rating === 0 && (
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Please select a rating to continue
            </p>
          )}
        </form>
      </div>

      {/* Footer */}
      <div className="px-4 pb-6 pt-2 text-center">
        <p className="text-xs text-muted-foreground">
          {officeName} &middot; Powered by QueueFlow
        </p>
      </div>
    </div>
  );
}
