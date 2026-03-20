import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { getSupabase } from '../lib/supabase';
import type { StaffSession, Ticket } from '../lib/types';

declare global {
  interface Window {
    qf: any;
  }
}

interface Props {
  session: StaffSession;
  isOnline: boolean;
  staffStatus: 'available' | 'on_break' | 'away';
  queuePaused: boolean;
  onStaffStatusChange: (status: 'available' | 'on_break' | 'away') => void;
  onQueuePausedChange: (paused: boolean) => void;
}

function formatWait(dateStr: string): string {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
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

export function Station({ session, isOnline, staffStatus, queuePaused, onStaffStatusChange, onQueuePausedChange }: Props) {
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
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const servingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevWaitingCount = useRef(0);

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

  // ── Track active ticket (called/serving by this desk) ──────────

  useEffect(() => {
    const mine = tickets.find(
      (t) => t.desk_id === session.desk_id && (t.status === 'called' || t.status === 'serving')
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
    await window.qf.db.callNext(session.office_id, session.desk_id!, session.staff_id);
    fetchTickets();
    // Trigger immediate sync if online
    window.qf.sync?.force?.();
  };

  const updateTicketStatus = async (ticketId: string, updates: Record<string, any>) => {
    await window.qf.db.updateTicket(ticketId, updates);
    fetchTickets();
    // Trigger immediate sync if online
    window.qf.sync?.force?.();
  };

  const startServing = (id: string) => {
    updateTicketStatus(id, { status: 'serving', serving_started_at: new Date().toISOString() });
    const t = tickets.find((t) => t.id === id);
    if (t) addActivity(t.ticket_number, 'Serving');
  };

  const complete = (id: string) => {
    updateTicketStatus(id, { status: 'served', completed_at: new Date().toISOString() });
    const t = tickets.find((t) => t.id === id);
    if (t) addActivity(t.ticket_number, 'Completed');
    showToast(`${t?.ticket_number ?? 'Ticket'} completed`, 'success');
  };

  const noShow = (id: string) => {
    updateTicketStatus(id, { status: 'no_show', completed_at: new Date().toISOString() });
    const t = tickets.find((t) => t.id === id);
    if (t) addActivity(t.ticket_number, 'No Show');
    showToast(`${t?.ticket_number ?? 'Ticket'} marked no-show`, 'info');
  };

  const recall = async (id: string) => {
    await updateTicketStatus(id, {
      called_at: new Date().toISOString(),
      recall_count: (activeTicket?.recall_count ?? 0) + 1,
    });
    const t = tickets.find((t) => t.id === id);
    if (t) addActivity(t.ticket_number, 'Recalled');
  };

  const requeue = (id: string) => {
    updateTicketStatus(id, { status: 'waiting', desk_id: null, called_at: null, called_by_staff_id: null });
    const t = tickets.find((t) => t.id === id);
    if (t) addActivity(t.ticket_number, 'Requeued');
  };

  const cancel = (id: string) => {
    updateTicketStatus(id, { status: 'cancelled', cancelled_at: new Date().toISOString() });
    const t = tickets.find((t) => t.id === id);
    if (t) addActivity(t.ticket_number, 'Cancelled');
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
        const res = await fetch('http://localhost:3847/api/device-status');
        const d = await res.json();
        setDeviceStatuses(d.devices ?? []);
      } catch {}
    };
    checkDevices();
    const iv = setInterval(checkDevices, 10000);
    return () => clearInterval(iv);
  }, []);

  const waiting = useMemo(() => tickets.filter((t) => t.status === 'waiting' && !t.parked_at), [tickets]);
  const called = useMemo(() => tickets.filter((t) => t.status === 'called'), [tickets]);
  const serving = useMemo(() => tickets.filter((t) => t.status === 'serving'), [tickets]);

  // ── Recent activity log ─────────────────────────────────────────
  const [recentActivity, setRecentActivity] = useState<Array<{ ticket: string; action: string; time: string }>>([]);

  // Track completed actions
  const addActivity = useCallback((ticket: string, action: string) => {
    setRecentActivity((prev) => [
      { ticket, action, time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) },
      ...prev.slice(0, 9), // keep last 10
    ]);
  }, []);

  // Sound alert when new ticket arrives
  useEffect(() => {
    if (waiting.length > prevWaitingCount.current && prevWaitingCount.current > 0) {
      try { new Audio('data:audio/wav;base64,UklGRl9vT19teleVBRk10AAAACQBAAABAAAAAQA8AB//gAQBkYXRhSAAAAGAAAAAAAAAAAAAAAAA=').play().catch(() => {}); } catch {}
    }
    prevWaitingCount.current = waiting.length;
  }, [waiting.length]);

  // Filter waiting list by search
  const filteredWaiting = useMemo(() => {
    if (!searchFilter) return waiting;
    const q = searchFilter.toLowerCase();
    return waiting.filter((t) =>
      t.ticket_number.toLowerCase().includes(q)
      || ((t.customer_data as any)?.name ?? '').toLowerCase().includes(q)
      || ((t.customer_data as any)?.phone ?? '').includes(q)
    );
  }, [waiting, searchFilter]);

  // Virtualization: only render first N items to avoid DOM bloat with 100+ tickets
  const VISIBLE_CHUNK = 50;
  const [showAllWaiting, setShowAllWaiting] = useState(false);
  const visibleWaiting = useMemo(() => {
    if (showAllWaiting || filteredWaiting.length <= VISIBLE_CHUNK) return filteredWaiting;
    return filteredWaiting.slice(0, VISIBLE_CHUNK);
  }, [filteredWaiting, showAllWaiting]);

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className="station" role="main">
      {/* Left panel — active ticket */}
      <div className="station-main" aria-label="Active ticket area">
        {!session.desk_id ? (
          <div className="no-desk" role="alert">
            <h2>No Desk Assigned</h2>
            <p>Ask your admin to assign you to a desk before you can start serving.</p>
          </div>
        ) : activeTicket ? (
          <div className="active-ticket-panel">
            {activeTicket.status === 'called' ? (
              <>
                <div className="active-status called">CALLING</div>
                <div className="active-number">{activeTicket.ticket_number}</div>
                <div className="active-customer">
                  {(activeTicket.customer_data as any)?.name ?? 'Walk-in Customer'}
                </div>
                {(activeTicket.customer_data as any)?.phone && (
                  <div className="active-phone">{(activeTicket.customer_data as any).phone}</div>
                )}
                {((activeTicket.customer_data as any)?.reason || (activeTicket.customer_data as any)?.notes || (activeTicket as any).notes) && (
                  <div className="active-notes">
                    <strong>Reason:</strong> {(activeTicket.customer_data as any)?.reason || (activeTicket.customer_data as any)?.notes || (activeTicket as any).notes}
                  </div>
                )}
                <div className="active-meta">
                  {names.services[activeTicket.service_id ?? ''] ?? 'Service'} &middot;{' '}
                  {names.departments[activeTicket.department_id ?? ''] ?? 'Dept'}
                </div>

                {/* Countdown */}
                <div className="countdown-ring" role="timer" aria-label={`${callCountdown} seconds remaining`}>
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
                    Start Serving <span className="shortcut-hint">F9</span>
                  </button>
                  <div className="secondary-actions">
                    <button className="btn-outline" onClick={() => recall(activeTicket.id)} aria-label={`Recall ticket ${activeTicket.ticket_number}, recalled ${activeTicket.recall_count} times`}>
                      Recall ({activeTicket.recall_count})
                    </button>
                    <button className="btn-outline btn-warning" onClick={() => noShow(activeTicket.id)} aria-label={`Mark ticket ${activeTicket.ticket_number} as no show`}>
                      No Show
                    </button>
                    <button className="btn-outline" onClick={() => requeue(activeTicket.id)} aria-label={`Send ticket ${activeTicket.ticket_number} back to queue`}>
                      Back to Queue
                    </button>
                    <button className="btn-outline" onClick={() => {
                      const deskList = Object.entries(names.desks).filter(([id]) => id !== session.desk_id);
                      if (deskList.length === 0) { showToast('No other desks available', 'error'); return; }
                      const choices = deskList.map(([id, name], i) => `${i + 1}. ${name}`).join('\n');
                      const pick = prompt(`Transfer to which desk?\n${choices}\nEnter number:`);
                      if (!pick) return;
                      const idx = parseInt(pick) - 1;
                      if (idx >= 0 && idx < deskList.length) {
                        const [targetDeskId, targetDeskName] = deskList[idx];
                        updateTicketStatus(activeTicket.id, { desk_id: targetDeskId, status: 'waiting', called_at: null, called_by_staff_id: null });
                        addActivity(activeTicket.ticket_number, `→ ${targetDeskName}`);
                        showToast(`Transferred to ${targetDeskName}`, 'info');
                      }
                    }} aria-label={`Transfer ticket ${activeTicket.ticket_number} to another desk`}>
                      Transfer
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="active-status serving">NOW SERVING</div>
                <div className="active-number">{activeTicket.ticket_number}</div>
                <div className="active-customer">
                  {(activeTicket.customer_data as any)?.name ?? 'Walk-in Customer'}
                </div>
                {(activeTicket.customer_data as any)?.phone && (
                  <div className="active-phone">{(activeTicket.customer_data as any).phone}</div>
                )}
                {((activeTicket.customer_data as any)?.reason || (activeTicket.customer_data as any)?.notes || (activeTicket as any).notes) && (
                  <div className="active-notes">
                    <strong>Reason:</strong> {(activeTicket.customer_data as any)?.reason || (activeTicket.customer_data as any)?.notes || (activeTicket as any).notes}
                  </div>
                )}
                <div className="active-meta">
                  {names.services[activeTicket.service_id ?? ''] ?? 'Service'} &middot;{' '}
                  {names.departments[activeTicket.department_id ?? ''] ?? 'Dept'}
                </div>

                {/* Serving elapsed timer */}
                <div className="serving-timer" role="timer" aria-label={`Serving for ${Math.floor(servingElapsed / 60)} minutes ${servingElapsed % 60} seconds`} style={{
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
                    Complete Service <span className="shortcut-hint">F10</span>
                  </button>
                  <div className="secondary-actions">
                    <button className="btn-outline btn-warning" onClick={() => noShow(activeTicket.id)}>
                      No Show
                    </button>
                    <button className="btn-outline btn-danger" onClick={() => cancel(activeTicket.id)}>
                      Cancel
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
                  showToast(queuePaused ? 'Queue resumed' : 'Queue paused — no new calls', queuePaused ? 'success' : 'info');
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
                aria-label={queuePaused ? 'Resume queue' : 'Pause queue'}
              >
                {queuePaused ? '▶ Resume' : '⏸ Pause'} <span className="shortcut-hint">F7</span>
              </button>
            )}
            {/* Staff status dropdown */}
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowStatusMenu((v) => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '5px 14px', borderRadius: 20,
                  border: `1.5px solid ${STAFF_STATUS_LABELS[staffStatus].color}40`,
                  background: `${STAFF_STATUS_LABELS[staffStatus].color}12`,
                  cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  color: STAFF_STATUS_LABELS[staffStatus].color,
                }}
                aria-label={`Staff status: ${STAFF_STATUS_LABELS[staffStatus].label}. Click to change.`}
              >
                <span>{STAFF_STATUS_LABELS[staffStatus].icon}</span>
                <span>{STAFF_STATUS_LABELS[staffStatus].label}</span>
                <span style={{ fontSize: 9, opacity: 0.6 }}>▼</span>
              </button>
              {showStatusMenu && (
                <div style={{
                  position: 'absolute', top: '100%', right: 0,
                  marginTop: 4, background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 8, overflow: 'hidden', zIndex: 10, minWidth: 150,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                }}>
                  {(Object.entries(STAFF_STATUS_LABELS) as [StaffStatus, typeof STAFF_STATUS_LABELS[StaffStatus]][]).map(([key, val]) => (
                    <button
                      key={key}
                      onClick={() => {
                        onStaffStatusChange(key);
                        setShowStatusMenu(false);
                        if (key !== 'available' && !queuePaused) onQueuePausedChange(true);
                        if (key === 'available' && queuePaused) onQueuePausedChange(false);
                        showToast(`Status: ${val.label}`, 'info');
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
                <h2>{staffStatus === 'on_break' ? 'On Break' : staffStatus === 'away' ? 'Away' : 'Queue Paused'}</h2>
                <p>{waiting.length} waiting in queue</p>
                <button
                  className="btn-primary btn-xl"
                  onClick={() => { onQueuePausedChange(false); onStaffStatusChange('available'); showToast('Queue resumed', 'success'); }}
                  style={{ background: '#22c55e' }}
                >
                  Resume Queue <span className="shortcut-hint">F7</span>
                </button>
              </>
            ) : (
              <>
                <div className="idle-icon">✓</div>
                <h2>Ready for Next Customer</h2>
                <p>{waiting.length} waiting in queue</p>
                <button
                  className="btn-primary btn-xl"
                  onClick={callNext}
                  disabled={waiting.length === 0}
                  title="F8 or Ctrl+Enter"
                >
                  Call Next ({waiting.length}) <span className="shortcut-hint">F8</span>
                </button>
              </>
            )}
          </div>
          </>
        )}
      </div>

      {/* Right panel — queue overview */}
      <div className="station-sidebar" role="complementary" aria-label="Queue sidebar">
        <div className="sidebar-section">
          <div className="sidebar-header">
            <h3>Queue Overview</h3>
            <div className="queue-stats" aria-label={`${waiting.length} waiting, ${called.length} called, ${serving.length} serving`}>
              <span className="stat-pill waiting" aria-hidden="true">{waiting.length} waiting</span>
              <span className="stat-pill called" aria-hidden="true">{called.length} called</span>
              <span className="stat-pill serving" aria-hidden="true">{serving.length} serving</span>
            </div>
          </div>
        </div>

        <div className="sidebar-section queue-list queue-waiting">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <h4 style={{ margin: 0 }}>Waiting ({waiting.length})</h4>
            {waiting.length > 3 && (
              <input
                type="text"
                placeholder="Search..."
                value={searchFilter}
                onChange={(e) => { setSearchFilter(e.target.value); setShowAllWaiting(false); }}
                className="queue-search"
                aria-label="Search waiting queue by name, phone, or ticket number"
              />
            )}
          </div>
          <div className="ticket-list" role="list" aria-label="Waiting tickets">
            {visibleWaiting.map((t, i) => (
              <div key={t.id} className="queue-item" role="listitem" aria-label={`Position ${i + 1}, ticket ${t.ticket_number}, ${(t.customer_data as any)?.name ?? 'Walk-in'}, waiting ${formatWait(t.created_at)}`}>
                <div className="queue-item-pos" aria-hidden="true">#{i + 1}</div>
                <div className="queue-item-info">
                  <span className="queue-item-number">{t.ticket_number}</span>
                  <span className="queue-item-meta">
                    {(t.customer_data as any)?.name ?? 'Walk-in'} &middot; {formatWait(t.created_at)}
                  </span>
                </div>
                <div className="queue-item-badges">
                  {t.priority > 1 && <span className="badge priority">P{t.priority}</span>}
                  {t.appointment_id && <span className="badge booked">Booked</span>}
                  {t.is_remote && <span className="badge remote">Remote</span>}
                </div>
                {session.desk_id && !activeTicket && !queuePaused && staffStatus === 'available' && (
                  <button
                    className="btn-sm btn-call"
                    aria-label={`Call ticket ${t.ticket_number}`}
                    onClick={() => updateTicketStatus(t.id, {
                      status: 'called',
                      desk_id: session.desk_id,
                      called_by_staff_id: session.staff_id,
                      called_at: new Date().toISOString(),
                    })}
                  >
                    Call
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
                Show all {filteredWaiting.length} tickets ({filteredWaiting.length - VISIBLE_CHUNK} more)
              </button>
            )}
            {filteredWaiting.length === 0 && (
              <div className="queue-empty">{searchFilter ? 'No matches' : 'No customers waiting'}</div>
            )}
          </div>
        </div>

        <div className="sidebar-section queue-list queue-active">
          <h4>Active ({called.length + serving.length})</h4>
          <div className="ticket-list" role="list" aria-label="Active tickets">
            {[...called, ...serving].map((t) => (
              <div key={t.id} className={`queue-item ${t.desk_id === session.desk_id ? 'mine' : ''}`} role="listitem" aria-label={`Ticket ${t.ticket_number}, ${t.status} at ${names.desks[t.desk_id ?? ''] ?? 'desk'}`}>
                <div className="queue-item-dot" style={{ background: statusColor(t.status) }} aria-hidden="true" />
                <div className="queue-item-info">
                  <span className="queue-item-number">{t.ticket_number}</span>
                  <span className="queue-item-meta">
                    {t.status === 'called' ? 'Called' : 'Serving'} at{' '}
                    {names.desks[t.desk_id ?? ''] ?? 'desk'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Activity */}
        {recentActivity.length > 0 && (
          <div className="sidebar-section" style={{ flex: '0 0 auto' }}>
            <h4 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              Recent Activity
            </h4>
            <div className="ticket-list" role="list" aria-label="Recent activity">
              {recentActivity.slice(0, 5).map((a, i) => (
                <div key={i} className="queue-item" role="listitem" style={{ padding: '4px 12px' }}>
                  <div className="queue-item-info">
                    <span className="queue-item-number" style={{ fontSize: 12 }}>{a.ticket}</span>
                    <span className="queue-item-meta">
                      {a.action} &middot; {a.time}
                    </span>
                  </div>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                    background: a.action === 'Completed' ? 'rgba(34,197,94,0.15)' : a.action === 'No Show' ? 'rgba(249,115,22,0.15)' : 'rgba(59,130,246,0.15)',
                    color: a.action === 'Completed' ? '#22c55e' : a.action === 'No Show' ? '#f97316' : '#3b82f6',
                  }}>
                    {a.action}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Device Status */}
        {deviceStatuses.length > 0 && (
          <div className="sidebar-section">
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              Devices
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
                  {d.connected ? 'Online' : 'Offline'}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Local Network URLs */}
        {kioskUrl && (
          <div className="sidebar-section">
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              Local Network
            </div>
            {[
              { label: 'Kiosk (take tickets)', url: kioskUrl, icon: '🎫' },
              { label: 'Display (waiting room TV)', url: kioskUrl.replace('/kiosk', '/display'), icon: '📺' },
            ].map((item) => (
              <div key={item.label} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 2 }}>{item.icon} {item.label}</div>
                <div
                  style={{
                    background: 'var(--surface2)', padding: '6px 10px', borderRadius: 6,
                    fontFamily: 'monospace', fontSize: 12, fontWeight: 600, color: 'var(--primary)',
                    wordBreak: 'break-all', userSelect: 'all', cursor: 'pointer',
                  }}
                  title="Click to copy"
                  onClick={() => navigator.clipboard?.writeText(item.url)}
                >
                  {item.url}
                </div>
              </div>
            ))}
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
              Open on any device on this WiFi network. Works offline.
            </div>
          </div>
        )}
      </div>

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
