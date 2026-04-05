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

type StatusFilter = 'all' | 'pending' | 'confirmed' | 'checked_in' | 'cancelled';

const STATUS_FILTERS: { key: StatusFilter; labelKey: string }[] = [
  { key: 'all', labelKey: 'common.all' },
  { key: 'pending', labelKey: 'bookings.pending' },
  { key: 'confirmed', labelKey: 'bookings.confirmed' },
  { key: 'checked_in', labelKey: 'bookings.checkedIn' },
  { key: 'cancelled', labelKey: 'bookings.cancelled' },
];

// ── Helpers ──────────────────────────────────────────────────────────

function getStatusColor(status: string): string {
  switch (status) {
    case 'pending': return colors.warning;
    case 'confirmed': return colors.waiting;
    case 'checked_in': return colors.success;
    case 'cancelled': return colors.error;
    case 'served': return colors.textMuted;
    default: return colors.textMuted;
  }
}

function formatTime12(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === now.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

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
    if (!orgLoading && officeIds.length > 0) fetchData(true);
  }, [orgLoading, officeIds, fetchData]);

  useEffect(() => {
    if (officeIds.length === 0) return;
    intervalRef.current = setInterval(() => fetchData(false), 15_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [officeIds, fetchData]);

  const onRefresh = useCallback(() => { setRefreshing(true); fetchData(false); }, [fetchData]);

  // ── Stats ────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    let pending = 0, checkedIn = 0, cancelled = 0;
    for (const a of appointments) {
      if (a.status === 'pending' || a.status === 'confirmed') pending++;
      else if (a.status === 'checked_in') checkedIn++;
      else if (a.status === 'cancelled') cancelled++;
    }
    return { total: appointments.length, pending, checkedIn, cancelled };
  }, [appointments]);

  // ── Date nav ──────────────────────────────────────────────────────

  const navigateDate = (delta: number) => {
    const d = new Date(dateFilter + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    setDateFilter(d.toISOString().split('T')[0]);
  };

  // ── Actions ──────────────────────────────────────────────────────

  const handleCheckIn = useCallback(
    (appt: Appointment) => {
      Alert.alert(t('bookings.checkIn'), t('bookings.checkInMsg', { name: appt.customer_name }), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('bookings.checkIn'),
          onPress: async () => {
            setActionLoading(appt.id);
            try {
              await Actions.checkInAppointment(appt.id, appt.office_id, appt.department_id, appt.service_id);
              await fetchData(false);
            } catch (err: any) {
              Alert.alert(t('common.error'), err.message ?? t('bookings.checkIn'));
            } finally {
              setActionLoading(null);
            }
          },
        },
      ]);
    },
    [fetchData],
  );

  const handleCancel = useCallback(
    (appt: Appointment) => {
      Alert.alert(t('bookings.cancelAppointment'), t('bookings.cancelMsg', { name: appt.customer_name }), [
        { text: t('bookings.keep'), style: 'cancel' },
        {
          text: t('bookings.cancelBooking'),
          style: 'destructive',
          onPress: async () => {
            setActionLoading(appt.id);
            try {
              await Actions.cancelAppointment(appt.id);
              await fetchData(false);
            } catch (err: any) {
              Alert.alert(t('common.error'), err.message ?? t('bookings.cancelBooking'));
            } finally {
              setActionLoading(null);
            }
          },
        },
      ]);
    },
    [fetchData],
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

  // ── Render ────────────────────────────────────────────────────────

  return (
    <View style={s.container}>
      {/* Config summary */}
      <View style={s.configBar}>
        <View style={s.configChip}>
          <Ionicons name="settings-outline" size={12} color={colors.primary} />
          <Text style={s.configText}>{bookingMode}</Text>
        </View>
        <View style={s.configChip}>
          <Ionicons name="calendar-outline" size={12} color={colors.primary} />
          <Text style={s.configText}>{bookingHorizon}d horizon</Text>
        </View>
        <View style={s.configChip}>
          <Ionicons name="time-outline" size={12} color={colors.primary} />
          <Text style={s.configText}>{slotDuration}min slots</Text>
        </View>
        {slotsPerInterval > 1 && (
          <View style={s.configChip}>
            <Ionicons name="people-outline" size={12} color={colors.primary} />
            <Text style={s.configText}>{slotsPerInterval}/slot</Text>
          </View>
        )}
      </View>

      {/* Date navigation */}
      <View style={s.dateNav}>
        <TouchableOpacity onPress={() => navigateDate(-1)} style={s.dateArrow}>
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={s.dateLabel}>{formatDateLabel(dateFilter)}</Text>
        <TouchableOpacity onPress={() => navigateDate(1)} style={s.dateArrow}>
          <Ionicons name="chevron-forward" size={20} color={colors.text} />
        </TouchableOpacity>
      </View>

      {/* Stats row */}
      <View style={s.statsRow}>
        <StatBadge label={t('bookings.total')} value={stats.total} color={colors.primary} />
        <StatBadge label={t('bookings.pending')} value={stats.pending} color={colors.warning} />
        <StatBadge label={t('bookings.checkedIn')} value={stats.checkedIn} color={colors.success} />
        <StatBadge label={t('bookings.cancelled')} value={stats.cancelled} color={colors.error} />
      </View>

      {/* Status filter chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterRow} contentContainerStyle={s.filterRowContent}>
        {STATUS_FILTERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[s.chip, statusFilter === f.key && s.chipActive]}
            onPress={() => setStatusFilter(f.key)}
          >
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
          const canAct = item.status === 'pending' || item.status === 'confirmed';
          const isActing = actionLoading === item.id;

          return (
            <View style={s.card}>
              {/* Top row: avatar + name + actions */}
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
                </View>
                {/* Right side: status + inline action icons */}
                <View style={s.cardRight}>
                  <View style={[s.statusBadge, { backgroundColor: statusColor + '18' }]}>
                    <View style={[s.statusDot, { backgroundColor: statusColor }]} />
                    <Text style={[s.statusText, { color: statusColor }]}>
                      {item.status.replace('_', ' ')}
                    </Text>
                  </View>
                  {canAct && (
                    <View style={s.inlineActions}>
                      <TouchableOpacity
                        style={s.actionIconBtn}
                        onPress={() => handleCheckIn(item)}
                        disabled={isActing}
                      >
                        {isActing ? (
                          <ActivityIndicator size="small" color={colors.success} />
                        ) : (
                          <Ionicons name="checkmark-circle" size={28} color={colors.success} />
                        )}
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={s.actionIconBtn}
                        onPress={() => handleCancel(item)}
                        disabled={isActing}
                      >
                        <Ionicons name="close-circle" size={28} color={colors.error} />
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              </View>
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

// ── Styles ──────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },

  // Config bar
  configBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  configChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primaryLight + '15',
  },
  configText: { fontSize: fontSize.xs, fontWeight: '600', color: colors.primary, textTransform: 'capitalize' },

  // Date nav
  dateNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dateArrow: {
    padding: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceSecondary,
  },
  dateLabel: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.text,
    minWidth: 130,
    textAlign: 'center',
  },

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
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceSecondary,
  },
  chipActive: { backgroundColor: colors.primary },
  chipText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textSecondary },
  chipTextActive: { color: '#fff' },

  // List
  listContent: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md },
  emptyContainer: { flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
  emptyState: { alignItems: 'center', gap: spacing.md, padding: spacing.xl },
  emptyTitle: { fontSize: fontSize.xl, fontWeight: '700', color: colors.textMuted },
  emptySubtitle: { fontSize: fontSize.md, color: colors.textMuted, textAlign: 'center', paddingHorizontal: spacing.lg, lineHeight: 22 },

  // Card
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
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
  cardRight: {
    alignItems: 'flex-end',
    gap: 6,
    flexShrink: 0,
  },
  customerName: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },

  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
    gap: 4,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 10, fontWeight: '700', textTransform: 'capitalize' },

  inlineActions: {
    flexDirection: 'row',
    gap: 4,
  },
  actionIconBtn: {
    padding: 2,
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
});
