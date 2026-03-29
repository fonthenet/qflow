'use client';

import { BellRing, RefreshCw, XCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { LanguageSwitcher } from '@/components/shared/language-switcher';
import type { Database } from '@/lib/supabase/database.types';
import type { PriorityAlertConfig } from '@/lib/priority-alerts';
import { useI18n } from '@/components/providers/locale-provider';

type Ticket = Database['public']['Tables']['tickets']['Row'];
type NotificationRow = Database['public']['Tables']['notifications']['Row'];

interface QueueStatusProps {
  ticket: Ticket;
  organizationName?: string;
  officeName: string;
  departmentName?: string;
  serviceName: string;
  priorityAlertConfig?: PriorityAlertConfig | null;
  messengerPageId?: string | null;
  sandbox?: {
    enabled: boolean;
    initialPosition?: number | null;
    initialEstimatedWait?: number | null;
    nowServing?: string | null;
    deskName?: string | null;
  };
}

function getTrackingStopStorageKey(ticketId: string) {
  return `qflo:tracking-stopped:${ticketId}`;
}

function readTrackingStopState(ticketId: string): { outcome: 'left_queue' | 'cleared' } | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(getTrackingStopStorageKey(ticketId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { stopped?: boolean; outcome?: 'left_queue' | 'cleared' };
    if (!parsed.stopped || !parsed.outcome) return null;
    return { outcome: parsed.outcome };
  } catch {
    return null;
  }
}

function storeTrackingStopState(ticketId: string, outcome: 'left_queue' | 'cleared') {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(
      getTrackingStopStorageKey(ticketId),
      JSON.stringify({
        stopped: true,
        outcome,
      })
    );
  } catch {
    // Ignore storage failures.
  }
}

function progressPercent(position: number | null) {
  if (!position || position <= 1) return 0.92;
  return Math.max(0.08, Math.min(0.92, (14 - Math.min(position, 14)) / 14));
}

function formatServingElapsed(seconds: number, t: (key: string, variables?: Record<string, string | number>) => string) {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;

  if (minutes <= 0) {
    return t('{seconds}s', { seconds: remainingSeconds });
  }

  return t('{minutes}m {seconds}s', {
    minutes,
    seconds: String(remainingSeconds).padStart(2, '0'),
  });
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
  icon,
}: {
  label: string;
  onClick: () => void;
  tone?: 'secondary' | 'danger' | 'primary';
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
}) {
  const { t, formatTime } = useI18n();
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
      className={`inline-flex items-center justify-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${toneClass}`}
    >
      {loading ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" />{label}</> : <>{icon}{label}</>}
    </button>
  );
}

function WaitingMetric({
  label,
  value,
  detail,
  accentClass,
  labelClassName,
  valueClass,
  detailClass,
}: {
  label: string;
  value: string;
  detail: string;
  accentClass: string;
  labelClassName?: string;
  valueClass?: string;
  detailClass?: string;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/6 p-4 shadow-[0_20px_40px_rgba(2,6,23,0.18)] backdrop-blur">
      <p className={`mb-1 text-[11px] font-semibold ${accentClass} ${labelClassName ?? 'uppercase tracking-[0.22em]'}`}>{label}</p>
      <p className={`text-2xl font-semibold leading-tight tracking-tight text-white sm:text-[28px] ${valueClass ?? ''}`}>{value}</p>
      <p className={`mt-1 text-[11px] leading-5 text-slate-400 ${detailClass ?? ''}`}>{detail}</p>
    </div>
  );
}

function JourneyStep({
  icon,
  title,
  detail,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-white/10 text-slate-100">
        {icon}
      </div>
      <div>
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="mt-1 text-sm leading-6 text-slate-300">{detail}</p>
      </div>
    </div>
  );
}

export function QueueStatus({
  ticket: initialTicket,
  organizationName = '',
  officeName,
  departmentName = '',
  serviceName,
  priorityAlertConfig,
  messengerPageId,
  sandbox,
}: QueueStatusProps) {
  const { t, formatTime, dir } = useI18n();
  const ticketNumber =
    typeof initialTicket.ticket_number === 'string' || typeof initialTicket.ticket_number === 'number'
      ? String(initialTicket.ticket_number)
      : '';
  const sandboxMode = Boolean(sandbox?.enabled);
  // Build display hierarchy: Organization > Office/Branch > Service
  const businessName = organizationName || officeName || t('Business');
  const branchLine = organizationName && officeName && officeName !== organizationName
    ? officeName
    : departmentName && departmentName !== businessName
      ? departmentName
      : '';
  const serviceLabel = serviceName || departmentName || '';
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
    disabled: sandboxMode,
    sandboxPosition: sandbox?.initialPosition ?? null,
    sandboxEstimatedWait: sandbox?.initialEstimatedWait ?? null,
  });

  const [nowServing, setNowServing] = useState<string | null>(sandbox?.nowServing ?? null);
  const [deskName, setDeskName] = useState<string | null>(sandbox?.deskName ?? null);
  const [alertsEnabled, setAlertsEnabled] = useState(false);
  const [showIosPrompt, setShowIosPrompt] = useState(false);
  const [showBuzzFlash, setShowBuzzFlash] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showStopDialog, setShowStopDialog] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [trackingStopped, setTrackingStopped] = useState(false);
  const [stopOutcome, setStopOutcome] = useState<'left_queue' | 'cleared'>('left_queue');
  const [stopError, setStopError] = useState<string | null>(null);
  const [hasMounted, setHasMounted] = useState(false);
  const [servingElapsedSeconds, setServingElapsedSeconds] = useState(0);
  const [hasResolvedTrackingStop, setHasResolvedTrackingStop] = useState(false);
  const notificationRequested = useRef(false);
  const lastBuzzNotificationId = useRef<string | null>(null);
  const buzzTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isIos = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isInStandaloneMode = typeof window !== 'undefined' && (
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  );
  const shouldShowIosSetupLabel = hasMounted && isIos && !isInStandaloneMode;
  const compactLabelClass = dir === 'rtl' ? 'tracking-normal normal-case' : 'uppercase tracking-[0.22em]';
  const compactPillClass = dir === 'rtl' ? 'tracking-normal normal-case' : 'uppercase tracking-[0.20em]';
  const compactMetaClass = dir === 'rtl' ? 'tracking-normal normal-case' : 'uppercase tracking-[0.18em]';

  const syncLabel = useMemo(() => {
    if (isUpdating || isRefreshing || !lastSyncedAt) return t('Syncing live updates');
    return t('Updated {time}', {
      time: formatTime(lastSyncedAt, { hour: 'numeric', minute: '2-digit' }),
    });
  }, [formatTime, isRefreshing, isUpdating, lastSyncedAt, t]);

  const fireBuzz = () => {
    if (sandboxMode) return;
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
    if (sandboxMode) {
      setNowServing(sandbox?.nowServing ?? null);
      return;
    }
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
    if (sandboxMode) {
      setDeskName(sandbox?.deskName ?? null);
      return;
    }
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
      if (sandboxMode) {
        await Promise.resolve();
        return;
      }
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
      if (sandboxMode) {
        setStopOutcome('left_queue');
        setTrackingStopped(true);
        storeTrackingStopState(ticket.id, 'left_queue');
        return;
      }
      const result = await stopTicketTracking(ticket.id);
      if (!result) {
        setStopError(t('We could not leave the queue just yet. Please try again.'));
        return;
      }

      const outcome = result.leftQueue ? 'left_queue' : 'cleared';
      setStopOutcome(outcome);
      setTrackingStopped(true);
      storeTrackingStopState(ticket.id, outcome);
    } finally {
      setIsStopping(false);
      setShowStopDialog(false);
    }
  };

  const handleFeedbackDone = async () => {
    await handleStopTracking();
  };

  useEffect(() => {
    setHasMounted(true);
  }, []);

  useEffect(() => {
    const storedState = readTrackingStopState(ticket.id);
    if (storedState) {
      setStopOutcome(storedState.outcome);
      setTrackingStopped(true);
    }
    setHasResolvedTrackingStop(true);
  }, [ticket.id]);

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
    if (ticket.status !== 'serving') {
      setServingElapsedSeconds(0);
      return;
    }

    const startedAt = ticket.serving_started_at ?? ticket.called_at;
    if (!startedAt) {
      setServingElapsedSeconds(0);
      return;
    }

    const startedAtMs = new Date(startedAt).getTime();
    const tick = () => {
      setServingElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)));
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [ticket.called_at, ticket.serving_started_at, ticket.status]);

  useEffect(() => {
    if (sandboxMode) {
      setNowServing(sandbox?.nowServing ?? null);
      return;
    }
    void fetchNowServing();
    const interval = setInterval(fetchNowServing, 15000);
    return () => clearInterval(interval);
  }, [sandboxMode, sandbox?.nowServing, ticket.department_id, ticket.office_id]);

  useEffect(() => {
    if (sandboxMode) {
      setDeskName(sandbox?.deskName ?? null);
      return;
    }
    if (ticket.status === 'called' && ticket.desk_id) {
      void fetchDeskName();
    }
  }, [sandboxMode, sandbox?.deskName, ticket.status, ticket.desk_id]);

  useEffect(() => {
    if (sandboxMode) return;
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
  }, [sandboxMode, ticket.id]);

  useEffect(() => {
    if (sandboxMode) return;
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
  }, [alertsEnabled, sandboxMode, ticket.id]);

  useEffect(() => {
    if (sandboxMode) return;
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
  }, [sandboxMode, ticket.id]);

  const lastResubscribeStatus = useRef<string | null>(null);
  useEffect(() => {
    if (sandboxMode) return;
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
  }, [alertsEnabled, sandboxMode, ticket.id, ticket.status]);

  const handleEnableAlerts = async () => {
    if (sandboxMode) {
      setAlertsEnabled(true);
      return;
    }
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

  if (!hasResolvedTrackingStop) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.20),_transparent_38%),linear-gradient(180deg,_#020617_0%,_#0f172a_45%,_#111827_100%)] px-4 py-10">
        <div className="w-full max-w-sm rounded-[34px] border border-white/10 bg-slate-950/88 p-7 text-center shadow-[0_30px_110px_rgba(15,23,42,0.65)] backdrop-blur">
          <p className="text-sm font-medium text-slate-300">{t('Loading...')}</p>
        </div>
      </div>
    );
  }

  if (trackingStopped) {
    return (
      <QueueSessionEnded
        title={stopOutcome === 'left_queue' ? 'You left the queue' : 'Visit cleared'}
        description={
          stopOutcome === 'left_queue'
            ? 'This ticket was removed from the queue and all alerts for this visit have been turned off on this device.'
            : 'This completed visit has been cleared from this device and any remaining alerts have been turned off.'
        }
        detail={
          stopOutcome === 'left_queue'
            ? t('Ticket {ticketNumber} is no longer active in line.', { ticketNumber })
            : t('Ticket {ticketNumber} no longer has live updates on this device.', { ticketNumber })
        }
        onResume={undefined}
      />
    );
  }

  if (ticket.status === 'cancelled' || ticket.status === 'no_show' || ticket.status === 'transferred') {
    const statusMessage = {
      cancelled: {
        title: 'Ticket cancelled',
        description: 'This ticket is no longer active in the queue.',
      },
      no_show: {
        title: 'Missed your turn',
        description: 'The desk marked this ticket as missed. Please talk to staff if you still need help.',
      },
      transferred: {
        title: 'Ticket transferred',
        description: 'This ticket moved to a different service flow.',
      },
    }[ticket.status];

    return (
      <QueueSessionEnded
        title={statusMessage.title}
        description={statusMessage.description}
        detail={t('Ticket {number}', { number: ticketNumber })}
      />
    );
  }

  if (ticket.status === 'called') {
    return (
      <>
        <YourTurn
          ticket={ticket}
          deskName={deskName ?? ''}
          officeName={businessName}
          serviceName={branchLine || serviceLabel}
          lastSyncedAt={lastSyncedAt}
          isRefreshing={isRefreshing}
          stopError={stopError}
          onRefresh={handleManualRefresh}
          onStopTracking={() => setShowStopDialog(true)}
          sandboxMode={sandboxMode}
        />
        <QueueStopDialog
          isOpen={showStopDialog}
          isStopping={isStopping}
          onCancel={() => setShowStopDialog(false)}
          onConfirm={() => void handleStopTracking()}
          title={t('Leave this queue?')}
          description={t('This removes the ticket from the queue and closes any remaining alerts on this device.')}
          confirmLabel={t('Leave queue')}
        />
      </>
    );
  }

  if (ticket.status === 'served') {
    return (
      <FeedbackForm
        ticket={ticket}
        officeName={businessName}
        serviceName={branchLine || serviceLabel}
        onDone={handleFeedbackDone}
      />
    );
  }

  if (ticket.status === 'serving') {
    return (
      <>
        <div className="flex min-h-screen flex-col bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.18),_transparent_38%),linear-gradient(180deg,_#020617_0%,_#0f172a_100%)] px-4 py-8">
          <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-white">{businessName}</h1>
                {branchLine ? <p className="mt-1 text-sm font-medium text-slate-300">{branchLine}</p> : null}
                <p className="mt-2 text-sm text-slate-300">{syncLabel}</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <QueueActionPill
                  label={t('Refresh')}
                  onClick={() => void handleManualRefresh()}
                  tone="primary"
                  disabled={isRefreshing}
                  loading={isRefreshing}
                />
                <QueueActionPill label={t('End')} onClick={() => setShowStopDialog(true)} tone="danger" />
              </div>
            </div>

            <div className="mt-8 rounded-[34px] border border-white/10 bg-slate-950/82 p-7 text-center shadow-[0_30px_110px_rgba(15,23,42,0.58)] backdrop-blur">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[26px] bg-sky-400/12 text-sky-100 shadow-[0_20px_60px_rgba(56,189,248,0.22)]">
                <svg className="h-10 w-10" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>

              <div className={`mt-6 rounded-full bg-sky-400/12 px-4 py-2 text-xs font-semibold text-sky-100 ${compactPillClass}`}>
                {t('With staff now')}
              </div>

              <h2 className="mt-5 text-3xl font-semibold tracking-tight text-white">{t('You are being served')}</h2>

              <div className="mt-7 grid gap-3 sm:grid-cols-2">
                <WaitingMetric
                  label={t('Ticket')}
                  value={ticketNumber}
                  detail={t('Keep this visible in case the team asks for your number again.')}
                  accentClass="bg-sky-400/15 text-sky-100"
                  labelClassName={compactLabelClass}
                />
                <WaitingMetric
                  label={t('Desk')}
                  value={deskName ?? t('Desk')}
                  detail={t('This is the current service point handling your visit.')}
                  accentClass="bg-emerald-400/15 text-emerald-100"
                  labelClassName={compactLabelClass}
                />
                <WaitingMetric
                  label={t('Time spent')}
                  value={formatServingElapsed(servingElapsedSeconds, t)}
                  detail={t('Service time since the desk started helping you.')}
                  accentClass="bg-amber-400/15 text-amber-100"
                  labelClassName={compactLabelClass}
                />
              </div>
            </div>

            {stopError ? (
              <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                {stopError}
              </div>
            ) : null}

            <div className="mt-auto pt-6 text-center">
              <p className={`text-xs text-slate-500 ${compactMetaClass}`}>POWERED BY QFLO</p>
            </div>
          </div>
        </div>

        <QueueStopDialog
          isOpen={showStopDialog}
          isStopping={isStopping}
          onCancel={() => setShowStopDialog(false)}
          onConfirm={() => void handleStopTracking()}
          title={t('Leave this queue?')}
          description={t('This removes the ticket from the queue and closes any remaining alerts on this device.')}
          confirmLabel={t('Leave queue')}
        />
      </>
    );
  }

  const accentLabel = ticket.status === 'serving' ? t('Now at desk') : t('Waiting in line');
  const accentTone =
    ticket.status === 'serving'
      ? 'bg-sky-400/15 text-sky-100'
      : 'bg-amber-300/15 text-amber-100';

  return (
    <>
      <div className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.20),_transparent_38%),radial-gradient(circle_at_80%_20%,_rgba(249,115,22,0.18),_transparent_26%),linear-gradient(180deg,_#020617_0%,_#0f172a_45%,_#111827_100%)]">
        {showBuzzFlash ? (
          <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-red-600">
            <div className="text-center">
              <p className="text-7xl font-black text-white drop-shadow-lg">📳 BUZZ!</p>
              <p className="mt-3 text-xl font-bold text-white">{t('Attention needed now')}</p>
            </div>
          </div>
        ) : null}

        <RecallNotification
          ticketId={ticket.id}
          ticketNumber={ticket.ticket_number}
          officeId={ticket.office_id}
        />

        <div className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.14),_transparent_62%)]" />

          <div className="relative mx-auto flex w-full max-w-md flex-1 flex-col px-4 pb-5 pt-5">
            <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-white">{businessName}</h1>
              {branchLine ? <p className="mt-1 text-sm font-medium text-slate-400">{branchLine}</p> : null}
              <p className="mt-1 text-sm text-slate-400">{syncLabel}</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className={`inline-flex rounded-full px-3 py-1 text-[11px] font-semibold ${compactPillClass} ${accentTone}`}>
                {accentLabel}
              </div>
              <div className="flex items-center gap-2">
                <QueueActionPill
                  icon={<RefreshCw className="h-3.5 w-3.5" />}
                  label={t('Refresh')}
                  onClick={() => void handleManualRefresh()}
                  tone="primary"
                  disabled={isRefreshing}
                  loading={isRefreshing}
                />
                <QueueActionPill
                  icon={<XCircle className="h-3.5 w-3.5" />}
                  label={t('End')}
                  onClick={() => setShowStopDialog(true)}
                  tone="danger"
                  disabled={isStopping}
                />
              </div>
            </div>
          </div>

          <section className="rounded-[32px] border border-white/10 bg-white/6 p-5 shadow-[0_36px_120px_rgba(2,6,23,0.35)] backdrop-blur">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className={`text-[11px] font-medium text-slate-400 ${compactMetaClass}`}>{t('Ticket')}</p>
                <p className="mt-2 truncate whitespace-nowrap text-[34px] font-black leading-none tracking-[0.06em] text-white sm:text-[42px]">
                  {ticketNumber}
                </p>
                {serviceLabel ? <p className="mt-2 text-sm font-medium text-slate-300">{serviceLabel}</p> : null}
              </div>

              <div className="text-right">
                <p className="mt-2 text-5xl font-semibold leading-none text-white">{position ? `#${position}` : '--'}</p>
                <p className="mt-2 text-sm leading-5 text-cyan-50/70">
                  {position === 1
                    ? t('Almost there')
                    : position && position <= 3
                      ? t('You are nearly up')
                      : position
                        ? t('{count} ahead of you', { count: position - 1 })
                        : '--'}
                </p>
              </div>
            </div>

            <div className="mt-5">
              <div className={`mb-2 flex items-center justify-between text-[11px] font-medium text-slate-400 ${compactMetaClass}`}>
                <span>{t('Queue progress')}</span>
                <span className={ticket.status !== 'serving' ? 'animate-pulse text-emerald-400' : ''}>
                  {ticket.status === 'serving' ? t('At the desk') : position ? `#${position} ${t('in line')}` : '--'}
                </span>
              </div>
              <div className="h-3 rounded-full bg-white/8">
                <div
                  className="h-3 rounded-full bg-gradient-to-r from-cyan-300 via-sky-300 to-emerald-300 transition-all duration-700"
                  style={{ width: `${progressPercent(position) * 100}%` }}
                />
              </div>
            </div>
          </section>

          <div className="mt-4 grid grid-cols-3 gap-3">
              <WaitingMetric
                label={t('Wait')}
                value={estimatedWait != null ? `${estimatedWait} min` : '--'}
                detail={estimatedWait != null ? t('Approximate timing') : t('Calculating time')}
                accentClass="text-sky-400"
                labelClassName={compactLabelClass}
              />
              <WaitingMetric
                label={t('Now serving')}
                value={nowServing ?? '--'}
                detail={t('Current desk activity')}
                accentClass="text-emerald-400"
                labelClassName={compactLabelClass}
                valueClass="text-[18px] leading-tight sm:text-[22px]"
                detailClass="text-[10px] leading-4"
              />
              <WaitingMetric
                label={t('Alerts')}
                value={alertsEnabled ? t('Ready') : t('Off')}
                detail={alertsEnabled ? t('Background alerts on') : t('Turn alerts on')}
                accentClass="text-amber-400"
                labelClassName={compactLabelClass}
              />
          </div>

          {!alertsEnabled ? (
            <button
              type="button"
              onClick={() => void handleEnableAlerts()}
              className="mt-4 flex w-full items-center gap-3 rounded-full border border-amber-400/20 bg-amber-500/10 px-5 py-3 text-left transition hover:bg-amber-500/15"
            >
              <BellRing className="h-4 w-4 shrink-0 text-amber-400" />
              <span className="text-sm font-medium text-amber-50">
                {shouldShowIosSetupLabel
                  ? t('Set up alerts — we’ll notify you when it’s your turn')
                  : t('Enable alerts — we’ll notify you when it’s your turn')}
              </span>
            </button>
          ) : (
            <div className="mt-4 flex w-full items-center gap-3 rounded-full border border-white/8 bg-white/5 px-5 py-3">
              <BellRing className="h-4 w-4 shrink-0 text-emerald-400" />
              <span className="text-sm font-medium text-slate-300">{t('Alerts enabled — we’ll notify you when it’s your turn')}</span>
            </div>
          )}

          {!sandboxMode && messengerPageId && (
            <a
              href={`https://m.me/${messengerPageId}?text=${encodeURIComponent(`TRACK ${ticket.qr_token}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 flex w-full items-center gap-3 rounded-full border border-blue-400/20 bg-blue-500/10 px-5 py-3 text-left transition hover:bg-blue-500/15"
            >
              <svg className="h-4 w-4 shrink-0 text-blue-400" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.36 2 2 6.13 2 11.7c0 2.91 1.2 5.42 3.15 7.2V22l3.04-1.67c.85.24 1.75.37 2.81.37 5.64 0 10-4.13 10-9.7S17.64 2 12 2zm1.04 13.06l-2.55-2.73L5.6 15.2l5.36-5.69 2.62 2.73 4.83-2.73-5.37 5.55z"/>
              </svg>
              <span className="text-sm font-medium text-blue-50">
                {t('Get Messenger notifications')}
              </span>
            </a>
          )}

          {sandboxMode ? (
            <div className="mt-4 rounded-2xl border border-sky-200/20 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
              {t('Sandbox preview. Customer editing and live alert setup stay disabled here so the page never touches real data.')}
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
              <EditCustomerData ticket={ticket} />
              <LanguageSwitcher variant="embedded" />
            </div>
          )}

          {!sandboxMode ? (
            <div className="mt-3">
              <PriorityAlertSetup ticket={ticket} config={priorityAlertConfig} />
            </div>
          ) : null}

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

          <div className="mt-auto pt-4 text-center">
            <p className={`text-xs text-slate-500 ${compactMetaClass}`}>POWERED BY QFLO</p>
          </div>
        </div>
      </div>

      <QueueStopDialog
        isOpen={showStopDialog}
        isStopping={isStopping}
        onCancel={() => setShowStopDialog(false)}
        onConfirm={() => void handleStopTracking()}
        title={t('Leave this queue?')}
        description={t('This removes the ticket from the queue and stops live updates on this device.')}
        confirmLabel={t('Leave queue')}
      />
    </>
  );
}
