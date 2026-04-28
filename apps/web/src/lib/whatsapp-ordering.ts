import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { resolveRestaurantServiceType, computeOrderEtaMinutes, type CartItem } from '@qflo/shared';
import { nanoid } from 'nanoid';
import type { Locale, SendFn } from '@/lib/messaging-commands';

/**
 * Pure-WhatsApp ordering flow.
 *
 * State machine, all driven by `whatsapp_sessions.state` + payload in
 * `whatsapp_sessions.custom_intake_data`:
 *
 *   pending_order_browse   — bot showed the menu, awaiting cart codes
 *                            (e.g. "1 5 7x2") or DONE / CANCEL
 *   pending_order_review   — bot showed running cart summary, awaiting
 *                            NAME <name>, ADD, CANCEL, or more codes
 *   pending_order_address  — delivery only: awaiting street/instructions
 *   pending_order_confirm  — final YES / NO before the ticket lands
 *
 * The order is created directly via Supabase (no HTTP hop to /api/orders/place)
 * to avoid a self-fetch on the same Vercel deployment. The cart shape and
 * validation logic mirror /api/orders/place exactly.
 */

// Shape stored under custom_intake_data while the order flow is in progress.
interface OrderSessionPayload {
  kind: 'wa_order';
  service: 'takeout' | 'delivery';
  office_id: string;
  service_id: string;
  department_id: string;
  organization_id: string;
  /** Item snapshot used for code lookup. Indices are 1-based. */
  catalog: Array<{
    code: number;
    menu_item_id: string;
    name: string;
    unit_price: number;
    prep_time_minutes: number | null;
    category: string;
  }>;
  /** Customer's running cart, keyed by menu_item_id. */
  cart: Record<string, { qty: number; name: string; unit_price: number; prep_time_minutes: number | null }>;
  /** Captured progressively. */
  customer_name?: string;
  delivery_address?: { street: string; instructions?: string };
}

// ── Templates ────────────────────────────────────────────────────────
// Inline rather than added to messages.ts to keep ordering self-contained.

function tplMenuHeader(orgName: string, locale: Locale): string {
  if (locale === 'ar') return `🍽️ *قائمة ${orgName}*`;
  if (locale === 'en') return `🍽️ *${orgName} — Menu*`;
  return `🍽️ *Menu — ${orgName}*`;
}

function tplMenuFooter(locale: Locale): string {
  if (locale === 'ar') {
    return [
      '',
      'أرسل أرقام المنتجات لإضافتها للسلة.',
      'مثال: `1 3 5x2` — يضيف ١، ٣، و٥ بكمية ٢',
      'أرسل *إلغاء* للإلغاء.',
    ].join('\n');
  }
  if (locale === 'en') {
    return [
      '',
      'Reply with item numbers to add to cart.',
      'Example: `1 3 5x2` — adds items 1, 3, and 5 with qty 2',
      'Send *CANCEL* to abort.',
    ].join('\n');
  }
  return [
    '',
    'Répondez avec les numéros pour ajouter au panier.',
    'Exemple : `1 3 5x2` — ajoute 1, 3 et 5 avec qté 2',
    'Envoyez *ANNULER* pour annuler.',
  ].join('\n');
}

function tplEmptyMenu(locale: Locale): string {
  if (locale === 'ar') return '❌ لا توجد منتجات متاحة حاليًا في القائمة. حاول مرة أخرى لاحقًا.';
  if (locale === 'en') return '❌ No items available right now. Please try again later.';
  return "❌ Aucun article disponible pour le moment. Veuillez réessayer plus tard.";
}

function tplNoCodesParsed(locale: Locale): string {
  if (locale === 'ar') return '⚠️ لم أفهم. أرسل أرقام المنتجات (مثال: `1 3 5x2`) أو *إلغاء*.';
  if (locale === 'en') return "⚠️ I didn't catch that. Send item numbers (e.g. `1 3 5x2`) or *CANCEL*.";
  return "⚠️ Je n'ai pas compris. Envoyez les numéros (ex : `1 3 5x2`) ou *ANNULER*.";
}

function tplCart(payload: OrderSessionPayload, locale: Locale, currency: string): string {
  const lines: string[] = [];
  lines.push(locale === 'ar' ? '🛒 *سلتك*' : locale === 'en' ? '🛒 *Your cart*' : '🛒 *Votre panier*');
  let total = 0;
  for (const itemId of Object.keys(payload.cart)) {
    const it = payload.cart[itemId];
    const lineTotal = it.unit_price * it.qty;
    total += lineTotal;
    lines.push(`• ${it.name} × ${it.qty} — ${lineTotal.toFixed(2)} ${currency}`);
  }
  const prepTimes = Object.values(payload.cart).map((c) => c.prep_time_minutes);
  const eta = computeOrderEtaMinutes(prepTimes, 0);
  lines.push('');
  if (locale === 'ar') {
    lines.push(`*المجموع: ${total.toFixed(2)} ${currency}* · الوقت المقدر ~${eta} دقيقة`);
    lines.push('');
    lines.push('أرسل *الاسم <اسمك>* للمتابعة، *إضافة* لإضافة المزيد، أو *إلغاء*.');
  } else if (locale === 'en') {
    lines.push(`*Total: ${total.toFixed(2)} ${currency}* · ETA ~${eta} min`);
    lines.push('');
    lines.push('Send *NAME <your name>* to continue, *ADD* to add more, or *CANCEL*.');
  } else {
    lines.push(`*Total : ${total.toFixed(2)} ${currency}* · ETA ~${eta} min`);
    lines.push('');
    lines.push("Envoyez *NOM <votre nom>* pour continuer, *AJOUTER* pour ajouter, ou *ANNULER*.");
  }
  return lines.join('\n');
}

function tplAskAddress(locale: Locale): string {
  if (locale === 'ar') return '📍 أرسل عنوان التوصيل (الشارع، التفاصيل، تعليمات السائق…).';
  if (locale === 'en') return '📍 Please send the delivery address (street, details, driver instructions…).';
  return "📍 Envoyez l'adresse de livraison (rue, détails, instructions pour le livreur…).";
}

function tplAskConfirm(payload: OrderSessionPayload, locale: Locale, currency: string, orgName: string): string {
  let total = 0;
  for (const itemId of Object.keys(payload.cart)) {
    total += payload.cart[itemId].unit_price * payload.cart[itemId].qty;
  }
  const itemCount = Object.values(payload.cart).reduce((s, c) => s + c.qty, 0);
  const svc = payload.service === 'delivery' ? (locale === 'ar' ? 'توصيل' : locale === 'en' ? 'Delivery' : 'Livraison')
    : (locale === 'ar' ? 'استلام' : locale === 'en' ? 'Takeout' : 'À emporter');
  if (locale === 'ar') {
    return `✅ هل تؤكد؟\n\nاسم: *${payload.customer_name}*\n${itemCount} منتج · ${total.toFixed(2)} ${currency} · ${svc} في *${orgName}*\n\nأرسل *نعم* للتأكيد، *لا* للإلغاء.`;
  }
  if (locale === 'en') {
    return `✅ Confirm order?\n\nName: *${payload.customer_name}*\n${itemCount} items · ${total.toFixed(2)} ${currency} · ${svc} at *${orgName}*\n\nReply *YES* to send, *NO* to cancel.`;
  }
  return `✅ Confirmer la commande ?\n\nNom : *${payload.customer_name}*\n${itemCount} articles · ${total.toFixed(2)} ${currency} · ${svc} chez *${orgName}*\n\nRépondez *OUI* pour envoyer, *NON* pour annuler.`;
}

function tplOrderPlaced(ticketNumber: string, eta: number, locale: Locale, orgName: string): string {
  if (locale === 'ar') return `✅ تم استلام طلبك *#${ticketNumber}* في *${orgName}*.\nسنُعلمك بمجرد قبوله. الوقت المتوقع ~${eta} دقيقة.`;
  if (locale === 'en') return `✅ Order *#${ticketNumber}* received at *${orgName}*.\nWe'll notify you as soon as it's accepted. ETA ~${eta} min.`;
  return `✅ Commande *#${ticketNumber}* reçue chez *${orgName}*.\nNous vous préviendrons dès qu'elle est acceptée. ETA ~${eta} min.`;
}

function tplCancelled(locale: Locale): string {
  if (locale === 'ar') return '❌ تم إلغاء الطلب.';
  if (locale === 'en') return '❌ Order cancelled.';
  return '❌ Commande annulée.';
}

function tplOrderError(locale: Locale): string {
  if (locale === 'ar') return '❌ تعذّر إنشاء الطلب. يرجى المحاولة مرة أخرى أو الاتصال بالمطعم.';
  if (locale === 'en') return '❌ Could not place the order. Please try again or contact the restaurant.';
  return "❌ Impossible de créer la commande. Réessayez ou contactez le restaurant.";
}

// ── Cart input parser ────────────────────────────────────────────────

/**
 * Parse `"1 3 5x2"` / `"1, 3, 5x2"` / `"1×2 7"` etc. into a list of
 * { code, qty } pairs. Returns an empty array if nothing recognized —
 * caller decides whether that's a re-prompt or a no-op.
 */
export function parseOrderCodes(input: string): Array<{ code: number; qty: number }> {
  const tokens = input
    .replace(/[,;]+/g, ' ')
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: Array<{ code: number; qty: number }> = [];
  for (const tok of tokens) {
    // Accept "5", "5x2", "5×2", "5*2", "x2 5" not handled (unrealistic).
    const m = tok.match(/^(\d+)(?:[x×*](\d+))?$/i);
    if (!m) continue;
    const code = parseInt(m[1], 10);
    const qty = m[2] ? Math.max(1, Math.min(99, parseInt(m[2], 10))) : 1;
    if (Number.isFinite(code) && code >= 1) {
      out.push({ code, qty });
    }
  }
  return out;
}

// ── Menu rendering ───────────────────────────────────────────────────

function formatMoney(n: number, currency: string): string {
  return `${n.toFixed(2)} ${currency}`;
}

/**
 * Build the numbered text menu sent to the customer at the start of the
 * flow. Items are globally numbered so cart input is just `1 3 5x2`.
 * Categories appear as bold headers; items show `N  Name  Price · ETA`.
 */
function renderMenu(
  orgName: string,
  catalog: OrderSessionPayload['catalog'],
  currency: string,
  locale: Locale,
): string {
  const lines: string[] = [tplMenuHeader(orgName, locale), ''];
  let lastCategory: string | null = null;
  for (const it of catalog) {
    if (it.category !== lastCategory) {
      if (lastCategory !== null) lines.push('');
      lines.push(`*${it.category}*`);
      lastCategory = it.category;
    }
    const codeStr = String(it.code).padEnd(3, ' ');
    const prep = typeof it.prep_time_minutes === 'number' && it.prep_time_minutes > 0
      ? ` · ${it.prep_time_minutes} min`
      : '';
    lines.push(`${codeStr} ${it.name} — ${formatMoney(it.unit_price, currency)}${prep}`);
  }
  lines.push(tplMenuFooter(locale));
  return lines.join('\n');
}

// ── Flow entry ───────────────────────────────────────────────────────

/**
 * Kicks off the in-WhatsApp ordering flow when a customer picks Takeout
 * or Delivery on the JOIN service list. Loads the menu, stores the
 * catalog snapshot in the session payload, and switches the session to
 * `pending_order_browse`. The customer's next message is the cart input.
 */
export async function startWhatsappOrderFlow(
  identifier: string,
  channel: 'whatsapp' | 'messenger',
  locale: Locale,
  organizationId: string,
  officeId: string,
  serviceId: string,
  departmentId: string,
  serviceName: string,
  sendMessage: SendFn,
): Promise<boolean> {
  const supabase = createAdminClient() as any;
  const svcType = resolveRestaurantServiceType(serviceName);
  if (svcType !== 'takeout' && svcType !== 'delivery') return false;

  // Fetch org + menu in parallel.
  const [{ data: org }, { data: categories }, { data: items }] = await Promise.all([
    supabase.from('organizations').select('id, name, settings').eq('id', organizationId).single(),
    supabase
      .from('menu_categories')
      .select('id, name, sort_order')
      .eq('organization_id', organizationId)
      .order('sort_order', { ascending: true }),
    supabase
      .from('menu_items')
      .select('id, name, price, category_id, sort_order, prep_time_minutes, is_available')
      .eq('organization_id', organizationId)
      .eq('is_available', true)
      .order('sort_order', { ascending: true }),
  ]);

  if (!org || !categories?.length || !items?.length) {
    await sendMessage({ to: identifier, body: tplEmptyMenu(locale) });
    return true; // we handled it (negative outcome)
  }

  // Build globally-numbered catalog. Order: by category sort_order, then
  // item sort_order. Categories with no items are dropped.
  const catById = new Map<string, { name: string; sort: number }>(
    (categories as any[]).map((c: any) => [c.id, { name: c.name, sort: c.sort_order ?? 0 }]),
  );
  const sortedItems = [...items as any[]]
    .filter((it) => catById.has(it.category_id))
    .sort((a, b) => {
      const ca = catById.get(a.category_id)!.sort;
      const cb = catById.get(b.category_id)!.sort;
      if (ca !== cb) return ca - cb;
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    });

  const catalog: OrderSessionPayload['catalog'] = sortedItems.map((it: any, idx: number) => ({
    code: idx + 1,
    menu_item_id: it.id,
    name: it.name,
    unit_price: typeof it.price === 'number' ? it.price : Number(it.price ?? 0),
    prep_time_minutes: typeof it.prep_time_minutes === 'number' ? it.prep_time_minutes : null,
    category: catById.get(it.category_id)?.name ?? '',
  }));

  const orgSettings = (org.settings ?? {}) as Record<string, any>;
  const currency: string = orgSettings.currency ?? 'DA';

  const payload: OrderSessionPayload = {
    kind: 'wa_order',
    service: svcType,
    office_id: officeId,
    service_id: serviceId,
    department_id: departmentId,
    organization_id: organizationId,
    catalog,
    cart: {},
  };

  // Clean any stale ordering session for this user, then create a new one.
  const identCol = channel === 'messenger' ? 'messenger_psid' : 'whatsapp_phone';
  await supabase.from('whatsapp_sessions').delete()
    .eq(identCol, identifier)
    .in('state', ['pending_order_browse', 'pending_order_review', 'pending_order_address', 'pending_order_confirm'])
    .eq('channel', channel);

  await supabase.from('whatsapp_sessions').insert({
    organization_id: organizationId,
    office_id: officeId,
    department_id: departmentId,
    service_id: serviceId,
    state: 'pending_order_browse',
    channel,
    locale,
    [identCol]: identifier,
    custom_intake_data: payload,
  });

  await sendMessage({ to: identifier, body: renderMenu(org.name, catalog, currency, locale) });
  return true;
}

// ── State handlers ───────────────────────────────────────────────────

function isCancel(input: string): boolean {
  return /^(cancel|annuler|annul|إلغاء|الغاء|stop|0)$/i.test(input.trim());
}

function isAdd(input: string): boolean {
  return /^(add|ajouter|إضافة|اضافة|more)$/i.test(input.trim());
}

function isYes(input: string): boolean {
  return /^(yes|oui|y|o|نعم|تأكيد|تاكيد|ok|confirm|confirmer)$/i.test(input.trim());
}

function isNo(input: string): boolean {
  return /^(no|non|n|لا|annuler|cancel)$/i.test(input.trim());
}

/** Extract "NAME Faycel" / "NOM Faycel" / "الاسم فيصل" → "Faycel" */
function parseNameCommand(input: string): string | null {
  const m = input.trim().match(/^(?:name|nom|الاسم)\s+(.+)$/i);
  if (m) return m[1].trim().slice(0, 200);
  return null;
}

/**
 * Add cart codes to the running cart. Mutates payload.cart. Returns
 * the count of items added (sum of qty across recognised codes), and
 * the count of unrecognised codes (out-of-range numbers).
 */
function addCodesToCart(
  payload: OrderSessionPayload,
  codes: Array<{ code: number; qty: number }>,
): { added: number; unknown: number } {
  let added = 0;
  let unknown = 0;
  for (const c of codes) {
    const it = payload.catalog.find((x) => x.code === c.code);
    if (!it) { unknown++; continue; }
    const existing = payload.cart[it.menu_item_id];
    const newQty = (existing?.qty ?? 0) + c.qty;
    payload.cart[it.menu_item_id] = {
      qty: Math.min(99, newQty),
      name: it.name,
      unit_price: it.unit_price,
      prep_time_minutes: it.prep_time_minutes,
    };
    added += c.qty;
  }
  return { added, unknown };
}

/** Look up the active org's currency cheaply (cached per call). */
async function loadOrgCurrency(supabase: any, organizationId: string): Promise<{ currency: string; orgName: string; timezone: string | null }> {
  const { data: org } = await supabase
    .from('organizations').select('id, name, settings, timezone').eq('id', organizationId).single();
  const settings = (org?.settings ?? {}) as Record<string, any>;
  return {
    currency: settings.currency ?? 'DA',
    orgName: org?.name ?? '',
    timezone: org?.timezone ?? null,
  };
}

export async function handleOrderBrowseInput(
  session: any, input: string, identifier: string, sendMessage: SendFn,
): Promise<void> {
  const supabase = createAdminClient() as any;
  const locale: Locale = (session.locale as Locale) || 'fr';
  const payload = session.custom_intake_data as OrderSessionPayload;

  if (isCancel(input)) {
    await supabase.from('whatsapp_sessions').delete().eq('id', session.id);
    await sendMessage({ to: identifier, body: tplCancelled(locale) });
    return;
  }

  const codes = parseOrderCodes(input);
  if (codes.length === 0) {
    await sendMessage({ to: identifier, body: tplNoCodesParsed(locale) });
    return;
  }

  const result = addCodesToCart(payload, codes);
  if (result.added === 0) {
    await sendMessage({ to: identifier, body: tplNoCodesParsed(locale) });
    return;
  }

  await supabase.from('whatsapp_sessions')
    .update({ custom_intake_data: payload, state: 'pending_order_review' })
    .eq('id', session.id);

  const { currency } = await loadOrgCurrency(supabase, payload.organization_id);
  await sendMessage({ to: identifier, body: tplCart(payload, locale, currency) });
}

export async function handleOrderReviewInput(
  session: any, input: string, identifier: string, sendMessage: SendFn,
): Promise<void> {
  const supabase = createAdminClient() as any;
  const locale: Locale = (session.locale as Locale) || 'fr';
  const payload = session.custom_intake_data as OrderSessionPayload;

  if (isCancel(input)) {
    await supabase.from('whatsapp_sessions').delete().eq('id', session.id);
    await sendMessage({ to: identifier, body: tplCancelled(locale) });
    return;
  }

  if (isAdd(input)) {
    await supabase.from('whatsapp_sessions')
      .update({ state: 'pending_order_browse' })
      .eq('id', session.id);
    const { orgName, currency } = await loadOrgCurrency(supabase, payload.organization_id);
    await sendMessage({ to: identifier, body: renderMenu(orgName, payload.catalog, currency, locale) });
    return;
  }

  const name = parseNameCommand(input);
  if (name) {
    payload.customer_name = name;
    if (payload.service === 'delivery') {
      await supabase.from('whatsapp_sessions')
        .update({ custom_intake_data: payload, state: 'pending_order_address' })
        .eq('id', session.id);
      await sendMessage({ to: identifier, body: tplAskAddress(locale) });
      return;
    }
    await supabase.from('whatsapp_sessions')
      .update({ custom_intake_data: payload, state: 'pending_order_confirm' })
      .eq('id', session.id);
    const { currency, orgName } = await loadOrgCurrency(supabase, payload.organization_id);
    await sendMessage({ to: identifier, body: tplAskConfirm(payload, locale, currency, orgName) });
    return;
  }

  // Otherwise: treat as more cart codes.
  const codes = parseOrderCodes(input);
  if (codes.length === 0) {
    // Re-show cart with the prompt so they know what to do next.
    const { currency } = await loadOrgCurrency(supabase, payload.organization_id);
    await sendMessage({ to: identifier, body: tplCart(payload, locale, currency) });
    return;
  }
  const r = addCodesToCart(payload, codes);
  if (r.added > 0) {
    await supabase.from('whatsapp_sessions')
      .update({ custom_intake_data: payload })
      .eq('id', session.id);
  }
  const { currency } = await loadOrgCurrency(supabase, payload.organization_id);
  await sendMessage({ to: identifier, body: tplCart(payload, locale, currency) });
}

export async function handleOrderAddressInput(
  session: any, input: string, identifier: string, sendMessage: SendFn,
): Promise<void> {
  const supabase = createAdminClient() as any;
  const locale: Locale = (session.locale as Locale) || 'fr';
  const payload = session.custom_intake_data as OrderSessionPayload;

  if (isCancel(input)) {
    await supabase.from('whatsapp_sessions').delete().eq('id', session.id);
    await sendMessage({ to: identifier, body: tplCancelled(locale) });
    return;
  }

  const trimmed = input.trim().slice(0, 500);
  if (trimmed.length < 5) {
    await sendMessage({ to: identifier, body: tplAskAddress(locale) });
    return;
  }
  payload.delivery_address = { street: trimmed };

  await supabase.from('whatsapp_sessions')
    .update({ custom_intake_data: payload, state: 'pending_order_confirm' })
    .eq('id', session.id);

  const { currency, orgName } = await loadOrgCurrency(supabase, payload.organization_id);
  await sendMessage({ to: identifier, body: tplAskConfirm(payload, locale, currency, orgName) });
}

export async function handleOrderConfirmInput(
  session: any, input: string, identifier: string, sendMessage: SendFn,
): Promise<void> {
  const supabase = createAdminClient() as any;
  const locale: Locale = (session.locale as Locale) || 'fr';
  const payload = session.custom_intake_data as OrderSessionPayload;

  if (isNo(input) || isCancel(input)) {
    await supabase.from('whatsapp_sessions').delete().eq('id', session.id);
    await sendMessage({ to: identifier, body: tplCancelled(locale) });
    return;
  }
  if (!isYes(input)) {
    // Re-prompt — they typed something we don't understand.
    const { currency, orgName } = await loadOrgCurrency(supabase, payload.organization_id);
    await sendMessage({ to: identifier, body: tplAskConfirm(payload, locale, currency, orgName) });
    return;
  }

  // ── Place the order. Mirrors /api/orders/place using the admin client. ──
  const orgInfo = await loadOrgCurrency(supabase, payload.organization_id);

  // Convert cart object → CartItem[] (server-trusted prices already in payload).
  const cartLines: CartItem[] = Object.keys(payload.cart).map((id) => ({
    menu_item_id: id,
    name: payload.cart[id].name,
    unit_price: payload.cart[id].unit_price,
    qty: payload.cart[id].qty,
    note: null,
  }));
  if (cartLines.length === 0) {
    await supabase.from('whatsapp_sessions').delete().eq('id', session.id);
    await sendMessage({ to: identifier, body: tplCancelled(locale) });
    return;
  }

  // Re-validate items against current `is_available` to prevent ordering
  // an item the kitchen flagged out-of-stock during the conversation.
  const itemIds = cartLines.map((l) => l.menu_item_id);
  const { data: dbItems } = await supabase
    .from('menu_items')
    .select('id, name, price, prep_time_minutes, is_available, organization_id')
    .in('id', itemIds);
  const dbById = new Map((dbItems ?? []).map((i: any) => [i.id, i]));
  for (const line of cartLines) {
    const dbi = dbById.get(line.menu_item_id);
    if (!dbi || (dbi as any).is_available === false || (dbi as any).organization_id !== payload.organization_id) {
      await supabase.from('whatsapp_sessions').delete().eq('id', session.id);
      await sendMessage({ to: identifier, body: tplOrderError(locale) });
      return;
    }
  }

  // Server-trusted total + ETA.
  let total = 0;
  const prepTimes: (number | null)[] = [];
  for (const line of cartLines) {
    const dbi: any = dbById.get(line.menu_item_id);
    const unit = typeof dbi.price === 'number' ? dbi.price : Number(dbi.price ?? 0);
    total += unit * line.qty;
    prepTimes.push(typeof dbi.prep_time_minutes === 'number' ? dbi.prep_time_minutes : null);
  }
  const { count: activeCount } = await supabase
    .from('tickets').select('id', { count: 'exact', head: true })
    .eq('office_id', payload.office_id).in('status', ['serving']);
  const eta = computeOrderEtaMinutes(prepTimes, activeCount ?? 0);

  // Generate ticket number.
  const { data: seqData, error: seqErr } = await supabase.rpc(
    'generate_daily_ticket_number',
    { p_department_id: payload.department_id },
  );
  if (seqErr || !seqData || seqData.length === 0) {
    await sendMessage({ to: identifier, body: tplOrderError(locale) });
    return;
  }
  const { seq, ticket_num } = seqData[0];
  const qrToken = nanoid(16);

  // Customer data.
  const customerData: Record<string, string> = {};
  if (payload.customer_name) customerData.name = payload.customer_name;
  // Strip channel prefix like "whatsapp:" if present, else use identifier as-is.
  const phone = identifier.replace(/^whatsapp:/i, '');
  if (phone) customerData.phone = phone;

  const deliveryAddress = payload.service === 'delivery' && payload.delivery_address
    ? { street: payload.delivery_address.street, instructions: payload.delivery_address.instructions ?? null }
    : null;

  // Insert ticket as pending_approval — operator on Station accepts/declines.
  const { data: ticket, error: tkErr } = await supabase
    .from('tickets')
    .insert({
      office_id: payload.office_id,
      department_id: payload.department_id,
      service_id: payload.service_id,
      ticket_number: ticket_num,
      daily_sequence: seq,
      qr_token: qrToken,
      status: 'pending_approval',
      customer_data: customerData,
      delivery_address: deliveryAddress as any,
      is_remote: true,
      source: 'whatsapp',
      locale,
      priority: 0,
    })
    .select('id, ticket_number, qr_token')
    .single();

  if (tkErr || !ticket) {
    await sendMessage({ to: identifier, body: tplOrderError(locale) });
    return;
  }

  // Insert ticket_items.
  const ticketItems = cartLines.map((line) => {
    const dbi: any = dbById.get(line.menu_item_id);
    return {
      ticket_id: ticket.id,
      menu_item_id: line.menu_item_id,
      organization_id: payload.organization_id,
      name: dbi.name,
      qty: line.qty,
      price: typeof dbi.price === 'number' ? dbi.price : Number(dbi.price ?? 0),
      note: null,
    };
  });
  await supabase.from('ticket_items').insert(ticketItems);

  // Lifecycle event.
  await supabase.from('ticket_events').insert({
    ticket_id: ticket.id,
    event_type: 'created',
    to_status: 'pending_approval',
    metadata: { source: 'whatsapp_order', service: payload.service, total, eta_minutes: eta, item_count: cartLines.length },
  }).then(() => {}, () => {});

  // Clean up the session and send the customer the confirmation.
  await supabase.from('whatsapp_sessions').delete().eq('id', session.id);
  await sendMessage({
    to: identifier,
    body: tplOrderPlaced(ticket.ticket_number, eta, locale, orgInfo.orgName),
  });
}

/**
 * Wrapper that the caller (whatsapp-commands dispatcher) uses: looks up
 * an active order session for this user, runs the appropriate state
 * handler, and returns true if an order-flow message was handled. The
 * dispatcher should `return` immediately when this is true.
 */
export async function tryHandleWhatsappOrderState(
  identifier: string,
  channel: 'whatsapp' | 'messenger',
  rawInput: string,
  sendFn: SendFn,
): Promise<boolean> {
  const supabase = createAdminClient() as any;
  const identCol = channel === 'messenger' ? 'messenger_psid' : 'whatsapp_phone';
  const { data: session } = await supabase
    .from('whatsapp_sessions')
    .select('id, organization_id, locale, channel, office_id, department_id, service_id, custom_intake_data, state, created_at')
    .eq(identCol, identifier)
    .eq('channel', channel)
    .in('state', ['pending_order_browse', 'pending_order_review', 'pending_order_address', 'pending_order_confirm'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!session) return false;

  // Sanity check: payload must be a wa_order with non-empty catalog.
  const payload = (session.custom_intake_data ?? null) as OrderSessionPayload | null;
  if (!payload || payload.kind !== 'wa_order' || !payload.catalog?.length) {
    await supabase.from('whatsapp_sessions').delete().eq('id', session.id);
    return false;
  }

  // Wrapped sendMessage forwards to the actual sender. We rely on the
  // caller's send abstraction (for Meta vs Twilio routing).
  const send: SendFn = sendFn;

  switch (session.state) {
    case 'pending_order_browse':
      await handleOrderBrowseInput(session, rawInput, identifier, send);
      return true;
    case 'pending_order_review':
      await handleOrderReviewInput(session, rawInput, identifier, send);
      return true;
    case 'pending_order_address':
      await handleOrderAddressInput(session, rawInput, identifier, send);
      return true;
    case 'pending_order_confirm':
      await handleOrderConfirmInput(session, rawInput, identifier, send);
      return true;
  }
  return false;
}

// Silence unused-import warning when sendWhatsAppMessage isn't directly used
// (the dispatcher's sendFn calls into it).
void sendWhatsAppMessage;
