/**
 * TableActionSheet — bottom-sheet of actions for an occupied / on-hold table.
 *
 * Replaces the previous "tap occupied → silently re-focus" behaviour with an
 * explicit per-table control surface so the operator can run the floor
 * without having to switch back to the queue tab.
 *
 * Shown on tap of any non-free table on the FloorMap. Surfaces:
 *   • Table identity: code, label, zone, capacity
 *   • Seated ticket: number, name, phone, party size, status, elapsed
 *   • Status-aware primary action (Start Serving / Mark Served / Resume)
 *   • Secondary actions: Recall, Move, Release, Park, No-show
 *
 * The sheet is pure UI: it surfaces handlers via props. Caller (desk.tsx)
 * wires each handler to its existing confirmAction-wrapped action so we
 * keep one source of truth for the underlying flow.
 *
 * Locale: FR/AR/EN via i18next + colors.* tokens (light + dark safe).
 */

import { useMemo } from 'react';
import {
  Animated,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSheetAnim } from '@/lib/use-sheet-anim';
import { useTranslation } from 'react-i18next';
import { colors, borderRadius, fontSize, spacing } from '@/lib/theme';
import { computeOrderTotal, type TicketItem, type TicketPayment } from '@qflo/shared';

interface Ticket {
  id: string;
  ticket_number: string;
  status: string;
  customer_data?: { name?: string; phone?: string; party_size?: number | string } | null;
  called_at?: string | null;
  serving_started_at?: string | null;
  parked_at?: string | null;
}

interface TableLite {
  id: string;
  code?: string | null;
  label?: string | null;
  zone?: string | null;
  capacity?: number | null;
  status?: string | null;
}

interface Props {
  visible: boolean;
  table: TableLite | null;
  ticket: Ticket | null;
  /** True when an action is in flight; disables buttons */
  busy?: boolean;
  /** Currency tag rendered next to amounts (e.g. 'DA'). */
  currency?: string;
  /** Decimals for money render (Algeria = 2). */
  decimals?: number;
  /** Editable order items already on this ticket. When provided, the
   *  sheet renders an inline summary with qty +/- and remove. */
  items?: TicketItem[];
  onClose: () => void;
  /** Status-dependent primary action — sheet picks the right label/icon */
  onStartServing?: (ticket: Ticket) => void;
  onMarkServed?: (ticket: Ticket) => void;
  onResume?: (ticket: Ticket) => void;
  /** Secondary actions */
  onRecall?: (ticket: Ticket) => void;
  onMove?: (ticket: Ticket, table: TableLite) => void;
  onReleaseTable?: (table: TableLite) => void;
  onPark?: (ticket: Ticket) => void;
  onNoShow?: (ticket: Ticket) => void;
  onRequeue?: (ticket: Ticket) => void;
  /** Open the OrderPad to add menu items / take an order. */
  onOrder?: (ticket: Ticket) => void;
  /** Existing payments on this ticket (cash / card / mobile). Renders
   *  under the items list so the operator sees what's already paid
   *  before tapping Mark Served. */
  payments?: TicketPayment[];
  /** Inline cart edits — wire to data-adapter from desk.tsx. */
  onItemQty?: (item: TicketItem, nextQty: number) => void;
  onItemRemove?: (item: TicketItem) => void;
}

function formatMoney(amount: number, currency: string, decimals: number): string {
  const dec = Math.max(0, decimals);
  const fixed = (amount ?? 0).toFixed(dec);
  const [intPart, decPart] = fixed.split('.');
  const sign = intPart.startsWith('-') ? '-' : '';
  const body = sign ? intPart.slice(1) : intPart;
  const grouped = body.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202F');
  const num = decPart ? `${sign}${grouped},${decPart}` : `${sign}${grouped}`;
  return currency ? `${num} ${currency}` : num;
}

function formatElapsed(since: string | null | undefined): string {
  if (!since) return '';
  const ms = Date.now() - new Date(since).getTime();
  if (Number.isNaN(ms) || ms < 0) return '';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (m < 1) return `${s}s`;
  if (m < 60) return `${m}m ${s.toString().padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function dialPhone(raw: string) {
  const t = raw.trim();
  if (!t) return;
  if (t.startsWith('+')) { Linking.openURL(`tel:${t}`); return; }
  Linking.openURL(`tel:${t.replace(/\s/g, '')}`);
}

export function TableActionSheet({
  visible,
  table,
  ticket,
  busy = false,
  currency = 'DA',
  decimals = 2,
  items,
  payments,
  onClose,
  onStartServing,
  onMarkServed,
  onResume,
  onRecall,
  onMove,
  onReleaseTable,
  onPark,
  onNoShow,
  onRequeue,
  onOrder,
  onItemQty,
  onItemRemove,
}: Props) {
  const { t } = useTranslation();
  const translateY = useSheetAnim(visible);
  const fmt = (n: number) => formatMoney(n, currency, decimals);
  const orderTotal = useMemo(
    () => (items ? computeOrderTotal(items) : 0),
    [items],
  );
  const orderCount = useMemo(
    () => (items ? items.reduce((s, it) => s + it.qty, 0) : 0),
    [items],
  );
  const paidTotal = useMemo(
    () => (payments ? payments.reduce((s, p) => s + (p.amount ?? 0), 0) : 0),
    [payments],
  );
  const dueAmount = Math.max(0, orderTotal - paidTotal);

  // Aggregate kitchen status across active (non-served) items so floor
  // staff see at a glance whether the food is still being prepared,
  // ready to run, or partially up. Mirrors desk.tsx + KitchenTicketCard.
  const kitchenAgg = useMemo(() => {
    if (!items || !items.length) return null;
    const active = items.filter((i: any) => (i.kitchen_status ?? 'new') !== 'served');
    if (!active.length) return null;
    const set = new Set(active.map((i: any) => i.kitchen_status ?? 'new'));
    const status: 'new' | 'in_progress' | 'ready' | 'mixed' =
      set.size === 1 ? (Array.from(set)[0] as any) : 'mixed';
    return { status, total: active.length };
  }, [items]);

  const partySize = useMemo(() => {
    const ps = ticket?.customer_data?.party_size;
    if (ps == null) return null;
    const n = typeof ps === 'number' ? ps : parseInt(String(ps), 10);
    return Number.isFinite(n) ? n : null;
  }, [ticket?.customer_data?.party_size]);

  const status = ticket?.status ?? null;
  const isCalled = status === 'called';
  const isServing = status === 'serving';
  const isParked = status === 'parked' || (table?.status === 'on_hold' && !ticket);

  const since = isServing
    ? ticket?.serving_started_at
    : isCalled
    ? ticket?.called_at
    : ticket?.parked_at;

  // Primary action per status
  const primary = (() => {
    if (!ticket) return null;
    if (isCalled && onStartServing) {
      return {
        label: t('desk.startService'),
        icon: 'play-circle' as const,
        bg: colors.serving,
        onPress: () => onStartServing(ticket),
      };
    }
    if (isServing && onMarkServed) {
      return {
        label: t('desk.markServed'),
        icon: 'checkmark-circle' as const,
        bg: colors.success,
        onPress: () => onMarkServed(ticket),
      };
    }
    if (isParked && onResume) {
      return {
        label: t('adminQueue.resumeServing', { defaultValue: 'Resume' }),
        icon: 'play-circle' as const,
        bg: colors.called,
        onPress: () => onResume(ticket),
      };
    }
    return null;
  })();

  const tableTitle = (() => {
    if (!table) return '';
    const code = table.code || table.label || '—';
    const sub = table.label && table.label !== table.code ? table.label : null;
    return sub ? `${code}  ·  ${sub}` : code;
  })();

  const tableMeta = (() => {
    if (!table) return '';
    const parts: string[] = [];
    if (table.zone) parts.push(table.zone);
    if (table.capacity) parts.push(t('floorMap.seatsN', { n: table.capacity, defaultValue: '{{n}} seats' }));
    return parts.join(' · ');
  })();

  const phone = ticket?.customer_data?.phone?.trim() || '';
  const name = ticket?.customer_data?.name?.trim() || '';

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.title} numberOfLines={1}>{tableTitle}</Text>
              {tableMeta ? <Text style={styles.subtitle} numberOfLines={1}>{tableMeta}</Text> : null}
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={styles.closeBtn} accessibilityLabel={t('common.cancel')}>
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            {/* Ticket card */}
            {ticket ? (
              <View style={styles.ticketCard}>
                <View style={styles.ticketHeaderRow}>
                  <Text style={styles.ticketNum}>{ticket.ticket_number}</Text>
                  <View
                    style={[
                      styles.statusPill,
                      {
                        backgroundColor:
                          isServing ? colors.servingBg
                          : isCalled ? colors.calledBg
                          : isParked ? colors.warningLight
                          : colors.surface,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.statusDot,
                        {
                          backgroundColor:
                            isServing ? colors.serving
                            : isCalled ? colors.called
                            : isParked ? colors.warning
                            : colors.textMuted,
                        },
                      ]}
                    />
                    <Text
                      style={[
                        styles.statusPillText,
                        {
                          color:
                            isServing ? colors.serving
                            : isCalled ? colors.called
                            : isParked ? colors.warning
                            : colors.textSecondary,
                        },
                      ]}
                    >
                      {isServing ? t('status.serving')
                        : isCalled ? t('status.called')
                        : isParked ? t('operatorQueue.onHold')
                        : status ?? ''}
                    </Text>
                  </View>
                </View>

                {/* Customer line */}
                {(name || phone) ? (
                  <View style={styles.metaRow}>
                    {name ? (
                      <View style={styles.metaItem}>
                        <Ionicons name="person-outline" size={13} color={colors.textMuted} />
                        <Text style={styles.metaText} numberOfLines={1}>{name}</Text>
                      </View>
                    ) : null}
                    {phone ? (
                      <Pressable onPress={() => dialPhone(phone)} style={[styles.metaItem, styles.phoneItem]}>
                        <Ionicons name="call" size={13} color={colors.primary} />
                        <Text style={[styles.metaText, { color: colors.primary, fontWeight: '700' }]} numberOfLines={1}>{phone}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}

                <View style={styles.metaRow}>
                  {partySize ? (
                    <View style={styles.metaItem}>
                      <Ionicons name="people-outline" size={13} color={colors.textMuted} />
                      <Text style={styles.metaText}>
                        {t('tables.partyOf', { n: partySize, defaultValue: 'Party of {{n}}' })}
                      </Text>
                    </View>
                  ) : null}
                  {since ? (
                    <View style={styles.metaItem}>
                      <Ionicons name="time-outline" size={13} color={colors.textMuted} />
                      <Text style={styles.metaText}>{formatElapsed(since)}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            ) : (
              <View style={styles.emptyCard}>
                <Ionicons name="pause-circle-outline" size={22} color={colors.warning} />
                <Text style={styles.emptyCardText}>
                  {t('floorMap.onHold', { defaultValue: 'On hold' })}
                </Text>
              </View>
            )}

            {/* Primary action */}
            {primary ? (
              <Pressable
                onPress={primary.onPress}
                disabled={busy}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  { backgroundColor: primary.bg },
                  pressed && !busy && { opacity: 0.85 },
                  busy && { opacity: 0.5 },
                ]}
              >
                <Ionicons name={primary.icon} size={22} color="#fff" />
                <Text style={styles.primaryBtnText}>{primary.label}</Text>
              </Pressable>
            ) : null}

            {/* Inline editable order summary — restaurant flow. The
                Mark Served action below auto-emits the customer-facing
                receipt over WhatsApp/Messenger via the existing
                notifyCustomer('served') path; no separate payment step
                is required. Operator can adjust quantities or remove
                lines right here without leaving the sheet. */}
            {ticket && items && items.length > 0 ? (
              <View style={styles.orderBox}>
                <View style={styles.orderHeader}>
                  <Text style={styles.orderHeaderLabel}>
                    {t('order.order', { defaultValue: 'Order' })}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.orderHeaderCount}>
                      {orderCount} {orderCount === 1
                        ? t('order.item', { defaultValue: 'item' })
                        : t('order.items', { defaultValue: 'items' })}
                    </Text>
                    {kitchenAgg ? (() => {
                      const cfg = kitchenAgg.status === 'ready'
                        ? { bg: '#16a34a', icon: 'checkmark-done-circle' as const,
                            label: t('desk.kitchenReady', { defaultValue: 'Ready to serve' }) }
                        : kitchenAgg.status === 'in_progress'
                          ? { bg: '#f59e0b', icon: 'flame' as const,
                              label: t('desk.kitchenPreparing', { defaultValue: 'Preparing' }) }
                          : kitchenAgg.status === 'mixed'
                            ? { bg: '#3b82f6', icon: 'restaurant' as const,
                                label: t('desk.kitchenPartial', { defaultValue: 'Partially ready' }) }
                            : { bg: '#64748b', icon: 'time-outline' as const,
                                label: t('desk.kitchenNew', { defaultValue: 'In queue' }) };
                      return (
                        <View style={[styles.kitchenBadge, { backgroundColor: cfg.bg, borderColor: cfg.bg }]}>
                          <Ionicons name={cfg.icon} size={14} color="#fff" />
                          <Text style={styles.kitchenBadgeText}>{cfg.label}</Text>
                        </View>
                      );
                    })() : null}
                  </View>
                </View>

                {items.map((it) => (
                  <View key={it.id} style={styles.orderRow}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.orderRowName} numberOfLines={1}>{it.name}</Text>
                      {it.price != null ? (
                        <Text style={styles.orderRowPrice}>
                          {fmt(it.price)} × {it.qty} = <Text style={{ fontWeight: '800', color: colors.text }}>{fmt(it.price * it.qty)}</Text>
                        </Text>
                      ) : (
                        <Text style={styles.orderRowFree}>
                          {t('order.free', { defaultValue: 'Free' })}
                        </Text>
                      )}
                      {it.note ? (
                        <Text style={styles.orderRowNote} numberOfLines={1}>📝 {it.note}</Text>
                      ) : null}
                    </View>
                    <View style={styles.qtyControls}>
                      <Pressable
                        onPress={() => onItemQty?.(it, it.qty - 1)}
                        disabled={busy || !onItemQty}
                        style={styles.qtyBtn}
                      >
                        <Text style={styles.qtyBtnText}>−</Text>
                      </Pressable>
                      <Text style={styles.qtyText}>{it.qty}</Text>
                      <Pressable
                        onPress={() => onItemQty?.(it, it.qty + 1)}
                        disabled={busy || !onItemQty}
                        style={styles.qtyBtn}
                      >
                        <Text style={styles.qtyBtnText}>+</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => onItemRemove?.(it)}
                        disabled={busy || !onItemRemove}
                        style={[styles.qtyBtn, { marginLeft: 4 }]}
                      >
                        <Ionicons name="trash-outline" size={14} color={colors.error} />
                      </Pressable>
                    </View>
                  </View>
                ))}

                <View style={styles.orderTotalRow}>
                  <Text style={styles.orderTotalLabel}>
                    {t('order.total', { defaultValue: 'Total' })}
                  </Text>
                  <Text style={styles.orderTotalValue}>{fmt(orderTotal)}</Text>
                </View>

                {/* Recorded payments — one row per cash/card/mobile.
                    Mirrors Station's PaymentModal output so the operator
                    can confirm before Mark Served fires the receipt. */}
                {payments && payments.length > 0 ? (
                  <View style={styles.payList}>
                    {payments.map((p) => (
                      <View key={p.id} style={styles.payRow}>
                        <View style={styles.payRowLeft}>
                          <Ionicons
                            name={
                              p.method === 'cash'
                                ? 'cash-outline'
                                : p.method === 'card'
                                ? 'card-outline'
                                : 'phone-portrait-outline'
                            }
                            size={14}
                            color={colors.success}
                          />
                          <Text style={styles.payRowMethod}>
                            {p.method === 'cash'
                              ? t('order.payCash', { defaultValue: 'Cash' })
                              : p.method === 'card'
                              ? t('order.payCard', { defaultValue: 'Card' })
                              : t('order.payMobile', { defaultValue: 'Mobile' })}
                          </Text>
                          {p.tendered != null && p.tendered > p.amount ? (
                            <Text style={styles.payRowChange}>
                              · {t('order.tendered', { defaultValue: 'Tendered' })} {fmt(p.tendered)} · {t('order.change', { defaultValue: 'Change' })} {fmt((p.tendered ?? 0) - p.amount)}
                            </Text>
                          ) : null}
                        </View>
                        <Text style={styles.payRowAmount}>{fmt(p.amount)}</Text>
                      </View>
                    ))}
                    <View style={styles.dueRow}>
                      <Text style={styles.dueLabel}>
                        {dueAmount > 0
                          ? t('order.due', { defaultValue: 'Due' })
                          : t('order.paid', { defaultValue: 'Paid' })}
                      </Text>
                      <Text style={[
                        styles.dueValue,
                        dueAmount > 0 ? { color: colors.warning } : { color: colors.success },
                      ]}>
                        {fmt(dueAmount)}
                      </Text>
                    </View>
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* Add items button. Cash collection is now folded into the
                Mark Served flow — operator taps Mark Served at the top
                and sees the order summary + cash recorder + receipt
                send-off in one combined sheet. */}
            {ticket && onOrder ? (
              <Pressable
                onPress={() => onOrder(ticket)}
                disabled={busy}
                style={({ pressed }) => [
                  styles.orderBtn,
                  pressed && !busy && { opacity: 0.85 },
                  busy && { opacity: 0.5 },
                ]}
              >
                <Ionicons name="restaurant-outline" size={18} color={colors.primary} />
                <Text style={styles.orderBtnText}>
                  {items && items.length > 0
                    ? t('order.addMore', { defaultValue: 'Add more items' })
                    : t('order.addItems', { defaultValue: 'Add items' })}
                </Text>
              </Pressable>
            ) : null}

            {/* Secondary actions grid */}
            <View style={styles.actionGrid}>
              {isCalled && onRecall && ticket ? (
                <Pressable onPress={() => onRecall(ticket)} disabled={busy} style={styles.actionBtn}>
                  <Ionicons name="volume-high-outline" size={18} color={colors.primary} />
                  <Text style={[styles.actionText, { color: colors.primary }]}>
                    {t('desk.recallCustomer')}
                  </Text>
                </Pressable>
              ) : null}

              {ticket && onMove && table ? (
                <Pressable onPress={() => onMove(ticket, table)} disabled={busy} style={styles.actionBtn}>
                  <Ionicons name="swap-horizontal-outline" size={18} color={colors.text} />
                  <Text style={[styles.actionText, { color: colors.text }]}>
                    {t('tables.move', { defaultValue: 'Move' })}
                  </Text>
                </Pressable>
              ) : null}

              {ticket && onPark ? (
                <Pressable onPress={() => onPark(ticket)} disabled={busy} style={styles.actionBtn}>
                  <Ionicons name="pause-outline" size={18} color={colors.warning} />
                  <Text style={[styles.actionText, { color: colors.warning }]}>
                    {t('adminQueue.park')}
                  </Text>
                </Pressable>
              ) : null}

              {ticket && onRequeue ? (
                <Pressable onPress={() => onRequeue(ticket)} disabled={busy} style={styles.actionBtn}>
                  <Ionicons name="arrow-undo-outline" size={18} color={colors.textSecondary} />
                  <Text style={[styles.actionText, { color: colors.textSecondary }]}>
                    {t('adminQueue.requeue')}
                  </Text>
                </Pressable>
              ) : null}

              {ticket && onNoShow ? (
                <Pressable onPress={() => onNoShow(ticket)} disabled={busy} style={styles.actionBtn}>
                  <Ionicons name="close-circle-outline" size={18} color={colors.error} />
                  <Text style={[styles.actionText, { color: colors.error }]}>
                    {t('desk.markNoShow')}
                  </Text>
                </Pressable>
              ) : null}

              {table && onReleaseTable ? (
                <Pressable onPress={() => onReleaseTable(table)} disabled={busy} style={styles.actionBtn}>
                  <Ionicons name="exit-outline" size={18} color={colors.error} />
                  <Text style={[styles.actionText, { color: colors.error }]}>
                    {t('tables.release', { defaultValue: 'Release table' })}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </ScrollView>
        </Animated.View>
      </View>
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
    maxHeight: '85%',
    paddingTop: spacing.xs,
  },
  handle: {
    alignSelf: 'center',
    width: 36, height: 4, borderRadius: 2,
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
  body: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl, gap: spacing.sm },

  ticketCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    gap: 6,
  },
  ticketHeaderRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  ticketNum: { fontSize: fontSize.lg, fontWeight: '900', color: colors.text },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusPillText: { fontSize: 10, fontWeight: '800' },
  metaRow: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm,
  },
  metaItem: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    minWidth: 0,
  },
  phoneItem: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary + '12',
  },
  metaText: { fontSize: fontSize.xs, color: colors.textSecondary, fontWeight: '600' },

  emptyCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.warningLight,
    borderRadius: borderRadius.lg,
  },
  emptyCardText: { fontSize: fontSize.sm, fontWeight: '700', color: colors.warning },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
  },
  primaryBtnText: { color: '#fff', fontSize: fontSize.md, fontWeight: '800' },
  kitchenBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginVertical: -4,
    borderRadius: borderRadius.full,
  },
  kitchenBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  kitchenBadgeCount: { color: '#fff', fontSize: 12, fontWeight: '600', opacity: 0.9 },

  orderBtn: {
    flexDirection: 'row', alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.primary + '33',
    backgroundColor: colors.primary + '12',
  },
  orderBtnText: {
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: '800',
    color: colors.primary,
  },

  actionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  cashBtn: {
    flexDirection: 'row', alignItems: 'center',
    gap: 6,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.success,
  },
  cashBtnText: {
    fontSize: fontSize.sm,
    fontWeight: '800',
    color: '#fff',
  },

  payList: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    gap: 4,
  },
  payRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  payRowLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
  },
  payRowMethod: {
    fontSize: fontSize.xs,
    fontWeight: '800',
    color: colors.success,
  },
  payRowChange: {
    fontSize: 10,
    color: colors.textMuted,
  },
  payRowAmount: {
    fontSize: fontSize.xs,
    fontWeight: '800',
    color: colors.success,
  },
  dueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 4,
    marginTop: 2,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  dueLabel: {
    fontSize: fontSize.xs,
    fontWeight: '800',
    color: colors.text,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  dueValue: {
    fontSize: fontSize.sm,
    fontWeight: '900',
  },

  orderBox: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    gap: 4,
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  orderHeaderLabel: {
    fontSize: fontSize.xs,
    fontWeight: '800',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  orderHeaderCount: { fontSize: fontSize.xs, color: colors.textMuted, fontWeight: '700' },
  orderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  orderRowName: { fontSize: fontSize.sm, fontWeight: '700', color: colors.text },
  orderRowPrice: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  orderRowFree: { fontSize: fontSize.xs, color: colors.textMuted, fontStyle: 'italic', marginTop: 2 },
  orderRowNote: { fontSize: fontSize.xs, color: colors.warning, fontStyle: 'italic', marginTop: 2 },

  qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  qtyBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyBtnText: { fontSize: fontSize.md, fontWeight: '800', color: colors.text },
  qtyText: { minWidth: 22, textAlign: 'center', fontWeight: '800', fontSize: fontSize.sm, color: colors.text },

  orderTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  orderTotalLabel: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textSecondary },
  orderTotalValue: { fontSize: fontSize.md, fontWeight: '900', color: colors.text },

  actionGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6,
  },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 10,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
    minWidth: '48%',
    flexGrow: 1,
    justifyContent: 'center',
  },
  actionText: { fontSize: fontSize.xs, fontWeight: '700' },
});
