import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { buildRiderPortalUrl } from '@/lib/rider-token';
import { enqueueWaJob } from '@/lib/whatsapp-outbox';

/**
 * Rider-side WhatsApp command handler.
 *
 * Conversation rules:
 *
 *   - Riders are matched by inbound `from` phone (E.164) against the
 *     `riders` table. Cross-org riders supported (one phone, multiple
 *     org rows).
 *   - Any inbound message from a known rider opens / refreshes their
 *     24-hour Customer Care window, so we record `last_seen_at` on
 *     every message — Station shows "active 2 min ago" so operators
 *     know whether a fresh Assign call will reach them for free.
 *   - Commands are case-insensitive, accept English / French / Arabic
 *     synonyms, and accept loose phrasing ("CHECK FIX", "Hi Fix",
 *     "Check my orders Fix" — all match the same intent).
 *
 * Supported commands (all case-insensitive):
 *
 *   CHECK [biz]       List my assigned orders. `biz` filters to one
 *                     restaurant when the rider works for several.
 *   ACCEPT [N]        Accept the Nth order from the most recent list.
 *                     If N is omitted and there's exactly one pending
 *                     order, accept it.
 *   DONE [N]          Mark the Nth order delivered. Sends customer
 *                     receipt via the outbox.
 *   ARRIVED [N]       Mark "at the door" (separate ping; same effect
 *                     as the rider portal's I've Arrived button).
 *   CANCEL [N]        Decline the assignment. Operator gets notified
 *                     via Station so they can pick someone else.
 *   WHERE [N]         Re-send the order details + tracking link.
 *   HELP              Show command list.
 *
 *   Anything else from a known rider phone defaults to CHECK so a
 *   simple "Hi" gets them their order list — friendly fallback.
 */

export interface RiderRouteResult {
  /** True if this message was handled (caller should NOT fall through
   *  to customer flows). False = not a known rider / not routable. */
  handled: boolean;
}

interface RiderRow {
  id: string;
  name: string;
  phone: string;
  organization_id: string;
  is_active: boolean;
}

interface OrgRow {
  id: string;
  name: string;
  timezone: string | null;
}

interface AssignedTicket {
  id: string;
  ticket_number: string;
  status: string;
  qr_token: string;
  notes: string | null;
  customer_data: any;
  delivery_address: any;
  assigned_rider_id: string;
  dispatched_at: string | null;
  picked_up_at: string | null;
  arrived_at: string | null;
  delivered_at: string | null;
  office_id: string;
  organization_id: string;
  organization_name: string;
}

export interface RiderInboundContext {
  fromPhone: string;
  body: string;
  /** sendMessage adapter — uses the same channel that the dispatcher
   *  resolved (Meta vs Twilio). The handlers don't need to know which. */
  sendMessage: (args: { to: string; body: string }) => Promise<unknown>;
}

const DIV = '──────────';

/**
 * Top-level dispatch: returns { handled: true } when the inbound
 * message was processed as a rider command, false otherwise.
 */
export async function tryHandleRiderInbound(ctx: RiderInboundContext): Promise<RiderRouteResult> {
  const supabase = createAdminClient() as any;

  // Look up any active rider rows matching this phone. A single rider
  // (same phone) may belong to multiple orgs.
  const { data: riderRows } = await supabase
    .from('riders')
    .select('id, name, phone, organization_id, is_active')
    .eq('phone', ctx.fromPhone)
    .eq('is_active', true);

  const riders: RiderRow[] = riderRows ?? [];
  if (riders.length === 0) return { handled: false };

  // Stamp last_seen_at across every active row for this phone so the
  // Station's "WhatsApp window open" indicator stays accurate.
  await supabase
    .from('riders')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('phone', ctx.fromPhone)
    .eq('is_active', true);

  // Resolve org names so command output can disambiguate.
  const orgIds = Array.from(new Set(riders.map((r) => r.organization_id)));
  const { data: orgRows } = await supabase
    .from('organizations').select('id, name, timezone').in('id', orgIds);
  const orgs: Record<string, OrgRow> = {};
  for (const o of orgRows ?? []) orgs[o.id] = o as OrgRow;

  const riderName = riders[0].name;
  const intent = parseIntent(ctx.body);

  switch (intent.kind) {
    case 'help':
      await ctx.sendMessage({ to: ctx.fromPhone, body: tplHelp(riderName) });
      return { handled: true };
    case 'accept':
      await handleAccept(supabase, ctx, riders, orgs, intent.index ?? null);
      return { handled: true };
    case 'done':
      await handleDone(supabase, ctx, riders, orgs, intent.index ?? null);
      return { handled: true };
    case 'pickup':
      await handlePickup(supabase, ctx, riders, orgs, intent.index ?? null);
      return { handled: true };
    case 'arrived':
      await handleArrived(supabase, ctx, riders, orgs, intent.index ?? null);
      return { handled: true };
    case 'cancel':
      await handleCancel(supabase, ctx, riders, orgs, intent.index ?? null);
      return { handled: true };
    case 'where':
      await handleWhere(supabase, ctx, riders, orgs, intent.index ?? null);
      return { handled: true };
    case 'leave':
      await handleLeaveIntro(ctx, riders, orgs);
      return { handled: true };
    case 'leaveConfirm':
      await handleLeaveConfirm(supabase, ctx, riders, orgs, intent.leaveTarget ?? '');
      return { handled: true };
    case 'check':
    default:
      // Default-on-anything-else: list orders. Friendly fallback so
      // a simple "Hi" / "Bonjour" / "Salam" still works.
      await handleCheck(supabase, ctx, riders, orgs, intent.bizFilter ?? null);
      return { handled: true };
  }
}

// ── Intent parser ────────────────────────────────────────────────────

interface ParsedIntent {
  kind: 'check' | 'accept' | 'pickup' | 'done' | 'arrived' | 'cancel' | 'where' | 'help' | 'leave' | 'leaveConfirm';
  /** 1-based index in the most recent CHECK list — for ACCEPT/DONE/etc. */
  index?: number | null;
  /** Token after CHECK — used to filter by org name when the rider
   *  works for multiple restaurants. */
  bizFilter?: string | null;
  /** For 'leaveConfirm' — name or 1-based index of the org to leave. */
  leaveTarget?: string | null;
}

const ACCEPT_RE = /^(accept|take|claim|prendre|قبول|اقبل|moi)\b/i;
const PICKUP_RE = /^(pickup|picked[\s_]?up|got[\s_]?it|i[\s_]have[\s_]it|i[\s_]have[\s_]the[\s_]order|taking[\s_]?it|ramass[ée]|r[ée]cup[ée]r[ée]|j['']?ai[\s_]pris|j['']?ai[\s_]la[\s_]commande|استلمت|أخذت|معي)\b/i;
const DONE_RE   = /^(done|delivered|drop(ped)?|fini|tasl[ie]m|تم|سل[يّ]م|sa[lh]ema|livr[ée])\b/i;
const ARRIVED_RE = /^(arrived|here|at[\s_]?door|wsa[ll]t|wasalt|وصلت|j[aA]rrive|arrive)\b/i;
const CANCEL_RE  = /^(cancel|reject|refuse|annul(?:er)?|abandon|abandonner|إلغاء|الغاء|الغ)\b/i;
const WHERE_RE   = /^(where|status|info|details?|d[ée]tails?|info(rmation)?s?|أين|معلومات)\b/i;
const HELP_RE    = /^(help|aide|m[ée]nu|menu|مساعدة|مساعده)\b/i;
const CHECK_RE   = /^(check|update|hi|hello|bonjour|salut|salam|سلام|مرحب|hey|merhba)\b/i;
// Two-step "stop being a driver" command. First message ("STOP
// DRIVING" or just "LEAVE") lists the rider's businesses; second
// message ("STOP DRIVING <BIZ>" or "STOP DRIVING 1") confirms.
// Distinct prefix from CANCEL so a rider mid-delivery doesn't
// accidentally drop off the platform when they meant to cancel
// the assignment.
const LEAVE_INTRO_RE = /^(stop[\s_]?driving|leave[\s_]?driver|quit[\s_]?driving|remove[\s_]?me|d[ée]missionner|quitter[\s_]?livreur|توقف[\s_]?عن[\s_]?التوصيل|اترك[\s_]?التوصيل)\s*$/i;
const LEAVE_CONFIRM_RE = /^(stop[\s_]?driving|leave[\s_]?driver|quit[\s_]?driving|remove[\s_]?me|d[ée]missionner|quitter[\s_]?livreur|توقف[\s_]?عن[\s_]?التوصيل|اترك[\s_]?التوصيل)\s+(.+)$/i;

function parseIntent(body: string): ParsedIntent {
  const trimmed = body.trim();
  const lc = trimmed.toLowerCase();

  if (HELP_RE.test(lc)) return { kind: 'help' };
  // LEAVE confirmation FIRST — needs to match before plain LEAVE so
  // "STOP DRIVING Fix" doesn't fall into the bare-intro branch.
  const leaveMatch = trimmed.match(LEAVE_CONFIRM_RE);
  if (leaveMatch) {
    return { kind: 'leaveConfirm', leaveTarget: (leaveMatch[2] ?? '').trim() };
  }
  if (LEAVE_INTRO_RE.test(trimmed)) return { kind: 'leave' };
  if (ACCEPT_RE.test(lc))  return { kind: 'accept', index: extractIndex(trimmed) };
  if (PICKUP_RE.test(lc)) return { kind: 'pickup', index: extractIndex(trimmed) };
  if (DONE_RE.test(lc))   return { kind: 'done', index: extractIndex(trimmed) };
  if (ARRIVED_RE.test(lc)) return { kind: 'arrived', index: extractIndex(trimmed) };
  if (CANCEL_RE.test(lc)) return { kind: 'cancel', index: extractIndex(trimmed) };
  if (WHERE_RE.test(lc))  return { kind: 'where', index: extractIndex(trimmed) };

  // CHECK family OR generic greeting: extract optional biz filter.
  if (CHECK_RE.test(lc) || lc.length === 0) {
    return { kind: 'check', bizFilter: extractBizFilter(trimmed) };
  }

  // Anything else from a known rider — also treat as check (with the
  // whole input as a biz filter so "Fix" alone matches the right org).
  return { kind: 'check', bizFilter: trimmed };
}

function extractIndex(input: string): number | null {
  // First standalone integer in the message.
  const m = input.match(/\b(\d{1,2})\b/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 1 && n <= 50 ? n : null;
}

function extractBizFilter(input: string): string | null {
  // Drop the leading verb (Check/Hi/Update/etc.) and return the rest.
  const m = input.match(/^\s*\S+\s+(.+)$/);
  if (!m) return null;
  const rest = m[1].trim();
  return rest.length > 0 ? rest : null;
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Find the orgs that match a free-form filter token. Flexible:
 *   - exact org name (case-insensitive)
 *   - substring of org name
 *   - first-word match
 *
 * If filter is null returns ALL orgs the rider works for.
 */
function filterOrgs(orgs: Record<string, OrgRow>, filter: string | null): OrgRow[] {
  const all = Object.values(orgs);
  if (!filter) return all;
  const f = filter.toLowerCase().trim();
  if (!f) return all;
  const direct = all.filter((o) => o.name.toLowerCase() === f);
  if (direct.length > 0) return direct;
  const sub = all.filter((o) => o.name.toLowerCase().includes(f));
  if (sub.length > 0) return sub;
  // First-word match e.g. "Fix Restaurant" matches "fix"
  const prefix = all.filter((o) => o.name.toLowerCase().split(/\s+/)[0] === f);
  return prefix;
}

async function fetchAssignedTickets(
  supabase: any,
  riderRows: RiderRow[],
  orgs: Record<string, OrgRow>,
  filter: string | null,
): Promise<AssignedTicket[]> {
  const orgsToCheck = filterOrgs(orgs, filter);
  if (orgsToCheck.length === 0) return [];

  // For each org-rider pairing, find tickets where this rider is
  // assigned and the order isn't yet delivered/cancelled.
  const riderIds = riderRows
    .filter((r) => orgsToCheck.find((o) => o.id === r.organization_id))
    .map((r) => r.id);
  if (riderIds.length === 0) return [];

  const { data: tickets } = await supabase
    .from('tickets')
    .select(`
      id, ticket_number, status, qr_token, notes,
      customer_data, delivery_address, assigned_rider_id,
      dispatched_at, picked_up_at, arrived_at, delivered_at, office_id,
      offices!inner(organization_id)
    `)
    .in('assigned_rider_id', riderIds)
    .eq('status', 'serving')
    .is('delivered_at', null)
    .order('created_at', { ascending: true });

  return (tickets ?? []).map((t: any): AssignedTicket => {
    const orgId = t.offices?.organization_id ?? '';
    return {
      id: t.id,
      ticket_number: t.ticket_number,
      status: t.status,
      qr_token: t.qr_token,
      notes: t.notes,
      customer_data: t.customer_data,
      delivery_address: t.delivery_address,
      assigned_rider_id: t.assigned_rider_id,
      dispatched_at: t.dispatched_at,
      picked_up_at: t.picked_up_at,
      arrived_at: t.arrived_at,
      delivered_at: t.delivered_at,
      office_id: t.office_id,
      organization_id: orgId,
      organization_name: orgs[orgId]?.name ?? '',
    };
  });
}

// ── Handlers ─────────────────────────────────────────────────────────

async function handleCheck(
  supabase: any,
  ctx: RiderInboundContext,
  riders: RiderRow[],
  orgs: Record<string, OrgRow>,
  bizFilter: string | null,
): Promise<void> {
  const tickets = await fetchAssignedTickets(supabase, riders, orgs, bizFilter);
  if (tickets.length === 0) {
    const msg = bizFilter
      ? `✅ No orders assigned for *${bizFilter}* right now.`
      : `✅ No orders assigned right now. Stay tuned!`;
    await ctx.sendMessage({ to: ctx.fromPhone, body: msg });
    return;
  }
  await ctx.sendMessage({
    to: ctx.fromPhone,
    body: tplOrderList(riders[0].name, tickets),
  });
}

async function handleAccept(
  supabase: any,
  ctx: RiderInboundContext,
  riders: RiderRow[],
  orgs: Record<string, OrgRow>,
  index: number | null,
): Promise<void> {
  const pending = (await fetchAssignedTickets(supabase, riders, orgs, null))
    .filter((t) => !t.dispatched_at);

  if (pending.length === 0) {
    await ctx.sendMessage({ to: ctx.fromPhone, body: '⚠ Nothing to accept — no pending assignments. Reply *CHECK* for status.' });
    return;
  }

  let target: AssignedTicket | null = null;
  if (pending.length === 1 && (index === null || index === 1)) {
    target = pending[0];
  } else if (index !== null && index >= 1 && index <= pending.length) {
    target = pending[index - 1];
  } else {
    await ctx.sendMessage({
      to: ctx.fromPhone,
      body: `📋 You have *${pending.length}* orders pending. Reply *ACCEPT 1*, *ACCEPT 2*, etc.\n\n${pending.map((t, i) => `${i + 1}. *${t.ticket_number}* — ${t.organization_name}`).join('\n')}`,
    });
    return;
  }

  // Idempotent state-locked update — only the first ACCEPT advances
  // dispatched_at; duplicates from Meta webhook replays no-op.
  const { data: advanced } = await supabase
    .from('tickets')
    .update({ dispatched_at: new Date().toISOString() })
    .eq('id', target.id)
    .is('dispatched_at', null)
    .is('delivered_at', null)
    .select('id, dispatched_at')
    .maybeSingle();

  if (!advanced) {
    // Already accepted (probably a duplicate webhook delivery). Re-
    // send the details so the rider has them anyway.
    await ctx.sendMessage({ to: ctx.fromPhone, body: tplOrderDetails(target, riders[0]) });
    return;
  }

  await supabase.from('ticket_events').insert({
    ticket_id: target.id,
    event_type: 'rider_accepted',
    metadata: { rider_id: target.assigned_rider_id, source: 'wa_command' },
  }).then(() => {}, () => {});

  // Notify customer that the order is on its way (durable outbox).
  const customerPhone = (target.customer_data as any)?.phone ?? null;
  if (customerPhone) {
    const cloudUrl = process.env.NEXT_PUBLIC_CLOUD_URL || 'https://qflo.net';
    const trackUrl = `${cloudUrl}/q/${target.qr_token}`;
    const customerMsg =
      `🛵 Your order *${target.ticket_number}* is on its way.\n` +
      `Track: ${trackUrl}`;
    void enqueueWaJob({
      ticketId: target.id,
      action: 'order_dispatched',
      toPhone: customerPhone,
      body: customerMsg,
    }).catch(() => {});
  }

  await ctx.sendMessage({ to: ctx.fromPhone, body: tplOrderDetails(target, riders[0]) });
}

async function handleDone(
  supabase: any,
  ctx: RiderInboundContext,
  riders: RiderRow[],
  orgs: Record<string, OrgRow>,
  index: number | null,
): Promise<void> {
  const inFlight = (await fetchAssignedTickets(supabase, riders, orgs, null))
    .filter((t) => Boolean(t.dispatched_at));
  if (inFlight.length === 0) {
    await ctx.sendMessage({ to: ctx.fromPhone, body: '⚠ Nothing to mark done — no orders in flight. Reply *CHECK*.' });
    return;
  }

  let target: AssignedTicket | null = null;
  if (inFlight.length === 1 && (index === null || index === 1)) target = inFlight[0];
  else if (index !== null && index >= 1 && index <= inFlight.length) target = inFlight[index - 1];
  else {
    await ctx.sendMessage({
      to: ctx.fromPhone,
      body: `📋 You have *${inFlight.length}* orders in flight. Reply *DONE 1*, *DONE 2*, etc.\n\n${inFlight.map((t, i) => `${i + 1}. *${t.ticket_number}* — ${t.organization_name}`).join('\n')}`,
    });
    return;
  }

  const nowIso = new Date().toISOString();
  const { data: closed } = await supabase
    .from('tickets')
    .update({ delivered_at: nowIso, completed_at: nowIso, status: 'served' })
    .eq('id', target.id)
    .is('delivered_at', null)
    .select('id')
    .maybeSingle();
  if (!closed) {
    await ctx.sendMessage({ to: ctx.fromPhone, body: `⚠ Order *${target.ticket_number}* was already closed.` });
    return;
  }
  await supabase.from('ticket_events').insert({
    ticket_id: target.id,
    event_type: 'rider_marked_done',
    metadata: { rider_id: target.assigned_rider_id, source: 'wa_command' },
  }).then(() => {}, () => {});

  // Customer receipt via outbox.
  const phone = (target.customer_data as any)?.phone ?? null;
  if (phone) {
    const cloudUrl = process.env.NEXT_PUBLIC_CLOUD_URL || 'https://qflo.net';
    const trackUrl = `${cloudUrl}/q/${target.qr_token}`;
    const headerLine = `✅ Your order *${target.ticket_number}* has been delivered. Enjoy your meal! 🍽️`;
    let body = headerLine + `\n${trackUrl}`;
    try {
      const { buildOrderReceiptMessage } = await import('@/lib/order-receipt');
      body = await buildOrderReceiptMessage(supabase, {
        ticketId: target.id,
        ticketNumber: target.ticket_number,
        orgName: target.organization_name,
        locale: 'en',
        headerLine,
        trackUrl,
      });
    } catch { /* fallback already set */ }
    void enqueueWaJob({
      ticketId: target.id,
      action: 'order_delivered',
      toPhone: phone,
      body,
    }).catch(() => {});
  }

  await ctx.sendMessage({
    to: ctx.fromPhone,
    body: `✅ Order *${target.ticket_number}* marked delivered. Customer notified. Thanks!`,
  });
}

async function handlePickup(
  supabase: any,
  ctx: RiderInboundContext,
  riders: RiderRow[],
  orgs: Record<string, OrgRow>,
  index: number | null,
): Promise<void> {
  // Tickets that are accepted (dispatched_at set) but not yet picked up.
  // A rider who hasn't accepted yet will have dispatched_at = null and
  // will fall into the "nothing to pick up" branch with a helpful hint.
  const readyToPickUp = (await fetchAssignedTickets(supabase, riders, orgs, null))
    .filter((t) => Boolean(t.dispatched_at) && !t.picked_up_at);

  if (readyToPickUp.length === 0) {
    // Distinguish between "you have no assignments at all" and "you
    // haven't accepted yet" so the rider knows what to do next.
    const allTickets = await fetchAssignedTickets(supabase, riders, orgs, null);
    const notYetAccepted = allTickets.filter((t) => !t.dispatched_at);
    if (notYetAccepted.length > 0) {
      await ctx.sendMessage({
        to: ctx.fromPhone,
        body: `⚠ You haven't accepted any orders yet. Reply *ACCEPT* first, then *PICKUP* when you collect from the vendor.`,
      });
    } else {
      await ctx.sendMessage({
        to: ctx.fromPhone,
        body: `⚠ No orders to mark picked up. Reply *CHECK* for your current status.`,
      });
    }
    return;
  }

  let target: AssignedTicket | null = null;
  if (readyToPickUp.length === 1 && (index === null || index === 1)) {
    target = readyToPickUp[0];
  } else if (index !== null && index >= 1 && index <= readyToPickUp.length) {
    target = readyToPickUp[index - 1];
  } else {
    await ctx.sendMessage({
      to: ctx.fromPhone,
      body: `📋 You have *${readyToPickUp.length}* orders ready to pick up. Reply *PICKUP 1*, *PICKUP 2*, etc.\n\n${readyToPickUp.map((t, i) => `${i + 1}. *${t.ticket_number}* — ${t.organization_name}`).join('\n')}`,
    });
    return;
  }

  // Idempotent state-locked update — only the first PICKUP advances
  // picked_up_at; duplicate Meta webhook replays (or the rider sending
  // it twice) will find no matching row and fall into the re-send branch.
  const nowIso = new Date().toISOString();
  const { data: advanced } = await supabase
    .from('tickets')
    .update({ picked_up_at: nowIso })
    .eq('id', target.id)
    .is('picked_up_at', null)
    .is('delivered_at', null)
    .select('id, picked_up_at')
    .maybeSingle();

  if (!advanced) {
    // Already picked up — surface the existing timestamp and carry on.
    const { data: existing } = await supabase
      .from('tickets')
      .select('picked_up_at')
      .eq('id', target.id)
      .maybeSingle();
    const when = existing?.picked_up_at
      ? ` (recorded at ${new Date(existing.picked_up_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })})`
      : '';
    await ctx.sendMessage({
      to: ctx.fromPhone,
      body: `⚠ Order *${target.ticket_number}* was already marked picked up${when}. Here are the delivery details:\n\n${tplOrderDetails(target, riders[0])}`,
    });
    return;
  }

  await supabase.from('ticket_events').insert({
    ticket_id: target.id,
    event_type: 'rider_picked_up',
    metadata: { rider_id: target.assigned_rider_id, source: 'wa_command' },
  }).then(() => {}, () => {});

  // Customer ping — locale-aware messages for EN/FR/AR.
  const customerPhone = (target.customer_data as any)?.phone ?? null;
  if (customerPhone) {
    const cloudUrl = process.env.NEXT_PUBLIC_CLOUD_URL || 'https://qflo.net';
    const trackUrl = `${cloudUrl}/q/${target.qr_token}`;
    // Derive the ticket's locale from customer_data if stored, fallback to EN.
    const locale: string = (target.customer_data as any)?.locale ?? 'en';
    let customerMsg: string;
    if (locale === 'fr') {
      customerMsg = `🛵 Votre livreur a récupéré la commande *#${target.ticket_number}* et est en route.\nSuivi : ${trackUrl}`;
    } else if (locale === 'ar') {
      customerMsg = `🛵 السائق استلم طلبك *#${target.ticket_number}* وهو في الطريق إليك.\nتتبع: ${trackUrl}`;
    } else {
      customerMsg = `🛵 Your driver picked up order *#${target.ticket_number}* and is on the way.\nTrack: ${trackUrl}`;
    }
    void enqueueWaJob({
      ticketId: target.id,
      action: 'order_picked_up',
      toPhone: customerPhone,
      body: customerMsg,
    }).catch(() => {});
  }

  // Reply to rider with full order details (drop-off address + portal link).
  await ctx.sendMessage({
    to: ctx.fromPhone,
    body: tplOrderDetails(target, riders[0]),
  });
}

async function handleArrived(
  supabase: any,
  ctx: RiderInboundContext,
  riders: RiderRow[],
  orgs: Record<string, OrgRow>,
  index: number | null,
): Promise<void> {
  const inFlight = (await fetchAssignedTickets(supabase, riders, orgs, null))
    .filter((t) => Boolean(t.dispatched_at) && !t.arrived_at);
  if (inFlight.length === 0) {
    await ctx.sendMessage({ to: ctx.fromPhone, body: '⚠ No orders to mark arrived. Reply *CHECK*.' });
    return;
  }
  let target: AssignedTicket | null = null;
  if (inFlight.length === 1 && (index === null || index === 1)) target = inFlight[0];
  else if (index !== null && index >= 1 && index <= inFlight.length) target = inFlight[index - 1];
  else {
    await ctx.sendMessage({
      to: ctx.fromPhone,
      body: `📋 Reply *ARRIVED 1*, *ARRIVED 2*, etc.\n\n${inFlight.map((t, i) => `${i + 1}. ${t.ticket_number}`).join('\n')}`,
    });
    return;
  }
  const nowIso = new Date().toISOString();
  await supabase.from('tickets').update({ arrived_at: nowIso }).eq('id', target.id).is('arrived_at', null);
  await supabase.from('ticket_events').insert({
    ticket_id: target.id, event_type: 'rider_arrived',
    metadata: { rider_id: target.assigned_rider_id, source: 'wa_command' },
  }).then(() => {}, () => {});
  // Customer ping.
  const phone = (target.customer_data as any)?.phone ?? null;
  if (phone) {
    const cloudUrl = process.env.NEXT_PUBLIC_CLOUD_URL || 'https://qflo.net';
    const trackUrl = `${cloudUrl}/q/${target.qr_token}`;
    void enqueueWaJob({
      ticketId: target.id, action: 'order_arrived', toPhone: phone,
      body: `🛵 Your driver has *arrived* with order *${target.ticket_number}*.\nTrack: ${trackUrl}`,
    }).catch(() => {});
  }
  await ctx.sendMessage({ to: ctx.fromPhone, body: `🚪 Marked arrived. Customer notified.` });
}

async function handleCancel(
  supabase: any,
  ctx: RiderInboundContext,
  riders: RiderRow[],
  orgs: Record<string, OrgRow>,
  index: number | null,
): Promise<void> {
  const all = await fetchAssignedTickets(supabase, riders, orgs, null);
  if (all.length === 0) {
    await ctx.sendMessage({ to: ctx.fromPhone, body: '⚠ No active assignments to cancel.' });
    return;
  }
  let target: AssignedTicket | null = null;
  if (all.length === 1 && (index === null || index === 1)) target = all[0];
  else if (index !== null && index >= 1 && index <= all.length) target = all[index - 1];
  else {
    await ctx.sendMessage({
      to: ctx.fromPhone,
      body: `📋 Reply *CANCEL 1*, *CANCEL 2*, etc.\n\n${all.map((t, i) => `${i + 1}. ${t.ticket_number}`).join('\n')}`,
    });
    return;
  }

  // Clear assignment + dispatch state. Order goes back to "kitchen
  // prepping" from the Station's POV; the operator picks a new rider.
  await supabase
    .from('tickets')
    .update({ assigned_rider_id: null, dispatched_at: null })
    .eq('id', target.id);
  await supabase.from('ticket_events').insert({
    ticket_id: target.id,
    event_type: 'rider_cancelled_assignment',
    metadata: {
      rider_id: target.assigned_rider_id,
      rider_phone: ctx.fromPhone,
      source: 'wa_command',
    },
  }).then(() => {}, () => {});

  await ctx.sendMessage({
    to: ctx.fromPhone,
    body: `❌ Cancelled assignment for *${target.ticket_number}*. The restaurant has been notified.`,
  });
}

// ── Leave (self-serve "stop being a driver") ────────────────────
// Two-step flow so a rider doesn't accidentally drop themselves
// off the platform mid-shift. Step 1: "STOP DRIVING" lists their
// businesses. Step 2: "STOP DRIVING <BIZ>" or "STOP DRIVING 1"
// commits the deactivation for that single business. Riders with
// just one business get a single-step path with a clear confirm
// instruction.

async function handleLeaveIntro(
  ctx: RiderInboundContext,
  riders: RiderRow[],
  orgs: Record<string, OrgRow>,
): Promise<void> {
  // Sort by org name so the numbered list is stable across requests.
  const sorted = [...riders].sort((a, b) => {
    const an = orgs[a.organization_id]?.name ?? '';
    const bn = orgs[b.organization_id]?.name ?? '';
    return an.localeCompare(bn);
  });

  if (sorted.length === 1) {
    const orgName = orgs[sorted[0].organization_id]?.name ?? 'this business';
    await ctx.sendMessage({
      to: ctx.fromPhone,
      body: [
        `⚠ Stop being a driver for *${orgName}*?`,
        '',
        `Reply *STOP DRIVING ${orgName}* to confirm.`,
        'Operators will need to re-add your number if you want to come back.',
      ].join('\n'),
    });
    return;
  }

  const lines = sorted.map(
    (r, i) => `${i + 1}. *${orgs[r.organization_id]?.name ?? 'Unknown'}*`,
  );
  await ctx.sendMessage({
    to: ctx.fromPhone,
    body: [
      `⚠ You're a driver for *${sorted.length}* businesses:`,
      '',
      ...lines,
      '',
      'To leave one, reply with the number or name. Examples:',
      '  • *STOP DRIVING 1*',
      `  • *STOP DRIVING ${orgs[sorted[0].organization_id]?.name ?? '<biz>'}*`,
    ].join('\n'),
  });
}

async function handleLeaveConfirm(
  supabase: any,
  ctx: RiderInboundContext,
  riders: RiderRow[],
  orgs: Record<string, OrgRow>,
  rawTarget: string,
): Promise<void> {
  const target = rawTarget.trim();
  if (!target) {
    await handleLeaveIntro(ctx, riders, orgs);
    return;
  }

  const sorted = [...riders].sort((a, b) => {
    const an = orgs[a.organization_id]?.name ?? '';
    const bn = orgs[b.organization_id]?.name ?? '';
    return an.localeCompare(bn);
  });

  // Resolve target — first try as a 1-based index (matches the
  // numbering we showed in handleLeaveIntro), then by name (case-
  // insensitive substring match — most operator-set names are
  // distinctive enough that a partial match works without ambiguity).
  let chosen: RiderRow | null = null;
  const idx = Number(target);
  if (Number.isInteger(idx) && idx >= 1 && idx <= sorted.length) {
    chosen = sorted[idx - 1];
  } else {
    const lc = target.toLowerCase();
    const candidates = sorted.filter((r) =>
      (orgs[r.organization_id]?.name ?? '').toLowerCase().includes(lc),
    );
    if (candidates.length === 1) chosen = candidates[0];
    else if (candidates.length > 1) {
      const names = candidates.map((r) => orgs[r.organization_id]?.name).filter(Boolean).join(', ');
      await ctx.sendMessage({
        to: ctx.fromPhone,
        body: `❓ "${target}" matches more than one business (${names}). Use the number from the list (e.g. *STOP DRIVING 1*).`,
      });
      return;
    }
  }

  if (!chosen) {
    await ctx.sendMessage({
      to: ctx.fromPhone,
      body: `❓ "${target}" doesn't match a business you drive for. Reply *STOP DRIVING* to see your list.`,
    });
    return;
  }

  const orgName = orgs[chosen.organization_id]?.name ?? 'the business';

  // Deactivate the rider row. We DON'T delete it — historical
  // assignments still need the row to resolve the rider's name on
  // operator reports.
  const { error: updErr } = await supabase
    .from('riders')
    .update({ is_active: false })
    .eq('id', chosen.id);
  if (updErr) {
    await ctx.sendMessage({
      to: ctx.fromPhone,
      body: `⚠ Could not stop your driver registration for *${orgName}* — please try again or contact the operator.`,
    });
    return;
  }

  // Revoke active mobile-app sessions + drop device push tokens.
  // The session table is keyed on rider_id so this only kicks the
  // single-org session, not any other businesses they still drive
  // for. Same for rider_devices.
  await supabase.from('rider_sessions').update({
    revoked_at: new Date().toISOString(),
  }).eq('rider_id', chosen.id).is('revoked_at', null);
  await supabase.from('rider_devices').delete().eq('rider_id', chosen.id);

  // Audit row.
  await supabase.from('ticket_events').insert({
    ticket_id: null,
    event_type: 'rider_left_business',
    metadata: {
      rider_id: chosen.id,
      organization_id: chosen.organization_id,
      source: 'wa_command',
    },
  }).then(() => {}, () => {});

  await ctx.sendMessage({
    to: ctx.fromPhone,
    body: [
      `✅ You've stopped being a driver for *${orgName}*.`,
      '',
      'Operators will need to re-add your number if you want to come back.',
    ].join('\n'),
  });
}

async function handleWhere(
  supabase: any,
  ctx: RiderInboundContext,
  riders: RiderRow[],
  orgs: Record<string, OrgRow>,
  index: number | null,
): Promise<void> {
  const all = await fetchAssignedTickets(supabase, riders, orgs, null);
  if (all.length === 0) {
    await ctx.sendMessage({ to: ctx.fromPhone, body: '⚠ No active orders.' });
    return;
  }
  let target: AssignedTicket | null = null;
  if (all.length === 1 && (index === null || index === 1)) target = all[0];
  else if (index !== null && index >= 1 && index <= all.length) target = all[index - 1];
  else {
    await ctx.sendMessage({ to: ctx.fromPhone, body: tplOrderList(riders[0].name, all) });
    return;
  }
  const rider = riders.find((r) => r.id === target.assigned_rider_id) ?? riders[0];
  await ctx.sendMessage({ to: ctx.fromPhone, body: tplOrderDetails(target, rider) });
}

// ── Templates ────────────────────────────────────────────────────────

function tplHelp(name: string): string {
  return [
    `🛵 Hi *${name}*. Commands:`,
    '',
    '• *CHECK* — list your assigned orders',
    '• *ACCEPT N* — accept order N (or *ACCEPT* if only one)',
    '• *PICKUP N* — mark order N as picked up from the vendor',
    '• *ARRIVED N* — mark "at the door"',
    '• *DONE N* — mark delivered',
    '• *CANCEL N* — drop the assignment back to the restaurant',
    '• *WHERE N* — see the address + tracking link again',
    '• *STOP DRIVING* — stop being a driver for a business',
    '• *HELP* — this list',
  ].join('\n');
}

function tplOrderList(name: string, tickets: AssignedTicket[]): string {
  const lines: string[] = [`🛵 Hi *${name}*, you have *${tickets.length}* order${tickets.length > 1 ? 's' : ''}:`, '', DIV];
  tickets.forEach((t, i) => {
    const stage = t.arrived_at  ? '🚪 At door'
      : t.picked_up_at          ? '🛵 Picked up'
      : t.dispatched_at         ? '🛵 In flight'
      : '⏳ Pending';
    const street = (t.delivery_address as any)?.street ?? '';
    lines.push(`*${i + 1}.* *${t.ticket_number}* · ${stage}`);
    if (t.organization_name) lines.push(`   📍 ${t.organization_name}`);
    if (street) lines.push(`   ${street}`);
    lines.push('');
  });
  lines.push(DIV);
  lines.push('Reply *ACCEPT N* / *DONE N* / *WHERE N*. *HELP* for all commands.');
  return lines.join('\n');
}

function tplOrderDetails(t: AssignedTicket, rider: RiderRow): string {
  const customerName = (t.customer_data as any)?.name ?? '—';
  const customerPhone = (t.customer_data as any)?.phone ?? null;
  const street = (t.delivery_address as any)?.street ?? '';
  const note = (t.notes ?? '').trim();
  const cloudUrl = process.env.NEXT_PUBLIC_CLOUD_URL || 'https://qflo.net';
  const portal = buildRiderPortalUrl(cloudUrl, t.id);
  // Single link — the portal handles BOTH live GPS streaming AND
  // launches Google Maps for turn-by-turn nav via its big sticky
  // Navigate button. Earlier we sent two links (GMaps deeplink +
  // portal); the rider had to remember which one to tap. Now: one
  // link, both functions inside.
  void rider;

  const lines: string[] = [
    `✅ *${t.ticket_number}* accepted`,
    `📍 ${t.organization_name}`,
    DIV,
    `👤 *${customerName}*`,
    customerPhone ? `📞 ${customerPhone}` : '',
    street ? `🏠 ${street}` : '',
    note ? `📝 _${note}_` : '',
    DIV,
    `🛵 Open the run: ${portal}`,
    '',
    '_Tap the link to start live tracking + open turn-by-turn directions._',
    'Reply *ARRIVED* when at the door · *DONE* when delivered.',
  ].filter(Boolean);
  return lines.join('\n');
}
