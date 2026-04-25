/**
 * ClientPickerModal — full waiting list shown when the operator taps a
 * free table on the FloorMap. Lets them pick exactly which customer to
 * seat instead of always defaulting to "next in queue".
 */

import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, borderRadius, fontSize, spacing } from '@/lib/theme';
import { useSheetAnim } from '@/lib/use-sheet-anim';

interface WaitingTicket {
  id: string;
  ticket_number: string;
  customer_data?: { name?: string; phone?: string; party_size?: number | string } | null;
  source?: string | null;
  created_at?: string | null;
  position?: number;
  /** When 'called', the customer has already been pinged and is on
   *  their way in. We surface this as a badge so the operator knows
   *  the notify already fired (and changes the Notify button to a
   *  Re-notify so they can still re-ping if needed). */
  status?: string;
  called_at?: string | null;
}

interface Props {
  visible: boolean;
  tickets: WaitingTicket[];
  tableLabel?: string;
  busy?: boolean;
  onSelect: (ticket: WaitingTicket) => void;
  onCallNext?: () => void;
  /** Send the customer a "your table is ready" ping over their channel
   * (WhatsApp / Messenger / push). Tickets without a return channel
   * (kiosk, walk-in) render a disabled button. */
  onNotify?: (ticket: WaitingTicket) => void;
  onClose: () => void;
}

function formatWait(createdAt?: string | null): string {
  if (!createdAt) return '';
  const ms = Date.now() - new Date(createdAt).getTime();
  if (Number.isNaN(ms) || ms < 0) return '';
  const m = Math.floor(ms / 60000);
  if (m < 1) return '<1m';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
}

function channelIcon(source?: string | null): { name: any; color: string } | null {
  if (!source) return null;
  const s = source.toLowerCase();
  if (s.includes('whatsapp')) return { name: 'logo-whatsapp', color: '#25D366' };
  if (s.includes('messenger')) return { name: 'chatbubble', color: '#0084FF' };
  if (s.includes('kiosk')) return { name: 'tablet-portrait-outline', color: colors.textMuted };
  return null;
}

// Resolve which channel button to show on the notify action: WhatsApp /
// Messenger get their brand icon + label, anything else (or no source)
// falls back to a generic "Notify" push. Kiosk/walk-in have no return
// channel — the button is disabled there.
function notifyChannel(
  source?: string | null,
): { icon: any; color: string; labelKey: string; labelDefault: string; disabled: boolean } {
  const s = (source ?? '').toLowerCase();
  if (s.includes('whatsapp')) {
    return { icon: 'logo-whatsapp', color: '#25D366', labelKey: 'tables.notifyWhatsapp', labelDefault: 'WhatsApp', disabled: false };
  }
  if (s.includes('messenger')) {
    return { icon: 'chatbubble', color: '#0084FF', labelKey: 'tables.notifyMessenger', labelDefault: 'Messenger', disabled: false };
  }
  if (s.includes('kiosk') || s.includes('walk')) {
    return { icon: 'notifications-off-outline', color: colors.textMuted, labelKey: 'tables.notify', labelDefault: 'Notify', disabled: true };
  }
  // online booking / scan / unknown — push notification fallback is fine
  return { icon: 'notifications-outline', color: colors.primary, labelKey: 'tables.notify', labelDefault: 'Notify', disabled: false };
}

export function ClientPickerModal({
  visible,
  tickets,
  tableLabel,
  busy = false,
  onSelect,
  onCallNext,
  onNotify,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const translateY = useSheetAnim(visible);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? tickets.filter((tk) => {
          const name = (tk.customer_data?.name ?? '').toLowerCase();
          const phone = (tk.customer_data?.phone ?? '').toLowerCase();
          const num = tk.ticket_number.toLowerCase();
          return name.includes(q) || phone.includes(q) || num.includes(q);
        })
      : tickets;
    // Sort deterministically by created_at ascending so a notify-triggered
    // status flip ('waiting' → 'called') doesn't reorder the list — the
    // operator's mental position of a ticket should stay stable.
    return [...filtered].sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return ta - tb;
    });
  }, [tickets, query]);

  const renderRow = ({ item, index }: { item: WaitingTicket; index: number }) => {
    const name = item.customer_data?.name?.trim() || t('queue.guest', { defaultValue: 'Guest' });
    const party = item.customer_data?.party_size;
    const phone = item.customer_data?.phone?.trim();
    const wait = formatWait(item.created_at);
    const ch = channelIcon(item.source);
    const notify = notifyChannel(item.source);
    const canNotify = !!onNotify && !notify.disabled;
    return (
      <View style={styles.row}>
        <View style={styles.posBlock}>
          <Text style={styles.posText}>{index + 1}</Text>
        </View>
        <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
          <View style={styles.rowTop}>
            <Text style={styles.numText}>{item.ticket_number}</Text>
            {ch ? <Ionicons name={ch.name} size={12} color={ch.color} /> : null}
            <Text style={styles.nameText} numberOfLines={1}>· {name}</Text>
          </View>
          <View style={styles.rowMeta}>
            {item.status === 'called' ? (
              <View style={[styles.metaChip, { backgroundColor: colors.warning + '22', borderColor: colors.warning + '55' }]}>
                <Ionicons name="megaphone-outline" size={11} color={colors.warning} />
                <Text style={[styles.metaChipText, { color: colors.warning, fontWeight: '800' }]}>
                  {t('tables.notified', { defaultValue: 'Notified' })}
                </Text>
              </View>
            ) : null}
            {party ? (
              <View style={styles.metaChip}>
                <Ionicons name="people-outline" size={11} color={colors.textMuted} />
                <Text style={styles.metaChipText}>
                  {t('tables.partyOf', { n: party, defaultValue: 'Party of {{n}}' })}
                </Text>
              </View>
            ) : null}
            {phone ? (
              <Pressable
                onPress={() => {
                  // tel: deeplink — opens the dialer with the number pre-filled.
                  // Strip spaces but keep '+' so international numbers dial correctly.
                  const dial = phone.replace(/[^\d+]/g, '');
                  Linking.openURL(`tel:${dial}`).catch(() => {});
                }}
                hitSlop={6}
                style={({ pressed }) => [
                  styles.metaChip,
                  styles.phoneChip,
                  pressed && { opacity: 0.7 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={t('tables.callPhone', { phone, defaultValue: 'Call {{phone}}' })}
              >
                <Ionicons name="call-outline" size={11} color={colors.primary} />
                <Text style={[styles.metaChipText, styles.phoneChipText]}>{phone}</Text>
              </Pressable>
            ) : null}
            {wait ? (
              <View style={styles.metaChip}>
                <Ionicons name="time-outline" size={11} color={colors.textMuted} />
                <Text style={styles.metaChipText}>{wait}</Text>
              </View>
            ) : null}
          </View>
        </View>
        {/* Action buttons: Notify (WhatsApp/Messenger/push) + Seat (assign to table) */}
        <View style={styles.actionsCol}>
          <Pressable
            onPress={() => canNotify && !busy && onNotify?.(item)}
            disabled={!canNotify || busy}
            style={({ pressed }) => [
              styles.callBtn,
              !canNotify && styles.btnDisabled,
              { borderColor: canNotify ? notify.color + '55' : colors.border, backgroundColor: canNotify ? notify.color + '14' : colors.surface },
              pressed && canNotify && !busy && { opacity: 0.85 },
            ]}
            accessibilityLabel={t(notify.labelKey, { defaultValue: notify.labelDefault })}
            hitSlop={4}
          >
            <Ionicons name={notify.icon} size={16} color={canNotify ? notify.color : colors.textMuted} />
            <Text
              style={[
                styles.callBtnText,
                { color: canNotify ? notify.color : colors.textMuted },
              ]}
              numberOfLines={1}
            >
              {t(notify.labelKey, { defaultValue: notify.labelDefault })}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => !busy && onSelect(item)}
            disabled={busy}
            style={({ pressed }) => [
              styles.seatBtn,
              pressed && !busy && { opacity: 0.85 },
              busy && { opacity: 0.5 },
            ]}
            accessibilityLabel={t('tables.seat', { defaultValue: 'Seat' })}
            hitSlop={4}
          >
            <Ionicons name="restaurant" size={16} color="#fff" />
            <Text style={styles.seatBtnText}>
              {t('tables.seat', { defaultValue: 'Seat' })}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  };

  const subtitle = tableLabel
    ? t('tables.seatingAt', { code: tableLabel, defaultValue: 'Seating at {{code}}' })
    : '';

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
          // swallow taps inside the sheet so the backdrop Pressable
          // doesn't dismiss when interacting with sheet content
          onStartShouldSetResponder={() => true}
        >
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>
                {t('tables.chooseClient', { defaultValue: 'Choose a customer' })}
              </Text>
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>

          <View style={styles.searchWrap}>
            <Ionicons name="search" size={16} color={colors.textMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('queue.searchPlaceholder', { defaultValue: 'Search name, phone, ticket #' })}
              placeholderTextColor={colors.textMuted}
              style={styles.searchInput}
              autoCorrect={false}
            />
            {query ? (
              <Pressable onPress={() => setQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </View>

          {onCallNext ? (
            <Pressable
              onPress={() => !busy && onCallNext()}
              disabled={busy}
              style={({ pressed }) => [
                styles.callNextBtn,
                pressed && !busy && { opacity: 0.85 },
                busy && { opacity: 0.5 },
              ]}
            >
              <Ionicons name="play-circle" size={18} color="#fff" />
              <Text style={styles.callNextText}>
                {t('queue.callNext', { defaultValue: 'Call next in queue' })}
              </Text>
            </Pressable>
          ) : null}

          {busy ? (
            <View style={styles.busyOverlay}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : null}

          <FlatList
            data={rows}
            keyExtractor={(r) => r.id}
            renderItem={renderRow}
            ItemSeparatorComponent={() => <View style={styles.sep} />}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="people-outline" size={28} color={colors.textMuted} />
                <Text style={styles.emptyText}>
                  {tickets.length === 0
                    ? t('queue.noWaiting', { defaultValue: 'No customers waiting.' })
                    : t('queue.noMatch', { defaultValue: 'No customers match your search.' })}
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
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    maxHeight: '88%',
    paddingTop: spacing.xs,
  },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.xs },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
  title: { fontSize: fontSize.md, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  closeBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    marginHorizontal: spacing.md, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs,
    borderRadius: borderRadius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  searchInput: { flex: 1, fontSize: fontSize.sm, color: colors.text, paddingVertical: 4 },
  callNextBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.xs,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary,
  },
  callNextText: { color: '#fff', fontWeight: '700', fontSize: fontSize.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  posBlock: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primary + '15',
  },
  posText: { fontSize: fontSize.sm, fontWeight: '800', color: colors.primary },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  numText: { fontSize: fontSize.sm, fontWeight: '800', color: colors.text },
  nameText: { fontSize: fontSize.sm, color: colors.text, flex: 1 },
  rowMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  metaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  metaChipText: { fontSize: 10, color: colors.textMuted, fontWeight: '600' },
  phoneChip: {
    backgroundColor: colors.primary + '14',
    borderColor: colors.primary + '55',
  },
  phoneChipText: { color: colors.primary, fontWeight: '700' },
  actionsCol: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 6,
  },
  callBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.primary + '55',
    backgroundColor: colors.primary + '0d',
    minWidth: 72,
  },
  callBtnText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
  seatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary,
    minWidth: 72,
  },
  seatBtnText: {
    fontSize: fontSize.xs,
    fontWeight: '800',
    color: '#fff',
  },
  btnDisabled: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: spacing.md },
  empty: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl },
  emptyText: { fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center' },
  busyOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.05)',
    alignItems: 'center', justifyContent: 'center',
    zIndex: 1,
  },
});
