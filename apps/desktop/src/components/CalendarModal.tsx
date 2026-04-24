import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getSupabase, ensureAuth } from '../lib/supabase';
import { cloudFetch } from '../lib/cloud-fetch';
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
  isWithinHorizon,
  getDayNameFromKey,
  type CalendarDay,
  type CalendarDayInfo,
  type MonthDayInfo,
  type CalendarAppointment,
} from '@qflo/shared';
import { normalizeWilayaDisplay } from '../lib/wilayas';
import { useConfirmDialog } from './ConfirmDialog';
import DatePicker from './DatePicker';

// ── Schedule types ────────────────────────────────────────────────

type OperatingHours = Record<string, { open: string; close: string }> | null;

/** @deprecated — use getDayNameFromKey(dateKey) instead of JS_DAY_TO_NAME[date.getDay()] */
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

// ── Activity log types ────────────────────────────────────────────

interface ActivityEntry {
  id: string;
  appointmentId: string;
  timestamp: Date;
  eventType: 'booked' | 'cancelled' | 'declined' | 'approved' | 'checked_in' | 'no_show' | 'served' | 'modified' | 'deleted';
  customerName: string;
  serviceName?: string;
  scheduledAt?: string;
  source?: string | null;
}

const EVENT_META: Record<ActivityEntry['eventType'], { icon: string; color: string; labelKey: string }> = {
  booked:     { icon: '📅', color: '#f59e0b', labelKey: 'Booked' },
  approved:   { icon: '✅', color: '#3b82f6', labelKey: 'Confirmed' },
  cancelled:  { icon: '❌', color: '#ef4444', labelKey: 'Cancelled' },
  declined:   { icon: '🚫', color: '#991b1b', labelKey: 'Declined' },
  checked_in: { icon: '📋', color: '#06b6d4', labelKey: 'Checked In' },
  no_show:    { icon: '👻', color: '#64748b', labelKey: 'No Show' },
  served:     { icon: '✔️', color: '#22c55e', labelKey: 'Served' },
  modified:   { icon: '✏️', color: '#eab308', labelKey: 'Modified' },
  deleted:    { icon: '🗑️', color: '#dc2626', labelKey: 'Deleted' },
};

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
  onModerate?: (apptId: string, action: 'approve' | 'decline' | 'cancel' | 'no_show' | 'check_in' | 'call' | 'serve' | 'complete' | 'delete', opts?: { reason?: string }) => Promise<boolean>;
  onOpenCustomer?: (phone: string) => void;
  onSlotBook?: (date: string, time: string) => void;
  /** Called after any appointment data changes (reschedule, notes, etc.) so parent can refresh */
  onAppointmentChange?: () => void;
  initialViewMode?: ViewMode;
  initialAppointmentId?: string | null;
  /** When true, renders inline (no overlay/backdrop) filling its parent container */
  embedded?: boolean;
  /** Increment to trigger a background data refresh (no loading flash) */
  refreshKey?: number;
}

type ViewMode = 'week' | 'month' | 'list';

const SLOT_HEIGHT = 28;
const PIXELS_PER_HOUR = 56; // fixed: 1 hour = 56px regardless of slot duration
const DEFAULT_START_HOUR = 6;
const DEFAULT_END_HOUR = 22;

/** Compute visible hour range from operating hours (earliest open - 1h, latest close + 1h) */
function getVisibleHourRange(oh: OperatingHours): { startHour: number; endHour: number } {
  if (!oh) return { startHour: DEFAULT_START_HOUR, endHour: DEFAULT_END_HOUR };
  let earliest = 24;
  let latest = 0;
  for (const day of Object.values(oh)) {
    if (!day || (day.open === '00:00' && day.close === '00:00')) continue; // closed day
    const openH = parseHHMM(day.open);
    const closeH = parseHHMM(day.close);
    if (openH < earliest) earliest = openH;
    if (closeH > latest) latest = closeH;
  }
  if (earliest >= latest) return { startHour: DEFAULT_START_HOUR, endHour: DEFAULT_END_HOUR };
  // Add 1h padding before and after, clamp to 0-24
  const startHour = Math.max(0, Math.floor(earliest) - 1);
  const endHour = Math.min(24, Math.ceil(latest) + 1);
  return { startHour, endHour };
}
const LOCALE_MAP: Record<string, string> = { fr: 'fr-DZ', ar: 'ar-DZ', en: 'en-DZ' };

const APPT_SELECT = `
  id, office_id, department_id, service_id, staff_id,
  customer_name, customer_phone, customer_email,
  scheduled_at, status, notes, wilaya, ticket_id,
  locale, reminder_sent,
  recurrence_rule, recurrence_parent_id, calendar_token,
  source, created_at, updated_at
`;

// ── Main Component ────────────────────────────────────────────────

export function CalendarModal({ organizationId, officeId, locale, storedAuth, departments, services, officeTimezone, onClose, onModerate, onOpenCustomer, onSlotBook, onAppointmentChange, initialViewMode, initialAppointmentId, embedded, refreshKey }: Props) {
  const t = (k: string, v?: Record<string, any>) => translate(locale, k, v);
  const tz = officeTimezone || 'UTC';
  const intlLocale = LOCALE_MAP[locale] ?? 'en-US';
  const { confirm } = useConfirmDialog();

  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode || 'week');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([]);
  const appointmentsRef = useRef<CalendarAppointment[]>([]);
  appointmentsRef.current = appointments;
  const [loading, setLoading] = useState(true);
  const [selectedAppt, setSelectedAppt] = useState<CalendarAppointment | null>(null);
  const [selectedSlotIdx, setSelectedSlotIdx] = useState<number | null>(null);
  const [bookingSlot, setBookingSlot] = useState<{ date: string; time: string } | null>(null);
  const [listDateFilter, setListDateFilter] = useState<string | null>(initialViewMode === 'list' ? dateKeyInTz(new Date(), officeTimezone || 'UTC') : null);
  const [globalSearch, setGlobalSearch] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [dropFeedback, setDropFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [operatingHours, setOperatingHours] = useState<OperatingHours>(null);
  const [alwaysOpen, setAlwaysOpen] = useState(false);
  const [slotDuration, setSlotDuration] = useState(30); // org slot_duration_minutes
  const slotHeightPx = (slotDuration / 60) * PIXELS_PER_HOUR; // dynamic slot row height
  const { startHour: START_HOUR, endHour: END_HOUR } = useMemo(
    () => getVisibleHourRange(alwaysOpen ? null : operatingHours),
    [operatingHours, alwaysOpen],
  );
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const activityEndRef = useRef<HTMLDivElement>(null);

  // ── Holidays / day-off management ──────────────────────────────
  interface Holiday { id: string; holiday_date: string; name: string; is_full_day: boolean; }
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const holidaysByDate = useMemo(() => {
    const map = new Map<string, Holiday>();
    for (const h of holidays) map.set(h.holiday_date, h);
    return map;
  }, [holidays]);

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; dateKey: string } | null>(null);
  // Multi-select for bulk day-off
  // selectedDates is computed after expandRange is defined below
  // Day-off dialog — supports single date or from/to range
  const [dayOffDialog, setDayOffDialog] = useState<{ startDate: string; endDate: string } | null>(null);
  const [dayOffName, setDayOffName] = useState('');
  const [dayOffBusy, setDayOffBusy] = useState(false);
  const [dayOffNotify, setDayOffNotify] = useState<{ whatsapp: boolean; sms: boolean }>({ whatsapp: true, sms: false });
  const [dayOffNotifyResult, setDayOffNotifyResult] = useState<{ total: number; whatsapp?: { sent: number; failed: number }; sms?: { sent: number; failed: number }; cancelled?: number } | null>(null);
  const [dayOffShowPreview, setDayOffShowPreview] = useState(false);

  const serviceMap = useMemo(() => new Map(services.map(s => [s.id, s])), [services]);

  // ── Load schedule (once on mount) ─────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        await ensureAuth();
        const sb = await getSupabase();
        const { data: office } = await sb.from('offices').select('operating_hours, settings').eq('id', officeId).single();
        if (office?.operating_hours) setOperatingHours(office.operating_hours as OperatingHours);
        // Resolve override mode from org (source of truth) — ignore stale office copies
        const { data: org } = await sb.from('organizations').select('settings').eq('id', organizationId).single();
        const orgSettings = (org?.settings ?? {}) as Record<string, any>;
        const orgMode = orgSettings.visit_intake_override_mode;
        // Only 'always_open' explicitly set at org level triggers always-open
        setAlwaysOpen(orgMode === 'always_open');
        // Read slot duration for calendar grid
        const dur = Number(orgSettings.slot_duration_minutes);
        if (dur && dur >= 5 && dur <= 120) setSlotDuration(dur);
        // Clean up stale office setting if it disagrees with org
        const officeMode = (office?.settings as any)?.visit_intake_override_mode;
        const resolvedMode = typeof orgMode === 'string' ? orgMode : 'business_hours';
        if (officeMode && officeMode !== resolvedMode) {
          const officeSettings = ((office?.settings as Record<string, any>) ?? {});
          await sb.from('offices').update({
            settings: { ...officeSettings, visit_intake_override_mode: resolvedMode },
          }).eq('id', officeId);
        }
        // Load holidays
        const { data: hols } = await sb.from('office_holidays')
          .select('id, holiday_date, name, is_full_day')
          .eq('office_id', officeId)
          .gte('holiday_date', new Date().toISOString().split('T')[0])
          .order('holiday_date');
        if (hols) setHolidays(hols as Holiday[]);
      } catch { /* ignore */ }
    })();
  }, [officeId, organizationId, storedAuth]);

  const reloadHolidays = useCallback(async () => {
    try {
      await ensureAuth();
      const sb = await getSupabase();
      const { data } = await sb.from('office_holidays')
        .select('id, holiday_date, name, is_full_day')
        .eq('office_id', officeId)
        .gte('holiday_date', new Date().toISOString().split('T')[0])
        .order('holiday_date');
      if (data) setHolidays(data as Holiday[]);
    } catch { /* ignore */ }
  }, [officeId, storedAuth]);

  // Week days for header/mini calendar (driven by currentDate)
  const weekDays = useMemo(() => getWeekDays(currentDate, tz, true), [currentDate, tz]);

  // ── Carousel panel management ──────────────────────────────────
  // Each panel has its own week date, managed independently.
  // On swipe, only the OFF-SCREEN panel is recycled — the visible panel is never touched.
  const [panelWeeks, setPanelWeeks] = useState<[Date, Date, Date]>(() => [
    shiftWeek(new Date(), -1), new Date(), shiftWeek(new Date(), 1),
  ]);
  // Per-panel memos: only recompute when THAT panel's week changes
  const panel0Days = useMemo(() => getWeekDays(panelWeeks[0], tz, true), [panelWeeks[0], tz]);
  const panel1Days = useMemo(() => getWeekDays(panelWeeks[1], tz, true), [panelWeeks[1], tz]);
  const panel2Days = useMemo(() => getWeekDays(panelWeeks[2], tz, true), [panelWeeks[2], tz]);
  const panelDaysList = useMemo(() => [panel0Days, panel1Days, panel2Days], [panel0Days, panel1Days, panel2Days]);

  // Mirror panelWeeks in a ref so swipe callbacks always read the latest value
  const panelWeeksRef = useRef(panelWeeks);
  panelWeeksRef.current = panelWeeks;

  // Panel position offsets: -1=left, 0=center, 1=right (managed via ref, not state)
  const panelOffsetsRef = useRef([-1, 0, 1]);
  const panelElRefs = useRef<(HTMLDivElement | null)[]>([null, null, null]);
  const panelContainerRef = useRef<HTMLDivElement>(null);
  // Bump this state to trigger a reposition via useLayoutEffect after render
  const [panelReposKey, setPanelReposKey] = useState(0);
  const requestReposition = () => setPanelReposKey(k => k + 1);
  const monthDays = viewMode === 'month' ? getMonthGrid(currentDate.getFullYear(), currentDate.getMonth(), tz) : [];

  // Selected date key — the specific date the user navigated to
  const selectedDateKey = useMemo(() => dateKeyInTz(currentDate, tz), [currentDate, tz]);

  // ── Fetch — always load the FULL MONTH so mini calendar dots are accurate ──

  // Fetch ALL appointments (including cancelled/declined) for activity log diffing
  const loadAll = useCallback(async (): Promise<CalendarAppointment[] | null> => {
    try {
      await ensureAuth();
      const sb = await getSupabase();
      // Fetch current month + 7 day buffer on each side for carousel side panels
      const monthRange = getMonthRange(currentDate.getFullYear(), currentDate.getMonth(), tz);
      const bufferStart = new Date(new Date(monthRange.start).getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
      const bufferEnd = new Date(new Date(monthRange.end).getTime() + 8 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await sb
        .from('appointments')
        .select(APPT_SELECT)
        .eq('office_id', officeId)
        .gte('scheduled_at', bufferStart)
        .lte('scheduled_at', bufferEnd)
        .order('scheduled_at', { ascending: true })
        .limit(2000);
      if (data === null) {
        console.warn('[Calendar] loadAll returned null — auth may have expired', error);
        return null;
      }
      return data as CalendarAppointment[];
    } catch (err) { console.error('[Calendar] loadAll error', err); return null; }
  }, [currentDate.getFullYear(), currentDate.getMonth(), tz, officeId, storedAuth]);

  // ── Activity log — independent fetch of recent business-wide activity ──
  const loadActivity = useCallback(async () => {
    try {
      await ensureAuth();
      const sb = await getSupabase();
      // Fetch last 50 appointments ordered by most recently changed
      const { data } = await sb
        .from('appointments')
        .select('id, customer_name, service_id, scheduled_at, status, source, created_at, updated_at')
        .eq('office_id', officeId)
        .order('updated_at', { ascending: false })
        .limit(50);
      if (!data) return;

      const entries: ActivityEntry[] = data.map((appt: any) => {
        const svc = appt.service_id ? serviceMap.get(appt.service_id) : undefined;
        const updatedAt = appt.updated_at || appt.created_at;
        // Map current status directly to event type
        const STATUS_TO_EVENT: Record<string, ActivityEntry['eventType']> = {
          pending: 'booked',
          confirmed: 'approved',
          checked_in: 'checked_in',
          completed: 'served',
          cancelled: 'cancelled',
          declined: 'declined',
          no_show: 'no_show',
        };
        const evtType = STATUS_TO_EVENT[appt.status] ?? 'booked';

        return {
          id: appt.id,
          appointmentId: appt.id,
          timestamp: new Date(updatedAt),
          eventType: evtType,
          customerName: appt.customer_name || '—',
          serviceName: svc?.name,
          scheduledAt: appt.scheduled_at,
          source: appt.source,
        };
      });
      setActivityLog(entries);
    } catch (err) { console.error('[Calendar] activity load error:', err); }
  }, [officeId, storedAuth, serviceMap]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const allAppts = await loadAll();
      // GUARD: if fetch failed (null), keep existing data instead of wiping the calendar
      if (allAppts === null) { setLoading(false); return; }
      // Set visible appointments (exclude cancelled/declined for the grid)
      const visible = allAppts.filter(a => a.status !== 'cancelled' && a.status !== 'declined');
      setAppointments(visible);
      // Update or close the detail panel if the selected appointment changed externally
      setSelectedAppt(prev => {
        if (!prev) return null;
        const fresh = allAppts.find(a => a.id === prev.id);
        if (!fresh) return null; // deleted externally → close panel
        // Status changed externally → update panel data
        if (fresh.status !== prev.status || fresh.notes !== prev.notes) return fresh as CalendarAppointment;
        return prev;
      });
    } catch (err) { console.error('[Calendar] load error:', err); }
    setLoading(false);
  }, [loadAll]);

  const initialLoadDone = useRef(false);
  useEffect(() => {
    // First load shows spinner; subsequent loads (month change, etc.) are silent
    load(initialLoadDone.current);
    initialLoadDone.current = true;
  }, [load]);

  // Load activity log on mount and whenever serviceMap changes
  useEffect(() => { loadActivity(); }, [loadActivity]);

  // Auto-navigate to a specific appointment when opened with initialAppointmentId
  const initialApptHandled = useRef(false);
  const prevApptIdRef = useRef<string | null | undefined>(null);
  useEffect(() => {
    // Reset the handled flag when a new appointment ID is requested
    if (initialAppointmentId !== prevApptIdRef.current) {
      prevApptIdRef.current = initialAppointmentId;
      if (initialAppointmentId) initialApptHandled.current = false;
    }
    if (!initialAppointmentId || initialApptHandled.current || loading) return;
    // Try to find in loaded appointments first
    const appt = appointments.find(a => a.id === initialAppointmentId);
    if (appt) {
      initialApptHandled.current = true;
      const d = new Date(appt.scheduled_at);
      setCurrentDate(d);
      setViewMode('week');
      setSelectedAppt(appt);
      return;
    }
    // If not in current range, fetch it directly
    (async () => {
      try {
        await ensureAuth();
        const sb = await getSupabase();
        const { data } = await sb.from('appointments').select(APPT_SELECT).eq('id', initialAppointmentId).single();
        if (data) {
          initialApptHandled.current = true;
          const d = new Date(data.scheduled_at);
          setCurrentDate(d);
          setViewMode('week');
          setSelectedAppt(data as CalendarAppointment);
        }
      } catch { /* ignore */ }
    })();
  }, [initialAppointmentId, appointments, loading, storedAuth]);

  // ── Realtime + polling fallback ────────────────────────────────
  // Realtime gives instant updates; polling every 30s is a safety net
  // in case the realtime channel drops (e.g. JWT expiry).

  const realtimeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let sub: any;
    (async () => {
      try {
        await ensureAuth();
        const sb = await getSupabase();
        sub = sb.channel(`calendar-appts-${officeId}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments', filter: `office_id=eq.${officeId}` }, () => {
            // Debounce rapid-fire events (e.g. bulk approvals) — 300ms
            if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current);
            realtimeDebounceRef.current = setTimeout(() => {
              load(true);
              loadActivity();
            }, 300);
          })
          .subscribe();
      } catch { /* ignore */ }
    })();
    return () => {
      sub?.unsubscribe?.();
      if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current);
    };
  }, [officeId, load, loadActivity, storedAuth]);

  // Polling fallback — reloads every 30s to catch missed realtime events
  useEffect(() => {
    const iv = setInterval(() => { load(true); loadActivity(); }, 30_000);
    return () => clearInterval(iv);
  }, [load, loadActivity]);

  // Silent background refresh when parent signals (tab switch)
  const prevRefreshKey = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey !== undefined && refreshKey !== prevRefreshKey.current) {
      prevRefreshKey.current = refreshKey;
      load(true);
      loadActivity();
    }
  }, [refreshKey, load, loadActivity]);

  // ── Auto-scroll activity log ───────────────────────────────────
  useEffect(() => {
    activityEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activityLog.length]);

  // ── Navigation ─────────────────────────────────────────────────

  const goToday = () => {
    const now = new Date();
    setCurrentDate(now);
    resetPanelsTo(now);
    if (viewMode === 'list') setListDateFilter(dateKeyInTz(now, tz));
  };
  const goPrev = useCallback(() => {
    if (viewMode === 'list' && listDateFilter) {
      const prev = new Date(listDateFilter + 'T12:00:00');
      prev.setDate(prev.getDate() - 1);
      const key = dateKeyInTz(prev, tz);
      setListDateFilter(key);
      setCurrentDate(prev);
      return;
    }
    const next = viewMode === 'week' ? shiftWeek(currentDate, -1) : shiftMonth(currentDate, -1);
    setCurrentDate(next);
    if (viewMode === 'week') resetPanelsTo(next);
    if (viewMode === 'list') setListDateFilter(null);
  }, [viewMode, currentDate, listDateFilter, tz]);
  const goNext = useCallback(() => {
    if (viewMode === 'list' && listDateFilter) {
      const nxt = new Date(listDateFilter + 'T12:00:00');
      nxt.setDate(nxt.getDate() + 1);
      if (!isWithinHorizon(nxt, 3)) return;
      const key = dateKeyInTz(nxt, tz);
      setListDateFilter(key);
      setCurrentDate(nxt);
      return;
    }
    const next = viewMode === 'week' ? shiftWeek(currentDate, 1) : shiftMonth(currentDate, 1);
    if (!isWithinHorizon(next, 3)) return;
    setCurrentDate(next);
    if (viewMode === 'week') resetPanelsTo(next);
    if (viewMode === 'list') setListDateFilter(null);
  }, [viewMode, currentDate, listDateFilter, tz]);

  // ── List-view data ──────────────────────────────────────────────
  const listAppointments = useMemo(() => {
    if (viewMode !== 'list') return [];
    // If a specific date is selected, show only that day
    if (listDateFilter) {
      return appointments
        .filter(a => dateKeyInTz(new Date(a.scheduled_at), tz) === listDateFilter)
        .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
    }
    // Otherwise show the whole month
    const y = currentDate.getFullYear();
    const m = currentDate.getMonth();
    const startKey = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const endDate = new Date(y, m + 1, 0);
    const endKey = `${y}-${String(m + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
    return appointments
      .filter(a => {
        const dk = dateKeyInTz(new Date(a.scheduled_at), tz);
        return dk >= startKey && dk <= endKey;
      })
      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
  }, [viewMode, currentDate, appointments, tz, listDateFilter]);

  const listGrouped = useMemo(() => {
    if (viewMode !== 'list') return [];
    const groups: { dateKey: string; items: typeof listAppointments }[] = [];
    const map = new Map<string, typeof listAppointments>();
    for (const a of listAppointments) {
      const dk = dateKeyInTz(new Date(a.scheduled_at), tz);
      if (!map.has(dk)) { map.set(dk, []); groups.push({ dateKey: dk, items: map.get(dk)! }); }
      map.get(dk)!.push(a);
    }
    return groups;
  }, [listAppointments, tz]);

  // ── Per-panel carousel (Embla-style) ─────────────────────────────
  // Each panel has its own translateX, managed via direct DOM manipulation.
  // On swipe complete, only the OFF-SCREEN panel is recycled.
  // The visible panel is NEVER re-rendered — zero flash guaranteed.
  const swipeRef = useRef({
    startX: 0, startY: 0, active: false, locked: null as 'x' | 'y' | null,
    lastX: 0, lastTime: 0, velocity: 0, offset: 0, animating: false,
    pointerId: 0, target: null as EventTarget | null,
  });
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  /** Position a single panel at its offset (in px) */
  const setPanelPos = (idx: number, px: number, animate: boolean) => {
    const el = panelElRefs.current[idx];
    if (!el) return;
    el.style.transition = animate ? 'transform 0.25s cubic-bezier(0.25, 1, 0.5, 1)' : 'none';
    el.style.transform = `translateX(${px}px)`;
  };

  /** Get container width */
  const getContainerW = () => panelContainerRef.current?.offsetWidth ?? 800;

  /** Position all panels based on their offsets + a drag delta */
  const positionAllPanels = (dragDelta: number, animate: boolean) => {
    const w = getContainerW();
    panelOffsetsRef.current.forEach((off, i) => {
      setPanelPos(i, off * w + dragDelta, animate);
      // Only the visible (offset=0) panel receives pointer events
      const el = panelElRefs.current[i];
      if (el) el.style.pointerEvents = off === 0 && dragDelta === 0 ? 'auto' : 'none';
    });
  };

  /** Reset panels to center on a given date — triggers repositioning via useLayoutEffect */
  const resetPanelsTo = (date: Date) => {
    setPanelWeeks([shiftWeek(date, -1), date, shiftWeek(date, 1)]);
    panelOffsetsRef.current = [-1, 0, 1];
    requestReposition();
  };

  // Position panels after every render that needs repositioning (mount, view switch, nav, side panel toggle, etc.)
  useLayoutEffect(() => {
    if (viewMode === 'week') positionAllPanels(0, false);
  }, [viewMode, panelReposKey, selectedAppt]);

  // Also reposition after a short delay when side panel opens/closes (layout may not be settled yet)
  useEffect(() => {
    if (viewMode !== 'week') return;
    const t = setTimeout(() => positionAllPanels(0, false), 50);
    return () => clearTimeout(t);
  }, [selectedAppt]);

  // Reposition panels when container resizes (e.g. detail panel opens/closes)
  useEffect(() => {
    const el = panelContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (!swipeRef.current.active && !swipeRef.current.animating) {
        positionAllPanels(0, false);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onSwipeDown = useCallback((e: React.PointerEvent) => {
    if (viewMode !== 'week') return;
    const s = swipeRef.current;
    if (s.animating) return;
    if ((e.target as HTMLElement).closest('button, textarea, input, a')) return;
    Object.assign(s, { startX: e.clientX, startY: e.clientY, active: true, locked: null, lastX: e.clientX, lastTime: Date.now(), velocity: 0, pointerId: e.pointerId, target: e.currentTarget });
  }, [viewMode]);

  const onSwipeMove = useCallback((e: React.PointerEvent) => {
    const s = swipeRef.current;
    if (!s.active) return;
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;

    if (!s.locked) {
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
        s.locked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        if (s.locked === 'x') {
          (s.target as HTMLElement)?.setPointerCapture(s.pointerId);
        } else {
          s.active = false;
          return;
        }
      }
      return;
    }
    if (s.locked !== 'x') return;

    const now = Date.now();
    const dt = now - s.lastTime;
    if (dt > 0) {
      const instantV = (e.clientX - s.lastX) / dt;
      s.velocity = s.velocity * 0.4 + instantV * 0.6;
    }
    s.lastX = e.clientX;
    s.lastTime = now;
    s.offset = dx;

    // Move ALL panels by drag delta — direct DOM, zero React renders
    positionAllPanels(dx, false);
  }, []);

  const onSwipeUp = useCallback((e: React.PointerEvent) => {
    const s = swipeRef.current;
    if (!s.active) return;
    s.active = false;

    if (s.locked !== 'x') { positionAllPanels(0, false); s.offset = 0; return; }

    const containerW = getContainerW();
    const velocity = s.velocity;
    const offset = s.offset;

    const shouldNavigate = Math.abs(offset) > containerW * 0.25 || Math.abs(velocity) > 0.4;
    const direction = (Math.abs(velocity) > 0.3 ? velocity : offset) > 0 ? -1 : 1; // -1=prev, 1=next

    if (shouldNavigate) {
      s.animating = true;
      // Animate all panels to their new positions (shift by 1 panel width)
      const shift = direction === -1 ? 1 : -1; // offset shift for each panel
      const offsets = panelOffsetsRef.current;
      offsets.forEach((off, i) => {
        setPanelPos(i, (off + shift) * containerW, true);
      });

      const onDone = () => {
        if (!s.animating) return;
        s.animating = false;
        s.offset = 0;

        // Update offsets
        const newOffsets = offsets.map(o => o + shift);
        // Find panel that went to ±2 (furthest off-screen) — recycle it
        const recycleIdx = newOffsets.findIndex(o => Math.abs(o) >= 2);
        const centerIdx = newOffsets.findIndex(o => o === 0);

        if (recycleIdx !== -1) {
          // Teleport off-screen panel to the opposite side
          const newPos = newOffsets[recycleIdx] > 0 ? -1 : 1;
          newOffsets[recycleIdx] = newPos;
          setPanelPos(recycleIdx, newPos * containerW, false);

          // Update ONLY the recycled panel's week data (off-screen → invisible)
          const currentWeeks = panelWeeksRef.current;
          const centerWeek = currentWeeks[centerIdx];
          const recycleWeek = shiftWeek(centerWeek, newPos); // -1=prev, +1=next of center
          const updated: [Date, Date, Date] = [currentWeeks[0], currentWeeks[1], currentWeeks[2]];
          updated[recycleIdx] = recycleWeek;
          setPanelWeeks(updated);
        }

        panelOffsetsRef.current = newOffsets;

        // Only the visible panel receives pointer events
        newOffsets.forEach((off, i) => {
          const el = panelElRefs.current[i];
          if (el) el.style.pointerEvents = off === 0 ? 'auto' : 'none';
        });

        // Update currentDate for header, mini calendar, data loading
        // (does NOT affect the visible panel — its data comes from panelWeeks)
        const currentWeeks = panelWeeksRef.current;
        const centerIdx2 = newOffsets.findIndex(o => o === 0);
        setCurrentDate(currentWeeks[centerIdx2]);
      };

      // Listen for transition end on any panel
      const anyPanel = panelElRefs.current.find(Boolean)!;
      const handler = () => { anyPanel.removeEventListener('transitionend', handler); onDone(); };
      anyPanel.addEventListener('transitionend', handler);
      setTimeout(() => { anyPanel.removeEventListener('transitionend', handler); onDone(); }, 300);
    } else {
      // Snap back
      s.animating = true;
      positionAllPanels(0, true);
      const anyPanel = panelElRefs.current.find(Boolean);
      const handler = () => { anyPanel?.removeEventListener('transitionend', handler); s.animating = false; };
      anyPanel?.addEventListener('transitionend', handler);
      setTimeout(() => { anyPanel?.removeEventListener('transitionend', handler); s.animating = false; }, 300);
    }
  }, []);

  // ── Mouse wheel / trackpad navigation ──
  // Navigates weeks: scroll wheel (deltaY), trackpad horizontal (deltaX), or Shift+scroll
  const navigateWeek = useCallback((direction: 1 | -1) => {
    const s = swipeRef.current;
    if (s.animating) return;
    s.animating = true;

    const containerW = getContainerW();
    const shift = direction === -1 ? 1 : -1;
    const offsets = panelOffsetsRef.current;
    offsets.forEach((off, i) => {
      setPanelPos(i, (off + shift) * containerW, true);
    });

    const onDone = () => {
      if (!s.animating) return;
      s.animating = false;
      s.offset = 0;
      const newOffsets = offsets.map(o => o + shift);
      const recycleIdx = newOffsets.findIndex(o => Math.abs(o) >= 2);
      const centerIdx = newOffsets.findIndex(o => o === 0);
      if (recycleIdx !== -1) {
        const newPos = newOffsets[recycleIdx] > 0 ? -1 : 1;
        newOffsets[recycleIdx] = newPos;
        setPanelPos(recycleIdx, newPos * containerW, false);
        const currentWeeks = panelWeeksRef.current;
        const centerWeek = currentWeeks[centerIdx];
        const recycleWeek = shiftWeek(centerWeek, newPos);
        const updated: [Date, Date, Date] = [currentWeeks[0], currentWeeks[1], currentWeeks[2]];
        updated[recycleIdx] = recycleWeek;
        setPanelWeeks(updated);
      }
      panelOffsetsRef.current = newOffsets;
      newOffsets.forEach((off, i) => {
        const el = panelElRefs.current[i];
        if (el) el.style.pointerEvents = off === 0 ? 'auto' : 'none';
      });
      const currentWeeks = panelWeeksRef.current;
      const centerIdx2 = newOffsets.findIndex(o => o === 0);
      setCurrentDate(currentWeeks[centerIdx2]);
    };

    const anyPanel = panelElRefs.current.find(Boolean)!;
    const handler = () => { anyPanel.removeEventListener('transitionend', handler); onDone(); };
    anyPanel.addEventListener('transitionend', handler);
    setTimeout(() => { anyPanel.removeEventListener('transitionend', handler); onDone(); }, 300);
  }, []);

  // ── Global keyboard navigation (arrow keys for all views) ──────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // Also skip if a contentEditable element is focused
      if ((e.target as HTMLElement)?.isContentEditable) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (viewMode === 'week') navigateWeek(-1);
        else goPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (viewMode === 'week') navigateWeek(1);
        else goNext();
      }
    };
    // Use capture phase to ensure we get the event first
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [viewMode, navigateWeek, goPrev, goNext]);

  // ── Wheel-as-drag: scroll physically moves panels, then snaps ──
  const wheelDragRef = useRef({ offset: 0, settling: false, timer: null as ReturnType<typeof setTimeout> | null });
  const onWheelSwipe = useCallback((e: React.WheelEvent) => {
    if (viewMode !== 'week') return;
    const s = swipeRef.current;
    if (s.active || s.animating) { e.preventDefault(); return; }

    const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(dx) < 2) return;
    e.preventDefault();

    const wd = wheelDragRef.current;
    if (wd.settling) return; // snap animation in progress

    // Accumulate offset (invert so scroll-right = move left = next week)
    // Mouse wheel sends small deltas (~3-5px), trackpad sends larger — amplify for both
    wd.offset -= dx * 8;

    // Clamp so you can't drag more than one panel width
    const containerW = getContainerW();
    wd.offset = Math.max(-containerW, Math.min(containerW, wd.offset));

    // Move panels in real-time (no animation)
    positionAllPanels(wd.offset, false);

    // Debounce: after 120ms of no scroll, decide to snap or bounce back
    if (wd.timer) clearTimeout(wd.timer);
    wd.timer = setTimeout(() => {
      const offset = wd.offset;
      wd.offset = 0;

      const shouldNavigate = Math.abs(offset) > containerW * 0.08;
      if (shouldNavigate) {
        const direction = offset > 0 ? -1 : 1; // offset>0 means dragged right = prev week
        s.animating = true;
        wd.settling = true;

        const shift = direction === -1 ? 1 : -1;
        const offsets = panelOffsetsRef.current;
        offsets.forEach((off, i) => {
          setPanelPos(i, (off + shift) * containerW, true);
        });

        const onDone = () => {
          if (!s.animating) return;
          s.animating = false;
          s.offset = 0;
          wd.settling = false;
          const newOffsets = offsets.map(o => o + shift);
          const recycleIdx = newOffsets.findIndex(o => Math.abs(o) >= 2);
          const centerIdx = newOffsets.findIndex(o => o === 0);
          if (recycleIdx !== -1) {
            const newPos = newOffsets[recycleIdx] > 0 ? -1 : 1;
            newOffsets[recycleIdx] = newPos;
            setPanelPos(recycleIdx, newPos * containerW, false);
            const currentWeeks = panelWeeksRef.current;
            const centerWeek = currentWeeks[centerIdx];
            const recycleWeek = shiftWeek(centerWeek, newPos);
            const updated: [Date, Date, Date] = [currentWeeks[0], currentWeeks[1], currentWeeks[2]];
            updated[recycleIdx] = recycleWeek;
            setPanelWeeks(updated);
          }
          panelOffsetsRef.current = newOffsets;
          newOffsets.forEach((off, i) => {
            const el = panelElRefs.current[i];
            if (el) el.style.pointerEvents = off === 0 ? 'auto' : 'none';
          });
          const currentWeeks = panelWeeksRef.current;
          const centerIdx2 = newOffsets.findIndex(o => o === 0);
          setCurrentDate(currentWeeks[centerIdx2]);
        };

        const anyPanel = panelElRefs.current.find(Boolean)!;
        const handler = () => { anyPanel.removeEventListener('transitionend', handler); onDone(); };
        anyPanel.addEventListener('transitionend', handler);
        setTimeout(() => { anyPanel.removeEventListener('transitionend', handler); onDone(); }, 300);
      } else {
        // Bounce back
        wd.settling = true;
        s.animating = true;
        positionAllPanels(0, true);
        setTimeout(() => { s.animating = false; wd.settling = false; }, 300);
      }
    }, 120);
  }, [viewMode]);

  // Called by mini calendar when user clicks a date
  const handleMiniDateClick = (d: Date) => {
    setCurrentDate(d);
    if (viewMode === 'list') {
      setListDateFilter(dateKeyInTz(d, tz));
    } else {
      resetPanelsTo(d);
      if (viewMode === 'month') setViewMode('week');
    }
  };

  // Called by mini calendar arrows — navigates the main view month
  const handleMiniMonthNav = (d: Date) => {
    if (isWithinHorizon(d, 3)) setCurrentDate(d);
  };

  // ── Actions on appointment ─────────────────────────────────────

  const handleAction = async (appt: CalendarAppointment, action: 'approve' | 'decline' | 'cancel' | 'no_show' | 'check_in' | 'call' | 'serve' | 'complete' | 'delete') => {
    if (!onModerate) return;
    setActionBusy(true);
    try {
      const ok = await onModerate(appt.id, action);
      if (ok) {
        // On delete, close panel immediately — appointment no longer exists
        if (action === 'delete') {
          setSelectedAppt(null);
          const refreshed = await loadAll();
          if (refreshed) {
            setAppointments(refreshed.filter(a => a.status !== 'cancelled' && a.status !== 'declined'));
          }
          loadActivity();
          setActionBusy(false);
          return;
        }
        const refreshed = await loadAll();
        if (!refreshed) { setActionBusy(false); return; }
        const visible = refreshed.filter(a => a.status !== 'cancelled' && a.status !== 'declined');
        setAppointments(visible);
        loadActivity(); // refresh activity feed
        // Keep panel open with updated data, or close if appointment was removed
        const updated = refreshed.find(a => a.id === appt.id);
        setSelectedAppt(updated ?? null);
      }
    } catch (e) { console.error(`[CalendarModal] ${action} failed:`, e); }
    setActionBusy(false);
  };

  // ── Navigate to activity entry ─────────────────────────────────

  const handleActivityClick = useCallback(async (entry: ActivityEntry) => {
    // First try to find in currently loaded appointments
    let appt = appointments.find(a => a.id === entry.appointmentId);

    // If not found (different month/range), fetch it directly
    if (!appt && entry.appointmentId) {
      try {
        await ensureAuth();
        const sb = await getSupabase();
        const { data } = await sb
          .from('appointments')
          .select(APPT_SELECT)
          .eq('id', entry.appointmentId)
          .single();
        if (data) appt = data as CalendarAppointment;
      } catch { /* ignore */ }
    }
    if (!appt) return;

    // Navigate to the appointment's date
    const apptDateKey = dateKeyInTz(new Date(appt.scheduled_at), tz);
    const visibleKeys = new Set(weekDays.map(d => d.dateKey));
    if (!visibleKeys.has(apptDateKey) || viewMode !== 'week') {
      const d = new Date(appt.scheduled_at);
      setCurrentDate(d);
      resetPanelsTo(d);
      setViewMode('week');
    }
    setSelectedAppt(appt);
  }, [appointments, weekDays, viewMode, tz, storedAuth]);

  // ── Holiday / Day-off management ────────────────────────────────

  // Close context menu on click outside or Escape
  const ctxMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ctxMenu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCtxMenu(null); };
    // Use pointerdown (fires before mousedown/click) to dismiss when clicking outside
    const onPointer = (e: PointerEvent) => {
      if (ctxMenuRef.current && ctxMenuRef.current.contains(e.target as Node)) return;
      setCtxMenu(null);
    };
    // Delay registration so the opening right-click doesn't immediately dismiss
    const timer = setTimeout(() => {
      document.addEventListener('pointerdown', onPointer);
      document.addEventListener('contextmenu', onPointer as any);
    }, 100);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('contextmenu', onPointer as any);
      document.removeEventListener('keydown', onKey);
    };
  }, [ctxMenu]);

  const handleDayContext = useCallback((e: React.MouseEvent, dateKey: string) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('[Calendar] handleDayContext', dateKey, e.clientX, e.clientY);
    setCtxMenu({ x: e.clientX, y: e.clientY, dateKey });
  }, []);

  const handleDayHeaderClick = useCallback((_e: React.MouseEvent, dateKey: string) => {
    // Update currentDate so mini calendar syncs — no panel reset needed since the day is already visible
    setCurrentDate(new Date(dateKey + 'T12:00:00'));
  }, []);

  const openDayOffDialog = (dateKey: string) => {
    console.log('[Calendar] openDayOffDialog', dateKey);
    setCtxMenu(null);
    setDayOffName('');
    setDayOffDialog({ startDate: dateKey, endDate: dateKey });
  };

  // Expand date range to array of YYYY-MM-DD strings
  const expandRange = (from: string, to: string): string[] => {
    if (!from || !to || from > to) return from && !to ? [from] : [];
    const dates: string[] = [];
    const d = new Date(from + 'T12:00:00');
    const end = new Date(to + 'T12:00:00');
    if (isNaN(d.getTime()) || isNaN(end.getTime())) return [];
    // Safety: max 366 days to prevent infinite loop
    while (d <= end && dates.length < 366) {
      dates.push(d.toISOString().split('T')[0]);
      d.setDate(d.getDate() + 1);
    }
    return dates;
  };

  const selectedDates = useMemo(() => {
    if (!dayOffDialog) return new Set<string>();
    return new Set(expandRange(dayOffDialog.startDate, dayOffDialog.endDate));
  }, [dayOffDialog]);

  const handleCreateHolidays = async () => {
    if (!dayOffDialog) return;
    setDayOffBusy(true);
    setDayOffNotifyResult(null);
    try {
      await ensureAuth();
      const sb = await getSupabase();
      const allDates = expandRange(dayOffDialog.startDate, dayOffDialog.endDate);
      const rows = allDates
        .filter(d => !holidaysByDate.has(d))
        .map(d => ({
          office_id: officeId,
          holiday_date: d,
          name: dayOffName.trim() || t('Day off'),
          is_full_day: true,
        }));
      if (rows.length > 0) {
        await sb.from('office_holidays').insert(rows);
      }
      await reloadHolidays();

      // Send notifications to affected customers
      if (dayOffNotify.whatsapp || dayOffNotify.sms) {
        try {
          const token = await ensureAuth();
          const res = await cloudFetch('https://qflo.net/api/dayoff-notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              officeId,
              dates: allDates,
              reason: dayOffName.trim() || t('Day off'),
              channels: { whatsapp: dayOffNotify.whatsapp, sms: dayOffNotify.sms },
            }),
          });
          const result = await res.json();
          if (result.total > 0) {
            setDayOffNotifyResult(result);
            setDayOffBusy(false);
            // Keep dialog open to show results
            return;
          }
        } catch (e) { console.error('[Calendar] dayoff notify error:', e); }
      }

      setDayOffDialog(null);
    } catch (e) { console.error('[Calendar] create holiday error:', e); }
    setDayOffBusy(false);
  };

  const handleRemoveHoliday = async (dateKey: string) => {
    setCtxMenu(null);
    try {
      await ensureAuth();
      const sb = await getSupabase();
      await sb.from('office_holidays').delete()
        .eq('office_id', officeId)
        .eq('holiday_date', dateKey);
      await reloadHolidays();
    } catch (e) { console.error('[Calendar] remove holiday error:', e); }
  };

  const handleClearAllHolidays = async () => {
    setCtxMenu(null);
    if (holidays.length === 0) return;
    try {
      await ensureAuth();
      const sb = await getSupabase();
      await sb.from('office_holidays').delete()
        .eq('office_id', officeId)
        .gte('holiday_date', new Date().toISOString().split('T')[0]);
      await reloadHolidays();
    } catch (e) { console.error('[Calendar] clear all holidays error:', e); }
  };

  // ── Reschedule appointment (drag-and-drop or manual time edit) ──

  /**
   * Convert a date + time in a specific timezone to a UTC ISO string.
   * E.g. "2026-04-13" + "09:00" in "Africa/Algiers" (UTC+1) → "2026-04-13T08:00:00.000Z"
   */
  const localTimeToUTC = useCallback((dateKey: string, time: string, timezone: string): string => {
    const [h, m] = time.split(':').map(Number);
    // Step 1: Treat the desired time as if it were UTC (our initial guess)
    const utcGuess = new Date(`${dateKey}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`);

    // Step 2: See what this UTC instant looks like in the target timezone
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const parts = fmt.formatToParts(utcGuess);
    const localH = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0');
    const localM = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0');
    const localD = parseInt(parts.find(p => p.type === 'day')?.value ?? '0');
    const targetD = parseInt(dateKey.split('-')[2]);

    // Step 3: Calculate difference — if 09:00 UTC shows as 10:00 in TZ, offset is +60min
    let diffMin = (localH - h) * 60 + (localM - m);
    if (localD !== targetD) {
      diffMin += (localD > targetD ? 1 : -1) * 24 * 60;
    }

    // Step 4: Subtract the offset to get the correct UTC time
    const adjusted = new Date(utcGuess.getTime() - diffMin * 60000);
    return adjusted.toISOString();
  }, []);

  const handleReschedule = useCallback(async (appointmentId: string, newDateKey: string, newTime: string, opts?: { skipSelect?: boolean; originalScheduledAt?: string }): Promise<boolean> => {
    try {
      await ensureAuth();
      const sb = await getSupabase();
      const appt = appointmentsRef.current.find(a => a.id === appointmentId);
      if (!appt) return false;

      // ── 0. Same-slot early exit ──
      // Use originalScheduledAt if provided (drag-drop passes it because
      // the optimistic UI update has already changed appointmentsRef)
      const origScheduledAt = opts?.originalScheduledAt ?? appt.scheduled_at;
      const currentTime = formatTimeInTz(origScheduledAt, tz);
      const currentDate = dateKeyInTz(new Date(origScheduledAt), tz);
      if (currentDate === newDateKey && currentTime === newTime) {
        return true; // No-op — appointment is already in this slot
      }

      // ── 1. Conflict check (admin-level — no business-hour restrictions) ──
      // Admin reschedule only checks for double-booking at the target slot.
      // The customer-facing booking-slots API enforces operating hours, lead time,
      // holidays, etc. — those rules should NOT restrict admin drag-and-drop.
      const conflict = appointmentsRef.current.find(a =>
        a.id !== appointmentId
        && a.service_id === appt.service_id
        && a.status !== 'cancelled' && a.status !== 'declined' && a.status !== 'no_show'
        && dateKeyInTz(new Date(a.scheduled_at), tz) === newDateKey
        && formatTimeInTz(a.scheduled_at, tz) === newTime
      );
      if (conflict) {
        console.warn('[Calendar] slot conflict — another appointment exists at', newDateKey, newTime);
        return false;
      }

      // ── 2. Compute new UTC timestamp ──
      const newScheduledAt = localTimeToUTC(newDateKey, newTime, tz);

      // ── 3. Update database ──
      const { error } = await sb
        .from('appointments')
        .update({ scheduled_at: newScheduledAt })
        .eq('id', appointmentId);

      if (error) {
        console.error('[Calendar] reschedule error:', error);
        return false;
      }

      // ── 4. Log reschedule event ──
      // Insert into ticket_events if appointment has a linked ticket
      if (appt.ticket_id) {
        sb.from('ticket_events').insert({
          ticket_id: appt.ticket_id,
          event_type: 'rescheduled',
          metadata: { from: origScheduledAt, to: newScheduledAt, appointment_id: appointmentId },
        }).then(({ error: evErr }) => {
          if (evErr) console.warn('[Calendar] Failed to log reschedule event:', evErr);
        });
      }

      // ── 5. Notify customer about reschedule (fire-and-forget via web API) ──
      try {
        cloudFetch('https://qflo.net/api/notify-reschedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${await ensureAuth()}` },
          body: JSON.stringify({ appointmentId, newScheduledAt }),
        }).catch(err => console.error('[Calendar] reschedule notify error:', err));
      } catch {}

      // ── 5. Refresh local state (background — optimistic update already shown) ──
      const refreshed = await loadAll();
      if (refreshed) {
        const visible = refreshed.filter(a => a.status !== 'cancelled' && a.status !== 'declined');
        setAppointments(visible);
        const updated = refreshed.find(a => a.id === appointmentId);
        if (updated && !opts?.skipSelect) setSelectedAppt(updated);
      }
      // Notify parent (Station sidebar) to refresh appointment lists
      onAppointmentChange?.();
      return true;
    } catch (e) {
      console.error('[Calendar] reschedule failed:', e);
      return false;
    }
  }, [storedAuth, tz, officeId, loadAll, localTimeToUTC, onAppointmentChange]);

  // Stable ref so the drag useEffect never re-subscribes when handleReschedule changes
  const handleRescheduleRef = useRef(handleReschedule);
  handleRescheduleRef.current = handleReschedule;

  const handleApptDrop = useCallback(async (apptId: string, dateKey: string, time: string) => {
    // ── Same-slot check (cheap, no network) ──
    const appt = appointmentsRef.current.find(a => a.id === apptId);
    if (appt) {
      const curTime = formatTimeInTz(appt.scheduled_at, tz);
      const curDate = dateKeyInTz(new Date(appt.scheduled_at), tz);
      if (curDate === dateKey && curTime === time) return; // Dropped back on same cell — no-op
    }

    // Save original scheduled_at BEFORE optimistic update — handleReschedule
    // needs it because the optimistic update will have already changed
    // appointmentsRef by the time ensureAuth() yields
    const originalScheduledAt = appt?.scheduled_at;

    // ── Optimistic UI: instantly move the appointment in local state ──
    const newScheduledAt = localTimeToUTC(dateKey, time, tz);
    setAppointments(prev => prev.map(a =>
      a.id === apptId ? { ...a, scheduled_at: newScheduledAt } : a
    ));

    // ── Async server update (pass original time so same-slot check works) ──
    const ok = await handleRescheduleRef.current(apptId, dateKey, time, { skipSelect: true, originalScheduledAt });
    if (ok) {
      // Build descriptive message with full context
      const name = appt?.customer_name || translate(locale, 'Appointment');
      const service = appt?.service?.name || '';
      const [y, m, d] = dateKey.split('-').map(Number);
      const dateObj = new Date(y, m - 1, d);
      const dayName = dateObj.toLocaleDateString(locale === 'ar' ? 'ar-SA' : locale === 'fr' ? 'fr-FR' : 'en-US', { weekday: 'short' });
      const dateStr = dateObj.toLocaleDateString(locale === 'ar' ? 'ar-SA' : locale === 'fr' ? 'fr-FR' : 'en-US', { month: 'short', day: 'numeric' });
      // e.g. "Ahmed's Consultation moved to Wed, Apr 16 at 09:30"
      const movedTo = locale === 'fr' ? 'déplacé au' : locale === 'ar' ? 'نُقل إلى' : 'moved to';
      const atWord = locale === 'fr' ? 'à' : locale === 'ar' ? 'الساعة' : 'at';
      const servicePart = service ? ` · ${service}` : '';
      setDropFeedback({ type: 'success', message: `${name}${servicePart} ${movedTo} ${dayName} ${dateStr} ${atWord} ${time}` });
    } else {
      // Revert optimistic update on failure
      if (originalScheduledAt) {
        setAppointments(prev => prev.map(a =>
          a.id === apptId ? { ...a, scheduled_at: originalScheduledAt } : a
        ));
      }
      setDropFeedback({ type: 'error', message: translate(locale, 'This time slot is not available') });
    }
    setTimeout(() => setDropFeedback(null), 3000);
  }, [tz, localTimeToUTC, locale]);

  // ── Save notes ─────────────────────────────────────────────────

  const handleNotesChange = useCallback(async (appointmentId: string, notes: string) => {
    try {
      await ensureAuth();
      const sb = await getSupabase();
      await sb.from('appointments').update({ notes: notes || null }).eq('id', appointmentId);
      // Update local state so the grid reflects the change
      setAppointments(prev => prev.map(a => a.id === appointmentId ? { ...a, notes: notes || null } : a));
      if (selectedAppt?.id === appointmentId) {
        setSelectedAppt(prev => prev ? { ...prev, notes: notes || null } : prev);
      }
    } catch (e) { console.error('[Calendar] save notes error:', e); }
  }, [storedAuth, selectedAppt?.id]);

  // ── Computed data ─────────────────────────────────────────────

  const displayAppointments = useMemo(() => {
    const q = globalSearch.trim().toLowerCase();
    if (!q) return appointments;
    return appointments.filter(a => {
      const nm = (a.customer_name || '').toLowerCase();
      const ph = (a.customer_phone || '').toLowerCase();
      const nt = (a.notes || '').toLowerCase();
      return nm.includes(q) || ph.includes(q) || nt.includes(q);
    });
  }, [appointments, globalSearch]);

  const apptsByDate = useMemo(() => groupByDate(displayAppointments, tz), [displayAppointments, tz]);
  const apptCounts = useMemo(() => countByDate(displayAppointments, tz), [displayAppointments, tz]);

  const headerLabel = viewMode === 'week' && weekDays.length
    ? formatWeekRange(weekDays[0].date, weekDays[6].date, intlLocale)
    : formatMonthYear(currentDate, intlLocale);
  const listHeaderLabel = useMemo(() => {
    if (viewMode !== 'list') return '';
    if (listDateFilter) {
      const d = new Date(listDateFilter + 'T12:00:00');
      const dayLabel = d.toLocaleDateString(intlLocale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      return `${dayLabel} — ${listAppointments.length} ${t('appointments')}`;
    }
    return `${formatMonthYear(currentDate, intlLocale)} — ${listAppointments.length} ${t('appointments')}`;
  }, [viewMode, listDateFilter, listAppointments.length, currentDate, intlLocale]);

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
      style={embedded ? {
        position: 'relative', width: '100%', height: '100%',
        display: 'flex', alignItems: 'stretch', justifyContent: 'stretch',
      } : {
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.8)', backdropFilter: 'blur(4px)',
        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
      onClick={embedded ? undefined : onClose}
    >
      <div
        onClick={embedded ? undefined : (e => e.stopPropagation())}
        style={embedded ? {
          background: 'var(--surface, #1e293b)',
          width: '100%', height: '100%',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        } : {
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
            fontSize: 11, fontWeight: 700,
            color: appointments.length >= 2000 ? '#ef4444' : '#3b82f6',
            background: appointments.length >= 2000 ? 'rgba(239,68,68,0.12)' : 'rgba(59,130,246,0.12)',
            borderRadius: 10, padding: '2px 8px',
          }}
          title={appointments.length >= 2000 ? 'Limit reached — some appointments may be hidden' : undefined}
          >
            {appointments.length}{appointments.length >= 2000 ? '+' : ''}
          </span>

          <div style={{ display: 'flex', gap: 4, marginLeft: 12 }}>
            <button onClick={goToday} style={btnStyle()}>{t('Today')}</button>
            <button onClick={goPrev} style={navBtn}>◂</button>
            <button onClick={goNext} style={navBtn}>▸</button>
          </div>

          <div style={{ display: 'flex', gap: 2, marginLeft: 8, border: '1px solid var(--border, #475569)', borderRadius: 8, overflow: 'hidden' }}>
            <button onClick={() => {
              resetPanelsTo(currentDate);
              setViewMode('week');
            }} style={btnStyle(viewMode === 'week')}>
              {t('Week')}
            </button>
            <button onClick={() => setViewMode('month')} style={btnStyle(viewMode === 'month')}>
              {t('Month')}
            </button>
            <button onClick={() => setViewMode('list')} style={btnStyle(viewMode === 'list')}>
              {t('List')}
            </button>
          </div>

          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text, #f1f5f9)', minWidth: 160, marginLeft: 12 }}>
            {viewMode === 'list' ? listHeaderLabel : headerLabel}
          </span>

          <div style={{ flex: 1 }} />

          <div style={{ position: 'relative' }}>
            <input
              type="text"
              value={globalSearch}
              onChange={e => setGlobalSearch(e.target.value)}
              onKeyDown={e => e.stopPropagation()}
              placeholder={`🔍 ${t('Search name, phone...')}`}
              style={{
                padding: '5px 10px', paddingRight: globalSearch ? 26 : 10,
                borderRadius: 6, border: '1px solid var(--border, #475569)',
                background: 'var(--surface2, #0f172a)', color: 'var(--text, #f1f5f9)',
                fontSize: 12, width: 180, outline: 'none',
              }}
            />
            {globalSearch && (
              <button onClick={() => setGlobalSearch('')} style={{
                position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', color: '#64748b', cursor: 'pointer',
                fontSize: 14, padding: 2, lineHeight: 1,
              }}>✕</button>
            )}
          </div>

          {loading && (
            <div style={{ width: 16, height: 16, border: '2px solid #3b82f6', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
          )}

          {!embedded && (
            <button onClick={onClose} style={{
              background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
              color: '#ef4444', width: 30, height: 30, borderRadius: 8,
              fontSize: 16, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>×</button>
          )}
        </div>

        {/* ─── Body: sidebar | calendar grid | detail panel ─── */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* Left sidebar */}
          <div style={{
            width: 220, flexShrink: 0, borderRight: '1px solid var(--border, #334155)',
            overflow: 'hidden', padding: '12px 10px',
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
              holidaysByDate={holidaysByDate}
            />

            {/* ─── Live Activity Log ─── */}
            <div style={{
              marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border, #334155)',
              flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0,
            }}>
              <div style={{
                fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase',
                letterSpacing: 0.8, marginBottom: 8, paddingLeft: 4,
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <span style={{
                  width: 7, height: 7, borderRadius: '50%', background: '#22c55e',
                  boxShadow: '0 0 6px rgba(34,197,94,0.5)',
                  animation: 'pulse 2s ease-in-out infinite',
                }} />
                {t('Activity')}
                {activityLog.length > 0 && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, color: '#3b82f6',
                    background: 'rgba(59,130,246,0.12)', borderRadius: 8,
                    padding: '1px 5px', marginLeft: 2,
                  }}>{activityLog.length}</span>
                )}
              </div>
              <div style={{
                flex: 1, overflow: 'auto', minHeight: 0,
                display: 'flex', flexDirection: 'column', gap: 4,
              }}>
                <div ref={activityEndRef} />
                {activityLog.length === 0 && (
                  <div style={{
                    fontSize: 11, color: '#475569', textAlign: 'center',
                    padding: '32px 12px', lineHeight: 1.6,
                  }}>
                    <div style={{ fontSize: 24, marginBottom: 6, opacity: 0.5 }}>📋</div>
                    {t('Waiting for changes...')}
                  </div>
                )}
                {[...activityLog].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).map(entry => {
                  const meta = EVENT_META[entry.eventType];
                  const isToday = entry.timestamp.toDateString() === new Date().toDateString();
                  const timeStr = isToday
                    ? entry.timestamp.toLocaleTimeString(intlLocale, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                    : entry.timestamp.toLocaleDateString(intlLocale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                  const dateStr = entry.scheduledAt
                    ? new Date(entry.scheduledAt).toLocaleDateString(intlLocale, { month: 'short', day: 'numeric', timeZone: tz })
                    : '';
                  const isSelected = selectedAppt?.id === entry.appointmentId;
                  return (
                    <div key={entry.id} onClick={() => handleActivityClick(entry)} style={{
                      padding: '8px 8px', borderRadius: 8,
                      cursor: 'pointer',
                      background: isSelected ? `${meta.color}26` : 'rgba(100,116,139,0.04)',
                      borderTop: isSelected ? `1px solid ${meta.color}80` : '1px solid transparent',
                      borderRight: isSelected ? `1px solid ${meta.color}80` : '1px solid transparent',
                      borderBottom: isSelected ? `1px solid ${meta.color}80` : '1px solid transparent',
                      borderLeft: `${isSelected ? 5 : 3}px solid ${meta.color}`,
                      boxShadow: isSelected ? `0 0 0 1px ${meta.color}40` : 'none',
                      fontSize: 10, lineHeight: 1.4,
                      transition: 'background 0.15s, border 0.15s, box-shadow 0.15s',
                    }}
                    onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'rgba(100,116,139,0.1)'; }}
                    onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'rgba(100,116,139,0.04)'; }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                        <span style={{
                          fontWeight: 800, color: meta.color, fontSize: 10, textTransform: 'uppercase',
                          letterSpacing: 0.3,
                        }}>
                          {meta.icon} {t(meta.labelKey)}
                        </span>
                        <span style={{ marginLeft: 'auto', color: '#64748b', fontSize: 9, fontVariantNumeric: 'tabular-nums' }}>{timeStr}</span>
                      </div>
                      <div dir="auto" style={{ color: 'var(--text, #f1f5f9)', fontWeight: 600, fontSize: 12, paddingLeft: 1, unicodeBidi: 'isolate' }}>
                        {entry.customerName}
                      </div>
                      <div style={{ display: 'flex', gap: 4, paddingLeft: 1, color: '#64748b', fontSize: 9, marginTop: 2, flexWrap: 'wrap' }}>
                        {entry.serviceName && <span>{entry.serviceName}</span>}
                        {dateStr && <span>· {dateStr}</span>}
                        {entry.source && (
                          <span style={{
                            background: 'rgba(100,116,139,0.12)', borderRadius: 4,
                            padding: '0 4px', fontSize: 8,
                          }}>
                            {entry.source.replace('_', ' ')}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Calendar grid */}
          <div
            onPointerDown={onSwipeDown}
            onPointerMove={onSwipeMove}
            onPointerUp={onSwipeUp}
            onPointerCancel={onSwipeUp}

            onClick={() => {
              // Click on the calendar area closes side panels
              setSelectedAppt(null);
              setBookingSlot(null);
            }}
            style={{
              flex: 1, overflow: viewMode === 'week' ? 'hidden' : viewMode === 'list' ? 'hidden' : 'auto', minWidth: 0,
              position: 'relative', userSelect: 'none' as const,
            }}
          >
            {viewMode === 'week' ? (
              <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
                {/* Vertical scroll + flex row: fixed gutter | carousel */}
                <div ref={scrollContainerRef} style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden', display: 'flex' }}>
                  {/* Time gutter — stays fixed, scrolls vertically only */}
                  <div style={{ width: 52, flexShrink: 0, zIndex: 2, borderRight: '1px solid var(--border, #334155)', background: 'var(--bg, #0f172a)' }}>
                    <div style={{ height: 40, borderBottom: '1px solid var(--border, #475569)' }} />
                    {Array.from({ length: Math.ceil((END_HOUR - START_HOUR) * 60 / slotDuration) }, (_, si) => {
                      const totalMin = START_HOUR * 60 + si * slotDuration;
                      const h = Math.floor(totalMin / 60);
                      const m = totalMin % 60;
                      const label = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                      const isHighlighted = selectedSlotIdx === si;
                      return (
                        <div key={label} style={{
                          height: slotHeightPx,
                          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                          paddingRight: 8,
                          fontSize: m === 0 ? 10 : 9,
                          color: isHighlighted ? '#93c5fd' : m === 0 ? 'var(--text2, #94a3b8)' : 'var(--text3, #475569)',
                          fontWeight: isHighlighted ? 700 : m === 0 ? 600 : 400,
                          background: isHighlighted ? 'rgba(59,130,246,0.08)' : 'transparent',
                          borderRadius: isHighlighted ? 4 : 0,
                        }}>
                          {label}
                        </div>
                      );
                    })}
                  </div>
                  {/* Per-panel carousel — each panel absolutely positioned */}
                  <div ref={panelContainerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                    {[0, 1, 2].map(idx => (
                      <div
                        key={idx}
                        ref={el => { panelElRefs.current[idx] = el; }}
                        style={{
                          position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                          willChange: 'transform', backfaceVisibility: 'hidden' as const,
                        }}
                      >
                        <MemoWeekView
                          days={panelDaysList[idx]}
                          appointmentsByDate={apptsByDate}
                          timezone={tz}
                          serviceMap={serviceMap}
                          intlLocale={intlLocale}
                          locale={locale}
                          selectedApptId={panelOffsetsRef.current[idx] === 0 ? (selectedAppt?.id ?? null) : null}
                          operatingHours={alwaysOpen ? null : operatingHours}
                          onSelect={(a) => { setBookingSlot(null); setSelectedAppt(a); }}
                          hideGutter
                          onCellSelect={setSelectedSlotIdx}
                          holidaysByDate={holidaysByDate}
                          selectedDates={selectedDates}
                          onDayContext={handleDayContext}
                          onDayHeaderClick={handleDayHeaderClick}
                          onSlotDoubleClick={(dateKey, time) => {
                            setSelectedAppt(null);
                            // Delegate to parent so the unified InHouseBookingPanel
                            // handles intake (same fields across queue + calendar).
                            onSlotBook?.(dateKey, time);
                          }}
                          clearSelection={!bookingSlot}
                          startHour={START_HOUR}
                          endHour={END_HOUR}
                          onWeekNavigate={navigateWeek}
                          slotDuration={slotDuration}
                          onApptDrop={handleApptDrop}
                          onDropBlocked={(msg) => {
                            setDropFeedback({ type: 'error', message: msg });
                            setTimeout(() => setDropFeedback(null), 3000);
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : viewMode === 'month' ? (
              <DesktopMonthView
                days={monthDays}
                appointmentCounts={apptCounts}
                appointmentsByDate={apptsByDate}
                timezone={tz}
                serviceMap={serviceMap}
                intlLocale={intlLocale}
                locale={locale}
                operatingHours={alwaysOpen ? null : operatingHours}
                onSelect={(a) => { setBookingSlot(null); setSelectedAppt(a); }}
                selectedApptId={selectedAppt?.id ?? null}
                holidaysByDate={holidaysByDate}
                onDayContext={handleDayContext}
                onDayClick={(date) => {
                  setCurrentDate(date);
                  resetPanelsTo(date);
                  setViewMode('week');
                }}
              />
            ) : (
              <DesktopListView
                groups={listGrouped}
                appointments={listAppointments}
                timezone={tz}
                serviceMap={serviceMap}
                departments={departments}
                intlLocale={intlLocale}
                locale={locale}
                operatingHours={alwaysOpen ? null : operatingHours}
                holidaysByDate={holidaysByDate}
                selectedApptId={selectedAppt?.id ?? null}
                onSelect={(a) => { setBookingSlot(null); setSelectedAppt(a); }}
                onSlotBook={(dateKey, time) => {
                  setSelectedAppt(null);
                  // Delegate to parent (Station) so the unified InHouseBookingPanel
                  // handles intake. Fields come from intake_fields settings.
                  onSlotBook?.(dateKey, time);
                }}
                onDayClick={(date) => {
                  setCurrentDate(date);
                  resetPanelsTo(date);
                  setViewMode('week');
                }}
                dateFilter={listDateFilter}
                onClearDateFilter={() => setListDateFilter(null)}
              />
            )}
          </div>

          {/* Detail panel */}
          {selectedAppt && !bookingSlot && (
            <DesktopApptDetail
              appointment={selectedAppt}
              timezone={tz}
              serviceMap={serviceMap}
              departments={departments}
              locale={locale}
              intlLocale={intlLocale}
              actionBusy={actionBusy}
              officeId={officeId}
              storedAuth={storedAuth}
              onClose={() => setSelectedAppt(null)}
              onAction={(action) => handleAction(selectedAppt, action)}
              onDelete={async () => {
                const appt = selectedAppt;
                if (!appt) return;
                const customerName = appt.customer_name || t('Unknown');
                const svcName = serviceMap.get(appt.service_id)?.name || '';
                const yes = await confirm(
                  t('Permanently delete appointment for {name}?', { name: customerName }) + (svcName ? ` (${svcName})` : '') + '\n' + t('This cannot be undone. The time slot will become available again.'),
                  { title: t('Delete Appointment'), confirmLabel: t('Delete'), variant: 'danger' },
                );
                if (yes) handleAction(appt, 'delete');
              }}
              onNotesChange={handleNotesChange}
              onOpenCustomer={onOpenCustomer}
              onReschedule={handleReschedule}
            />
          )}

          {/* Drop feedback toast */}
          {dropFeedback && (
            <div style={{
              position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
              padding: '12px 24px', borderRadius: 10, maxWidth: '90%',
              background: dropFeedback.type === 'success'
                ? 'linear-gradient(135deg, rgba(34,197,94,0.95), rgba(21,128,61,0.95))'
                : 'linear-gradient(135deg, rgba(239,68,68,0.95), rgba(185,28,28,0.95))',
              color: '#fff', fontSize: 13, fontWeight: 600, zIndex: 100,
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              animation: 'toast-in 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
              display: 'flex', alignItems: 'center', gap: 8,
              pointerEvents: 'none',
            }}>
              {dropFeedback.type === 'success' ? '✓' : '✕'} {dropFeedback.message}
            </div>
          )}

          {/* Quick Booking panel removed — booking now goes through the unified
              InHouseBookingPanel in Station.tsx via onSlotBook prop. Single intake
              form, fed by intake_fields settings, shared with the queue screen. */}
        </div>
      </div>

      {/* ─── Context menu ─── */}
      {ctxMenu && (() => {
        const dateHoliday = holidaysByDate.get(ctxMenu.dateKey);
        const dateLabel = new Date(ctxMenu.dateKey + 'T12:00:00').toLocaleDateString(intlLocale, { weekday: 'short', month: 'short', day: 'numeric' });
        return (
          <div
            ref={ctxMenuRef}
            style={{
              position: 'fixed', left: ctxMenu.x, top: ctxMenu.y, zIndex: 2000,
              background: 'var(--surface, #1e293b)', border: '1px solid var(--border, #475569)',
              borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.4)', padding: 4, minWidth: 190,
            }}
          >
            <div style={{ padding: '4px 12px 6px', fontSize: 10, color: '#64748b', fontWeight: 600 }}>{dateLabel}</div>
            {!dateHoliday && (
              <div
                role="button"
                onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); const dk = ctxMenu.dateKey; requestAnimationFrame(() => openDayOffDialog(dk)); }}
                style={{
                  display: 'block', width: '100%', padding: '8px 12px', border: 'none',
                  background: 'transparent', color: '#fca5a5', fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', textAlign: 'left', borderRadius: 6,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.12)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                🚫 {t('Mark as day off')}
              </div>
            )}
            {dateHoliday && (
              <div
                role="button"
                onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); const dk = ctxMenu.dateKey; requestAnimationFrame(() => handleRemoveHoliday(dk)); }}
                style={{
                  display: 'block', width: '100%', padding: '8px 12px', border: 'none',
                  background: 'transparent', color: '#22c55e', fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', textAlign: 'left', borderRadius: 6,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(34,197,94,0.12)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                ✅ {t('Remove day off')}
                <span style={{ fontSize: 10, color: '#64748b', marginLeft: 6 }}>({dateHoliday.name})</span>
              </div>
            )}
            {holidays.length > 0 && (
              <>
                <div style={{ height: 1, background: 'var(--border, #475569)', margin: '4px 8px' }} />
                <div
                  role="button"
                  onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); requestAnimationFrame(() => handleClearAllHolidays()); }}
                  style={{
                    display: 'block', width: '100%', padding: '8px 12px', border: 'none',
                    background: 'transparent', color: '#f59e0b', fontSize: 12, fontWeight: 600,
                    cursor: 'pointer', textAlign: 'left', borderRadius: 6,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(245,158,11,0.12)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  🗑️ {t('Clear all days off')}
                  <span style={{ fontSize: 10, color: '#64748b', marginLeft: 6 }}>({holidays.length})</span>
                </div>
              </>
            )}
          </div>
        );
      })()}

      {/* ─── Day-off dialog ─── */}
      {dayOffDialog && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2001,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={(e) => { e.stopPropagation(); setDayOffDialog(null); setDayOffNotifyResult(null); }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'var(--surface, #1e293b)', borderRadius: 12,
            border: '1px solid var(--border, #475569)', padding: 20,
            width: 360, boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
          }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700, color: 'var(--text, #f1f5f9)' }}>
              🚫 {t('Mark as day off')}
            </h3>
            <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
              <label style={{ flex: 1 }}>
                <span style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>{t('From')}</span>
                <DatePicker value={dayOffDialog.startDate}
                  onChange={e => setDayOffDialog(d => d ? { ...d, startDate: e.target.value, endDate: e.target.value < d.endDate ? d.endDate : e.target.value } : d)}
                  style={{
                    width: '100%', padding: '7px 10px', borderRadius: 8, fontSize: 13,
                    border: '1px solid var(--border, #475569)', background: 'var(--bg, #0f172a)',
                    color: 'var(--text, #f1f5f9)', outline: 'none', boxSizing: 'border-box',
                  }}
                />
              </label>
              <label style={{ flex: 1 }}>
                <span style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>{t('To')}</span>
                <DatePicker value={dayOffDialog.endDate}
                  min={dayOffDialog.startDate}
                  onChange={e => setDayOffDialog(d => d ? { ...d, endDate: e.target.value } : d)}
                  style={{
                    width: '100%', padding: '7px 10px', borderRadius: 8, fontSize: 13,
                    border: '1px solid var(--border, #475569)', background: 'var(--bg, #0f172a)',
                    color: 'var(--text, #f1f5f9)', outline: 'none', boxSizing: 'border-box',
                  }}
                />
              </label>
            </div>
            {(() => {
              const days = expandRange(dayOffDialog.startDate, dayOffDialog.endDate);
              const newDays = days.filter(d => !holidaysByDate.has(d));
              return (
                <p style={{ margin: '0 0 10px', fontSize: 11, color: '#64748b' }}>
                  {days.length === 1
                    ? new Date(days[0] + 'T12:00:00').toLocaleDateString(intlLocale, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
                    : `${days.length} ${t('days')}${newDays.length < days.length ? ` (${days.length - newDays.length} ${t('already marked')})` : ''}`
                  }
                </p>
              );
            })()}
            <input
              autoFocus
              type="text"
              value={dayOffName}
              onChange={e => setDayOffName(e.target.value)}
              placeholder={t('Reason (e.g. Public holiday, Vacation...)')}
              onKeyDown={e => e.key === 'Enter' && !dayOffBusy && handleCreateHolidays()}
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 13,
                border: '1px solid var(--border, #475569)', background: 'var(--bg, #0f172a)',
                color: 'var(--text, #f1f5f9)', outline: 'none', boxSizing: 'border-box',
              }}
            />

            {/* Notify customers toggles */}
            <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#93c5fd', marginBottom: 8 }}>
                {t('Notify affected customers')}
              </div>
              <div style={{ display: 'flex', gap: 16 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: 'var(--text, #f1f5f9)' }}>
                  <input type="checkbox" checked={dayOffNotify.whatsapp}
                    onChange={e => setDayOffNotify(n => ({ ...n, whatsapp: e.target.checked }))}
                    style={{ accentColor: '#25d366' }}
                  />
                  WhatsApp
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: 'var(--text, #f1f5f9)' }}>
                  <input type="checkbox" checked={dayOffNotify.sms}
                    onChange={e => setDayOffNotify(n => ({ ...n, sms: e.target.checked }))}
                    style={{ accentColor: '#3b82f6' }}
                  />
                  SMS
                </label>
              </div>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>
                {t('Customers with appointments on these dates will be notified and their appointments cancelled')}
              </div>
              <div
                role="button"
                onClick={() => setDayOffShowPreview(p => !p)}
                style={{ fontSize: 10, color: '#60a5fa', marginTop: 6, cursor: 'pointer', fontWeight: 600 }}
              >
                {dayOffShowPreview ? '▼' : '▶'} {t('Preview message')}
              </div>
              {dayOffShowPreview && (
                <div style={{
                  marginTop: 6, padding: '8px 10px', borderRadius: 6,
                  background: 'rgba(0,0,0,0.15)', fontSize: 11, lineHeight: 1.5,
                  color: 'var(--text2, #94a3b8)', whiteSpace: 'pre-wrap', fontFamily: 'monospace',
                }}>
                  {locale === 'ar'
                    ? `📅 *[${t('Business name')}]*\n\n⚠️ نعلمكم أن *[${t('Office')}]* سيكون مغلقاً في الأيام التالية:\n\n📋 *السبب:* ${dayOffName.trim() || t('Day off')}\n\nتم إلغاء موعدكم. يرجى إعادة الحجز في وقت لاحق.\n\nنعتذر عن أي إزعاج.`
                    : `📅 *[${t('Business name')}]*\n\n⚠️ Nous vous informons que *[${t('Office')}]* sera fermé le(s) jour(s) suivant(s) :\n\n📋 *Motif :* ${dayOffName.trim() || t('Day off')}\n\nVotre rendez-vous a été annulé. Veuillez reprogrammer à votre convenance.\n\nNous nous excusons pour le désagrément.`
                  }
                </div>
              )}
            </div>

            {/* Notification result */}
            {dayOffNotifyResult && (
              <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#4ade80', marginBottom: 4 }}>
                  {t('Notifications sent')}
                </div>
                {dayOffNotifyResult.whatsapp && (
                  <div style={{ fontSize: 11, color: 'var(--text, #f1f5f9)' }}>
                    WhatsApp: {dayOffNotifyResult.whatsapp.sent} {t('sent')}{dayOffNotifyResult.whatsapp.failed > 0 ? `, ${dayOffNotifyResult.whatsapp.failed} ${t('failed')}` : ''}
                  </div>
                )}
                {dayOffNotifyResult.sms && (
                  <div style={{ fontSize: 11, color: 'var(--text, #f1f5f9)' }}>
                    SMS: {dayOffNotifyResult.sms.sent} {t('sent')}{dayOffNotifyResult.sms.failed > 0 ? `, ${dayOffNotifyResult.sms.failed} ${t('failed')}` : ''}
                  </div>
                )}
                {dayOffNotifyResult.cancelled != null && dayOffNotifyResult.cancelled > 0 && (
                  <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 2 }}>
                    {dayOffNotifyResult.cancelled} {t('appointments cancelled')}
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
              <button onClick={() => { setDayOffDialog(null); setDayOffNotifyResult(null); }} style={{
                padding: '7px 16px', borderRadius: 8, border: '1px solid var(--border, #475569)',
                background: 'transparent', color: 'var(--text2, #94a3b8)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}>{dayOffNotifyResult ? t('Close') : t('Cancel')}</button>
              {!dayOffNotifyResult && (
                <button onClick={handleCreateHolidays} disabled={dayOffBusy} style={{
                  padding: '7px 16px', borderRadius: 8, border: 'none',
                  background: '#ef4444', color: '#fff', fontSize: 12, fontWeight: 600,
                  cursor: dayOffBusy ? 'not-allowed' : 'pointer', opacity: dayOffBusy ? 0.5 : 1,
                }}>{dayOffBusy ? '...' : t('Confirm')}</button>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
      `}</style>
    </div>
  );
}

// ── Mini Calendar ─────────────────────────────────────────────────

function MiniCalendar({
  currentDate, selectedDateKey, weekDays, appointmentCounts,
  intlLocale, timezone, operatingHours, onDateClick, onMonthNav, holidaysByDate,
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
  holidaysByDate?: Map<string, { id: string; holiday_date: string; name: string; is_full_day: boolean }>;
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

  // Build 6×7 grid starting from Monday — uses shared getMonthGrid for timezone safety
  const cells = useMemo(() => {
    return getMonthGrid(year, month, timezone).map(d => d.date);
  }, [year, month, timezone]);

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
          const cellDayName = getDayNameFromKey(cellKey);
          const cellClosed = operatingHours ? isDayClosed(operatingHours, cellDayName) : false;
          const cellHoliday = holidaysByDate?.get(cellKey);

          // Priority: selected > today > in-week > default
          let bg = 'transparent';
          let fg = isCurrentMonth ? (cellClosed ? '#475569' : 'var(--text, #f1f5f9)') : '#334155';
          if (cellHoliday && isCurrentMonth) fg = '#fca5a5';
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
  days, appointmentsByDate, timezone, serviceMap, intlLocale, locale, selectedApptId, operatingHours, onSelect, hideGutter, onCellSelect,
  holidaysByDate, selectedDates, onDayContext, onDayHeaderClick, onSlotDoubleClick, clearSelection,
  startHour: START_HOUR = DEFAULT_START_HOUR, endHour: END_HOUR = DEFAULT_END_HOUR,
  onWeekNavigate, slotDuration = 30, onApptDrop, onDropBlocked,
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
  hideGutter?: boolean;
  onCellSelect?: (slotIdx: number | null) => void;
  holidaysByDate?: Map<string, { id: string; holiday_date: string; name: string; is_full_day: boolean }>;
  selectedDates?: Set<string>;
  onDayContext?: (e: React.MouseEvent, dateKey: string) => void;
  onDayHeaderClick?: (e: React.MouseEvent, dateKey: string) => void;
  onSlotDoubleClick?: (dateKey: string, time: string) => void;
  clearSelection?: boolean;
  startHour?: number;
  endHour?: number;
  /** Navigate to prev (-1) or next (1) week when arrow keys go past the edge */
  onWeekNavigate?: (direction: -1 | 1) => void;
  slotDuration?: number;
  /** Called when an appointment is dragged and dropped onto a new slot */
  onApptDrop?: (appointmentId: string, newDateKey: string, newTime: string) => void;
  /** Called when a drop is attempted on a closed/unavailable cell */
  onDropBlocked?: (message: string) => void;
}) {
  const t = (k: string, v?: Record<string, any>) => translate(locale, k, v);
  const slotHeightPx = (slotDuration / 60) * PIXELS_PER_HOUR;
  const [selectedCell, setSelectedCell] = useState<{ dayIdx: number; slotIdx: number } | null>(null);
  const [activeColIdx, setActiveColIdx] = useState<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // ── Pointer-based drag system ──────────────────────────────────
  // IMPORTANT: All drag highlight is done via direct DOM manipulation, NOT React state.
  // This avoids the stale-state bug caused by 3 carousel panel instances each having
  // their own competing dragOverCell state.
  const dragRef = useRef<{
    apptId: string;
    ghostEl: HTMLDivElement | null;
    startX: number;
    startY: number;
    didMove: boolean;
    highlightedEl: HTMLElement | null; // currently highlighted slot cell
    highlightedOrigBg: string; // original background to restore on clear
  } | null>(null);
  const rafRef = useRef<number | null>(null);
  const justDraggedRef = useRef(false);

  // Slot cell positions for hit-testing — keyed by "dateKey|time" for uniqueness
  const slotCellRefs = useRef<Map<string, { el: HTMLDivElement; dayIdx: number; slotIdx: number; dateKey: string; time: string; closed: boolean }>>(new Map());

  const registerSlotCell = useCallback((key: string, el: HTMLDivElement | null, dayIdx: number, slotIdx: number, dateKey: string, time: string, closed?: boolean) => {
    // Use dateKey|time as the map key so we can find cells across all 3 carousel panels
    const stableKey = `${dateKey}|${time}`;
    if (el) {
      slotCellRefs.current.set(stableKey, { el, dayIdx, slotIdx, dateKey, time, closed: !!closed });
    } else {
      slotCellRefs.current.delete(stableKey);
    }
  }, []);

  // Find which slot cell the pointer is over (skips closed/outside-hours cells)
  const hitTestSlot = useCallback((clientX: number, clientY: number) => {
    for (const [, info] of slotCellRefs.current) {
      const rect = info.el.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        if (info.closed) return null; // Can't drop on closed cells
        return info;
      }
    }
    return null;
  }, []);

  // Raw hit-test including closed cells — used to show "blocked" feedback during drag
  const hitTestSlotRaw = useCallback((clientX: number, clientY: number) => {
    for (const [, info] of slotCellRefs.current) {
      const rect = info.el.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        return info;
      }
    }
    return null;
  }, []);

  // Clear drag highlight from any element — restores original background
  const clearHighlight = useCallback(() => {
    const drag = dragRef.current;
    if (drag?.highlightedEl) {
      drag.highlightedEl.style.outline = '';
      drag.highlightedEl.style.outlineOffset = '';
      drag.highlightedEl.style.background = drag.highlightedOrigBg ?? '';
      drag.highlightedEl.style.borderRadius = '';
      drag.highlightedEl = null;
      drag.highlightedOrigBg = '';
    }
  }, []);

  // Apply drag highlight to a slot cell — saves original background first
  const applyHighlight = useCallback((el: HTMLElement) => {
    const drag = dragRef.current;
    if (drag) drag.highlightedOrigBg = el.style.background;
    el.setAttribute('data-drag-highlight', '1');
    el.style.outline = '2px dashed #22c55e';
    el.style.outlineOffset = '-2px';
    el.style.background = 'rgba(34,197,94,0.25)';
    el.style.borderRadius = '4px';
  }, []);

  // Full cleanup — called on drop, cancel, and Escape
  const cleanupDrag = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    // Remove ghost
    if (drag.ghostEl) {
      try { document.body.removeChild(drag.ghostEl); } catch {}
      drag.ghostEl = null;
    }
    // Clear highlight on tracked element
    clearHighlight();
    // Safety: query the ENTIRE DOM for any element with drag highlight
    // (covers orphaned elements after React re-renders)
    // NOTE: Don't clear `background` here — closed cells have stripe patterns
    // set via inline style that can't be restored. Only clear outline styling.
    document.querySelectorAll('[data-drag-highlight]').forEach((el) => {
      (el as HTMLElement).style.outline = '';
      (el as HTMLElement).style.outlineOffset = '';
      (el as HTMLElement).style.borderRadius = '';
      el.removeAttribute('data-drag-highlight');
    });
    // Restore ALL draggable appointment elements
    document.querySelectorAll('[data-appt-drag]').forEach((el) => {
      (el as HTMLElement).style.opacity = '1';
      (el as HTMLElement).style.transform = '';
    });
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    // Null immediately to prevent pointermove from re-applying highlight
    const wasDrag = drag?.didMove ?? false;
    dragRef.current = null;
    // Let onClick handlers know we just finished a drag (cleared after 60ms)
    if (wasDrag) {
      justDraggedRef.current = true;
      setTimeout(() => { justDraggedRef.current = false; }, 60);
    }
  }, [clearHighlight]);

  // Stable refs for values used inside the drag useEffect —
  // prevents re-subscribing listeners when these change.
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const onDropBlockedRef = useRef(onDropBlocked);
  onDropBlockedRef.current = onDropBlocked;

  // Stable ref for the drop callback — prevents the drag useEffect from
  // re-subscribing listeners every time appointments/locale changes.
  // Without this, every 30s poll or realtime event would tear down the
  // pointermove/pointerup listeners, calling cleanupDrag() and killing
  // any in-progress drag.
  const onApptDropRef = useRef(onApptDrop);
  onApptDropRef.current = onApptDrop;

  // Global pointermove/pointerup during drag — subscribes ONCE on mount
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (!drag.didMove && (dx * dx + dy * dy) < 64) return;
      drag.didMove = true;

      // Throttle via rAF for smooth 60fps
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        if (!dragRef.current) return;
        // Move ghost
        if (dragRef.current.ghostEl) {
          dragRef.current.ghostEl.style.transform = `translate(${e.clientX + 14}px, ${e.clientY - 18}px)`;
          dragRef.current.ghostEl.style.display = 'block';
        }
        // Hit-test and highlight via DOM (no React state)
        const hit = hitTestSlot(e.clientX, e.clientY);
        const rawHit = !hit ? hitTestSlotRaw(e.clientX, e.clientY) : null;
        const prevEl = dragRef.current.highlightedEl;
        if (hit) {
          // Valid drop target — green highlight
          if (prevEl !== hit.el) {
            clearHighlight();
            applyHighlight(hit.el);
            dragRef.current.highlightedEl = hit.el;
          }
        } else if (rawHit?.closed) {
          // Hovering over a closed cell — red blocked highlight
          if (prevEl !== rawHit.el) {
            clearHighlight();
            dragRef.current.highlightedOrigBg = rawHit.el.style.background;
            rawHit.el.setAttribute('data-drag-highlight', '1');
            rawHit.el.style.outline = '2px dashed #ef4444';
            rawHit.el.style.outlineOffset = '-2px';
            rawHit.el.style.background = 'rgba(239,68,68,0.15)';
            rawHit.el.style.borderRadius = '4px';
            dragRef.current.highlightedEl = rawHit.el;
          }
        } else if (prevEl) {
          clearHighlight();
        }
      });
    };

    const onUp = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      // Get drop target BEFORE cleanup
      let dropTarget: { dateKey: string; time: string } | null = null;
      let droppedOnClosed = false;
      if (drag.didMove) {
        const hit = hitTestSlot(e.clientX, e.clientY);
        if (hit) {
          dropTarget = { dateKey: hit.dateKey, time: hit.time };
        } else {
          // Check if we dropped on a closed cell
          const rawHit = hitTestSlotRaw(e.clientX, e.clientY);
          if (rawHit?.closed) droppedOnClosed = true;
        }
      }

      // Clean up everything immediately
      cleanupDrag();

      // Show alert if dropped on closed cell
      if (droppedOnClosed) {
        onDropBlockedRef.current?.(translate(localeRef.current, 'This time slot is closed'));
        return;
      }

      // Perform async drop (use ref so we always call the latest handler)
      if (dropTarget && onApptDropRef.current) {
        onApptDropRef.current(drag.apptId, dropTarget.dateKey, dropTarget.time);
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dragRef.current) {
        cleanupDrag();
      }
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      // Safety: cleanup any lingering drag state on unmount
      if (dragRef.current) cleanupDrag();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hitTestSlot, hitTestSlotRaw, cleanupDrag, clearHighlight, applyHighlight]);

  // Notify parent of selected slot for time gutter highlighting
  useEffect(() => {
    onCellSelect?.(selectedCell?.slotIdx ?? null);
  }, [selectedCell?.slotIdx, onCellSelect]);

  // Clear selection when parent signals (e.g. after booking completes)
  useEffect(() => {
    if (clearSelection) setSelectedCell(null);
  }, [clearSelection]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!selectedCell) return;
    const { dayIdx, slotIdx } = selectedCell;
    let newDay = dayIdx, newSlot = slotIdx;
    switch (e.key) {
      case 'ArrowRight': newDay = Math.min(dayIdx + 1, days.length - 1); break;
      case 'ArrowLeft': newDay = Math.max(dayIdx - 1, 0); break;
      case 'ArrowDown': newSlot = Math.min(slotIdx + 1, Math.ceil((END_HOUR - START_HOUR) * 60 / slotDuration) - 1); break;
      case 'ArrowUp': newSlot = Math.max(slotIdx - 1, 0); break;
      case 'Escape': setSelectedCell(null); e.preventDefault(); return;
      default: return;
    }
    e.preventDefault();
    e.nativeEvent.stopImmediatePropagation(); // Prevent global handler from also navigating weeks
    setSelectedCell({ dayIdx: newDay, slotIdx: newSlot });
  }, [selectedCell, days.length]);

  const slots: { hour: number; minute: number; label: string }[] = [];
  for (let totalMin = START_HOUR * 60; totalMin < END_HOUR * 60; totalMin += slotDuration) {
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    slots.push({ hour: h, minute: m, label: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` });
  }

  return (
    <div
      ref={gridRef}
      tabIndex={0}
      role="grid"
      aria-label={t('Weekly calendar')}
      onKeyDown={handleKeyDown}
      style={{ display: 'flex', minHeight: '100%', outline: 'none' }}
    >
      {/* Time gutter — only rendered when not in carousel mode */}
      {!hideGutter && (
        <div style={{ width: 52, flexShrink: 0, borderRight: '1px solid var(--border, #334155)' }}>
          <div style={{ height: 40, borderBottom: '1px solid var(--border, #475569)' }} />
          {slots.map((s, si) => {
            const isHighlightedRow = selectedCell !== null && selectedCell.slotIdx === si;
            return (
              <div key={s.label} style={{
                height: slotHeightPx,
                display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                paddingRight: 8,
                fontSize: s.minute === 0 ? 10 : 9,
                color: isHighlightedRow
                  ? '#93c5fd'
                  : s.minute === 0 ? 'var(--text2, #94a3b8)' : 'var(--text3, #475569)',
                fontWeight: isHighlightedRow ? 700 : s.minute === 0 ? 600 : 400,
                background: isHighlightedRow ? 'rgba(59,130,246,0.08)' : 'transparent',
                borderRadius: isHighlightedRow ? 4 : 0,
              }}>
                {s.label}
              </div>
            );
          })}
        </div>
      )}

      {/* Day columns */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
        {days.map((day, dayIdx) => {
          const dayAppts = appointmentsByDate.get(day.dateKey) ?? [];
          // Determine working hours for this day
          const dayHours = operatingHours?.[day.dayName];
          const dayClosed = operatingHours ? isDayClosed(operatingHours, day.dayName) : false;
          const openHour = dayHours && !dayClosed ? parseHHMM(dayHours.open) : null;
          const closeHour = dayHours && !dayClosed ? parseHHMM(dayHours.close) : null;
          const isHighlightedCol = (selectedCell !== null && selectedCell.dayIdx === dayIdx) || activeColIdx === dayIdx;
          const holiday = holidaysByDate?.get(day.dateKey);
          const isHoliday = !!holiday;
          const isMultiSelected = selectedDates?.has(day.dateKey);

          return (
            <div
              key={day.dateKey}
              role="columnheader"
              aria-label={formatDayHeader(day.date, timezone, intlLocale)}
              style={{
                borderRight: '1px solid var(--border, #334155)', position: 'relative',
              }}
            >
              {/* Day header — left-click to select, right-click to mark day off */}
              <div
                onClick={(e) => {
                  setActiveColIdx(activeColIdx === dayIdx ? null : dayIdx);
                  setSelectedCell(null);
                  onDayHeaderClick?.(e, day.dateKey);
                }}
                onContextMenu={onDayContext ? (e) => onDayContext(e, day.dateKey) : undefined}
                style={{
                  height: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  borderBottom: (isMultiSelected || isHighlightedCol || day.isToday)
                    ? '2px solid rgba(59,130,246,0.5)'
                    : '1px solid var(--border, #475569)',
                  cursor: 'pointer',
                  borderRadius: (isMultiSelected || isHighlightedCol || day.isToday) ? '4px 4px 0 0' : 0,
                  background: isMultiSelected
                    ? 'rgba(59,130,246,0.35)'
                    : isHoliday
                      ? 'rgba(239,68,68,0.15)'
                      : isHighlightedCol
                        ? 'rgba(59,130,246,0.35)'
                        : dayClosed ? 'rgba(239,68,68,0.12)' : day.isToday ? '#3b82f6' : 'transparent',
                  color: isHoliday ? '#fca5a5'
                    : dayClosed ? '#fca5a5'
                    : isHighlightedCol ? '#e2e8f0'
                    : day.isToday ? '#fff'
                    : 'var(--text, #e2e8f0)',
                  fontSize: 12, fontWeight: day.isToday || isHighlightedCol || isHoliday ? 700 : 500,
                }}>
                {formatDayHeader(day.date, timezone, intlLocale)}
                {isHoliday ? (
                  <span style={{ fontSize: 7, fontWeight: 700, lineHeight: '10px', color: '#fca5a5', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0 2px' }}>
                    {holiday.name}
                  </span>
                ) : dayClosed ? (
                  <span style={{ fontSize: 8, fontWeight: 700, lineHeight: '10px', color: '#fca5a5' }}>
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
                {/* Holiday overlay */}
                {isHoliday && (
                  <div style={{
                    position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none',
                    background: 'repeating-linear-gradient(135deg, transparent, transparent 6px, rgba(239,68,68,0.06) 6px, rgba(239,68,68,0.06) 12px)',
                  }} />
                )}
                {slots.map((s, si) => {
                  const slotTime = s.hour + s.minute / 60;
                  // Outside working hours: before open or after close
                  const isOutsideHours = !dayClosed && openHour !== null && closeHour !== null
                    && (slotTime < openHour || slotTime >= closeHour);
                  const isCrossHighlight = (selectedCell !== null
                    && (selectedCell.dayIdx === dayIdx || selectedCell.slotIdx === si))
                    || activeColIdx === dayIdx;
                  const isExactCell = selectedCell !== null
                    && selectedCell.dayIdx === dayIdx && selectedCell.slotIdx === si;
                  const cellKey = `${dayIdx}-${si}`;
                  const isCellClosed = dayClosed || isOutsideHours || isHoliday;
                  return (
                    <div
                      key={s.label}
                      ref={(el) => registerSlotCell(cellKey, el as HTMLDivElement | null, dayIdx, si, day.dateKey, s.label, isCellClosed)}
                      data-cell-closed={isCellClosed ? '1' : undefined}
                      onClick={() => {
                        // Don't select cell if we just finished a drag
                        if (justDraggedRef.current) return;
                        if (isCellClosed) return; // Can't select closed cells
                        setSelectedCell(
                          selectedCell?.dayIdx === dayIdx && selectedCell?.slotIdx === si ? null : { dayIdx, slotIdx: si }
                        );
                        setActiveColIdx(null);
                        onDayHeaderClick?.({ stopPropagation() {}, preventDefault() {} } as any, day.dateKey);
                      }}
                      style={{
                        height: slotHeightPx,
                        cursor: isCellClosed ? 'not-allowed' : 'pointer',
                        borderBottom: s.minute === 0
                          ? '1px solid var(--border, #334155)'
                          : '1px solid var(--border, #1e293b)',
                        background: isExactCell
                          ? 'rgba(59,130,246,0.25)'
                          : isCellClosed
                            ? 'rgba(239,68,68,0.045)'
                            : isCrossHighlight
                              ? 'rgba(59,130,246,0.12)'
                              : 'transparent',
                        transition: 'background 0.12s',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {isExactCell && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onSlotDoubleClick?.(day.dateKey, s.label); }}
                          style={{
                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0,
                            border: 'none',
                            background: 'transparent',
                            color: '#3b82f6',
                            padding: 0,
                            cursor: 'pointer', userSelect: 'none',
                            transition: 'all 0.1s',
                          }}
                          onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.8)'; }}
                          onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
                          title={translate(locale, 'Book Appointment')}
                        >
                          <span style={{ fontSize: 16, fontWeight: 700, lineHeight: 1 }}>+</span>
                          <span style={{ fontSize: 7, fontWeight: 600, lineHeight: 1, opacity: 0.7 }}>{s.label}</span>
                        </button>
                      )}
                    </div>
                  );
                })}

                {/* Appointment blocks — with overlap staggering */}
                {(() => {
                  // Compute layout columns for overlapping appointments
                  const positioned = dayAppts
                    .map(appt => {
                      const hour = getHourInTz(appt.scheduled_at, timezone);
                      const minute = getMinuteInTz(appt.scheduled_at, timezone);
                      if (hour < START_HOUR || hour >= END_HOUR) return null;
                      const svc = serviceMap.get(appt.service_id);
                      const duration = svc?.estimated_service_time ?? 30;
                      const topPx = (hour - START_HOUR) * PIXELS_PER_HOUR + (minute / 60) * PIXELS_PER_HOUR;
                      const height = Math.max((duration / 60) * PIXELS_PER_HOUR, 22);
                      const clippedHeight = Math.min(height, (END_HOUR - hour) * PIXELS_PER_HOUR - (minute / 60) * PIXELS_PER_HOUR);
                      return { appt, svc, hour, minute, topPx, clippedHeight };
                    })
                    .filter(Boolean) as { appt: CalendarAppointment; svc: any; hour: number; minute: number; topPx: number; clippedHeight: number }[];

                  // Assign columns: greedy left-to-right overlap detection
                  const columns: { topPx: number; bottom: number; col: number }[] = [];
                  const layout = positioned.map(item => {
                    const bottom = item.topPx + item.clippedHeight;
                    let col = 0;
                    for (const c of columns) {
                      if (c.col === col && c.bottom > item.topPx) col++;
                    }
                    columns.push({ topPx: item.topPx, bottom, col });
                    return { ...item, col };
                  });

                  // Find max columns per overlap group
                  const maxCols = layout.reduce((max, item) => Math.max(max, item.col + 1), 1);

                  const STATUS_STRIP: Record<string, { color: string; label: string }> = {
                    pending: { color: '#f59e0b', label: t('Pending') },
                    confirmed: { color: '#3b82f6', label: t('Confirmed') },
                    checked_in: { color: '#06b6d4', label: t('Checked In') },
                    called: { color: '#3b82f6', label: t('Called') },
                    serving: { color: '#f97316', label: t('Serving') },
                    completed: { color: '#22c55e', label: t('Completed') },
                    cancelled: { color: '#ef4444', label: t('Cancelled') },
                    no_show: { color: '#64748b', label: t('No Show') },
                    declined: { color: '#991b1b', label: t('Declined') },
                  };

                  return layout.map(({ appt, svc, hour, minute, topPx, clippedHeight, col }) => {
                    const color = getStatusColor(appt.status);
                    const isActive = appt.id === selectedApptId;
                    const colWidth = 100 / maxCols;
                    const left = col * colWidth;
                    const statusInfo = STATUS_STRIP[appt.status] ?? { color: '#64748b', label: appt.status };

                    // Allow drag for pending/confirmed/checked_in — not completed/served/cancelled
                    const canDrag = ['pending', 'confirmed', 'checked_in'].includes(appt.status);

                    return (
                      <div
                        key={appt.id}
                        role="button"
                        tabIndex={0}
                        data-appt-drag={appt.id}
                        onPointerDown={canDrag ? (e) => {
                          // Don't start new drag while one is in progress
                          if (dragRef.current) return;
                          e.stopPropagation();
                          // Create GPU-accelerated ghost (will-change + transform for 60fps)
                          const ghost = document.createElement('div');
                          ghost.textContent = `${appt.customer_name ?? ''} · ${formatTimeInTz(appt.scheduled_at, timezone)}`;
                          Object.assign(ghost.style, {
                            position: 'fixed', top: '0', left: '0', zIndex: '99999', display: 'none',
                            padding: '8px 16px', borderRadius: '10px',
                            background: color, color: '#fff',
                            fontSize: '13px', fontWeight: '700', fontFamily: 'inherit',
                            boxShadow: '0 12px 32px rgba(0,0,0,0.5), 0 0 0 2px rgba(255,255,255,0.15)',
                            borderLeft: `4px solid ${statusInfo.color}`,
                            whiteSpace: 'nowrap', pointerEvents: 'none',
                            willChange: 'transform',
                            transition: 'none',
                          });
                          document.body.appendChild(ghost);
                          dragRef.current = {
                            apptId: appt.id,
                            ghostEl: ghost,
                            startX: e.clientX,
                            startY: e.clientY,
                            didMove: false,
                            highlightedEl: null,
                            highlightedOrigBg: '',
                          };
                          // Fade source
                          (e.currentTarget as HTMLElement).style.opacity = '0.3';
                          (e.currentTarget as HTMLElement).style.transform = 'scale(0.95)';
                        } : undefined}
                        onClick={(e) => {
                          e.stopPropagation();
                          // Skip if we just finished a drag
                          if (justDraggedRef.current) return;
                          onSelect(appt);
                          setSelectedCell(null);
                          onDayHeaderClick?.({ stopPropagation() {}, preventDefault() {} } as any, day.dateKey);
                        }}
                        style={{
                          position: 'absolute', top: topPx,
                          borderRadius: 6,
                          left: `calc(${left}% + 2px)`,
                          width: `calc(${colWidth}% - 4px)`,
                          height: clippedHeight,
                          background: color + (isActive ? 'ff' : 'cc'),
                          color: '#fff',
                          border: isActive ? '2px solid #ef4444' : '1px solid rgba(255,255,255,0.15)',
                          borderLeft: isActive ? '2px solid #ef4444' : `4px solid ${statusInfo.color}`,
                          padding: '2px 5px 2px 4px', textAlign: 'left',
                          cursor: canDrag ? 'grab' : 'pointer',
                          fontSize: clippedHeight < 28 ? 9 : 11,
                          lineHeight: clippedHeight < 28 ? '11px' : '14px',
                          overflow: 'hidden', zIndex: isActive ? 15 : 10,
                          boxShadow: isActive ? '0 0 0 2px rgba(239,68,68,0.3), 0 2px 8px rgba(0,0,0,0.3)' : 'none',
                          transition: 'border 0.15s, box-shadow 0.15s, left 0.2s, width 0.2s, opacity 0.2s, transform 0.2s',
                          userSelect: 'none',
                          touchAction: 'none',
                        }}
                        title={`${appt.customer_name} - ${svc?.name ?? ''} (${statusInfo.label})${canDrag ? ' — drag to reschedule' : ''}`}
                      >
                        <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {appt.customer_name}
                        </div>
                        {clippedHeight >= 34 && (
                          <div style={{ opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingLeft: 9 }}>
                            {formatTimeInTz(appt.scheduled_at, timezone)} · {svc?.name ?? ''}
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}

                {day.isToday && <DesktopTimeIndicator timezone={timezone} startHour={START_HOUR} endHour={END_HOUR} />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const MemoWeekView = React.memo(DesktopWeekView);

function DesktopTimeIndicator({ timezone, startHour = DEFAULT_START_HOUR, endHour = DEFAULT_END_HOUR }: { timezone: string; startHour?: number; endHour?: number }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const iv = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(iv); }, []);
  const h = getHourInTz(now, timezone);
  const m = getMinuteInTz(now, timezone);
  if (h < startHour || h >= endHour) return null;
  const top = (h - startHour) * PIXELS_PER_HOUR + (m / 60) * PIXELS_PER_HOUR;
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top, zIndex: 20, pointerEvents: 'none', display: 'flex', alignItems: 'center' }}>
      <div style={{ width: 8, height: 8, borderRadius: 4, background: '#ef4444', marginLeft: -4 }} />
      <div style={{ flex: 1, height: 2, background: '#ef4444' }} />
    </div>
  );
}

// ── Desktop List View ──────────────────────────────────────────────

function DesktopListView({
  groups, appointments, timezone, serviceMap, departments, intlLocale, locale,
  operatingHours, holidaysByDate, selectedApptId, onSelect, onSlotBook, onDayClick,
  dateFilter, onClearDateFilter,
}: {
  groups: { dateKey: string; items: CalendarAppointment[] }[];
  appointments: CalendarAppointment[];
  timezone: string;
  serviceMap: Map<string, any>;
  departments: Record<string, string>;
  intlLocale: string;
  locale: DesktopLocale;
  operatingHours: OperatingHours;
  holidaysByDate: Map<string, { id: string; holiday_date: string; name: string; is_full_day: boolean }>;
  selectedApptId: string | null;
  onSelect: (a: CalendarAppointment) => void;
  onSlotBook: (dateKey: string, time: string) => void;
  onDayClick: (date: Date) => void;
  dateFilter: string | null;
  onClearDateFilter: () => void;
}) {
  const t = (k: string, v?: Record<string, any>) => translate(locale, k, v);
  const todayKey = dateKeyInTz(new Date(), timezone);

  // Status counts
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of appointments) {
      counts[a.status] = (counts[a.status] || 0) + 1;
    }
    return counts;
  }, [appointments]);

  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return groups.map(g => {
      const items = g.items.filter(a => {
        if (filterStatus && a.status !== filterStatus) return false;
        if (q) {
          const name = (a.customer_name || '').toLowerCase();
          const phone = (a.customer_phone || '').toLowerCase();
          const notes = (a.notes || '').toLowerCase();
          const svc = serviceMap.get(a.service_id || '')?.name?.toLowerCase() || '';
          const dept = (a.department_id && departments[a.department_id] || '').toLowerCase();
          if (!name.includes(q) && !phone.includes(q) && !notes.includes(q) && !svc.includes(q) && !dept.includes(q)) return false;
        }
        return true;
      });
      return { ...g, items };
    }).filter(g => g.items.length > 0);
  }, [groups, filterStatus, searchQuery, serviceMap, departments]);

  const JS_DAY_NAMES: string[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* ── Toolbar: search + filters ── */}
      <div onClick={(e) => e.stopPropagation()} style={{
        padding: '10px 16px', borderBottom: '1px solid var(--border, #334155)',
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        background: 'var(--bg, #0f172a)',
      }}>
        <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 300 }}>
          <input
            type="text"
            placeholder={t('Search name, phone, service...')}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              width: '100%', padding: '6px 10px 6px 28px', borderRadius: 6,
              border: '1px solid var(--border, #475569)', background: 'var(--surface, #1e293b)',
              color: 'var(--text, #f1f5f9)', fontSize: 12, outline: 'none',
            }}
          />
          <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 12, opacity: 0.5 }}>🔍</span>
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <button
            onClick={() => setFilterStatus(null)}
            style={{
              padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${!filterStatus ? '#3b82f6' : 'var(--border, #475569)'}`,
              background: !filterStatus ? 'rgba(59,130,246,0.15)' : 'transparent',
              color: !filterStatus ? '#3b82f6' : 'var(--text3, #94a3b8)',
            }}
          >
            {t('All')} ({appointments.length})
          </button>
          {Object.entries(statusCounts).sort().map(([status, count]) => {
            const color = getStatusColor(status);
            const active = filterStatus === status;
            return (
              <button
                key={status}
                onClick={() => setFilterStatus(active ? null : status)}
                style={{
                  padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                  border: `1px solid ${active ? color : 'var(--border, #475569)'}`,
                  background: active ? `${color}22` : 'transparent',
                  color: active ? color : 'var(--text3, #94a3b8)',
                  textTransform: 'capitalize',
                }}
              >
                {t(status)} ({count})
              </button>
            );
          })}
          {dateFilter && (
            <button
              onClick={onClearDateFilter}
              style={{
                padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                border: '1px solid #8b5cf660',
                background: 'rgba(139,92,246,0.12)',
                color: '#8b5cf6',
              }}
            >
              {t('Show all month')}
            </button>
          )}
        </div>
      </div>

      {/* ── List body ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px' }}>
        {filteredGroups.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '60px 20px', color: 'var(--text3, #94a3b8)',
          }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>📋</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              {searchQuery || filterStatus ? t('No matching appointments') : t('No appointments this month')}
            </div>
          </div>
        ) : (
          filteredGroups.map(g => {
            const date = new Date(g.dateKey + 'T12:00:00');
            const dayName = getDayNameFromKey(g.dateKey);
            const holiday = holidaysByDate.get(g.dateKey);
            const closed = isDayClosed(operatingHours, dayName);
            const isToday = g.dateKey === todayKey;
            const isPast = g.dateKey < todayKey;
            const dayLabel = date.toLocaleDateString(intlLocale, {
              weekday: 'long', day: 'numeric', month: 'long',
            });

            return (
              <div key={g.dateKey} style={{ marginBottom: 16 }}>
                {/* Day header */}
                <div onClick={(e) => e.stopPropagation()} style={{
                  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
                  padding: '6px 0', borderBottom: '1px solid var(--border, #334155)',
                  position: 'sticky', top: 0, background: 'var(--bg, #0f172a)', zIndex: 2,
                }}>
                  <div
                    onClick={(e) => { e.stopPropagation(); onDayClick(date); }}
                    style={{
                      width: 40, height: 40, borderRadius: 10, display: 'flex',
                      flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      background: isToday ? '#3b82f6' : 'var(--surface, #1e293b)',
                      border: `1px solid ${isToday ? '#3b82f6' : 'var(--border, #475569)'}`,
                      cursor: 'pointer',
                    }}
                    title={t('View in week')}
                  >
                    <span style={{ fontSize: 9, fontWeight: 600, color: isToday ? '#fff' : 'var(--text3, #94a3b8)', textTransform: 'uppercase', lineHeight: 1 }}>
                      {date.toLocaleDateString(intlLocale, { weekday: 'short' }).slice(0, 3)}
                    </span>
                    <span style={{ fontSize: 16, fontWeight: 800, color: isToday ? '#fff' : 'var(--text, #f1f5f9)', lineHeight: 1.1 }}>
                      {date.getDate()}
                    </span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <span style={{
                      fontSize: 13, fontWeight: 700,
                      color: holiday ? '#fca5a5' : closed ? '#fca5a5' : isToday ? '#3b82f6' : 'var(--text, #f1f5f9)',
                    }}>
                      {dayLabel}
                      {isToday && <span style={{ fontSize: 10, fontWeight: 600, marginLeft: 6, color: '#3b82f6', background: 'rgba(59,130,246,0.12)', padding: '1px 6px', borderRadius: 6 }}>{t('Today')}</span>}
                    </span>
                    {holiday && (
                      <div style={{ fontSize: 10, color: '#fca5a5', fontWeight: 600 }}>
                        🎉 {holiday.name}
                      </div>
                    )}
                    {closed && !holiday && (
                      <div style={{ fontSize: 10, color: '#fca5a5', fontWeight: 600 }}>{t('Closed')}</div>
                    )}
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3, #94a3b8)' }}>
                    {g.items.length} {g.items.length === 1 ? t('appointment') : t('appointments')}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      // Book at the next available hour slot for this day
                      const oh = operatingHours?.[dayName];
                      const defaultTime = oh?.open || '09:00';
                      onSlotBook(g.dateKey, defaultTime);
                    }}
                    style={{
                      padding: '3px 8px', borderRadius: 6, border: '1px solid #3b82f660',
                      background: 'rgba(59,130,246,0.1)', color: '#3b82f6',
                      fontSize: 10, fontWeight: 700, cursor: 'pointer',
                    }}
                    title={t('Book Appointment')}
                  >
                    + {t('Book')}
                  </button>
                </div>

                {/* Appointments for this day */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {g.items.map(a => {
                    const color = getStatusColor(a.status);
                    const svc = serviceMap.get(a.service_id || '');
                    const svcName = svc?.name || '';
                    const svcColor = getStatusColor(a.status);
                    const deptName = (a.department_id && departments[a.department_id]) || '';
                    const timeStr = formatTimeInTz(a.scheduled_at, timezone);
                    const isSelected = a.id === selectedApptId;

                    return (
                      <div
                        key={a.id}
                        onClick={(e) => { e.stopPropagation(); onSelect(a); }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '8px 12px',
                          background: isSelected ? 'rgba(59,130,246,0.08)' : 'var(--surface, #1e293b)',
                          border: `1px solid ${isSelected ? '#3b82f6' : 'var(--border, #334155)'}`,
                          borderLeft: `3px solid ${color}`,
                          borderRadius: 8,
                          cursor: 'pointer',
                          opacity: isPast ? 0.65 : 1,
                          transition: 'all 120ms ease',
                        }}
                      >
                        {/* Time + Status column */}
                        <div style={{
                          display: 'flex', flexDirection: 'column', alignItems: 'center',
                          minWidth: 52, gap: 2,
                        }}>
                          <span style={{
                            padding: '1px 6px', borderRadius: 6, fontSize: 7, fontWeight: 800,
                            textTransform: 'uppercase', letterSpacing: 0.3,
                            background: `${color}22`, color, whiteSpace: 'nowrap',
                          }}>
                            {t(a.status)}
                          </span>
                          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text, #f1f5f9)', fontVariantNumeric: 'tabular-nums' }}>
                            {timeStr}
                          </span>
                        </div>

                        {/* Customer & Service info */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            display: 'flex', alignItems: 'baseline', gap: 6,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            <span dir="auto" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text, #f1f5f9)', unicodeBidi: 'isolate' }}>
                              {a.customer_name || t('(no name)')}
                            </span>
                            {a.customer_phone && (
                              <span style={{ fontSize: 11, color: 'var(--text3, #94a3b8)' }}>
                                {a.customer_phone}
                              </span>
                            )}
                          </div>
                          <div style={{
                            display: 'flex', gap: 6, alignItems: 'center', marginTop: 1,
                            fontSize: 11, color: 'var(--text3, #94a3b8)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {svcName && (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                {svcColor && <span style={{ width: 6, height: 6, borderRadius: '50%', background: svcColor, flexShrink: 0 }} />}
                                {svcName}
                              </span>
                            )}
                            {deptName && <span>· {deptName}</span>}
                            {a.wilaya && <span dir="auto" style={{ unicodeBidi: 'isolate' }}>· 📍 {normalizeWilayaDisplay(a.wilaya) || a.wilaya}</span>}
                            {a.source && (() => {
                              const src = a.source as string;
                              const MAP: Record<string, { label: string; bg: string; color: string }> = {
                                whatsapp: { label: 'WhatsApp', bg: 'rgba(37,211,102,0.12)', color: '#25d366' },
                                messenger: { label: 'Messenger', bg: 'rgba(0,132,255,0.12)', color: '#0084ff' },
                                web: { label: 'Web', bg: 'rgba(59,130,246,0.12)', color: '#3b82f6' },
                                portal: { label: 'Portal', bg: 'rgba(59,130,246,0.12)', color: '#3b82f6' },
                                qr_code: { label: 'QR Code', bg: 'rgba(59,130,246,0.12)', color: '#3b82f6' },
                                mobile_app: { label: 'Mobile', bg: 'rgba(59,130,246,0.12)', color: '#3b82f6' },
                                kiosk: { label: 'Kiosk', bg: 'rgba(245,158,11,0.12)', color: '#f59e0b' },
                                in_house: { label: 'In-House', bg: 'rgba(139,92,246,0.12)', color: '#8b5cf6' },
                              };
                              const s = MAP[src] ?? { label: src.replace('_', ' '), bg: 'rgba(59,130,246,0.12)', color: '#3b82f6' };
                              return (
                                <span style={{ fontSize: 9, fontWeight: 600, padding: '0 4px', borderRadius: 4, background: s.bg, color: s.color }}>
                                  {t(s.label)}
                                </span>
                              );
                            })()}
                          </div>
                          {a.notes && (
                            <div style={{ fontSize: 10, color: 'var(--text3, #94a3b8)', marginTop: 2, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {a.notes}
                            </div>
                          )}
                        </div>

                        {/* Arrow indicator */}
                        <span style={{ fontSize: 14, color: 'var(--text3, #475569)', flexShrink: 0 }}>▸</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Desktop Month View ─────────────────────────────────────────────

function DesktopMonthView({
  days, appointmentCounts, appointmentsByDate, timezone, serviceMap, intlLocale, locale, operatingHours, onSelect, selectedApptId, onDayClick,
  holidaysByDate, onDayContext,
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
  selectedApptId: string | null;
  onDayClick: (date: Date) => void;
  holidaysByDate?: Map<string, { id: string; holiday_date: string; name: string; is_full_day: boolean }>;
  onDayContext?: (e: React.MouseEvent, dateKey: string) => void;
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--border, #475569)', background: 'rgba(59,130,246,0.12)' }}>
        {dayNames.map(d => (
          <div key={d} style={{ textAlign: 'center', padding: '6px 0', fontSize: 11, fontWeight: 700, color: 'var(--text, #f1f5f9)' }}>{d}</div>
        ))}
      </div>

      <div style={{ flex: 1, display: 'grid', gridTemplateRows: `repeat(${weeks.length}, 1fr)` }}>
        {weeks.map((week, wi) => (
          <div key={wi} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--border, #334155)' }}>
            {week.map(day => {
              const count = appointmentCounts.get(day.dateKey) ?? 0;
              const dayAppts = (appointmentsByDate.get(day.dateKey) ?? []).slice(0, 3);
              const dayName = getDayNameFromKey(day.dateKey);
              const closed = operatingHours ? isDayClosed(operatingHours, dayName) : false;
              const holiday = holidaysByDate?.get(day.dateKey);
              const isHoliday = !!holiday;
              return (
                <div
                  key={day.dateKey}
                  onClick={() => onDayClick(day.date)}
                  onContextMenu={onDayContext ? (e) => { e.preventDefault(); e.stopPropagation(); onDayContext(e, day.dateKey); } : undefined}
                  style={{
                    borderRight: '1px solid var(--border, #334155)', padding: 4, minHeight: 70,
                    cursor: 'pointer', position: 'relative',
                    opacity: day.isCurrentMonth ? (closed && !isHoliday ? 0.6 : 1) : 0.35,
                    background: isHoliday ? 'rgba(239,68,68,0.1)'
                      : day.isToday ? 'rgba(59,130,246,0.12)'
                      : closed ? 'rgba(239,68,68,0.04)' : 'rgba(59,130,246,0.03)',
                  }}
                >
                  {/* Holiday diagonal stripes overlay */}
                  {isHoliday && (
                    <div style={{
                      position: 'absolute', inset: 0, pointerEvents: 'none',
                      background: 'repeating-linear-gradient(135deg, transparent, transparent 6px, rgba(239,68,68,0.06) 6px, rgba(239,68,68,0.06) 12px)',
                    }} />
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3, position: 'relative', zIndex: 1 }}>
                    <span style={{
                      fontSize: 11, fontWeight: day.isToday || isHoliday ? 700 : 500,
                      width: 22, height: 22, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: day.isToday ? '#3b82f6' : 'transparent',
                      color: isHoliday ? '#fca5a5' : day.isToday ? '#fff' : 'var(--text, #f1f5f9)',
                    }}>
                      {day.date.getDate()}
                    </span>
                    {isHoliday ? (
                      <span style={{ fontSize: 8, fontWeight: 700, color: '#fca5a5', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {holiday.name}
                      </span>
                    ) : count > 0 ? (
                      <span style={{ fontSize: 9, fontWeight: 700, color: '#3b82f6', background: 'rgba(59,130,246,0.15)', borderRadius: 8, padding: '1px 5px' }}>
                        {count}
                      </span>
                    ) : null}
                  </div>
                  {dayAppts.map(a => {
                    const svc = serviceMap.get(a.service_id);
                    const color = getStatusColor(a.status);
                    const isSelected = a.id === selectedApptId;
                    return (
                      <button
                        key={a.id}
                        onClick={e => { e.stopPropagation(); onSelect(a); }}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left', fontSize: 9, padding: '1px 4px',
                          borderRadius: 3, marginBottom: 1, overflow: 'hidden', textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap', background: isSelected ? color : color + 'bb', color: '#fff', cursor: 'pointer',
                          border: isSelected ? '2px solid #22c55e' : 'none', fontWeight: isSelected ? 700 : 500,
                          boxShadow: isSelected ? '0 0 8px rgba(34,197,94,0.5)' : 'none',
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
  officeId, storedAuth, onClose, onAction, onDelete, onNotesChange, onOpenCustomer, onReschedule,
}: {
  appointment: CalendarAppointment;
  timezone: string;
  serviceMap: Map<string, any>;
  departments: Record<string, string>;
  locale: DesktopLocale;
  intlLocale: string;
  actionBusy: boolean;
  officeId: string;
  storedAuth?: { access_token?: string; refresh_token?: string; email?: string; password?: string };
  onClose: () => void;
  onAction: (action: 'approve' | 'decline' | 'cancel' | 'no_show' | 'check_in' | 'call' | 'serve' | 'complete' | 'delete') => void;
  onDelete: () => void;
  onNotesChange: (appointmentId: string, notes: string) => void;
  onOpenCustomer?: (phone: string) => void;
  onReschedule?: (appointmentId: string, newDateKey: string, newTime: string) => Promise<boolean>;
}) {
  const t = (k: string) => translate(locale, k);
  const [notesValue, setNotesValue] = useState(a.notes ?? '');
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editingTime, setEditingTime] = useState(false);
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);

  // ── Ticket history/timeline ──
  type TimelineEvent = { time: string; label: string; icon: string; color: string };
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [ticketNumber, setTicketNumber] = useState<string | null>(null);
  // Track the linked ticket's real-time status from local SQLite
  // so action buttons stay in sync when ticket is called/served from queue sidebar
  const [linkedTicketStatus, setLinkedTicketStatus] = useState<string | null>(null);

  // Sync when switching appointments
  useEffect(() => { setNotesValue(a.notes ?? ''); setNotesSaved(false); setEditingTime(false); setRescheduleError(null); setAvailableSlots([]); setTimeline([]); setTicketNumber(null); setLinkedTicketStatus(null); }, [a.id]);

  // Fetch ticket number + status when appointment has a ticket_id
  // Polls every 3s so buttons update if ticket status changes from queue sidebar
  useEffect(() => {
    if (!a.ticket_id) { setTicketNumber(null); setLinkedTicketStatus(null); return; }
    let cancelled = false;
    const fetchTicketInfo = async () => {
      try {
        const w = window as any;
        if (w.qf?.db?.rawQuery) {
          const rows: any[] = await w.qf.db.rawQuery('SELECT ticket_number, status FROM tickets WHERE id = ?', [a.ticket_id]) ?? [];
          if (!cancelled && rows.length > 0) {
            if (rows[0].ticket_number) setTicketNumber(rows[0].ticket_number);
            if (rows[0].status) setLinkedTicketStatus(rows[0].status);
            return;
          }
        }
        // Fallback: fetch from Supabase (no polling for remote — too expensive)
        if (storedAuth) {
          const { ensureAuth, getSupabase } = await import('../lib/supabase');
          await ensureAuth();
          const sb = await getSupabase();
          const { data } = await sb.from('tickets').select('ticket_number, status').eq('id', a.ticket_id).single();
          if (!cancelled && data) {
            if (data.ticket_number) setTicketNumber(data.ticket_number);
            if (data.status) setLinkedTicketStatus(data.status);
          }
        }
      } catch { /* non-fatal */ }
    };
    fetchTicketInfo();
    // Poll local SQLite every 3s for real-time sync with queue operations
    const iv = setInterval(fetchTicketInfo, 3000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [a.ticket_id, storedAuth]);

  // Derive the effective status from the linked ticket's real-time status.
  // This prevents action button conflicts when a ticket is called/served from the queue sidebar.
  // ticket status → effective appointment status mapping:
  //   waiting → checked_in, called → called, serving → serving,
  //   served → completed, no_show → no_show, cancelled → cancelled
  const effectiveStatus: string = (() => {
    if (!linkedTicketStatus) return a.status;
    const ticketToApptStatus: Record<string, string> = {
      waiting: 'checked_in',
      called: 'called',
      serving: 'serving',
      served: 'completed',
      no_show: 'no_show',
      cancelled: 'cancelled',
    };
    return ticketToApptStatus[linkedTicketStatus] ?? a.status;
  })();

  // Fetch ticket events for timeline
  useEffect(() => {
    let cancelled = false;
    const eventLabels: Record<string, { label: string; icon: string; color: string }> = {
      created: { label: t('Ticket created'), icon: '🎫', color: '#8b5cf6' },
      joined: { label: t('Joined queue'), icon: '🎫', color: '#8b5cf6' },
      checked_in: { label: t('Checked in'), icon: '✅', color: '#22c55e' },
      called: { label: t('Called to desk'), icon: '📢', color: '#f59e0b' },
      recalled: { label: t('Recalled'), icon: '🔄', color: '#f59e0b' },
      serving_started: { label: t('Service started'), icon: '⚡', color: '#06b6d4' },
      serving: { label: t('Service started'), icon: '⚡', color: '#06b6d4' },
      served: { label: t('Served'), icon: '✓', color: '#22c55e' },
      completed: { label: t('Completed'), icon: '✓', color: '#22c55e' },
      waiting: { label: t('Returned to queue'), icon: '↩', color: '#64748b' },
      no_show: { label: t('No show'), icon: '👻', color: '#ef4444' },
      cancelled: { label: t('Cancelled'), icon: '✗', color: '#ef4444' },
      transferred: { label: t('Transferred'), icon: '↗', color: '#8b5cf6' },
      buzzed: { label: t('Buzzed'), icon: '🔔', color: '#f59e0b' },
      returned_to_queue: { label: t('Returned to queue'), icon: '↩', color: '#64748b' },
      requeued: { label: t('Returned to queue'), icon: '↩', color: '#64748b' },
      parked: { label: t('Parked'), icon: '⏸', color: '#64748b' },
      resumed: { label: t('Resumed'), icon: '▶', color: '#3b82f6' },
      auto_cancelled_call_next: { label: t('Auto-cancelled'), icon: '✗', color: '#ef4444' },
      rescheduled: { label: t('Rescheduled'), icon: '📅', color: '#f59e0b' },
    };

    const buildTimeline = async () => {
      setTimelineLoading(true);
      const events: TimelineEvent[] = [];

      // Always add appointment creation event
      events.push({ time: a.created_at, label: t('Appointment created'), icon: '📋', color: '#3b82f6' });

      if (a.ticket_id) {
        // Collect events from all sources, then deduplicate
        const seen = new Set<string>(); // "eventType-epoch" keys for dedup
        const addEvent = (time: string, evType: string, info: { label: string; icon: string; color: string }) => {
          const key = `${evType}-${new Date(time).getTime()}`;
          if (!seen.has(key)) {
            seen.add(key);
            events.push({ time, label: info.label, icon: info.icon, color: info.color });
          }
        };

        // 1) Local SQLite audit log (fastest, works offline)
        try {
          const w = window as any;
          if (w.qf?.ticketTimeline) {
            const { events: localEvents, ticket } = await w.qf.ticketTimeline.get(a.ticket_id);
            if (!cancelled && localEvents && localEvents.length > 0) {
              for (const ev of localEvents) {
                const evType = ev.to_status || ev.event_type;
                const info = eventLabels[evType] ?? { label: evType, icon: '•', color: '#64748b' };
                addEvent(ev.created_at, evType, info);
              }
            }
            // Supplement with ticket timestamps if audit log had nothing
            if (!cancelled && ticket && seen.size === 0) {
              if (ticket.created_at) addEvent(ticket.created_at, 'created', eventLabels.created);
              if (ticket.called_at) addEvent(ticket.called_at, 'called', eventLabels.called);
              if (ticket.serving_started_at) addEvent(ticket.serving_started_at, 'serving_started', eventLabels.serving_started);
              if (ticket.completed_at) {
                const st = ticket.status;
                const termLabel = st === 'no_show' ? t('No show') : st === 'cancelled' ? t('Cancelled') : t('Completed');
                const termIcon = st === 'no_show' ? '👻' : st === 'cancelled' ? '✗' : '✓';
                const termColor = st === 'no_show' || st === 'cancelled' ? '#ef4444' : '#22c55e';
                addEvent(ticket.completed_at, st, { label: termLabel, icon: termIcon, color: termColor });
              }
              if (ticket.cancelled_at && ticket.status === 'cancelled' && !ticket.completed_at) {
                addEvent(ticket.cancelled_at, 'cancelled', eventLabels.cancelled);
              }
            }
          }
        } catch (e) {
          console.warn('[DesktopApptDetail] Failed to fetch local ticket events:', e);
        }

        // 2) Supabase ticket_events (covers events from other Stations / web)
        if (!cancelled && storedAuth) {
          try {
            await ensureAuth();
            const sb = await getSupabase();
            const { data: ticketEvents } = await sb
              .from('ticket_events')
              .select('event_type, from_status, to_status, created_at')
              .eq('ticket_id', a.ticket_id)
              .order('created_at', { ascending: true });

            if (!cancelled && ticketEvents) {
              for (const ev of ticketEvents) {
                const info = eventLabels[ev.event_type] ?? { label: ev.event_type, icon: '•', color: '#64748b' };
                addEvent(ev.created_at!, ev.event_type, info);
              }
            }
          } catch (e) {
            console.warn('[DesktopApptDetail] Failed to fetch cloud ticket events:', e);
          }
        }
      } else {
        // No linked ticket — derive from appointment status
        if (['confirmed'].includes(a.status)) {
          events.push({ time: a.updated_at ?? a.created_at, label: t('Confirmed'), icon: '✅', color: '#22c55e' });
        }
        if (a.status === 'completed') {
          events.push({ time: a.updated_at ?? a.created_at, label: t('Completed'), icon: '✓', color: '#22c55e' });
        }
        if (a.status === 'cancelled') {
          events.push({ time: a.updated_at ?? a.created_at, label: t('Cancelled'), icon: '✗', color: '#ef4444' });
        }
        if (a.status === 'no_show') {
          events.push({ time: a.updated_at ?? a.created_at, label: t('No show'), icon: '👻', color: '#ef4444' });
        }
        if (a.status === 'declined') {
          events.push({ time: a.updated_at ?? a.created_at, label: t('Declined'), icon: '✗', color: '#ef4444' });
        }
      }

      // Detect reschedule: if updated_at is > 30s after created_at and status hasn't changed,
      // it's likely a reschedule. Also catches non-ticket appointments.
      if (a.updated_at && a.created_at) {
        const diff = new Date(a.updated_at).getTime() - new Date(a.created_at).getTime();
        if (diff > 30000) {
          // Check if a rescheduled event already exists from ticket_events
          const hasRescheduleEvent = events.some(e => e.label === t('Rescheduled'));
          if (!hasRescheduleEvent) {
            events.push({ time: a.updated_at, label: t('Rescheduled'), icon: '📅', color: '#f59e0b' });
          }
        }
      }

      // Sort by time and deduplicate
      events.sort((x, y) => new Date(x.time).getTime() - new Date(y.time).getTime());
      if (!cancelled) {
        setTimeline(events);
        setTimelineLoading(false);
      }
    };
    buildTimeline();
    return () => { cancelled = true; };
  }, [a.id, a.ticket_id, a.status, locale]);

  // Fetch available slots when date changes in edit mode
  useEffect(() => {
    if (!editingTime || !editDate || !a.service_id) return;
    let cancelled = false;
    setSlotsLoading(true);
    setAvailableSlots([]);
    (async () => {
      try {
        const url = `https://qflo.net/api/booking-slots?slug=${encodeURIComponent(officeId)}&serviceId=${encodeURIComponent(a.service_id)}&date=${editDate}`;
        const resp = await cloudFetch(url);
        if (!cancelled && resp.ok) {
          const data = await resp.json();
          const slots: string[] = data.slots ?? [];
          // Include the appointment's current slot even if it appears taken (it's this appointment's own slot)
          const currentDate = dateKeyInTz(new Date(a.scheduled_at), timezone);
          const currentTime = formatTimeInTz(a.scheduled_at, timezone);
          if (editDate === currentDate && !slots.includes(currentTime)) {
            slots.push(currentTime);
            slots.sort();
          }
          if (!cancelled) {
            setAvailableSlots(slots);
            // Pre-select current time if available, otherwise first slot
            if (slots.includes(editTime)) { /* keep current selection */ }
            else if (slots.length > 0) setEditTime(slots[0]);
            else setEditTime('');
          }
        }
      } catch (e) {
        console.warn('[DesktopApptDetail] Failed to fetch slots:', e);
      } finally {
        if (!cancelled) setSlotsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [editingTime, editDate, a.service_id, officeId]);

  const handleNotesInput = (val: string) => {
    setNotesValue(val);
    setNotesSaved(false);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setNotesSaving(true);
      onNotesChange(a.id, val);
      // Small delay for visual feedback
      await new Promise(r => setTimeout(r, 300));
      setNotesSaving(false);
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 2000);
    }, 800);
  };
  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); }, []);
  const svc = serviceMap.get(a.service_id);
  const dept = a.department_id ? departments[a.department_id] : null;
  const statusColor = getStatusColor(effectiveStatus);
  const serviceColor = getStatusColor(effectiveStatus);
  const d = new Date(a.scheduled_at);
  const isActive = !['cancelled', 'completed', 'no_show', 'declined'].includes(effectiveStatus);
  const canReschedule = !['cancelled', 'completed', 'no_show', 'declined'].includes(effectiveStatus);

  const statusLabel: Record<string, string> = {
    pending: t('Pending'), pending_approval: t('Pending'), confirmed: t('Confirmed'), checked_in: t('Checked In'),
    called: t('Called'), serving: t('Serving'),
    completed: t('Completed'), cancelled: t('Cancelled'), no_show: t('No Show'), declined: t('Declined'),
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
      width: 360, flexShrink: 0, display: 'flex', flexDirection: 'column',
      background: 'var(--surface, #1e293b)', borderLeft: '1px solid var(--border, #475569)',
      boxShadow: '-8px 0 32px rgba(0,0,0,0.3)', overflow: 'hidden',
    }}>
      {/* Header — fixed, never scrolls */}
      <div style={{
        padding: '14px 16px', borderBottom: '1px solid var(--border, #475569)',
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        background: 'var(--surface, #1e293b)', zIndex: 2,
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

      {/* Body — scrollable */}
      <div style={{ padding: 16, flex: 1, overflowY: 'auto' }}>
        {/* Status badge + ticket number */}
        <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 12, color: '#fff', background: statusColor }}>
            {statusLabel[effectiveStatus] ?? effectiveStatus}
          </span>
          {ticketNumber && (
            <span style={{ fontSize: 16, fontWeight: 800, color: '#8b5cf6', fontFamily: 'monospace', letterSpacing: 0.5 }}>
              🎫 {ticketNumber}
            </span>
          )}
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
          {!editingTime ? (
            <>
              <div style={rowStyle}>
                <span style={{ fontSize: 14 }}>📅</span>
                {d.toLocaleDateString(intlLocale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: timezone })}
              </div>
              <div style={{ ...rowStyle, justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14 }}>🕐</span>
                  {formatTimeInTz(a.scheduled_at, timezone)}
                  {svc && ` · ${formatDuration(svc.estimated_service_time ?? 30)}`}
                </div>
                {canReschedule && onReschedule && (
                  <button
                    onClick={() => {
                      const dk = dateKeyInTz(d, timezone);
                      const tm = formatTimeInTz(a.scheduled_at, timezone);
                      setEditDate(dk);
                      setEditTime(tm);
                      setRescheduleError(null);
                      setEditingTime(true);
                    }}
                    style={{
                      padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(59,130,246,0.3)',
                      background: 'rgba(59,130,246,0.1)', color: '#60a5fa', cursor: 'pointer',
                      fontSize: 10, fontWeight: 600,
                    }}
                    title={t('Reschedule')}
                  >
                    ✎ {t('Edit')}
                  </button>
                )}
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14 }}>📅</span>
                <DatePicker
                  value={editDate}
                  onChange={(e) => { setEditDate(e.target.value); setEditTime(''); setRescheduleError(null); }}
                  style={{
                    flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border, #475569)',
                    background: 'var(--surface2, #334155)', color: 'var(--text, #f1f5f9)',
                    fontSize: 13, fontFamily: 'inherit',
                  }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14 }}>🕐</span>
                {slotsLoading ? (
                  <div style={{ flex: 1, padding: '6px 10px', fontSize: 12, color: '#94a3b8' }}>
                    {t('Loading slots...')}
                  </div>
                ) : availableSlots.length === 0 ? (
                  <div style={{ flex: 1, padding: '6px 10px', fontSize: 12, color: '#f59e0b' }}>
                    {t('No available slots')}
                  </div>
                ) : (
                  <select
                    value={editTime}
                    onChange={(e) => { setEditTime(e.target.value); setRescheduleError(null); }}
                    style={{
                      flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border, #475569)',
                      background: 'var(--surface2, #334155)', color: 'var(--text, #f1f5f9)',
                      fontSize: 13, fontFamily: 'inherit', cursor: 'pointer',
                    }}
                  >
                    {availableSlots.map(slot => {
                      const currentDate = dateKeyInTz(new Date(a.scheduled_at), timezone);
                      const currentTime = formatTimeInTz(a.scheduled_at, timezone);
                      const isCurrent = editDate === currentDate && slot === currentTime;
                      return (
                        <option key={slot} value={slot}>
                          {slot}{isCurrent ? ` (${t('current')})` : ''}
                        </option>
                      );
                    })}
                  </select>
                )}
              </div>
              {rescheduleError && (
                <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 600 }}>{rescheduleError}</div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  disabled={rescheduling || slotsLoading || availableSlots.length === 0 || !editTime}
                  onClick={async () => {
                    if (!editDate || !editTime || !onReschedule) return;
                    setRescheduling(true);
                    setRescheduleError(null);
                    const ok = await onReschedule(a.id, editDate, editTime);
                    setRescheduling(false);
                    if (ok) {
                      setEditingTime(false);
                    } else {
                      setRescheduleError(t('This time slot is not available. Please choose another.'));
                    }
                  }}
                  style={{
                    flex: 1, padding: '7px 12px', borderRadius: 6, border: 'none',
                    background: '#3b82f6', color: '#fff',
                    cursor: (rescheduling || slotsLoading || !editTime) ? 'not-allowed' : 'pointer',
                    fontSize: 12, fontWeight: 600,
                    opacity: (rescheduling || slotsLoading || !editTime) ? 0.5 : 1,
                  }}
                >
                  {rescheduling ? '...' : `✓ ${t('Save')}`}
                </button>
                <button
                  onClick={() => { setEditingTime(false); setRescheduleError(null); }}
                  style={{
                    padding: '7px 12px', borderRadius: 6, border: '1px solid var(--border, #475569)',
                    background: 'transparent', color: 'var(--text2, #94a3b8)', cursor: 'pointer',
                    fontSize: 12, fontWeight: 600,
                  }}
                >
                  {t('Cancel')}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Customer info */}
        <div style={labelStyle}>{t('Customer')}</div>
        <div style={{ ...rowStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg
            className="client-icon"
            width="14" height="14" viewBox="0 0 24 24"
            fill="none" strokeWidth={2.2}
            strokeLinecap="round" strokeLinejoin="round"
            style={{ flexShrink: 0 }}
            aria-hidden="true"
          >
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          {onOpenCustomer && a.customer_phone ? (
            <span
              onClick={() => onOpenCustomer(a.customer_phone!)}
              style={{ cursor: 'pointer', color: '#60a5fa', textDecoration: 'underline', textDecorationStyle: 'dotted' as const, textUnderlineOffset: 2 }}
              title={t('Open client profile')}
            >{a.customer_name}</span>
          ) : a.customer_name}
        </div>
        {a.customer_phone && (
          <div style={rowStyle}>
            📞{' '}
            {onOpenCustomer ? (
              <span
                onClick={() => onOpenCustomer(a.customer_phone!)}
                style={{ cursor: 'pointer', color: '#60a5fa', textDecoration: 'underline', textDecorationStyle: 'dotted' as const, textUnderlineOffset: 2 }}
                title={t('Open client profile')}
              >{a.customer_phone}</span>
            ) : a.customer_phone}
          </div>
        )}
        {a.customer_email && <div style={rowStyle}>✉ {a.customer_email}</div>}
        {(a as any).wilaya && <div style={rowStyle}><span dir="auto" style={{ unicodeBidi: 'isolate' }}>📍 {normalizeWilayaDisplay((a as any).wilaya) || (a as any).wilaya}</span></div>}

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

        {/* Notes — yellow sticky style, always visible & editable */}
        <div style={{ marginTop: 16 }}>
          <div style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12 }}>📝</span>
            {t('Notes')}
            {notesSaving && <span style={{ fontSize: 8, color: '#eab308', fontWeight: 500, textTransform: 'none' }}>{t('saving...')}</span>}
            {notesSaved && <span style={{ fontSize: 8, color: '#22c55e', fontWeight: 500, textTransform: 'none' }}>✓ {t('saved')}</span>}
          </div>
          <div style={{
            background: 'linear-gradient(135deg, #fef9c3, #fef08a)',
            border: '1px solid #fde047',
            borderRadius: 8,
            padding: 0,
            boxShadow: '0 2px 8px rgba(234,179,8,0.15), inset 0 1px 0 rgba(255,255,255,0.5)',
            position: 'relative',
            overflow: 'hidden',
          }}>
            {/* Subtle lined paper effect */}
            <div style={{
              position: 'absolute', inset: 0, pointerEvents: 'none',
              backgroundImage: 'repeating-linear-gradient(transparent, transparent 19px, rgba(234,179,8,0.12) 19px, rgba(234,179,8,0.12) 20px)',
              backgroundPosition: '0 8px',
            }} />
            <textarea
              value={notesValue}
              onChange={e => handleNotesInput(e.target.value)}
              placeholder={t('Add a note...')}
              maxLength={500}
              rows={3}
              style={{
                width: '100%', border: 'none', background: 'transparent',
                color: '#78350f', fontSize: 12, lineHeight: '20px',
                padding: '8px 10px', resize: 'vertical', minHeight: 60,
                fontFamily: 'inherit', outline: 'none',
                position: 'relative', zIndex: 1,
              }}
            />
            {notesValue.length > 0 && (
              <div style={{
                fontSize: 8, color: '#a16207', textAlign: 'right',
                padding: '0 8px 4px', position: 'relative', zIndex: 1,
              }}>
                {notesValue.length}/500
              </div>
            )}
          </div>
        </div>

        {/* Action buttons */}
        {isActive && (
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {effectiveStatus === 'pending' && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => onAction('approve')} disabled={actionBusy} style={actionBtn('#22c55e', '#fff')}>
                  ✓ {t('Approve')}
                </button>
                <button onClick={() => onAction('decline')} disabled={actionBusy} style={actionBtn('#ef4444', '#fff')}>
                  ✗ {t('Decline')}
                </button>
              </div>
            )}
            {effectiveStatus === 'confirmed' && (
              <button onClick={() => onAction('check_in')} disabled={actionBusy} style={actionBtn('#8b5cf6', '#fff')}>
                {t('Check In')}
              </button>
            )}
            {effectiveStatus === 'checked_in' && (
              <button onClick={() => onAction('call')} disabled={actionBusy} style={actionBtn('#3b82f6', '#fff')}>
                📢 {t('Call to Desk')}
              </button>
            )}
            {effectiveStatus === 'called' && (
              <button onClick={() => onAction('serve')} disabled={actionBusy} style={actionBtn('#06b6d4', '#fff')}>
                ▶ {t('Start Serving')}
              </button>
            )}
            {(effectiveStatus === 'checked_in' || effectiveStatus === 'called' || effectiveStatus === 'serving') && (
              <button onClick={() => onAction('complete')} disabled={actionBusy} style={actionBtn('#22c55e', '#fff')}>
                ✓ {t('Complete')}
              </button>
            )}
            {effectiveStatus !== 'pending' && (
              <button onClick={() => onAction('cancel')} disabled={actionBusy} style={actionBtn('rgba(239,68,68,0.15)', '#ef4444')}>
                {t('Cancel Appointment')}
              </button>
            )}
          </div>
        )}

        {/* ── Delete button (always visible) ── */}
        <div style={{ marginTop: isActive ? 8 : 16, paddingTop: 12, borderTop: '1px solid var(--border, #334155)' }}>
          <button
            onClick={onDelete}
            disabled={actionBusy}
            style={{
              width: '100%', padding: '8px 12px', borderRadius: 8,
              border: '1px dashed rgba(239,68,68,0.3)',
              background: 'transparent',
              color: '#ef4444', cursor: actionBusy ? 'not-allowed' : 'pointer',
              fontSize: 12, fontWeight: 600, opacity: actionBusy ? 0.5 : 0.7,
              transition: 'all 0.15s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
            onMouseEnter={(e) => { if (!actionBusy) { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = 'rgba(239,68,68,0.08)'; } }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.7'; e.currentTarget.style.background = 'transparent'; }}
          >
            🗑 {t('Delete Appointment')}
          </button>
        </div>

        {/* ── Activity Timeline ── */}
        <div style={{ marginTop: 20 }}>
          <div style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <span style={{ fontSize: 12 }}>📜</span>
            {t('Activity Log')}
          </div>
          {timelineLoading ? (
            <div style={{ fontSize: 11, color: '#64748b', padding: '8px 0' }}>{t('Loading...')}</div>
          ) : timeline.length === 0 ? (
            <div style={{ fontSize: 11, color: '#64748b', padding: '8px 0' }}>{t('No activity')}</div>
          ) : (
            <div style={{ position: 'relative', paddingLeft: 18 }}>
              {/* Vertical line */}
              <div style={{
                position: 'absolute', left: 5, top: 4, bottom: 4, width: 2,
                background: 'linear-gradient(to bottom, rgba(100,116,139,0.4), rgba(100,116,139,0.1))',
                borderRadius: 1,
              }} />
              {timeline.map((ev, i) => (
                <div key={i} style={{ position: 'relative', marginBottom: i < timeline.length - 1 ? 12 : 0, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  {/* Dot */}
                  <div style={{
                    position: 'absolute', left: -15, top: 2,
                    width: 10, height: 10, borderRadius: 5,
                    background: ev.color, border: '2px solid var(--surface, #1e293b)',
                    boxShadow: `0 0 0 1px ${ev.color}40`,
                    flexShrink: 0,
                  }} />
                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--text, #f1f5f9)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ fontSize: 11 }}>{ev.icon}</span>
                      {ev.label}
                    </div>
                    <div style={{ fontSize: 10, color: '#64748b', marginTop: 1 }}>
                      {new Date(ev.time).toLocaleString(intlLocale, { dateStyle: 'short', timeStyle: 'medium', timeZone: timezone })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Meta */}
        <div style={{ marginTop: 16, fontSize: 10, color: '#475569', borderTop: '1px solid var(--border, #334155)', paddingTop: 10 }}>
          <div>ID: {a.id.slice(0, 8)}{a.ticket_id ? ` · ${t('Ticket')}: ${a.ticket_id.slice(0, 8)}` : ''}</div>
        </div>
      </div>
    </div>
  );
}
