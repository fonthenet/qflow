'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  Filter,
  List,
  LayoutGrid,
  X,
  User,
  Phone,
  Mail,
  MapPin,
  FileText,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Pencil,
  Trash2,
  CalendarClock,
} from 'lucide-react';
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
  groupByHour,
  countByDate,
  getStatusColor,
  getServiceColor,
  isWithinHorizon,
  STATUS_LABELS,
  type CalendarDayInfo,
  type MonthDayInfo,
  type CalendarAppointment,
} from '@qflo/shared';
import { getAppointmentsForRange, cancelAppointment, rescheduleAppointment } from '@/lib/actions/appointment-actions';
import { normalizeWilayaDisplay } from '@/lib/wilayas';
import { useI18n } from '@/components/providers/locale-provider';

const LOCALE_MAP: Record<string, string> = { fr: 'fr-FR', ar: 'ar-SA', en: 'en-US', es: 'es-ES' };

// ── Types ──────────────────────────────────────────────────────────

interface Office {
  id: string;
  name: string;
  is_active: boolean;
  timezone: string | null;
  operating_hours: Record<string, { open: string; close: string }> | null;
  settings: Record<string, unknown> | null;
}

interface Department {
  id: string;
  name: string;
  code: string;
  office_id: string;
}

interface Service {
  id: string;
  name: string;
  code: string;
  department_id: string;
  color: string | null;
  estimated_service_time: number;
}

interface StaffMember {
  id: string;
  full_name: string;
  role: string;
}

interface Props {
  offices: Office[];
  departments: Department[];
  services: Service[];
  staffMembers: StaffMember[];
}

type ViewMode = 'week' | 'month';

// ── Component ──────────────────────────────────────────────────────

export function CalendarView({ offices, departments, services, staffMembers }: Props) {
  const { locale } = useI18n();
  const intlLocale = LOCALE_MAP[locale] ?? 'en-US';
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedOfficeId, setSelectedOfficeId] = useState(offices[0]?.id ?? '');
  const [filterDeptId, setFilterDeptId] = useState('');
  const [filterServiceId, setFilterServiceId] = useState('');
  const [filterStaffId, setFilterStaffId] = useState('');
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([]);
  const [selectedAppt, setSelectedAppt] = useState<CalendarAppointment | null>(null);
  const [isPending, startTransition] = useTransition();
  const [showFilters, setShowFilters] = useState(false);

  const office = offices.find((o) => o.id === selectedOfficeId);
  const tz = office?.timezone ?? 'UTC';

  // Filtered departments/services for current office
  const officeDepts = useMemo(
    () => departments.filter((d) => d.office_id === selectedOfficeId),
    [departments, selectedOfficeId]
  );
  const officeServices = useMemo(() => {
    const deptIds = new Set(officeDepts.map((d) => d.id));
    return services.filter((s) => deptIds.has(s.department_id));
  }, [services, officeDepts]);

  // Service/department maps
  const serviceMap = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);
  const deptMap = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments]);
  const staffMap = useMemo(() => new Map(staffMembers.map((s) => [s.id, s])), [staffMembers]);

  // ── Fetch appointments ─────────────────────────────────────────

  const fetchAppointments = useCallback(() => {
    if (!selectedOfficeId) return;
    startTransition(async () => {
      let range: { start: string; end: string };
      if (viewMode === 'week') {
        range = getWeekRange(currentDate, tz);
      } else {
        range = getMonthRange(currentDate.getFullYear(), currentDate.getMonth(), tz);
      }
      const result = await getAppointmentsForRange(selectedOfficeId, range.start, range.end, {
        departmentId: filterDeptId || undefined,
        serviceId: filterServiceId || undefined,
        staffId: filterStaffId || undefined,
        excludeCancelled: true,
      });
      if (result.data) {
        // Supabase returns joined relations as arrays; normalize to single objects
        const normalized = (result.data as any[]).map((row) => ({
          ...row,
          service: Array.isArray(row.service) ? row.service[0] ?? null : row.service ?? null,
          department: Array.isArray(row.department) ? row.department[0] ?? null : row.department ?? null,
          staff: Array.isArray(row.staff) ? row.staff[0] ?? null : row.staff ?? null,
        })) as CalendarAppointment[];
        setAppointments(normalized);
      }
    });
  }, [selectedOfficeId, viewMode, currentDate, tz, filterDeptId, filterServiceId, filterStaffId]);

  useEffect(() => {
    fetchAppointments();
  }, [fetchAppointments]);

  // ── Navigation ─────────────────────────────────────────────────

  const goToday = () => setCurrentDate(new Date());
  const goPrev = useCallback(() => setCurrentDate((d) => (viewMode === 'week' ? shiftWeek(d, -1) : shiftMonth(d, -1))), [viewMode]);
  const goNext = useCallback(() => {
    setCurrentDate((d) => {
      const next = viewMode === 'week' ? shiftWeek(d, 1) : shiftMonth(d, 1);
      return isWithinHorizon(next, 3) ? next : d;
    });
  }, [viewMode]);
  const goToDate = (date: Date) => setCurrentDate(date);

  // Keyboard arrow navigation (← → to move weeks/months)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't capture when typing in inputs/selects
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [goPrev, goNext]);

  // ── Render ─────────────────────────────────────────────────────

  const weekDays = viewMode === 'week' ? getWeekDays(currentDate, tz) : [];
  const monthDays = viewMode === 'month' ? getMonthGrid(currentDate.getFullYear(), currentDate.getMonth(), tz) : [];
  const apptsByDate = useMemo(() => groupByDate(appointments, tz), [appointments, tz]);
  const apptCounts = useMemo(() => countByDate(appointments, tz), [appointments, tz]);

  // Header date label
  const headerLabel =
    viewMode === 'week' && weekDays.length
      ? formatWeekRange(weekDays[0].date, weekDays[6].date, intlLocale)
      : formatMonthYear(currentDate, intlLocale);

  return (
    <div className="flex flex-col h-full">
      {/* ── Toolbar ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex-wrap">
        {/* Office selector */}
        <select
          value={selectedOfficeId}
          onChange={(e) => setSelectedOfficeId(e.target.value)}
          className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
        >
          {offices.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>

        {/* Navigation */}
        <div className="flex items-center gap-1">
          <button
            onClick={goToday}
            className="text-xs font-medium px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200"
          >
            Today
          </button>
          <button onClick={goPrev} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300">
            <ChevronLeft size={18} />
          </button>
          <button onClick={goNext} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300">
            <ChevronRight size={18} />
          </button>
        </div>

        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 min-w-[180px]">{headerLabel}</h2>

        <div className="flex-1" />

        {/* Filters toggle */}
        <button
          onClick={() => setShowFilters((v) => !v)}
          className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border ${
            showFilters || filterDeptId || filterServiceId || filterStaffId
              ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
              : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
          }`}
        >
          <Filter size={14} />
          Filters
          {(filterDeptId || filterServiceId || filterStaffId) && (
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
          )}
        </button>

        {/* View mode */}
        <div className="flex border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
          <button
            onClick={() => setViewMode('week')}
            className={`flex items-center gap-1 text-xs px-3 py-1.5 ${
              viewMode === 'week'
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
          >
            <List size={14} />
            Week
          </button>
          <button
            onClick={() => setViewMode('month')}
            className={`flex items-center gap-1 text-xs px-3 py-1.5 ${
              viewMode === 'month'
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
          >
            <LayoutGrid size={14} />
            Month
          </button>
        </div>

        {isPending && (
          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        )}
      </div>

      {/* ── Filters bar ─────────────────────────────────────────── */}
      {showFilters && (
        <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex-wrap">
          <select
            value={filterDeptId}
            onChange={(e) => { setFilterDeptId(e.target.value); setFilterServiceId(''); }}
            className="text-xs border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
          >
            <option value="">All departments</option>
            {officeDepts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <select
            value={filterServiceId}
            onChange={(e) => setFilterServiceId(e.target.value)}
            className="text-xs border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
          >
            <option value="">All services</option>
            {officeServices
              .filter((s) => !filterDeptId || s.department_id === filterDeptId)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
          <select
            value={filterStaffId}
            onChange={(e) => setFilterStaffId(e.target.value)}
            className="text-xs border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
          >
            <option value="">All staff</option>
            {staffMembers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
              </option>
            ))}
          </select>
          {(filterDeptId || filterServiceId || filterStaffId) && (
            <button
              onClick={() => { setFilterDeptId(''); setFilterServiceId(''); setFilterStaffId(''); }}
              className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1"
            >
              <X size={12} /> Clear
            </button>
          )}
        </div>
      )}

      {/* ── Calendar body ───────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        {viewMode === 'week' ? (
          <WeekView
            days={weekDays}
            appointments={appointments}
            timezone={tz}
            serviceMap={serviceMap}
            operatingHours={office?.operating_hours ?? null}
            intlLocale={intlLocale}
            onSelectAppt={setSelectedAppt}
          />
        ) : (
          <MonthView
            days={monthDays}
            appointmentCounts={apptCounts}
            appointmentsByDate={apptsByDate}
            timezone={tz}
            serviceMap={serviceMap}
            intlLocale={intlLocale}
            onSelectAppt={setSelectedAppt}
            onDayClick={(date) => {
              setCurrentDate(date);
              setViewMode('week');
            }}
          />
        )}
      </div>

      {/* ── Detail panel ────────────────────────────────────────── */}
      {selectedAppt && (
        <AppointmentDetail
          appointment={selectedAppt}
          timezone={tz}
          serviceMap={serviceMap}
          deptMap={deptMap}
          staffMap={staffMap}
          onClose={() => setSelectedAppt(null)}
          onAction={() => {
            setSelectedAppt(null);
            fetchAppointments();
          }}
        />
      )}
    </div>
  );
}

// ── Week View ──────────────────────────────────────────────────────

const SLOT_HEIGHT = 30; // px per 30-min slot
const HOUR_HEIGHT = SLOT_HEIGHT * 2; // 60px per hour
const START_HOUR = 6;
const END_HOUR = 22;

function WeekView({
  days,
  appointments,
  timezone,
  serviceMap,
  operatingHours,
  intlLocale,
  onSelectAppt,
}: {
  days: CalendarDayInfo[];
  appointments: CalendarAppointment[];
  timezone: string;
  serviceMap: Map<string, Service>;
  operatingHours: Record<string, { open: string; close: string }> | null;
  intlLocale: string;
  onSelectAppt: (a: CalendarAppointment) => void;
}) {
  // Group by dateKey
  const byDate = useMemo(() => groupByDate(appointments, timezone), [appointments, timezone]);
  // Build 30-min slots: 06:00, 06:30, 07:00, ...
  const slots: { hour: number; minute: number; label: string }[] = [];
  for (let h = START_HOUR; h < END_HOUR; h++) {
    slots.push({ hour: h, minute: 0, label: `${String(h).padStart(2, '0')}:00` });
    slots.push({ hour: h, minute: 30, label: `${String(h).padStart(2, '0')}:30` });
  }

  return (
    <div className="flex min-h-full">
      {/* Time gutter */}
      <div className="flex-shrink-0 w-16 border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
        {/* Day header spacer */}
        <div className="h-12 border-b border-gray-200 dark:border-gray-700" />
        {slots.map((s) => (
          <div
            key={s.label}
            className={`flex items-start justify-end pr-2 text-[10px] ${
              s.minute === 0
                ? 'text-gray-500 dark:text-gray-400 font-semibold'
                : 'text-gray-300 dark:text-gray-600 font-normal'
            }`}
            style={{ height: SLOT_HEIGHT }}
          >
            <span className="-mt-1.5">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Day columns */}
      <div className="flex-1 grid" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
        {days.map((day) => {
          const dayAppts = byDate.get(day.dateKey) ?? [];
          const dayHours = operatingHours?.[day.dayName];
          const isClosed = dayHours && dayHours.open === '00:00' && dayHours.close === '00:00';

          return (
            <div
              key={day.dateKey}
              className={`border-r border-gray-200 dark:border-gray-700 last:border-r-0 ${
                day.isToday ? 'bg-blue-50/40 dark:bg-blue-900/10' : ''
              }`}
            >
              {/* Day header */}
              <div
                className={`h-12 flex flex-col items-center justify-center border-b border-gray-200 dark:border-gray-700 text-xs ${
                  day.isToday
                    ? 'bg-blue-600 text-white font-bold'
                    : 'text-gray-600 dark:text-gray-300 font-medium'
                }`}
              >
                <span>{formatDayHeader(day.date, timezone, intlLocale)}</span>
                {isClosed && <span className="text-[9px] text-red-400 font-normal">Closed</span>}
              </div>

              {/* Half-hour slots + positioned appointments */}
              <div className="relative">
                {slots.map((s) => (
                  <div
                    key={s.label}
                    className={s.minute === 0
                      ? 'border-b border-gray-200 dark:border-gray-700'
                      : 'border-b border-gray-100 dark:border-gray-800'
                    }
                    style={{ height: SLOT_HEIGHT }}
                  />
                ))}

                {/* Appointment blocks positioned absolutely */}
                {dayAppts.map((appt) => {
                  const hour = getHourInTz(appt.scheduled_at, timezone);
                  const minute = getMinuteInTz(appt.scheduled_at, timezone);
                  const svc = serviceMap.get(appt.service_id);
                  const duration = svc?.estimated_service_time ?? 30;
                  const top = (hour - START_HOUR) * HOUR_HEIGHT + (minute / 60) * HOUR_HEIGHT;
                  const height = Math.max((duration / 60) * HOUR_HEIGHT, 22);
                  const color = getServiceColor(svc as any);

                  if (hour < START_HOUR || hour >= END_HOUR) return null;

                  return (
                    <button
                      key={appt.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectAppt(appt);
                      }}
                      className="absolute left-0.5 right-0.5 rounded-md px-1.5 py-0.5 text-left overflow-hidden cursor-pointer hover:brightness-110 transition-all shadow-sm border border-white/20"
                      style={{
                        top,
                        height: Math.min(height, (END_HOUR - hour) * HOUR_HEIGHT - (minute / 60) * HOUR_HEIGHT),
                        backgroundColor: color + 'dd',
                        color: '#fff',
                        fontSize: height < 30 ? 9 : 11,
                        lineHeight: height < 30 ? '11px' : '14px',
                        zIndex: 10,
                      }}
                      title={`${appt.customer_name} - ${svc?.name ?? ''} (${formatTimeInTz(appt.scheduled_at, timezone)})`}
                    >
                      <div className="font-semibold truncate">{appt.customer_name}</div>
                      {height >= 36 && (
                        <div className="truncate opacity-80">
                          {formatTimeInTz(appt.scheduled_at, timezone)} · {svc?.name ?? ''}
                        </div>
                      )}
                      {height >= 52 && (
                        <div className="truncate opacity-60 text-[9px]">
                          {formatDuration(duration)} · {STATUS_LABELS[appt.status] ?? appt.status}
                        </div>
                      )}
                    </button>
                  );
                })}

                {/* Current time indicator */}
                {day.isToday && <CurrentTimeIndicator timezone={timezone} />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CurrentTimeIndicator({ timezone }: { timezone: string }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const hour = getHourInTz(now, timezone);
  const minute = getMinuteInTz(now, timezone);
  if (hour < START_HOUR || hour >= END_HOUR) return null;

  const top = (hour - START_HOUR) * HOUR_HEIGHT + (minute / 60) * HOUR_HEIGHT;

  return (
    <div className="absolute left-0 right-0 z-20 pointer-events-none" style={{ top }}>
      <div className="flex items-center">
        <div className="w-2 h-2 rounded-full bg-red-500 -ml-1" />
        <div className="flex-1 h-[2px] bg-red-500" />
      </div>
    </div>
  );
}

// ── Month View ─────────────────────────────────────────────────────

function MonthView({
  days,
  appointmentCounts,
  appointmentsByDate,
  timezone,
  serviceMap,
  intlLocale,
  onSelectAppt,
  onDayClick,
}: {
  days: MonthDayInfo[];
  appointmentCounts: Map<string, number>;
  appointmentsByDate: Map<string, CalendarAppointment[]>;
  timezone: string;
  serviceMap: Map<string, Service>;
  intlLocale: string;
  onSelectAppt: (a: CalendarAppointment) => void;
  onDayClick: (date: Date) => void;
}) {
  // Localized short day names (Mon→Lun, Tue→Mar, etc.)
  const dayNames = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(2026, 0, 5 + i); // Jan 5 2026 = Monday
    return new Intl.DateTimeFormat(intlLocale, { weekday: 'short' }).format(d);
  });
  const weeks: MonthDayInfo[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  return (
    <div className="flex flex-col h-full">
      {/* Day name headers */}
      <div className="grid grid-cols-7 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
        {dayNames.map((d) => (
          <div key={d} className="text-center text-xs font-medium text-gray-500 dark:text-gray-400 py-2">
            {d}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="flex-1 grid grid-rows-6">
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 border-b border-gray-200 dark:border-gray-700 last:border-b-0">
            {week.map((day) => {
              const count = appointmentCounts.get(day.dateKey) ?? 0;
              const dayAppts = (appointmentsByDate.get(day.dateKey) ?? []).slice(0, 3);

              return (
                <div
                  key={day.dateKey}
                  className={`border-r border-gray-200 dark:border-gray-700 last:border-r-0 p-1 min-h-[80px] cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors ${
                    !day.isCurrentMonth ? 'opacity-40' : ''
                  } ${day.isToday ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''}`}
                  onClick={() => onDayClick(day.date)}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className={`text-xs w-6 h-6 flex items-center justify-center rounded-full ${
                        day.isToday
                          ? 'bg-blue-600 text-white font-bold'
                          : 'text-gray-700 dark:text-gray-300 font-medium'
                      }`}
                    >
                      {day.date.getDate()}
                    </span>
                    {count > 0 && (
                      <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/40 rounded-full px-1.5 py-0.5">
                        {count}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-col gap-0.5">
                    {dayAppts.map((a) => {
                      const svc = serviceMap.get(a.service_id);
                      const color = getServiceColor(svc as any);
                      return (
                        <button
                          key={a.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectAppt(a);
                          }}
                          className="w-full text-left text-[10px] truncate rounded px-1 py-0.5 text-white font-medium hover:brightness-110"
                          style={{ backgroundColor: color + 'cc' }}
                          title={`${formatTimeInTz(a.scheduled_at, timezone)} ${a.customer_name}`}
                        >
                          {formatTimeInTz(a.scheduled_at, timezone)} {a.customer_name}
                        </button>
                      );
                    })}
                    {count > 3 && (
                      <span className="text-[9px] text-gray-400 dark:text-gray-500 pl-1">
                        +{count - 3} more
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Appointment Detail Panel ───────────────────────────────────────

function AppointmentDetail({
  appointment: a,
  timezone,
  serviceMap,
  deptMap,
  staffMap,
  onClose,
  onAction,
}: {
  appointment: CalendarAppointment;
  timezone: string;
  serviceMap: Map<string, Service>;
  deptMap: Map<string, Department>;
  staffMap: Map<string, StaffMember>;
  onClose: () => void;
  onAction: () => void;
}) {
  const [cancelling, setCancelling] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const svc = a.service ? a.service : serviceMap.get(a.service_id);
  const dept = a.department ? a.department : deptMap.get(a.department_id);
  const staff = a.staff_id ? (a.staff ? a.staff : staffMap.get(a.staff_id)) : null;
  const color = getServiceColor(svc as any);
  const statusColor = getStatusColor(a.status);
  const scheduledDate = new Date(a.scheduled_at);

  // Close panel when clicking outside it (without blocking calendar clicks)
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    // Use capture:false so appointment button clicks fire first
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const handleCancel = async () => {
    if (!confirm('Cancel this appointment?')) return;
    setCancelling(true);
    await cancelAppointment(a.id);
    setCancelling(false);
    onAction();
  };

  return (
    <div
      ref={panelRef}
      className="fixed top-0 right-0 z-50 w-[420px] max-w-full h-full bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 shadow-2xl overflow-y-auto animate-in slide-in-from-right-5"
    >
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3 z-10">
          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
              {a.customer_name}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {(svc as any)?.name ?? 'Service'} · {(dept as any)?.name ?? 'Department'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          {/* Status badge */}
          <div className="flex items-center gap-2">
            <span
              className="text-xs font-semibold px-2.5 py-1 rounded-full text-white"
              style={{ backgroundColor: statusColor }}
            >
              {STATUS_LABELS[a.status] ?? a.status}
            </span>
            {a.recurrence_rule && (
              <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                <CalendarClock size={12} /> Recurring ({a.recurrence_rule})
              </span>
            )}
          </div>

          {/* Date & time */}
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <CalendarIcon size={14} className="text-gray-400" />
              <span>
                {scheduledDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: timezone })}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <Clock size={14} className="text-gray-400" />
              <span>
                {formatTimeInTz(a.scheduled_at, timezone)}
                {svc && ' · ' + formatDuration((svc as any).estimated_service_time)}
              </span>
            </div>
          </div>

          {/* Customer info */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Customer
            </h4>
            <div className="space-y-1.5">
              <InfoRow icon={<User size={13} />} value={a.customer_name} />
              {a.customer_phone && <InfoRow icon={<Phone size={13} />} value={a.customer_phone} />}
              {a.customer_email && <InfoRow icon={<Mail size={13} />} value={a.customer_email} />}
              {(a as any).wilaya && <InfoRow icon={<MapPin size={13} />} value={normalizeWilayaDisplay((a as any).wilaya) || (a as any).wilaya} />}
            </div>
          </div>

          {/* Staff */}
          {staff && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Assigned Staff
              </h4>
              <InfoRow icon={<User size={13} />} value={(staff as any).full_name} />
            </div>
          )}

          {/* Notes */}
          {a.notes && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Notes
              </h4>
              <p className="text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                {a.notes}
              </p>
            </div>
          )}

          {/* Actions */}
          {a.status !== 'cancelled' && a.status !== 'completed' && a.status !== 'no_show' && a.status !== 'declined' && (
            <div className="pt-2 border-t border-gray-200 dark:border-gray-700 space-y-2">
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-sm font-medium bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors disabled:opacity-50"
              >
                <Trash2 size={14} />
                {cancelling ? 'Cancelling...' : 'Cancel Appointment'}
              </button>
            </div>
          )}

          {/* Meta */}
          <div className="text-[10px] text-gray-400 dark:text-gray-500 pt-2 space-y-0.5">
            <div>Created: {new Date(a.created_at).toLocaleString()}</div>
            <div>ID: {a.id.slice(0, 8)}</div>
          </div>
        </div>
      </div>
  );
}

function InfoRow({ icon, value }: { icon: React.ReactNode; value: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
      <span className="text-gray-400">{icon}</span>
      <span>{value}</span>
    </div>
  );
}
