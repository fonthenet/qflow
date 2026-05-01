import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useRiderAuth } from '@/lib/rider-auth';
import { RiderAvatar } from '@/components/RiderAvatar';
import { C, F, R, SP, timeAgo } from '@/lib/rider-theme';

interface ActiveDelivery {
  id: string;
  ticket_number: string;
  status: string;
  dispatched_at: string | null;
  arrived_at: string | null;
  delivery_address: { street?: string; city?: string } | null;
  customer_data: { name?: string; phone?: string } | null;
  notes: string | null;
  pickup: { name: string; address: string | null } | null;
  rider_token: string;
}

interface HistorySummary {
  today_count: number;
  total_count: number;
}

/**
 * Rider home — auth gate + dashboard. Logged out → push to login.
 * Logged in → pulls /api/rider/active and renders a tappable list.
 * Stats strip up top (today + lifetime delivered count). Tapping a
 * card deeplinks into the per-ticket screen via the existing HMAC
 * route, which handles GPS streaming + ARRIVED + DELIVERED.
 */
export default function RiderHomeScreen() {
  const router = useRouter();
  const { ready, rider, signOut, authedFetch } = useRiderAuth();
  const [items, setItems] = useState<ActiveDelivery[]>([]);
  const [summary, setSummary] = useState<HistorySummary>({ today_count: 0, total_count: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (ready && !rider) {
      router.replace('/rider/login' as any);
    }
  }, [ready, rider, router]);

  const load = useCallback(async (mode: 'initial' | 'refresh') => {
    if (!rider) return;
    if (mode === 'initial') setLoading(true); else setRefreshing(true);
    try {
      const [activeRes, historyRes] = await Promise.all([
        authedFetch('/api/rider/active'),
        authedFetch('/api/rider/history?limit=1'),
      ]);
      if (activeRes.ok) {
        const data = await activeRes.json();
        setItems(data?.items ?? []);
      }
      if (historyRes.ok) {
        const data = await historyRes.json();
        setSummary({
          today_count: data?.today_count ?? 0,
          total_count: data?.total_count ?? 0,
        });
      }
    } catch { /* offline — keep previous data */ }
    finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [rider, authedFetch]);

  // Refresh whenever the screen comes into focus — covers returning
  // from a delivery or from settings.
  useFocusEffect(useCallback(() => {
    if (rider) void load('initial');
  }, [rider, load]));

  if (!ready || !rider) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={C.primary} />
      </View>
    );
  }

  return (
    <View style={s.root}>
      <Stack.Screen options={{ headerShown: false }} />

      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        contentContainerStyle={s.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load('refresh')}
            tintColor={C.primary}
            colors={[C.primary]}
          />
        }
        ListHeaderComponent={
          <Header
            rider={rider}
            today={summary.today_count}
            total={summary.total_count}
            activeCount={items.length}
            onSettings={() => router.push('/rider/settings' as any)}
          />
        }
        ListEmptyComponent={
          loading ? (
            <View style={s.skeletonWrap}>
              <SkeletonCard />
              <SkeletonCard />
            </View>
          ) : (
            <EmptyState />
          )
        }
        renderItem={({ item }) => (
          <DeliveryCard
            item={item}
            onPress={() => router.push({
              pathname: '/rider/[id]/[token]' as any,
              params: { id: item.id, token: item.rider_token },
            })}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: SP.md }} />}
      />
    </View>
  );
}

// ─── Header ─────────────────────────────────────────────────────

function Header({ rider, today, total, activeCount, onSettings }: {
  rider: { name: string; phone: string; avatar_url: string | null };
  today: number;
  total: number;
  activeCount: number;
  onSettings: () => void;
}) {
  return (
    <View style={s.header}>
      <View style={s.headerTop}>
        <RiderAvatar name={rider.name} url={rider.avatar_url} size={56} />
        <View style={{ flex: 1, marginLeft: SP.md }}>
          <Text style={s.helloLabel}>Hi {rider.name.split(' ')[0]}</Text>
          <Text style={s.helloSub}>{rider.phone}</Text>
        </View>
        <Pressable
          onPress={onSettings}
          hitSlop={10}
          style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name="settings-outline" size={22} color={C.text} />
        </Pressable>
      </View>

      <View style={s.statsRow}>
        <Stat label="Active" value={activeCount} accent />
        <Stat label="Today" value={today} />
        <Stat label="All time" value={total} />
      </View>

      <Text style={s.sectionLabel}>Active deliveries</Text>
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

// ─── Delivery card ──────────────────────────────────────────────

function DeliveryCard({ item, onPress }: { item: ActiveDelivery; onPress: () => void }) {
  const customerName = item.customer_data?.name ?? 'Customer';
  const street = item.delivery_address?.street ?? '';
  const city = item.delivery_address?.city ?? '';
  const dispatched = item.dispatched_at
    ? `Started ${timeAgo(item.dispatched_at)}`
    : 'Awaiting your accept';
  const stage = item.arrived_at
    ? { label: 'AT DROP-OFF', tint: C.successTint, ink: C.success }
    : item.dispatched_at
      ? { label: 'EN ROUTE', tint: C.primaryTint, ink: C.primaryDark }
      : { label: 'NEW', tint: C.warnTint, ink: C.warn };

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.card, pressed && { transform: [{ scale: 0.99 }], opacity: 0.95 }]}
    >
      <View style={s.cardTop}>
        <View style={[s.stageChip, { backgroundColor: stage.tint }]}>
          <Text style={[s.stageText, { color: stage.ink }]}>{stage.label}</Text>
        </View>
        <Text style={s.ticketNo}>#{item.ticket_number}</Text>
      </View>

      <Text style={s.customerLine}>{customerName}</Text>
      {(street || city) ? (
        <View style={s.row}>
          <Ionicons name="location-outline" size={15} color={C.textMuted} />
          <Text style={s.addr} numberOfLines={1}>
            {[street, city].filter(Boolean).join(', ')}
          </Text>
        </View>
      ) : null}
      {item.pickup?.name ? (
        <View style={s.row}>
          <Ionicons name="storefront-outline" size={15} color={C.textMuted} />
          <Text style={s.pickupName} numberOfLines={1}>{item.pickup.name}</Text>
        </View>
      ) : null}
      {item.notes ? (
        <View style={[s.row, { alignItems: 'flex-start' }]}>
          <Ionicons name="document-text-outline" size={15} color={C.textMuted} />
          <Text style={s.note} numberOfLines={2}>{item.notes}</Text>
        </View>
      ) : null}

      <View style={s.cardFooter}>
        <Text style={s.cardFooterText}>{dispatched}</Text>
        <View style={s.openCta}>
          <Text style={s.openCtaText}>Open</Text>
          <Ionicons name="arrow-forward" size={15} color={C.primary} />
        </View>
      </View>
    </Pressable>
  );
}

// ─── Empty + skeleton ──────────────────────────────────────────

function EmptyState() {
  return (
    <View style={s.empty}>
      <View style={s.emptyIcon}>
        <Ionicons name="bicycle" size={40} color={C.primary} />
      </View>
      <Text style={s.emptyTitle}>You're all caught up</Text>
      <Text style={s.emptyBody}>
        New assignments will appear here and ping your phone — even when
        the screen is locked.
      </Text>
    </View>
  );
}

function SkeletonCard() {
  return (
    <View style={[s.card, { opacity: 0.6 }]}>
      <View style={[s.skelLine, { width: 80, height: 18, marginBottom: SP.md }]} />
      <View style={[s.skelLine, { width: '70%', height: 14 }]} />
      <View style={[s.skelLine, { width: '60%', height: 12, marginTop: 8 }]} />
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  listContent: { paddingHorizontal: SP.lg, paddingBottom: SP.xxl },

  header: { paddingTop: 56, paddingBottom: SP.lg },
  headerTop: { flexDirection: 'row', alignItems: 'center' },
  helloLabel: { fontSize: F.xxl, fontWeight: '800', color: C.text },
  helloSub: { fontSize: F.base, color: C.textMuted, marginTop: 2 },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: C.surface,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.border,
  },

  statsRow: {
    flexDirection: 'row', gap: SP.sm,
    marginTop: SP.lg,
  },
  stat: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: R.lg,
    paddingVertical: SP.md, paddingHorizontal: SP.md,
    borderWidth: 1, borderColor: C.border,
  },
  statAccent: { backgroundColor: C.primary, borderColor: C.primary },
  statValue: { fontSize: F.xxl, fontWeight: '800', color: C.text, marginBottom: 2 },
  statLabel: { fontSize: F.xs, fontWeight: '700', color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 },

  sectionLabel: {
    fontSize: F.sm, fontWeight: '700', color: C.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.6,
    marginTop: SP.xl, marginBottom: SP.md,
  },

  card: {
    backgroundColor: C.surface,
    borderRadius: R.lg,
    padding: SP.lg,
    borderWidth: 1, borderColor: C.border,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.md },
  stageChip: { paddingHorizontal: SP.md, paddingVertical: 4, borderRadius: R.full },
  stageText: { fontSize: F.xs, fontWeight: '800', letterSpacing: 0.4 },
  ticketNo: { fontSize: F.md, fontWeight: '700', color: C.text },
  customerLine: { fontSize: F.lg, fontWeight: '700', color: C.text, marginBottom: SP.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  addr: { flex: 1, fontSize: F.md, color: C.textMuted },
  pickupName: { flex: 1, fontSize: F.md, color: C.textMuted },
  note: { flex: 1, fontSize: F.base, color: C.textMuted, fontStyle: 'italic', lineHeight: 18 },
  cardFooter: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: SP.md, paddingTop: SP.md,
    borderTopWidth: 1, borderTopColor: C.border,
  },
  cardFooterText: { fontSize: F.sm, color: C.textFaint, fontWeight: '600' },
  openCta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  openCtaText: { fontSize: F.md, color: C.primary, fontWeight: '700' },

  empty: {
    alignItems: 'center', paddingTop: SP.xxl + SP.lg, paddingHorizontal: SP.xl,
  },
  emptyIcon: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: C.primaryTint,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: SP.lg,
  },
  emptyTitle: { fontSize: F.xl, fontWeight: '800', color: C.text, marginBottom: 6 },
  emptyBody: { fontSize: F.md, color: C.textMuted, textAlign: 'center', lineHeight: 20 },

  skeletonWrap: { gap: SP.md },
  skelLine: { backgroundColor: C.surface2, borderRadius: 4 },
});
