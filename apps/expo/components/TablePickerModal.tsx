/**
 * TablePickerModal — full-screen table picker for seating a ticket.
 *
 * Replaces the cramped inline T1/T2/T3 chip strip with a searchable,
 * grouped list (Available / Occupied / On hold) so the operator can
 * see every table and its state in one tap.
 *
 * Locale: FR/AR/EN via i18next.
 */

import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import {
  matchTablesForParty,
  type RestaurantTable,
} from '@qflo/shared';
import { colors, borderRadius, fontSize, spacing } from '@/lib/theme';
import { useSheetAnim } from '@/lib/use-sheet-anim';

interface Props {
  visible: boolean;
  tables: RestaurantTable[];
  partySize: number | null;
  ticketNumber?: string;
  busy?: boolean;
  onSelect: (table: RestaurantTable) => void;
  onClose: () => void;
}

type RowKind = 'available' | 'occupied' | 'on_hold';

interface Row {
  table: RestaurantTable;
  kind: RowKind;
  fit: 'perfect' | 'ok' | 'tight' | 'over' | 'unknown';
}

function classifyFit(table: RestaurantTable, partySize: number | null): Row['fit'] {
  if (!partySize) return 'unknown';
  const cap = table.capacity ?? 0;
  const min = table.min_party_size ?? 1;
  const max = table.max_party_size ?? cap;
  if (partySize > max) return 'over';
  if (partySize === cap) return 'perfect';
  if (partySize >= min && partySize <= max) return 'ok';
  return 'tight';
}

function classifyKind(table: RestaurantTable): RowKind {
  const status = (table.status ?? '').toLowerCase();
  if (table.current_ticket_id) return 'occupied';
  if (status === 'on_hold' || status === 'reserved') return 'on_hold';
  return 'available';
}

export function TablePickerModal({
  visible,
  tables,
  partySize,
  ticketNumber,
  busy = false,
  onSelect,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const translateY = useSheetAnim(visible);

  const rows: Row[] = useMemo(() => {
    const ranked = partySize
      ? new Map(
          matchTablesForParty(tables, partySize).map((m, i) => [m.table.id, i]),
        )
      : new Map<string, number>();

    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    const all: Row[] = tables.map((tb) => ({
      table: tb,
      kind: classifyKind(tb),
      fit: classifyFit(tb, partySize),
    }));

    const q = query.trim().toLowerCase();
    const filtered = q
      ? all.filter(
          (r) =>
            (r.table.code ?? '').toLowerCase().includes(q) ||
            (r.table.label ?? '').toLowerCase().includes(q) ||
            (r.table.zone ?? '').toLowerCase().includes(q),
        )
      : all;

    const order: Record<RowKind, number> = { available: 0, on_hold: 1, occupied: 2 };
    return filtered.sort((a, b) => {
      if (a.kind !== b.kind) return order[a.kind] - order[b.kind];
      // Within "available", rank by party-match ordering when we have a party size
      if (a.kind === 'available' && partySize) {
        const ra = ranked.get(a.table.id) ?? 999;
        const rb = ranked.get(b.table.id) ?? 999;
        if (ra !== rb) return ra - rb;
      }
      return collator.compare(a.table.code ?? '', b.table.code ?? '');
    });
  }, [tables, partySize, query]);

  const renderRow = ({ item }: { item: Row }) => {
    const tb = item.table;
    const disabled = busy || item.kind === 'occupied' || item.fit === 'over';
    const fitBadge = (() => {
      if (item.fit === 'perfect') return { label: t('tables.perfectFit', { defaultValue: 'Perfect fit' }), color: '#16a34a', bg: '#16a34a18' };
      if (item.fit === 'ok') return { label: t('tables.fitsOk', { defaultValue: 'Fits' }), color: '#0ea5e9', bg: '#0ea5e918' };
      if (item.fit === 'tight') return { label: t('tables.fitsTight', { defaultValue: 'Tight' }), color: '#f59e0b', bg: '#f59e0b18' };
      if (item.fit === 'over') return { label: t('tables.tooSmall', { defaultValue: 'Too small' }), color: '#ef4444', bg: '#ef444418' };
      return null;
    })();
    const kindBadge = (() => {
      if (item.kind === 'occupied') return { label: t('floorMap.occupied', { defaultValue: 'Occupied' }), color: '#ef4444' };
      if (item.kind === 'on_hold') return { label: t('floorMap.onHold', { defaultValue: 'On hold' }), color: '#f59e0b' };
      return { label: t('floorMap.available', { defaultValue: 'Available' }), color: '#16a34a' };
    })();

    return (
      <Pressable
        onPress={() => !disabled && onSelect(tb)}
        disabled={disabled}
        style={({ pressed }) => [
          styles.row,
          pressed && !disabled && { backgroundColor: colors.primary + '0d' },
          disabled && { opacity: 0.5 },
        ]}
        android_ripple={{ color: colors.primary + '20' }}
      >
        <View style={styles.rowMain}>
          <View style={styles.codeBlock}>
            <Text style={styles.codeText} numberOfLines={1}>{tb.code || tb.label || '—'}</Text>
            <Text style={styles.labelText} numberOfLines={1}>{tb.label && tb.label !== tb.code ? tb.label : ''}</Text>
          </View>
          <View style={styles.metaCol}>
            <View style={styles.metaRow}>
              <Ionicons name="people-outline" size={13} color={colors.textMuted} />
              <Text style={styles.metaText}>{tb.capacity ?? '?'}</Text>
              {tb.zone ? (
                <>
                  <Text style={styles.metaDot}>·</Text>
                  <Text style={styles.metaText} numberOfLines={1}>{tb.zone}</Text>
                </>
              ) : null}
            </View>
            <View style={styles.badgeRow}>
              <View style={[styles.kindPill, { backgroundColor: kindBadge.color + '18' }]}>
                <View style={[styles.kindDot, { backgroundColor: kindBadge.color }]} />
                <Text style={[styles.kindPillText, { color: kindBadge.color }]}>{kindBadge.label}</Text>
              </View>
              {fitBadge ? (
                <View style={[styles.fitPill, { backgroundColor: fitBadge.bg }]}>
                  <Text style={[styles.fitPillText, { color: fitBadge.color }]}>{fitBadge.label}</Text>
                </View>
              ) : null}
            </View>
          </View>
          {!disabled ? (
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          ) : null}
        </View>
      </Pressable>
    );
  };

  const subtitle = (() => {
    const parts: string[] = [];
    if (ticketNumber) parts.push(ticketNumber);
    if (partySize) parts.push(t('tables.partyOf', { n: partySize, defaultValue: 'Party of {{n}}' }));
    return parts.join(' · ');
  })();

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Animated.View
          style={[styles.sheet, { transform: [{ translateY }] }]}
          onStartShouldSetResponder={() => true}
        >
          {/* Drag handle */}
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>
                {t('tables.chooseTable', { defaultValue: 'Choose a table' })}
              </Text>
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>

          {/* Search */}
          <View style={styles.searchWrap}>
            <Ionicons name="search" size={16} color={colors.textMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('tables.searchPlaceholder', { defaultValue: 'Search code, label, zone…' })}
              placeholderTextColor={colors.textMuted}
              style={styles.searchInput}
              autoCorrect={false}
              autoCapitalize="characters"
            />
            {query ? (
              <Pressable onPress={() => setQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </View>

          {busy ? (
            <View style={styles.busyOverlay}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : null}

          <FlatList
            data={rows}
            keyExtractor={(r) => r.table.id}
            renderItem={renderRow}
            ItemSeparatorComponent={() => <View style={styles.sep} />}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="grid-outline" size={28} color={colors.textMuted} />
                <Text style={styles.emptyText}>
                  {tables.length === 0
                    ? t('tables.noneConfigured', { defaultValue: 'No tables configured for this office.' })
                    : t('tables.noneMatch', { defaultValue: 'No tables match your search.' })}
                </Text>
              </View>
            }
            contentContainerStyle={{ paddingBottom: spacing.xl }}
          />
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    maxHeight: '88%',
    paddingTop: spacing.xs,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  title: { fontSize: fontSize.md, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginHorizontal: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.text,
    paddingVertical: 4,
  },
  row: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  codeBlock: {
    minWidth: 56,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  codeText: { fontSize: fontSize.md, fontWeight: '800', color: colors.text },
  labelText: { fontSize: 10, color: colors.textMuted },
  metaCol: { flex: 1, gap: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: fontSize.xs, color: colors.text, fontWeight: '600' },
  metaDot: { fontSize: fontSize.xs, color: colors.textMuted },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  kindPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  kindDot: { width: 6, height: 6, borderRadius: 3 },
  kindPillText: { fontSize: 10, fontWeight: '700' },
  fitPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  fitPillText: { fontSize: 10, fontWeight: '700' },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: spacing.md },
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
  emptyText: { fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center' },
  busyOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.05)',
    alignItems: 'center', justifyContent: 'center',
    zIndex: 1,
  },
});
