/**
 * KitchenTicketCard — single ticket card for the Kitchen Display System.
 *
 * Inspired by Toast / Square / Lightspeed KDS conventions:
 *   - Ticket-card grid (not a flat list) so the cook scans by table.
 *   - Big table label + party size — the first thing the eye lands on.
 *   - Live-updating "age" badge in the top-right that flips colour:
 *       <5m  green, 5-10m amber, >10m red. Drives kitchen urgency.
 *   - Per-item button cycles new → in_progress → ready. Tapping a ready
 *     item mark it back to in_progress (un-bump) so a misclick is
 *     recoverable without leaving the screen.
 *   - Card-level "Bump all ready" sends every non-ready item straight
 *     to ready in one round-trip. The expo / runner sees the whole
 *     ticket flip green and goes to pick it up.
 *   - Strike-through visual for ready items so the cook can see at a
 *     glance which lines are still pending.
 *   - Item notes (e.g. "no onions") render under the line in italic.
 *   - Newly-added items pulse so a server adding a course mid-meal is
 *     impossible to miss (handled via the `newItemIds` prop).
 */

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { TicketItem } from '@qflo/shared';
import { borderRadius, fontSize, spacing, useTheme } from '@/lib/theme';
import type { KitchenTicket } from '@/lib/data-adapter';

interface Props {
  card: KitchenTicket;
  /** IDs of items added in the last poll cycle — get a brief pulse
   *  so the cook notices a server adding a course mid-meal. */
  newItemIds?: Set<string>;
  /** Cycle a single item: tap = advance to next stage. */
  onItemAdvance: (item: TicketItem) => void;
  /** "Mark all ready" — bumps every non-ready line to ready. */
  onBumpAllReady: (card: KitchenTicket) => void;
  /** "Mark all served" — final state, removes the card from KDS. */
  onMarkAllServed: (card: KitchenTicket) => void;
  busy?: boolean;
}

function ageMinutes(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return 0;
  return Math.floor(ms / 60000);
}

function formatAge(min: number): string {
  if (min < 1) return '<1m';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  return `${h}h${min % 60 ? `${min % 60}m` : ''}`;
}

export function KitchenTicketCard({
  card,
  newItemIds,
  onItemAdvance,
  onBumpAllReady,
  onMarkAllServed,
  busy = false,
}: Props) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors, isDark);

  // Tick every 30s so the age badge stays accurate without the parent
  // having to force a re-render. Cheap — just bumps state.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const minutes = ageMinutes(card.oldest_item_at);
  const urgency: 'fresh' | 'warm' | 'urgent' =
    minutes < 5 ? 'fresh' : minutes < 10 ? 'warm' : 'urgent';
  const urgencyColor =
    urgency === 'fresh' ? colors.success : urgency === 'warm' ? colors.warning : colors.error;

  const allReady = card.items.every((it) => it.kitchen_status === 'ready');
  const headerLabel = card.table_label
    ? card.table_label
    : `#${card.ticket_number}`;

  // Aggregate "whole order" status — single TL;DR pill in the header so
  // a glance tells the cook the card's overall state (per-item pills
  // still live below for the detail view).
  const aggregate: 'new' | 'in_progress' | 'ready' | 'mixed' = (() => {
    if (!card.items.length) return 'new';
    const set = new Set(card.items.map((it) => it.kitchen_status ?? 'new'));
    if (set.size === 1) return Array.from(set)[0] as any;
    return 'mixed';
  })();
  const aggLabel = aggregate === 'ready' ? t('kitchen.ready', { defaultValue: 'Ready' })
    : aggregate === 'in_progress' ? t('kitchen.inProgress', { defaultValue: 'Preparing' })
    : aggregate === 'mixed' ? t('kitchen.partial', { defaultValue: 'Partial' })
    : t('kitchen.new', { defaultValue: 'New' });
  const aggColor = aggregate === 'ready' ? colors.success
    : aggregate === 'in_progress' ? colors.warning
    : aggregate === 'mixed' ? colors.primary
    : colors.textMuted;
  const aggIcon: any = aggregate === 'ready' ? 'checkmark-done-circle'
    : aggregate === 'in_progress' ? 'flame'
    : aggregate === 'mixed' ? 'ellipse-half'
    : 'ellipse-outline';

  return (
    <View style={[styles.card, { borderColor: urgencyColor + '88' }]}>
      {/* Header — big table number, party, age */}
      <View style={[styles.header, { backgroundColor: urgencyColor + (isDark ? '22' : '14') }]}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.tableLabel}>{headerLabel}</Text>
          <View style={styles.subRow}>
            {card.table_label ? (
              <Text style={styles.subText}>#{card.ticket_number}</Text>
            ) : null}
            {card.party_size ? (
              <View style={styles.metaChip}>
                <Ionicons name="people-outline" size={11} color={colors.textMuted} />
                <Text style={styles.metaText}>
                  {t('kitchen.partyOf', { n: card.party_size, defaultValue: 'Party of {{n}}' })}
                </Text>
              </View>
            ) : null}
            {card.customer_name ? (
              <Text style={styles.subText} numberOfLines={1}>{card.customer_name}</Text>
            ) : null}
          </View>
        </View>
        <View style={styles.headerBadges}>
          <View style={[styles.aggBadge, { backgroundColor: aggColor + '22', borderColor: aggColor + '88' }]}>
            <Ionicons name={aggIcon} size={12} color={aggColor} />
            <Text style={[styles.aggText, { color: aggColor }]}>{aggLabel}</Text>
          </View>
          <View style={[styles.ageBadge, { backgroundColor: urgencyColor }]}>
            <Ionicons name="time-outline" size={13} color="#fff" />
            <Text style={styles.ageText}>{formatAge(minutes)}</Text>
          </View>
        </View>
      </View>

      {/* Items list */}
      <View style={styles.itemsList}>
        {card.items.map((it) => (
          <KitchenItemRow
            key={it.id}
            item={it}
            isNew={newItemIds?.has(it.id) ?? false}
            onAdvance={onItemAdvance}
            busy={busy}
          />
        ))}
      </View>

      {/* Footer actions */}
      <View style={styles.footer}>
        {allReady ? (
          <Pressable
            onPress={() => !busy && onMarkAllServed(card)}
            disabled={busy}
            style={({ pressed }) => [
              styles.primaryBtn,
              { backgroundColor: colors.primary },
              pressed && !busy && { opacity: 0.85 },
              busy && { opacity: 0.5 },
            ]}
          >
            <Ionicons name="checkmark-done" size={16} color="#fff" />
            <Text style={styles.primaryBtnText}>
              {t('kitchen.markAllServed', { defaultValue: 'Mark all served' })}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => !busy && onBumpAllReady(card)}
            disabled={busy}
            style={({ pressed }) => [
              styles.primaryBtn,
              { backgroundColor: colors.success },
              pressed && !busy && { opacity: 0.85 },
              busy && { opacity: 0.5 },
            ]}
          >
            <Ionicons name="restaurant" size={16} color="#fff" />
            <Text style={styles.primaryBtnText}>
              {t('kitchen.bumpAllReady', { defaultValue: 'Mark all ready' })}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Item row — separate component so its own pulse animation doesn't
// re-render the whole card on every frame.
// ---------------------------------------------------------------------------
function KitchenItemRow({
  item,
  isNew,
  onAdvance,
  busy,
}: {
  item: TicketItem;
  isNew: boolean;
  onAdvance: (item: TicketItem) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = makeStyles(colors, false);
  const [pulse] = useState(() => new Animated.Value(isNew ? 1 : 0));
  useEffect(() => {
    if (!isNew) return;
    Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 250, useNativeDriver: false }),
      Animated.timing(pulse, { toValue: 0, duration: 1500, useNativeDriver: false }),
    ]).start();
  }, [isNew, pulse]);

  const status = item.kitchen_status ?? 'new';
  const statusColor =
    status === 'ready' ? colors.success
      : status === 'in_progress' ? colors.warning
      : colors.textSecondary;
  const statusLabel =
    status === 'ready' ? t('kitchen.ready', { defaultValue: 'Ready' })
      : status === 'in_progress' ? t('kitchen.inProgress', { defaultValue: 'Preparing' })
      : t('kitchen.new', { defaultValue: 'New' });
  const isReady = status === 'ready';

  const bg = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: ['transparent', colors.warning + '22'],
  });

  return (
    <Animated.View style={{ backgroundColor: bg, borderRadius: borderRadius.sm }}>
      <Pressable
        onPress={() => !busy && onAdvance(item)}
        disabled={busy}
        style={({ pressed }) => [
          styles.itemRow,
          pressed && !busy && { opacity: 0.7 },
          busy && { opacity: 0.6 },
        ]}
      >
        <View style={styles.qtyBlock}>
          <Text style={styles.qtyText}>×{item.qty}</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.itemName, isReady && styles.itemNameDone]} numberOfLines={2}>
            {item.name}
          </Text>
          {item.note ? (
            <Text style={styles.itemNote} numberOfLines={2}>{item.note}</Text>
          ) : null}
        </View>
        <View style={[styles.statusPill, { backgroundColor: statusColor + '22', borderColor: statusColor + '66' }]}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const makeStyles = (colors: ReturnType<typeof useTheme>['colors'], isDark: boolean) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: borderRadius.lg,
      borderWidth: 2,
      overflow: 'hidden',
      // Subtle drop shadow so cards lift off the dark expo-screen background.
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: isDark ? 0.4 : 0.08,
      shadowRadius: 6,
      elevation: 3,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      gap: spacing.sm,
    },
    tableLabel: {
      fontSize: fontSize.xxl,
      fontWeight: '900',
      color: colors.text,
      letterSpacing: 0.5,
    },
    subRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    subText: { fontSize: fontSize.xs, color: colors.textSecondary, fontWeight: '600' },
    metaChip: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    metaText: { fontSize: fontSize.xs, color: colors.textMuted, fontWeight: '600' },
    headerBadges: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    aggBadge: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      paddingHorizontal: 8, paddingVertical: 4,
      borderRadius: borderRadius.full,
      borderWidth: 1,
    },
    aggText: { fontSize: fontSize.xs, fontWeight: '800' },
    ageBadge: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      paddingHorizontal: 10, paddingVertical: 5,
      borderRadius: borderRadius.full,
    },
    ageText: { color: '#fff', fontWeight: '800', fontSize: fontSize.sm },
    itemsList: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      gap: 2,
    },
    itemRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.xs,
      paddingVertical: 8,
    },
    qtyBlock: {
      width: 36, height: 36, borderRadius: borderRadius.sm,
      backgroundColor: colors.primary + '14',
      alignItems: 'center', justifyContent: 'center',
    },
    qtyText: { fontSize: fontSize.md, fontWeight: '900', color: colors.primary },
    itemName: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
    itemNameDone: {
      textDecorationLine: 'line-through',
      color: colors.textMuted,
      fontWeight: '500',
    },
    itemNote: { fontSize: fontSize.xs, color: colors.warning, fontStyle: 'italic' },
    statusPill: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      paddingHorizontal: 8, paddingVertical: 4,
      borderRadius: borderRadius.full,
      borderWidth: 1,
    },
    statusDot: { width: 6, height: 6, borderRadius: 3 },
    statusText: { fontSize: fontSize.xs, fontWeight: '800' },
    footer: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    primaryBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: 6,
      paddingVertical: 11,
      borderRadius: borderRadius.md,
    },
    primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: fontSize.md },
  });
