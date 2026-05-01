import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useRiderAuth } from '@/lib/rider-auth';
import { C, F, R, SP, formatDate, formatTime } from '@/lib/rider-theme';

interface HistoryItem {
  id: string;
  ticket_number: string;
  status: 'served' | 'cancelled' | 'no_show' | string;
  dispatched_at: string | null;
  delivered_at: string | null;
  completed_at: string | null;
  delivery_address: { street?: string; city?: string } | null;
  customer_data: { name?: string; phone?: string } | null;
  pickup_name: string | null;
}

interface HistoryPage {
  ok: boolean;
  items: HistoryItem[];
  next_cursor: string | null;
  today_count: number;
  total_count: number;
}

/**
 * Paginated delivery history. Uses cursor pagination from the
 * /api/rider/history endpoint — pulls 25 at a time, infinite-scroll
 * via FlatList's onEndReached. Pull-to-refresh resets to head.
 */
export default function RiderHistoryScreen() {
  const router = useRouter();
  const { authedFetch } = useRiderAuth();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<{ today: number; total: number }>({ today: 0, total: 0 });

  const fetchPage = useCallback(async (mode: 'initial' | 'refresh' | 'more') => {
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    if (mode === 'more') setLoadingMore(true);
    setError(null);
    try {
      const isFresh = mode !== 'more';
      const params = new URLSearchParams();
      if (mode === 'more' && cursor) params.set('cursor', cursor);
      const r = await authedFetch(`/api/rider/history${params.toString() ? `?${params}` : ''}`);
      if (!r.ok) {
        setError('Could not load history.');
        return;
      }
      const data = (await r.json()) as HistoryPage;
      setItems((prev) => isFresh ? data.items : [...prev, ...data.items]);
      setCursor(data.next_cursor);
      setHasMore(Boolean(data.next_cursor));
      setCounts({ today: data.today_count, total: data.total_count });
    } catch {
      setError('Network error.');
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [cursor, authedFetch]);

  useEffect(() => { void fetchPage('initial'); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const onEndReached = () => {
    if (!loading && !loadingMore && hasMore) void fetchPage('more');
  };

  return (
    <View style={s.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.topbar}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.back}>
          <Ionicons name="chevron-back" size={22} color={C.text} />
        </Pressable>
        <Text style={s.title}>History</Text>
        <View style={{ width: 32 }} />
      </View>

      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        contentContainerStyle={s.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setCursor(null); setHasMore(true); void fetchPage('refresh'); }}
            tintColor={C.primary}
            colors={[C.primary]}
          />
        }
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
        ListHeaderComponent={
          <View style={s.statsRow}>
            <Stat label="Today" value={counts.today} />
            <Stat label="All time" value={counts.total} accent />
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <View style={{ paddingTop: SP.xxl }}>
              <ActivityIndicator color={C.primary} />
            </View>
          ) : (
            <Empty error={error} />
          )
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={{ paddingVertical: SP.lg }}>
              <ActivityIndicator color={C.primary} />
            </View>
          ) : null
        }
        renderItem={({ item }) => <Row item={item} />}
        ItemSeparatorComponent={() => <View style={{ height: SP.sm }} />}
      />
    </View>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <View style={[s.stat, accent && s.statAccent]}>
      <Text style={[s.statValue, accent && { color: '#fff' }]}>{value}</Text>
      <Text style={[s.statLabel, accent && { color: 'rgba(255,255,255,0.85)' }]}>{label}</Text>
    </View>
  );
}

function Row({ item }: { item: HistoryItem }) {
  const when = item.completed_at ?? item.delivered_at;
  const customer = item.customer_data?.name ?? 'Customer';
  const street = item.delivery_address?.street ?? '';
  const isCancelled = item.status === 'cancelled' || item.status === 'no_show';
  const stage = isCancelled
    ? { label: item.status === 'no_show' ? 'NO SHOW' : 'CANCELLED', tint: C.dangerTint, ink: C.danger, icon: 'close-circle' as const }
    : { label: 'DELIVERED', tint: C.successTint, ink: C.success, icon: 'checkmark-circle' as const };

  return (
    <View style={s.row}>
      <View style={[s.iconBubble, { backgroundColor: stage.tint }]}>
        <Ionicons name={stage.icon} size={22} color={stage.ink} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={s.rowTop}>
          <Text style={s.rowTicket}>#{item.ticket_number}</Text>
          <Text style={s.rowTime}>{formatTime(when)}</Text>
        </View>
        <Text style={s.rowCustomer} numberOfLines={1}>{customer}</Text>
        {street ? <Text style={s.rowAddr} numberOfLines={1}>{street}</Text> : null}
        <View style={s.rowBottom}>
          <Text style={[s.rowStage, { color: stage.ink }]}>{stage.label}</Text>
          <Text style={s.rowDate}>· {formatDate(when)}</Text>
        </View>
      </View>
    </View>
  );
}

function Empty({ error }: { error: string | null }) {
  return (
    <View style={s.empty}>
      <View style={s.emptyIcon}>
        <Ionicons name={error ? 'cloud-offline-outline' : 'time-outline'} size={36} color={C.textFaint} />
      </View>
      <Text style={s.emptyTitle}>{error ? "Couldn't load history" : 'No deliveries yet'}</Text>
      <Text style={s.emptyBody}>
        {error ?? 'Once you complete your first run it will show up here.'}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  topbar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SP.md, paddingTop: 56, paddingBottom: SP.md,
    backgroundColor: C.surface,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  back: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: F.lg, fontWeight: '700', color: C.text },

  listContent: { padding: SP.lg, paddingBottom: SP.xxl },

  statsRow: { flexDirection: 'row', gap: SP.sm, marginBottom: SP.lg },
  stat: {
    flex: 1, backgroundColor: C.surface,
    borderRadius: R.lg,
    paddingVertical: SP.md, paddingHorizontal: SP.md,
    borderWidth: 1, borderColor: C.border,
  },
  statAccent: { backgroundColor: C.primary, borderColor: C.primary },
  statValue: { fontSize: F.xxl, fontWeight: '800', color: C.text, marginBottom: 2 },
  statLabel: { fontSize: F.xs, fontWeight: '700', color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 },

  row: {
    flexDirection: 'row', gap: SP.md,
    backgroundColor: C.surface,
    padding: SP.md,
    borderRadius: R.lg,
    borderWidth: 1, borderColor: C.border,
  },
  iconBubble: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
  },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowTicket: { fontSize: F.md, fontWeight: '800', color: C.text },
  rowTime: { fontSize: F.sm, color: C.textFaint },
  rowCustomer: { fontSize: F.md, color: C.text, marginTop: 2 },
  rowAddr: { fontSize: F.sm, color: C.textMuted, marginTop: 2 },
  rowBottom: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  rowStage: { fontSize: F.xs, fontWeight: '800', letterSpacing: 0.5 },
  rowDate: { fontSize: F.xs, color: C.textFaint, marginLeft: 4 },

  empty: { alignItems: 'center', paddingTop: SP.xxl, paddingHorizontal: SP.xl },
  emptyIcon: {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: C.surface2,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: SP.md,
  },
  emptyTitle: { fontSize: F.lg, fontWeight: '700', color: C.text, marginBottom: 6 },
  emptyBody: { fontSize: F.md, color: C.textMuted, textAlign: 'center', lineHeight: 20 },
});
