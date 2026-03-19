/**
 * Apple Push Notification service (APNs) HTTP/2 client.
 * Sends standard alert pushes and ActivityKit Live Activity updates.
 */

import { connect } from 'node:http2';
import { SignJWT, importPKCS8 } from 'jose';
import { createClient } from '@supabase/supabase-js';

const APNS_HOST_PRODUCTION = 'https://api.push.apple.com';
const APNS_HOST_SANDBOX = 'https://api.development.push.apple.com';
const DEFAULT_APNS_BUNDLE_ID =
  process.env.APNS_BUNDLE_ID?.trim() || 'com.queueflow.app.QueueFlowClip';
const SWIFT_REFERENCE_DATE_UNIX_SECONDS = 978307200;

function getTrimmedEnv(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : undefined;
}

let cachedToken: { jwt: string; expiresAt: number } | null = null;

async function getAPNsJWT(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  if (cachedToken && cachedToken.expiresAt > now + 300) {
    return cachedToken.jwt;
  }

  const keyId = getTrimmedEnv('APNS_KEY_ID');
  const teamId = getTrimmedEnv('APNS_TEAM_ID');
  const keyP8 = getTrimmedEnv('APNS_KEY_P8');

  if (!keyId || !teamId || !keyP8) {
    throw new Error('APNs credentials not configured (APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY_P8)');
  }

  const pemKey = keyP8.replace(/\\n/g, '\n').trim();
  const privateKey = await importPKCS8(pemKey, 'ES256');

  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt(now)
    .sign(privateKey);

  cachedToken = { jwt, expiresAt: now + 55 * 60 };
  return jwt;
}

interface APNsPayload {
  title: string;
  body: string;
  sound?: string;
  url?: string;
}

type APNsEnvironment = 'production' | 'sandbox';
type APNsKind = 'alert' | 'liveactivity';
type LiveActivityEvent = 'update' | 'end';

interface APNsTarget {
  kind: APNsKind;
  environment: APNsEnvironment;
  bundleId: string;
}

interface APNsSendResult {
  success: boolean;
  status?: number;
  reason?: string;
}

interface APNsTokenRecord {
  id: string;
  device_token: string;
  environment: string | null;
}

interface QueueLiveActivityState {
  status: string;
  position?: number | null;
  estimatedWaitMinutes?: number | null;
  nowServing?: string | null;
  deskName?: string | null;
  recallCount: number;
  calledAt?: Date | null;
  servingStartedAt?: Date | null;
  updatedAt?: Date;
}

interface QueueLiveActivityPayload {
  event?: LiveActivityEvent;
  state: QueueLiveActivityState;
  staleDate?: Date;
  dismissalDate?: Date;
  alert?: {
    title: string;
    body: string;
    sound?: string;
  };
}

interface TicketSnapshot {
  id: string;
  ticket_number: string;
  qr_token: string;
  office_id: string;
  department_id: string;
  service_id: string;
  status: string;
  desk_id: string | null;
  called_at: string | null;
  serving_started_at: string | null;
  estimated_wait_minutes: number | null;
  recall_count: number | null;
  department: { name: string } | null;
  service: { name: string } | null;
  desk: { name: string; display_name: string | null } | null;
}

function hasAPNsCredentials(): boolean {
  return Boolean(
    getTrimmedEnv('APNS_KEY_ID') &&
    getTrimmedEnv('APNS_TEAM_ID') &&
    getTrimmedEnv('APNS_KEY_P8')
  );
}

function buildInvocationURL(urlPath?: string): string | undefined {
  if (!urlPath) return undefined;

  if (/^https?:\/\//i.test(urlPath)) {
    return urlPath;
  }

  const baseURL = (
    process.env.APP_CLIP_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'https://qflo.net'
  ).replace(/\/+$/, '');

  const normalizedPath = urlPath.startsWith('/') ? urlPath : `/${urlPath}`;
  return `${baseURL}${normalizedPath}`;
}

function parseAPNsTarget(rawTarget?: string | null): APNsTarget {
  if (!rawTarget) {
    return {
      kind: 'alert',
      environment: 'production',
      bundleId: DEFAULT_APNS_BUNDLE_ID,
    };
  }

  const parts = rawTarget.split('|');

  if (parts[0] === 'alert' || parts[0] === 'liveactivity') {
    const [, rawEnvironment, rawBundleId] = parts;
    return {
      kind: parts[0],
      environment: rawEnvironment === 'sandbox' ? 'sandbox' : 'production',
      bundleId: rawBundleId?.trim() || DEFAULT_APNS_BUNDLE_ID,
    };
  }

  const [rawEnvironment, rawBundleId] = parts;
  return {
    kind: 'alert',
    environment: rawEnvironment === 'sandbox' ? 'sandbox' : 'production',
    bundleId: rawBundleId?.trim() || DEFAULT_APNS_BUNDLE_ID,
  };
}

function buildAPNsTopic(target: APNsTarget): string {
  if (target.kind === 'liveactivity') {
    return `${target.bundleId}.push-type.liveactivity`;
  }

  return target.bundleId;
}

function buildAPNsHeaders(target: APNsTarget, jwt: string) {
  return {
    ':method': 'POST',
    authorization: `bearer ${jwt}`,
    'apns-topic': buildAPNsTopic(target),
    'apns-push-type': target.kind === 'liveactivity' ? 'liveactivity' : 'alert',
    'apns-priority': target.kind === 'liveactivity' ? '5' : '10',
    'apns-expiration': '0',
    'content-type': 'application/json',
  };
}

async function sendAPNsRequest(
  deviceToken: string,
  target: APNsTarget,
  payload: Record<string, unknown>
): Promise<APNsSendResult> {
  const host = target.environment === 'sandbox' ? APNS_HOST_SANDBOX : APNS_HOST_PRODUCTION;
  const jwt = await getAPNsJWT();

  return await new Promise((resolve) => {
    const client = connect(host);
    let settled = false;
    let statusCode: number | undefined;
    let responseBody = '';

    const finish = (result: APNsSendResult) => {
      if (settled) return;
      settled = true;
      client.close();
      resolve(result);
    };

    client.on('error', (err) => {
      console.error('[APNs] HTTP/2 session error:', err);
      finish({ success: false, reason: 'network_error' });
    });

    const request = client.request({
      ...buildAPNsHeaders(target, jwt),
      ':path': `/3/device/${deviceToken}`,
    });

    request.setEncoding('utf8');

    request.on('response', (headers) => {
      const rawStatus = headers[':status'];
      statusCode = typeof rawStatus === 'number' ? rawStatus : Number(rawStatus);
    });

    request.on('data', (chunk) => {
      responseBody += chunk;
    });

    request.on('end', () => {
      if (statusCode === 200) {
        finish({ success: true, status: 200 });
        return;
      }

      let reason = 'unknown';
      if (responseBody) {
        try {
          reason = JSON.parse(responseBody).reason || reason;
        } catch {
          reason = responseBody;
        }
      }

      console.error(
        `[APNs] Failed: ${statusCode ?? 'unknown'} ${reason} for token ${deviceToken.slice(0, 12)}...` +
          ` kind=${target.kind} env=${target.environment} topic=${buildAPNsTopic(target)}`
      );

      finish({ success: false, status: statusCode, reason });
    });

    request.on('error', (err) => {
      console.error('[APNs] Network error:', err);
      finish({ success: false, reason: 'network_error' });
    });

    request.setTimeout(10_000, () => {
      console.error('[APNs] Request timed out');
      request.close();
      finish({ success: false, reason: 'timeout' });
    });

    request.end(JSON.stringify(payload));
  });
}

async function sendAlertNotification(
  deviceToken: string,
  payload: APNsPayload,
  target: APNsTarget
): Promise<APNsSendResult> {
  const invocationURL = buildInvocationURL(payload.url);

  const apnsPayload = {
    aps: {
      alert: {
        title: payload.title,
        body: payload.body,
      },
      sound: payload.sound || 'default',
      'interruption-level': 'time-sensitive' as const,
      'mutable-content': 1,
      ...(invocationURL ? { 'target-content-id': invocationURL } : {}),
    },
    url: invocationURL,
  };

  return sendAPNsRequest(deviceToken, target, apnsPayload);
}

function toSwiftReferenceDateSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000) - SWIFT_REFERENCE_DATE_UNIX_SECONDS;
}

function serializeLiveActivityState(state: QueueLiveActivityState) {
  return {
    status: state.status,
    ...(state.position != null ? { position: state.position } : {}),
    ...(state.estimatedWaitMinutes != null
      ? { estimatedWaitMinutes: state.estimatedWaitMinutes }
      : {}),
    ...(state.nowServing ? { nowServing: state.nowServing } : {}),
    ...(state.deskName ? { deskName: state.deskName } : {}),
    recallCount: state.recallCount,
    ...(state.calledAt ? { calledAt: toSwiftReferenceDateSeconds(state.calledAt) } : {}),
    ...(state.servingStartedAt
      ? { servingStartedAt: toSwiftReferenceDateSeconds(state.servingStartedAt) }
      : {}),
    updatedAt: toSwiftReferenceDateSeconds(state.updatedAt ?? new Date()),
  };
}

async function sendLiveActivityNotification(
  deviceToken: string,
  payload: QueueLiveActivityPayload,
  target: APNsTarget
): Promise<APNsSendResult> {
  const now = Math.floor(Date.now() / 1000);

  const aps: Record<string, unknown> = {
    timestamp: now,
    event: payload.event ?? 'update',
    'content-state': serializeLiveActivityState(payload.state),
  };

  if ((payload.event ?? 'update') === 'update') {
    aps['stale-date'] = Math.floor(
      (payload.staleDate ?? new Date(Date.now() + 15 * 60_000)).getTime() / 1000
    );
  }

  if ((payload.event ?? 'update') === 'end' && payload.dismissalDate) {
    aps['dismissal-date'] = Math.floor(payload.dismissalDate.getTime() / 1000);
  }

  if (payload.alert) {
    aps.alert = {
      title: payload.alert.title,
      body: payload.alert.body,
    };
    aps.sound = payload.alert.sound || 'default';
    aps['interruption-level'] = 'time-sensitive';
  }

  return sendAPNsRequest(deviceToken, target, { aps });
}

function createServiceSupabaseClient() {
  const supabaseUrl =
    getTrimmedEnv('NEXT_PUBLIC_SUPABASE_URL') ||
    getTrimmedEnv('SUPABASE_URL');
  const supabaseKey =
    getTrimmedEnv('SUPABASE_SERVICE_ROLE_KEY') ||
    getTrimmedEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');

  if (!supabaseUrl || !supabaseKey) {
    console.error('[APNs] Supabase credentials not configured');
    return null;
  }

  return createClient(supabaseUrl, supabaseKey);
}

async function loadTicketTokens(ticketId: string) {
  const supabase = createServiceSupabaseClient();
  if (!supabase) {
    return { supabase: null, tokens: [] };
  }

  const { data: tokens, error } = await supabase
    .from('apns_tokens')
    .select('id, device_token, environment')
    .eq('ticket_id', ticketId);

  if (error) {
    console.error('[APNs] Failed to fetch tokens:', error);
    return { supabase, tokens: [] };
  }

  return { supabase, tokens: (tokens ?? []) as APNsTokenRecord[] };
}

async function sendToTicketTokens(
  ticketId: string,
  kind: APNsKind,
  sender: (token: APNsTokenRecord, target: APNsTarget) => Promise<APNsSendResult>
): Promise<boolean> {
  if (!hasAPNsCredentials()) {
    return false;
  }

  const { supabase, tokens } = await loadTicketTokens(ticketId);
  if (!supabase) {
    return false;
  }

  const matchingTokens = tokens.filter((token) => parseAPNsTarget(token.environment).kind === kind);

  if (matchingTokens.length === 0) {
    console.log(`[APNs] No ${kind} tokens for ticket:`, ticketId);
    return false;
  }

  console.log(`[APNs] Sending ${kind} notification for ticket:`, ticketId);
  let anySent = false;

  for (const token of matchingTokens) {
    const target = parseAPNsTarget(token.environment);
    const result = await sender(token, target);

    if (result.success) {
      anySent = true;
      continue;
    }

    if (result.status === 410 || result.reason === 'Unregistered') {
      console.log('[APNs] Removing invalid token:', token.id);
      await supabase.from('apns_tokens').delete().eq('id', token.id);
      continue;
    }

    if (result.reason === 'BadDeviceToken' || result.reason === 'DeviceTokenNotForTopic') {
      console.warn(
        `[APNs] Preserving token ${token.id} after ${result.reason};` +
          ` verify APNs topic match (${buildAPNsTopic(target)})`
      );
    }
  }

  return anySent;
}

export async function sendAPNsToTicket(
  ticketId: string,
  payload: APNsPayload
): Promise<boolean> {
  return sendToTicketTokens(ticketId, 'alert', (token, target) =>
    sendAlertNotification(token.device_token, payload, target)
  );
}

export async function sendLiveActivityUpdateToTicket(
  ticketId: string,
  payload: QueueLiveActivityPayload
): Promise<boolean> {
  return sendToTicketTokens(ticketId, 'liveactivity', (token, target) =>
    sendLiveActivityNotification(token.device_token, payload, target)
  );
}

async function fetchLiveActivitySnapshot(ticketId: string): Promise<{
  ticket: TicketSnapshot;
  state: QueueLiveActivityState;
} | null> {
  const supabase = createServiceSupabaseClient();
  if (!supabase) {
    return null;
  }

  const { data: ticketData, error } = await supabase
    .from('tickets')
    .select(
      'id, ticket_number, qr_token, office_id, department_id, service_id, status, desk_id, called_at, serving_started_at, estimated_wait_minutes, recall_count, department:departments(name), service:services(name), desk:desks(name, display_name)'
    )
    .eq('id', ticketId)
    .single();

  const ticket = ticketData as TicketSnapshot | null;

  if (error || !ticket) {
    console.error('[LiveActivity] Failed to fetch ticket snapshot:', error);
    return null;
  }

  let position: number | null = null;
  let nowServing: string | null = null;

  if (ticket.status === 'waiting') {
    const { data: queueData, error: positionError } = await supabase.rpc('get_queue_position', {
      p_ticket_id: ticket.id,
    });

    if (!positionError && queueData && typeof queueData === 'object') {
      const posObj = queueData as Record<string, unknown>;
      if (typeof posObj.position === 'number' && posObj.position > 0) {
        position = posObj.position;
      }
    }

    const { data: activeTickets, error: activeError } = await supabase
      .from('tickets')
      .select('ticket_number')
      .eq('service_id', ticket.service_id)
      .eq('office_id', ticket.office_id)
      .in('status', ['serving', 'called'])
      .order('called_at', { ascending: false })
      .limit(1);

    if (!activeError) {
      nowServing = activeTickets?.[0]?.ticket_number ?? null;
    }
  } else if (ticket.status === 'called' || ticket.status === 'serving') {
    nowServing = ticket.ticket_number;
  }

  return {
    ticket,
    state: {
      status: ticket.status,
      position,
      estimatedWaitMinutes: ticket.estimated_wait_minutes,
      nowServing,
      deskName: ticket.desk?.display_name ?? ticket.desk?.name ?? null,
      recallCount: ticket.recall_count ?? 0,
      calledAt: ticket.called_at ? new Date(ticket.called_at) : null,
      servingStartedAt: ticket.serving_started_at ? new Date(ticket.serving_started_at) : null,
      updatedAt: new Date(),
    },
  };
}

function shouldEndLiveActivity(status: string): boolean {
  return status === 'served' || status === 'no_show' || status === 'cancelled' || status === 'transferred';
}

export async function sendLiveActivityUpdateForTicket(ticketId: string): Promise<boolean> {
  const snapshot = await fetchLiveActivitySnapshot(ticketId);
  if (!snapshot) {
    return false;
  }

  const { state } = snapshot;

  return sendLiveActivityUpdateToTicket(ticketId, {
    event: shouldEndLiveActivity(state.status) ? 'end' : 'update',
    state,
    dismissalDate: shouldEndLiveActivity(state.status)
      ? new Date(Date.now() + 60_000)
      : undefined,
  });
}

export async function endLiveActivityForTicket(ticketId: string): Promise<boolean> {
  const snapshot = await fetchLiveActivitySnapshot(ticketId);
  if (!snapshot) {
    return false;
  }

  return sendLiveActivityUpdateToTicket(ticketId, {
    event: 'end',
    state: snapshot.state,
    dismissalDate: new Date(),
  });
}
