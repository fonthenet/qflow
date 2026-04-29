import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { createAdminClient } from '@/lib/supabase/admin';
import { matchesOfficePublicSlug } from '@/lib/office-links';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { checkRateLimit, publicLimiter } from '@/lib/rate-limit';
import { sanitizeString } from '@/lib/validation';
import {
  validatePlaceOrderRequest,
  computeOrderEtaMinutes,
  resolveRestaurantServiceType,
  type PlaceOrderRequest,
  type PlaceOrderResponse,
} from '@qflo/shared';

/**
 * POST /api/orders/place
 *
 * Public endpoint hit by `/m/<officeSlug>` when the customer submits a
 * takeout/delivery order. Creates a ticket in `pending_approval` so the
 * operator on Station can Accept (→ serving) or Decline (→ cancelled).
 *
 * Validation strategy:
 *   1. Rate-limit (publicLimiter — same as /api/book-appointment).
 *   2. Schema-level via shared `validatePlaceOrderRequest`.
 *   3. Reference integrity: items must belong to this org and still be
 *      `is_available = TRUE` (a customer's stale browser tab can't push
 *      through an item that the kitchen flagged as out-of-stock).
 *   4. Server-recomputed totals — never trust client price.
 *
 * The customer-facing WA "order received" message is fire-and-forget so
 * a transient WA outage doesn't fail the order itself.
 */
export async function POST(request: NextRequest) {
  const blocked = await checkRateLimit(request, publicLimiter);
  if (blocked) return blocked;

  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 }); }

  const req = body as PlaceOrderRequest;
  const v = validatePlaceOrderRequest(req);
  if (v) return NextResponse.json({ ok: false, error: v.message, code: v.code }, { status: 400 });

  const supabase = createAdminClient();

  // ── 1. Resolve office by slug ───────────────────────────────────
  const { data: offices } = await supabase
    .from('offices')
    .select('id, name, organization_id, settings, timezone, is_active')
    .eq('is_active', true);
  const office = offices?.find((o) => matchesOfficePublicSlug(o as any, req.office_slug));
  if (!office) {
    return NextResponse.json({ ok: false, error: 'Office not found' }, { status: 404 });
  }
  const orgId = office.organization_id;
  const officeTz = office.timezone ?? 'Africa/Algiers';

  // ── 2. Resolve service_id by mapping service mode → office services ──
  const { data: depts } = await supabase
    .from('departments')
    .select('id, services(id, name, is_active, department_id)')
    .eq('office_id', office.id)
    .eq('is_active', true);
  type SvcRow = { id: string; name: string; is_active: boolean; department_id: string };
  const flatServices: SvcRow[] = (depts ?? []).flatMap((d: any) =>
    (d.services ?? []).filter((s: SvcRow) => s.is_active),
  );
  const matchedService = flatServices.find((s) => resolveRestaurantServiceType(s.name) === req.service);
  if (!matchedService) {
    return NextResponse.json(
      { ok: false, error: `This office does not offer ${req.service} service` },
      { status: 400 },
    );
  }

  // ── 3. Validate items: org-scoped, available, server price ──────
  const itemIds = Array.from(new Set(req.items.map((i) => i.menu_item_id)));
  const { data: dbItems, error: itemsErr } = await supabase
    .from('menu_items')
    .select('id, name, price, prep_time_minutes, is_available, organization_id')
    .in('id', itemIds);
  if (itemsErr) {
    return NextResponse.json({ ok: false, error: itemsErr.message }, { status: 500 });
  }
  const dbItemsById = new Map((dbItems ?? []).map((i: any) => [i.id, i]));
  for (const line of req.items) {
    const dbi = dbItemsById.get(line.menu_item_id);
    if (!dbi) {
      return NextResponse.json(
        { ok: false, error: `Item not found: ${line.name}` },
        { status: 400 },
      );
    }
    if (dbi.organization_id !== orgId) {
      return NextResponse.json(
        { ok: false, error: 'Cross-org item in cart' },
        { status: 400 },
      );
    }
    if (dbi.is_available === false) {
      return NextResponse.json(
        { ok: false, error: `"${dbi.name}" is no longer available — please remove it from your cart.`, code: 'item_unavailable' },
        { status: 409 },
      );
    }
  }

  // ── 4. Compute server-trusted totals + ETA ──────────────────────
  let total = 0;
  const prepTimes: (number | null)[] = [];
  for (const line of req.items) {
    const dbi = dbItemsById.get(line.menu_item_id)!;
    const unitPrice = typeof dbi.price === 'number' ? dbi.price : Number(dbi.price ?? 0);
    total += unitPrice * line.qty;
    prepTimes.push(typeof dbi.prep_time_minutes === 'number' ? dbi.prep_time_minutes : null);
  }
  // Active backlog at this office for ETA padding.
  const { count: activeOrdersCount } = await supabase
    .from('tickets')
    .select('id', { count: 'exact', head: true })
    .eq('office_id', office.id)
    .in('status', ['serving']);
  const eta = computeOrderEtaMinutes(prepTimes, activeOrdersCount ?? 0);

  // ── 5. Generate ticket number via RPC ───────────────────────────
  const { data: seqData, error: seqErr } = await supabase.rpc(
    'generate_daily_ticket_number',
    { p_department_id: matchedService.department_id },
  );
  if (seqErr || !seqData || seqData.length === 0) {
    return NextResponse.json(
      { ok: false, error: seqErr?.message ?? 'Failed to generate ticket number' },
      { status: 500 },
    );
  }
  const { seq, ticket_num } = seqData[0];
  const qrToken = nanoid(16);

  // ── 6. Build customer_data (sanitised) + delivery_address ───────
  const cleanName = sanitizeString(req.customer.name, 200);
  const cleanPhone = sanitizeString(req.customer.phone, 30);
  const cleanCustomerNotes = req.customer.notes ? sanitizeString(req.customer.notes, 500) : null;
  const customer_data: Record<string, string> = {};
  if (cleanName) customer_data.name = cleanName;
  if (cleanPhone) customer_data.phone = cleanPhone;
  if (cleanCustomerNotes) customer_data.reason = cleanCustomerNotes;

  let deliveryAddress: Record<string, unknown> | null = null;
  if (req.service === 'delivery' && req.delivery_address) {
    deliveryAddress = {
      street: sanitizeString(req.delivery_address.street ?? '', 300),
      city: req.delivery_address.city ? sanitizeString(req.delivery_address.city, 100) : null,
      instructions: req.delivery_address.instructions ? sanitizeString(req.delivery_address.instructions, 500) : null,
      lat: typeof req.delivery_address.lat === 'number' ? req.delivery_address.lat : null,
      lng: typeof req.delivery_address.lng === 'number' ? req.delivery_address.lng : null,
    };
  }

  // ── 7. Insert ticket (status pending_approval) ──────────────────
  const { data: ticket, error: tkErr } = await supabase
    .from('tickets')
    .insert({
      office_id: office.id,
      department_id: matchedService.department_id,
      service_id: matchedService.id,
      ticket_number: ticket_num,
      daily_sequence: seq,
      qr_token: qrToken,
      status: 'pending_approval',
      customer_data,
      // delivery_address is JSONB in cloud; the generated types use Json,
      // but TS is over-strict about Record<string,unknown> compat. Cast.
      delivery_address: deliveryAddress as any,
      is_remote: true,
      source: req.channel === 'whatsapp' ? 'whatsapp' : 'web',
      locale: req.locale ?? 'fr',
      priority: 0,
      notes: cleanCustomerNotes,
    })
    .select('id, ticket_number, qr_token')
    .single();

  if (tkErr || !ticket) {
    return NextResponse.json(
      { ok: false, error: tkErr?.message ?? 'Failed to create order' },
      { status: 500 },
    );
  }

  // ── 8. Insert ticket_items in one batch ─────────────────────────
  const ticketItemsRows = req.items.map((line) => {
    const dbi = dbItemsById.get(line.menu_item_id)!;
    const unitPrice = typeof dbi.price === 'number' ? dbi.price : Number(dbi.price ?? 0);
    return {
      ticket_id: ticket.id,
      menu_item_id: line.menu_item_id,
      organization_id: orgId,
      name: dbi.name,
      qty: line.qty,
      price: unitPrice,
      note: line.note ? sanitizeString(line.note, 200) : null,
    };
  });
  const { error: itemsInsertErr } = await supabase.from('ticket_items').insert(ticketItemsRows);
  if (itemsInsertErr) {
    // Best-effort: leave the ticket so the operator at least sees something arrived.
    // The decline path will tidy it up if items are missing.
    console.error('[orders/place] ticket_items insert failed', itemsInsertErr);
  }

  // ── 9. Log lifecycle event ──────────────────────────────────────
  await supabase.from('ticket_events').insert({
    ticket_id: ticket.id,
    event_type: 'created',
    to_status: 'pending_approval',
    metadata: {
      source: 'online_order',
      channel: req.channel,
      service: req.service,
      total,
      eta_minutes: eta,
      item_count: req.items.length,
    },
  }).then(() => {}, () => {});

  // ── 10. Fire WA "order received" (best-effort) ──────────────────
  // We don't await — a slow Meta API shouldn't make the customer think the
  // order didn't go through. The Station side has its own toast on arrival.
  const cloudUrl = process.env.NEXT_PUBLIC_CLOUD_URL || 'https://qflo.net';
  const trackUrl = `${cloudUrl}/q/${qrToken}`;
  if (cleanPhone) {
    const localeMsg =
      req.locale === 'ar'
        ? `✓ تم استلام طلبك #${ticket.ticket_number} في ${office.name}.\nسنُعلمك بمجرد قبول الطلب.\nالتتبع: ${trackUrl}`
        : req.locale === 'en'
          ? `✓ Order #${ticket.ticket_number} received at ${office.name}.\nWe'll notify you as soon as it's accepted.\nTrack: ${trackUrl}`
          : `✓ Commande n°${ticket.ticket_number} reçue chez ${office.name}.\nNous vous préviendrons dès qu'elle est acceptée.\nSuivi : ${trackUrl}`;
    // Outbox-first send for durable retries. See whatsapp-outbox.ts.
    const { enqueueWaJob } = await import('@/lib/whatsapp-outbox');
    void enqueueWaJob({
      ticketId: ticket.id,
      action: 'order_pending',
      toPhone: cleanPhone,
      body: localeMsg,
      payload: { office_tz: officeTz },
    }).catch((e) => console.warn('[orders/place] enqueue failed', e?.message));
  }

  // ── 11. Respond ─────────────────────────────────────────────────
  const orgSettings = ((office as any).settings ?? {}) as Record<string, any>;
  const currency: string = orgSettings.currency ?? 'DA';
  const response: PlaceOrderResponse = {
    ok: true,
    ticket_id: ticket.id,
    ticket_number: ticket.ticket_number,
    qr_token: ticket.qr_token,
    track_url: trackUrl,
    total: Number(total.toFixed(2)),
    currency,
    eta_minutes: eta,
  };
  return NextResponse.json(response);
}
