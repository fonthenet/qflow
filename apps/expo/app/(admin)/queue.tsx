import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { QueueTicket } from '@/lib/use-realtime-queue';
import { useNameLookup } from '@/lib/use-realtime-queue';
import { useOrg } from '@/lib/use-org';
import * as Actions from '@/lib/ticket-actions';
import { colors, borderRadius, fontSize, spacing } from '@/lib/theme';

// ── Types ────────────────────────────────────────────────────────────

type Filter = 'active' | 'waiting' | 'called' | 'serving' | 'done';

const FILTERS: { key: Filter; label: string; icon: string }[] = [
  { key: 'active', label: 'Active', icon: 'pulse' },
  { key: 'waiting', label: 'Waiting', icon: 'time-outline' },
  { key: 'called', label: 'Called', icon: 'megaphone-outline' },
  { key: 'serving', label: 'Serving', icon: 'person-outline' },
  { key: 'done', label: 'Done', icon: 'checkmark-done-outline' },
];

const TICKET_COLUMNS =
  'id, ticket_number, status, customer_data, priority_category_id, priority, created_at, called_at, serving_started_at, completed_at, desk_id, office_id, service_id, department_id, recall_count, is_remote, appointment_id, parked_at, notes';

// ── Helpers ──────────────────────────────────────────────────────────

function getStatusColor(status: string): string {
  switch (status) {
    case 'waiting':
      return colors.waiting;
    case 'called':
      return colors.called;
    case 'serving':
      return colors.serving;
    case 'served':
      return colors.success;
    case 'no_show':
      return colors.warning;
    case 'cancelled':
      return colors.error;
    default:
      return colors.textMuted;
  }
}

function formatWait(dateStr: string): string {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function statusesForFilter(filter: Filter): string[] {
  switch (filter) {
    case 'active':
      return ['waiting', 'called', 'serving'];
    case 'done':
      return ['served', 'no_show', 'cancelled'];
    default:
      return [filter];
  }
}

// ── Main Screen ──────────────────────────────────────────────────────

export default function AdminQueueScreen() {
  const { orgId, officeIds, staffId } = useOrg();
  const names = useNameLookup(orgId, officeIds);

  const [tickets, setTickets] = useState<QueueTicket[]>([]);
  const [filter, setFilter] = useState<Filter>('active');
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch tickets ────────────────────────────────────────────────

  const fetchAllTickets = useCallback(async () => {
    if (officeIds.length === 0) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString();

    const statuses = statusesForFilter(filter);

    const { data, error } = await supabase
      .from('tickets')
      .select(TICKET_COLUMNS)
      .in('office_id', officeIds)
      .in('status', statuses)
      .gte('created_at', todayISO)
      .order('priority', { ascending: false, nullsFirst: true })
      .order('created_at', { ascending: true })
      .limit(200);

    if (error) {
      console.warn('Admin queue fetch error:', error.message);
      return;
    }

    setTickets((data as unknown as QueueTicket[]) ?? []);
    setLoading(false);
  }, [officeIds, filter]);

  useEffect(() => {
    setLoading(true);
    fetchAllTickets();
    intervalRef.current = setInterval(fetchAllTickets, 3000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchAllTickets]);

  // ── Derived data ─────────────────────────────────────────────────

  const parkedTickets = useMemo(
    () => tickets.filter((t) => t.parked_at != null),
    [tickets],
  );

  const regularTickets = useMemo(
    () => tickets.filter((t) => t.parked_at == null),
    [tickets],
  );

  const longestWait = useMemo(() => {
    const activeTickets = tickets.filter(
      (t) => t.status === 'waiting' || t.status === 'called',
    );
    if (activeTickets.length === 0) return null;
    const oldest = activeTickets.reduce((a, b) =>
      new Date(a.created_at) < new Date(b.created_at) ? a : b,
    );
    return formatWait(oldest.created_at);
  }, [tickets]);

  // ── Actions ──────────────────────────────────────────────────────

  const confirmAction = (
    title: string,
    message: string,
    onConfirm: () => Promise<void>,
  ) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm',
        onPress: async () => {
          try {
            await onConfirm();
            fetchAllTickets();
          } catch (err: any) {
            Alert.alert('Error', err.message ?? 'Action failed');
          }
        },
      },
    ]);
  };

  const handleCall = (t: QueueTicket) => {
    confirmAction('Call Ticket', `Call ${t.ticket_number} to a desk?`, async () => {
      // Admin call: set status directly (no desk assignment)
      await supabase
        .from('tickets')
        .update({
          status: 'called',
          called_at: new Date().toISOString(),
          called_by_staff_id: staffId,
        })
        .eq('id', t.id);
    });
  };

  const handleServe = (t: QueueTicket) => {
    confirmAction('Start Serving', `Start serving ${t.ticket_number}?`, () =>
      Actions.startServing(t.id),
    );
  };

  const handleComplete = (t: QueueTicket) => {
    confirmAction('Complete', `Mark ${t.ticket_number} as served?`, () =>
      Actions.markServed(t.id),
    );
  };

  const handleNoShow = (t: QueueTicket) => {
    confirmAction('No Show', `Mark ${t.ticket_number} as no-show?`, () =>
      Actions.markNoShow(t.id),
    );
  };

  const handleCancel = (t: QueueTicket) => {
    confirmAction('Cancel', `Cancel ticket ${t.ticket_number}?`, () =>
      Actions.cancelTicket(t.id),
    );
  };

  const handlePark = (t: QueueTicket) => {
    confirmAction('Park', `Put ${t.ticket_number} on hold?`, () =>
      Actions.parkTicket(t.id),
    );
  };

  const handleBackToQueue = (t: QueueTicket) => {
    confirmAction('Back to Queue', `Send ${t.ticket_number} back to waiting?`, () =>
      Actions.resetToQueue(t.id),
    );
  };

  const handleResume = (t: QueueTicket) => {
    confirmAction('Resume', `Resume ticket ${t.ticket_number}?`, () =>
      Actions.unparkTicket(t.id),
    );
  };

  // ── Pull to refresh ──────────────────────────────────────────────

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchAllTickets();
    setRefreshing(false);
  };

  // ── Render helpers ───────────────────────────────────────────────

  const renderTicketCard = (ticket: QueueTicket, isParked = false) => {
    const customerName = ticket.customer_data?.name ?? null;
    const officeName = names.offices[ticket.office_id] ?? '';
    const serviceName = ticket.service_id
      ? names.services[ticket.service_id] ?? ''
      : '';
    const deptName = ticket.department_id
      ? names.departments[ticket.department_id] ?? ''
      : '';
    const deskName = ticket.desk_id ? names.desks[ticket.desk_id] ?? '' : '';
    const priorityInfo = ticket.priority_category_id
      ? names.priorities[ticket.priority_category_id] ?? null
      : null;

    const isTerminal = ['served', 'no_show', 'cancelled'].includes(ticket.status);

    return (
      <View
        style={[
          styles.ticketCard,
          isParked && styles.ticketCardParked,
        ]}
        key={ticket.id}
      >
        {/* Header row */}
        <View style={styles.ticketHeader}>
          <View style={styles.ticketLeft}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: getStatusColor(ticket.status) },
              ]}
            />
            <Text style={styles.ticketNumber}>{ticket.ticket_number}</Text>
            {priorityInfo && (
              <View
                style={[
                  styles.priorityBadge,
                  priorityInfo.color
                    ? { backgroundColor: priorityInfo.color + '20' }
                    : undefined,
                ]}
              >
                <Ionicons
                  name="flag"
                  size={10}
                  color={priorityInfo.color ?? colors.warning}
                />
                <Text
                  style={[
                    styles.priorityText,
                    { color: priorityInfo.color ?? colors.warning },
                  ]}
                >
                  {priorityInfo.name}
                </Text>
              </View>
            )}
          </View>
          <View style={styles.ticketRight}>
            {ticket.is_remote && (
              <View style={styles.sourceBadge}>
                <Ionicons name="globe-outline" size={10} color={colors.info} />
                <Text style={styles.sourceBadgeText}>Remote</Text>
              </View>
            )}
            {ticket.appointment_id && !ticket.is_remote && (
              <View style={[styles.sourceBadge, styles.sourceBadgeBooked]}>
                <Ionicons name="calendar-outline" size={10} color={colors.primary} />
                <Text style={[styles.sourceBadgeText, { color: colors.primary }]}>
                  Booked
                </Text>
              </View>
            )}
            <Text style={styles.waitTime}>{formatWait(ticket.created_at)}</Text>
          </View>
        </View>

        {/* Meta info */}
        <View style={styles.ticketMeta}>
          {customerName && (
            <Text style={styles.customerName}>{customerName}</Text>
          )}
          <Text style={styles.metaText} numberOfLines={1}>
            {officeName}
            {serviceName ? ` \u00B7 ${serviceName}` : ''}
            {deptName ? ` \u00B7 ${deptName}` : ''}
          </Text>
          {deskName ? (
            <View style={styles.deskRow}>
              <Ionicons name="desktop-outline" size={12} color={colors.primary} />
              <Text style={styles.deskText}>{deskName}</Text>
            </View>
          ) : null}
        </View>

        {/* Actions */}
        {!isTerminal && (
          <View style={styles.ticketActions}>
            {isParked ? (
              <ActionBtn
                label="Resume"
                icon="play-circle-outline"
                color={colors.primary}
                onPress={() => handleResume(ticket)}
              />
            ) : (
              <>
                {ticket.status === 'waiting' && (
                  <>
                    <ActionBtn
                      label="Call"
                      icon="megaphone-outline"
                      color={colors.called}
                      onPress={() => handleCall(ticket)}
                    />
                    <ActionBtn
                      label="Cancel"
                      icon="close-circle-outline"
                      color={colors.error}
                      onPress={() => handleCancel(ticket)}
                    />
                  </>
                )}
                {ticket.status === 'called' && (
                  <>
                    <ActionBtn
                      label="Serve"
                      icon="play-outline"
                      color={colors.serving}
                      onPress={() => handleServe(ticket)}
                    />
                    <ActionBtn
                      label="No Show"
                      icon="alert-circle-outline"
                      color={colors.warning}
                      onPress={() => handleNoShow(ticket)}
                    />
                    <ActionBtn
                      label="Park"
                      icon="pause-outline"
                      color={colors.textSecondary}
                      onPress={() => handlePark(ticket)}
                    />
                    <ActionBtn
                      label="Requeue"
                      icon="arrow-undo-outline"
                      color={colors.info}
                      onPress={() => handleBackToQueue(ticket)}
                    />
                  </>
                )}
                {ticket.status === 'serving' && (
                  <>
                    <ActionBtn
                      label="Complete"
                      icon="checkmark-circle-outline"
                      color={colors.success}
                      onPress={() => handleComplete(ticket)}
                    />
                    <ActionBtn
                      label="No Show"
                      icon="alert-circle-outline"
                      color={colors.warning}
                      onPress={() => handleNoShow(ticket)}
                    />
                    <ActionBtn
                      label="Park"
                      icon="pause-outline"
                      color={colors.textSecondary}
                      onPress={() => handlePark(ticket)}
                    />
                  </>
                )}
              </>
            )}
          </View>
        )}
      </View>
    );
  };

  // ── Render ───────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Filter chips */}
      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[
              styles.filterChip,
              filter === f.key && styles.filterChipActive,
            ]}
            onPress={() => setFilter(f.key)}
            activeOpacity={0.7}
          >
            <Ionicons
              name={f.icon as any}
              size={14}
              color={filter === f.key ? '#fff' : colors.textSecondary}
            />
            <Text
              style={[
                styles.filterText,
                filter === f.key && styles.filterTextActive,
              ]}
            >
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Stats bar */}
      <View style={styles.statsBar}>
        <View style={styles.statItem}>
          <Ionicons name="ticket-outline" size={16} color={colors.primary} />
          <Text style={styles.statValue}>{tickets.length}</Text>
          <Text style={styles.statLabel}>total</Text>
        </View>
        {longestWait && (
          <View style={styles.statItem}>
            <Ionicons name="hourglass-outline" size={16} color={colors.warning} />
            <Text style={styles.statValue}>{longestWait}</Text>
            <Text style={styles.statLabel}>longest wait</Text>
          </View>
        )}
        {parkedTickets.length > 0 && (
          <View style={styles.statItem}>
            <Ionicons name="pause-circle-outline" size={16} color={colors.warning} />
            <Text style={styles.statValue}>{parkedTickets.length}</Text>
            <Text style={styles.statLabel}>on hold</Text>
          </View>
        )}
      </View>

      <FlatList
        data={regularTickets}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={
          parkedTickets.length > 0 ? (
            <View style={styles.parkedSection}>
              <View style={styles.parkedHeader}>
                <Ionicons name="pause-circle" size={18} color={colors.warning} />
                <Text style={styles.parkedTitle}>
                  On Hold ({parkedTickets.length})
                </Text>
              </View>
              {parkedTickets.map((t) => renderTicketCard(t, true))}
            </View>
          ) : null
        }
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Ionicons
                name="checkmark-done-outline"
                size={48}
                color={colors.textMuted}
              />
              <Text style={styles.emptyText}>No tickets</Text>
              <Text style={styles.emptySubtext}>
                {filter === 'active'
                  ? 'All clear — no active tickets right now'
                  : `No ${filter} tickets today`}
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => renderTicketCard(item)}
      />
    </View>
  );
}

// ── ActionBtn ────────────────────────────────────────────────────────

function ActionBtn({
  label,
  icon,
  color,
  onPress,
}: {
  label: string;
  icon: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.actionBtn, { borderColor: color }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Ionicons name={icon as any} size={14} color={color} />
      <Text style={[styles.actionBtnText, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── Styles ───────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },

  // Filters
  filters: {
    flexDirection: 'row',
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceSecondary,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
  },
  filterText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  filterTextActive: {
    color: '#fff',
  },

  // Stats bar
  statsBar: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.lg,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.text,
  },
  statLabel: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
  },

  // List
  list: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },

  // Empty state
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.xxl * 2,
  },
  emptyText: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.textMuted,
  },
  emptySubtext: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },

  // Parked / On Hold section
  parkedSection: {
    backgroundColor: colors.warningLight,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  parkedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  parkedTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.warning,
  },

  // Ticket card
  ticketCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  ticketCardParked: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.warning + '40',
  },
  ticketHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  ticketLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
  },
  ticketRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  ticketNumber: {
    fontSize: fontSize.xl,
    fontWeight: '800',
    color: colors.text,
  },
  priorityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
    backgroundColor: colors.warningLight,
  },
  priorityText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
  sourceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
    backgroundColor: colors.infoLight,
  },
  sourceBadgeBooked: {
    backgroundColor: colors.primaryLight + '15',
  },
  sourceBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.info,
  },
  waitTime: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textSecondary,
  },

  // Ticket meta
  ticketMeta: {
    gap: 2,
    paddingLeft: 22,
  },
  customerName: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
  },
  metaText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  deskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  deskText: {
    fontSize: fontSize.xs,
    color: colors.primary,
    fontWeight: '600',
  },

  // Action buttons
  ticketActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingLeft: 22,
    flexWrap: 'wrap',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  actionBtnText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
});
