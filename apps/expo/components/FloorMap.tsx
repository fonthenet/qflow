/**
 * FloorMap — simplified restaurant/cafe table floor plan for the operator desk.
 *
 * Renders a pressable grid of tables. Each table can be:
 *   - free       (no active ticket linked to it)
 *   - occupied   (a ticket in 'called' or 'serving' status is linked)
 *   - on_hold    (parked ticket)
 *
 * Tables are fetched from `restaurant_tables` if that table exists, or
 * synthesised as T-01…T-NN from the queue length (fallback for orgs that
 * haven't set up their floor plan yet).
 *
 * Tapping an occupied table opens the active ticket actions.
 * Tapping a free table allows the operator to seat the next waiting customer.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { fetchRestaurantTables } from '@/lib/data-adapter';
import { supabase } from '@/lib/supabase';
import { useLocalConnectionStore } from '@/lib/local-connection-store';
import { colors, borderRadius, fontSize, spacing } from '@/lib/theme';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TableRow {
  id: string;
  label: string;
  seats: number;
  /** Set when restaurant_tables.current_ticket_id is non-null. The
   *  source of truth for "is this table occupied" — used in addition
   *  to ticket.table_label cross-matching. */
  currentTicketId?: string | null;
  /** Optional row-level status — 'on_hold' / 'reserved' surface as
   *  on-hold visuals when no current ticket is attached. */
  status?: string | null;
}

interface TicketRef {
  id: string;
  ticket_number: string;
  status: string;
  table_label?: string | null;
  customer_data?: { name?: string; phone?: string; party_size?: number | string } | null;
  parked_at?: string | null;
  called_at?: string | null;
  serving_started_at?: string | null;
}

interface FloorMapProps {
  officeId: string | null;
  /** Waiting tickets — used to count pressure */
  waitingCount: number;
  /** Currently called/serving tickets (to show which tables are occupied) */
  activeTickets: TicketRef[];
  /** Parked tickets */
  parkedTickets: TicketRef[];
  /** Set of active ticket IDs that already have one or more `ticket_items`
   *  rows — surfaces a small "food" badge on the table so operators can
   *  spot which seated parties have already started ordering. */
  ticketsWithItems?: Set<string>;
  /** Compact mode: no seat counts, smaller cards — used when active ticket panel is shown alongside */
  compact?: boolean;
  /**
   * Called when operator taps an occupied / on-hold table. Receives the
   * ticket (when known) and the full table row so the caller can open
   * an action sheet keyed off both — e.g. "Move", "Release table" need
   * the table id; "Mark served", "Recall" need the ticket id.
   */
  onSelectOccupied?: (ticket: TicketRef | null, table: TableRow) => void;
  /** Called when operator taps a free table to seat a customer */
  onSeatNext?: (tableLabel: string) => void;
  /** Bump this counter from the parent to force an immediate reload of
   *  the table list (e.g. right after a seat / release action) so the
   *  cell flips state without waiting for the next 4s poll cycle. */
  refreshKey?: number;
}

function formatElapsedShort(since: string | null | undefined): string {
  if (!since) return '';
  const ms = Date.now() - new Date(since).getTime();
  if (Number.isNaN(ms) || ms < 0) return '';
  const m = Math.floor(ms / 60000);
  if (m < 1) return '<1m';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60 ? `${m % 60}m` : ''}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildFallbackTables(count: number): TableRow[] {
  const n = Math.max(count, 6);
  return Array.from({ length: n }, (_, i) => ({
    id: `t-${i + 1}`,
    label: `T-${String(i + 1).padStart(2, '0')}`,
    seats: 4,
  }));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FloorMap({
  officeId,
  waitingCount,
  activeTickets,
  parkedTickets,
  ticketsWithItems,
  compact = false,
  onSelectOccupied,
  onSeatNext,
  refreshKey,
}: FloorMapProps) {
  const { t } = useTranslation();
  const [tables, setTables] = useState<TableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const isLocal = useLocalConnectionStore(
    (s) => s.mode === 'local' && !!s.stationUrl && !!s.stationSession,
  );

  const load = useCallback(async () => {
    if (!officeId) {
      setTables(buildFallbackTables(waitingCount + activeTickets.length + 4));
      setLoading(false);
      return;
    }
    try {
      const data = await fetchRestaurantTables(officeId);
      if (data && data.length > 0) {
        const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
        const mapped: TableRow[] = (data as any[])
          .map((r) => ({
            id: String(r.id),
            label: r.label || r.code || '',
            seats: typeof r.capacity === 'number' ? r.capacity : 4,
            currentTicketId: r.current_ticket_id ?? null,
            status: r.status ?? null,
          }))
          .sort((a, b) => collator.compare(a.label, b.label));
        setTables(mapped);
      } else {
        const total = Math.max(waitingCount + activeTickets.length + 4, 8);
        setTables(buildFallbackTables(total));
      }
    } catch {
      setTables(buildFallbackTables(8));
    }
    setLoading(false);
  }, [officeId, waitingCount, activeTickets.length]);

  useEffect(() => { load(); }, [load]);

  // Re-fetch tables whenever the set of active ticket IDs changes — a
  // newly seated ticket bumps `restaurant_tables.current_ticket_id`
  // which we need to read to flip a free cell to occupied. Realtime
  // catches this in cloud mode, but there's a race window between
  // `seatPartyAtTable` completing and the realtime event arriving;
  // this effect closes that gap so the cell flips immediately.
  const activeTicketIdsKey = activeTickets.map((t) => t.id).sort().join(',');
  useEffect(() => {
    if (!officeId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTicketIdsKey]);

  // Parent-driven refresh: bump `refreshKey` after a seat / release action
  // to force-reload the table rows immediately rather than waiting on poll.
  useEffect(() => {
    if (!officeId || refreshKey === undefined) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // Realtime: refresh when restaurant_tables changes (cloud mode only —
  // local mode polls via the parent's adaptive queue refresh cadence).
  useEffect(() => {
    if (!officeId || isLocal) return;
    const channel = supabase
      .channel(`floormap-${officeId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'restaurant_tables', filter: `office_id=eq.${officeId}` },
        () => { load(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [officeId, isLocal, load]);

  // Local mode: re-poll every 4s while the floor map is mounted so seats
  // refresh promptly without realtime.
  useEffect(() => {
    if (!officeId || !isLocal) return;
    const id = setInterval(() => { load(); }, 4000);
    return () => clearInterval(id);
  }, [officeId, isLocal, load]);

  const getTableState = useCallback(
    (table: TableRow): { state: 'free' | 'occupied' | 'on_hold'; ticket: TicketRef | null } => {
      // Primary source of truth: restaurant_tables.current_ticket_id.
      // If a ticket is attached to the row, look it up in activeTickets
      // (so we can show its number) and treat as occupied. Without a
      // matching ticket the row is still occupied — just unknown.
      if (table.currentTicketId) {
        const matched = activeTickets.find((t) => t.id === table.currentTicketId)
          ?? parkedTickets.find((t) => t.id === table.currentTicketId)
          ?? null;
        return { state: 'occupied', ticket: matched };
      }

      // Fallback: legacy table_label match for orgs that don't use
      // restaurant_tables.current_ticket_id (synthesised tables, etc).
      const active = activeTickets.find(
        (t) => t.table_label === table.label || t.table_label === table.id,
      );
      if (active) return { state: 'occupied', ticket: active };

      const parked = parkedTickets.find(
        (t) => t.table_label === table.label || t.table_label === table.id,
      );
      if (parked) return { state: 'on_hold', ticket: parked };

      // Row-level status hold (reserved without an attached ticket)
      const s = (table.status ?? '').toLowerCase();
      if (s === 'on_hold' || s === 'reserved') return { state: 'on_hold', ticket: null };

      return { state: 'free', ticket: null };
    },
    [activeTickets, parkedTickets],
  );

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  }

  const cardSize = compact ? styles.cardCompact : styles.card;
  const numSize = compact ? styles.tableNumCompact : styles.tableNum;

  // Floor stats — counts of free / occupied / on-hold cells, plus waiting.
  // Computed before render so the strip can sit above the grid.
  const stats = tables.reduce(
    (acc, tb) => {
      const { state } = getTableState(tb);
      acc[state] += 1;
      return acc;
    },
    { free: 0, occupied: 0, on_hold: 0 } as Record<'free' | 'occupied' | 'on_hold', number>,
  );

  return (
    <ScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
      {/* Stats strip: free / occupied / on-hold + waiting pressure */}
      <View style={styles.statsStrip}>
        <View style={[styles.statChip, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.statDot, { backgroundColor: colors.textMuted }]} />
          <Text style={styles.statNum}>{stats.free}</Text>
          <Text style={styles.statLabel}>{t('floorMap.free')}</Text>
        </View>
        <View style={[styles.statChip, { backgroundColor: colors.servingBg, borderColor: colors.serving + '55' }]}>
          <View style={[styles.statDot, { backgroundColor: colors.serving }]} />
          <Text style={[styles.statNum, { color: colors.serving }]}>{stats.occupied}</Text>
          <Text style={[styles.statLabel, { color: colors.serving }]}>{t('floorMap.occupied')}</Text>
        </View>
        {stats.on_hold > 0 && (
          <View style={[styles.statChip, { backgroundColor: colors.warningLight, borderColor: colors.warning + '55' }]}>
            <View style={[styles.statDot, { backgroundColor: colors.warning }]} />
            <Text style={[styles.statNum, { color: colors.warning }]}>{stats.on_hold}</Text>
            <Text style={[styles.statLabel, { color: colors.warning }]}>{t('floorMap.onHold')}</Text>
          </View>
        )}
        {waitingCount > 0 && (
          <View style={[styles.statChip, { backgroundColor: colors.primary + '12', borderColor: colors.primary + '55' }]}>
            <Ionicons name="people-outline" size={13} color={colors.primary} />
            <Text style={[styles.statNum, { color: colors.primary }]}>{waitingCount}</Text>
            <Text style={[styles.statLabel, { color: colors.primary }]}>{t('desk.waiting')}</Text>
          </View>
        )}
      </View>

      <View style={styles.gridInner}>
        {tables.map((table) => {
          const { state, ticket } = getTableState(table);

          const bgColor =
            state === 'occupied'
              ? colors.servingBg
              : state === 'on_hold'
              ? colors.warningLight
              : colors.surface;

          const borderColor =
            state === 'occupied'
              ? colors.serving
              : state === 'on_hold'
              ? colors.warning
              : colors.border;

          const stateIcon =
            state === 'occupied'
              ? 'person'
              : state === 'on_hold'
              ? 'pause-circle'
              : 'add-circle-outline';

          const stateColor =
            state === 'occupied'
              ? colors.serving
              : state === 'on_hold'
              ? colors.warning
              : colors.textMuted;

          // Elapsed indicator: serving uses started_at, called uses called_at,
          // parked uses parked_at. Lets the operator spot stale seats without
          // opening the action sheet.
          const elapsedSrc = ticket
            ? ticket.status === 'serving'
              ? ticket.serving_started_at
              : ticket.status === 'called'
                ? ticket.called_at
                : ticket.parked_at
            : null;
          const elapsedTxt = formatElapsedShort(elapsedSrc);
          const partyRaw = ticket?.customer_data?.party_size;
          const partyN =
            partyRaw == null
              ? null
              : typeof partyRaw === 'number'
                ? partyRaw
                : (() => {
                    const n = parseInt(String(partyRaw), 10);
                    return Number.isFinite(n) ? n : null;
                  })();
          const customerName = ticket?.customer_data?.name?.trim() || '';

          return (
            <Pressable
              key={table.id}
              style={[cardSize, { backgroundColor: bgColor, borderColor }]}
              onPress={() => {
                if (state === 'occupied' || state === 'on_hold') {
                  onSelectOccupied?.(ticket ?? null, table);
                } else {
                  onSeatNext?.(table.label);
                }
              }}
              android_ripple={{ color: colors.primary + '20' }}
            >
              {/* Top row: table label + status icon (larger in non-compact) */}
              <View style={styles.cardHeaderRow}>
                <Text style={numSize} numberOfLines={1}>{table.label}</Text>
                <Ionicons name={stateIcon as any} size={compact ? 14 : 22} color={stateColor} />
              </View>

              {!compact && state === 'free' && (
                <View style={styles.cardMetaItem}>
                  <Ionicons name="people-outline" size={13} color={colors.textMuted} />
                  <Text style={styles.seats}>
                    {table.seats} {t('floorMap.seats')}
                  </Text>
                </View>
              )}

              {/* Occupied/on-hold body: ticket # + name + party + elapsed */}
              {ticket && (
                <>
                  <View style={styles.ticketRow}>
                    <Text style={[styles.ticketChipBig, { color: stateColor }]} numberOfLines={1}>
                      {ticket.ticket_number}
                    </Text>
                    {ticketsWithItems?.has(ticket.id) ? (
                      <View style={styles.foodBadge}>
                        <Ionicons
                          name="restaurant"
                          size={compact ? 10 : 13}
                          color={colors.warning}
                        />
                      </View>
                    ) : null}
                  </View>
                  {!compact && customerName ? (
                    <Text style={styles.cardName} numberOfLines={1}>{customerName}</Text>
                  ) : null}
                  <View style={styles.cardMetaRow}>
                    {partyN ? (
                      <View style={styles.cardMetaItem}>
                        <Ionicons name="people-outline" size={compact ? 10 : 13} color={colors.textMuted} />
                        <Text style={styles.cardMetaText}>{partyN}</Text>
                      </View>
                    ) : null}
                    {elapsedTxt ? (
                      <View style={styles.cardMetaItem}>
                        <Ionicons name="time-outline" size={compact ? 10 : 13} color={colors.textMuted} />
                        <Text style={styles.cardMetaText}>{elapsedTxt}</Text>
                      </View>
                    ) : null}
                  </View>
                </>
              )}
              {/* Free state — large + icon to invite seating, compact stays text-only */}
              {!compact && state === 'free' && !ticket ? (
                <View style={styles.tapHint}>
                  <Text style={styles.tapHintText}>+ {t('floorMap.available')}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  loadingWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  grid: {
    padding: spacing.sm,
    gap: spacing.sm,
  },
  gridInner: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-start',
    width: '100%',
  },
  pressureBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary + '12',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    alignSelf: 'flex-start',
    marginBottom: spacing.sm,
  },
  pressureText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.primary,
  },
  // Standard card — table-focused tab. Flex sizing so two columns fill
  // the screen with comfortable tap targets, more breathing room, and
  // bigger labels/icons. Auto-grows on tablet to 3+ columns via maxWidth.
  card: {
    flexBasis: '47%',
    flexGrow: 1,
    maxWidth: 220,
    minHeight: 130,
    borderRadius: borderRadius.xl,
    borderWidth: 2,
    padding: spacing.md,
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Compact card — smaller height for use alongside active ticket panel
  cardCompact: {
    width: 80,
    minHeight: 70,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    padding: spacing.xs,
    gap: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tableNum: {
    fontSize: fontSize.lg,
    fontWeight: '900',
    color: colors.text,
    letterSpacing: 0.3,
  },
  tableNumCompact: {
    fontSize: fontSize.xs,
    fontWeight: '800',
    color: colors.text,
  },
  seats: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  ticketChip: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.textSecondary,
    marginTop: 1,
  },
  ticketChipBig: {
    fontSize: fontSize.md,
    fontWeight: '900',
    marginTop: 2,
    letterSpacing: 0.4,
  },
  ticketRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  foodBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    // Amber matches the kitchen-active / notify color used elsewhere
    // (item.note italic, "Preparing" pill). Green would clash with the
    // "Ready" status — picking a different hue makes the food-present
    // signal distinct from food-ready.
    backgroundColor: colors.warning + '1f',
    borderWidth: 1,
    borderColor: colors.warning + '55',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    gap: 4,
  },
  cardName: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.text,
    maxWidth: '100%',
  },
  cardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  cardMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  cardMetaText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
  },
  statsStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: spacing.sm,
  },
  statChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  statDot: { width: 6, height: 6, borderRadius: 3 },
  statNum: {
    fontSize: fontSize.xs,
    fontWeight: '900',
    color: colors.text,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textMuted,
  },
  tapHint: {
    marginTop: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary + '14',
  },
  tapHintText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 0.3,
  },
});
