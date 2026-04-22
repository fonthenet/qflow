import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { colors, borderRadius, fontSize, spacing } from '@/lib/theme';
import { matchTablesForParty, parsePartySize, type RestaurantTable } from '@qflo/shared';

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

  const isRestaurantish = category === 'restaurant' || category === 'cafe';

  const load = useCallback(async () => {
    if (!officeId || !isRestaurantish) return;
    const { data } = await supabase
      .from('restaurant_tables')
      .select('id, office_id, code, label, zone, capacity, min_party_size, max_party_size, reservable, status, current_ticket_id, assigned_at')
      .eq('office_id', officeId);
    setTables((data ?? []) as RestaurantTable[]);
  }, [officeId, isRestaurantish]);

  useEffect(() => { load(); }, [load]);

  // Realtime on restaurant_tables keeps the suggestion fresh.
  useEffect(() => {
    if (!officeId || !isRestaurantish) return;
    const channel = supabase.channel(`tables-${officeId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurant_tables' }, load)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tickets' }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [officeId, isRestaurantish, load]);

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
  if (!partySize && !currentSeating) return null;

  const seat = async (table: RestaurantTable) => {
    if (busy) return;
    setBusy(true);
    await supabase
      .from('restaurant_tables')
      .update({
        status: 'occupied',
        current_ticket_id: ticket.id,
        assigned_at: new Date().toISOString(),
      })
      .eq('id', table.id);
    await load();
    setBusy(false);
  };

  const clearSeat = async () => {
    if (!currentSeating || busy) return;
    setBusy(true);
    await supabase
      .from('restaurant_tables')
      .update({ status: 'available', current_ticket_id: null, assigned_at: null })
      .eq('id', currentSeating.id);
    await load();
    setBusy(false);
  };

  if (currentSeating) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.icon}>🪑</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>
            {t('tables.seatedAt', { code: currentSeating.code, defaultValue: 'Seated at {{code}}' })} · {currentSeating.label}
          </Text>
          <Text style={styles.sub}>
            {t('tables.partyOf', { n: partySize ?? '?', defaultValue: 'Party of {{n}}' })}
            {currentSeating.capacity ? ` · 👥 ${currentSeating.capacity}` : ''}
            {currentSeating.zone ? ` · ${currentSeating.zone}` : ''}
          </Text>
        </View>
        <TouchableOpacity onPress={clearSeat} disabled={busy} style={styles.btnGhost}>
          {busy ? <ActivityIndicator size="small" /> : <Text style={styles.btnGhostText}>✕ {t('tables.release', { defaultValue: 'Release' })}</Text>}
        </TouchableOpacity>
      </View>
    );
  }

  const top = matches[0];
  const more = matches.slice(1, 4);

  if (!top) {
    return (
      <View style={[styles.wrap, { borderColor: '#ef444455' }]}>
        <Text style={styles.icon}>⚠️</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>
            {t('tables.partyNoFit', { n: partySize, defaultValue: 'Party of {{n}} — no table fits' })}
          </Text>
          <Text style={styles.sub}>{t('tables.clearOrAdd', { defaultValue: 'Clear a table or add capacity in Business Administration.' })}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.icon}>💡</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>
          {t('tables.suggested', { code: top.table.code, defaultValue: 'Suggested: {{code}}' })} · {top.table.label}
          {top.score === 0 ? <Text style={styles.perfect}>  ✓ {t('tables.perfectFit', { defaultValue: 'perfect fit' })}</Text> : null}
        </Text>
        <Text style={styles.sub}>
          {t('tables.partyOf', { n: partySize, defaultValue: 'Party of {{n}}' })}
          {top.table.capacity ? ` · 👥 ${top.table.capacity}` : ''}
          {top.table.zone ? ` · ${top.table.zone}` : ''}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end' }}>
        <TouchableOpacity onPress={() => seat(top.table)} disabled={busy} style={styles.btnPrimary}>
          {busy
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={styles.btnPrimaryText}>🪑 {t('tables.seatAt', { code: top.table.code, defaultValue: 'Seat at {{code}}' })}</Text>}
        </TouchableOpacity>
        {more.map((m) => (
          <TouchableOpacity key={m.table.id} onPress={() => seat(m.table)} disabled={busy} style={styles.btnGhost}>
            <Text style={styles.btnGhostText}>{m.table.code}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
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
  },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: fontSize.xs },
  btnGhost: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnGhostText: { color: colors.text, fontWeight: '600', fontSize: fontSize.xs },
});
