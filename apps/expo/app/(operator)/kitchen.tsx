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
import { resolveRestaurantServiceType, type RestaurantServiceType } from '@qflo/shared';

type FilterMode = 'all' | 'new' | 'in_progress' | 'ready';
type ServiceFilter = 'all' | RestaurantServiceType;

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
  const [serviceFilter, setServiceFilter] = useState<ServiceFilter>('all');

  // Sort + Group controls — parity with desktop + web KDS.
  type KdsSortMode = 'time-asc' | 'time-desc' | 'status' | 'table' | 'items';
  type KdsGroupMode = 'none' | 'status' | 'table';
  const KDS_SORT_KEYS: KdsSortMode[] = ['time-asc', 'time-desc', 'status', 'table', 'items'];
  const KDS_GROUP_KEYS: KdsGroupMode[] = ['none', 'status', 'table'];
  const [sortMode, setSortMode] = useState<KdsSortMode>('time-asc');
  const [groupMode, setGroupMode] = useState<KdsGroupMode>('none');
  // Hydrate sort/group prefs from AsyncStorage on mount.
  useEffect(() => {
    (async () => {
      try {
        const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
        const s = await AsyncStorage.getItem('qflo.kds.sort');
        if (s && (KDS_SORT_KEYS as string[]).includes(s)) setSortMode(s as KdsSortMode);
        const g = await AsyncStorage.getItem('qflo.kds.group');
        if (g && (KDS_GROUP_KEYS as string[]).includes(g)) setGroupMode(g as KdsGroupMode);
      } catch {}
    })();
  }, []);
  const cycleSort = useCallback(async () => {
    const i = KDS_SORT_KEYS.indexOf(sortMode);
    const next = KDS_SORT_KEYS[(i + 1) % KDS_SORT_KEYS.length];
    setSortMode(next);
    try {
      const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
      await AsyncStorage.setItem('qflo.kds.sort', next);
    } catch {}
  }, [sortMode]);
  const cycleGroup = useCallback(async () => {
    const i = KDS_GROUP_KEYS.indexOf(groupMode);
    const next = KDS_GROUP_KEYS[(i + 1) % KDS_GROUP_KEYS.length];
    setGroupMode(next);
    try {
      const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
      await AsyncStorage.setItem('qflo.kds.group', next);
    } catch {}
  }, [groupMode]);

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
    // ticket_items has organization_id (we filter directly). tickets
    // does NOT — it's keyed by office_id — so we listen unfiltered for
    // ticket UPDATEs and let the poll + items sub handle correctness.
    // restaurant_tables drives the card's table label (joined in
    // fetchKitchenTickets via current_ticket_id); without an unfiltered
    // sub here, moving a ticket to another table or releasing one would
    // not refresh the KDS until the 8 s poll fired.
    const channel = supabase
      .channel(`kds-${orgId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'ticket_items', filter: `organization_id=eq.${orgId}` },
        debouncedLoad,
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'tickets' },
        debouncedLoad,
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'restaurant_tables' },
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

  // Apply both filters — status filter and service-type filter combine.
  // A card with no service_name is treated as 'other' and only visible
  // when serviceFilter is 'all'.
  const visibleCards = useMemo(() => {
    let filtered = cards;
    // 1. Service-type filter
    if (serviceFilter !== 'all') {
      filtered = filtered.filter((c) => {
        const t = resolveRestaurantServiceType(c.service_name);
        return t === serviceFilter;
      });
    }
    // 2. Status filter (same logic as before)
    if (filter !== 'all') {
      filtered = filtered
        .map((c) => ({ ...c, items: c.items.filter((it) => (it.kitchen_status ?? 'new') === filter) }))
        .filter((c) => c.items.length > 0);
    }
    return filtered;
  }, [cards, filter, serviceFilter]);

  // Sort + group — applied after filters so the order matches what's on screen.
  const aggregateOf = useCallback((items: TicketItem[]): 'ready' | 'preparing' | 'mixed' | 'new' | 'none' => {
    if (items.length === 0) return 'none';
    const active = items.filter((i) => (i.kitchen_status ?? 'new') !== 'served');
    if (active.length === 0) return 'ready';
    const set = new Set(active.map((i) => i.kitchen_status ?? 'new'));
    if (set.size === 1) {
      const s = [...set][0];
      if (s === 'new') return 'new';
      if (s === 'in_progress') return 'preparing';
      if (s === 'ready') return 'ready';
    }
    return 'mixed';
  }, []);
  const sortedCards = useMemo(() => {
    const arr = [...visibleCards];
    const byTimeAsc = (a: KitchenTicket, b: KitchenTicket) =>
      new Date(a.oldest_item_at).getTime() - new Date(b.oldest_item_at).getTime();
    if (sortMode === 'time-asc') arr.sort(byTimeAsc);
    else if (sortMode === 'time-desc') arr.sort((a, b) => -byTimeAsc(a, b));
    else if (sortMode === 'status') {
      const order: Record<string, number> = { ready: 0, preparing: 1, mixed: 2, new: 3, none: 4 };
      arr.sort((a, b) => (order[aggregateOf(a.items)] ?? 99) - (order[aggregateOf(b.items)] ?? 99) || byTimeAsc(a, b));
    } else if (sortMode === 'table') {
      arr.sort((a, b) => {
        const la = (a.table_label ?? a.ticket_number ?? '').toLowerCase();
        const lb = (b.table_label ?? b.ticket_number ?? '').toLowerCase();
        return la.localeCompare(lb, undefined, { numeric: true }) || byTimeAsc(a, b);
      });
    } else if (sortMode === 'items') {
      arr.sort((a, b) => b.items.reduce((s, i) => s + i.qty, 0) - a.items.reduce((s, i) => s + i.qty, 0) || byTimeAsc(a, b));
    }
    return arr;
  }, [visibleCards, sortMode, aggregateOf]);

  const groupedCards = useMemo(() => {
    if (groupMode === 'none') return [{ key: 'all', label: '', items: sortedCards }];
    const map = new Map<string, { key: string; label: string; items: KitchenTicket[]; order: number }>();
    for (const card of sortedCards) {
      let key = 'other'; let label = ''; let order = 99;
      if (groupMode === 'status') {
        const ag = aggregateOf(card.items);
        key = ag;
        label = ag === 'ready' ? t('kitchen.statusReady', { defaultValue: 'Ready' })
          : ag === 'preparing' ? t('kitchen.statusCooking', { defaultValue: 'Preparing' })
          : ag === 'new' ? t('kitchen.statusNew', { defaultValue: 'New' })
          : ag === 'mixed' ? t('kitchen.statusCooking', { defaultValue: 'Preparing' })
          : '';
        order = ag === 'ready' ? 0 : ag === 'preparing' ? 1 : ag === 'mixed' ? 2 : ag === 'new' ? 3 : 4;
      } else if (groupMode === 'table') {
        if (card.table_label) {
          key = card.table_label; label = card.table_label; order = 0;
        } else {
          key = '__no_table__'; label = '#'; order = 1000;
        }
      }
      if (!map.has(key)) map.set(key, { key, label, items: [], order });
      map.get(key)!.items.push(card);
    }
    return Array.from(map.values()).sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  }, [sortedCards, groupMode, aggregateOf, t]);

  const sortLabel = (m: KdsSortMode): string =>
    m === 'time-asc' ? t('kitchen.sortOldest', { defaultValue: 'Oldest' })
    : m === 'time-desc' ? t('kitchen.sortNewest', { defaultValue: 'Newest' })
    : m === 'status' ? t('kitchen.sortStatus', { defaultValue: 'Status' })
    : m === 'table' ? t('kitchen.sortTable', { defaultValue: 'Table / #' })
    : t('kitchen.sortItems', { defaultValue: 'Items' });
  const groupLabel = (m: KdsGroupMode): string =>
    m === 'none' ? t('kitchen.groupNone', { defaultValue: 'No grouping' })
    : m === 'status' ? t('kitchen.groupStatus', { defaultValue: 'By Status' })
    : t('kitchen.groupTable', { defaultValue: 'By Table' });

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

  // Column count: auto-responsive by default, user can override 1↔2
  // via a small toolbar toggle. Phones default to 1, tablets to 2/3.
  // The override sticks via AsyncStorage so the cook's preferred density
  // survives reloads.
  const { width } = useWindowDimensions();
  const autoCols = width >= 1100 ? 3 : width >= 700 ? 2 : 1;
  const [colsOverride, setColsOverride] = useState<1 | 2 | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
        const v = await AsyncStorage.getItem('qflo.kitchen.cols');
        if (v === '1' || v === '2') setColsOverride(Number(v) as 1 | 2);
      } catch {}
    })();
  }, []);
  const setColsPref = useCallback(async (n: 1 | 2) => {
    setColsOverride(n);
    try {
      const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
      await AsyncStorage.setItem('qflo.kitchen.cols', String(n));
    } catch {}
  }, []);
  // Clamp by the actual number of cards on screen so 3 visible cards
  // never get squeezed into a narrow third when the layout could give
  // each card ~half or full width. Override (1↔2) still wins if set.
  const baseCols = colsOverride ?? autoCols;
  const cols = Math.max(1, Math.min(baseCols, visibleCards.length || 1));

  // Load + persist the service-type filter. Mirrors the cols pref pattern.
  useEffect(() => {
    (async () => {
      try {
        const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
        const v = await AsyncStorage.getItem('qflo.kitchen.service-filter');
        const valid: ServiceFilter[] = ['all', 'takeout', 'delivery', 'dine_in', 'other'];
        if (v && valid.includes(v as ServiceFilter)) setServiceFilter(v as ServiceFilter);
      } catch {}
    })();
  }, []);

  const setServiceFilterPref = useCallback(async (f: ServiceFilter) => {
    setServiceFilter(f);
    try {
      const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
      await AsyncStorage.setItem('qflo.kitchen.service-filter', f);
    } catch {}
  }, []);

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
      {/* Status filter tabs */}
      <View style={styles.filterRow}>
        <FilterTab label={t('kitchen.filterAll', { defaultValue: 'All' })}
          active={filter === 'all'} onPress={() => setFilter('all')} />
        <FilterTab label={t('kitchen.filterNew', { defaultValue: 'New' })} count={counts.new}
          active={filter === 'new'} accent={colors.textSecondary} onPress={() => setFilter('new')} />
        <FilterTab label={t('kitchen.filterCooking', { defaultValue: 'Preparing' })} count={counts.in_progress}
          active={filter === 'in_progress'} accent={colors.warning} onPress={() => setFilter('in_progress')} />
        <FilterTab label={t('kitchen.filterReady', { defaultValue: 'Ready' })} count={counts.ready}
          active={filter === 'ready'} accent={colors.success} onPress={() => setFilter('ready')} />
        {/* Column-density toggle. Pinned to the trailing edge so the
            filter chips keep priority. Single-row on phones, two-up
            for cooks who want to scan more cards at once. */}
        <View style={{ marginLeft: 'auto', flexDirection: 'row', gap: 4 }}>
          <Pressable
            onPress={() => setColsPref(1)}
            style={({ pressed }) => [
              ftStyles.tab,
              {
                paddingHorizontal: 10,
                backgroundColor: cols === 1 ? colors.primary + '22' : colors.surface,
                borderColor: cols === 1 ? colors.primary : colors.border,
              },
              pressed && { opacity: 0.7 },
            ]}
            accessibilityLabel={t('kitchen.cols1', { defaultValue: '1 column' })}
          >
            <Ionicons name="square-outline" size={16} color={cols === 1 ? colors.primary : colors.text} />
          </Pressable>
          <Pressable
            onPress={() => setColsPref(2)}
            style={({ pressed }) => [
              ftStyles.tab,
              {
                paddingHorizontal: 10,
                backgroundColor: cols === 2 ? colors.primary + '22' : colors.surface,
                borderColor: cols === 2 ? colors.primary : colors.border,
              },
              pressed && { opacity: 0.7 },
            ]}
            accessibilityLabel={t('kitchen.cols2', { defaultValue: '2 columns' })}
          >
            <Ionicons name="grid-outline" size={16} color={cols === 2 ? colors.primary : colors.text} />
          </Pressable>
        </View>
      </View>

      {/* Service-type secondary filter — All / Dine-in / Takeout / Delivery.
          Combines with the status filter above. Persisted to AsyncStorage. */}
      <View style={[styles.filterRow, styles.serviceFilterRow]}>
        <FilterTab
          label={t('kitchen.serviceAll', { defaultValue: 'All types' })}
          active={serviceFilter === 'all'}
          onPress={() => setServiceFilterPref('all')}
        />
        <FilterTab
          label={t('service.dineIn', { defaultValue: 'Dine-in' })}
          active={serviceFilter === 'dine_in'}
          accent="#22c55e"
          onPress={() => setServiceFilterPref('dine_in')}
        />
        <FilterTab
          label={t('service.takeout', { defaultValue: 'Takeout' })}
          active={serviceFilter === 'takeout'}
          accent="#f59e0b"
          onPress={() => setServiceFilterPref('takeout')}
        />
        <FilterTab
          label={t('service.delivery', { defaultValue: 'Delivery' })}
          active={serviceFilter === 'delivery'}
          accent="#8b5cf6"
          onPress={() => setServiceFilterPref('delivery')}
        />
        {/* Sort + Group cycling buttons (parity with desktop + web KDS).
            Pinned to the trailing edge so they don't crowd the filter chips. */}
        <View style={{ marginLeft: 'auto', flexDirection: 'row', gap: 6 }}>
          <Pressable
            onPress={cycleSort}
            accessibilityLabel={t('kitchen.sortByLabel', { defaultValue: 'Sort' })}
            style={({ pressed }) => [
              ftStyles.tab,
              {
                backgroundColor: sortMode === 'time-asc' ? colors.surface : colors.primary + '14',
                borderColor: colors.border,
              },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={[ftStyles.label, { color: colors.text, fontWeight: '700' }]}>
              {'↕ '}{sortLabel(sortMode)}
            </Text>
          </Pressable>
          <Pressable
            onPress={cycleGroup}
            accessibilityLabel={t('kitchen.groupByLabel', { defaultValue: 'Group' })}
            style={({ pressed }) => [
              ftStyles.tab,
              {
                backgroundColor: groupMode === 'none' ? colors.surface : colors.primary + '14',
                borderColor: colors.border,
              },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={[ftStyles.label, { color: colors.text, fontWeight: '700' }]}>
              {'📑 '}{groupLabel(groupMode)}
            </Text>
          </Pressable>
        </View>
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
          <View>
            {groupedCards.map((group) => (
              <View key={`group-${group.key}`}>
                {!!group.label && (
                  <View style={{
                    paddingHorizontal: spacing.sm,
                    paddingTop: spacing.sm, paddingBottom: 4,
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: colors.border,
                    marginTop: spacing.xs,
                  }}>
                    <Text style={{
                      fontSize: fontSize.xs, fontWeight: '800',
                      color: colors.textMuted,
                      textTransform: 'uppercase', letterSpacing: 1,
                    }}>
                      {group.label} <Text style={{ opacity: 0.6, fontWeight: '600' }}>· {group.items.length}</Text>
                    </Text>
                  </View>
                )}
                <View style={styles.grid}>
                  {group.items.map((card) => (
                    <View
                      key={card.ticket_id}
                      style={[
                        styles.gridCell,
                        { width: `${100 / cols}%` },
                      ]}
                    >
                      <KitchenTicketCard
                        card={card}
                        newItemIds={newItemIds}
                        onItemAdvance={handleItemAdvance}
                        onBumpAllReady={handleBumpAllReady}
                        onMarkAllServed={handleMarkAllServed}
                        compact={cols >= 2 && width < 700}
                        busy={busy}
                      />
                    </View>
                  ))}
                </View>
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
    serviceFilterRow: {
      paddingVertical: 6,
    },
    gridWrap: { padding: spacing.md, paddingBottom: spacing.xl },
    grid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start' },
    gridCell: { paddingHorizontal: spacing.xs, paddingBottom: spacing.md },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl, minHeight: 320 },
    emptyTitle: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text, marginTop: spacing.sm },
    emptyText: { fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center', maxWidth: 320 },
  });
