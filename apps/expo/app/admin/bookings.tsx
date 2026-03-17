import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useOrg } from '@/lib/use-org';
import { useNameLookup } from '@/lib/use-realtime-queue';
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

type StatusFilter = 'all' | 'pending' | 'confirmed' | 'checked_in' | 'cancelled' | 'served';

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'checked_in', label: 'Checked In' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'served', label: 'Served' },
];

// ── Helpers ──────────────────────────────────────────────────────────

function getStatusColor(status: string): string {
  switch (status) {
    case 'pending':
      return colors.warning;
    case 'confirmed':
      return colors.waiting;
    case 'checked_in':
      return colors.success;
    case 'cancelled':
      return colors.error;
    case 'served':
      return colors.textMuted;
    default:
      return colors.textMuted;
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return 'Pending';
    case 'confirmed':
      return 'Confirmed';
    case 'checked_in':
      return 'Checked In';
    case 'cancelled':
      return 'Cancelled';
    case 'served':
      return 'Served';
    default:
      return status;
  }
}

function formatScheduledDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow =
    date.getFullYear() === tomorrow.getFullYear() &&
    date.getMonth() === tomorrow.getMonth() &&
    date.getDate() === tomorrow.getDate();

  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (isToday) return `Today at ${timeStr}`;
  if (isTomorrow) return `Tomorrow at ${timeStr}`;

  const dateFormatted = date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
  return `${dateFormatted} at ${timeStr}`;
}

// ── Main Screen ──────────────────────────────────────────────────────

export default function BookingsScreen() {
  const { orgId, officeIds, loading: orgLoading } = useOrg();
  const names = useNameLookup(orgId, officeIds);

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch ────────────────────────────────────────────────────────

  const fetchData = useCallback(
    async (showLoader = false) => {
      if (officeIds.length === 0) return;
      if (showLoader) setLoading(true);
      try {
        const data = await Actions.fetchAppointments(officeIds);
        setAppointments(data as Appointment[]);
      } catch (err) {
        console.error('Failed to load appointments', err);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [officeIds],
  );

  useEffect(() => {
    if (!orgLoading && officeIds.length > 0) {
      fetchData(true);
    }
  }, [orgLoading, officeIds, fetchData]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    if (officeIds.length === 0) return;
    intervalRef.current = setInterval(() => fetchData(false), 10_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [officeIds, fetchData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData(false);
  }, [fetchData]);

  // ── Filtered list ────────────────────────────────────────────────

  const filtered = useMemo(() => {
    if (filter === 'all') return appointments;
    return appointments.filter((a) => a.status === filter);
  }, [appointments, filter]);

  // ── Stats ────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const total = appointments.length;
    let pending = 0;
    let checkedIn = 0;
    let cancelled = 0;
    for (const a of appointments) {
      if (a.status === 'pending' || a.status === 'confirmed') pending++;
      else if (a.status === 'checked_in') checkedIn++;
      else if (a.status === 'cancelled') cancelled++;
    }
    return { total, pending, checkedIn, cancelled };
  }, [appointments]);

  // ── Actions ──────────────────────────────────────────────────────

  const handleCheckIn = useCallback(
    (appt: Appointment) => {
      Alert.alert(
        'Check In Appointment',
        `Check in ${appt.customer_name} and create a queue ticket?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Check In',
            onPress: async () => {
              setActionLoading(appt.id);
              try {
                await Actions.checkInAppointment(
                  appt.id,
                  appt.office_id,
                  appt.department_id,
                  appt.service_id,
                );
                await fetchData(false);
              } catch (err: any) {
                Alert.alert('Error', err.message ?? 'Failed to check in');
              } finally {
                setActionLoading(null);
              }
            },
          },
        ],
      );
    },
    [fetchData],
  );

  const handleCancel = useCallback(
    (appt: Appointment) => {
      Alert.alert(
        'Cancel Appointment',
        `Cancel appointment for ${appt.customer_name}?`,
        [
          { text: 'No', style: 'cancel' },
          {
            text: 'Yes, Cancel',
            style: 'destructive',
            onPress: async () => {
              setActionLoading(appt.id);
              try {
                await Actions.cancelAppointment(appt.id);
                await fetchData(false);
              } catch (err: any) {
                Alert.alert('Error', err.message ?? 'Failed to cancel');
              } finally {
                setActionLoading(null);
              }
            },
          },
        ],
      );
    },
    [fetchData],
  );

  // ── Render helpers ───────────────────────────────────────────────

  const canAct = (status: string) => status === 'pending' || status === 'confirmed';

  const renderStatCard = (
    label: string,
    value: number,
    color: string,
    icon: keyof typeof Ionicons.glyphMap,
  ) => (
    <View style={[styles.statCard, { borderTopColor: color }]}>
      <Ionicons name={icon} size={20} color={color} style={styles.statIcon} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );

  const renderAppointment = ({ item }: { item: Appointment }) => {
    const statusColor = getStatusColor(item.status);
    const isActing = actionLoading === item.id;

    return (
      <View style={styles.card}>
        {/* Header row */}
        <View style={styles.cardHeader}>
          <View style={styles.customerInfo}>
            <Ionicons name="person-circle-outline" size={22} color={colors.text} />
            <Text style={styles.customerName} numberOfLines={1}>
              {item.customer_name}
            </Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusColor + '18' }]}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusText, { color: statusColor }]}>
              {getStatusLabel(item.status)}
            </Text>
          </View>
        </View>

        {/* Contact details */}
        <View style={styles.detailsSection}>
          {item.customer_phone ? (
            <View style={styles.detailRow}>
              <Ionicons name="call-outline" size={14} color={colors.textSecondary} />
              <Text style={styles.detailText}>{item.customer_phone}</Text>
            </View>
          ) : null}
          {item.customer_email ? (
            <View style={styles.detailRow}>
              <Ionicons name="mail-outline" size={14} color={colors.textSecondary} />
              <Text style={styles.detailText} numberOfLines={1}>
                {item.customer_email}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Schedule */}
        <View style={styles.scheduleRow}>
          <Ionicons name="calendar-outline" size={14} color={colors.primary} />
          <Text style={styles.scheduleText}>{formatScheduledDate(item.scheduled_at)}</Text>
        </View>

        {/* Location info */}
        <View style={styles.locationRow}>
          {names.offices[item.office_id] ? (
            <View style={styles.locationChip}>
              <Ionicons name="business-outline" size={12} color={colors.textSecondary} />
              <Text style={styles.locationText}>{names.offices[item.office_id]}</Text>
            </View>
          ) : null}
          {names.departments[item.department_id] ? (
            <View style={styles.locationChip}>
              <Ionicons name="layers-outline" size={12} color={colors.textSecondary} />
              <Text style={styles.locationText}>{names.departments[item.department_id]}</Text>
            </View>
          ) : null}
          {names.services[item.service_id] ? (
            <View style={styles.locationChip}>
              <Ionicons name="construct-outline" size={12} color={colors.textSecondary} />
              <Text style={styles.locationText}>{names.services[item.service_id]}</Text>
            </View>
          ) : null}
        </View>

        {/* Actions */}
        {canAct(item.status) ? (
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.checkInBtn]}
              onPress={() => handleCheckIn(item)}
              disabled={isActing}
            >
              {isActing ? (
                <ActivityIndicator size="small" color={colors.surface} />
              ) : (
                <>
                  <Ionicons name="log-in-outline" size={16} color={colors.surface} />
                  <Text style={styles.actionBtnTextLight}>Check In</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, styles.cancelBtn]}
              onPress={() => handleCancel(item)}
              disabled={isActing}
            >
              <Ionicons name="close-circle-outline" size={16} color={colors.error} />
              <Text style={styles.actionBtnTextDanger}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    );
  };

  // ── Loading / empty states ───────────────────────────────────────

  if (orgLoading || loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading appointments...</Text>
      </View>
    );
  }

  // ── Main render ──────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Summary stats */}
      <View style={styles.statsRow}>
        {renderStatCard('Total', stats.total, colors.primary, 'calendar-outline')}
        {renderStatCard('Pending', stats.pending, colors.warning, 'time-outline')}
        {renderStatCard('Checked In', stats.checkedIn, colors.success, 'log-in-outline')}
        {renderStatCard('Cancelled', stats.cancelled, colors.error, 'close-circle-outline')}
      </View>

      {/* Filter tabs */}
      <FlatList
        horizontal
        data={FILTERS}
        keyExtractor={(item) => item.key}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filtersContainer}
        renderItem={({ item: f }) => {
          const active = filter === f.key;
          return (
            <TouchableOpacity
              style={[styles.filterTab, active && styles.filterTabActive]}
              onPress={() => setFilter(f.key)}
            >
              <Text style={[styles.filterTabText, active && styles.filterTabTextActive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          );
        }}
      />

      {/* Appointments list */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={renderAppointment}
        contentContainerStyle={
          filtered.length === 0 ? styles.emptyContainer : styles.listContent
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="calendar-outline" size={56} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No Appointments</Text>
            <Text style={styles.emptySubtitle}>
              {filter === 'all'
                ? 'No appointments found for your offices.'
                : `No ${filter.replace('_', ' ')} appointments.`}
            </Text>
          </View>
        }
      />
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: fontSize.md,
    color: colors.textSecondary,
  },

  // ── Stats ──────────────────────────────
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.sm,
    alignItems: 'center',
    borderTopWidth: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  statIcon: {
    marginBottom: spacing.xs,
  },
  statValue: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.text,
  },
  statLabel: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },

  // ── Filters ────────────────────────────
  filtersContainer: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  filterTab: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterTabActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterTabText: {
    fontSize: fontSize.sm,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  filterTabTextActive: {
    color: colors.surface,
  },

  // ── List ───────────────────────────────
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },

  // ── Card ───────────────────────────────
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
    marginBottom: spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  customerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
  },
  customerName: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
  },

  // ── Status badge ───────────────────────
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    gap: 4,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
  },

  // ── Details ────────────────────────────
  detailsSection: {
    marginBottom: spacing.sm,
    gap: 4,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  detailText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    flex: 1,
  },

  // ── Schedule ───────────────────────────
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    backgroundColor: colors.infoLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    borderRadius: borderRadius.sm,
  },
  scheduleText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.primary,
  },

  // ── Location chips ─────────────────────
  locationRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  locationChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceSecondary,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
  },
  locationText: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
  },

  // ── Actions ────────────────────────────
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
  },
  checkInBtn: {
    backgroundColor: colors.success,
  },
  cancelBtn: {
    backgroundColor: colors.errorLight,
    borderWidth: 1,
    borderColor: colors.error + '30',
  },
  actionBtnTextLight: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.surface,
  },
  actionBtnTextDanger: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.error,
  },

  // ── Empty state ────────────────────────
  emptyContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.text,
    marginTop: spacing.md,
  },
  emptySubtitle: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
});
