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

import { supabase } from '@/lib/supabase';
import { colors, borderRadius, fontSize, spacing } from '@/lib/theme';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TableRow {
  id: string;
  label: string;
  seats: number;
}

interface TicketRef {
  id: string;
  ticket_number: string;
  status: string;
  table_label?: string | null;
  customer_data?: { name?: string } | null;
  parked_at?: string | null;
}

interface FloorMapProps {
  officeId: string | null;
  /** Waiting tickets — used to count pressure */
  waitingCount: number;
  /** Currently called/serving tickets (to show which tables are occupied) */
  activeTickets: TicketRef[];
  /** Parked tickets */
  parkedTickets: TicketRef[];
  /** Compact mode: no seat counts, smaller cards — used when active ticket panel is shown alongside */
  compact?: boolean;
  /** Called when operator taps an occupied table */
  onSelectOccupied?: (ticket: TicketRef) => void;
  /** Called when operator taps a free table to seat a customer */
  onSeatNext?: (tableLabel: string) => void;
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
  compact = false,
  onSelectOccupied,
  onSeatNext,
}: FloorMapProps) {
  const { t } = useTranslation();
  const [tables, setTables] = useState<TableRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Try to load real table config; fall back to synthetic rows
  useEffect(() => {
    if (!officeId) {
      setTables(buildFallbackTables(waitingCount + activeTickets.length + 4));
      setLoading(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        // restaurant_tables is optional — if the table doesn't exist yet,
        // Supabase returns an error we catch and fall back gracefully.
        // Match Station's contract — the canonical schema lives on
         // restaurant_tables (id, code, label, capacity, current_ticket_id,
         // status, etc). We only need a subset for the simplified RN view.
        const { data, error } = await (supabase as any)
          .from('restaurant_tables')
          .select('id, code, label, capacity, current_ticket_id, status')
          .eq('office_id', officeId)
          .order('code', { ascending: true });

        if (cancelled) return;

        if (!error && data && data.length > 0) {
          // Map Supabase rows → simplified TableRow. Prefer label, fall
          // back to code for the visible tag. Capacity → seats.
          const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
          const mapped: TableRow[] = (data as any[])
            .map((r) => ({
              id: String(r.id),
              label: r.label || r.code || '',
              seats: typeof r.capacity === 'number' ? r.capacity : 4,
            }))
            .sort((a, b) => collator.compare(a.label, b.label));
          setTables(mapped);
        } else {
          // Table doesn't exist or empty — synthesise
          const total = Math.max(waitingCount + activeTickets.length + 4, 8);
          setTables(buildFallbackTables(total));
        }
      } catch {
        if (!cancelled) {
          setTables(buildFallbackTables(8));
        }
      }
      if (!cancelled) setLoading(false);
    };

    load();
    return () => { cancelled = true; };
  }, [officeId, waitingCount, activeTickets.length]);

  const getTableState = useCallback(
    (table: TableRow): { state: 'free' | 'occupied' | 'on_hold'; ticket: TicketRef | null } => {
      const active = activeTickets.find(
        (t) => t.table_label === table.label || t.table_label === table.id,
      );
      if (active) return { state: 'occupied', ticket: active };

      const parked = parkedTickets.find(
        (t) => t.table_label === table.label || t.table_label === table.id,
      );
      if (parked) return { state: 'on_hold', ticket: parked };

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

  return (
    <ScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
      {/* Waiting pressure badge */}
      {waitingCount > 0 && (
        <View style={styles.pressureBadge}>
          <Ionicons name="people-outline" size={14} color={colors.primary} />
          <Text style={styles.pressureText}>
            {t('floorMap.waitingInQueue', { count: waitingCount })}
          </Text>
        </View>
      )}

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

          return (
            <Pressable
              key={table.id}
              style={[cardSize, { backgroundColor: bgColor, borderColor }]}
              onPress={() => {
                if (state === 'occupied' || state === 'on_hold') {
                  ticket && onSelectOccupied?.(ticket);
                } else {
                  onSeatNext?.(table.label);
                }
              }}
              android_ripple={{ color: colors.primary + '20' }}
            >
              <Text style={numSize}>{table.label}</Text>
              {!compact && (
                <Text style={styles.seats}>
                  {table.seats} {t('floorMap.seats')}
                </Text>
              )}
              <Ionicons name={stateIcon as any} size={compact ? 16 : 20} color={stateColor} />
              {ticket && (
                <Text style={styles.ticketChip} numberOfLines={1}>
                  {ticket.ticket_number}
                </Text>
              )}
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
    padding: spacing.md,
    gap: spacing.sm,
  },
  gridInner: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-start',
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
  // Standard card (~2-column on phone, ~3-4 on tablet)
  card: {
    width: 100,
    minHeight: 90,
    borderRadius: borderRadius.xl,
    borderWidth: 1.5,
    padding: spacing.sm,
    gap: spacing.xs,
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
    fontSize: fontSize.sm,
    fontWeight: '800',
    color: colors.text,
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
});
