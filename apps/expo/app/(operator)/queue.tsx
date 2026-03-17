import { useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRealtimeQueue, useNameLookup, QueueTicket } from '@/lib/use-realtime-queue';
import { useOrg } from '@/lib/use-org';
import { useOperatorStore } from '@/lib/operator-store';
import { colors, borderRadius, fontSize, spacing } from '@/lib/theme';

type FilterTab = 'waiting' | 'called' | 'serving' | 'parked' | 'all';

const TABS: { key: FilterTab; label: string; color: string }[] = [
  { key: 'waiting', label: 'Waiting', color: colors.waiting },
  { key: 'called', label: 'Called', color: colors.called },
  { key: 'serving', label: 'Serving', color: colors.serving },
  { key: 'parked', label: 'Parked', color: colors.warning },
  { key: 'all', label: 'All', color: colors.textSecondary },
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

  const renderTicket = ({ item }: { item: QueueTicket }) => {
    const customerName = item.customer_data?.name || 'Walk-in';
    const serviceName = item.service_id ? names.services[item.service_id] : null;
    const deskName = item.desk_id ? names.desks[item.desk_id] : null;
    const deptName = item.department_id ? names.departments[item.department_id] : null;
    const priority = item.priority_category_id ? names.priorities[item.priority_category_id] : null;

    return (
      <View style={styles.ticketRow}>
        <View style={[styles.statusDot, { backgroundColor: getStatusColor(item.status) }]} />
        <View style={styles.ticketInfo}>
          <View style={styles.ticketHeader}>
            <Text style={styles.ticketNumber}>{item.ticket_number}</Text>
            {item.parked_at && (
              <View style={styles.parkedBadge}>
                <Text style={styles.parkedBadgeText}>PARKED</Text>
              </View>
            )}
            {priority && (
              <View style={[styles.priorityBadge, { backgroundColor: (priority.color ?? colors.warning) + '20' }]}>
                <Ionicons name="flag" size={10} color={priority.color ?? colors.warning} />
                <Text style={[styles.priorityText, { color: priority.color ?? colors.warning }]}>{priority.name}</Text>
              </View>
            )}
          </View>
          <Text style={styles.ticketMeta}>
            {customerName}
            {serviceName ? ` · ${serviceName}` : ''}
            {deptName ? ` · ${deptName}` : ''}
          </Text>
        </View>
        <View style={styles.ticketRight}>
          <Text style={styles.waitTime}>{getWaitTime(item.created_at)}</Text>
          {deskName && <Text style={styles.deskLabel}>{deskName}</Text>}
          {item.is_remote && (
            <Ionicons name="phone-portrait-outline" size={14} color={colors.primary} />
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Filter Tabs */}
      <View style={styles.tabs}>
        {TABS.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && { borderBottomColor: tab.color }]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text style={[
              styles.tabText,
              activeTab === tab.key && { color: tab.color, fontWeight: '700' },
            ]}>
              {tab.label}
            </Text>
            <Text style={[
              styles.tabCount,
              activeTab === tab.key && { color: tab.color },
            ]}>
              {counts[tab.key]}
            </Text>
          </TouchableOpacity>
        ))}
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
            <Ionicons name="checkmark-done" size={48} color={colors.textMuted} />
            <Text style={styles.emptyText}>
              {loading ? 'Loading...' : `No ${activeTab !== 'all' ? activeTab : ''} tickets`}
            </Text>
          </View>
        }
        renderItem={renderTicket}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
    gap: 2,
  },
  tabText: { fontSize: fontSize.xs, fontWeight: '600', color: colors.textMuted },
  tabCount: { fontSize: fontSize.lg, fontWeight: '800', color: colors.textMuted },
  list: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.sm,
    paddingBottom: spacing.xl,
  },
  empty: {
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.xxl,
  },
  emptyText: { fontSize: fontSize.md, color: colors.textMuted },
  ticketRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    gap: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  ticketInfo: { flex: 1, gap: 4 },
  ticketHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  ticketNumber: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  ticketMeta: { fontSize: fontSize.sm, color: colors.textSecondary },
  ticketRight: { alignItems: 'flex-end', gap: 4 },
  waitTime: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textSecondary },
  deskLabel: { fontSize: fontSize.xs, color: colors.textMuted },
  parkedBadge: {
    backgroundColor: colors.warningLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  parkedBadgeText: { fontSize: 9, fontWeight: '700', color: colors.warning },
  priorityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  priorityText: { fontSize: 9, fontWeight: '700' },
});
