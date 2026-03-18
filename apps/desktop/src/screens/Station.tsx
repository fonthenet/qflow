import { useState, useEffect, useCallback, useRef } from 'react';
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

export function Station({ session, isOnline }: Props) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);
  const [names, setNames] = useState<Record<string, Record<string, string>>>({
    departments: {}, services: {}, desks: {},
  });
  const [callCountdown, setCallCountdown] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const CALL_TIMEOUT = 60;

  // ── Fetch tickets ────────────────────────────────────────────────

  const fetchTickets = useCallback(async () => {
    if (isOnline) {
      try {
        const supabase = await getSupabase();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const { data } = await supabase
          .from('tickets')
          .select('*')
          .eq('office_id', session.office_id)
          .in('status', ['waiting', 'called', 'serving'])
          .gte('created_at', today.toISOString())
          .order('priority', { ascending: false, nullsFirst: true })
          .order('created_at', { ascending: true })
          .limit(200);

        if (data) setTickets(data as Ticket[]);
      } catch {
        // Fall back to local
        const local = await window.qf.db.getTickets(
          session.office_id,
          ['waiting', 'called', 'serving']
        );
        setTickets(local.map(parseLocalTicket));
      }
    } else {
      const local = await window.qf.db.getTickets(
        session.office_id,
        ['waiting', 'called', 'serving']
      );
      setTickets(local.map(parseLocalTicket));
    }
  }, [isOnline, session.office_id]);

  // ── Load names for departments, services, desks ─────────────────

  useEffect(() => {
    if (!isOnline) return;
    (async () => {
      const supabase = await getSupabase();
      const [depts, svcs, desks] = await Promise.all([
        supabase.from('departments').select('id, name').in('office_id', session.office_ids),
        supabase.from('services').select('id, name'),
        supabase.from('desks').select('id, name').in('office_id', session.office_ids),
      ]);

      setNames({
        departments: Object.fromEntries((depts.data ?? []).map((d: any) => [d.id, d.name])),
        services: Object.fromEntries((svcs.data ?? []).map((s: any) => [s.id, s.name])),
        desks: Object.fromEntries((desks.data ?? []).map((d: any) => [d.id, d.name])),
      });
    })();
  }, [isOnline, session.office_ids]);

  // ── Polling ─────────────────────────────────────────────────────

  useEffect(() => {
    fetchTickets();
    const iv = setInterval(fetchTickets, 3000);
    return () => clearInterval(iv);
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
  }, [tickets, session.desk_id]);

  // ── Actions ─────────────────────────────────────────────────────

  const callNext = async () => {
    if (isOnline) {
      try {
        const supabase = await getSupabase();
        const { data } = await supabase.rpc('call_next_ticket', {
          p_desk_id: session.desk_id,
          p_staff_id: session.staff_id,
        });
        if (!data) {
          // Fallback: any waiting ticket in office
          const { data: fallback } = await supabase
            .from('tickets')
            .select('id')
            .eq('office_id', session.office_id)
            .eq('status', 'waiting')
            .is('parked_at', null)
            .order('priority', { ascending: false, nullsFirst: true })
            .order('created_at', { ascending: true })
            .limit(1)
            .single();

          if (fallback) {
            await supabase.from('tickets').update({
              status: 'called',
              desk_id: session.desk_id,
              called_by_staff_id: session.staff_id,
              called_at: new Date().toISOString(),
            }).eq('id', fallback.id);
          }
        }
      } catch {
        await window.qf.db.callNext(session.office_id, session.desk_id!, session.staff_id);
      }
    } else {
      await window.qf.db.callNext(session.office_id, session.desk_id!, session.staff_id);
    }
    fetchTickets();
  };

  const updateTicketStatus = async (ticketId: string, updates: Record<string, any>) => {
    if (isOnline) {
      try {
        const supabase = await getSupabase();
        await supabase.from('tickets').update(updates).eq('id', ticketId);
      } catch {
        await window.qf.db.updateTicket(ticketId, updates);
      }
    } else {
      await window.qf.db.updateTicket(ticketId, updates);
    }
    fetchTickets();
  };

  const startServing = (id: string) =>
    updateTicketStatus(id, { status: 'serving', serving_started_at: new Date().toISOString() });

  const complete = (id: string) =>
    updateTicketStatus(id, { status: 'served', completed_at: new Date().toISOString() });

  const noShow = (id: string) =>
    updateTicketStatus(id, { status: 'no_show', completed_at: new Date().toISOString() });

  const recall = async (id: string) => {
    await updateTicketStatus(id, {
      called_at: new Date().toISOString(),
      recall_count: (activeTicket?.recall_count ?? 0) + 1,
    });
  };

  const requeue = (id: string) =>
    updateTicketStatus(id, { status: 'waiting', desk_id: null, called_at: null, called_by_staff_id: null });

  const cancel = (id: string) =>
    updateTicketStatus(id, { status: 'cancelled', cancelled_at: new Date().toISOString() });

  // ── Derived data ────────────────────────────────────────────────

  const [kioskUrl, setKioskUrl] = useState<string | null>(null);

  useEffect(() => {
    window.qf.kiosk?.getUrl?.().then((url: string | null) => setKioskUrl(url));
  }, []);

  const waiting = tickets.filter((t) => t.status === 'waiting' && !t.parked_at);
  const called = tickets.filter((t) => t.status === 'called');
  const serving = tickets.filter((t) => t.status === 'serving');

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className="station">
      {/* Left panel — active ticket */}
      <div className="station-main">
        {!session.desk_id ? (
          <div className="no-desk">
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
                <div className="active-meta">
                  {names.services[activeTicket.service_id ?? ''] ?? 'Service'} &middot;{' '}
                  {names.departments[activeTicket.department_id ?? ''] ?? 'Dept'}
                </div>

                {/* Countdown */}
                <div className="countdown-ring">
                  <svg viewBox="0 0 100 100">
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
                  <button className="btn-primary btn-lg" onClick={() => startServing(activeTicket.id)}>
                    Start Serving
                  </button>
                  <div className="secondary-actions">
                    <button className="btn-outline" onClick={() => recall(activeTicket.id)}>
                      Recall ({activeTicket.recall_count})
                    </button>
                    <button className="btn-outline btn-warning" onClick={() => noShow(activeTicket.id)}>
                      No Show
                    </button>
                    <button className="btn-outline" onClick={() => requeue(activeTicket.id)}>
                      Back to Queue
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
                {(activeTicket.customer_data as any)?.notes && (
                  <div className="active-notes">
                    <strong>Note:</strong> {(activeTicket.customer_data as any).notes}
                  </div>
                )}
                <div className="active-meta">
                  {names.services[activeTicket.service_id ?? ''] ?? 'Service'} &middot;{' '}
                  {names.departments[activeTicket.department_id ?? ''] ?? 'Dept'}
                </div>

                <div className="active-actions">
                  <button className="btn-success btn-lg" onClick={() => complete(activeTicket.id)}>
                    Complete Service
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
          <div className="idle-panel">
            <div className="idle-icon">✓</div>
            <h2>Ready for Next Customer</h2>
            <p>{waiting.length} waiting in queue</p>
            <button
              className="btn-primary btn-xl"
              onClick={callNext}
              disabled={waiting.length === 0}
            >
              Call Next ({waiting.length})
            </button>
          </div>
        )}
      </div>

      {/* Right panel — queue overview */}
      <div className="station-sidebar">
        <div className="sidebar-section">
          <div className="sidebar-header">
            <h3>Queue Overview</h3>
            <div className="queue-stats">
              <span className="stat-pill waiting">{waiting.length} waiting</span>
              <span className="stat-pill called">{called.length} called</span>
              <span className="stat-pill serving">{serving.length} serving</span>
            </div>
          </div>
        </div>

        <div className="sidebar-section queue-list">
          <h4>Waiting ({waiting.length})</h4>
          <div className="ticket-list">
            {waiting.map((t, i) => (
              <div key={t.id} className="queue-item">
                <div className="queue-item-pos">#{i + 1}</div>
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
                {session.desk_id && !activeTicket && (
                  <button
                    className="btn-sm btn-call"
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
            {waiting.length === 0 && (
              <div className="queue-empty">No customers waiting</div>
            )}
          </div>
        </div>

        <div className="sidebar-section queue-list">
          <h4>Active ({called.length + serving.length})</h4>
          <div className="ticket-list">
            {[...called, ...serving].map((t) => (
              <div key={t.id} className={`queue-item ${t.desk_id === session.desk_id ? 'mine' : ''}`}>
                <div className="queue-item-dot" style={{ background: statusColor(t.status) }} />
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

        {/* Local Network URLs */}
        {kioskUrl && (
          <div className="sidebar-section" style={{ marginTop: 'auto', borderTop: '1px solid var(--border)' }}>
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
    </div>
  );
}

function parseLocalTicket(row: any): Ticket {
  return {
    ...row,
    customer_data: typeof row.customer_data === 'string' ? JSON.parse(row.customer_data) : row.customer_data ?? {},
    is_remote: !!row.is_remote,
    is_offline: !!row.is_offline,
  };
}
