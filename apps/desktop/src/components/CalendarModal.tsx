import { useCallback, useEffect, useMemo, useState } from 'react';
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
  CALENDAR_DAYS,
  type CalendarDay,
  type CalendarDayInfo,
  type MonthDayInfo,
  type CalendarAppointment,
} from '@queueflow/shared';

// ── Schedule types ────────────────────────────────────────────────

type OperatingHours = Record<string, { open: string; close: string }> | null;

/** JS Date.getDay() → CalendarDay name */
const JS_DAY_TO_NAME: CalendarDay[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Check if a day is closed (00:00–00:00 or missing) */
function isDayClosed(oh: OperatingHours, dayName: string): boolean {
  if (!oh) return false; // null means no schedule configured → treat as open
  const h = oh[dayName];
  if (!h) return true;
  return h.open === '00:00' && h.close === '00:00';
}

/** Parse "HH:MM" → fractional hour (e.g. "08:30" → 8.5) */
function parseHHMM(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h + (m || 0) / 60;
}

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

const SLOT_HEIGHT = 28;
const HOUR_HEIGHT = SLOT_HEIGHT * 2;
const START_HOUR = 6;
const END_HOUR = 22;
const LOCALE_MAP: Record<string, string> = { fr: 'fr-FR', ar: 'ar-SA', en: 'en-US' };

const APPT_SELECT = `
  id, office_id, department_id, service_id, staff_id,
  customer_name, customer_phone, customer_email,
  scheduled_at, status, notes, wilaya, ticket_id,
  locale, reminder_sent,
  recurrence_rule, recurrence_parent_id, calendar_token,
  source, created_at
`;

// ── Main Component ────────────────────────────────────────────────

export function CalendarModal({ organizationId, officeId, locale, storedAuth, departments, services, officeTimezone, onClose, onCheckIn }: Props) {
  const t = (k: string, v?: Record<string, any>) => translate(locale, k, v);
  const tz = officeTimezone || 'Africa/Algiers';
  const intlLocale = LOCALE_MAP[locale] ?? 'en-US';

  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAppt, setSelectedAppt] = useState<CalendarAppointment | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [operatingHours, setOperatingHours] = useState<OperatingHours>(null);
  const [alwaysOpen, setAlwaysOpen] = useState(false);

  const serviceMap = useMemo(() => new Map(services.map(s => [s.id, s])), [services]);

  // ── Load schedule (once on mount) ─────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        await ensureAuth(storedAuth);
        const sb = await getSupabase();
        const { data: office } = await sb.from('offices').select('operating_hours, settings').eq('id', officeId).single();
        if (office?.operating_hours) setOperatingHours(office.operating_hours as OperatingHours);
        // Resolve override mode from org (source of truth) — ignore stale office copies
        const { data: org } = await sb.from('organizations').select('settings').eq('id', organizationId).single();
        const orgMode = (org?.settings as any)?.visit_intake_override_mode;
        // Only 'always_open' explicitly set at org level triggers always-open
        setAlwaysOpen(orgMode === 'always_open');
        // Clean up stale office setting if it disagrees with org
        const officeMode = (office?.settings as any)?.visit_intake_override_mode;
        const resolvedMode = typeof orgMode === 'string' ? orgMode : 'business_hours';
        if (officeMode && officeMode !== resolvedMode) {
          const officeSettings = ((office?.settings as Record<string, any>) ?? {});
          await sb.from('offices').update({
            settings: { ...officeSettings, visit_intake_override_mode: resolvedMode },
          }).eq('id', officeId);
        }
      } catch { /* ignore */ }
    })();
  }, [officeId, organizationId, storedAuth]);

  // Always compute week days from currentDate (needed for mini calendar highlight even in month mode)
  const weekDays = useMemo(() => getWeekDays(currentDate, tz), [currentDate, tz]);
  const monthDays = viewMode === 'month' ? getMonthGrid(currentDate.getFullYear(), currentDate.getMonth(), tz) : [];

  // Selected date key — the specific date the user navigated to
  const selectedDateKey = useMemo(() => dateKeyInTz(currentDate, tz), [currentDate, tz]);

  // ── Fetch — always load the FULL MONTH so mini calendar dots are accurate ──

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await ensureAuth(storedAuth);
      const sb = await getSupabase();
      // Always fetch full month range so the mini calendar has complete dot data
      const monthRange = getMonthRange(currentDate.getFullYear(), currentDate.getMonth(), tz);
      const { data, error } = await sb
        .from('appointments')
        .select(APPT_SELECT)
        .eq('office_id', officeId)
        .gte('scheduled_at', monthRange.start)
        .lte('scheduled_at', monthRange.end)
        .not('status', 'in', '(cancelled,declined)')
        .order('scheduled_at', { ascending: true })
        .limit(2000);
      if (!error && data) {
        setAppointments(data as CalendarAppointment[]);
      }
    } catch (err) { console.error('[Calendar] load error:', err); }
    setLoading(false);
  }, [currentDate.getFullYear(), currentDate.getMonth(), tz, officeId, storedAuth]);

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

  // Called by mini calendar when user clicks a date
  const handleMiniDateClick = (d: Date) => {
    setCurrentDate(d);
    if (viewMode === 'month') setViewMode('week');
  };

  // Called by mini calendar arrows — navigates the main view month
  const handleMiniMonthNav = (d: Date) => {
    if (isWithinHorizon(d, 3)) setCurrentDate(d);
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
      const resp = await fetch('https://qflo.net/api/moderate-appointment', {
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
      const resp = await fetch('https://qflo.net/api/moderate-appointment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appointmentId: appt.id, action: 'decline' }),
      });
      if (resp.ok) { setSelectedAppt(null); load(); }
    } catch { /* ignore */ }
    setActionBusy(false);
  };

  // ── Computed data ─────────────────────────────────────────────

  const apptsByDate = useMemo(() => groupByDate(appointments, tz), [appointments, tz]);
  const apptCounts = useMemo(() => countByDate(appointments, tz), [appointments, tz]);

  const headerLabel = viewMode === 'week' && weekDays.length
    ? formatWeekRange(weekDays[0].date, weekDays[6].date, intlLocale)
    : formatMonthYear(currentDate, intlLocale);

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
          width: '97vw', maxWidth: 1440, height: '92vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          border: '1px solid var(--border, #475569)', boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
        }}
      >
        {/* ─── Toolbar ─── */}
        <div style={{
          padding: '12px 18px', borderBottom: '1px solid var(--border, #475569)',
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          background: 'linear-gradient(180deg, rgba(100,116,139,0.08), transparent)',
        }}>
          <span style={{ fontSize: 20 }}>🗓</span>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text, #f1f5f9)' }}>
            {t('Calendar')}
          </h2>
          <span style={{
            fontSize: 11, fontWeight: 700, color: '#3b82f6',
            background: 'rgba(59,130,246,0.12)', borderRadius: 10, padding: '2px 8px',
          }}>
            {appointments.length}
          </span>

          <div style={{ display: 'flex', gap: 4, marginLeft: 12 }}>
            <button onClick={goToday} style={btnStyle()}>{t('Today')}</button>
            <button onClick={goPrev} style={navBtn}>◂</button>
            <button onClick={goNext} style={navBtn}>▸</button>
          </div>

          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text, #f1f5f9)', minWidth: 160 }}>
            {headerLabel}
          </span>

          <div style={{ flex: 1 }} />

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

        {/* ─── Body: sidebar | calendar grid | detail panel ─── */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* Left sidebar */}
          <div style={{
            width: 220, flexShrink: 0, borderRight: '1px solid var(--border, #334155)',
            overflow: 'auto', padding: '12px 10px',
            background: 'var(--surface, #1e293b)',
            display: 'flex', flexDirection: 'column',
          }}>
            <MiniCalendar
              currentDate={currentDate}
              selectedDateKey={selectedDateKey}
              weekDays={weekDays}
              appointmentCounts={apptCounts}
              intlLocale={intlLocale}
              timezone={tz}
              operatingHours={alwaysOpen ? null : operatingHours}
              onDateClick={handleMiniDateClick}
              onMonthNav={handleMiniMonthNav}
            />

            {/* Today's schedule */}
            {operatingHours && !alwaysOpen && (() => {
              const todayName = JS_DAY_TO_NAME[new Date().getDay()];
              const todayHours = operatingHours[todayName];
              const closed = !todayHours || (todayHours.open === '00:00' && todayHours.close === '00:00');
              return (
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border, #334155)' }}>
                  <div style={{
                    fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase',
                    letterSpacing: 0.6, marginBottom: 6, paddingLeft: 2,
                  }}>
                    {t('Schedule')}
                  </div>
                  {CALENDAR_DAYS.map(day => {
                    const h = operatingHours[day];
                    const isClosed = !h || (h.open === '00:00' && h.close === '00:00');
                    const isCurrentDay = day === todayName;
                    return (
                      <div key={day} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '2px 2px', fontSize: 10,
                        color: isClosed ? '#475569' : 'var(--text, #f1f5f9)',
                        fontWeight: isCurrentDay ? 700 : 400,
                        background: isCurrentDay ? 'rgba(59,130,246,0.08)' : 'transparent',
                        borderRadius: 3,
                      }}>
                        <span style={{ textTransform: 'capitalize' }}>
                          {new Intl.DateTimeFormat(intlLocale, { weekday: 'short' }).format(
                            new Date(2026, 0, 5 + CALENDAR_DAYS.indexOf(day))
                          )}
                        </span>
                        <span style={{ fontSize: 9, color: isClosed ? '#ef4444' : '#64748b' }}>
                          {isClosed ? t('Closed') : `${h!.open} – ${h!.close}`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {alwaysOpen && (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border, #334155)' }}>
                <div style={{
                  fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase',
                  letterSpacing: 0.6, marginBottom: 6, paddingLeft: 2,
                }}>
                  {t('Schedule')}
                </div>
                <div style={{ fontSize: 11, color: '#22c55e', fontWeight: 600, paddingLeft: 2 }}>
                  ● {t('sm.field.always_open')}
                </div>
              </div>
            )}

            {/* Service legend */}
            {services.length > 0 && (
              <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border, #334155)' }}>
                <div style={{
                  fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase',
                  letterSpacing: 0.6, marginBottom: 8, paddingLeft: 2,
                }}>
                  {t('Services')}
                </div>
                {services.map(s => (
                  <div key={s.id} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '4px 2px',
                    fontSize: 11, color: 'var(--text, #f1f5f9)',
                  }}>
                    <span style={{
                      width: 10, height: 10, borderRadius: 3, flexShrink: 0,
                      background: s.color || '#3b82f6',
                    }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Departments legend */}
            {Object.keys(departments).length > 0 && (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border, #334155)' }}>
                <div style={{
                  fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase',
                  letterSpacing: 0.6, marginBottom: 8, paddingLeft: 2,
                }}>
                  {t('Departments')}
                </div>
                {Object.entries(departments).map(([id, name]) => (
                  <div key={id} style={{
                    fontSize: 11, color: 'var(--text2, #94a3b8)', padding: '3px 2px',
                  }}>
                    {name}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Calendar grid */}
          <div style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
            {viewMode === 'week' ? (
              <DesktopWeekView
                days={weekDays}
                appointmentsByDate={apptsByDate}
                timezone={tz}
                serviceMap={serviceMap}
                intlLocale={intlLocale}
                locale={locale}
                selectedApptId={selectedAppt?.id ?? null}
                operatingHours={alwaysOpen ? null : operatingHours}
                onSelect={setSelectedAppt}
              />
            ) : (
              <DesktopMonthView
                days={monthDays}
                appointmentCounts={apptCounts}
                appointmentsByDate={apptsByDate}
                timezone={tz}
                serviceMap={serviceMap}
                intlLocale={intlLocale}
                locale={locale}
                operatingHours={alwaysOpen ? null : operatingHours}
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
              intlLocale={intlLocale}
              actionBusy={actionBusy}
              onClose={() => setSelectedAppt(null)}
              onCancel={() => handleCancel(selectedAppt)}
              onCheckIn={() => handleCheckIn(selectedAppt)}
              onApprove={() => handleApprove(selectedAppt)}
              onDecline={() => handleDecline(selectedAppt)}
            />
          )}
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Mini Calendar ─────────────────────────────────────────────────

function MiniCalendar({
  currentDate, selectedDateKey, weekDays, appointmentCounts,
  intlLocale, timezone, operatingHours, onDateClick, onMonthNav,
}: {
  currentDate: Date;
  selectedDateKey: string;
  weekDays: CalendarDayInfo[];
  appointmentCounts: Map<string, number>;
  intlLocale: string;
  timezone: string;
  operatingHours: OperatingHours;
  onDateClick: (d: Date) => void;
  onMonthNav: (d: Date) => void;
}) {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // Localized narrow day names (L, M, M, J, V, S, D)
  const dayHeaders = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(2026, 0, 5 + i); // Jan 5 2026 = Monday
    return new Intl.DateTimeFormat(intlLocale, { weekday: 'narrow' }).format(d);
  }), [intlLocale]);

  // Month label (avril 2026, أبريل 2026, etc.)
  const monthLabel = new Intl.DateTimeFormat(intlLocale, { month: 'long', year: 'numeric' }).format(
    new Date(year, month, 15)
  );

  // Build 6×7 grid starting from Monday
  const cells = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    let startDow = firstDay.getDay() - 1;
    if (startDow < 0) startDow = 6;
    const gridStart = new Date(year, month, 1 - startDow);
    return Array.from({ length: 42 }, (_, i) =>
      new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i)
    );
  }, [year, month]);

  // Week highlight set
  const weekKeySet = useMemo(() => new Set(weekDays.map(d => d.dateKey)), [weekDays]);
  const todayKey = useMemo(() => dateKeyInTz(new Date(), timezone), [timezone]);

  const goPrev = () => onMonthNav(new Date(year, month - 1, 1));
  const goNext = () => onMonthNav(new Date(year, month + 1, 1));

  return (
    <div>
      {/* Month header with navigation */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <button onClick={goPrev} style={{
          background: 'transparent', border: 'none', color: 'var(--text2, #94a3b8)',
          cursor: 'pointer', fontSize: 14, padding: '2px 6px', borderRadius: 4,
        }}>◂</button>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text, #f1f5f9)', textTransform: 'capitalize' }}>
          {monthLabel}
        </span>
        <button onClick={goNext} style={{
          background: 'transparent', border: 'none', color: 'var(--text2, #94a3b8)',
          cursor: 'pointer', fontSize: 14, padding: '2px 6px', borderRadius: 4,
        }}>▸</button>
      </div>

      {/* Day name headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
        {dayHeaders.map((d, i) => (
          <div key={i} style={{
            textAlign: 'center', fontSize: 9, fontWeight: 600, color: '#64748b', padding: '3px 0',
          }}>{d}</div>
        ))}
      </div>

      {/* Date grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
        {cells.map((cell, i) => {
          const cellKey = dateKeyInTz(cell, timezone);
          const isCurrentMonth = cell.getMonth() === month;
          const isToday = cellKey === todayKey;
          const isSelected = cellKey === selectedDateKey;
          const isInWeek = weekKeySet.has(cellKey);
          const count = appointmentCounts.get(cellKey) ?? 0;
          const cellDayName = JS_DAY_TO_NAME[cell.getDay()];
          const cellClosed = operatingHours ? isDayClosed(operatingHours, cellDayName) : false;

          // Priority: selected > today > in-week > default
          let bg = 'transparent';
          let fg = isCurrentMonth ? (cellClosed ? '#475569' : 'var(--text, #f1f5f9)') : '#334155';
          let fontWeight = 500;
          let border = 'none';

          if (isInWeek && !isSelected && !isToday) {
            bg = 'rgba(59,130,246,0.08)';
          }
          if (isToday && !isSelected) {
            bg = '#3b82f6';
            fg = '#fff';
            fontWeight = 800;
          }
          if (isSelected) {
            bg = '#2563eb';
            fg = '#fff';
            fontWeight = 800;
            border = '2px solid #60a5fa';
          }

          return (
            <button
              key={i}
              onClick={() => onDateClick(cell)}
              style={{
                width: '100%', height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight, border, cursor: 'pointer', borderRadius: 5,
                position: 'relative', background: bg, color: fg,
                transition: 'all 0.1s ease',
              }}
            >
              {cell.getDate()}
              {/* Appointment dot indicator */}
              {count > 0 && !isSelected && !isToday && (
                <span style={{
                  position: 'absolute', bottom: 1, left: '50%', transform: 'translateX(-50%)',
                  width: 4, height: 4, borderRadius: 2, background: '#3b82f6',
                }} />
              )}
              {/* Count badge for today or selected date */}
              {count > 0 && (isSelected || isToday) && (
                <span style={{
                  position: 'absolute', top: -2, right: -2,
                  minWidth: 12, height: 12, borderRadius: 6,
                  background: '#ef4444', color: '#fff',
                  fontSize: 7, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: '0 2px',
                }}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Desktop Week View ──────────────────────────────────────────────

function DesktopWeekView({
  days, appointmentsByDate, timezone, serviceMap, intlLocale, locale, selectedApptId, operatingHours, onSelect,
}: {
  days: CalendarDayInfo[];
  appointmentsByDate: Map<string, CalendarAppointment[]>;
  timezone: string;
  serviceMap: Map<string, any>;
  intlLocale: string;
  locale: DesktopLocale;
  selectedApptId: string | null;
  operatingHours: OperatingHours;
  onSelect: (a: CalendarAppointment) => void;
}) {
  const slots: { hour: number; minute: number; label: string }[] = [];
  for (let h = START_HOUR; h < END_HOUR; h++) {
    slots.push({ hour: h, minute: 0, label: `${String(h).padStart(2, '0')}:00` });
    slots.push({ hour: h, minute: 30, label: `${String(h).padStart(2, '0')}:30` });
  }

  return (
    <div style={{ display: 'flex', minHeight: '100%' }}>
      {/* Time gutter */}
      <div style={{ width: 52, flexShrink: 0, borderRight: '1px solid var(--border, #334155)' }}>
        <div style={{ height: 40, borderBottom: '1px solid var(--border, #475569)' }} />
        {slots.map(s => (
          <div key={s.label} style={{
            height: SLOT_HEIGHT,
            display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end',
            paddingRight: 8, marginTop: -5,
            fontSize: s.minute === 0 ? 10 : 9,
            color: s.minute === 0 ? 'var(--text2, #94a3b8)' : 'var(--text3, #475569)',
            fontWeight: s.minute === 0 ? 600 : 400,
          }}>
            {s.label}
          </div>
        ))}
      </div>

      {/* Day columns */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
        {days.map(day => {
          const dayAppts = appointmentsByDate.get(day.dateKey) ?? [];
          // Determine working hours for this day
          const dayHours = operatingHours?.[day.dayName];
          const dayClosed = operatingHours ? isDayClosed(operatingHours, day.dayName) : false;
          const openHour = dayHours && !dayClosed ? parseHHMM(dayHours.open) : null;
          const closeHour = dayHours && !dayClosed ? parseHHMM(dayHours.close) : null;

          return (
            <div key={day.dateKey} style={{
              borderRight: '1px solid var(--border, #334155)', position: 'relative',
              opacity: dayClosed ? 0.5 : 1,
            }}>
              {/* Day header */}
              <div style={{
                height: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                borderBottom: '1px solid var(--border, #475569)',
                background: dayClosed ? 'rgba(239,68,68,0.08)' : day.isToday ? '#3b82f6' : 'transparent',
                color: day.isToday ? '#fff' : dayClosed ? '#ef4444' : 'var(--text, #f1f5f9)',
                fontSize: 12, fontWeight: day.isToday ? 700 : 500,
              }}>
                {formatDayHeader(day.date, timezone, intlLocale)}
                {dayClosed ? (
                  <span style={{ fontSize: 8, fontWeight: 700, lineHeight: '10px', color: '#ef4444' }}>
                    {translate(locale, 'Closed')}
                  </span>
                ) : dayAppts.length > 0 ? (
                  <span style={{
                    fontSize: 8, fontWeight: 700, lineHeight: '10px',
                    color: day.isToday ? 'rgba(255,255,255,0.7)' : '#3b82f6',
                  }}>
                    {dayAppts.length} {translate(locale, 'appts')}
                  </span>
                ) : null}
              </div>

              {/* Half-hour rows */}
              <div style={{ position: 'relative' }}>
                {slots.map(s => {
                  const slotTime = s.hour + s.minute / 60;
                  // Outside working hours: before open or after close
                  const isOutsideHours = !dayClosed && openHour !== null && closeHour !== null
                    && (slotTime < openHour || slotTime >= closeHour);
                  return (
                    <div key={s.label} style={{
                      height: SLOT_HEIGHT,
                      borderBottom: s.minute === 0
                        ? '1px solid var(--border, #334155)'
                        : '1px solid var(--border, #1e293b)',
                      background: dayClosed
                        ? 'repeating-linear-gradient(135deg, transparent, transparent 4px, rgba(100,116,139,0.06) 4px, rgba(100,116,139,0.06) 8px)'
                        : isOutsideHours
                          ? 'rgba(100,116,139,0.06)'
                          : 'transparent',
                    }} />
                  );
                })}

                {/* Appointment blocks */}
                {dayAppts.map(appt => {
                  const hour = getHourInTz(appt.scheduled_at, timezone);
                  const minute = getMinuteInTz(appt.scheduled_at, timezone);
                  if (hour < START_HOUR || hour >= END_HOUR) return null;
                  const svc = serviceMap.get(appt.service_id);
                  const duration = svc?.estimated_service_time ?? 30;
                  const top = (hour - START_HOUR) * HOUR_HEIGHT + (minute / 60) * HOUR_HEIGHT;
                  const height = Math.max((duration / 60) * HOUR_HEIGHT, 22);
                  const clippedHeight = Math.min(height, (END_HOUR - hour) * HOUR_HEIGHT - (minute / 60) * HOUR_HEIGHT);
                  const color = getServiceColor(svc);
                  const isActive = appt.id === selectedApptId;

                  return (
                    <button
                      key={appt.id}
                      onClick={() => onSelect(appt)}
                      style={{
                        position: 'absolute', left: 2, right: 2, top, borderRadius: 6,
                        height: clippedHeight,
                        background: color + (isActive ? 'ff' : 'cc'),
                        color: '#fff',
                        border: isActive ? '2px solid #fff' : '1px solid rgba(255,255,255,0.15)',
                        padding: '2px 5px', textAlign: 'left', cursor: 'pointer',
                        fontSize: clippedHeight < 28 ? 9 : 11,
                        lineHeight: clippedHeight < 28 ? '11px' : '14px',
                        overflow: 'hidden', zIndex: isActive ? 15 : 10,
                        boxShadow: isActive ? '0 2px 8px rgba(0,0,0,0.3)' : 'none',
                        transition: 'border 0.15s, box-shadow 0.15s',
                      }}
                      title={`${appt.customer_name} - ${svc?.name ?? ''}`}
                    >
                      <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {appt.customer_name}
                      </div>
                      {clippedHeight >= 34 && (
                        <div style={{ opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {formatTimeInTz(appt.scheduled_at, timezone)} · {svc?.name ?? ''}
                        </div>
                      )}
                    </button>
                  );
                })}

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
  days, appointmentCounts, appointmentsByDate, timezone, serviceMap, intlLocale, locale, operatingHours, onSelect, onDayClick,
}: {
  days: MonthDayInfo[];
  appointmentCounts: Map<string, number>;
  appointmentsByDate: Map<string, CalendarAppointment[]>;
  timezone: string;
  serviceMap: Map<string, any>;
  intlLocale: string;
  locale: string;
  operatingHours: OperatingHours;
  onSelect: (a: CalendarAppointment) => void;
  onDayClick: (date: Date) => void;
}) {
  const t = (k: string) => translate(locale as DesktopLocale, k);

  const dayNames = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(2026, 0, 5 + i);
    return new Intl.DateTimeFormat(intlLocale, { weekday: 'short' }).format(d);
  }), [intlLocale]);

  const weeks: MonthDayInfo[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--border, #475569)', background: 'rgba(30,41,59,0.5)' }}>
        {dayNames.map(d => (
          <div key={d} style={{ textAlign: 'center', padding: '6px 0', fontSize: 11, fontWeight: 600, color: '#64748b' }}>{d}</div>
        ))}
      </div>

      <div style={{ flex: 1, display: 'grid', gridTemplateRows: `repeat(${weeks.length}, 1fr)` }}>
        {weeks.map((week, wi) => (
          <div key={wi} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--border, #334155)' }}>
            {week.map(day => {
              const count = appointmentCounts.get(day.dateKey) ?? 0;
              const dayAppts = (appointmentsByDate.get(day.dateKey) ?? []).slice(0, 3);
              const dayName = JS_DAY_TO_NAME[day.date.getDay()];
              const closed = operatingHours ? isDayClosed(operatingHours, dayName) : false;
              return (
                <div
                  key={day.dateKey}
                  onClick={() => onDayClick(day.date)}
                  style={{
                    borderRight: '1px solid var(--border, #334155)', padding: 4, minHeight: 70,
                    cursor: 'pointer',
                    opacity: day.isCurrentMonth ? (closed ? 0.5 : 1) : 0.35,
                    background: day.isToday ? 'rgba(59,130,246,0.08)' : closed ? 'rgba(100,116,139,0.04)' : 'transparent',
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
                    <span style={{ fontSize: 8, color: '#64748b' }}>+{count - 3} {t('more')}</span>
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

// ── Appointment Detail Panel ──────────────────────────────────────

function DesktopApptDetail({
  appointment: a, timezone, serviceMap, departments, locale, intlLocale, actionBusy,
  onClose, onCancel, onCheckIn, onApprove, onDecline,
}: {
  appointment: CalendarAppointment;
  timezone: string;
  serviceMap: Map<string, any>;
  departments: Record<string, string>;
  locale: DesktopLocale;
  intlLocale: string;
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

  const statusLabel: Record<string, string> = {
    pending: t('Pending'), pending_approval: t('Pending'), confirmed: t('Confirmed'), checked_in: t('Checked In'),
    completed: t('Completed'), cancelled: t('Cancelled'), no_show: t('No Show'), declined: t('Declined'), serving: t('Serving'),
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase',
    letterSpacing: 0.5, marginBottom: 4,
  };
  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
    color: 'var(--text, #f1f5f9)', marginBottom: 6,
  };
  const actionBtn = (bg: string, fg: string): React.CSSProperties => ({
    flex: 1, padding: '8px 12px', borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 600,
    cursor: actionBusy ? 'not-allowed' : 'pointer', opacity: actionBusy ? 0.5 : 1,
    background: bg, color: fg,
  });

  return (
    <div style={{
      width: 360, flexShrink: 0,
      background: 'var(--surface, #1e293b)', borderLeft: '1px solid var(--border, #475569)',
      boxShadow: '-8px 0 32px rgba(0,0,0,0.3)', overflow: 'auto',
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
            {svc?.name ?? t('Service')} · {dept ?? t('Department')}
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
        {/* Status badge */}
        <div style={{ marginBottom: 14 }}>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 12, color: '#fff', background: statusColor }}>
            {statusLabel[a.status] ?? a.status}
          </span>
        </div>

        {/* Source badge — same CSS classes as queue tickets */}
        {a.source && (
          <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            {a.source === 'whatsapp' && <span className="badge whatsapp">{t('WhatsApp')}</span>}
            {a.source === 'messenger' && <span className="badge messenger">{t('Messenger')}</span>}
            {a.source === 'web' && <span className="badge qr-code">{t('Web')}</span>}
            {a.source === 'portal' && <span className="badge in-house">{t('Portal')}</span>}
            {a.source === 'qr_code' && <span className="badge qr-code">{t('QR Code')}</span>}
            {a.source === 'mobile_app' && <span className="badge mobile-app">{t('Mobile App')}</span>}
            {a.source === 'kiosk' && <span className="badge kiosk">{t('Kiosk')}</span>}
            {a.source === 'in_house' && <span className="badge in-house">{t('In-House')}</span>}
            {!['whatsapp', 'messenger', 'web', 'portal', 'qr_code', 'mobile_app', 'kiosk', 'in_house'].includes(a.source) && (
              <span className="badge">{a.source}</span>
            )}
          </div>
        )}

        {/* Date & time card */}
        <div style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.15)', borderRadius: 10, padding: 12, marginBottom: 14 }}>
          <div style={rowStyle}>
            <span style={{ fontSize: 14 }}>📅</span>
            {d.toLocaleDateString(intlLocale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: timezone })}
          </div>
          <div style={rowStyle}>
            <span style={{ fontSize: 14 }}>🕐</span>
            {formatTimeInTz(a.scheduled_at, timezone)}
            {svc && ` · ${formatDuration(svc.estimated_service_time ?? 30)}`}
          </div>
        </div>

        {/* Customer info */}
        <div style={labelStyle}>{t('Customer')}</div>
        <div style={rowStyle}>👤 {a.customer_name}</div>
        {a.customer_phone && <div style={rowStyle}>📞 {a.customer_phone}</div>}
        {a.customer_email && <div style={rowStyle}>✉ {a.customer_email}</div>}
        {(a as any).wilaya && <div style={rowStyle}>📍 {(a as any).wilaya}</div>}

        {/* Service & Department */}
        <div style={{ ...labelStyle, marginTop: 14 }}>{t('Service')}</div>
        <div style={{ ...rowStyle, gap: 6 }}>
          {svc && <span style={{ width: 8, height: 8, borderRadius: 4, background: serviceColor, flexShrink: 0 }} />}
          {svc?.name ?? '—'}
          {dept && <span style={{ fontSize: 10, color: '#64748b', marginLeft: 4 }}>({dept})</span>}
        </div>

        {/* Assigned Staff */}
        {(a as any).staff_id && (
          <>
            <div style={{ ...labelStyle, marginTop: 14 }}>{t('Assigned Staff')}</div>
            <div style={rowStyle}>👤 {(a as any).staff?.full_name ?? (a as any).staff_id.slice(0, 8)}</div>
          </>
        )}

        {/* Recurring */}
        {a.recurrence_rule && (
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#a78bfa' }}>
            🔄 {t('Recurring')}
          </div>
        )}

        {/* Notes */}
        {a.notes && (
          <>
            <div style={{ ...labelStyle, marginTop: 14 }}>{t('Notes')}</div>
            <div style={{ fontSize: 12, color: 'var(--text, #f1f5f9)', background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.15)', borderRadius: 8, padding: 10, marginBottom: 14 }}>
              {a.notes}
            </div>
          </>
        )}

        {/* Action buttons */}
        {isActive && (
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {a.status === 'pending' && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={onApprove} disabled={actionBusy} style={actionBtn('#22c55e', '#fff')}>
                  ✓ {t('Approve')}
                </button>
                <button onClick={onDecline} disabled={actionBusy} style={actionBtn('#ef4444', '#fff')}>
                  ✗ {t('Decline')}
                </button>
              </div>
            )}
            {a.status === 'confirmed' && (
              <button onClick={onCheckIn} disabled={actionBusy} style={actionBtn('#8b5cf6', '#fff')}>
                {t('Check In')}
              </button>
            )}
            <button onClick={onCancel} disabled={actionBusy} style={actionBtn('rgba(239,68,68,0.15)', '#ef4444')}>
              {t('Cancel Appointment')}
            </button>
          </div>
        )}

        {/* Meta */}
        <div style={{ marginTop: 16, fontSize: 10, color: '#475569' }}>
          <div>{t('Created')}: {new Date(a.created_at).toLocaleString(intlLocale)}</div>
          <div>ID: {a.id.slice(0, 8)}</div>
        </div>
      </div>
    </div>
  );
}
