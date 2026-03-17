import { useCallback, useMemo, useState } from 'react';
import {
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAppStore } from '@/lib/store';
import { useTheme, type ThemeColors, borderRadius, fontSize, spacing } from '@/lib/theme';

const STATUS_CONFIG: Record<string, { label: string; colorKey: string; icon: string }> = {
  served: { label: 'Served', colorKey: 'success', icon: 'checkmark-circle' },
  no_show: { label: 'Missed', colorKey: 'warning', icon: 'alert-circle' },
  cancelled: { label: 'Cancelled', colorKey: 'error', icon: 'close-circle' },
  waiting: { label: 'Waiting', colorKey: 'waiting', icon: 'time' },
  called: { label: 'Called', colorKey: 'called', icon: 'megaphone' },
  serving: { label: 'Serving', colorKey: 'serving', icon: 'pulse' },
};

function formatSectionDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();

  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round(
    (todayOnly.getTime() - dateOnly.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';

  return date.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

function groupByDate(
  history: Array<{ token: string; ticketNumber: string; officeName: string; serviceName: string; status: string; date: string }>
) {
  const groups: Record<string, typeof history> = {};

  for (const entry of history) {
    const d = new Date(entry.date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(entry);
  }

  return Object.entries(groups)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, data]) => ({
      title: formatSectionDate(data[0].date),
      data,
    }));
}

export default function HistoryScreen() {
  const router = useRouter();
  const { history } = useAppStore();
  const { colors, isDark } = useTheme();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 600);
  }, []);

  const sections = useMemo(() => groupByDate(history), [history]);

  const stats = useMemo(() => {
    const total = history.length;
    const served = history.filter((h) => h.status === 'served').length;
    const missed = history.filter((h) => h.status === 'no_show').length;
    return { total, served, missed };
  }, [history]);

  if (history.length === 0) {
    return (
      <View style={[styles.empty, { backgroundColor: colors.background }]}>
        <View style={[styles.emptyIconCircle, { backgroundColor: isDark ? 'rgba(59,130,246,0.12)' : colors.primaryLight + '15' }]}>
          <Ionicons name="time-outline" size={56} color={colors.primary} />
        </View>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>No visits yet</Text>
        <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
          Your queue history will appear here after your first visit
        </Text>
        <TouchableOpacity
          style={[styles.emptyButton, { backgroundColor: colors.primary }]}
          activeOpacity={0.7}
          onPress={() => router.push('/scan' as any)}
        >
          <Ionicons name="qr-code-outline" size={18} color="#fff" />
          <Text style={styles.emptyButtonText}>Scan to join</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <SectionList
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      sections={sections}
      keyExtractor={(item) => item.token}
      stickySectionHeadersEnabled={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
      ListHeaderComponent={
        <View style={[styles.summaryBar, { backgroundColor: colors.surface, shadowOpacity: isDark ? 0.2 : 0.04 }]}>
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryNumber, { color: colors.text }]}>{stats.total}</Text>
            <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>visits</Text>
          </View>
          <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryNumber, { color: colors.success }]}>
              {stats.served}
            </Text>
            <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>served</Text>
          </View>
          <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryNumber, { color: colors.warning }]}>
              {stats.missed}
            </Text>
            <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>missed</Text>
          </View>
        </View>
      }
      renderSectionHeader={({ section }) => (
        <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>{section.title}</Text>
      )}
      renderItem={({ item }) => {
        const config = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.served;
        const statusColor = (colors as any)[config.colorKey] ?? colors.success;
        const date = new Date(item.date);
        const timeStr = date.toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
        });

        return (
          <TouchableOpacity
            style={[styles.card, { backgroundColor: colors.surface, shadowOpacity: isDark ? 0.15 : 0.03 }]}
            activeOpacity={0.6}
            onPress={() => router.push(`/ticket/${item.token}`)}
          >
            <View style={styles.cardLeft}>
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
              <View style={styles.cardLeftText}>
                <Text style={[styles.ticketNumber, { color: colors.text }]}>{item.ticketNumber}</Text>
                <Text style={[styles.serviceName, { color: colors.textMuted }]} numberOfLines={1}>
                  {item.serviceName}
                </Text>
              </View>
            </View>

            <View style={styles.cardCenter}>
              <Text style={[styles.officeName, { color: colors.textSecondary }]} numberOfLines={1}>
                {item.officeName}
              </Text>
              <Text style={[styles.timeText, { color: colors.textMuted }]}>{timeStr}</Text>
            </View>

            <View style={styles.cardRight}>
              <View style={[styles.statusBadge, { backgroundColor: statusColor + '18' }]}>
                <Text style={[styles.statusText, { color: statusColor }]}>
                  {config.label}
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={16}
                color={colors.textMuted}
                style={styles.chevron}
              />
            </View>
          </TouchableOpacity>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  emptyIconCircle: {
    width: 112,
    height: 112,
    borderRadius: 56,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  emptyTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  emptySubtitle: {
    fontSize: fontSize.md,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 260,
    marginBottom: spacing.lg,
  },
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md - 2,
    borderRadius: borderRadius.full,
  },
  emptyButtonText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: '#fff',
  },
  summaryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 6,
    elevation: 1,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryNumber: {
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  summaryLabel: {
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  summaryDivider: {
    width: 1,
    height: 28,
  },
  sectionHeader: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    paddingLeft: spacing.xs,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 6,
    elevation: 1,
  },
  cardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  cardLeftText: {
    gap: 1,
  },
  ticketNumber: {
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  serviceName: {
    fontSize: fontSize.xs,
  },
  cardCenter: {
    flex: 1,
    alignItems: 'center',
    gap: 1,
  },
  officeName: {
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  timeText: {
    fontSize: fontSize.xs,
  },
  cardRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  statusText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  chevron: {
    marginLeft: 2,
  },
});
