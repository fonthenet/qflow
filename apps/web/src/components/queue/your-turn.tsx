'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Info, Contact, Clock } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { subscribeToPush } from '@/lib/push';
import { CALL_WAIT_SECONDS } from '@/lib/queue/call-timing';
import type { Database } from '@/lib/supabase/database.types';

type Ticket = Database['public']['Tables']['tickets']['Row'];
type NotificationRow = Database['public']['Tables']['notifications']['Row'];

interface YourTurnProps {
  ticket: Ticket;
  deskName: string;
  officeName: string;
  serviceName: string;
  lastSyncedAt: Date | null;
  isRefreshing: boolean;
  stopError?: string | null;
  onRefresh: () => Promise<void> | void;
  onStopTracking: () => void;
  sandboxMode?: boolean;
}

function calcRemaining(calledAt: string | null) {
  if (!calledAt) return CALL_WAIT_SECONDS;
  const elapsed = Math.floor((Date.now() - new Date(calledAt).getTime()) / 1000);
  return Math.max(0, CALL_WAIT_SECONDS - elapsed);
}

function formatSyncLabel(date: Date | null, isRefreshing: boolean) {
  if (isRefreshing) return 'Refreshing…';
  if (!date) return `Last update: ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  return `Last update: ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

function QueueActionPill({
  label,
  onClick,
  tone = 'secondary',
  disabled = false,
  loading = false,
}: {
  label: string;
  onClick: () => void;
  tone?: 'secondary' | 'danger' | 'primary';
  disabled?: boolean;
  loading?: boolean;
}) {
  const toneClass = {
    secondary: 'border-white/12 bg-white/10 text-white hover:bg-white/14',
    danger: 'border-rose-200/20 bg-rose-500/15 text-rose-50 hover:bg-rose-500/22',
    primary: 'border-white/12 bg-white text-slate-950 hover:bg-slate-100',
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-full border px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${toneClass}`}
    >
      {loading ? 'Working...' : label}
    </button>
  );
}

export function YourTurn({
  ticket,
  deskName: initialDeskName,
  officeName,
  serviceName,
  lastSyncedAt,
  isRefreshing,
  stopError,
  onRefresh,
  onStopTracking,
  sandboxMode = false,
}: YourTurnProps) {
  const [deskName, setDeskName] = useState(initialDeskName || 'your desk');
  const [countdown, setCountdown] = useState(() => calcRemaining(ticket.called_at));
  const [calledAt, setCalledAt] = useState(ticket.called_at);
  const lastAlertedAt = useRef<string | null>(null);
  const [recallCount, setRecallCount] = useState(ticket.recall_count ?? 0);
  const [showBuzzFlash, setShowBuzzFlash] = useState(false);
  const lastBuzzNotificationId = useRef<string | null>(null);
  const pendingAlert = useRef(true);
  const buzzTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const phase = countdown > 30 ? 'green' : countdown > 10 ? 'yellow' : 'red';
  const syncLabel = useMemo(() => formatSyncLabel(lastSyncedAt, isRefreshing), [isRefreshing, lastSyncedAt]);

  const fireVibAndSound = () => {
    try {
      if ('vibrate' in navigator) {
        navigator.vibrate([500, 200, 500, 200, 500]);
      }
    } catch {
      // Ignore vibration failures.
    }

    try {
      const ctx =
        ((window as unknown as Record<string, unknown>).__queueAudioCtx as AudioContext) ||
        new AudioContext();
      (window as unknown as Record<string, unknown>).__queueAudioCtx = ctx;

      const scheduleTones = () => {
        const playTone = (freq: number, startAt: number, duration: number) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = freq;
          osc.type = 'sine';
          gain.gain.setValueAtTime(0.5, ctx.currentTime + startAt);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + startAt + duration);
          osc.start(ctx.currentTime + startAt);
          osc.stop(ctx.currentTime + startAt + duration);
        };

        playTone(880, 0, 0.3);
        playTone(1100, 0.35, 0.3);
        playTone(1320, 0.7, 0.5);
      };

      if (ctx.state === 'suspended') {
        ctx.resume().then(scheduleTones).catch(() => {});
      } else {
        scheduleTones();
      }
    } catch {
      // Ignore audio failures.
    }
  };

  const fireBuzz = () => {
    if ('vibrate' in navigator) {
      navigator.vibrate([800, 200, 800, 200, 800, 200, 800, 200, 800]);
    }

    try {
      const existing = (window as unknown as Record<string, unknown>).__queueAudioCtx as AudioContext | undefined;
      const ctx = existing ?? new AudioContext();
      (window as unknown as Record<string, unknown>).__queueAudioCtx = ctx;

      const schedulePattern = () => {
        const pulse = (frequency: number, startAt: number, duration: number) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.type = 'square';
          osc.frequency.value = frequency;
          gain.gain.setValueAtTime(0.0001, ctx.currentTime + startAt);
          gain.gain.exponentialRampToValueAtTime(0.24, ctx.currentTime + startAt + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + startAt + duration);
          osc.start(ctx.currentTime + startAt);
          osc.stop(ctx.currentTime + startAt + duration);
        };

        pulse(180, 0.0, 0.16);
        pulse(230, 0.22, 0.16);
        pulse(180, 0.44, 0.16);
        pulse(230, 0.66, 0.16);
      };

      if (ctx.state === 'suspended') {
        ctx.resume().then(schedulePattern).catch(() => {});
      } else {
        schedulePattern();
      }
    } catch {
      // Ignore.
    }

    let flashes = 0;
    const maxFlashes = 15;
    if (buzzTimerRef.current) clearInterval(buzzTimerRef.current);
    setShowBuzzFlash(true);
    buzzTimerRef.current = setInterval(() => {
      flashes += 1;
      if (flashes >= maxFlashes) {
        if (buzzTimerRef.current) clearInterval(buzzTimerRef.current);
        buzzTimerRef.current = null;
        setShowBuzzFlash(false);
        return;
      }
      setShowBuzzFlash((prev) => !prev);
    }, 200);
  };

  useEffect(() => {
    if (sandboxMode) return;
    if (ticket.desk_id) {
      const supabase = createClient();
      supabase
        .from('desks')
        .select('name, display_name')
        .eq('id', ticket.desk_id)
        .single()
        .then(({ data }) => {
          if (data) {
            setDeskName(data.display_name ?? data.name);
          }
        });
    }
  }, [sandboxMode, ticket.desk_id]);

  useEffect(() => {
    if (sandboxMode) return;
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw-notify.js').catch(() => {});
    }
    if ('Notification' in window && Notification.permission === 'granted') {
      subscribeToPush(ticket.id).catch(() => {});
    }
  }, [sandboxMode, ticket.id]);

  useEffect(() => {
    if (sandboxMode) return;
    const handleTouch = () => {
      let ctx = (window as unknown as Record<string, unknown>).__queueAudioCtx as AudioContext | undefined;
      if (!ctx) {
        try {
          ctx = new AudioContext();
          (window as unknown as Record<string, unknown>).__queueAudioCtx = ctx;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          gain.gain.setValueAtTime(0, ctx.currentTime);
          osc.start();
          osc.stop(ctx.currentTime + 0.01);
        } catch {
          // Ignore.
        }
      } else if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      if (pendingAlert.current) {
        pendingAlert.current = false;
        setTimeout(() => {
          fireVibAndSound();
        }, 100);
      }

      if ('Notification' in window && Notification.permission === 'granted') {
        subscribeToPush(ticket.id).catch(() => {});
      }
    };

    document.addEventListener('touchstart', handleTouch, { once: false });
    document.addEventListener('click', handleTouch, { once: false });
    return () => {
      document.removeEventListener('touchstart', handleTouch);
      document.removeEventListener('click', handleTouch);
    };
  }, [sandboxMode, ticket.id]);

  useEffect(() => {
    if (sandboxMode) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`recall-${ticket.office_id}`)
      .on('broadcast', { event: 'ticket_recall' }, (payload) => {
        if (payload.payload?.ticket_id === ticket.id) {
          setCalledAt(new Date().toISOString());
          setRecallCount((count) => count + 1);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sandboxMode, ticket.id, ticket.office_id]);

  useEffect(() => {
    if (sandboxMode) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`buzz-${ticket.office_id}`)
      .on('broadcast', { event: 'ticket_buzz' }, (payload) => {
        if (payload.payload?.ticket_id === ticket.id) {
          fireBuzz();
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sandboxMode, ticket.id, ticket.office_id]);

  useEffect(() => {
    if (sandboxMode) return;
    const supabase = createClient();

    const seedLatestBuzz = async () => {
      const { data } = await supabase
        .from('notifications')
        .select('id')
        .eq('ticket_id', ticket.id)
        .eq('type', 'buzz')
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data?.id) {
        lastBuzzNotificationId.current = data.id;
      }
    };

    void seedLatestBuzz();

    const channel = supabase
      .channel(`buzz-notification-${ticket.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `ticket_id=eq.${ticket.id}`,
        },
        (payload) => {
          const notification = payload.new as NotificationRow;
          if (notification.type !== 'buzz') return;
          if (notification.id === lastBuzzNotificationId.current) return;
          lastBuzzNotificationId.current = notification.id;
          fireBuzz();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sandboxMode, ticket.id]);

  useEffect(() => {
    if (sandboxMode) return;
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'buzz' && event.data?.ticketId === ticket.id) {
        fireBuzz();
      }
    };
    navigator.serviceWorker?.addEventListener('message', handler);
    return () => {
      navigator.serviceWorker?.removeEventListener('message', handler);
    };
  }, [sandboxMode, ticket.id]);

  useEffect(() => {
    return () => {
      if (buzzTimerRef.current) clearInterval(buzzTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (sandboxMode) return;
    const handleVisibility = async () => {
      if (document.visibilityState !== 'visible') return;

      pendingAlert.current = true;

      try {
        if ('vibrate' in navigator) navigator.vibrate([500, 200, 500, 200, 500]);
      } catch {
        // Ignore.
      }

      if ('Notification' in window && Notification.permission === 'granted' && 'serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(async (reg) => {
          try {
            await reg.showNotification('Your Turn!', {
              body: `Ticket ${ticket.ticket_number} — Please go to ${deskName}`,
              icon: '/icon-192x192.png',
              badge: '/badge-96x96.png',
              tag: `called-${ticket.id}`,
              renotify: true,
              vibrate: [300, 150, 300, 150, 600],
              requireInteraction: false,
            } as NotificationOptions);
          } catch {
            // Ignore.
          }
        });
      }

      const supabase = createClient();
      const { data } = await supabase
        .from('tickets')
        .select('called_at, recall_count')
        .eq('id', ticket.id)
        .single();

      if (data?.called_at && data.called_at !== calledAt) {
        setCalledAt(data.called_at);
        setRecallCount(data.recall_count ?? 0);
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [sandboxMode, ticket.id, ticket.ticket_number, deskName, calledAt]);

  useEffect(() => {
    if (sandboxMode) return;
    const handleVisibility = async () => {
      if (document.visibilityState !== 'visible') return;

      const supabase = createClient();
      const { data } = await supabase
        .from('notifications')
        .select('id')
        .eq('ticket_id', ticket.id)
        .eq('type', 'buzz')
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data?.id && data.id !== lastBuzzNotificationId.current) {
        lastBuzzNotificationId.current = data.id;
        fireBuzz();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [sandboxMode, ticket.id]);

  useEffect(() => {
    const start = calledAt ? new Date(calledAt).getTime() : Date.now();
    const tick = () => {
      const elapsed = Math.floor((Date.now() - start) / 1000);
      const remaining = Math.max(0, CALL_WAIT_SECONDS - elapsed);
      setCountdown(remaining);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [calledAt]);

  useEffect(() => {
    if (sandboxMode) return;
    const ctx = (window as unknown as Record<string, unknown>).__queueAudioCtx as AudioContext | undefined;
    if (ctx) {
      if (ctx.state === 'running') {
        pendingAlert.current = false;
      } else if (ctx.state === 'suspended') {
        ctx.resume().then(() => {
          pendingAlert.current = false;
        }).catch(() => {});
      }
    }
  }, [sandboxMode]);

  useEffect(() => {
    if (sandboxMode) return;
    if (lastAlertedAt.current === calledAt) return;
    lastAlertedAt.current = calledAt;

    fireVibAndSound();

    setTimeout(() => {
      const ctx = (window as unknown as Record<string, unknown>).__queueAudioCtx as AudioContext | undefined;
      if (!ctx || ctx.state === 'suspended') {
        pendingAlert.current = true;
      }
    }, 300);

    if ('Notification' in window && Notification.permission === 'granted' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(async (reg) => {
        try {
          const existing = await reg.getNotifications();
          existing.forEach((notification) => notification.close());
          await reg.showNotification('Your Turn!', {
            body: `Ticket ${ticket.ticket_number} — Please go to ${deskName}`,
            icon: '/icon-192x192.png',
            badge: '/badge-96x96.png',
            tag: `called-${ticket.id}`,
            renotify: true,
            vibrate: [300, 150, 300, 150, 600],
            requireInteraction: true,
          } as NotificationOptions);
        } catch {
          // Ignore.
        }
      });
    }
  }, [sandboxMode, calledAt, ticket.ticket_number, ticket.id, deskName]);

  const backgroundClass = {
    green: 'from-[#1f8758] via-[#1a6f49] to-[#0d4d32]',
    yellow: 'from-[#f1b72b] via-[#dca126] to-[#b97613]',
    red: 'from-[#b42828] via-[#8e1f1f] to-[#5f1414]',
  }[phase];

  const ringClass = {
    green: 'bg-white/12 shadow-[0_0_80px_rgba(16,185,129,0.28)]',
    yellow: 'bg-white/14 shadow-[0_0_80px_rgba(251,191,36,0.28)]',
    red: 'bg-white/14 shadow-[0_0_95px_rgba(244,63,94,0.38)]',
  }[phase];

  const countdownCircleClass = {
    green: 'border-white/30 bg-white/15 text-white',
    yellow: 'border-white/30 bg-white/15 text-white',
    red: 'border-white/30 bg-white/15 text-white',
  }[phase];

  const message =
    countdown === 0
      ? 'Time expired. Please go to the desk immediately.'
      : phase === 'red'
        ? 'Please head over now. Staff is waiting for you.'
        : 'Show this screen if staff asks for your number.';
  const bellShouldRipple = countdown > 0;

  return (
    <div className={`relative flex min-h-screen flex-col overflow-hidden bg-gradient-to-b ${backgroundClass}`}>
      {showBuzzFlash ? (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-red-600">
          <div className="text-center">
            <p className="text-7xl font-black text-white drop-shadow-lg">📳 BUZZ!</p>
            <p className="mt-3 text-xl font-bold text-white">Go to your desk now</p>
          </div>
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.18),_transparent_58%)]" />

      <div className="relative mx-auto flex w-full max-w-md flex-1 flex-col px-4 pb-8 pt-6">
        <div className="flex items-start justify-between gap-3 text-white">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.28em] text-white/80">{officeName}</p>
            <p className="mt-1 text-sm font-medium text-white/65">{serviceName}</p>
            <p className="mt-0.5 text-xs text-white/50">{syncLabel}</p>
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className="rounded-full border border-white/15 bg-white/14 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.22em] text-white/88">
              Ticket {ticket.ticket_number}
            </div>
            <div className="flex items-center gap-2">
              <QueueActionPill
                label="Refresh"
                onClick={() => {
                  void onRefresh();
                }}
                tone="primary"
                disabled={isRefreshing}
                loading={isRefreshing}
              />
              <QueueActionPill label="End" onClick={onStopTracking} tone="danger" />
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-1 flex-col items-center justify-center text-center text-white">
          <div className="relative flex h-32 w-32 items-center justify-center sm:h-36 sm:w-36">
            <div className={`absolute inset-0 rounded-full ${ringClass} ${bellShouldRipple && phase === 'red' ? 'animate-pulse' : ''}`} />
            <div className={`absolute inset-4 rounded-full bg-white/12 ${bellShouldRipple ? 'animate-ping [animation-duration:2.4s]' : ''}`} />
            <div className="absolute inset-9 rounded-full bg-white/18" />
            <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-white/22 shadow-[0_16px_50px_rgba(15,23,42,0.2)] sm:h-24 sm:w-24">
              <svg className="h-11 w-11 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            </div>
          </div>

          <h2 className="mt-6 text-[40px] font-black leading-[0.95] tracking-tight sm:text-5xl">Go to {deskName}</h2>

          {recallCount > 0 ? (
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/12 px-4 py-2 text-sm font-semibold text-white">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Recalled {recallCount} {recallCount === 1 ? 'time' : 'times'}
            </div>
          ) : null}

          <div className={`mt-6 flex h-40 w-40 flex-col items-center justify-center rounded-full border backdrop-blur sm:h-44 sm:w-44 ${countdownCircleClass}`}>
            <p className="mt-2 text-5xl font-black tabular-nums sm:text-6xl">{countdown}</p>
            <p className="mt-2 text-xs font-semibold uppercase tracking-[0.3em] text-white/70">
              {countdown === 0 ? 'Expired' : 'Seconds'}
            </p>
          </div>

          <p className="mt-6 whitespace-nowrap text-base text-white/80">{message}</p>

          <div className="mt-7 w-full rounded-[28px] border border-white/12 bg-black/12 p-5 text-left shadow-[0_25px_90px_rgba(2,6,23,0.2)] backdrop-blur">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15">
                  <Info className="h-5 w-5 text-white/80" />
                </div>
                <div>
                  <p className="text-xs font-medium text-white/55">Where to go</p>
                  <p className="text-base font-semibold text-white">{deskName}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15">
                  <Contact className="h-5 w-5 text-white/80" />
                </div>
                <div>
                  <p className="text-xs font-medium text-white/55">What to show</p>
                  <p className="text-base font-semibold text-white">Ticket {ticket.ticket_number}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15">
                  <Clock className="h-5 w-5 text-white/80" />
                </div>
                <div>
                  <p className="text-xs font-medium text-white/55">What to do now</p>
                  <p className="text-base font-semibold text-white">Walk straight to the desk while the countdown is active.</p>
                </div>
              </div>
            </div>
          </div>

          {stopError ? (
            <div className="mt-4 w-full rounded-2xl border border-rose-200/20 bg-rose-500/14 px-4 py-3 text-sm text-rose-50">
              {stopError}
            </div>
          ) : null}
        </div>

        <div className="pt-6 text-center">
          <p className="text-xs uppercase tracking-[0.28em] text-white/42">Powered by QueueFlow</p>
        </div>
      </div>
    </div>
  );
}
