'use client';

import { useEffect, useRef, useState } from 'react';
import { useRealtimeTicket } from '@/lib/hooks/use-realtime-ticket';
import { YourTurn } from '@/components/queue/your-turn';
import { FeedbackForm } from '@/components/queue/feedback-form';
import { RecallNotification } from '@/components/desk/recall-notification';
import { EditCustomerData } from '@/components/queue/edit-customer-data';
import { createClient } from '@/lib/supabase/client';
import { subscribeToPush } from '@/lib/push';
import { IosInstallPrompt } from '@/components/queue/ios-install-prompt';
import type { Database } from '@/lib/supabase/database.types';

type Ticket = Database['public']['Tables']['tickets']['Row'];

interface QueueStatusProps {
  ticket: Ticket;
  officeName: string;
  serviceName: string;
}

export function QueueStatus({ ticket: initialTicket, officeName, serviceName }: QueueStatusProps) {
  const { ticket, position, estimatedWait, isUpdating } = useRealtimeTicket({
    ticketId: initialTicket.id,
    qrToken: initialTicket.qr_token,
    initialData: initialTicket,
  });

  const [nowServing, setNowServing] = useState<string | null>(null);
  const [deskName, setDeskName] = useState<string | null>(null);
  const [alertsEnabled, setAlertsEnabled] = useState(false);
  const [showIosPrompt, setShowIosPrompt] = useState(false);
  const [showBuzzFlash, setShowBuzzFlash] = useState(false);
  const notificationRequested = useRef(false);

  // ── Buzz handler: aggressive vibration + screen flash ──
  const buzzTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fireBuzz = () => {
    // Aggressive vibration
    if ('vibrate' in navigator) {
      navigator.vibrate([800, 200, 800, 200, 800, 200, 800, 200, 800]);
    }
    // Rapid screen flash: toggle on/off every 200ms for 3 seconds
    let flashes = 0;
    const maxFlashes = 15; // 15 toggles = ~3 seconds
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

  // Listen for buzz via service worker postMessage (backup path)
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'buzz' && event.data?.ticketId === ticket.id) {
        fireBuzz();
      }
    };
    navigator.serviceWorker?.addEventListener('message', handler);
    return () => { navigator.serviceWorker?.removeEventListener('message', handler); };
  }, [ticket.id]);

  // Fetch "now serving" ticket for context
  useEffect(() => {
    const fetchNowServing = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('tickets')
        .select('ticket_number')
        .eq('department_id', ticket.department_id)
        .eq('office_id', ticket.office_id)
        .in('status', ['serving', 'called'])
        .order('called_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) {
        setNowServing(data.ticket_number);
      }
    };

    fetchNowServing();
    const interval = setInterval(fetchNowServing, 15000);
    return () => clearInterval(interval);
  }, [ticket.department_id, ticket.office_id]);

  // Fetch desk name when ticket is called
  useEffect(() => {
    if (ticket.status === 'called' && ticket.desk_id) {
      const fetchDesk = async () => {
        const supabase = createClient();
        const { data } = await supabase
          .from('desks')
          .select('name, display_name')
          .eq('id', ticket.desk_id!)
          .single();

        if (data) {
          setDeskName(data.display_name ?? data.name);
        }
      };
      fetchDesk();
    }
  }, [ticket.status, ticket.desk_id]);

  // Detect iOS and PWA status
  const isIos = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isInStandaloneMode = typeof window !== 'undefined' && (
    (window.navigator as any).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  );
  const iosPushSupported = isIos ? isInStandaloneMode : true;

  // Register service worker on mount + auto-subscribe if permission already granted
  useEffect(() => {
    if (!notificationRequested.current) {
      notificationRequested.current = true;

      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw-notify.js').catch((err) => {
          console.error('[SW] Registration failed:', err.message);
        });
      }

      // If permission already granted (from previous visit), auto-subscribe to push
      if ('Notification' in window && Notification.permission === 'granted') {
        setAlertsEnabled(true);
        subscribeToPush(ticket.id).catch((err) => {
          console.error('[Push] Auto-subscribe failed:', err);
        });
      }

      // iOS in standalone mode: auto-enable alerts immediately (they installed the app!)
      if (isIos && isInStandaloneMode && 'Notification' in window && Notification.permission === 'default') {
        // Small delay so the page renders first, then trigger permission
        setTimeout(() => {
          handleEnableAlerts();
        }, 800);
      }

      // iOS in Safari (not standalone): auto-show install prompt after brief delay
      // so users don't have to find the "Enable Alerts" button
      if (isIos && !isInStandaloneMode && !('Notification' in window && Notification.permission === 'granted')) {
        const dismissed = sessionStorage.getItem('ios-install-dismissed');
        if (!dismissed) {
          setTimeout(() => {
            setShowIosPrompt(true);
          }, 2000);
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket.id]);

  // Re-subscribe on visibility change (iOS aggressively kills service workers)
  useEffect(() => {
    if (!alertsEnabled) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && 'Notification' in window && Notification.permission === 'granted') {
        console.log('[Push] Re-subscribing after visibility change');
        subscribeToPush(ticket.id).catch((err) => {
          console.error('[Push] Visibility re-subscribe failed:', err);
        });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [alertsEnabled, ticket.id]);

  // Re-subscribe to push when ticket is called (subscription may have expired since initial)
  // This ensures recall push works even if the original subscription went stale
  const lastResubscribeStatus = useRef<string | null>(null);
  useEffect(() => {
    if (
      ticket.status === 'called' &&
      lastResubscribeStatus.current !== 'called' &&
      alertsEnabled &&
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      console.log('[Push] Re-subscribing on call for fresh endpoint');
      subscribeToPush(ticket.id).catch((err) => {
        console.error('[Push] Re-subscribe on call failed:', err);
      });
    }
    lastResubscribeStatus.current = ticket.status;
  }, [ticket.status, ticket.id, alertsEnabled]);

  // Enable alerts: request permission + unlock audio + test vibration
  const handleEnableAlerts = async () => {
    // iOS: if not in PWA mode, show install prompt instead
    if (isIos && !isInStandaloneMode) {
      setShowIosPrompt(true);
      return;
    }

    // 1. Request notification permission (user taps Allow in browser prompt)
    if ('Notification' in window && Notification.permission === 'default') {
      const result = await Notification.requestPermission();
      if (result !== 'granted') {
        setAlertsEnabled(true);
        return;
      }
    }

    // 2. Unlock AudioContext with user gesture (stored globally for YourTurn)
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.01, ctx.currentTime);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.05);
      (window as unknown as Record<string, unknown>).__queueAudioCtx = ctx;
    } catch {
      // AudioContext not available
    }

    // 3. Subscribe to Web Push (for background notifications)
    try {
      await subscribeToPush(ticket.id);
    } catch (err) {
      console.error('[Push] Subscribe failed:', err);
    }

    // 4. Test vibration
    if ('vibrate' in navigator) {
      navigator.vibrate([150, 80, 150]);
    }

    setAlertsEnabled(true);
  };

  // If ticket status changed to 'called', transition to YourTurn
  // YourTurn fetches its own desk name on mount, so pass whatever we have
  if (ticket.status === 'called') {
    return <YourTurn ticket={ticket} deskName={deskName ?? ''} />;
  }

  // If ticket status changed to 'serving'
  if (ticket.status === 'serving') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-primary/5 p-4">
        <div className="w-full max-w-sm text-center">
          <div className="rounded-xl bg-card p-8 shadow-lg">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <svg className="h-8 w-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <h1 className="mb-2 text-2xl font-bold">Being Served</h1>
            <p className="text-muted-foreground">You are currently being attended to.</p>
          </div>
        </div>
      </div>
    );
  }

  // If ticket is served, show feedback
  if (ticket.status === 'served') {
    return <FeedbackForm ticket={ticket} officeName={officeName} serviceName={serviceName} />;
  }

  const progressPercent =
    position !== null && position > 0
      ? Math.max(5, Math.min(95, ((10 - position) / 10) * 100))
      : 5;

  return (
    <div className="flex min-h-screen flex-col bg-muted relative">
      {/* Buzz flash overlay — full-screen strobe */}
      {showBuzzFlash && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-red-600 pointer-events-none">
          <div className="text-center">
            <p className="text-7xl font-black text-white drop-shadow-lg">📳 BUZZ!</p>
            <p className="mt-3 text-xl font-bold text-white">Attention needed!</p>
          </div>
        </div>
      )}

      {/* Recall notification overlay */}
      <RecallNotification
        ticketId={ticket.id}
        ticketNumber={ticket.ticket_number}
        officeId={ticket.office_id}
      />

      {/* Header */}
      <div className="bg-primary px-4 pb-6 pt-6 text-primary-foreground">
        <div className="mx-auto max-w-sm">
          <p className="text-sm font-medium opacity-80">{officeName}</p>
          <p className="text-xs opacity-60">{serviceName}</p>
        </div>
      </div>

      {/* Main content */}
      <div className="mx-auto w-full max-w-sm flex-1 px-4">
        {/* Ticket number card - overlapping header */}
        <div className="-mt-8 mb-6 rounded-xl bg-card p-6 text-center shadow-lg">
          <p className="mb-1 text-sm font-medium text-muted-foreground">Your Ticket</p>
          <p className="text-5xl font-extrabold tracking-wider text-primary">
            {ticket.ticket_number}
          </p>
          {isUpdating && (
            <div className="mt-2 flex items-center justify-center gap-1.5">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              <span className="text-xs text-muted-foreground">Updating...</span>
            </div>
          )}
        </div>

        {/* Position in queue */}
        <div className="mb-4 rounded-xl bg-card p-5 shadow-sm">
          <div className="mb-4 text-center">
            {position !== null ? (
              <>
                <p className="text-sm font-medium text-muted-foreground">Your position</p>
                <p className="mt-1 text-4xl font-extrabold text-foreground">
                  #{position}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">in line</p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-muted-foreground">Position</p>
                <div className="mt-2 flex justify-center">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              </>
            )}
          </div>

          {/* Progress bar */}
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-1000 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="mt-2 flex justify-between text-xs text-muted-foreground">
            <span>Joined</span>
            <span>Your turn</span>
          </div>
        </div>

        {/* Wait time and now serving */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-card p-4 text-center shadow-sm">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Est. Wait</p>
            {estimatedWait !== null ? (
              <p className="text-2xl font-bold text-foreground">
                {estimatedWait}
                <span className="text-sm font-normal text-muted-foreground"> min</span>
              </p>
            ) : (
              <p className="text-lg font-semibold text-muted-foreground">--</p>
            )}
          </div>

          <div className="rounded-xl bg-card p-4 text-center shadow-sm">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Now Serving</p>
            {nowServing ? (
              <p className="text-2xl font-bold text-foreground">{nowServing}</p>
            ) : (
              <p className="text-lg font-semibold text-muted-foreground">--</p>
            )}
          </div>
        </div>

        {/* Edit customer data */}
        <div className="mt-4">
          <EditCustomerData ticket={ticket} />
        </div>

        {/* Enable alerts banner */}
        {!alertsEnabled && (
          <button
            onClick={handleEnableAlerts}
            className="mt-4 w-full rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 p-4 shadow-lg shadow-blue-500/20 active:scale-[0.98] transition-transform"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/20">
                <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-bold text-white">
                  {isIos && !isInStandaloneMode
                    ? 'Get Notified When Called'
                    : "Don't Miss Your Turn!"}
                </p>
                <p className="mt-0.5 text-xs text-blue-100">
                  {isIos && !isInStandaloneMode
                    ? 'Tap to set up push notifications'
                    : 'Enable alerts for sound & vibration'}
                </p>
              </div>
              <svg className="h-5 w-5 text-white/70 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        )}
        {alertsEnabled && (
          <div className="mt-4 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3">
            <div className="flex items-center gap-2">
              <svg className="h-4 w-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <p className="text-sm font-medium text-emerald-700">Alerts enabled — we&apos;ll notify you</p>
            </div>
          </div>
        )}
        {/* iOS install prompt — full-screen overlay */}
        {showIosPrompt && (
          <IosInstallPrompt
            onDismiss={() => {
              setShowIosPrompt(false);
              sessionStorage.setItem('ios-install-dismissed', '1');
            }}
          />
        )}

        {/* Waiting animation */}
        <div className="mt-6 flex flex-col items-center py-4">
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-primary [animation-delay:0ms]" />
            <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-primary [animation-delay:150ms]" />
            <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-primary [animation-delay:300ms]" />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">Waiting for your turn...</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Keep this page open. We&apos;ll notify you.
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 pb-6 pt-4 text-center">
        <p className="text-xs text-muted-foreground">
          Powered by QueueFlow
        </p>
      </div>
    </div>
  );
}
