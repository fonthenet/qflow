'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRealtimeTicket } from '@/lib/hooks/use-realtime-ticket';
import { YourTurn } from '@/components/queue/your-turn';
import { FeedbackForm } from '@/components/queue/feedback-form';
import { RecallNotification } from '@/components/desk/recall-notification';
import { EditCustomerData } from '@/components/queue/edit-customer-data';
import { PriorityAlertSetup } from '@/components/queue/priority-alert-setup';
import { QueueSessionEnded } from '@/components/queue/queue-session-ended';
import { QueueStopDialog } from '@/components/queue/queue-stop-dialog';
import { createClient } from '@/lib/supabase/client';
import { subscribeToPush } from '@/lib/push';
import { stopTicketTracking } from '@/lib/tracking';
import { IosInstallPrompt } from '@/components/queue/ios-install-prompt';
import type { Database } from '@/lib/supabase/database.types';
import type { PriorityAlertConfig } from '@/lib/priority-alerts';

type Ticket = Database['public']['Tables']['tickets']['Row'];
type NotificationRow = Database['public']['Tables']['notifications']['Row'];

interface QueueStatusProps {
  ticket: Ticket;
  officeName: string;
  serviceName: string;
  priorityAlertConfig?: PriorityAlertConfig | null;
}

function formatSyncLabel(date: Date | null) {
  if (!date) return 'Syncing live updates';
  return `Updated ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

function progressPercent(position: number | null) {
  if (!position || position <= 1) return 0.92;
  return Math.max(0.08, Math.min(0.92, (14 - Math.min(position, 14)) / 14));
}

function playBuzzSound() {
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
        gain.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + startAt + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + startAt + duration);
        osc.start(ctx.currentTime + startAt);
        osc.stop(ctx.currentTime + startAt + duration);
      };

      pulse(190, 0.0, 0.16);
      pulse(240, 0.22, 0.16);
      pulse(190, 0.44, 0.16);
      pulse(240, 0.66, 0.16);
    };

    if (ctx.state === 'suspended') {
      ctx.resume().then(schedulePattern).catch(() => {});
    } else {
      schedulePattern();
    }
  } catch {
    // Best-effort only.
  }
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
    secondary: 'border-white/10 bg-white/8 text-white hover:bg-white/12',
    danger: 'border-rose-400/25 bg-rose-500/15 text-rose-100 hover:bg-rose-500/20',
    primary: 'border-sky-400/20 bg-sky-500/15 text-sky-50 hover:bg-sky-500/20',
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-full border px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${toneClass}`}
    >
      {loading ? 'Working...' : label}
    </button>
  );
}

function WaitingMetric({
  label,
  value,
  detail,
  accentClass,
}: {
  label: string;
  value: string;
  detail: string;
  accentClass: string;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/6 p-4 shadow-[0_20px_40px_rgba(2,6,23,0.18)] backdrop-blur">
      <div className={`mb-3 inline-flex rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] ${accentClass}`}>
        {label}
      </div>
      <p className="text-3xl font-semibold tracking-tight text-white">{value}</p>
      <p className="mt-2 text-sm leading-6 text-slate-300">{detail}</p>
    </div>
  );
}

function JourneyStep({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-[20px] border border-white/8 bg-white/5 p-4">
      <div className="mt-1 h-2.5 w-2.5 rounded-full bg-cyan-300 shadow-[0_0_14px_rgba(34,211,238,0.6)]" />
      <div>
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="mt-1 text-sm leading-6 text-slate-300">{detail}</p>
      </div>
    </div>
  );
}

export function QueueStatus({
  ticket: initialTicket,
  officeName,
  serviceName,
  priorityAlertConfig,
}: QueueStatusProps) {
  const {
    ticket,
    position,
    estimatedWait,
    isUpdating,
    lastSyncedAt,
    refresh,
  } = useRealtimeTicket({
    ticketId: initialTicket.id,
    qrToken: initialTicket.qr_token,
    initialData: initialTicket,
  });

  const [nowServing, setNowServing] = useState<string | null>(null);
  const [deskName, setDeskName] = useState<string | null>(null);
  const [alertsEnabled, setAlertsEnabled] = useState(false);
  const [showIosPrompt, setShowIosPrompt] = useState(false);
  const [showBuzzFlash, setShowBuzzFlash] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showStopDialog, setShowStopDialog] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [trackingStopped, setTrackingStopped] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const notificationRequested = useRef(false);
  const lastBuzzNotificationId = useRef<string | null>(null);
  const buzzTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isIos = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isInStandaloneMode = typeof window !== 'undefined' && (
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  );

  const syncLabel = useMemo(() => {
    if (isUpdating || isRefreshing) return 'Syncing now';
    return formatSyncLabel(lastSyncedAt);
  }, [isRefreshing, isUpdating, lastSyncedAt]);

  const fireBuzz = () => {
    if ('vibrate' in navigator) {
      navigator.vibrate([800, 200, 800, 200, 800, 200, 800, 200, 800]);
    }

    let flashes = 0;
    const maxFlashes = 15;
    if (buzzTimerRef.current) clearInterval(buzzTimerRef.current);
    setShowBuzzFlash(true);
    playBuzzSound();

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

    setNowServing(data?.ticket_number ?? null);
  };

  const fetchDeskName = async () => {
    if (!ticket.desk_id) {
      setDeskName(null);
      return;
    }

    const supabase = createClient();
    const { data } = await supabase
      .from('desks')
      .select('name, display_name')
      .eq('id', ticket.desk_id)
      .single();

    setDeskName(data?.display_name ?? data?.name ?? null);
  };

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        refresh(),
        fetchNowServing(),
        ticket.status === 'called' ? fetchDeskName() : Promise.resolve(),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleStopTracking = async () => {
    setIsStopping(true);
    setStopError(null);

    try {
      const stopped = await stopTicketTracking(ticket.id);
      if (!stopped) {
        setStopError('We could not stop tracking just yet. Please try again.');
        return;
      }

      setTrackingStopped(true);
    } finally {
      setIsStopping(false);
      setShowStopDialog(false);
    }
  };

  const handleFeedbackDone = async () => {
    await handleStopTracking();
  };

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

    return () => {
      supabase.removeChannel(channel);
    };
  }, [ticket.id, ticket.office_id]);

  useEffect(() => {
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
  }, [ticket.id]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'buzz' && event.data?.ticketId === ticket.id) {
        fireBuzz();
      }
    };

    navigator.serviceWorker?.addEventListener('message', handler);
    return () => {
      navigator.serviceWorker?.removeEventListener('message', handler);
    };
  }, [ticket.id]);

  useEffect(() => {
    return () => {
      if (buzzTimerRef.current) clearInterval(buzzTimerRef.current);
    };
  }, []);

  useEffect(() => {
    void fetchNowServing();
    const interval = setInterval(fetchNowServing, 15000);
    return () => clearInterval(interval);
  }, [ticket.department_id, ticket.office_id]);

  useEffect(() => {
    if (ticket.status === 'called' && ticket.desk_id) {
      void fetchDeskName();
    }
  }, [ticket.status, ticket.desk_id]);

  useEffect(() => {
    if (!notificationRequested.current) {
      notificationRequested.current = true;

      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw-notify.js').catch((err) => {
          console.error('[SW] Registration failed:', err.message);
        });
      }

      if ('Notification' in window && Notification.permission === 'granted') {
        setAlertsEnabled(true);
        subscribeToPush(ticket.id).catch((err) => {
          console.error('[Push] Auto-subscribe failed:', err);
        });
      }

      if (isIos && isInStandaloneMode && 'Notification' in window && Notification.permission === 'default') {
        setTimeout(() => {
          void handleEnableAlerts();
        }, 800);
      }

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

  useEffect(() => {
    if (!alertsEnabled) return;

    const handleVisibilityChange = () => {
      if (
        document.visibilityState === 'visible' &&
        'Notification' in window &&
        Notification.permission === 'granted'
      ) {
        subscribeToPush(ticket.id).catch((err) => {
          console.error('[Push] Visibility re-subscribe failed:', err);
        });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [alertsEnabled, ticket.id]);

  useEffect(() => {
    const handleVisibilityChange = async () => {
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

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [ticket.id]);

  const lastResubscribeStatus = useRef<string | null>(null);
  useEffect(() => {
    if (
      ticket.status === 'called' &&
      lastResubscribeStatus.current !== 'called' &&
      alertsEnabled &&
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      subscribeToPush(ticket.id).catch((err) => {
        console.error('[Push] Re-subscribe on call failed:', err);
      });
    }
    lastResubscribeStatus.current = ticket.status;
  }, [ticket.status, ticket.id, alertsEnabled]);

  const handleEnableAlerts = async () => {
    if (isIos && !isInStandaloneMode) {
      setShowIosPrompt(true);
      return;
    }

    if ('Notification' in window && Notification.permission === 'default') {
      const result = await Notification.requestPermission();
      if (result !== 'granted') {
        setAlertsEnabled(true);
        return;
      }
    }

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
      // Ignore unlock failures.
    }

    try {
      await subscribeToPush(ticket.id);
    } catch (err) {
      console.error('[Push] Subscribe failed:', err);
    }

    if ('vibrate' in navigator) {
      navigator.vibrate([150, 80, 150]);
    }

    setAlertsEnabled(true);
  };

  if (trackingStopped) {
    return (
      <QueueSessionEnded
        detail={`Ticket ${ticket.ticket_number} no longer has live updates on this device.`}
        onResume={() => window.location.reload()}
      />
    );
  }

  if (ticket.status === 'called') {
    return (
      <YourTurn
        ticket={ticket}
        deskName={deskName ?? ''}
        officeName={officeName}
        serviceName={serviceName}
        lastSyncedAt={lastSyncedAt}
        isRefreshing={isRefreshing}
        onRefresh={handleManualRefresh}
        onStopTracking={() => setShowStopDialog(true)}
      />
    );
  }

  if (ticket.status === 'served') {
    return (
      <>
        <FeedbackForm
          ticket={ticket}
          officeName={officeName}
          serviceName={serviceName}
          onDone={handleFeedbackDone}
          onStopTracking={() => setShowStopDialog(true)}
        />
        <QueueStopDialog
          isOpen={showStopDialog}
          isStopping={isStopping}
          onCancel={() => setShowStopDialog(false)}
          onConfirm={() => void handleStopTracking()}
          title="Finish this visit?"
          description="We’ll clear this completed visit from this device and stop any remaining alerts."
          confirmLabel="Finish visit"
        />
      </>
    );
  }

  if (ticket.status === 'serving') {
    return (
      <>
        <div className="flex min-h-screen flex-col bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.18),_transparent_38%),linear-gradient(180deg,_#020617_0%,_#0f172a_100%)] px-4 py-8">
          <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">{officeName}</p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">{serviceName}</h1>
                <p className="mt-2 text-sm text-slate-300">{syncLabel}</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <QueueActionPill
                  label="Refresh"
                  onClick={() => void handleManualRefresh()}
                  tone="primary"
                  disabled={isRefreshing}
                  loading={isRefreshing}
                />
                <QueueActionPill label="End" onClick={() => setShowStopDialog(true)} tone="danger" />
              </div>
            </div>

            <div className="mt-8 rounded-[34px] border border-white/10 bg-slate-950/82 p-7 text-center shadow-[0_30px_110px_rgba(15,23,42,0.58)] backdrop-blur">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[26px] bg-sky-400/12 text-sky-100 shadow-[0_20px_60px_rgba(56,189,248,0.22)]">
                <svg className="h-10 w-10" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>

              <div className="mt-6 rounded-full bg-sky-400/12 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-sky-100">
                With staff now
              </div>

              <h2 className="mt-5 text-3xl font-semibold tracking-tight text-white">You are being served</h2>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                Stay with the staff member at {deskName ?? 'your desk'}. You can finish this visit after your service is complete.
              </p>

              <div className="mt-7 grid gap-3 sm:grid-cols-2">
                <WaitingMetric
                  label="Ticket"
                  value={ticket.ticket_number}
                  detail="Keep this visible in case the team asks for your number again."
                  accentClass="bg-sky-400/15 text-sky-100"
                />
                <WaitingMetric
                  label="Desk"
                  value={deskName ?? 'Assigned'}
                  detail="This is the current service point handling your visit."
                  accentClass="bg-emerald-400/15 text-emerald-100"
                />
              </div>
            </div>

            {stopError ? (
              <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                {stopError}
              </div>
            ) : null}

            <div className="mt-auto pt-6 text-center">
              <p className="text-xs uppercase tracking-[0.28em] text-slate-500">QueueFlow</p>
            </div>
          </div>
        </div>

        <QueueStopDialog
          isOpen={showStopDialog}
          isStopping={isStopping}
          onCancel={() => setShowStopDialog(false)}
          onConfirm={() => void handleStopTracking()}
        />
      </>
    );
  }

  const accentLabel = ticket.status === 'serving' ? 'Now at desk' : 'Waiting in line';
  const accentTone =
    ticket.status === 'serving'
      ? 'bg-sky-400/15 text-sky-100'
      : 'bg-amber-300/15 text-amber-100';

  return (
    <>
      <div className="relative flex min-h-screen flex-col overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.20),_transparent_38%),radial-gradient(circle_at_80%_20%,_rgba(249,115,22,0.18),_transparent_26%),linear-gradient(180deg,_#020617_0%,_#0f172a_45%,_#111827_100%)]">
        {showBuzzFlash ? (
          <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-red-600">
            <div className="text-center">
              <p className="text-7xl font-black text-white drop-shadow-lg">📳 BUZZ!</p>
              <p className="mt-3 text-xl font-bold text-white">Attention needed now</p>
            </div>
          </div>
        ) : null}

        <RecallNotification
          ticketId={ticket.id}
          ticketNumber={ticket.ticket_number}
          officeId={ticket.office_id}
        />

        <div className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.14),_transparent_62%)]" />

        <div className="relative mx-auto flex w-full max-w-md flex-1 flex-col px-4 pb-8 pt-6">
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">{officeName}</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">{serviceName}</h1>
              <p className="mt-2 text-sm text-slate-300">{syncLabel}</p>
            </div>

            <div className="flex flex-col items-end gap-2">
              <QueueActionPill
                label="Refresh"
                onClick={() => void handleManualRefresh()}
                tone="primary"
                disabled={isRefreshing}
                loading={isRefreshing}
              />
              <QueueActionPill
                label="End"
                onClick={() => setShowStopDialog(true)}
                tone="danger"
                disabled={isStopping}
              />
            </div>
          </div>

          <section className="rounded-[34px] border border-white/10 bg-white/6 p-6 shadow-[0_36px_120px_rgba(2,6,23,0.35)] backdrop-blur">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className={`inline-flex rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] ${accentTone}`}>
                  {accentLabel}
                </div>
                <p className="mt-4 text-sm font-medium uppercase tracking-[0.28em] text-slate-400">Ticket</p>
                <p className="mt-2 text-5xl font-black tracking-[0.12em] text-white">{ticket.ticket_number}</p>
              </div>

              <div className="rounded-[28px] border border-cyan-300/18 bg-cyan-400/8 px-4 py-4 text-right">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-100/70">Position</p>
                <p className="mt-2 text-4xl font-semibold text-white">{position ? `#${position}` : '--'}</p>
                <p className="mt-2 text-sm text-cyan-50/70">
                  {position && position > 1 ? `${position - 1} ahead of you` : 'You are nearly up'}
                </p>
              </div>
            </div>

            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                <span>Queue movement</span>
                <span>{ticket.status === 'serving' ? 'At the desk' : 'Live'}</span>
              </div>
              <div className="h-3 rounded-full bg-white/8">
                <div
                  className="h-3 rounded-full bg-gradient-to-r from-cyan-300 via-sky-300 to-emerald-300 transition-all duration-700"
                  style={{ width: `${progressPercent(position) * 100}%` }}
                />
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <WaitingMetric
                label="Wait"
                value={estimatedWait != null ? `${estimatedWait} min` : '--'}
                detail={estimatedWait != null ? 'Approximate wait until your turn.' : 'Calculating timing now.'}
                accentClass="bg-sky-400/15 text-sky-100"
              />
              <WaitingMetric
                label="Now serving"
                value={nowServing ?? '--'}
                detail="Current ticket being helped right now."
                accentClass="bg-emerald-400/15 text-emerald-100"
              />
              <WaitingMetric
                label="Alerts"
                value={alertsEnabled ? 'Ready' : 'Off'}
                detail={alertsEnabled ? 'We can reach you even if you step away.' : 'Turn alerts on so you do not miss your turn.'}
                accentClass="bg-amber-300/15 text-amber-100"
              />
            </div>
          </section>

          <section className="mt-4 rounded-[28px] border border-white/8 bg-white/5 p-5 backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-semibold text-white">Keep it simple</p>
                <p className="mt-1 text-sm leading-6 text-slate-300">
                  Stay nearby, keep your phone available, and we will bring you straight to the desk when it is time.
                </p>
              </div>
              {!alertsEnabled ? (
                <QueueActionPill
                  label={isIos && !isInStandaloneMode ? 'Set up alerts' : 'Enable alerts'}
                  onClick={() => void handleEnableAlerts()}
                  tone="primary"
                />
              ) : (
                <div className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-100">
                  Alerts ready
                </div>
              )}
            </div>

            <div className="mt-4 grid gap-3">
              <JourneyStep
                title="We call your number once it is your turn"
                detail="The moment the desk calls you, this screen changes instantly and your lock screen updates too."
              />
              <JourneyStep
                title="Refresh any time if you want reassurance"
                detail="Use the Refresh button whenever you want an immediate sync, just like a pull-to-refresh check."
              />
              <JourneyStep
                title="End tracking when you are done"
                detail="When your visit is complete, finish the session so this device stops getting updates."
              />
            </div>
          </section>

          <div className="mt-4 space-y-4">
            <div className="rounded-[24px] border border-white/8 bg-white/5 p-4 backdrop-blur">
              <p className="text-sm font-semibold text-white">Visit details</p>
              <p className="mt-1 text-sm text-slate-300">Need to change your contact details or backup alert options? You can do that here.</p>
              <div className="mt-4">
                <EditCustomerData ticket={ticket} />
              </div>
            </div>

            <PriorityAlertSetup ticket={ticket} config={priorityAlertConfig} />
          </div>

          {stopError ? (
            <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {stopError}
            </div>
          ) : null}

          {showIosPrompt ? (
            <IosInstallPrompt
              onDismiss={() => {
                setShowIosPrompt(false);
                sessionStorage.setItem('ios-install-dismissed', '1');
              }}
            />
          ) : null}

          <div className="mt-auto pt-6 text-center">
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">QueueFlow</p>
          </div>
        </div>
      </div>

      <QueueStopDialog
        isOpen={showStopDialog}
        isStopping={isStopping}
        onCancel={() => setShowStopDialog(false)}
        onConfirm={() => void handleStopTracking()}
      />
    </>
  );
}
