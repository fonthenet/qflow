import webpush from 'web-push';
import { createClient } from '@/lib/supabase/server';

// Configure web-push with VAPID keys (lazy for Vercel serverless compatibility)
let vapidReady = false;
function initVapid() {
  if (vapidReady) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (pub && priv) {
    webpush.setVapidDetails('mailto:noreply@queueflow.app', pub, priv);
    vapidReady = true;
    return true;
  }
  return false;
}

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  url?: string;
  // Notification type — determines how SW renders it
  type?: 'position_update' | 'called' | 'recall' | 'serving' | 'served' | 'no_show' | 'buzz';
  // Structured queue data for rich notification body
  ticketId?: string;
  ticketNumber?: string;
  position?: number | null;
  estimatedWait?: number | null;
  nowServing?: string | null;
  deskName?: string | null;
  recallCount?: number;
  // Whether to suppress sound/vibration
  silent?: boolean;
}

// FCM urgency mapping — controls Android battery optimization behavior
function getUrgency(type?: string): 'very-low' | 'low' | 'normal' | 'high' {
  switch (type) {
    case 'called':
    case 'recall':
    case 'buzz':
      return 'high';
    case 'serving':
    case 'served':
    case 'no_show':
      return 'normal';
    case 'position_update':
      return 'low';
    default:
      return 'high';
  }
}

/**
 * Send Web Push notification to all subscriptions for a ticket.
 * Called from server actions (runs on Node.js).
 * Returns true if at least one notification was sent successfully.
 */
export async function sendPushToTicket(ticketId: string, payload: PushPayload): Promise<boolean> {
  console.log('[SendPush] Sending push for ticket:', ticketId, payload.type || 'legacy');

  if (!initVapid()) {
    console.warn('[SendPush] VAPID keys not configured, skipping push');
    return false;
  }

  const supabase = await createClient();

  // Retry fetching subscriptions (race condition: subscription may still be saving)
  let subscriptions: { id: string; endpoint: string; p256dh: string; auth: string }[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: subs, error: fetchErr } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('ticket_id', ticketId);

    if (fetchErr) {
      console.error('[SendPush] Failed to fetch subscriptions:', fetchErr);
      return false;
    }

    if (subs && subs.length > 0) {
      subscriptions = subs;
      break;
    }

    if (attempt === 0) {
      console.log('[SendPush] No subscriptions yet, retrying in 1s...');
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  if (subscriptions.length === 0) {
    console.warn('[SendPush] No subscriptions found for ticket:', ticketId);
    return false;
  }

  console.log('[SendPush] Found', subscriptions.length, 'subscription(s)');

  const message = JSON.stringify({ ...payload, ticketId });
  const urgency = getUrgency(payload.type);
  let anySent = false;

  for (const sub of subscriptions) {
    const endpoint = sub.endpoint.slice(0, 60) + '...';
    let sent = false;

    // Try up to 2 times (initial + 1 retry for transient failures)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt > 0) console.log('[SendPush] Retry', attempt, 'for', endpoint);
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          message,
          { urgency }
        );
        console.log('[SendPush] Successfully sent to', endpoint, `(urgency: ${urgency})`);
        sent = true;
        anySent = true;
        break;
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number })?.statusCode;
        console.error('[SendPush] Failed to send:', statusCode, err);

        // 404 or 410 = subscription expired/invalid, clean it up (no retry)
        if (statusCode === 404 || statusCode === 410) {
          console.log('[SendPush] Removing expired subscription:', sub.id);
          await supabase.from('push_subscriptions').delete().eq('id', sub.id);
          break;
        }

        // 429 (rate limited) or 5xx = transient, retry after delay
        if (attempt === 0 && (statusCode === 429 || !statusCode || (statusCode >= 500))) {
          console.log('[SendPush] Transient error, retrying in 1s...');
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }

        // Other errors (400, 401, 403) = don't retry
        break;
      }
    }

    if (!sent) {
      console.warn('[SendPush] Could not deliver to', endpoint);
    }
  }

  return anySent;
}

// ─── Position Update Push ────────────────────────────────────────────────────

// Debounce map: ticketId → timeout handle
const pendingUpdates = new Map<string, ReturnType<typeof setTimeout>>();
const DEBOUNCE_MS = 10_000; // 10 seconds

/**
 * Send a silent position update push to a single ticket.
 * Fetches current position/wait/nowServing from DB and sends.
 */
export async function sendPositionUpdatePush(ticketId: string): Promise<boolean> {
  if (!initVapid()) return false;

  const supabase = await createClient();

  // Fetch ticket with related data
  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, ticket_number, qr_token, status, department_id, service_id, office_id')
    .eq('id', ticketId)
    .single();

  if (!ticket || ticket.status !== 'waiting') return false;

  // Get position and wait time
  const [posResult, waitResult] = await Promise.all([
    supabase.rpc('get_queue_position', { p_ticket_id: ticketId }),
    supabase.rpc('estimate_wait_time', {
      p_department_id: ticket.department_id,
      p_service_id: ticket.service_id,
    }),
  ]);

  // Get "now serving" ticket number
  const { data: servingTicket } = await supabase
    .from('tickets')
    .select('ticket_number')
    .eq('department_id', ticket.department_id)
    .eq('office_id', ticket.office_id)
    .in('status', ['called', 'serving'])
    .order('called_at', { ascending: false })
    .limit(1)
    .single();

  const position = posResult.data ?? null;
  const estimatedWait = waitResult.data ?? null;
  const nowServing = servingTicket?.ticket_number ?? null;

  return sendPushToTicket(ticketId, {
    type: 'position_update',
    title: position ? `QueueFlow · #${position} in line` : 'QueueFlow · In queue',
    body: [
      estimatedWait ? `~${estimatedWait} min wait` : null,
      nowServing ? `Now serving: ${nowServing}` : null,
    ]
      .filter(Boolean)
      .join(' · ') || 'Waiting for your turn',
    tag: `qf-queue-${ticketId}`,
    url: `/q/${ticket.qr_token}`,
    ticketId,
    ticketNumber: ticket.ticket_number,
    position,
    estimatedWait,
    nowServing,
    silent: true,
  });
}

/**
 * Schedule a debounced position update push for a ticket.
 * Multiple rapid calls collapse into one push after DEBOUNCE_MS.
 */
export function schedulePositionUpdate(ticketId: string) {
  const existing = pendingUpdates.get(ticketId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    pendingUpdates.delete(ticketId);
    await sendPositionUpdatePush(ticketId).catch((err) =>
      console.error('[PositionPush] Error for ticket:', ticketId, err)
    );
  }, DEBOUNCE_MS);

  pendingUpdates.set(ticketId, timer);
}

// ─── Notify All Waiting Tickets in a Department ──────────────────────────────

const MAX_WAITING_NOTIFICATIONS = 50;

/**
 * Find all waiting tickets in a department that have push subscriptions,
 * and schedule throttled position update pushes for each.
 * Fire-and-forget — does not block the caller.
 */
export async function notifyWaitingTickets(
  departmentId: string,
  officeId: string,
  excludeTicketId?: string
): Promise<void> {
  try {
    const supabase = await createClient();

    // Find waiting tickets
    let query = supabase
      .from('tickets')
      .select('id')
      .eq('department_id', departmentId)
      .eq('office_id', officeId)
      .eq('status', 'waiting')
      .limit(MAX_WAITING_NOTIFICATIONS);

    if (excludeTicketId) {
      query = query.neq('id', excludeTicketId);
    }

    const { data: waitingTickets } = await query;
    if (!waitingTickets?.length) return;

    // Check which have push subscriptions
    const ticketIds = waitingTickets.map((t) => t.id);
    const { data: subscriptions } = await supabase
      .from('push_subscriptions')
      .select('ticket_id')
      .in('ticket_id', ticketIds);

    const subscribedIds = new Set(subscriptions?.map((s) => s.ticket_id));

    let scheduled = 0;
    for (const ticket of waitingTickets) {
      if (subscribedIds.has(ticket.id)) {
        schedulePositionUpdate(ticket.id);
        scheduled++;
      }
    }

    if (scheduled > 0) {
      console.log(`[NotifyWaiting] Scheduled ${scheduled} position updates for dept ${departmentId.slice(0, 8)}`);
    }
  } catch (err) {
    console.error('[NotifyWaiting] Error:', err);
  }
}
