import { useState } from 'react';
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
import * as Haptics from 'expo-haptics';
import { useRealtimeQueue, useNameLookup, QueueTicket } from '@/lib/use-realtime-queue';
import { useOrg } from '@/lib/use-org';
import { useOperatorStore } from '@/lib/operator-store';
import * as Actions from '@/lib/ticket-actions';
import { colors, borderRadius, fontSize, spacing } from '@/lib/theme';

type FilterTab = 'waiting' | 'called' | 'serving' | 'parked' | 'all';

const TABS: { key: FilterTab; label: string; icon: keyof typeof Ionicons.glyphMap; color: string }[] = [
  { key: 'waiting', label: 'Waiting', icon: 'time-outline', color: colors.waiting },
  { key: 'called', label: 'Called', icon: 'megaphone-outline', color: colors.called },
  { key: 'serving', label: 'Serving', icon: 'hand-left-outline', color: colors.serving },
  { key: 'parked', label: 'Parked', icon: 'pause-circle-outline', color: colors.warning },
  { key: 'all', label: 'All', icon: 'list-outline', color: colors.textSecondary },
];

function getStatusColor(status: string): string {
  switch (status) {
    case 'waiting': return colors.waiting;
    case 'called': return colors.called;
    case 'serving': return colors.serving;
    case 'served': return colors.success;
    case 'no_show': return colors.warning;
    case 'cancelled': return colors.error;
    default: return colors.textMuted;
  }
}

function getStatusBg(status: string): string {
  switch (status) {
    case 'waiting': return colors.waitingBg;
    case 'called': return colors.calledBg;
    case 'serving': return colors.servingBg;
    case 'served': return colors.successLight;
    case 'no_show': return colors.warningLight;
    case 'cancelled': return colors.errorLight;
    default: return colors.surfaceSecondary;
  }
}

function getSourceIcon(source: string | null): { name: keyof typeof Ionicons.glyphMap; color: string } {
  switch (source) {
    case 'whatsapp': return { name: 'logo-whatsapp', color: '#25D366' };
    case 'messenger': return { name: 'chatbubble-ellipses', color: '#0084FF' };
    case 'kiosk': return { name: 'tablet-portrait-outline', color: '#8B5CF6' };
    case 'qr_code': return { name: 'qr-code-outline', color: '#F59E0B' };
    case 'walk_in': return { name: 'walk-outline', color: '#64748B' };
    case 'in_house': return { name: 'business-outline', color: '#6366F1' };
    default: return { name: 'globe-outline', color: colors.textMuted };
  }
}

function getSourceLabel(source: string | null): string {
  switch (source) {
    case 'whatsapp': return 'WhatsApp';
    case 'messenger': return 'Messenger';
    case 'kiosk': return 'Kiosk';
    case 'qr_code': return 'QR Code';
    case 'walk_in': return 'Walk-in';
    case 'in_house': return 'In-house';
    default: return 'Web';
  }
}

function getWaitTime(createdAt: string): string {
  const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export default function QueueScreen() {
  const { session } = useOperatorStore();
  const { orgId, officeIds } = useOrg();
  const officeId = session?.officeId ?? null;
  const { queue, loading, refresh } = useRealtimeQueue({ officeId });
  const names = useNameLookup(orgId, officeIds);
  const [activeTab, setActiveTab] = useState<FilterTab>('waiting');
  const [refreshing, setRefreshing] = useState(false);

  const filtered = (() => {
    switch (activeTab) {
      case 'waiting': return queue.waiting;
      case 'called': return queue.called;
      case 'serving': return queue.serving;
      case 'parked': return queue.parked;
      case 'all': return [...queue.waiting, ...queue.called, ...queue.serving, ...queue.parked];
    }
  })();

  const counts: Record<FilterTab, number> = {
    waiting: queue.waiting.length,
    called: queue.called.length,
    serving: queue.serving.length,
    parked: queue.parked.length,
    all: queue.waiting.length + queue.called.length + queue.serving.length + queue.parked.length,
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

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
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            refresh();
          } catch (err: any) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            Alert.alert('Error', err.message ?? 'Action failed');
          }
        },
      },
    ]);
  };

  const handleCallToDesk = (t: QueueTicket) => {
    if (!session?.deskId || !session?.staffId) {
      Alert.alert('No Desk', 'You must be logged into a desk to call tickets.');
      return;
    }
    confirmAction('Call to Desk', `Call ${t.ticket_number} to your desk?`, () =>
      Actions.callSpecificTicket(t.id, session.deskId!, session.staffId),
    );
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

  const handleResume = (t: QueueTicket) => {
    confirmAction('Resume', `Resume ticket ${t.ticket_number}?`, () =>
      Actions.unparkTicket(t.id),
    );
  };

  const handleRequeue = (t: QueueTicket) => {
    confirmAction('Back to Queue', `Send ${t.ticket_number} back to waiting?`, () =>
      Actions.resetToQueue(t.id),
    );
  };

  // ── Render ───────────────────────────────────────────────────────

  const renderTicket = ({ item, index }: { item: QueueTicket; index: number }) => {
    const customerName = item.customer_data?.name || 'Walk-in';
    const serviceName = item.service_id ? names.services[item.service_id] : null;
    const deskName = item.desk_id ? names.desks[item.desk_id] : null;
    const deptName = item.department_id ? names.departments[item.department_id] : null;
    const priority = item.priority_category_id ? names.priorities[item.priority_category_id] : null;
    const source = getSourceIcon(item.source);
    const statusColor = getStatusColor(item.status);
    const statusBg = getStatusBg(item.status);
    const isParked = item.parked_at != null;
    const isTerminal = ['served', 'no_show', 'cancelled'].includes(item.status);

    return (
      <View style={styles.ticketCard}>
        {/* Top row: position + ticket number + status badge */}
        <View style={styles.ticketTopRow}>
          <View style={styles.ticketLeftGroup}>
            {activeTab === 'waiting' && (
              <View style={styles.positionCircle}>
                <Text style={styles.positionText}>{index + 1}</Text>
              </View>
            )}
            <Text style={styles.ticketNumber}>{item.ticket_number}</Text>
            {priority && (
              <View style={[styles.priorityBadge, { backgroundColor: (priority.color ?? colors.warning) + '20' }]}>
                <Ionicons name="flag" size={10} color={priority.color ?? colors.warning} />
                <Text style={[styles.priorityText, { color: priority.color ?? colors.warning }]}>{priority.name}</Text>
              </View>
            )}
            {item.parked_at && (
              <View style={styles.parkedBadge}>
                <Ionicons name="pause-circle" size={10} color={colors.warning} />
                <Text style={styles.parkedBadgeText}>HOLD</Text>
              </View>
            )}
          </View>
          <View style={[styles.statusChip, { backgroundColor: statusBg }]}>
            <View style={[styles.statusDotSmall, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusChipText, { color: statusColor }]}>
              {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
            </Text>
          </View>
        </View>

        {/* Middle: customer name + meta */}
        <View style={styles.ticketMiddle}>
          <View style={styles.customerRow}>
            <Ionicons name="person-outline" size={14} color={colors.textSecondary} />
            <Text style={styles.customerName} numberOfLines={1}>{customerName}</Text>
          </View>
          {(serviceName || deptName) && (
            <Text style={styles.ticketMeta} numberOfLines={1}>
              {[serviceName, deptName].filter(Boolean).join(' \u00B7 ')}
            </Text>
          )}
        </View>

        {/* Bottom row: source + desk + wait time */}
        <View style={styles.ticketBottomRow}>
          <View style={styles.sourceChip}>
            <Ionicons name={source.name} size={13} color={source.color} />
            <Text style={[styles.sourceText, { color: source.color }]}>{getSourceLabel(item.source)}</Text>
          </View>
          {deskName && (
            <View style={styles.deskChip}>
              <Ionicons name="desktop-outline" size={12} color={colors.textSecondary} />
              <Text style={styles.deskChipText}>{deskName}</Text>
            </View>
          )}
          <View style={{ flex: 1 }} />
          <View style={styles.waitChip}>
            <Ionicons name="time-outline" size={12} color={colors.textMuted} />
            <Text style={styles.waitTime}>{getWaitTime(item.created_at)}</Text>
          </View>
        </View>

        {/* Action buttons */}
        {!isTerminal && (
          <View style={styles.actionsRow}>
            {isParked ? (
              <ActionBtn label="Resume" icon="play-circle-outline" color={colors.primary} onPress={() => handleResume(item)} />
            ) : (
              <>
                {item.status === 'waiting' && (
                  <>
                    <ActionBtn label="Call to Desk" icon="megaphone-outline" color={colors.called} onPress={() => handleCallToDesk(item)} />
                    <ActionBtn label="Park" icon="pause-outline" color={colors.textSecondary} onPress={() => handlePark(item)} />
                    <ActionBtn label="Cancel" icon="close-circle-outline" color={colors.error} onPress={() => handleCancel(item)} />
                  </>
                )}
                {item.status === 'called' && (
                  <>
                    <ActionBtn label="Serve" icon="play-outline" color={colors.serving} onPress={() => handleServe(item)} />
                    <ActionBtn label="No Show" icon="alert-circle-outline" color={colors.warning} onPress={() => handleNoShow(item)} />
                    <ActionBtn label="Park" icon="pause-outline" color={colors.textSecondary} onPress={() => handlePark(item)} />
                    <ActionBtn label="Requeue" icon="arrow-undo-outline" color={colors.info} onPress={() => handleRequeue(item)} />
                  </>
                )}
                {item.status === 'serving' && (
                  <>
                    <ActionBtn label="Complete" icon="checkmark-circle-outline" color={colors.success} onPress={() => handleComplete(item)} />
                    <ActionBtn label="No Show" icon="alert-circle-outline" color={colors.warning} onPress={() => handleNoShow(item)} />
                    <ActionBtn label="Park" icon="pause-outline" color={colors.textSecondary} onPress={() => handlePark(item)} />
                  </>
                )}
              </>
            )}
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Summary bar */}
      <View style={styles.summaryBar}>
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryCount, { color: colors.waiting }]}>{counts.waiting}</Text>
          <Text style={styles.summaryLabel}>Waiting</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryCount, { color: colors.called }]}>{counts.called}</Text>
          <Text style={styles.summaryLabel}>Called</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryCount, { color: colors.serving }]}>{counts.serving}</Text>
          <Text style={styles.summaryLabel}>Serving</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryCount, { color: colors.warning }]}>{counts.parked}</Text>
          <Text style={styles.summaryLabel}>On Hold</Text>
        </View>
      </View>

      {/* Filter Tabs -- pill style */}
      <View style={styles.tabsContainer}>
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[
                styles.tabPill,
                isActive && { backgroundColor: tab.color + '18', borderColor: tab.color + '40' },
              ]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Ionicons name={tab.icon} size={14} color={isActive ? tab.color : colors.textMuted} />
              <Text style={[
                styles.tabPillText,
                isActive && { color: tab.color, fontWeight: '700' },
              ]}>
                {tab.label}
              </Text>
              <View style={[
                styles.tabCountBadge,
                isActive && { backgroundColor: tab.color },
              ]}>
                <Text style={[
                  styles.tabCountText,
                  isActive && { color: '#fff' },
                ]}>
                  {counts[tab.key]}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIconCircle}>
              <Ionicons name="checkmark-done" size={32} color={colors.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>
              {loading ? 'Loading...' : 'All clear'}
            </Text>
            <Text style={styles.emptyText}>
              {loading ? '' : `No ${activeTab !== 'all' ? activeTab : ''} tickets right now`}
            </Text>
          </View>
        }
        renderItem={renderTicket}
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
      <Ionicons name={icon as any} size={13} color={color} />
      <Text style={[styles.actionBtnText, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  // Summary bar
  summaryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  summaryCount: {
    fontSize: fontSize.xl,
    fontWeight: '800',
  },
  summaryLabel: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.textMuted,
  },
  summaryDivider: {
    width: 1,
    height: 28,
    backgroundColor: colors.border,
  },

  // Pill tabs
  tabsContainer: {
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tabPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: colors.surfaceSecondary,
  },
  tabPillText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
  },
  tabCountBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.border,
    paddingHorizontal: 4,
  },
  tabCountText: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.textMuted,
  },

  // List
  list: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.sm,
    paddingBottom: spacing.xxl,
  },

  // Empty state
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.xxl + spacing.xl,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surfaceSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  emptyTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.text,
  },
  emptyText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },

  // Ticket card
  ticketCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    gap: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  ticketTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ticketLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  positionCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primaryLight + '18',
    alignItems: 'center',
    justifyContent: 'center',
  },
  positionText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.primary,
  },
  ticketNumber: {
    fontSize: fontSize.lg,
    fontWeight: '800',
    color: colors.text,
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
  },
  statusDotSmall: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusChipText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
  },

  // Customer info
  ticketMiddle: {
    gap: 3,
  },
  customerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  customerName: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
  },
  ticketMeta: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginLeft: spacing.xs + 14, // align with name after icon
  },

  // Bottom row
  ticketBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  sourceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceSecondary,
  },
  sourceText: {
    fontSize: 10,
    fontWeight: '700',
  },
  deskChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceSecondary,
  },
  deskChipText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  waitChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  waitTime: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.textMuted,
    fontVariant: ['tabular-nums'] as any,
  },

  // Priority + parked badges
  priorityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  priorityText: { fontSize: 9, fontWeight: '700' },
  parkedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.warningLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  parkedBadgeText: { fontSize: 9, fontWeight: '700', color: colors.warning },

  // Action buttons
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    flexWrap: 'wrap',
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
});
