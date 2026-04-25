/**
 * Kitchen Display System (KDS) screen — restaurant / café only.
 *
 * Shows every active ticket that has un-served food as a card in a
 * responsive grid. Cooks tap items to advance them new → in_progress →
 * ready, or use "Mark all ready" to bump the whole ticket. When every
 * item on a card is ready the primary action flips to "Mark all served"
 * which clears the card from the KDS (and stamps each item served).
 *
 * Realtime: subscribes to ticket_items + tickets so any change made on
 * the desk (server adds a new course, marks served, etc.) flows in
 * within ~200 ms. We also poll every 8 s as a belt-and-braces fallback
 * for poor-connection scenarios — KDS being stale is much worse than
 * a few extra fetches.
 *
 * Layout:
 *   - Phones: single column.
 *   - Tablets / wide screens: 2-column grid (>= 700 px) or 3-column
 *     (>= 1100 px). Restaurants typically wall-mount a 24" tablet, so
 *     the grid is the main use case.
 *
 * Filters: top tab to scope by status — All / New / Preparing / Ready.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import {
  fetchKitchenTickets,
  updateItemKitchenStatus,
  bumpTicketKitchen,
  type KitchenTicket,
} from '@/lib/data-adapter';
import { useOrg } from '@/lib/use-org';
import { useBusinessCategory } from '@/lib/use-business-category';
import { useLocalConnectionStore } from '@/lib/local-connection-store';
import { supabase } from '@/lib/supabase';
import { borderRadius, fontSize, spacing, useTheme } from '@/lib/theme';
import { KitchenTicketCard } from '@/components/KitchenTicketCard';
import type { TicketItem } from '@qflo/shared';

type FilterMode = 'all' | 'new' | 'in_progress' | 'ready';

export default function KitchenScreen() {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors, isDark);
  const { orgId } = useOrg();
  const { isRestaurantVertical, loading: catLoading } = useBusinessCategory(orgId);
  const localMode = useLocalConnectionStore((s) => s.mode);
  const isLocal = localMode === 'local';

  const [cards, setCards] = useState<KitchenTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<FilterMode>('all');

  // Track item IDs from the previous fetch to detect newly-added lines —
  // those get a brief pulse on the card so cooks notice mid-meal additions.
  const prevItemIdsRef = useRef<Set<string>>(new Set());
  const [newItemIds, setNewItemIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!orgId) {
      setCards([]);
      setLoading(false);
      return;
    }
    try {
      const data = await fetchKitchenTickets(orgId);
      // Diff item IDs to surface new lines.
      const newIds = new Set<string>();
      const allIds = new Set<string>();
      for (const c of data) {
        for (const it of c.items) {
          allIds.add(it.id);
          if (!prevItemIdsRef.current.has(it.id) && prevItemIdsRef.current.size > 0) {
            newIds.add(it.id);
          }
        }
      }
      prevItemIdsRef.current = allIds;
      setNewItemIds(newIds);
      setCards(data);
    } catch (e) {
      console.warn('[kitchen] fetch failed', e);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  // Initial load + 8s poll fallback
  useEffect(() => {
    load();
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, [load]);

  // Realtime subscription — fires on any ticket_items / tickets change
  // for this org. Throttled via a 250ms debounce so a bulk update doesn't
  // hammer load() in a tight loop.
  useEffect(() => {
    if (!orgId || isLocal) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debouncedLoad = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(load, 250);
    };
    const channel = supabase
      .channel(`kds-${orgId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'ticket_items', filter: `organization_id=eq.${orgId}` },
        debouncedLoad,
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'tickets', filter: `organization_id=eq.${orgId}` },
        debouncedLoad,
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [orgId, isLocal, load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // Cycle a single item: new → in_progress → ready → in_progress (un-bump).
  const handleItemAdvance = useCallback(async (item: TicketItem) => {
    Haptics.selectionAsync().catch(() => {});
    const cur = item.kitchen_status ?? 'new';
    const next: 'new' | 'in_progress' | 'ready' =
      cur === 'new' ? 'in_progress'
        : cur === 'in_progress' ? 'ready'
        : 'in_progress'; // tap-on-ready = un-bump (mistake recovery)
    // Optimistic update — flip the local state immediately so the cook
    // sees instant feedback even on flaky kitchen wifi.
    setCards((prev) => prev.map((c) => ({
      ...c,
      items: c.items.map((it) =>
        it.id === item.id ? { ...it, kitchen_status: next, kitchen_status_at: new Date().toISOString() } : it,
      ),
    })));
    try {
      await updateItemKitchenStatus(item.id, next);
    } catch (e) {
      console.warn('[kitchen] item advance failed', e);
      // Realtime/poll will reconcile.
      load();
    }
  }, [load]);

  const handleBumpAllReady = useCallback(async (card: KitchenTicket) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setBusy(true);
    setCards((prev) => prev.map((c) =>
      c.ticket_id === card.ticket_id
        ? { ...c, items: c.items.map((it) => ({ ...it, kitchen_status: 'ready' as const })) }
        : c,
    ));
    try {
      await bumpTicketKitchen(card.ticket_id, 'ready');
    } catch (e) {
      console.warn('[kitchen] bump-all failed', e);
      load();
    } finally {
      setBusy(false);
    }
  }, [load]);

  const handleMarkAllServed = useCallback(async (card: KitchenTicket) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setBusy(true);
    // Optimistic remove — card disappears from KDS immediately.
    setCards((prev) => prev.filter((c) => c.ticket_id !== card.ticket_id));
    try {
      await bumpTicketKitchen(card.ticket_id, 'served');
    } catch (e) {
      console.warn('[kitchen] mark-served failed', e);
      load();
    } finally {
      setBusy(false);
    }
  }, [load]);

  // Apply the active filter.
  const visibleCards = useMemo(() => {
    if (filter === 'all') return cards;
    return cards
      .map((c) => ({ ...c, items: c.items.filter((it) => (it.kitchen_status ?? 'new') === filter) }))
      .filter((c) => c.items.length > 0);
  }, [cards, filter]);

  // Counts per filter so the tab bar shows live numbers — cooks can see
  // at a glance how many tickets are stuck at "new".
  const counts = useMemo(() => {
    const c = { new: 0, in_progress: 0, ready: 0 };
    for (const card of cards) {
      for (const it of card.items) {
        const s = (it.kitchen_status ?? 'new') as keyof typeof c;
        if (s in c) c[s]++;
      }
    }
    return c;
  }, [cards]);

  // Responsive column count
  const { width } = useWindowDimensions();
  const cols = width >= 1100 ? 3 : width >= 700 ? 2 : 1;

  // ── Render guards ────────────────────────────────────────────────
  if (catLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }
  if (!isRestaurantVertical) {
    return (
      <View style={styles.center}>
        <Ionicons name="restaurant-outline" size={48} color={colors.textMuted} />
        <Text style={styles.emptyTitle}>
          {t('kitchen.notAvailable', { defaultValue: 'Kitchen Display' })}
        </Text>
        <Text style={styles.emptyText}>
          {t('kitchen.restaurantOnly', {
            defaultValue: 'The Kitchen Display is available for restaurants and cafés only.',
          })}
        </Text>
      </View>
    );
  }
  if (isLocal) {
    return (
      <View style={styles.center}>
        <Ionicons name="cloud-offline-outline" size={48} color={colors.textMuted} />
        <Text style={styles.emptyTitle}>
          {t('kitchen.cloudOnlyTitle', { defaultValue: 'Cloud mode required' })}
        </Text>
        <Text style={styles.emptyText}>
          {t('kitchen.cloudOnlyMsg', {
            defaultValue: 'The Kitchen Display syncs through the cloud. Switch off local mode to use it.',
          })}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* Filter tabs */}
      <View style={styles.filterRow}>
        <FilterTab label={t('kitchen.filterAll', { defaultValue: 'All' })}
          active={filter === 'all'} onPress={() => setFilter('all')} />
        <FilterTab label={t('kitchen.filterNew', { defaultValue: 'New' })} count={counts.new}
          active={filter === 'new'} accent={colors.textSecondary} onPress={() => setFilter('new')} />
        <FilterTab label={t('kitchen.filterCooking', { defaultValue: 'Preparing' })} count={counts.in_progress}
          active={filter === 'in_progress'} accent={colors.warning} onPress={() => setFilter('in_progress')} />
        <FilterTab label={t('kitchen.filterReady', { defaultValue: 'Ready' })} count={counts.ready}
          active={filter === 'ready'} accent={colors.success} onPress={() => setFilter('ready')} />
      </View>

      <ScrollView
        contentContainerStyle={styles.gridWrap}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : visibleCards.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="checkmark-done-circle" size={56} color={colors.success} />
            <Text style={styles.emptyTitle}>
              {t('kitchen.allClear', { defaultValue: 'All caught up' })}
            </Text>
            <Text style={styles.emptyText}>
              {t('kitchen.noOrders', { defaultValue: 'No active orders right now.' })}
            </Text>
          </View>
        ) : (
          <View style={[styles.grid, { gap: spacing.md }]}>
            {visibleCards.map((card) => (
              <View
                key={card.ticket_id}
                style={[
                  styles.gridCell,
                  { width: cols === 1 ? '100%' : `${100 / cols}%` },
                ]}
              >
                <KitchenTicketCard
                  card={card}
                  newItemIds={newItemIds}
                  onItemAdvance={handleItemAdvance}
                  onBumpAllReady={handleBumpAllReady}
                  onMarkAllServed={handleMarkAllServed}
                  busy={busy}
                />
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function FilterTab({
  label,
  count,
  active,
  accent,
  onPress,
}: {
  label: string;
  count?: number;
  active: boolean;
  accent?: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const tint = accent ?? colors.primary;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        ftStyles.tab,
        {
          backgroundColor: active ? tint + '22' : colors.surface,
          borderColor: active ? tint : colors.border,
        },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[ftStyles.label, { color: active ? tint : colors.text, fontWeight: active ? '800' : '600' }]}>
        {label}
      </Text>
      {typeof count === 'number' && count > 0 ? (
        <View style={[ftStyles.countPill, { backgroundColor: tint }]}>
          <Text style={ftStyles.countText}>{count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const ftStyles = StyleSheet.create({
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  label: { fontSize: fontSize.sm },
  countPill: {
    minWidth: 20, height: 20, borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: 'center', justifyContent: 'center',
  },
  countText: { color: '#fff', fontSize: 11, fontWeight: '900' },
});

const makeStyles = (colors: ReturnType<typeof useTheme>['colors'], _isDark: boolean) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    filterRow: {
      flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface,
    },
    gridWrap: { padding: spacing.md, paddingBottom: spacing.xl },
    grid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start' },
    gridCell: { paddingHorizontal: spacing.xs, paddingBottom: spacing.md },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl, minHeight: 320 },
    emptyTitle: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text, marginTop: spacing.sm },
    emptyText: { fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center', maxWidth: 320 },
  });
