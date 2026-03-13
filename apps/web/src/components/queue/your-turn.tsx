'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { subscribeToPush } from '@/lib/push';
import type { Database } from '@/lib/supabase/database.types';

type Ticket = Database['public']['Tables']['tickets']['Row'];

interface YourTurnProps {
  ticket: Ticket;
  deskName: string;
}

const WAIT_SECONDS = 60;

function calcRemaining(calledAt: string | null) {
  if (!calledAt) return WAIT_SECONDS;
  const elapsed = Math.floor((Date.now() - new Date(calledAt).getTime()) / 1000);
  return Math.max(0, WAIT_SECONDS - elapsed);
}

export function YourTurn({ ticket, deskName: initialDeskName }: YourTurnProps) {
  const [deskName, setDeskName] = useState(initialDeskName);
  const [countdown, setCountdown] = useState(() => calcRemaining(ticket.called_at));
  const [calledAt, setCalledAt] = useState(ticket.called_at);
  const lastAlertedAt = useRef<string | null>(null);
  const [recallCount, setRecallCount] = useState(ticket.recall_count ?? 0);
  const [showBuzzFlash, setShowBuzzFlash] = useState(false);
  const [soundUnlocked, setSoundUnlocked] = useState(() => {
    // Check if AudioContext was already unlocked on the waiting page
    if (typeof window !== 'undefined') {
      const ctx = (window as unknown as Record<string, unknown>).__queueAudioCtx as AudioContext | undefined;
      return !!ctx && ctx.state === 'running';
    }
    return false;
  });
  const pendingAlert = useRef(true); // Start true so first tap plays sound

  // Phase: green (>30), yellow (10-30), red (<=10)
  const phase = countdown > 30 ? 'green' : countdown > 10 ? 'yellow' : 'red';

  // Play vibration + sound
  const fireVibAndSound = () => {
    try {
      if ('vibrate' in navigator) {
        navigator.vibrate([500, 200, 500, 200, 500]);
      }
    } catch { /* ignore */ }

    try {
      const ctx = ((window as unknown as Record<string, unknown>).__queueAudioCtx as AudioContext) || new AudioContext();
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
    } catch { /* ignore */ }
  };

  // Fetch actual desk name if we got the fallback
  useEffect(() => {
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
  }, [ticket.desk_id]);

  // Register SW on mount, subscribe to push if already granted
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw-notify.js').catch(() => {});
    }
    if ('Notification' in window && Notification.permission === 'granted') {
      subscribeToPush(ticket.id).catch(() => {});
    }
  }, [ticket.id]);

  // Unlock sound + request notification permission (triggered by explicit button tap)
  const enableAlerts = async () => {
    // 1. Unlock AudioContext
    try {
      let ctx = (window as unknown as Record<string, unknown>).__queueAudioCtx as AudioContext | undefined;
      if (!ctx) {
        ctx = new AudioContext();
        (window as unknown as Record<string, unknown>).__queueAudioCtx = ctx;
      }
      if (ctx.state === 'suspended') await ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.01);
    } catch { /* ignore */ }

    // 2. Request notification permission (only if not yet asked)
    if ('Notification' in window && Notification.permission === 'default') {
      const result = await Notification.requestPermission();
      if (result === 'granted') {
        await subscribeToPush(ticket.id).catch(() => {});
      }
    }

    // 3. Play the alert sound now
    setSoundUnlocked(true);
    fireVibAndSound();
  };

  // On any tap: unlock AudioContext and replay pending alerts
  useEffect(() => {
    const handleTouch = () => {
      // 1. Unlock or resume AudioContext (needs gesture)
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
          setSoundUnlocked(true);
        } catch { /* ignore */ }
      } else if (ctx.state === 'suspended') {
        ctx.resume().then(() => setSoundUnlocked(true)).catch(() => {});
      } else {
        setSoundUnlocked(true);
      }

      // 2. Replay pending alert (sound failed earlier because AudioContext was suspended)
      if (pendingAlert.current) {
        pendingAlert.current = false;
        setTimeout(() => {
          try {
            const c = (window as unknown as Record<string, unknown>).__queueAudioCtx as AudioContext;
            if (c && c.state === 'running') {
              const playTone = (freq: number, startAt: number, duration: number) => {
                const osc = c.createOscillator();
                const gain = c.createGain();
                osc.connect(gain);
                gain.connect(c.destination);
                osc.frequency.value = freq;
                osc.type = 'sine';
                gain.gain.setValueAtTime(0.5, c.currentTime + startAt);
                gain.gain.exponentialRampToValueAtTime(0.01, c.currentTime + startAt + duration);
                osc.start(c.currentTime + startAt);
                osc.stop(c.currentTime + startAt + duration);
              };
              playTone(880, 0, 0.3);
              playTone(1100, 0.35, 0.3);
              playTone(1320, 0.7, 0.5);
            }
          } catch { /* ignore */ }
          try {
            if ('vibrate' in navigator) navigator.vibrate([500, 200, 500, 200, 500]);
          } catch { /* ignore */ }
        }, 100);
      }

      // 3. Ensure push subscription exists if already granted
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
  }, []);

  // ── Buzz handler: aggressive vibration + screen flash ──
  const buzzTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fireBuzz = () => {
    if ('vibrate' in navigator) {
      navigator.vibrate([800, 200, 800, 200, 800, 200, 800, 200, 800]);
    }
    // Rapid screen flash: toggle on/off every 200ms for 3 seconds
    let flashes = 0;
    const maxFlashes = 15;
    if (buzzTimerRef.current) clearInterval(buzzTimerRef.current);
    setShowBuzzFlash(true);
    buzzTimerRef.current = setInterval(() => {
      flashes++;
      if (flashes >= maxFlashes) {
        if (buzzTimerRef.current) clearInterval(buzzTimerRef.current);
        buzzTimerRef.current = null;
        setShowBuzzFlash(false);
        return;
      }
      setShowBuzzFlash((prev) => !prev);
    }, 200);
  };

  // Listen for recall broadcasts
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`recall-${ticket.office_id}`)
      .on('broadcast', { event: 'ticket_recall' }, (payload) => {
        if (payload.payload?.ticket_id === ticket.id) {
          setCalledAt(new Date().toISOString());
          setRecallCount((c) => c + 1);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [ticket.id, ticket.office_id]);

  // Listen for buzz via Supabase Realtime broadcast
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`buzz-${ticket.office_id}`)
      .on('broadcast', { event: 'ticket_buzz' }, (payload) => {
        if (payload.payload?.ticket_id === ticket.id) {
          fireBuzz();
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [ticket.id, ticket.office_id]);

  // Listen for buzz via service worker postMessage
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'buzz' && event.data?.ticketId === ticket.id) {
        fireBuzz();
      }
    };
    navigator.serviceWorker?.addEventListener('message', handler);
    return () => { navigator.serviceWorker?.removeEventListener('message', handler); };
  }, [ticket.id]);

  // When page regains focus: mark pending alert so next tap replays, check for missed recalls
  useEffect(() => {
    const handleVisibility = async () => {
      if (document.visibilityState !== 'visible') return;

      // 1. Mark alert as pending — Chrome Android requires user gesture for sound+vibration
      //    The touch/click handler will replay it on the very next tap
      pendingAlert.current = true;

      // 2. Try vibration (may work without gesture on some devices)
      try {
        if ('vibrate' in navigator) navigator.vibrate([500, 200, 500, 200, 500]);
      } catch { /* ignore */ }

      // 3. Show a SW notification (works without gesture, gets user's attention)
      if ('Notification' in window && Notification.permission === 'granted' && 'serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(async (reg) => {
          try {
            await reg.showNotification('Your Turn!', {
              body: `Ticket ${ticket.ticket_number} — Please go to ${deskName}`,
              icon: '/favicon.ico',
              tag: `called-${ticket.id}`,
              renotify: true,
              vibrate: [300, 150, 300, 150, 600],
              requireInteraction: false,
            } as NotificationOptions);
          } catch { /* ignore */ }
        });
      }

      // 4. Check for missed recalls (broadcast may not have arrived while backgrounded)
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
  }, [ticket.id, calledAt, ticket.ticket_number, deskName]);

  // 60-second countdown from when called
  useEffect(() => {
    const start = calledAt ? new Date(calledAt).getTime() : Date.now();
    const tick = () => {
      const elapsed = Math.floor((Date.now() - start) / 1000);
      const remaining = Math.max(0, WAIT_SECONDS - elapsed);
      setCountdown(remaining);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [calledAt]);

  // Resume AudioContext if suspended (one-time on mount)
  useEffect(() => {
    const ctx = (window as unknown as Record<string, unknown>).__queueAudioCtx as AudioContext | undefined;
    if (ctx) {
      if (ctx.state === 'running') {
        setSoundUnlocked(true);
        pendingAlert.current = false; // No need — sound will play directly
      } else if (ctx.state === 'suspended') {
        ctx.resume().then(() => {
          setSoundUnlocked(true);
          pendingAlert.current = false;
        }).catch(() => {});
      }
    }
  }, []);

  // Fire alerts on initial load and every recall (calledAt change)
  useEffect(() => {
    if (lastAlertedAt.current === calledAt) return;
    lastAlertedAt.current = calledAt;

    // Sound + vibration
    fireVibAndSound();

    // If AudioContext couldn't play (suspended), mark as pending for next tap
    setTimeout(() => {
      const ctx = (window as unknown as Record<string, unknown>).__queueAudioCtx as AudioContext | undefined;
      if (!ctx || ctx.state === 'suspended') {
        pendingAlert.current = true;
      }
    }, 300);

    // SW notification
    if ('Notification' in window && Notification.permission === 'granted' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(async (reg) => {
        try {
          const existing = await reg.getNotifications();
          existing.forEach((n) => n.close());
          await reg.showNotification('Your Turn!', {
            body: `Ticket ${ticket.ticket_number} — Please go to ${deskName}`,
            icon: '/favicon.ico',
            tag: `called-${ticket.id}`,
            renotify: true,
            vibrate: [300, 150, 300, 150, 600],
            requireInteraction: true,
          } as NotificationOptions);
        } catch { /* ignore */ }
      });
    }
  }, [calledAt, ticket.ticket_number, deskName]);

  // Background color per phase
  const bgColor = {
    green: 'bg-emerald-600',
    yellow: 'bg-amber-500',
    red: 'bg-red-700',
  }[phase];

  const circleClass = {
    green: 'bg-white shadow-xl',
    yellow: 'bg-white shadow-xl',
    red: 'bg-white shadow-[0_0_40px_rgba(239,68,68,0.4)]',
  }[phase];

  const numberColor = {
    green: 'text-emerald-700',
    yellow: 'text-amber-600',
    red: 'text-red-700',
  }[phase];

  const labelColor = {
    green: 'text-emerald-600/70',
    yellow: 'text-amber-500/70',
    red: 'text-red-700/70',
  }[phase];

  const message =
    countdown === 0
      ? 'Time expired — please hurry to the desk!'
      : phase === 'red'
        ? 'Hurry! Time is running out!'
        : 'Please proceed to the desk now';

  return (
    <div
      suppressHydrationWarning
      className={`flex min-h-screen flex-col items-center justify-center p-4 transition-colors duration-700 ${bgColor} relative`}
    >
      {/* Buzz flash overlay — full-screen strobe */}
      {showBuzzFlash && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-red-600 pointer-events-none">
          <div className="text-center">
            <p className="text-7xl font-black text-white drop-shadow-lg">📳 BUZZ!</p>
            <p className="mt-3 text-xl font-bold text-white">Go to your desk NOW!</p>
          </div>
        </div>
      )}
      <div
        className="w-full max-w-sm text-center"
        style={
          phase === 'green'
            ? { animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' }
            : undefined
        }
      >
        {/* Attention icon */}
        <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-white/30 shadow-[0_0_60px_rgba(255,255,255,0.4)]">
          <svg
            className="h-12 w-12 text-white"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.5}
              d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
            />
          </svg>
        </div>

        {/* YOUR TURN text */}
        <h1 className="mb-4 text-5xl font-black tracking-tight text-white drop-shadow-lg">
          YOUR TURN!
        </h1>

        {/* Ticket number */}
        <div className="mx-auto mb-6 rounded-2xl bg-white/95 px-8 py-4 shadow-xl">
          <p className="text-sm font-medium text-gray-500">Ticket</p>
          <p className="text-5xl font-extrabold tracking-wider text-gray-900">
            {ticket.ticket_number}
          </p>
        </div>

        {/* Go to desk */}
        <div className="mx-auto rounded-2xl bg-white/95 px-6 py-5 shadow-xl">
          <p className="text-sm font-medium text-gray-500">Please go to</p>
          <div className="mt-1 flex items-center justify-center gap-2">
            <svg
              className="h-6 w-6 text-gray-700"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            <p className="text-3xl font-bold text-gray-900">
              {deskName}
            </p>
          </div>
        </div>

        {/* Sound hint — shows until user taps anywhere on the page */}
        {!soundUnlocked && (
          <button
            onClick={enableAlerts}
            className="mx-auto mt-6 flex items-center gap-2 rounded-xl bg-white/90 px-6 py-3 shadow-lg active:scale-95 transition-transform animate-bounce"
          >
            <svg className="h-5 w-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            </svg>
            <span className="text-sm font-bold text-gray-800">Tap for Sound</span>
          </button>
        )}

        {/* Recall banner */}
        {recallCount > 0 && (
          <div className="mx-auto mt-6 rounded-xl bg-white/20 px-5 py-3 backdrop-blur-sm">
            <p className="text-sm font-bold text-white">
              You&apos;ve been recalled {recallCount} {recallCount === 1 ? 'time' : 'times'}
            </p>
          </div>
        )}

        {/* Countdown timer */}
        <div
          suppressHydrationWarning
          className={`mx-auto mt-8 w-36 h-36 rounded-full flex flex-col items-center justify-center transition-all duration-500 ${circleClass} ${
            phase === 'red' ? 'animate-pulse' : ''
          }`}
        >
          <span suppressHydrationWarning className={`text-5xl font-mono font-black leading-none ${numberColor}`}>
            {countdown}
          </span>
          <span suppressHydrationWarning className={`mt-1 text-xs font-semibold uppercase tracking-wider ${labelColor}`}>
            {countdown === 0 ? 'EXPIRED' : 'seconds'}
          </span>
        </div>
        <p suppressHydrationWarning className="mt-3 text-sm font-semibold text-white drop-shadow">
          {message}
        </p>
      </div>

      {/* Pulsing rings behind the main content (green phase only) */}
      {phase === 'green' && (
        <div className="pointer-events-none fixed inset-0 flex items-center justify-center">
          <div className="absolute h-64 w-64 animate-ping rounded-full bg-white/5 [animation-duration:2s]" />
          <div className="absolute h-96 w-96 animate-ping rounded-full bg-white/5 [animation-delay:500ms] [animation-duration:2s]" />
        </div>
      )}

      {/* Footer */}
      <div className="mt-auto px-4 pb-6 pt-8 text-center">
        <p className="text-xs text-white/70">
          Powered by QueueFlow
        </p>
      </div>
    </div>
  );
}
