import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useOrg } from '@/lib/use-org';
import { useNameLookup } from '@/lib/use-realtime-queue';
import { supabase } from '@/lib/supabase';
import * as Actions from '@/lib/ticket-actions';
import { colors, borderRadius, fontSize, spacing } from '@/lib/theme';

// ── Types ────────────────────────────────────────────────────────────

interface Appointment {
  id: string;
  office_id: string;
  department_id: string;
  service_id: string;
  ticket_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  scheduled_at: string;
  created_at: string;
  status: string;
}

type StatusFilter = 'all' | 'pending' | 'confirmed' | 'checked_in' | 'completed' | 'cancelled' | 'no_show';

const STATUS_FILTERS: { key: StatusFilter; labelKey: string; icon: string }[] = [
  { key: 'all', labelKey: 'common.all', icon: 'apps-outline' },
  { key: 'pending', labelKey: 'bookings.pending', icon: 'hourglass-outline' },
  { key: 'confirmed', labelKey: 'bookings.confirmed', icon: 'checkmark-outline' },
  { key: 'checked_in', labelKey: 'bookings.checkedIn', icon: 'log-in-outline' },
  { key: 'completed', labelKey: 'bookings.completed', icon: 'checkmark-done-outline' },
  { key: 'no_show', labelKey: 'bookings.noShow', icon: 'alert-circle-outline' },
  { key: 'cancelled', labelKey: 'bookings.cancelled', icon: 'close-circle-outline' },
];

// ── Helpers ──────────────────────────────────────────────────────────

function getStatusColor(status: string): string {
  switch (status) {
    case 'pending': return colors.warning;
    case 'confirmed': return colors.primary;
    case 'checked_in': return colors.success;
    case 'completed': return '#6366f1';
    case 'serving': return colors.serving;
    case 'no_show': return '#f97316';
    case 'cancelled': return colors.error;
    case 'served': return colors.textMuted;
    default: return colors.textMuted;
  }
}

function getStatusIcon(status: string): string {
  switch (status) {
    case 'pending': return 'hourglass-outline';
    case 'confirmed': return 'checkmark-outline';
    case 'checked_in': return 'log-in-outline';
    case 'completed': return 'checkmark-done-outline';
    case 'serving': return 'hand-left-outline';
    case 'no_show': return 'alert-circle-outline';
    case 'cancelled': return 'close-circle-outline';
    default: return 'ellipse-outline';
  }
}

function formatTime12(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// ── Calendar Helpers ─────────────────────────────────────────────────

function getMonthDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startDow = firstDay.getDay(); // 0=Sun

  const days: (number | null)[] = [];
  // Leading blanks
  for (let i = 0; i < startDow; i++) days.push(null);
  for (let d = 1; d <= daysInMonth; d++) days.push(d);
  // Trailing blanks to fill last row
  while (days.length % 7 !== 0) days.push(null);
  return days;
}

function toDateStr(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function formatMonthYear(y: number, m: number): string {
  return new Date(y, m).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── Calendar Component ──────────────────────────────────────────────

function MonthCalendar({
  selectedDate,
  onSelect,
  appointmentDots,
}: {
  selectedDate: string; // YYYY-MM-DD
  onSelect: (date: string) => void;
  appointmentDots: Record<string, { total: number; pending: number; confirmed: number }>;
}) {
  const [viewYear, setViewYear] = useState(() => parseInt(selectedDate.slice(0, 4)));
  const [viewMonth, setViewMonth] = useState(() => parseInt(selectedDate.slice(5, 7)) - 1);

  const days = useMemo(() => getMonthDays(viewYear, viewMonth), [viewYear, viewMonth]);
  const todayStr = new Date().toISOString().split('T')[0];

  const navigateMonth = (delta: number) => {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    setViewMonth(m);
    setViewYear(y);
  };

  // Jump to selected date's month when it changes externally
  useEffect(() => {
    const y = parseInt(selectedDate.slice(0, 4));
    const m = parseInt(selectedDate.slice(5, 7)) - 1;
    if (y !== viewYear || m !== viewMonth) {
      setViewYear(y);
      setViewMonth(m);
    }
  }, [selectedDate]);

  return (
    <View style={cal.container}>
      {/* Month header */}
      <View style={cal.header}>
        <TouchableOpacity onPress={() => navigateMonth(-1)} style={cal.navBtn}>
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => {
            const today = new Date();
            setViewYear(today.getFullYear());
            setViewMonth(today.getMonth());
            onSelect(todayStr);
          }}
          activeOpacity={0.7}
        >
          <Text style={cal.monthLabel}>{formatMonthYear(viewYear, viewMonth)}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigateMonth(1)} style={cal.navBtn}>
          <Ionicons name="chevron-forward" size={20} color={colors.text} />
        </TouchableOpacity>
      </View>

      {/* Day of week headers */}
      <View style={cal.dowRow}>
        {DOW_LABELS.map((d) => (
          <Text key={d} style={cal.dowText}>{d}</Text>
        ))}
      </View>

      {/* Day grid */}
      <View style={cal.grid}>
        {days.map((day, i) => {
          if (day === null) {
            return <View key={`blank-${i}`} style={cal.dayCell} />;
          }
          const dateStr = toDateStr(viewYear, viewMonth, day);
          const isSelected = dateStr === selectedDate;
          const isToday = dateStr === todayStr;
          const dots = appointmentDots[dateStr];

          return (
            <TouchableOpacity
              key={dateStr}
              style={[
                cal.dayCell,
                isToday && cal.dayCellToday,
                isSelected && cal.dayCellSelected,
              ]}
              onPress={() => onSelect(dateStr)}
              activeOpacity={0.6}
            >
              <Text
                style={[
                  cal.dayText,
                  isToday && cal.dayTextToday,
                  isSelected && cal.dayTextSelected,
                ]}
              >
                {day}
              </Text>
              {/* Appointment dots */}
              {dots && dots.total > 0 && (
                <View style={cal.dotsRow}>
                  {dots.pending > 0 && <View style={[cal.dot, { backgroundColor: colors.warning }]} />}
                  {dots.confirmed > 0 && <View style={[cal.dot, { backgroundColor: colors.primary }]} />}
                  {(dots.total - dots.pending - dots.confirmed) > 0 && <View style={[cal.dot, { backgroundColor: colors.success }]} />}
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const cal = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  navBtn: {
    padding: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceSecondary,
  },
  monthLabel: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.text,
  },
  dowRow: {
    flexDirection: 'row',
    marginBottom: spacing.xs,
  },
  dowText: {
    flex: 1,
    textAlign: 'center',
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.md,
  },
  dayCellToday: {
    borderWidth: 1.5,
    borderColor: colors.primary + '40',
  },
  dayCellSelected: {
    backgroundColor: colors.primary,
  },
  dayText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.text,
  },
  dayTextToday: {
    fontWeight: '800',
    color: colors.primary,
  },
  dayTextSelected: {
    color: '#fff',
    fontWeight: '800',
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 2,
    marginTop: 1,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
});

// ── Main Screen ──────────────────────────────────────────────────────

export default function BookingsScreen() {
  const { t } = useTranslation();
  const { orgId, officeIds, loading: orgLoading } = useOrg();
  const names = useNameLookup(orgId, officeIds);

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [deptFilter, setDeptFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [orgSettings, setOrgSettings] = useState<Record<string, any>>({});
  const [calendarOpen, setCalendarOpen] = useState(true);
  const [monthDots, setMonthDots] = useState<Record<string, { total: number; pending: number; confirmed: number }>>({});

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch ────────────────────────────────────────────────────────

  const fetchData = useCallback(
    async (showLoader = false) => {
      if (officeIds.length === 0) return;
      if (showLoader) setLoading(true);
      try {
        const start = `${dateFilter}T00:00:00`;
        const end = `${dateFilter}T23:59:59`;

        let query = supabase
          .from('appointments')
          .select('*')
          .in('office_id', officeIds)
          .gte('scheduled_at', start)
          .lte('scheduled_at', end)
          .order('scheduled_at');

        if (statusFilter !== 'all') query = query.eq('status', statusFilter);
        if (deptFilter !== 'all') query = query.eq('department_id', deptFilter);

        const { data } = await query;
        setAppointments((data as Appointment[]) ?? []);
      } catch (err) {
        console.error('Failed to load appointments', err);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [officeIds, dateFilter, statusFilter, deptFilter],
  );

  // Fetch month-level dots for calendar
  const fetchMonthDots = useCallback(async () => {
    if (officeIds.length === 0) return;
    const y = parseInt(dateFilter.slice(0, 4));
    const m = parseInt(dateFilter.slice(5, 7)) - 1;
    const firstDay = new Date(y, m, 1).toISOString();
    const lastDay = new Date(y, m + 1, 0, 23, 59, 59).toISOString();

    const { data } = await supabase
      .from('appointments')
      .select('scheduled_at, status')
      .in('office_id', officeIds)
      .gte('scheduled_at', firstDay)
      .lte('scheduled_at', lastDay);

    if (!data) return;

    const dots: Record<string, { total: number; pending: number; confirmed: number }> = {};
    for (const appt of data) {
      const day = appt.scheduled_at.split('T')[0];
      if (!dots[day]) dots[day] = { total: 0, pending: 0, confirmed: 0 };
      dots[day].total++;
      if (appt.status === 'pending') dots[day].pending++;
      if (appt.status === 'confirmed') dots[day].confirmed++;
    }
    setMonthDots(dots);
  }, [officeIds, dateFilter]);

  // Load departments and org settings once
  useEffect(() => {
    if (!orgId || officeIds.length === 0) return;
    supabase
      .from('departments')
      .select('id, name')
      .in('office_id', officeIds)
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setDepartments(data ?? []));

    supabase
      .from('organizations')
      .select('settings')
      .eq('id', orgId)
      .single()
      .then(({ data }) => {
        setOrgSettings((data?.settings as Record<string, any>) ?? {});
      });
  }, [orgId, officeIds]);

  useEffect(() => {
    if (!orgLoading && officeIds.length > 0) {
      fetchData(true);
      fetchMonthDots();
    }
  }, [orgLoading, officeIds, fetchData, fetchMonthDots]);

  useEffect(() => {
    if (officeIds.length === 0) return;
    intervalRef.current = setInterval(() => fetchData(false), 15_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [officeIds, fetchData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData(false);
    fetchMonthDots();
  }, [fetchData, fetchMonthDots]);

  // ── Stats ────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    let pending = 0, confirmed = 0, checkedIn = 0, cancelled = 0, noShow = 0, completed = 0;
    for (const a of appointments) {
      if (a.status === 'pending') pending++;
      else if (a.status === 'confirmed') confirmed++;
      else if (a.status === 'checked_in') checkedIn++;
      else if (a.status === 'cancelled') cancelled++;
      else if (a.status === 'no_show') noShow++;
      else if (a.status === 'completed' || a.status === 'served') completed++;
    }
    return { total: appointments.length, pending, confirmed, checkedIn, cancelled, noShow, completed };
  }, [appointments]);

  // ── Actions ──────────────────────────────────────────────────────

  const runAction = useCallback(
    (
      title: string,
      message: string,
      action: () => Promise<void>,
      apptId: string,
      destructive = false,
    ) => {
      Alert.alert(title, message, [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm'),
          style: destructive ? 'destructive' : 'default',
          onPress: async () => {
            setActionLoading(apptId);
            try {
              await action();
              await fetchData(false);
              fetchMonthDots();
            } catch (err: any) {
              Alert.alert(t('common.error'), err.message ?? t('adminQueue.actionFailed'));
            } finally {
              setActionLoading(null);
            }
          },
        },
      ]);
    },
    [fetchData, fetchMonthDots, t],
  );

  const handleApprove = useCallback(
    (appt: Appointment) => {
      runAction(
        t('bookings.approve'),
        t('bookings.approveMsg', { name: appt.customer_name }),
        () => Actions.approveAppointment(appt.id),
        appt.id,
      );
    },
    [runAction, t],
  );

  const handleDecline = useCallback(
    (appt: Appointment) => {
      runAction(
        t('bookings.decline'),
        t('bookings.declineMsg', { name: appt.customer_name }),
        () => Actions.declineAppointment(appt.id),
        appt.id,
        true,
      );
    },
    [runAction, t],
  );

  const handleCheckIn = useCallback(
    (appt: Appointment) => {
      runAction(
        t('bookings.checkIn'),
        t('bookings.checkInMsg', { name: appt.customer_name }),
        () => Actions.checkInAppointment(appt.id, appt.office_id, appt.department_id, appt.service_id),
        appt.id,
      );
    },
    [runAction, t],
  );

  const handleCancel = useCallback(
    (appt: Appointment) => {
      runAction(
        t('bookings.cancelAppointment'),
        t('bookings.cancelMsg', { name: appt.customer_name }),
        () => Actions.cancelAppointment(appt.id),
        appt.id,
        true,
      );
    },
    [runAction, t],
  );

  const handleNoShow = useCallback(
    (appt: Appointment) => {
      runAction(
        t('bookings.noShow'),
        t('bookings.noShowMsg', { name: appt.customer_name }),
        () => Actions.noShowAppointment(appt.id),
        appt.id,
        true,
      );
    },
    [runAction, t],
  );

  const handleComplete = useCallback(
    (appt: Appointment) => {
      runAction(
        t('bookings.complete'),
        t('bookings.completeMsg', { name: appt.customer_name }),
        () => Actions.completeAppointment(appt.id),
        appt.id,
      );
    },
    [runAction, t],
  );

  const handleDelete = useCallback(
    (appt: Appointment) => {
      runAction(
        t('bookings.delete'),
        t('bookings.deleteMsg', { name: appt.customer_name }),
        () => Actions.deleteAppointment(appt.id),
        appt.id,
        true,
      );
    },
    [runAction, t],
  );

  // ── Booking config ────────────────────────────────────────────────

  const bookingMode = orgSettings.booking_mode ?? 'simple';
  const bookingHorizon = orgSettings.booking_horizon_days ?? 7;
  const slotDuration = orgSettings.slot_duration_minutes ?? 30;
  const slotsPerInterval = orgSettings.slots_per_interval ?? 1;

  // ── Loading ───────────────────────────────────────────────────────

  if (orgLoading) {
    return (
      <View style={s.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // ── Render appointment actions based on status ─────────────────────

  const renderActions = (item: Appointment) => {
    const isActing = actionLoading === item.id;
    const st = item.status;

    if (isActing) {
      return (
        <View style={s.actionRow}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      );
    }

    return (
      <View style={s.actionRow}>
        {/* PENDING: Approve + Decline */}
        {st === 'pending' && (
          <>
            <ActionButton
              icon="checkmark-circle"
              color={colors.success}
              label={t('bookings.approve')}
              onPress={() => handleApprove(item)}
            />
            <ActionButton
              icon="close-circle"
              color={colors.error}
              label={t('bookings.decline')}
              onPress={() => handleDecline(item)}
            />
          </>
        )}

        {/* CONFIRMED: Check-in + Cancel + No-show */}
        {st === 'confirmed' && (
          <>
            <ActionButton
              icon="log-in"
              color={colors.success}
              label={t('bookings.checkIn')}
              onPress={() => handleCheckIn(item)}
            />
            <ActionButton
              icon="alert-circle"
              color="#f97316"
              label={t('bookings.noShow')}
              onPress={() => handleNoShow(item)}
            />
            <ActionButton
              icon="close-circle-outline"
              color={colors.error}
              label={t('common.cancel')}
              onPress={() => handleCancel(item)}
            />
          </>
        )}

        {/* CHECKED_IN: Complete + No-show */}
        {st === 'checked_in' && (
          <>
            <ActionButton
              icon="checkmark-done-circle"
              color="#6366f1"
              label={t('bookings.complete')}
              onPress={() => handleComplete(item)}
            />
            <ActionButton
              icon="alert-circle"
              color="#f97316"
              label={t('bookings.noShow')}
              onPress={() => handleNoShow(item)}
            />
          </>
        )}

        {/* TERMINAL states: Delete only */}
        {(st === 'cancelled' || st === 'no_show' || st === 'completed' || st === 'served') && (
          <ActionButton
            icon="trash-outline"
            color={colors.textMuted}
            label={t('bookings.delete')}
            onPress={() => handleDelete(item)}
          />
        )}
      </View>
    );
  };

  // ── Render ────────────────────────────────────────────────────────

  return (
    <View style={s.container}>
      {/* Calendar toggle + config */}
      <View style={s.topBar}>
        <TouchableOpacity
          style={s.calToggle}
          onPress={() => setCalendarOpen(!calendarOpen)}
          activeOpacity={0.7}
        >
          <Ionicons
            name={calendarOpen ? 'calendar' : 'calendar-outline'}
            size={18}
            color={colors.primary}
          />
          <Text style={s.calToggleText}>
            {new Date(dateFilter + 'T12:00:00').toLocaleDateString('en-US', {
              weekday: 'short', month: 'short', day: 'numeric',
            })}
          </Text>
          <Ionicons
            name={calendarOpen ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.textMuted}
          />
        </TouchableOpacity>
        <View style={s.configRow}>
          <View style={s.configChip}>
            <Ionicons name="settings-outline" size={11} color={colors.primary} />
            <Text style={s.configText}>{bookingMode}</Text>
          </View>
          <View style={s.configChip}>
            <Ionicons name="time-outline" size={11} color={colors.primary} />
            <Text style={s.configText}>{slotDuration}m</Text>
          </View>
          {slotsPerInterval > 1 && (
            <View style={s.configChip}>
              <Ionicons name="people-outline" size={11} color={colors.primary} />
              <Text style={s.configText}>{slotsPerInterval}/slot</Text>
            </View>
          )}
        </View>
      </View>

      {/* Calendar */}
      {calendarOpen && (
        <MonthCalendar
          selectedDate={dateFilter}
          onSelect={setDateFilter}
          appointmentDots={monthDots}
        />
      )}

      {/* Stats row */}
      <View style={s.statsRow}>
        <StatBadge label={t('bookings.total')} value={stats.total} color={colors.text} />
        <StatBadge label={t('bookings.pending')} value={stats.pending} color={colors.warning} />
        <StatBadge label={t('bookings.confirmed')} value={stats.confirmed} color={colors.primary} />
        <StatBadge label={t('bookings.checkedIn')} value={stats.checkedIn} color={colors.success} />
      </View>

      {/* Status filter chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterRow} contentContainerStyle={s.filterRowContent}>
        {STATUS_FILTERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[s.chip, statusFilter === f.key && s.chipActive]}
            onPress={() => setStatusFilter(f.key)}
          >
            <Ionicons
              name={f.icon as any}
              size={12}
              color={statusFilter === f.key ? '#fff' : colors.textSecondary}
            />
            <Text style={[s.chipText, statusFilter === f.key && s.chipTextActive]}>{t(f.labelKey)}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Department filter chips */}
      {departments.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterRow} contentContainerStyle={s.filterRowContent}>
          <TouchableOpacity
            style={[s.chip, deptFilter === 'all' && s.chipActive]}
            onPress={() => setDeptFilter('all')}
          >
            <Text style={[s.chipText, deptFilter === 'all' && s.chipTextActive]}>{t('adminManage.departments')}</Text>
          </TouchableOpacity>
          {departments.map((d) => (
            <TouchableOpacity
              key={d.id}
              style={[s.chip, deptFilter === d.id && s.chipActive]}
              onPress={() => setDeptFilter(d.id)}
            >
              <Text style={[s.chipText, deptFilter === d.id && s.chipTextActive]}>{d.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Appointments list */}
      <FlatList
        data={appointments}
        keyExtractor={(item) => item.id}
        contentContainerStyle={appointments.length === 0 ? s.emptyContainer : s.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: spacing.xxl }} />
          ) : (
            <View style={s.emptyState}>
              <Ionicons name="calendar-outline" size={56} color={colors.textMuted} />
              <Text style={s.emptyTitle}>{t('bookings.noBookings')}</Text>
              <Text style={s.emptySubtitle}>
                {t('bookings.noBookingsMsg')}
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const statusColor = getStatusColor(item.status);
          const statusIcon = getStatusIcon(item.status);

          return (
            <View style={[s.card, { borderLeftColor: statusColor, borderLeftWidth: 3 }]}>
              {/* Top row */}
              <View style={s.cardTop}>
                <View style={[s.avatar, { backgroundColor: statusColor + '18' }]}>
                  <Ionicons name="person" size={16} color={statusColor} />
                </View>
                <View style={s.cardInfo}>
                  <Text style={s.customerName} numberOfLines={1}>{item.customer_name}</Text>
                  <View style={s.metaRow}>
                    <View style={s.timeChip}>
                      <Ionicons name="time-outline" size={12} color={colors.primary} />
                      <Text style={s.timeText}>{formatTime12(item.scheduled_at)}</Text>
                    </View>
                    {names.departments[item.department_id] && (
                      <View style={s.locChip}>
                        <Text style={s.locText}>{names.departments[item.department_id]}</Text>
                      </View>
                    )}
                    {names.services[item.service_id] && (
                      <View style={s.locChip}>
                        <Text style={s.locText}>{names.services[item.service_id]}</Text>
                      </View>
                    )}
                  </View>
                  {item.customer_phone && (
                    <View style={s.metaRow}>
                      <View style={s.phoneBadge}>
                        <Ionicons name="call-outline" size={10} color={colors.textSecondary} />
                        <Text style={s.phoneText}>{item.customer_phone}</Text>
                      </View>
                    </View>
                  )}
                </View>
                {/* Status badge */}
                <View style={[s.statusBadge, { backgroundColor: statusColor + '18' }]}>
                  <Ionicons name={statusIcon as any} size={12} color={statusColor} />
                  <Text style={[s.statusText, { color: statusColor }]}>
                    {item.status.replace('_', ' ')}
                  </Text>
                </View>
              </View>

              {/* Actions */}
              {renderActions(item)}
            </View>
          );
        }}
      />
    </View>
  );
}

// ── Sub-components ──────────────────────────────────────────────────

function StatBadge({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={s.statBadge}>
      <Text style={[s.statValue, { color }]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function ActionButton({ icon, color, label, onPress }: { icon: string; color: string; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[s.actionBtn, { borderColor: color + '40', backgroundColor: color + '08' }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Ionicons name={icon as any} size={16} color={color} />
      <Text style={[s.actionBtnText, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── Styles ──────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },

  // Top bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  calToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primaryLight + '12',
  },
  calToggleText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.primary,
  },
  configRow: {
    flexDirection: 'row',
    gap: 4,
  },
  configChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceSecondary,
  },
  configText: { fontSize: 10, fontWeight: '600', color: colors.textSecondary, textTransform: 'capitalize' },

  // Stats
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  statBadge: { flex: 1, alignItems: 'center', gap: 2 },
  statValue: { fontSize: fontSize.xl, fontWeight: '800' },
  statLabel: { fontSize: fontSize.xs, color: colors.textSecondary },

  // Filters
  filterRow: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    maxHeight: 48,
  },
  filterRowContent: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceSecondary,
  },
  chipActive: { backgroundColor: colors.primary },
  chipText: { fontSize: fontSize.xs, fontWeight: '600', color: colors.textSecondary },
  chipTextActive: { color: '#fff' },

  // List
  listContent: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.sm },
  emptyContainer: { flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
  emptyState: { alignItems: 'center', gap: spacing.md, padding: spacing.xl },
  emptyTitle: { fontSize: fontSize.xl, fontWeight: '700', color: colors.textMuted },
  emptySubtitle: { fontSize: fontSize.md, color: colors.textMuted, textAlign: 'center', paddingHorizontal: spacing.lg, lineHeight: 22 },

  // Card
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardInfo: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  customerName: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },

  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    gap: 4,
  },
  statusText: { fontSize: 10, fontWeight: '700', textTransform: 'capitalize' },

  // Actions row
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 1,
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  actionBtnText: {
    fontSize: 11,
    fontWeight: '700',
  },

  // Meta
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  timeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 1,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primaryLight + '15',
  },
  timeText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.primary },
  locChip: {
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 1,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceSecondary,
  },
  locText: { fontSize: 10, fontWeight: '500', color: colors.textSecondary },
  phoneBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 1,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceSecondary,
  },
  phoneText: { fontSize: 10, fontWeight: '500', color: colors.textSecondary },
});
