import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react';
import { getSupabase } from '../lib/supabase';
import type { StaffSession, Ticket } from '../lib/types';
import { formatDesktopTime, formatWaitLabel, t as translate, type DesktopLocale } from '../lib/i18n';

// ── Transfer Modal Component ──────────────────────────────────────
function TransferModal({ desks, onTransfer, onClose, locale }: {
  desks: [string, string][];
  onTransfer: (deskId: string, deskName: string) => void;
  onClose: () => void;
  locale: DesktopLocale;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const t = (key: string, values?: Record<string, string | number | null | undefined>) => translate(locale, key, values);

  useEffect(() => {
    dialogRef.current?.focus();
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-label={t('Transfer ticket to another desk')}
        style={{
          background: 'var(--surface)', borderRadius: 12, padding: 24,
          minWidth: 320, maxWidth: 420, boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          outline: 'none',
        }}
      >
        <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700 }}>{t('Transfer to Desk')}</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {desks.map(([id, name]) => (
            <button
              key={id}
              onClick={() => onTransfer(id, name)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
                background: 'var(--surface2)', border: '1px solid var(--border)',
                borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600,
                color: 'var(--text)', textAlign: 'left', transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--primary)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--surface2)')}
            >
              <span style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                {name.charAt(0).toUpperCase()}
              </span>
              {name}
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          style={{
            marginTop: 16, width: '100%', padding: '10px', border: '1px solid var(--border)',
            borderRadius: 8, background: 'transparent', color: 'var(--text2)',
            cursor: 'pointer', fontSize: 13, fontWeight: 600,
          }}
        >
          {t('Cancel')}
        </button>
      </div>
    </div>
  );
}

declare global {
  interface Window {
    qf: any;
  }
}

interface Props {
  session: StaffSession;
  locale: DesktopLocale;
  isOnline: boolean;
  staffStatus: 'available' | 'on_break' | 'away';
  queuePaused: boolean;
  onStaffStatusChange: (status: 'available' | 'on_break' | 'away') => void;
  onQueuePausedChange: (paused: boolean) => void;
}

function statusColor(status: string): string {
  const map: Record<string, string> = {
    waiting: '#f59e0b', called: '#3b82f6', serving: '#22c55e',
    served: '#10b981', no_show: '#f97316', cancelled: '#ef4444',
  };
  return map[status] ?? '#64748b';
}

// ── Constants ────────────────────────────────────────────────────
const CALL_TIMEOUT = 60;
const FALLBACK_POLL_INTERVAL = 10000; // 10s fallback (event-driven is primary)
const DEVICE_CHECK_INTERVAL = 10000;

type StaffStatus = 'available' | 'on_break' | 'away';

const STAFF_STATUS_LABELS: Record<StaffStatus, { label: string; color: string; icon: string }> = {
  available: { label: 'Available', color: '#22c55e', icon: '●' },
  on_break: { label: 'On Break', color: '#f59e0b', icon: '◐' },
  away: { label: 'Away', color: '#ef4444', icon: '○' },
};

const DAYS_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function normalizeOfficeTimezone(timezone: string | null | undefined) {
  const value = (timezone ?? '').trim();
  if (!value) return 'UTC';
  if (value === 'Europe/Algiers') return 'Africa/Algiers';
  return value;
}

function OfficeHoursBadge({ locale, session }: { locale: DesktopLocale; session: StaffSession }) {
  const [status, setStatus] = useState<{ isOpen: boolean; reason: string; todayHours: any; nextOpen?: any; currentDay: string } | null>(null);
  const t = (key: string, values?: Record<string, string | number | null | undefined>) => translate(locale, key, values);

  useEffect(() => {
    function check() {
      try {
        const officeIds = session.office_ids?.length ? session.office_ids : [session.office_id];
        const targetOfficeId = officeIds[0];
        if (!targetOfficeId) return;
        const offices = (window as any).qf?.db?.query?.(
          'SELECT operating_hours, timezone FROM offices WHERE id = ? LIMIT 1',
          [targetOfficeId]
        );
        const office = offices?.[0];
        if (!office?.operating_hours) return;
        const hours = typeof office.operating_hours === 'string' ? JSON.parse(office.operating_hours) : office.operating_hours;
        if (!hours || Object.keys(hours).length === 0) return;
        const tz = normalizeOfficeTimezone(office.timezone);
        const now = new Date();

        let day: string, time: string;
        try {
          const df = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: tz });
          day = df.format(now).toLowerCase();
          const tf = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz });
          const parts = tf.formatToParts(now);
          time = `${(parts.find(p => p.type === 'hour')?.value ?? '00').padStart(2, '0')}:${(parts.find(p => p.type === 'minute')?.value ?? '00').padStart(2, '0')}`;
        } catch {
          day = DAYS_NAMES[now.getDay()];
          time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        }

        const todayH = hours[day];
        const toMins = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
        if (!todayH || (todayH.open === '00:00' && todayH.close === '00:00')) {
          // Find next open
          const di = DAYS_NAMES.indexOf(day);
          let next: any;
          for (let o = 1; o <= 7; o++) {
            const d = DAYS_NAMES[(di + o) % 7];
            const h = hours[d];
            if (h && !(h.open === '00:00' && h.close === '00:00')) { next = { day: d, time: h.open }; break; }
          }
          setStatus({ isOpen: false, reason: 'closed_today', todayHours: null, nextOpen: next, currentDay: day });
        } else {
          const cm = toMins(time), om = toMins(todayH.open), clm = toMins(todayH.close);
          const isOpen = cm >= om && cm < clm;
          setStatus({ isOpen, reason: isOpen ? 'open' : (cm < om ? 'before_hours' : 'after_hours'), todayHours: todayH, currentDay: day });
        }
      } catch { /* ignore */ }
    }
    check();
    const t = setInterval(check, 60000);
    return () => clearInterval(t);
  }, [session.office_id, session.office_ids]);

  if (!status) return null;

  const cap = (s: string) => t(s.charAt(0).toUpperCase() + s.slice(1));

  return (
    <div className="sidebar-section" style={{ flex: '0 0 auto' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
        {t('Office Hours')}
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
        borderRadius: 8, fontSize: 13,
        background: status.isOpen ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
        color: status.isOpen ? '#16a34a' : '#dc2626',
        fontWeight: 600,
      }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
          background: status.isOpen ? '#22c55e' : '#ef4444',
        }} />
        {status.isOpen
          ? t('Open until {time}', { time: status.todayHours?.close || '' })
          : status.reason === 'before_hours'
          ? t('Opens at {time}', { time: status.todayHours?.open || '' })
          : status.nextOpen
          ? t('Closed - opens {day} {time}', { day: cap(status.nextOpen.day), time: status.nextOpen.time })
          : t('Closed')
        }
      </div>
    </div>
  );
}

export function Station({ session, locale, isOnline, staffStatus, queuePaused, onStaffStatusChange, onQueuePausedChange }: Props) {
  const getDisplayUrlLabel = (url: string) => {
    try {
      const parsed = new URL(url);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return url;
    }
  };

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);
  const [names, setNames] = useState<Record<string, Record<string, string>>>({
    departments: {}, services: {}, desks: {},
  });
  const [callCountdown, setCallCountdown] = useState(0);
  const [servingElapsed, setServingElapsed] = useState(0);
  const [searchFilter, setSearchFilter] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const servingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevWaitingCount = useRef(0);
  const t = (key: string, values?: Record<string, string | number | null | undefined>) => translate(locale, key, values);
  const formatWait = useCallback((dateStr: string) => formatWaitLabel(dateStr, locale), [locale]);
  const statusLabels = useMemo(() => ({
    available: { ...STAFF_STATUS_LABELS.available, label: t('Available') },
    on_break: { ...STAFF_STATUS_LABELS.on_break, label: t('On Break') },
    away: { ...STAFF_STATUS_LABELS.away, label: t('Away') },
  }), [locale]);
  const translateAction = useCallback((action: string) => {
    const normalized = action.toLowerCase();
    if (normalized === 'served' || normalized === 'completed') return t('Completed');
    if (normalized === 'no_show' || normalized === 'no show') return t('No Show');
    if (normalized === 'requeued') return t('Requeued');
    if (normalized === 'recalled') return t('Recalled');
    if (normalized === 'cancelled') return t('Cancelled');
    if (normalized === 'serving') return t('Serving');
    if (normalized === 'called') return t('Called');
    return action;
  }, [locale]);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // ── Fetch tickets ────────────────────────────────────────────────

  // ALWAYS read from SQLite — the sync engine keeps it up to date
  const fetchTickets = useCallback(async () => {
    const officeIds = session.office_ids?.length ? session.office_ids : [session.office_id];
    const local = await window.qf.db.getTickets(officeIds, ['waiting', 'called', 'serving']);
    setTickets(local.map(parseLocalTicket));
  }, [session.office_id, session.office_ids]);

  // ── Load names for departments, services, desks ─────────────────

  // Load names from SQLite (sync engine keeps them fresh)
  useEffect(() => {
    (async () => {
      try {
        const [depts, svcs, desks] = await Promise.all([
          window.qf.db.query?.('departments', session.office_ids) ?? [],
          window.qf.db.query?.('services', session.office_ids) ?? [],
          window.qf.db.query?.('desks', session.office_ids) ?? [],
        ]);
        setNames({
          departments: Object.fromEntries((depts ?? []).map((d: any) => [d.id, d.name])),
          services: Object.fromEntries((svcs ?? []).map((s: any) => [s.id, s.name])),
          desks: Object.fromEntries((desks ?? []).map((d: any) => [d.id, d.name])),
        });
      } catch {
        // Names will be empty until sync pulls data
      }
    })();
  }, [session.office_ids]);

  // ── Event-driven refresh + fallback polling ─────────────────────

  useEffect(() => {
    fetchTickets();
    // Listen for push events from main process (instant, no wasted polls)
    const unsub = window.qf.tickets?.onChange?.(fetchTickets);
    // Fallback poll in case events are missed (10s vs old 3s)
    const iv = setInterval(fetchTickets, FALLBACK_POLL_INTERVAL);
    return () => { unsub?.(); clearInterval(iv); };
  }, [fetchTickets]);

  // ── Sync error notifications ───────────────────────────────────
  useEffect(() => {
    const unsub = window.qf.sync?.onError?.((error: { message: string; ticketNumber?: string; type: string }) => {
      showToast(error.message, 'error');
    });
    return () => { unsub?.(); };
  }, [showToast]);

  // ── Track active ticket (called/serving by this desk) ──────────

  useEffect(() => {
    const mine = tickets.find(
      (t) => (t.status === 'called' || t.status === 'serving') &&
        (t.desk_id === session.desk_id || t.called_by_staff_id === session.staff_id)
    );
    setActiveTicket(mine ?? null);

    // Countdown for called tickets
    if (mine?.status === 'called' && mine.called_at) {
      const elapsed = Math.floor((Date.now() - new Date(mine.called_at).getTime()) / 1000);
      const remaining = Math.max(0, CALL_TIMEOUT - elapsed);
      setCallCountdown(remaining);

      if (countdownRef.current) clearInterval(countdownRef.current);
      countdownRef.current = setInterval(() => {
        setCallCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(countdownRef.current!);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      setCallCountdown(0);
      if (countdownRef.current) clearInterval(countdownRef.current);
    }

    // Elapsed timer for serving tickets
    if (mine?.status === 'serving' && mine.serving_started_at) {
      const updateElapsed = () => {
        setServingElapsed(Math.floor((Date.now() - new Date(mine.serving_started_at!).getTime()) / 1000));
      };
      updateElapsed();
      if (servingTimerRef.current) clearInterval(servingTimerRef.current);
      servingTimerRef.current = setInterval(updateElapsed, 1000);
    } else {
      setServingElapsed(0);
      if (servingTimerRef.current) clearInterval(servingTimerRef.current);
    }

    return () => {
      if (servingTimerRef.current) clearInterval(servingTimerRef.current);
    };
  }, [tickets, session.desk_id]);

  // ── Actions ─────────────────────────────────────────────────────

  // ALWAYS write to SQLite first — sync engine pushes to cloud
  const callNext = async () => {
    try {
      const result = await window.qf.db.callNext(session.office_id, session.desk_id!, session.staff_id);
      if (!result) {
        showToast(t('No tickets waiting in queue'), 'info');
        return;
      }
      fetchTickets();
      window.qf.sync?.force?.().catch(() => {});
    } catch (err: any) {
      showToast(t('Failed to call next ticket'), 'error');
      console.error('[station] callNext error:', err);
    }
  };

  const updateTicketStatus = async (ticketId: string, updates: Record<string, any>) => {
    try {
      const result = await window.qf.db.updateTicket(ticketId, updates);
      if (updates.status === 'called' && !result) {
        showToast(t('Ticket already called by another desk'), 'error');
      }
      fetchTickets();
      window.qf.sync?.force?.().catch(() => {});
    } catch (err: any) {
      showToast(t('Failed to update ticket'), 'error');
      console.error('[station] updateTicket error:', err);
    }
  };

  const startServing = (id: string) => {
    updateTicketStatus(id, { status: 'serving', serving_started_at: new Date().toISOString() });
    const ticket = tickets.find((t) => t.id === id);
    if (ticket) addActivity(ticket.ticket_number, translate(locale, 'Serving'));
  };

  const complete = (id: string) => {
    updateTicketStatus(id, { status: 'served', completed_at: new Date().toISOString() });
    const ticket = tickets.find((t) => t.id === id);
    if (ticket) addActivity(ticket.ticket_number, translate(locale, 'Completed'));
    showToast(t('{ticket} completed', { ticket: ticket?.ticket_number ?? translate(locale, 'Ticket') }), 'success');
  };

  const noShow = (id: string) => {
    updateTicketStatus(id, { status: 'no_show', completed_at: new Date().toISOString() });
    const ticket = tickets.find((t) => t.id === id);
    if (ticket) addActivity(ticket.ticket_number, translate(locale, 'No Show'));
    showToast(t('{ticket} marked no-show', { ticket: ticket?.ticket_number ?? translate(locale, 'Ticket') }), 'info');
  };

  const recall = async (id: string) => {
    const t = tickets.find((t) => t.id === id);
    await updateTicketStatus(id, {
      called_at: new Date().toISOString(),
      recall_count: (t?.recall_count ?? 0) + 1,
    });
    if (t) addActivity(t.ticket_number, translate(locale, 'Recalled'));
  };

  const requeue = (id: string) => {
    updateTicketStatus(id, { status: 'waiting', desk_id: null, called_at: null, called_by_staff_id: null });
    const t = tickets.find((t) => t.id === id);
    if (t) addActivity(t.ticket_number, translate(locale, 'Requeued'));
  };

  const cancel = (id: string) => {
    updateTicketStatus(id, { status: 'cancelled', cancelled_at: new Date().toISOString() });
    const t = tickets.find((t) => t.id === id);
    if (t) addActivity(t.ticket_number, translate(locale, 'Cancelled'));
  };

  // ── Keyboard shortcuts ──────────────────────────────────────────
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Ctrl+Enter or F8: Call Next (respects pause)
      if (((e.ctrlKey && e.key === 'Enter') || e.key === 'F8') && !activeTicket && session.desk_id && !queuePaused && staffStatus === 'available') {
        e.preventDefault();
        callNext();
      }
      // F7: Toggle queue pause
      if (e.key === 'F7' && session.desk_id) {
        e.preventDefault();
        onQueuePausedChange(!queuePaused);
      }
      // F9: Start Serving (when called)
      if (e.key === 'F9' && activeTicket?.status === 'called') {
        e.preventDefault();
        startServing(activeTicket.id);
      }
      // F10: Complete (when serving)
      if (e.key === 'F10' && activeTicket?.status === 'serving') {
        e.preventDefault();
        complete(activeTicket.id);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [activeTicket, session.desk_id, queuePaused, staffStatus]);

  // ── Derived data ────────────────────────────────────────────────

  const [kioskUrl, setKioskUrl] = useState<string | null>(null);
  const [deviceStatuses, setDeviceStatuses] = useState<any[]>([]);

  useEffect(() => {
    window.qf.kiosk?.getUrl?.().then((url: string | null) => setKioskUrl(url));
  }, []);

  // Ping as station device + check all device statuses
  useEffect(() => {
    const checkDevices = async () => {
      try {
        const res = await fetch('http://localhost:3847/api/device-status', {
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
          const d = await res.json();
          setDeviceStatuses(d.devices ?? []);
        }
      } catch { /* kiosk server may not be ready yet */ }
    };
    checkDevices();
    const iv = setInterval(checkDevices, DEVICE_CHECK_INTERVAL);
    return () => clearInterval(iv);
  }, []);

  const waiting = useMemo(() => tickets.filter((t) => t.status === 'waiting' && !t.parked_at), [tickets]);
  const called = useMemo(() => tickets.filter((t) => t.status === 'called'), [tickets]);
  const serving = useMemo(() => tickets.filter((t) => t.status === 'serving'), [tickets]);

  // ── Recent activity log ─────────────────────────────────────────
  const [recentActivity, setRecentActivity] = useState<Array<{ ticket: string; action: string; time: string }>>([]);

  // Load recent activity from audit log on mount (persisted across restarts)
  useEffect(() => {
    if (!session?.office_id) return;
    (window as any).qf?.activity?.getRecent(session.office_id, 10).then((rows: any[]) => {
      if (rows?.length) {
        setRecentActivity(rows.map((r: any) => ({
          ticket: r.ticket,
          action: translateAction(r.action),
          time: formatDesktopTime(r.time, locale),
        })));
      }
    }).catch(() => {});
  }, [locale, session?.office_id, translateAction]);

  // Track completed actions — only keep the latest status per ticket
  const addActivity = useCallback((ticket: string, action: string) => {
    setRecentActivity((prev) => {
      const filtered = prev.filter((a) => a.ticket !== ticket);
      return [
        { ticket, action, time: formatDesktopTime(new Date(), locale) },
        ...filtered.slice(0, 9),
      ];
    });
  }, [locale]);

  // Sound alert when new ticket arrives
  useEffect(() => {
    if (waiting.length > prevWaitingCount.current && prevWaitingCount.current > 0) {
      try { new Audio('data:audio/wav;base64,UklGRl9vT19teleVBRk10AAAACQBAAABAAAAAQA8AB//gAQBkYXRhSAAAAGAAAAAAAAAAAAAAAAA=').play().catch(() => {}); } catch {}
    }
    prevWaitingCount.current = waiting.length;
  }, [waiting.length]);

  // Debounced search — 300ms delay to prevent lag on slow hardware
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => setDebouncedSearch(searchFilter), 300);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [searchFilter]);

  // Filter waiting list by search
  const filteredWaiting = useMemo(() => {
    if (!debouncedSearch) return waiting;
    const q = debouncedSearch.toLowerCase();
    return waiting.filter((t) =>
      t.ticket_number.toLowerCase().includes(q)
      || ((t.customer_data as any)?.name ?? '').toLowerCase().includes(q)
      || ((t.customer_data as any)?.phone ?? '').includes(q)
    );
  }, [waiting, debouncedSearch]);

  // Virtualization: only render first N items to avoid DOM bloat with 100+ tickets
  const VISIBLE_CHUNK = 50;
  const [showAllWaiting, setShowAllWaiting] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const visibleWaiting = useMemo(() => {
    if (showAllWaiting || filteredWaiting.length <= VISIBLE_CHUNK) return filteredWaiting;
    return filteredWaiting.slice(0, VISIBLE_CHUNK);
  }, [filteredWaiting, showAllWaiting]);

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className="station" role="main">
      {/* Left panel — active ticket */}
      <div className="station-main" aria-label={t('Active tickets')}>
        {!session.desk_id ? (
          <div className="no-desk" role="alert">
            <h2>{t('No Desk Assigned')}</h2>
            <p>{t('Ask your admin to assign you to a desk before you can start serving.')}</p>
          </div>
        ) : activeTicket ? (
          <div className="active-ticket-panel">
            {activeTicket.status === 'called' ? (
              <>
                <div className="active-status called">{t('CALLING')}</div>
                <div className="active-number">{activeTicket.ticket_number}</div>
                <div className="active-customer">
                  {(activeTicket.customer_data as any)?.name ?? t('Walk-in Customer')}
                </div>
                {(activeTicket.customer_data as any)?.phone && (
                  <div className="active-phone">{(activeTicket.customer_data as any).phone}</div>
                )}
                {((activeTicket.customer_data as any)?.reason || (activeTicket.customer_data as any)?.notes || (activeTicket as any).notes) && (
                  <div className="active-notes">
                    <strong>{t('Reason:')}</strong> {(activeTicket.customer_data as any)?.reason || (activeTicket.customer_data as any)?.notes || (activeTicket as any).notes}
                  </div>
                )}
                <div className="active-meta">
                  {names.services[activeTicket.service_id ?? ''] ?? t('Service')} &middot;{' '}
                  {names.departments[activeTicket.department_id ?? ''] ?? t('Dept')}
                </div>

                {/* Countdown */}
                <div className="countdown-ring" role="timer" aria-label={t('{seconds} seconds remaining', { seconds: callCountdown })}>
                  <svg viewBox="0 0 100 100" aria-hidden="true">
                    <circle cx="50" cy="50" r="45" fill="none" stroke="#1e293b" strokeWidth="6" />
                    <circle
                      cx="50" cy="50" r="45" fill="none"
                      stroke={callCountdown > 15 ? '#3b82f6' : callCountdown > 5 ? '#f59e0b' : '#ef4444'}
                      strokeWidth="6"
                      strokeDasharray={`${(callCountdown / CALL_TIMEOUT) * 283} 283`}
                      strokeLinecap="round"
                      transform="rotate(-90 50 50)"
                    />
                  </svg>
                  <span className="countdown-text">{callCountdown}s</span>
                </div>

                <div className="active-actions">
                  <button className="btn-primary btn-lg" onClick={() => startServing(activeTicket.id)} title="F9">
                    {t('Start Serving')} <span className="shortcut-hint">F9</span>
                  </button>
                  <div className="secondary-actions">
                    <button className="btn-outline" onClick={() => recall(activeTicket.id)} aria-label={`${t('Recall')} ${activeTicket.ticket_number}`}>
                      {t('Recall')} ({activeTicket.recall_count})
                    </button>
                    <button className="btn-outline btn-warning" onClick={() => noShow(activeTicket.id)} aria-label={`${t('No Show')} ${activeTicket.ticket_number}`}>
                      {t('No Show')}
                    </button>
                    <button className="btn-outline" onClick={() => requeue(activeTicket.id)} aria-label={`${t('Back to Queue')} ${activeTicket.ticket_number}`}>
                      {t('Back to Queue')}
                    </button>
                    <button className="btn-outline" onClick={() => {
                      const deskList = Object.entries(names.desks).filter(([id]) => id !== session.desk_id);
                      if (deskList.length === 0) { showToast(t('No other desks available'), 'error'); return; }
                      setShowTransferModal(true);
                    }} aria-label={`${t('Transfer')} ${activeTicket.ticket_number}`}>
                      {t('Transfer')}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="active-status serving">{t('NOW SERVING')}</div>
                <div className="active-number">{activeTicket.ticket_number}</div>
                <div className="active-customer">
                  {(activeTicket.customer_data as any)?.name ?? t('Walk-in Customer')}
                </div>
                {(activeTicket.customer_data as any)?.phone && (
                  <div className="active-phone">{(activeTicket.customer_data as any).phone}</div>
                )}
                {((activeTicket.customer_data as any)?.reason || (activeTicket.customer_data as any)?.notes || (activeTicket as any).notes) && (
                  <div className="active-notes">
                    <strong>{t('Reason:')}</strong> {(activeTicket.customer_data as any)?.reason || (activeTicket.customer_data as any)?.notes || (activeTicket as any).notes}
                  </div>
                )}
                <div className="active-meta">
                  {names.services[activeTicket.service_id ?? ''] ?? t('Service')} &middot;{' '}
                  {names.departments[activeTicket.department_id ?? ''] ?? t('Dept')}
                </div>

                {/* Serving elapsed timer */}
                <div className="serving-timer" role="timer" aria-label={t('Serving for {minutes} minutes {seconds} seconds', { minutes: Math.floor(servingElapsed / 60), seconds: servingElapsed % 60 })} style={{
                  margin: '1rem auto',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  fontSize: '2rem',
                  fontWeight: 700,
                  fontVariantNumeric: 'tabular-nums',
                  color: servingElapsed > 1800 ? '#ef4444' : servingElapsed > 900 ? '#f59e0b' : '#22c55e',
                }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  {Math.floor(servingElapsed / 60).toString().padStart(2, '0')}:{(servingElapsed % 60).toString().padStart(2, '0')}
                </div>

                <div className="active-actions">
                  <button className="btn-success btn-lg" onClick={() => complete(activeTicket.id)} title="F10">
                    {t('Complete Service')} <span className="shortcut-hint">F10</span>
                  </button>
                  <div className="secondary-actions">
                    <button className="btn-outline btn-warning" onClick={() => noShow(activeTicket.id)}>
                      {t('No Show')}
                    </button>
                    <button className="btn-outline btn-danger" onClick={() => cancel(activeTicket.id)}>
                      {t('Cancel')}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          <>
          {/* Status + Pause pills — top-right of main area */}
          <div style={{ position: 'absolute', top: 16, right: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* Pause toggle — only show when available */}
            {staffStatus === 'available' && (
              <button
                onClick={() => {
                  onQueuePausedChange(!queuePaused);
                  showToast(queuePaused ? t('Queue resumed') : t('Queue paused - no new calls'), queuePaused ? 'success' : 'info');
                }}
                title="F7 — Toggle pause"
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '5px 14px', borderRadius: 20,
                  border: queuePaused ? '1.5px solid #f59e0b40' : '1.5px solid var(--border)',
                  background: queuePaused ? 'rgba(245,158,11,0.12)' : 'transparent',
                  cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  color: queuePaused ? '#f59e0b' : 'var(--text3)',
                }}
                aria-label={queuePaused ? t('Resume queue') : t('Pause queue')}
              >
                {queuePaused ? `▶ ${t('Resume queue')}` : `⏸ ${t('Pause queue')}`} <span className="shortcut-hint">F7</span>
              </button>
            )}
            {/* Staff status dropdown */}
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowStatusMenu((v) => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '5px 14px', borderRadius: 20,
                  border: `1.5px solid ${statusLabels[staffStatus].color}40`,
                  background: `${statusLabels[staffStatus].color}12`,
                  cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  color: statusLabels[staffStatus].color,
                }}
                aria-label={t('Status: {label}', { label: statusLabels[staffStatus].label })}
              >
                <span>{statusLabels[staffStatus].icon}</span>
                <span>{statusLabels[staffStatus].label}</span>
                <span style={{ fontSize: 9, opacity: 0.6 }}>▼</span>
              </button>
              {showStatusMenu && (
                <div style={{
                  position: 'absolute', top: '100%', right: 0,
                  marginTop: 4, background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 8, overflow: 'hidden', zIndex: 10, minWidth: 150,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                }}>
                  {(Object.entries(statusLabels) as [StaffStatus, typeof statusLabels[StaffStatus]][]).map(([key, val]) => (
                    <button
                      key={key}
                      onClick={() => {
                        onStaffStatusChange(key);
                        setShowStatusMenu(false);
                        if (key !== 'available' && !queuePaused) onQueuePausedChange(true);
                        if (key === 'available' && queuePaused) onQueuePausedChange(false);
                        showToast(t('Status: {label}', { label: val.label }), 'info');
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                        padding: '10px 16px', border: 'none', cursor: 'pointer',
                        background: key === staffStatus ? 'var(--surface2)' : 'transparent',
                        color: 'var(--text)', fontSize: 13, fontWeight: 600,
                      }}
                    >
                      <span style={{ color: val.color }}>{val.icon}</span>
                      {val.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="idle-panel">
            {queuePaused || staffStatus !== 'available' ? (
              <>
                <div className="idle-icon" style={{ color: staffStatus === 'on_break' ? '#f59e0b' : staffStatus === 'away' ? '#ef4444' : '#64748b' }}>
                  {staffStatus === 'on_break' ? '☕' : staffStatus === 'away' ? '🚫' : '⏸'}
                </div>
                <h2>{staffStatus === 'on_break' ? t('On Break') : staffStatus === 'away' ? t('Away') : t('Queue Paused')}</h2>
                <p>{t('{count} waiting in queue', { count: waiting.length })}</p>
                <button
                  className="btn-primary btn-xl"
                  onClick={() => { onQueuePausedChange(false); onStaffStatusChange('available'); showToast(t('Queue resumed'), 'success'); }}
                  style={{ background: '#22c55e' }}
                >
                  {t('Resume Queue')} <span className="shortcut-hint">F7</span>
                </button>
              </>
            ) : (
              <>
                <div className="idle-icon">✓</div>
                <h2>{t('Ready for Next Customer')}</h2>
                <p>{t('{count} waiting in queue', { count: waiting.length })}</p>
                <button
                  className="btn-primary btn-xl"
                  onClick={callNext}
                  disabled={waiting.length === 0}
                  title="F8 or Ctrl+Enter"
                >
                  {t('Call Next ({count})', { count: waiting.length })} <span className="shortcut-hint">F8</span>
                </button>
              </>
            )}
          </div>
          </>
        )}
      </div>

      {/* Right panel — queue overview */}
      <div className="station-sidebar" role="complementary" aria-label={t('Queue Overview')}>
        <div className="sidebar-section">
          <div className="sidebar-header">
            <h3>{t('Queue Overview')}</h3>
            <div className="queue-stats" aria-label={t('{waiting} waiting, {called} called, {serving} serving', { waiting: waiting.length, called: called.length, serving: serving.length })}>
              <span className="stat-pill waiting" aria-hidden="true">{t('{count} waiting', { count: waiting.length })}</span>
              <span className="stat-pill called" aria-hidden="true">{t('{count} called', { count: called.length })}</span>
              <span className="stat-pill serving" aria-hidden="true">{t('{count} serving', { count: serving.length })}</span>
            </div>
          </div>
        </div>

        <div className="sidebar-section queue-list queue-waiting">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <h4 style={{ margin: 0 }}>{t('Waiting ({count})', { count: waiting.length })}</h4>
            {waiting.length > 3 && (
              <input
                type="text"
                placeholder={t('Search...')}
                value={searchFilter}
                onChange={(e) => { setSearchFilter(e.target.value); setShowAllWaiting(false); }}
                className="queue-search"
                aria-label={t('Search waiting queue by name, phone, or ticket number')}
              />
            )}
          </div>
          <div className="ticket-list" role="list" aria-label={t('Waiting tickets')}>
            {visibleWaiting.map((ticket, i) => (
              <div key={ticket.id} className="queue-item" role="listitem" aria-label={translate(locale, 'Position {position}, ticket {ticket}, {name}, waiting {wait}', { position: i + 1, ticket: ticket.ticket_number, name: (ticket.customer_data as any)?.name ?? translate(locale, 'Walk-in'), wait: formatWait(ticket.created_at) })}>
                <div className="queue-item-pos" aria-hidden="true">#{i + 1}</div>
                <div className="queue-item-info">
                  <span className="queue-item-number">{ticket.ticket_number}</span>
                  <span className="queue-item-meta">
                    {(ticket.customer_data as any)?.name ?? translate(locale, 'Walk-in')} &middot; {formatWait(ticket.created_at)}
                  </span>
                </div>
                <div className="queue-item-badges">
                  {ticket.priority > 1 && <span className="badge priority">P{ticket.priority}</span>}
                  {ticket.appointment_id && <span className="badge booked">{translate(locale, 'Booked')}</span>}
                  {ticket.is_remote && <span className="badge remote">{translate(locale, 'Remote')}</span>}
                </div>
                {session.desk_id && !activeTicket && !queuePaused && staffStatus === 'available' && (
                  <button
                    className="btn-sm btn-call"
                    aria-label={`${translate(locale, 'Call')} ${ticket.ticket_number}`}
                    onClick={() => updateTicketStatus(ticket.id, {
                      status: 'called',
                      desk_id: session.desk_id,
                      called_by_staff_id: session.staff_id,
                      called_at: new Date().toISOString(),
                    })}
                  >
                    {translate(locale, 'Call')}
                  </button>
                )}
              </div>
            ))}
            {!showAllWaiting && filteredWaiting.length > VISIBLE_CHUNK && (
              <button
                onClick={() => setShowAllWaiting(true)}
                style={{
                  width: '100%', padding: '8px', margin: '4px 0', border: 'none',
                  background: 'var(--surface2)', color: 'var(--primary)', borderRadius: 6,
                  cursor: 'pointer', fontSize: 12, fontWeight: 700,
                }}
              >
                {t('Show all {count} tickets ({more} more)', { count: filteredWaiting.length, more: filteredWaiting.length - VISIBLE_CHUNK })}
              </button>
            )}
            {filteredWaiting.length === 0 && (
              <div className="queue-empty">{searchFilter ? t('No matches') : t('No customers waiting')}</div>
            )}
          </div>
        </div>

        <div className="sidebar-section queue-list queue-active">
          <h4>{t('Active ({count})', { count: called.length + serving.length })}</h4>
          <div className="ticket-list" role="list" aria-label={t('Active tickets')}>
            {[...called, ...serving].map((ticket) => (
              <div key={ticket.id} className={`queue-item ${ticket.desk_id === session.desk_id ? 'mine' : ''}`} role="listitem" aria-label={translate(locale, 'Ticket {ticket}, {status} at {desk}', { ticket: ticket.ticket_number, status: ticket.status === 'called' ? translate(locale, 'Called') : translate(locale, 'Serving'), desk: names.desks[ticket.desk_id ?? ''] ?? translate(locale, 'desk') })}>
                <div className="queue-item-dot" style={{ background: statusColor(ticket.status) }} aria-hidden="true" />
                <div className="queue-item-info">
                  <span className="queue-item-number">{ticket.ticket_number}</span>
                  <span className="queue-item-meta">
                    {ticket.status === 'called' ? translate(locale, 'Called at {desk}', { desk: names.desks[ticket.desk_id ?? ''] ?? translate(locale, 'desk') }) : translate(locale, 'Serving at {desk}', { desk: names.desks[ticket.desk_id ?? ''] ?? translate(locale, 'desk') })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Activity — collapsed by default */}
        {recentActivity.length > 0 && (
          <div className="sidebar-section" style={{ flex: '0 0 auto' }}>
            <button
              onClick={() => setShowActivity(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
                padding: 0, border: 'none', background: 'transparent', cursor: 'pointer',
              }}
            >
              <h4 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, margin: 0 }}>
                {t('Recent Activity ({count})', { count: recentActivity.length })}
              </h4>
              <span style={{ fontSize: 10, color: 'var(--text3)' }}>{showActivity ? '▲' : '▼'}</span>
            </button>
            {showActivity && (
              <div style={{ maxHeight: 120, overflowY: 'auto', marginTop: 6 }} role="list" aria-label={t('Recent activity')}>
                {recentActivity.slice(0, 10).map((a, i) => (
                  <div key={i} role="listitem" style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '3px 0', fontSize: 11, color: 'var(--text2)',
                  }}>
                    <span><strong>{a.ticket}</strong> {a.action} · {a.time}</span>
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, marginLeft: 6, whiteSpace: 'nowrap',
                      background: a.action === t('Completed') ? 'rgba(34,197,94,0.15)' : a.action === t('No Show') ? 'rgba(249,115,22,0.15)' : 'rgba(59,130,246,0.15)',
                      color: a.action === t('Completed') ? '#22c55e' : a.action === t('No Show') ? '#f97316' : '#3b82f6',
                    }}>
                      {a.action}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Office Open/Closed Status */}
        <OfficeHoursBadge locale={locale} session={session} />

        {/* Device Status */}
        {deviceStatuses.length > 0 && (
          <div className="sidebar-section">
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              {t('Devices')}
            </div>
            {deviceStatuses.map((d: any) => (
              <div key={d.id} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0',
                fontSize: 13, color: d.connected ? 'var(--text2)' : 'var(--danger)',
              }}>
                <span style={{
                  width: 8, height: 8, borderRadius: 4, flexShrink: 0,
                  background: d.connected ? '#22c55e' : '#ef4444',
                }} aria-hidden="true" />
                <span style={{ flex: 1 }}>{d.name}</span>
                <span style={{ fontSize: 11, color: d.connected ? 'var(--text3)' : 'var(--danger)' }}>
                  {d.connected ? t('Online') : t('Offline')}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Local Network URLs */}
        {kioskUrl && (
          <div className="sidebar-section">
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              {t('Local Network')}
            </div>
            {[
              { label: t('Kiosk (take tickets)'), url: kioskUrl, icon: '🎫' },
              { label: t('Display (waiting room TV)'), url: kioskUrl.replace('/kiosk', '/display'), icon: '📺' },
            ].map((item) => (
              <div key={item.label} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 2 }}>{item.icon} {item.label}</div>
                <div
                  style={{
                    background: 'var(--surface2)', padding: '6px 10px', borderRadius: 6,
                    fontFamily: 'monospace', fontSize: 12, fontWeight: 600, color: 'var(--primary)',
                    wordBreak: 'break-all', userSelect: 'all', cursor: 'pointer',
                  }}
                  title={t('Click to copy')}
                  onClick={() => navigator.clipboard?.writeText(item.url)}
                >
                  {getDisplayUrlLabel(item.url)}
                </div>
              </div>
            ))}
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
              {t('Open on any device on this WiFi network. Works offline.')}
            </div>
          </div>
        )}
      </div>

      {/* Transfer modal */}
      {showTransferModal && activeTicket && (
        <TransferModal
          locale={locale}
          desks={Object.entries(names.desks).filter(([id]) => id !== session.desk_id)}
          onTransfer={(deskId, deskName) => {
            updateTicketStatus(activeTicket.id, {
              desk_id: deskId, status: 'waiting', called_at: null, called_by_staff_id: null,
            });
            addActivity(activeTicket.ticket_number, `→ ${deskName}`);
            showToast(t('Transferred to {deskName}', { deskName }), 'info');
            setShowTransferModal(false);
          }}
          onClose={() => setShowTransferModal(false)}
        />
      )}

      {/* Toast notification */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}

function parseLocalTicket(row: any): Ticket {
  let customerData = row.customer_data ?? {};
  if (typeof customerData === 'string') {
    try { customerData = JSON.parse(customerData); } catch { customerData = {}; }
  }
  return {
    ...row,
    customer_data: customerData,
    is_remote: !!row.is_remote,
    is_offline: !!row.is_offline,
  };
}
