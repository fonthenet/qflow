/**
 * ServeSheet (file kept as CashPaymentSheet.tsx to preserve imports) —
 * combined "Mark served + record cash + send receipt" flow.
 *
 * Triggered from TableActionSheet's "Mark served" button. Shows:
 *   1. The order summary (items × qty + line totals + grand total)
 *   2. Already-paid breakdown (if any payments exist)
 *   3. Due amount + cash tendered input + change line (only when due > 0)
 *   4. A single primary "Finish & send receipt" button that:
 *        - if cash is tendered: records a ticket_payments row first
 *        - then calls markServed(ticket) which auto-builds the receipt
 *          block and notifies the customer (existing server-side flow)
 *
 * Mirrors Station's "Mark Served → confirm summary → notify" flow but
 * folds the payment step in so operators don't have to tap two buttons.
 */

import { useMemo, useRef, useState } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { TicketItem, TicketPayment } from '@qflo/shared';
import { createTicketPayment } from '@/lib/data-adapter';
import { useSheetAnim } from '@/lib/use-sheet-anim';
import { useTheme, borderRadius, fontSize, spacing } from '@/lib/theme';

interface Props {
  visible: boolean;
  organizationId: string;
  ticketId: string;
  ticketNumber: string;
  tableCode?: string | null;
  staffId?: string | null;
  items: TicketItem[];
  payments?: TicketPayment[];
  currency?: string;
  decimals?: number;
  onClose: () => void;
  /** Called after optional payment recording. Should mark the ticket
   *  served and trigger the receipt-notify flow server-side. Sheet
   *  closes after this resolves. */
  onFinish: (ticketId: string) => Promise<void> | void;
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

/** Parse tendered string (operator's locale, e.g. "1.500,00" or "1500")
 *  back to a number. Tolerant of comma OR dot decimal, plus spacing. */
function parseTendered(input: string): number {
  if (!input) return 0;
  const cleaned = input.replace(/[\s\u202F]/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export function CashPaymentSheet({
  visible,
  organizationId,
  ticketId,
  ticketNumber,
  tableCode,
  staffId,
  items,
  payments = [],
  currency = 'DA',
  decimals = 2,
  onClose,
  onFinish,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const translateY = useSheetAnim(visible);

  const total = useMemo(
    () => items.reduce((s, it) => s + ((it.price ?? 0) * it.qty), 0),
    [items],
  );
  const alreadyPaid = useMemo(
    () => payments.reduce((s, p) => s + (p.amount ?? 0), 0),
    [payments],
  );
  const due = Math.max(0, total - alreadyPaid);

  const [tendered, setTendered] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const tenderedAmt = tendered === '' ? 0 : parseTendered(tendered);
  const change = Math.max(0, tenderedAmt - due);
  const willPay = due > 0 && tendered !== '' && tenderedAmt >= due;
  const tenderedShort = due > 0 && tendered !== '' && tenderedAmt < due;

  const fmt = (n: number) => formatMoney(n, currency, decimals);

  // Quick-tender shortcuts
  const quickAdds = useMemo(() => {
    if (due <= 0) return [] as number[];
    const rounded = Math.ceil(due / 100) * 100;
    const set = new Set<number>([rounded, rounded + 500, rounded + 1000, 2000, 5000]);
    return Array.from(set).filter((v) => v >= due).sort((a, b) => a - b).slice(0, 4);
  }, [due]);

  const finish = async () => {
    setErr(null);
    if (tenderedShort) {
      setErr(t('order.tenderedShort', { defaultValue: 'Tendered is less than total.' }));
      return;
    }
    setBusy(true);
    try {
      // 1. Record cash payment IF the operator entered a tendered amount.
      //    Otherwise skip and just mark served (e.g. unpaid / on-account).
      if (willPay) {
        await createTicketPayment({
          ticketId,
          organizationId,
          method: 'cash',
          amount: due,
          tendered: tenderedAmt,
          changeGiven: change,
          note: note.trim() || null,
          paidBy: staffId ?? null,
        });
      }
      // 2. Mark served + send receipt (server-side notifyCustomer hook
      //    builds the receipt block from items + payments).
      await onFinish(ticketId);
      onClose();
    } catch (e: any) {
      setErr(e?.message ?? t('order.paymentFailed', { defaultValue: 'Could not finish.' }));
    } finally {
      setBusy(false);
    }
  };

  const styles = makeStyles(colors);

  // Build the primary button label based on state
  const primaryLabel = busy
    ? t('order.processing', { defaultValue: 'Processing…' })
    : willPay
      ? `${t('desk.payAndFinish', { defaultValue: 'Pay & finish' })} · ${fmt(due)}`
      : due > 0
        ? t('desk.finishUnpaid', { defaultValue: 'Finish without payment' })
        : t('desk.finishAndSend', { defaultValue: 'Finish & send receipt' });

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      statusBarTranslucent
      onRequestClose={busy ? undefined : onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={busy ? undefined : onClose} />
        {/* KeyboardAvoidingView lifts the whole sheet above the iOS
            keyboard so the cash-received input never slides under it.
            On Android the soft keyboard auto-resizes the window so we
            don't need padding behavior — and using 'height' there
            actually breaks the modal layout. */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.kbWrap}
          pointerEvents="box-none"
        >
        <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>
              {t('desk.markServed', { defaultValue: 'Mark served' })}
            </Text>
            <View style={styles.ticketChip}>
              <Text style={styles.ticketChipText} numberOfLines={1}>
                {ticketNumber}{tableCode ? ` · ${tableCode}` : ''}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              style={styles.closeBtn}
              disabled={busy}
            >
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>

          <ScrollView
            ref={scrollRef}
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          >
            {/* Order summary — items × qty + line totals */}
            {items.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                  {t('order.summary', { defaultValue: 'Order summary' })}
                </Text>
                <View style={styles.itemsCard}>
                  {items.map((it) => {
                    const lineTotal = (it.price ?? 0) * it.qty;
                    return (
                      <View key={it.id} style={styles.itemRow}>
                        <Text style={styles.itemQty}>{it.qty}×</Text>
                        <View style={styles.itemNameWrap}>
                          <Text style={styles.itemName} numberOfLines={2}>
                            {it.name}
                          </Text>
                          {it.note ? (
                            <Text style={styles.itemNote} numberOfLines={2}>
                              {it.note}
                            </Text>
                          ) : null}
                        </View>
                        <Text style={styles.itemAmt}>
                          {(it.price ?? 0) > 0
                            ? fmt(lineTotal)
                            : t('order.free', { defaultValue: 'Free' })}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            ) : (
              <View style={styles.emptyHint}>
                <Ionicons name="receipt-outline" size={18} color={colors.textMuted} />
                <Text style={styles.emptyHintText}>
                  {t('order.noItems', { defaultValue: 'No items on this ticket' })}
                </Text>
              </View>
            )}

            {/* Total / paid / due */}
            <View style={styles.totalCard}>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>
                  {t('order.total', { defaultValue: 'Total' })}
                </Text>
                <Text style={styles.totalValue}>{fmt(total)}</Text>
              </View>
              {alreadyPaid > 0 ? (
                <View style={styles.subRow}>
                  <Text style={styles.subLabel}>
                    {t('order.alreadyPaid', { defaultValue: 'Already paid' })}
                  </Text>
                  <Text style={styles.subValue}>−{fmt(alreadyPaid)}</Text>
                </View>
              ) : null}
              <View style={styles.dueRow}>
                <Text style={styles.dueLabel}>
                  {due > 0
                    ? t('order.due', { defaultValue: 'Due' })
                    : t('order.paid', { defaultValue: 'Paid' })}
                </Text>
                <Text style={[
                  styles.dueValue,
                  { color: due > 0 ? colors.primary : colors.success },
                ]}>{fmt(due)}</Text>
              </View>
            </View>

            {/* Cash input — only when there's still a balance due */}
            {due > 0 ? (
              <>
                <Text style={styles.fieldLabel}>
                  {t('order.cashReceived', { defaultValue: 'Cash received' })}
                </Text>
                <TextInput
                  value={tendered}
                  onChangeText={setTendered}
                  keyboardType="decimal-pad"
                  placeholder={fmt(due)}
                  placeholderTextColor={colors.textMuted}
                  style={[
                    styles.tenderInput,
                    tenderedShort && { borderColor: colors.error },
                  ]}
                  editable={!busy}
                  onFocus={() => {
                    // When the soft keyboard pops, KeyboardAvoidingView
                    // lifts the sheet but the ScrollView's content can
                    // sit too high. Scroll the input into view after a
                    // tick so the operator sees what they're typing
                    // plus the change line right below.
                    setTimeout(() => scrollRef.current?.scrollTo({ y: 200, animated: true }), 200);
                  }}
                />

                <View style={styles.quickRow}>
                  <Pressable
                    onPress={() => setTendered(String(due))}
                    style={[styles.quickBtn, styles.quickBtnExact]}
                    disabled={busy}
                  >
                    <Text style={styles.quickBtnExactText}>
                      {t('order.exact', { defaultValue: 'Exact' })}
                    </Text>
                  </Pressable>
                  {quickAdds.map((v) => (
                    <Pressable
                      key={v}
                      onPress={() => setTendered(String(v))}
                      style={styles.quickBtn}
                      disabled={busy}
                    >
                      <Text style={styles.quickBtnText}>{fmt(v)}</Text>
                    </Pressable>
                  ))}
                  {tendered ? (
                    <Pressable
                      onPress={() => setTendered('')}
                      style={styles.quickBtn}
                      disabled={busy}
                    >
                      <Text style={styles.quickBtnText}>
                        {t('order.clear', { defaultValue: 'Clear' })}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>

                <View style={styles.changeCard}>
                  <Text style={styles.changeLabel}>
                    {t('order.change', { defaultValue: 'Change' })}
                  </Text>
                  <Text
                    style={[
                      styles.changeValue,
                      tenderedShort
                        ? { color: colors.error }
                        : { color: willPay ? colors.success : colors.textMuted },
                    ]}
                  >
                    {tenderedShort
                      ? `−${fmt(due - tenderedAmt)}`
                      : fmt(change)}
                  </Text>
                </View>

                <Text style={styles.fieldLabel}>
                  {t('order.noteOptional', { defaultValue: 'Note — optional' })}
                </Text>
                <TextInput
                  value={note}
                  onChangeText={setNote}
                  placeholder={t('order.notePayHint', { defaultValue: 'e.g. tip, voucher…' })}
                  placeholderTextColor={colors.textMuted}
                  style={styles.noteInput}
                  editable={!busy}
                />
              </>
            ) : null}

            {err ? <Text style={styles.errText}>{err}</Text> : null}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              onPress={finish}
              disabled={busy || tenderedShort}
              style={[
                styles.payBtn,
                {
                  backgroundColor:
                    willPay || due === 0 ? colors.success : colors.warning,
                },
                (busy || tenderedShort) && { opacity: 0.5 },
              ]}
            >
              <Ionicons
                name={willPay ? 'cash-outline' : 'checkmark-circle'}
                size={18}
                color="#fff"
              />
              <Text style={styles.payBtnText}>{primaryLabel}</Text>
            </Pressable>
            <Text style={styles.footerHint}>
              {t('desk.serveReceiptHint', {
                defaultValue: 'A receipt will be sent to the customer.',
              })}
            </Text>
          </View>
        </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      justifyContent: 'flex-end',
    },
    // Wraps the sheet inside a KeyboardAvoidingView so iOS lifts the
    // sheet above the keyboard. flex:1 + justifyContent end keeps the
    // sheet anchored to the bottom of the available space.
    kbWrap: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: borderRadius.xl,
      borderTopRightRadius: borderRadius.xl,
      maxHeight: '92%',
      paddingTop: 4,
    },
    handle: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
      marginBottom: 4,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingTop: 6,
      paddingBottom: 8,
      gap: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderLight,
    },
    title: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text, flexShrink: 1 },
    ticketChip: {
      flex: 1,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: borderRadius.full,
      backgroundColor: colors.success + '14',
      alignSelf: 'center',
    },
    ticketChipText: {
      fontSize: fontSize.xs,
      fontWeight: '700',
      color: colors.success,
      textAlign: 'center',
    },
    closeBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
    },

    body: { flexGrow: 0 },
    bodyContent: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      paddingBottom: spacing.md,
      gap: spacing.sm,
    },

    section: { gap: 6 },
    sectionTitle: {
      fontSize: fontSize.xs,
      color: colors.textMuted,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    itemsCard: {
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingVertical: 4,
    },
    itemRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: 6,
      gap: spacing.sm,
    },
    itemQty: {
      fontSize: fontSize.sm,
      fontWeight: '800',
      color: colors.primary,
      minWidth: 28,
    },
    itemNameWrap: { flex: 1 },
    itemName: { fontSize: fontSize.sm, fontWeight: '700', color: colors.text },
    itemNote: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 1 },
    itemAmt: { fontSize: fontSize.sm, fontWeight: '800', color: colors.text },

    emptyHint: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: spacing.sm,
    },
    emptyHintText: { fontSize: fontSize.sm, color: colors.textMuted, fontWeight: '600' },

    totalCard: {
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      padding: spacing.sm + 2,
      gap: 4,
    },
    totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    totalLabel: { fontSize: fontSize.sm, color: colors.textSecondary, fontWeight: '700' },
    totalValue: { fontSize: fontSize.md, fontWeight: '800', color: colors.text },
    subRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    subLabel: { fontSize: fontSize.xs, color: colors.textMuted },
    subValue: { fontSize: fontSize.xs, color: colors.textMuted },
    dueRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingTop: 6,
      marginTop: 2,
      borderTopWidth: 1,
      borderTopColor: colors.borderLight,
    },
    dueLabel: { fontSize: fontSize.sm, color: colors.text, fontWeight: '800' },
    dueValue: { fontSize: fontSize.xl, fontWeight: '900' },

    fieldLabel: {
      fontSize: fontSize.xs,
      color: colors.textMuted,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginTop: 4,
    },
    tenderInput: {
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: spacing.sm,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: '800',
    },
    quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    quickBtn: {
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: borderRadius.full,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    quickBtnExact: {
      borderColor: colors.primary,
      backgroundColor: colors.primary + '14',
    },
    quickBtnText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.text },
    quickBtnExactText: { fontSize: fontSize.xs, fontWeight: '800', color: colors.primary },

    changeCard: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: spacing.sm,
    },
    changeLabel: { fontSize: fontSize.sm, color: colors.textSecondary, fontWeight: '700' },
    changeValue: { fontSize: fontSize.lg, fontWeight: '900' },

    noteInput: {
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: spacing.sm,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      color: colors.text,
      fontSize: fontSize.sm,
    },
    errText: {
      fontSize: fontSize.xs,
      color: colors.error,
      fontWeight: '700',
      textAlign: 'center',
      marginTop: 4,
    },

    footer: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      paddingBottom: spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.borderLight,
      backgroundColor: colors.background,
      gap: 6,
    },
    payBtn: {
      paddingVertical: spacing.sm + 2,
      borderRadius: borderRadius.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    payBtnText: { fontSize: fontSize.sm, fontWeight: '800', color: '#fff' },
    footerHint: {
      fontSize: fontSize.xs,
      color: colors.textMuted,
      textAlign: 'center',
      fontStyle: 'italic',
    },
  });
