import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSupabase, ensureAuth } from '../lib/supabase';
import { t as translate, type DesktopLocale } from '../lib/i18n';
import {
  dateKeyInTz,
  formatTimeInTz,
  getHourInTz,
  getMinuteInTz,
  getWeekDays,
  getWeekRange,
  getMonthGrid,
  getMonthRange,
  shiftWeek,
  shiftMonth,
  formatDayHeader,
  formatMonthYear,
  formatWeekRange,
  formatDuration,
  groupByDate,
  countByDate,
  getStatusColor,
  getServiceColor,
  isWithinHorizon,
  STATUS_LABELS,
  STATUS_COLORS,
  CALENDAR_DAYS,
  type CalendarDayInfo,
  type MonthDayInfo,
  type CalendarAppointment,
  type AppointmentStatus,
} from '@queueflow/shared';

// ── Props ──────────────────────────────────────────────────────────

interface Props {
  organizationId: string;
  officeId: string;
  locale: DesktopLocale;
  storedAuth?: { access_token?: string; refresh_token?: string; email?: string; password?: string };
  departments: Record<string, string>; // id → name
  services: { id: string; name: string; department_id: string; color?: string | null; estimated_service_time?: number }[];
  officeTimezone?: string;
  onClose: () => void;
  onCheckIn?: (appt: any) => Promise<boolean>;
}

type ViewMode = 'week' | 'month';

const HOUR_HEIGHT = 56;
const START_HOUR = 6;
const END_HOUR = 22;

// ── Component ──────────────────────────────────────────────────────

export function CalendarModal({ organizationId, officeId, locale, storedAuth, departments, services, officeTimezone, onClose, onCheckIn }: Props) {
  const t = (k: string, v?: Record<string, any>) => translate(locale, k, v);
  const tz = officeTimezone || 'Africa/Algiers';

  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAppt, setSelectedAppt] = useState<CalendarAppointment | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const serviceMap = useMemo(() => new Map(services.map(s => [s.id, s])), [services]);

  // ── Fetch ──────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await ensureAuth(storedAuth);
      const sb = await getSupabase();
      let range: { start: string; end: string };
      if (viewMode === 'week') {
        range = getWeekRange(currentDate, tz);
      } else {
        range = getMonthRange(currentDate.getFullYear(), currentDate.getMonth(), tz);
      }
      const { data, error } = await sb
        .from('appointments')
        .select(`
          id, office_id, department_id, service_id, staff_id,
          customer_name, customer_phone, customer_email,
          scheduled_at, status, notes, wilaya, ticket_id,
          locale, reminder_sent,
          recurrence_rule, recurrence_parent_id, calendar_token,
          created_at
        `)
        .eq('office_id', officeId)
        .gte('scheduled_at', range.start)
        .lte('scheduled_at', range.end)
        .not('status', 'in', '(cancelled,declined)')
        .order('scheduled_at', { ascending: true })
        .limit(1000);
      if (!error && data) {
        setAppointments(data as CalendarAppointment[]);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [viewMode, currentDate, tz, officeId, storedAuth]);

  useEffect(() => { load(); }, [load]);

  // ── Realtime ───────────────────────────────────────────────────

  useEffect(() => {
    let sub: any;
    (async () => {
      try {
        const sb = await getSupabase();
        sub = sb.channel('calendar-appts')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments', filter: `office_id=eq.${officeId}` }, () => {
            load();
          })
          .subscribe();
      } catch { /* ignore */ }
    })();
    return () => { sub?.unsubscribe?.(); };
  }, [officeId, load]);

  // ── Navigation ─────────────────────────────────────────────────

  const goToday = () => setCurrentDate(new Date());
  const goPrev = () => setCurrentDate(d => viewMode === 'week' ? shiftWeek(d, -1) : shiftMonth(d, -1));
  const goNext = () => {
    const next = viewMode === 'week' ? shiftWeek(currentDate, 1) : shiftMonth(currentDate, 1);
    if (isWithinHorizon(next, 3)) setCurrentDate(next);
  };

  // ── Actions on appointment ─────────────────────────────────────

  const handleCancel = async (appt: CalendarAppointment) => {
    setActionBusy(true);
    try {
      await ensureAuth(storedAuth);
      const sb = await getSupabase();
      await sb.from('appointments').update({ status: 'cancelled' }).eq('id', appt.id);
      if (appt.ticket_id) {
        await sb.from('tickets').update({ status: 'cancelled' }).eq('id', appt.ticket_id);
      }
      setSelectedAppt(null);
      load();
    } catch { /* ignore */ }
    setActionBusy(false);
  };

  const handleCheckIn = async (appt: CalendarAppointment) => {
    if (!onCheckIn) return;
    setActionBusy(true);
    const ok = await onCheckIn(appt);
    if (ok) { setSelectedAppt(null); load(); }
    setActionBusy(false);
  };

  const handleApprove = async (appt: CalendarAppointment) => {
    setActionBusy(true);
    try {
      const resp = await fetch(`https://qflo.net/api/moderate-appointment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appointmentId: appt.id, action: 'approve' }),
      });
      if (resp.ok) { setSelectedAppt(null); load(); }
    } catch { /* ignore */ }
    setActionBusy(false);
  };

  const handleDecline = async (appt: CalendarAppointment) => {
    setActionBusy(true);
    try {
      const resp = await fetch(`https://qflo.net/api/moderate-appointment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appointmentId: appt.id, action: 'decline' }),
      });
      if (resp.ok) { setSelectedAppt(null); load(); }
    } catch { /* ignore */ }
    setActionBusy(false);
  };

  // ── Computed ───────────────────────────────────────────────────

  const weekDays = viewMode === 'week' ? getWeekDays(currentDate, tz) : [];
  const monthDays = viewMode === 'month' ? getMonthGrid(currentDate.getFullYear(), currentDate.getMonth(), tz) : [];
  const apptsByDate = useMemo(() => groupByDate(appointments, tz), [appointments, tz]);
  const apptCounts = useMemo(() => countByDate(appointments, tz), [appointments, tz]);

  const headerLabel = viewMode === 'week' && weekDays.length
    ? formatWeekRange(weekDays[0].date, weekDays[6].date)
    : formatMonthYear(currentDate);

  // ── Styles ─────────────────────────────────────────────────────

  const btnStyle = (active?: boolean): React.CSSProperties => ({
    padding: '5px 12px', borderRadius: 8, border: '1px solid var(--border, #475569)',
    background: active ? '#3b82f6' : 'transparent', color: active ? '#fff' : 'var(--text, #f1f5f9)',
    cursor: 'pointer', fontSize: 12, fontWeight: 600,
  });

  const navBtn: React.CSSProperties = {
    padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border, #475569)',
    background: 'transparent', color: 'var(--text, #f1f5f9)', cursor: 'pointer', fontSize: 16,
  };

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.8)', backdropFilter: 'blur(4px)',
        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--surface, #1e293b)', borderRadius: 14,
          width: '96vw', maxWidth: 1200, height: '92vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          border: '1px solid var(--border, #475569)', boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
        }}
      >
        {/* Toolbar */}
        <div style={{
          padding: '12px 18px', borderBottom: '1px solid var(--border, #475569)',
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          background: 'linear-gradient(180deg, rgba(100,116,139,0.08), transparent)',
        }}>
          <span style={{ fontSize: 20 }}>🗓</span>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text, #f1f5f9)' }}>
            {t('Calendar')}
          </h2>

          <div style={{ display: 'flex', gap: 4, marginLeft: 12 }}>
            <button onClick={goToday} style={btnStyle()}>{t('Today')}</button>
            <button onClick={goPrev} style={navBtn}>◂</button>
            <button onClick={goNext} style={navBtn}>▸</button>
          </div>

          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text, #f1f5f9)', minWidth: 160 }}>
            {headerLabel}
          </span>

          <div style={{ flex: 1 }} />

          {/* View mode toggle */}
          <div style={{ display: 'flex', gap: 2, border: '1px solid var(--border, #475569)', borderRadius: 8, overflow: 'hidden' }}>
            <button onClick={() => setViewMode('week')} style={btnStyle(viewMode === 'week')}>
              {t('Week')}
            </button>
            <button onClick={() => setViewMode('month')} style={btnStyle(viewMode === 'month')}>
              {t('Month')}
            </button>
          </div>

          {loading && (
            <div style={{ width: 16, height: 16, border: '2px solid #3b82f6', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
          )}

          <button onClick={onClose} style={{
            background: 'transparent', border: '1px solid var(--border, #475569)',
            color: 'var(--text2, #94a3b8)', width: 30, height: 30, borderRadius: 8,
            fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>×</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
          {viewMode === 'week' ? (
            <DesktopWeekView
              days={weekDays}
              appointmentsByDate={apptsByDate}
              timezone={tz}
              serviceMap={serviceMap}
              onSelect={setSelectedAppt}
            />
          ) : (
            <DesktopMonthView
              days={monthDays}
              appointmentCounts={apptCounts}
              appointmentsByDate={apptsByDate}
              timezone={tz}
              serviceMap={serviceMap}
              onSelect={setSelectedAppt}
              onDayClick={(date) => { setCurrentDate(date); setViewMode('week'); }}
            />
          )}
        </div>

        {/* Detail panel */}
        {selectedAppt && (
          <DesktopApptDetail
            appointment={selectedAppt}
            timezone={tz}
            serviceMap={serviceMap}
            departments={departments}
            locale={locale}
            actionBusy={actionBusy}
            onClose={() => setSelectedAppt(null)}
            onCancel={() => handleCancel(selectedAppt)}
            onCheckIn={() => handleCheckIn(selectedAppt)}
            onApprove={() => handleApprove(selectedAppt)}
            onDecline={() => handleDecline(selectedAppt)}
          />
        )}
      </div>

      {/* Spin animation */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Desktop Week View ──────────────────────────────────────────────

function DesktopWeekView({
  days, appointmentsByDate, timezone, serviceMap, onSelect,
}: {
  days: CalendarDayInfo[];
  appointmentsByDate: Map<string, CalendarAppointment[]>;
  timezone: string;
  serviceMap: Map<string, any>;
  onSelect: (a: CalendarAppointment) => void;
}) {
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);

  return (
    <div style={{ display: 'flex', minHeight: '100%' }}>
      {/* Time gutter */}
      <div style={{ width: 52, flexShrink: 0, borderRight: '1px solid var(--border, #475569)', background: 'rgba(15,23,42,0.3)' }}>
        <div style={{ height: 40, borderBottom: '1px solid var(--border, #475569)' }} />
        {hours.map(h => (
          <div key={h} style={{ height: HOUR_HEIGHT, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', paddingRight: 6, fontSize: 10, color: '#64748b', marginTop: -6 }}>
            {String(h).padStart(2, '0')}:00
          </div>
        ))}
      </div>

      {/* Day columns */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
        {days.map(day => {
          const dayAppts = appointmentsByDate.get(day.dateKey) ?? [];
          return (
            <div key={day.dateKey} style={{ borderRight: '1px solid var(--border, #334155)', position: 'relative' }}>
              {/* Header */}
              <div style={{
                height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderBottom: '1px solid var(--border, #475569)',
                background: day.isToday ? '#3b82f6' : 'transparent',
                color: day.isToday ? '#fff' : 'var(--text, #f1f5f9)',
                fontSize: 12, fontWeight: day.isToday ? 700 : 500,
              }}>
                {formatDayHeader(day.date, timezone)}
              </div>

              {/* Hour rows */}
              <div style={{ position: 'relative' }}>
                {hours.map(h => (
                  <div key={h} style={{ height: HOUR_HEIGHT, borderBottom: '1px solid var(--border, #1e293b)' }} />
                ))}

                {/* Appointment blocks */}
                {dayAppts.map(appt => {
                  const hour = getHourInTz(appt.scheduled_at, timezone);
                  const minute = getMinuteInTz(appt.scheduled_at, timezone);
                  if (hour < START_HOUR || hour >= END_HOUR) return null;
                  const svc = serviceMap.get(appt.service_id);
                  const duration = svc?.estimated_service_time ?? 30;
                  const top = (hour - START_HOUR) * HOUR_HEIGHT + (minute / 60) * HOUR_HEIGHT;
                  const height = Math.max((duration / 60) * HOUR_HEIGHT, 20);
                  const color = getServiceColor(svc);

                  return (
                    <button
                      key={appt.id}
                      onClick={() => onSelect(appt)}
                      style={{
                        position: 'absolute', left: 2, right: 2, top, borderRadius: 6,
                        height: Math.min(height, (END_HOUR - hour) * HOUR_HEIGHT - (minute / 60) * HOUR_HEIGHT),
                        background: color + 'dd', color: '#fff', border: '1px solid rgba(255,255,255,0.15)',
                        padding: '2px 5px', textAlign: 'left', cursor: 'pointer',
                        fontSize: height < 28 ? 9 : 11, lineHeight: height < 28 ? '11px' : '14px',
                        overflow: 'hidden', zIndex: 10,
                      }}
                      title={`${appt.customer_name} - ${svc?.name ?? ''}`}
                    >
                      <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{appt.customer_name}</div>
                      {height >= 34 && (
                        <div style={{ opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {formatTimeInTz(appt.scheduled_at, timezone)} · {svc?.name ?? ''}
                        </div>
                      )}
                    </button>
                  );
                })}

                {/* Current time indicator */}
                {day.isToday && <DesktopTimeIndicator timezone={timezone} />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DesktopTimeIndicator({ timezone }: { timezone: string }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const iv = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(iv); }, []);
  const h = getHourInTz(now, timezone);
  const m = getMinuteInTz(now, timezone);
  if (h < START_HOUR || h >= END_HOUR) return null;
  const top = (h - START_HOUR) * HOUR_HEIGHT + (m / 60) * HOUR_HEIGHT;
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top, zIndex: 20, pointerEvents: 'none', display: 'flex', alignItems: 'center' }}>
      <div style={{ width: 8, height: 8, borderRadius: 4, background: '#ef4444', marginLeft: -4 }} />
      <div style={{ flex: 1, height: 2, background: '#ef4444' }} />
    </div>
  );
}

// ── Desktop Month View ─────────────────────────────────────────────

function DesktopMonthView({
  days, appointmentCounts, appointmentsByDate, timezone, serviceMap, onSelect, onDayClick,
}: {
  days: MonthDayInfo[];
  appointmentCounts: Map<string, number>;
  appointmentsByDate: Map<string, CalendarAppointment[]>;
  timezone: string;
  serviceMap: Map<string, any>;
  onSelect: (a: CalendarAppointment) => void;
  onDayClick: (date: Date) => void;
}) {
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const weeks: MonthDayInfo[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Day name headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--border, #475569)', background: 'rgba(15,23,42,0.3)' }}>
        {dayNames.map(d => (
          <div key={d} style={{ textAlign: 'center', padding: '6px 0', fontSize: 11, fontWeight: 600, color: '#64748b' }}>{d}</div>
        ))}
      </div>

      {/* Grid */}
      <div style={{ flex: 1, display: 'grid', gridTemplateRows: `repeat(${weeks.length}, 1fr)` }}>
        {weeks.map((week, wi) => (
          <div key={wi} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--border, #334155)' }}>
            {week.map(day => {
              const count = appointmentCounts.get(day.dateKey) ?? 0;
              const dayAppts = (appointmentsByDate.get(day.dateKey) ?? []).slice(0, 3);
              return (
                <div
                  key={day.dateKey}
                  onClick={() => onDayClick(day.date)}
                  style={{
                    borderRight: '1px solid var(--border, #334155)', padding: 4, minHeight: 70,
                    cursor: 'pointer', opacity: day.isCurrentMonth ? 1 : 0.35,
                    background: day.isToday ? 'rgba(59,130,246,0.08)' : 'transparent',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{
                      fontSize: 11, fontWeight: day.isToday ? 700 : 500,
                      width: 22, height: 22, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: day.isToday ? '#3b82f6' : 'transparent',
                      color: day.isToday ? '#fff' : 'var(--text, #f1f5f9)',
                    }}>
                      {day.date.getDate()}
                    </span>
                    {count > 0 && (
                      <span style={{ fontSize: 9, fontWeight: 700, color: '#3b82f6', background: 'rgba(59,130,246,0.15)', borderRadius: 8, padding: '1px 5px' }}>
                        {count}
                      </span>
                    )}
                  </div>
                  {dayAppts.map(a => {
                    const svc = serviceMap.get(a.service_id);
                    const color = getServiceColor(svc);
                    return (
                      <button
                        key={a.id}
                        onClick={e => { e.stopPropagation(); onSelect(a); }}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left', fontSize: 9, padding: '1px 4px',
                          borderRadius: 3, marginBottom: 1, overflow: 'hidden', textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap', background: color + 'bb', color: '#fff', cursor: 'pointer',
                          border: 'none', fontWeight: 500,
                        }}
                        title={`${formatTimeInTz(a.scheduled_at, timezone)} ${a.customer_name}`}
                      >
                        {formatTimeInTz(a.scheduled_at, timezone)} {a.customer_name}
                      </button>
                    );
                  })}
                  {count > 3 && (
                    <span style={{ fontSize: 8, color: '#64748b' }}>+{count - 3} more</span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Desktop Appointment Detail Panel ───────────────────────────────

function DesktopApptDetail({
  appointment: a, timezone, serviceMap, departments, locale, actionBusy,
  onClose, onCancel, onCheckIn, onApprove, onDecline,
}: {
  appointment: CalendarAppointment;
  timezone: string;
  serviceMap: Map<string, any>;
  departments: Record<string, string>;
  locale: DesktopLocale;
  actionBusy: boolean;
  onClose: () => void;
  onCancel: () => void;
  onCheckIn: () => void;
  onApprove: () => void;
  onDecline: () => void;
}) {
  const t = (k: string) => translate(locale, k);
  const svc = serviceMap.get(a.service_id);
  const dept = a.department_id ? departments[a.department_id] : null;
  const statusColor = getStatusColor(a.status);
  const serviceColor = getServiceColor(svc);
  const d = new Date(a.scheduled_at);
  const isActive = !['cancelled', 'completed', 'no_show', 'declined'].includes(a.status);

  const labelStyle: React.CSSProperties = { fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 };
  const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text, #f1f5f9)', marginBottom: 6 };
  const actionBtn = (bg: string, color: string): React.CSSProperties => ({
    flex: 1, padding: '8px 12px', borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 600,
    cursor: actionBusy ? 'not-allowed' : 'pointer', opacity: actionBusy ? 0.5 : 1,
    background: bg, color,
  });

  return (
    <div style={{
      position: 'absolute', top: 0, right: 0, bottom: 0, width: 380, maxWidth: '50%',
      background: 'var(--surface, #1e293b)', borderLeft: '1px solid var(--border, #475569)',
      boxShadow: '-8px 0 32px rgba(0,0,0,0.3)', overflow: 'auto', zIndex: 50,
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 16px', borderBottom: '1px solid var(--border, #475569)',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{ width: 10, height: 10, borderRadius: 5, background: serviceColor, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text, #f1f5f9)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {a.customer_name}
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8' }}>
            {svc?.name ?? 'Service'} · {dept ?? 'Department'}
          </div>
        </div>
        <button onClick={onClose} style={{
          width: 28, height: 28, borderRadius: 7, border: '1px solid var(--border, #475569)',
          background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: 14,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>×</button>
      </div>

      {/* Body */}
      <div style={{ padding: 16 }}>
        {/* Status */}
        <div style={{ marginBottom: 14 }}>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 12, color: '#fff', background: statusColor }}>
            {STATUS_LABELS[a.status] ?? a.status}
          </span>
        </div>

        {/* Date & time */}
        <div style={{ background: 'rgba(15,23,42,0.4)', borderRadius: 10, padding: 12, marginBottom: 14 }}>
          <div style={rowStyle}>
            <span style={{ fontSize: 14 }}>📅</span>
            {d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: timezone })}
          </div>
          <div style={rowStyle}>
            <span style={{ fontSize: 14 }}>🕐</span>
            {formatTimeInTz(a.scheduled_at, timezone)}
            {svc && ` · ${formatDuration(svc.estimated_service_time ?? 30)}`}
          </div>
        </div>

        {/* Customer */}
        <div style={labelStyle}>Customer</div>
        <div style={rowStyle}>👤 {a.customer_name}</div>
        {a.customer_phone && <div style={rowStyle}>📞 {a.customer_phone}</div>}
        {a.customer_email && <div style={rowStyle}>✉ {a.customer_email}</div>}
        {(a as any).wilaya && <div style={rowStyle}>📍 {(a as any).wilaya}</div>}

        {/* Notes */}
        {a.notes && (
          <>
            <div style={{ ...labelStyle, marginTop: 14 }}>Notes</div>
            <div style={{ fontSize: 12, color: 'var(--text, #f1f5f9)', background: 'rgba(15,23,42,0.4)', borderRadius: 8, padding: 10, marginBottom: 14 }}>
              {a.notes}
            </div>
          </>
        )}

        {/* Actions */}
        {isActive && (
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {a.status === 'pending' && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={onApprove} disabled={actionBusy} style={actionBtn('#22c55e', '#fff')}>
                  ✓ Approve
                </button>
                <button onClick={onDecline} disabled={actionBusy} style={actionBtn('#ef4444', '#fff')}>
                  ✗ Decline
                </button>
              </div>
            )}
            {a.status === 'confirmed' && (
              <button onClick={onCheckIn} disabled={actionBusy} style={actionBtn('#8b5cf6', '#fff')}>
                Check In
              </button>
            )}
            <button onClick={onCancel} disabled={actionBusy} style={actionBtn('rgba(239,68,68,0.15)', '#ef4444')}>
              Cancel Appointment
            </button>
          </div>
        )}

        {/* Meta */}
        <div style={{ marginTop: 16, fontSize: 10, color: '#475569' }}>
          <div>Created: {new Date(a.created_at).toLocaleString()}</div>
          <div>ID: {a.id.slice(0, 8)}</div>
        </div>
      </div>
    </div>
  );
}
