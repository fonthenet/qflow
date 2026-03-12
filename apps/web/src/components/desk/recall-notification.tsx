'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';

interface RecallNotificationProps {
  ticketId: string;
  ticketNumber: string;
  officeId: string;
}

export function RecallNotification({
  ticketId,
  ticketNumber,
  officeId,
}: RecallNotificationProps) {
  const [showRecall, setShowRecall] = useState(false);
  const [peopleAhead, setPeopleAhead] = useState<number | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  const triggerVibration = useCallback(() => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      // Vibrate pattern: 200ms on, 100ms off, 200ms on, 100ms off, 400ms on
      navigator.vibrate([200, 100, 200, 100, 400]);
    }
  }, []);

  const fetchPeopleAhead = useCallback(async () => {
    const supabase = createClient();
    const { count } = await supabase
      .from('tickets')
      .select('*', { count: 'exact', head: true })
      .eq('office_id', officeId)
      .eq('status', 'waiting')
      .lt('created_at', new Date().toISOString());

    setPeopleAhead(count ?? 0);
  }, [officeId]);

  useEffect(() => {
    const supabase = createClient();

    // Subscribe to recall broadcasts for this office
    const channel = supabase
      .channel(`recall-${officeId}`)
      .on('broadcast', { event: 'ticket_recall' }, (payload) => {
        const data = payload.payload;
        if (data?.ticket_id === ticketId) {
          setShowRecall(true);
          setAcknowledged(false);
          triggerVibration();
          fetchPeopleAhead();

          // Also try browser notification
          if (typeof window !== 'undefined' && 'Notification' in window) {
            if (Notification.permission === 'granted') {
              new Notification('Please Return!', {
                body: `Ticket ${ticketNumber} - Your turn is approaching. Please return to the service area.`,
                icon: '/favicon.ico',
                tag: `recall-${ticketId}`,
              });
            }
          }
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [ticketId, ticketNumber, officeId, triggerVibration, fetchPeopleAhead]);

  function handleAcknowledge() {
    setAcknowledged(true);
    // Stop vibration
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(0);
    }
    // Hide after a brief delay
    setTimeout(() => {
      setShowRecall(false);
    }, 500);
  }

  if (!showRecall || acknowledged) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-50 animate-in slide-in-from-top duration-300">
      <div className="mx-auto max-w-md p-4">
        <div className="overflow-hidden rounded-xl border-2 border-warning bg-warning/10 shadow-2xl">
          {/* Pulsing top bar */}
          <div className="relative h-1.5 bg-warning">
            <div className="absolute inset-0 animate-pulse bg-warning/60" />
          </div>

          <div className="bg-card p-5">
            {/* Pulsing icon */}
            <div className="mb-3 flex justify-center">
              <div className="relative">
                <div className="absolute inset-0 animate-ping rounded-full bg-warning/30" />
                <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-warning/20">
                  <svg
                    className="h-7 w-7 text-warning"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                    />
                  </svg>
                </div>
              </div>
            </div>

            {/* Message */}
            <div className="text-center">
              <h3 className="text-lg font-bold text-foreground">
                Please Return!
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Your turn is approaching. Please come back to the service area.
              </p>

              {/* Ticket number */}
              <div className="mt-3 inline-flex items-center gap-2 rounded-lg bg-muted px-4 py-2">
                <span className="text-xs text-muted-foreground">Ticket</span>
                <span className="text-lg font-bold text-primary">{ticketNumber}</span>
              </div>

              {/* People ahead */}
              {peopleAhead !== null && (
                <p className="mt-2 text-sm text-muted-foreground">
                  <span className="font-semibold text-foreground">{peopleAhead}</span>
                  {' '}
                  {peopleAhead === 1 ? 'person' : 'people'} ahead of you
                </p>
              )}
            </div>

            {/* Acknowledge button */}
            <button
              onClick={handleAcknowledge}
              className="mt-4 w-full rounded-lg bg-warning px-4 py-3 text-sm font-semibold text-warning-foreground shadow transition-colors hover:bg-warning/90 active:scale-[0.98]"
            >
              I&apos;m on my way!
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
