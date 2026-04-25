/**
 * Menu / Order / Payment types — shared across web, Station, and Expo.
 * Mirrors the Supabase schema (`20260422183000_add_menu_and_ticket_items`,
 * `20260422220000_add_menu_items_discount_percent`) and the Station's
 * local SQLite schema in `apps/desktop/electron/db.ts`.
 *
 * IMPORTANT: ticket_items snapshot the menu item's name + price at order
 * time so subsequent menu edits (or item deletions) don't rewrite history.
 */

export interface MenuCategory {
  id: string;
  organization_id: string;
  name: string;
  sort_order: number;
  color?: string | null;
  icon?: string | null;
  active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface MenuItem {
  id: string;
  organization_id: string;
  category_id: string;
  name: string;
  /** Null = "ask price" / open price; usually means free or POS-prompted. */
  price: number | null;
  /** Integer 0-100. Applied at add-time to compute the snapshot price on
   *  ticket_items.price; not stored on the line itself. */
  discount_percent: number;
  sort_order: number;
  active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface TicketItem {
  id: string;
  ticket_id: string;
  organization_id: string;
  /** Null when an item is added ad-hoc (custom line, not from menu). */
  menu_item_id: string | null;
  /** Snapshotted name — survives menu deletes / renames. */
  name: string;
  /** Snapshotted unit price after discount. Null = free / open. */
  price: number | null;
  qty: number;
  note?: string | null;
  added_at: string;
  added_by?: string | null;
  /** Kitchen Display System lifecycle (restaurant/cafe vertical):
   *    new          → just sent to kitchen, not started
   *    in_progress  → cook acknowledged + started preparing
   *    ready        → plated, waiting for runner / expo
   *    served       → delivered to the table
   *  Defaults to 'new' on insert. Non-food verticals can ignore. */
  kitchen_status?: 'new' | 'in_progress' | 'ready' | 'served';
  kitchen_status_at?: string | null;
}

export interface TicketPayment {
  id: string;
  ticket_id: string;
  organization_id: string;
  method: 'cash' | 'card' | 'mobile_money' | 'cib' | 'edahabia' | 'stripe' | 'other';
  /** Final amount charged. */
  amount: number;
  /** For cash only: how much the customer handed over. */
  tendered?: number | null;
  /** For cash only: amount returned. */
  change_given?: number | null;
  note?: string | null;
  paid_at: string;
  paid_by?: string | null;
}

/**
 * Compute the running total for a list of ticket items. Pure helper —
 * web, Station, and Expo all use it so the number on the cart, the
 * payment sheet, and the receipt are guaranteed to match.
 */
export function computeOrderTotal(items: Pick<TicketItem, 'price' | 'qty'>[]): number {
  let total = 0;
  for (const it of items) {
    if (it.price != null && Number.isFinite(it.price)) total += it.price * it.qty;
  }
  // Avoid float drift: round to 2 dp.
  return Math.round(total * 100) / 100;
}

/**
 * Apply a discount % to a unit price and round to 2 dp. Used both when
 * adding an item to the cart (snapshot the discounted price into
 * ticket_items.price) and in admin previews.
 */
export function applyDiscount(price: number, discountPercent: number): number {
  if (!Number.isFinite(price)) return 0;
  const dp = Math.max(0, Math.min(100, Number(discountPercent) || 0));
  if (dp === 0) return Math.round(price * 100) / 100;
  return Math.round(price * (1 - dp / 100) * 100) / 100;
}
