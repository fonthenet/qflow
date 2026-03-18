import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fetchQueueStatus, type QueueStatusResponse } from '@/lib/api';
import { useTheme, borderRadius, fontSize, spacing } from '@/lib/theme';

const REFRESH_INTERVAL_MS = 15_000;

export default function QueuePeekScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const [status, setStatus] = useState<QueueStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!slug) return;
      if (!silent) setLoading(true);
      const data = await fetchQueueStatus(slug);
      setStatus(data);
      setLastUpdated(new Date());
      setLoading(false);
      setRefreshing(false);
    },
    [slug]
  );

  useEffect(() => {
    load();
    intervalRef.current = setInterval(() => load(true), REFRESH_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load(true);
  };

  const handleJoinDept = (deptId: string) => {
    router.push(`/kiosk/${slug}?deptId=${deptId}` as any);
  };

  const handleJoinAny = () => {
    router.push(`/kiosk/${slug}` as any);
  };

  // ---- Loading ----
  if (loading) {
    return (
      <View style={[s.center, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[s.loadingText, { color: colors.textSecondary }]}>Loading queue status...</Text>
      </View>
    );
  }

  // ---- Error ----
  if (!status) {
    return (
      <View style={[s.center, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <View style={[s.iconCircle, { backgroundColor: colors.error + '15' }]}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
        </View>
        <Text style={[s.errorTitle, { color: colors.text }]}>Queue Unavailable</Text>
        <Text style={[s.errorSub, { color: colors.textSecondary }]}>
          This business could not be found or its queue is currently offline.
        </Text>
        <TouchableOpacity
          style={[s.outlineBtn, { borderColor: colors.border }]}
          onPress={() => router.back()}
        >
          <Text style={[s.outlineBtnText, { color: colors.textSecondary }]}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const updatedStr = lastUpdated
    ? lastUpdated.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : null;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[s.content, { paddingTop: insets.top + spacing.md }]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
    >
      {/* Back */}
      <TouchableOpacity style={s.backRow} onPress={() => router.back()} activeOpacity={0.7}>
        <Ionicons name="arrow-back" size={20} color={colors.primary} />
        <Text style={[s.backText, { color: colors.primary }]}>Back</Text>
      </TouchableOpacity>

      {/* Header */}
      <View style={s.header}>
        <View
          style={[
            s.headerIcon,
            { backgroundColor: isDark ? 'rgba(59,130,246,0.12)' : colors.infoLight },
          ]}
        >
          <Ionicons name="business-outline" size={28} color={colors.primary} />
        </View>
        <Text style={[s.officeName, { color: colors.text }]}>{status.office.name}</Text>
        {status.office.address && (
          <Text style={[s.officeAddress, { color: colors.textSecondary }]} numberOfLines={1}>
            <Ionicons name="location-outline" size={12} color={colors.textMuted} />{' '}
            {status.office.address}
          </Text>
        )}
      </View>

      {/* Summary */}
      <View style={s.summaryRow}>
        <View
          style={[s.summaryCard, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}
        >
          <Text style={[s.summaryValue, { color: colors.primary }]}>{status.totalWaiting}</Text>
          <Text style={[s.summaryLabel, { color: colors.textSecondary }]}>Waiting</Text>
        </View>
        <View
          style={[s.summaryCard, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}
        >
          <Text style={[s.summaryValue, { color: colors.success }]}>{status.totalServing}</Text>
          <Text style={[s.summaryLabel, { color: colors.textSecondary }]}>Being Served</Text>
        </View>
      </View>

      {/* Queues */}
      <Text style={[s.sectionTitle, { color: colors.text }]}>Available Queues</Text>
      <Text style={[s.sectionSub, { color: colors.textSecondary }]}>
        Pull down to refresh · auto-updates every 15s
      </Text>

      {status.departments.map((dept) => {
        const hasWait = dept.estimatedWaitMinutes > 0;
        const isBusy = dept.waiting >= 5;
        const statusColor = dept.waiting === 0 ? colors.success : isBusy ? colors.warning : colors.primary;

        return (
          <View
            key={dept.id}
            style={[s.deptCard, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}
          >
            {/* Dept info */}
            <View style={s.deptTop}>
              <View style={[s.deptIconBox, { backgroundColor: statusColor + '15' }]}>
                <Ionicons name="people-outline" size={22} color={statusColor} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.deptName, { color: colors.text }]}>{dept.name}</Text>
                <View style={s.deptMeta}>
                  <View style={[s.statusDot, { backgroundColor: dept.waiting === 0 ? colors.success : colors.warning }]} />
                  <Text style={[s.deptMetaText, { color: colors.textSecondary }]}>
                    {dept.waiting === 0
                      ? 'No wait'
                      : `${dept.waiting} waiting${hasWait ? ` · ~${dept.estimatedWaitMinutes} min` : ''}`}
                  </Text>
                  {dept.serving > 0 && (
                    <Text style={[s.servingBadge, { color: colors.success }]}>
                      {dept.serving} serving
                    </Text>
                  )}
                </View>
              </View>

              {/* Join button */}
              <TouchableOpacity
                style={[s.joinDeptBtn, { backgroundColor: colors.primary }]}
                onPress={() => handleJoinDept(dept.id)}
                activeOpacity={0.8}
              >
                <Text style={s.joinDeptBtnText}>Join</Text>
                <Ionicons name="arrow-forward" size={14} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
        );
      })}

      {/* Last updated */}
      {updatedStr && (
        <View style={s.updatedRow}>
          <Ionicons name="refresh-outline" size={12} color={colors.textMuted} />
          <Text style={[s.updatedText, { color: colors.textMuted }]}>Updated {updatedStr}</Text>
        </View>
      )}

      {/* CTA row */}
      <TouchableOpacity
        style={[s.joinAnyBtn, { backgroundColor: colors.primary }]}
        onPress={handleJoinAny}
        activeOpacity={0.8}
      >
        <Ionicons name="ticket-outline" size={20} color="#fff" />
        <Text style={s.joinAnyBtnText}>Get a Ticket Now</Text>
      </TouchableOpacity>

      {status?.bookingMode !== 'disabled' && (
        <TouchableOpacity
          style={[s.bookLaterBtn, { borderColor: colors.border }]}
          onPress={() => router.push(`/book-appointment/${slug}` as any)}
          activeOpacity={0.8}
        >
          <Ionicons name="calendar-outline" size={18} color={colors.primary} />
          <Text style={[s.bookLaterBtnText, { color: colors.primary }]}>Book for Later</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  loadingText: {
    fontSize: fontSize.md,
    marginTop: spacing.sm,
  },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  errorTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  errorSub: {
    fontSize: fontSize.md,
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 22,
  },
  outlineBtn: {
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.lg,
    borderWidth: 1.5,
  },
  outlineBtnText: {
    fontSize: fontSize.md,
    fontWeight: '600',
  },

  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.md,
  },
  backText: {
    fontSize: fontSize.md,
    fontWeight: '600',
  },

  header: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  headerIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  officeName: {
    fontSize: fontSize.xl,
    fontWeight: '800',
    textAlign: 'center',
  },
  officeAddress: {
    fontSize: fontSize.sm,
    marginTop: 4,
  },

  summaryRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  summaryCard: {
    flex: 1,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    padding: spacing.md,
    alignItems: 'center',
  },
  summaryValue: {
    fontSize: 36,
    fontWeight: '900',
    lineHeight: 40,
  },
  summaryLabel: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  sectionTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
    marginBottom: 2,
  },
  sectionSub: {
    fontSize: fontSize.xs,
    marginBottom: spacing.md,
  },

  deptCard: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  deptTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  deptIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deptName: {
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  deptMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  deptMetaText: {
    fontSize: fontSize.sm,
  },
  servingBadge: {
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  joinDeptBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: borderRadius.full,
  },
  joinDeptBtnText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: '#fff',
  },

  updatedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    justifyContent: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  updatedText: {
    fontSize: fontSize.xs,
  },

  joinAnyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md + 2,
    borderRadius: borderRadius.lg,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  joinAnyBtnText: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: '#fff',
  },

  bookLaterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1.5,
    marginTop: spacing.sm,
  },
  bookLaterBtnText: {
    fontSize: fontSize.md,
    fontWeight: '600',
  },
});
