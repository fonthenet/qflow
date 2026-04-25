/**
 * OrderPad — full-screen modal for taking orders against a seated ticket.
 *
 * Mobile mirror of the Station's `apps/desktop/src/components/OrderPad.tsx`.
 * Same flow, same data model, same shared package (`@qflo/shared`):
 *
 *   1. Operator taps a serving table → TableActionSheet → "Add items"
 *   2. OrderPad opens; loads menu_categories + menu_items + ticket_items
 *   3. Tap items to add (stacks same item without note by qty++)
 *   4. Adjust qty / add note / remove
 *   5. Done → returns to TableActionSheet (cart auto-saves to Supabase)
 *   6. Items show inline in the action sheet; "Mark Served" auto-sends
 *      the receipt via the existing notifyCustomer('served') flow
 *
 * All writes go through `@/lib/data-adapter` so they hit Supabase
 * (RLS-protected). The Station's local SQLite picks them up on next sync.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { applyDiscount, type MenuCategory, type MenuItem, type TicketItem } from '@qflo/shared';
import {
  fetchMenuCategories,
  fetchMenuItems,
  fetchTicketItems,
  addTicketItem,
  updateTicketItem,
  deleteTicketItem,
} from '@/lib/data-adapter';
import { useSheetAnim } from '@/lib/use-sheet-anim';
import { useTheme, borderRadius, fontSize, spacing } from '@/lib/theme';

interface Props {
  visible: boolean;
  organizationId: string;
  ticketId: string;
  ticketNumber: string;
  tableCode?: string | null;
  staffId?: string | null;
  currency?: string;
  decimals?: number;
  onClose: () => void;
  onChanged?: () => void;
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

export function OrderPad({
  visible,
  organizationId,
  ticketId,
  ticketNumber,
  tableCode,
  staffId,
  currency = 'DA',
  decimals = 2,
  onClose,
  onChanged,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const translateY = useSheetAnim(visible);

  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [ticketItems, setTicketItems] = useState<TicketItem[]>([]);
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loadMenu = useCallback(async () => {
    try {
      const [cats, items] = await Promise.all([
        fetchMenuCategories(organizationId),
        fetchMenuItems(organizationId),
      ]);
      setCategories(cats);
      setMenuItems(items);
      if (cats.length && !activeCat) setActiveCat(cats[0].id);
    } catch (err) {
      console.warn('[OrderPad] loadMenu failed', err);
    }
  }, [organizationId, activeCat]);

  const loadTicketItems = useCallback(async () => {
    try {
      const rows = await fetchTicketItems(ticketId);
      setTicketItems(rows);
    } catch (err) {
      console.warn('[OrderPad] loadTicketItems failed', err);
    }
  }, [ticketId]);

  useEffect(() => {
    if (visible) {
      loadMenu();
      loadTicketItems();
    }
  }, [visible, loadMenu, loadTicketItems]);

  const byCat = useMemo(() => {
    const map = new Map<string, MenuItem[]>();
    for (const i of menuItems) {
      if (!map.has(i.category_id)) map.set(i.category_id, []);
      map.get(i.category_id)!.push(i);
    }
    return map;
  }, [menuItems]);

  const itemsForActive = activeCat ? (byCat.get(activeCat) ?? []) : [];

  /** Look up how many of a menu item are currently in the cart (note-less
   *  lines only — those are what the +1 tap stacks onto). Used for the
   *  qty badge on each tile so the operator can see at a glance what's
   *  already on the ticket. */
  const cartQtyByMenuItem = useMemo(() => {
    const m = new Map<string, number>();
    for (const ti of ticketItems) {
      if (ti.menu_item_id && !ti.note) {
        m.set(ti.menu_item_id, (m.get(ti.menu_item_id) ?? 0) + ti.qty);
      }
    }
    return m;
  }, [ticketItems]);

  const totalCount = useMemo(
    () => ticketItems.reduce((s, ti) => s + ti.qty, 0),
    [ticketItems],
  );

  const fmt = (n: number) => formatMoney(n, currency, decimals);

  const addItem = async (item: MenuItem) => {
    // Stack same-item-no-note lines (Toast/Square behavior).
    const existing = ticketItems.find((ti) => ti.menu_item_id === item.id && !ti.note);
    setBusy(item.id);
    try {
      if (existing) {
        await updateTicketItem(existing.id, { qty: existing.qty + 1 });
      } else {
        const dp = Number(item.discount_percent ?? 0);
        const unitPrice = item.price != null && dp > 0
          ? applyDiscount(item.price, dp)
          : item.price;
        await addTicketItem({
          ticketId,
          organizationId,
          menuItemId: item.id,
          name: item.name,
          price: unitPrice,
          qty: 1,
          addedBy: staffId ?? null,
        });
      }
      await loadTicketItems();
      onChanged?.();
    } finally {
      setBusy(null);
    }
  };

  /** Decrement the note-less cart line for this menu item. Removes the
   *  line entirely when qty hits 0 so the ×N badge disappears. Lines
   *  with notes are left alone (operator must edit them in the action
   *  sheet). Mirrors Station's OrderPad row stepper. */
  const decItem = async (item: MenuItem) => {
    const existing = ticketItems.find((ti) => ti.menu_item_id === item.id && !ti.note);
    if (!existing) return;
    setBusy(item.id);
    try {
      if (existing.qty <= 1) {
        await deleteTicketItem(existing.id);
      } else {
        await updateTicketItem(existing.id, { qty: existing.qty - 1 });
      }
      await loadTicketItems();
      onChanged?.();
    } finally {
      setBusy(null);
    }
  };

  const styles = makeStyles(colors);

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

          {/* Compact header — single line: title + ticket/table chip + close */}
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>
              {t('order.menu', { defaultValue: 'Menu' })}
            </Text>
            <View style={styles.ticketChip}>
              <Text style={styles.ticketChipText} numberOfLines={1}>
                {ticketNumber}{tableCode ? ` · ${tableCode}` : ''}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>

          {/* Categories rail — compact pill tabs (not giant circles).
              Tight horizontal strip so the menu list dominates the
              sheet, the way Square Mobile / Toast Go do it. */}
          {categories.length === 0 ? (
            <Text style={styles.emptyHint}>
              {t('order.noMenu', { defaultValue: 'No menu yet. Open Settings → Menu to add categories and items.' })}
            </Text>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.catRailScroll}
              contentContainerStyle={styles.catRail}
            >
              {categories.map((c) => {
                const isActive = c.id === activeCat;
                const tint = c.color || colors.primary;
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => setActiveCat(c.id)}
                    style={[
                      styles.catPill,
                      {
                        backgroundColor: isActive ? tint : colors.surface,
                        borderColor: isActive ? tint : colors.border,
                      },
                    ]}
                  >
                    {c.icon ? (
                      <Text style={{ fontSize: 14, marginRight: 4 }}>{c.icon}</Text>
                    ) : null}
                    <Text style={{
                      fontSize: fontSize.xs,
                      fontWeight: '800',
                      color: isActive ? '#fff' : colors.text,
                    }}>
                      {c.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          {/* Item list — single-column rows (mobile-first; phones scan
              vertically faster than they parse 2-col tiles). Each row:
                [name + sub-price]  [qty badge if in cart]  [+]
              The + button isn't really needed — tapping the row also
              adds — but having it visible advertises tappability. */}
          <ScrollView style={styles.itemList} contentContainerStyle={styles.itemListContent}>
            {itemsForActive.length === 0 && categories.length > 0 ? (
              <Text style={styles.emptyHint}>
                {t('order.noItemsCategory', { defaultValue: 'No items in this category yet.' })}
              </Text>
            ) : null}
            {itemsForActive.map((it) => {
              const dp = Number(it.discount_percent ?? 0);
              const finalPrice = it.price != null && dp > 0 ? applyDiscount(it.price, dp) : it.price;
              const inCartQty = cartQtyByMenuItem.get(it.id) ?? 0;
              const isBusy = busy === it.id;
              return (
                <Pressable
                  key={it.id}
                  onPress={() => addItem(it)}
                  disabled={isBusy}
                  style={({ pressed }) => [
                    styles.itemRow,
                    inCartQty > 0 && {
                      borderColor: colors.primary,
                      backgroundColor: colors.primary + '08',
                    },
                    pressed && !isBusy && { opacity: 0.7 },
                    isBusy && { opacity: 0.5 },
                  ]}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.itemRowName} numberOfLines={1}>{it.name}</Text>
                    {it.price != null ? (
                      dp > 0 ? (
                        <View style={styles.priceLine}>
                          <Text style={styles.priceFinal}>{fmt(finalPrice ?? 0)}</Text>
                          <Text style={styles.priceStrike}>{fmt(it.price)}</Text>
                          <View style={styles.discBadge}>
                            <Text style={styles.discBadgeText}>-{dp}%</Text>
                          </View>
                        </View>
                      ) : (
                        <Text style={styles.priceFinal}>{fmt(it.price)}</Text>
                      )
                    ) : (
                      <Text style={styles.freeLabel}>{t('order.free', { defaultValue: 'Free' })}</Text>
                    )}
                  </View>

                  {/* Trailing controls: stepper when in cart, single +
                      otherwise. Inner Pressables capture their own taps
                      (RN responder system), so − doesn't trigger row's
                      addItem. */}
                  {inCartQty > 0 ? (
                    <View style={styles.stepper}>
                      <Pressable
                        onPress={() => decItem(it)}
                        disabled={isBusy}
                        hitSlop={6}
                        style={styles.stepperMinus}
                      >
                        <Ionicons name="remove" size={18} color={colors.primary} />
                      </Pressable>
                      <View style={styles.stepperQty}>
                        <Text style={styles.stepperQtyText}>{inCartQty}</Text>
                      </View>
                      <Pressable
                        onPress={() => addItem(it)}
                        disabled={isBusy}
                        hitSlop={6}
                        style={styles.stepperPlus}
                      >
                        <Ionicons name="add" size={18} color="#fff" />
                      </Pressable>
                    </View>
                  ) : (
                    <View style={styles.addBtn}>
                      <Ionicons name="add" size={20} color="#fff" />
                    </View>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Slim sticky footer — Done button with item count badge.
              The full editable cart lives in the TableActionSheet now;
              this just confirms what's been added so far and dismisses. */}
          <View style={styles.footer}>
            <Pressable onPress={onClose} style={styles.doneBtn}>
              <Ionicons name="checkmark" size={18} color="#fff" />
              <Text style={styles.doneBtnText}>
                {t('common.done', { defaultValue: 'Done' })}
              </Text>
              {totalCount > 0 ? (
                <View style={styles.doneCountBadge}>
                  <Text style={styles.doneCountBadgeText}>{totalCount}</Text>
                </View>
              ) : null}
            </Pressable>
          </View>
        </Animated.View>
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
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: borderRadius.xl,
      borderTopRightRadius: borderRadius.xl,
      maxHeight: '92%',
      minHeight: '70%',
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
      backgroundColor: colors.primary + '14',
      alignSelf: 'center',
    },
    ticketChipText: {
      fontSize: fontSize.xs,
      fontWeight: '700',
      color: colors.primary,
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

    catRailScroll: {
      // RN horizontal ScrollView stretches vertically inside a column
      // flex parent if not constrained — pin height + flexGrow 0 to
      // kill the giant blank gaps above/below the pills.
      flexGrow: 0,
      flexShrink: 0,
    },
    catRail: {
      paddingHorizontal: spacing.md,
      paddingVertical: 4,
      gap: 6,
      flexDirection: 'row',
      alignItems: 'center',
    },
    catPill: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: borderRadius.full,
      borderWidth: 1,
      flexDirection: 'row',
      alignItems: 'center',
    },

    itemList: { flex: 1 },
    itemListContent: {
      paddingHorizontal: spacing.md,
      paddingTop: 4,
      paddingBottom: spacing.sm,
      gap: 6,
    },
    itemRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: 10,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    itemRowName: { fontSize: fontSize.sm, fontWeight: '700', color: colors.text },
    priceLine: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 2 },
    priceStrike: { fontSize: fontSize.xs, color: colors.textMuted, textDecorationLine: 'line-through' },
    priceFinal: { fontSize: fontSize.sm, fontWeight: '800', color: colors.success, marginTop: 2 },
    discBadge: { backgroundColor: colors.error, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4 },
    discBadgeText: { fontSize: 9, color: '#fff', fontWeight: '800' },
    freeLabel: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2, fontStyle: 'italic' },

    addBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepper: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: borderRadius.full,
      borderWidth: 1,
      borderColor: colors.primary,
      backgroundColor: colors.background,
      overflow: 'hidden',
    },
    stepperMinus: {
      width: 34,
      height: 34,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepperQty: {
      minWidth: 28,
      paddingHorizontal: 4,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepperQtyText: {
      fontSize: fontSize.sm,
      fontWeight: '800',
      color: colors.primary,
    },
    stepperPlus: {
      width: 34,
      height: 34,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary,
    },

    emptyHint: {
      textAlign: 'center',
      color: colors.textMuted,
      fontSize: fontSize.xs,
      padding: spacing.md,
      width: '100%',
    },

    footer: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      paddingBottom: spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.borderLight,
      backgroundColor: colors.background,
    },
    doneBtn: {
      paddingVertical: spacing.sm + 2,
      borderRadius: borderRadius.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.primary,
    },
    doneBtnText: { fontSize: fontSize.sm, fontWeight: '800', color: '#fff' },
    doneCountBadge: {
      minWidth: 22,
      height: 22,
      paddingHorizontal: 6,
      borderRadius: 11,
      backgroundColor: '#ffffff33',
      alignItems: 'center',
      justifyContent: 'center',
    },
    doneCountBadgeText: { fontSize: fontSize.xs, fontWeight: '800', color: '#fff' },
  });
