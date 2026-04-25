import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useLocalConnectionStore } from '@/lib/local-connection-store';
import * as Actions from '@/lib/data-adapter';
import { colors, borderRadius, fontSize, spacing } from '@/lib/theme';
import { matchTablesForParty, parsePartySize, type RestaurantTable } from '@qflo/shared';
import { TablePickerModal } from './TablePickerModal';

// ── Smart table suggestion for Expo operator desk screen ──────────
// Mirror of the Station's TableSuggestionBar. Uses the same shared
// matchTablesForParty helper so the rules stay consistent.

interface Props {
  officeId: string | null;
  category: string | null;
  ticket: { id: string; ticket_number?: string; customer_data?: any } | null;
}

export function TableSuggestion({ officeId, category, ticket }: Props) {
  const { t } = useTranslation();
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const isRestaurantish = category === 'restaurant' || category === 'cafe';
  const isLocal = useLocalConnectionStore(
    (s) => s.mode === 'local' && !!s.stationUrl && !!s.stationSession,
  );

  const load = useCallback(async () => {
    if (!officeId || !isRestaurantish) return;
    try {
      const data = await Actions.fetchRestaurantTables(officeId);
      setTables((data ?? []) as RestaurantTable[]);
    } catch {
      setTables([]);
    }
  }, [officeId, isRestaurantish]);

  useEffect(() => { load(); }, [load]);

  // Cloud mode: realtime keeps the suggestion fresh.
  useEffect(() => {
    if (!officeId || !isRestaurantish || isLocal) return;
    const channel = supabase.channel(`tables-${officeId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurant_tables' }, load)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tickets' }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [officeId, isRestaurantish, isLocal, load]);

  // Local mode: poll the Station bridge (no realtime in local).
  useEffect(() => {
    if (!officeId || !isRestaurantish || !isLocal) return;
    const id = setInterval(() => { load(); }, 4000);
    return () => clearInterval(id);
  }, [officeId, isRestaurantish, isLocal, load]);

  const partySize = useMemo(
    () => parsePartySize(ticket?.customer_data?.party_size),
    [ticket?.customer_data?.party_size],
  );
  const currentSeating = useMemo(
    () => (ticket ? tables.find((tb) => tb.current_ticket_id === ticket.id) : null),
    [tables, ticket],
  );
  const matches = useMemo(
    () => (partySize ? matchTablesForParty(tables, partySize) : []),
    [tables, partySize],
  );

  if (!isRestaurantish || !ticket) return null;
  // Always allow opening the picker — even without a known party size, the
  // operator may still want to assign a table manually.
  if (!partySize && !currentSeating && tables.length === 0) return null;

  const seat = async (table: RestaurantTable) => {
    if (busy || !officeId) return;
    setBusy(true);
    try {
      await Actions.seatTicketAtTableId(officeId, table.id, ticket.id);
    } catch (e) {
      console.warn('[TableSuggestion] seat failed', e);
    }
    await load();
    setBusy(false);
    setPickerOpen(false);
  };

  const clearSeat = async () => {
    if (!currentSeating || busy || !officeId) return;
    setBusy(true);
    try {
      await Actions.clearTableById(officeId, currentSeating.id);
    } catch (e) {
      console.warn('[TableSuggestion] clearSeat failed', e);
    }
    await load();
    setBusy(false);
  };

  if (currentSeating) {
    return (
      <>
        <View style={styles.wrap}>
          <Text style={styles.icon}>🪑</Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.title} numberOfLines={1}>
              {t('tables.seatedAt', { code: currentSeating.code, defaultValue: 'Seated at {{code}}' })}
              {currentSeating.label && currentSeating.label !== currentSeating.code ? ` · ${currentSeating.label}` : ''}
            </Text>
            <Text style={styles.sub}>
              {t('tables.partyOf', { n: partySize ?? '?', defaultValue: 'Party of {{n}}' })}
              {currentSeating.capacity ? ` · 👥 ${currentSeating.capacity}` : ''}
              {currentSeating.zone ? ` · ${currentSeating.zone}` : ''}
            </Text>
          </View>
          <View style={{ flexDirection: 'column', gap: 6 }}>
            <TouchableOpacity onPress={() => setPickerOpen(true)} disabled={busy} style={styles.btnGhost}>
              <Ionicons name="swap-horizontal" size={13} color={colors.text} />
              <Text style={styles.btnGhostText}>{t('tables.move', { defaultValue: 'Move' })}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={clearSeat} disabled={busy} style={styles.btnGhost}>
              {busy ? <ActivityIndicator size="small" /> : <Text style={styles.btnGhostText}>✕ {t('tables.release', { defaultValue: 'Release' })}</Text>}
            </TouchableOpacity>
          </View>
        </View>
        <TablePickerModal
          visible={pickerOpen}
          tables={tables}
          partySize={partySize}
          ticketNumber={ticket.ticket_number}
          busy={busy}
          onSelect={async (tb) => {
            // Move: release current, then seat at new
            await clearSeat();
            await seat(tb);
          }}
          onClose={() => setPickerOpen(false)}
        />
      </>
    );
  }

  const top = matches[0];

  if (!top) {
    return (
      <>
        <View style={[styles.wrap, { borderColor: '#ef444455' }]}>
          <Text style={styles.icon}>⚠️</Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.title} numberOfLines={2}>
              {t('tables.partyNoFit', { n: partySize, defaultValue: 'Party of {{n}} — no table fits' })}
            </Text>
            <Text style={styles.sub}>{t('tables.clearOrAdd', { defaultValue: 'Clear a table or add capacity in Business Administration.' })}</Text>
          </View>
          <TouchableOpacity onPress={() => setPickerOpen(true)} disabled={busy} style={styles.btnGhost}>
            <Ionicons name="grid-outline" size={13} color={colors.text} />
            <Text style={styles.btnGhostText}>
              {t('tables.viewAll', { defaultValue: 'View all' })}
            </Text>
          </TouchableOpacity>
        </View>
        <TablePickerModal
          visible={pickerOpen}
          tables={tables}
          partySize={partySize}
          ticketNumber={ticket.ticket_number}
          busy={busy}
          onSelect={seat}
          onClose={() => setPickerOpen(false)}
        />
      </>
    );
  }

  return (
    <>
      <View style={styles.wrap}>
        <Text style={styles.icon}>💡</Text>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title} numberOfLines={1}>
            {t('tables.suggested', { code: top.table.code, defaultValue: 'Suggested: {{code}}' })}
            {top.table.label && top.table.label !== top.table.code ? ` · ${top.table.label}` : ''}
            {top.score === 0 ? <Text style={styles.perfect}>  ✓ {t('tables.perfectFit', { defaultValue: 'perfect fit' })}</Text> : null}
          </Text>
          <Text style={styles.sub}>
            {t('tables.partyOf', { n: partySize, defaultValue: 'Party of {{n}}' })}
            {top.table.capacity ? ` · 👥 ${top.table.capacity}` : ''}
            {top.table.zone ? ` · ${top.table.zone}` : ''}
          </Text>
        </View>
        <View style={{ flexDirection: 'column', gap: 6, alignItems: 'stretch' }}>
          <TouchableOpacity onPress={() => seat(top.table)} disabled={busy} style={styles.btnPrimary}>
            {busy
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={styles.btnPrimaryText}>🪑 {t('tables.seatAt', { code: top.table.code, defaultValue: 'Seat at {{code}}' })}</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setPickerOpen(true)} disabled={busy} style={styles.btnGhost}>
            <Ionicons name="grid-outline" size={13} color={colors.text} />
            <Text style={styles.btnGhostText}>
              {t('tables.chooseAnother', { count: tables.length, defaultValue: 'Choose another ({{count}})' })}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
      <TablePickerModal
        visible={pickerOpen}
        tables={tables}
        partySize={partySize}
        ticketNumber={ticket.ticket_number}
        busy={busy}
        onSelect={seat}
        onClose={() => setPickerOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
    flexWrap: 'wrap',
  },
  icon: { fontSize: 18 },
  title: { fontSize: fontSize.sm, fontWeight: '700', color: colors.text },
  sub: { fontSize: fontSize.xs, color: colors.textMuted },
  perfect: { color: '#22c55e', fontSize: fontSize.xs },
  btnPrimary: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: fontSize.xs },
  btnGhost: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnGhostText: { color: colors.text, fontWeight: '600', fontSize: fontSize.xs },
});
