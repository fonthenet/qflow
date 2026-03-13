import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { SignJWT, importPKCS8 } from 'jose';

type AndroidPushType =
  | 'position_update'
  | 'called'
  | 'recall'
  | 'serving'
  | 'served'
  | 'no_show'
  | 'buzz'
  | 'stop_tracking';

interface AndroidPushPayload {
  type: AndroidPushType;
  title: string;
  body: string;
  url?: string;
  ticketId: string;
  ticketNumber?: string;
  qrToken?: string;
  position?: number | null;
  estimatedWait?: number | null;
  nowServing?: string | null;
  deskName?: string | null;
  recallCount?: number;
  status?: string;
  silent?: boolean;
}

interface AndroidTokenRecord {
  id: string;
  ticket_id: string;
  device_token: string;
  package_name: string | null;
}

interface AndroidTicketState {
  ticketId: string;
  ticketNumber: string;
  qrToken: string;
  url: string;
  status: string;
  position: number | null;
  estimatedWait: number | null;
  nowServing: string | null;
  deskName: string | null;
  recallCount: number;
  type: AndroidPushType;
  title: string;
  body: string;
}

interface GoogleServiceAccountConfig {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

let cachedAccessToken: { token: string; expiresAt: number } | null = null;
const pendingAndroidUpdates = new Map<string, ReturnType<typeof setTimeout>>();
const ANDROID_UPDATE_DEBOUNCE_MS = 10_000;
const MAX_WAITING_ANDROID_UPDATES = 50;

function getTrimmedEnv(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : undefined;
}

function createServiceSupabaseClient() {
  const supabaseUrl =
    getTrimmedEnv('NEXT_PUBLIC_SUPABASE_URL') ||
    getTrimmedEnv('SUPABASE_URL');
  const supabaseKey =
    getTrimmedEnv('SUPABASE_SERVICE_ROLE_KEY') ||
    getTrimmedEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');

  if (!supabaseUrl || !supabaseKey) {
    console.error('[AndroidPush] Supabase credentials not configured');
    return null;
  }

  return createClient(supabaseUrl, supabaseKey);
}

function getGoogleServiceAccountConfig(): GoogleServiceAccountConfig | null {
  const serviceAccountJson = getTrimmedEnv('FCM_SERVICE_ACCOUNT_JSON');
  if (serviceAccountJson) {
    try {
      const parsed = JSON.parse(serviceAccountJson);
      const projectId = parsed.project_id?.trim();
      const clientEmail = parsed.client_email?.trim();
      const privateKey = parsed.private_key?.trim();

      if (projectId && clientEmail && privateKey) {
        return {
          projectId,
          clientEmail,
          privateKey,
        };
      }
    } catch (error) {
      console.error('[AndroidPush] Failed to parse FCM_SERVICE_ACCOUNT_JSON:', error);
    }
  }

  const projectId = getTrimmedEnv('FCM_PROJECT_ID');
  const clientEmail = getTrimmedEnv('FCM_CLIENT_EMAIL');
  const privateKey = getTrimmedEnv('FCM_PRIVATE_KEY');

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  return {
    projectId,
    clientEmail,
    privateKey,
  };
}

export function hasAndroidPushCredentials(): boolean {
  return getGoogleServiceAccountConfig() !== null;
}

async function getGoogleAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccessToken && cachedAccessToken.expiresAt > now + 300) {
    return cachedAccessToken.token;
  }

  const config = getGoogleServiceAccountConfig();
  if (!config) {
    throw new Error('FCM credentials not configured');
  }

  const privateKey = await importPKCS8(
    config.privateKey.replace(/\\n/g, '\n'),
    'RS256'
  );

  const assertion = await new SignJWT({
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(config.clientEmail)
    .setSubject(config.clientEmail)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    cache: 'no-store',
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || typeof data?.access_token !== 'string') {
    throw new Error(
      typeof data?.error_description === 'string'
        ? data.error_description
        : 'Failed to obtain Google access token'
    );
  }

  cachedAccessToken = {
    token: data.access_token,
    expiresAt: now + Number(data.expires_in ?? 3600),
  };

  return data.access_token;
}

function buildAbsoluteQueueUrl(qrToken: string): string {
  const baseUrl = (
    process.env.APP_CLIP_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'https://qflow-sigma.vercel.app'
  ).replace(/\/+$/, '');

  return `${baseUrl}/q/${qrToken}`;
}

function buildCollapseKey(payload: AndroidPushPayload): string | undefined {
  if (payload.type === 'buzz') {
    return undefined;
  }

  if (payload.type === 'called' || payload.type === 'recall') {
    return `qf-alert-${payload.ticketId}`;
  }

  return `qf-live-${payload.ticketId}`;
}

function getAndroidMessagePriority(type: AndroidPushType): 'HIGH' | 'NORMAL' {
  switch (type) {
    case 'called':
    case 'recall':
    case 'buzz':
      return 'HIGH';
    case 'stop_tracking':
      return 'NORMAL';
    default:
      return 'NORMAL';
  }
}

function serializePayload(payload: AndroidPushPayload): Record<string, string> {
  const entries: Record<string, string> = {
    type: payload.type,
    title: payload.title,
    body: payload.body,
    ticketId: payload.ticketId,
    url: payload.url ?? '',
    ticketNumber: payload.ticketNumber ?? '',
    qrToken: payload.qrToken ?? '',
    position: payload.position != null ? String(payload.position) : '',
    estimatedWait: payload.estimatedWait != null ? String(payload.estimatedWait) : '',
    nowServing: payload.nowServing ?? '',
    deskName: payload.deskName ?? '',
    recallCount: payload.recallCount != null ? String(payload.recallCount) : '0',
    status: payload.status ?? '',
    silent: payload.silent ? '1' : '0',
  };

  return entries;
}

async function sendFCMMessage(
  deviceToken: string,
  payload: AndroidPushPayload
): Promise<{ success: boolean; status?: number; error?: string }> {
  const config = getGoogleServiceAccountConfig();
  if (!config) {
    return { success: false, error: 'FCM credentials not configured' };
  }

  const accessToken = await getGoogleAccessToken();
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${config.projectId}/messages:send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token: deviceToken,
          data: serializePayload(payload),
          android: {
            priority: getAndroidMessagePriority(payload.type),
            collapse_key: buildCollapseKey(payload),
            ttl: payload.type === 'position_update' ? '120s' : '30s',
          },
        },
      }),
      cache: 'no-store',
    }
  );

  if (response.ok) {
    return { success: true, status: response.status };
  }

  const data = await response.json().catch(() => ({}));
  const message =
    typeof data?.error?.message === 'string'
      ? data.error.message
      : `FCM request failed with status ${response.status}`;

  return { success: false, status: response.status, error: message };
}

async function loadAndroidTokens(ticketId: string) {
  const supabase = createServiceSupabaseClient();
  if (!supabase) {
    return { supabase: null, tokens: [] as AndroidTokenRecord[] };
  }

  const { data, error } = await supabase
    .from('android_tokens')
    .select('id, ticket_id, device_token, package_name')
    .eq('ticket_id', ticketId);

  if (error) {
    console.error('[AndroidPush] Failed to fetch Android tokens:', error);
    return { supabase, tokens: [] as AndroidTokenRecord[] };
  }

  return {
    supabase,
    tokens: (data ?? []) as AndroidTokenRecord[],
  };
}

export async function sendAndroidToTicket(
  ticketId: string,
  payload: AndroidPushPayload
): Promise<boolean> {
  if (!hasAndroidPushCredentials()) {
    return false;
  }

  const { supabase, tokens } = await loadAndroidTokens(ticketId);
  if (!supabase || tokens.length === 0) {
    return false;
  }

  let anySent = false;

  for (const token of tokens) {
    const result = await sendFCMMessage(token.device_token, payload);

    if (result.success) {
      anySent = true;
      continue;
    }

    console.error(
      `[AndroidPush] Failed to send to token ${token.id}:`,
      result.status,
      result.error
    );

    if (result.status === 404 || result.error?.includes('UNREGISTERED')) {
      await supabase.from('android_tokens').delete().eq('id', token.id);
    }
  }

  return anySent;
}

async function getDeskNameForTicket(supabase: ReturnType<typeof createServiceSupabaseClient>, deskId: string | null) {
  if (!supabase || !deskId) return null;

  const { data } = await supabase
    .from('desks')
    .select('display_name, name')
    .eq('id', deskId)
    .single();

  return data?.display_name ?? data?.name ?? null;
}

export async function getAndroidTicketState(ticketId: string): Promise<AndroidTicketState | null> {
  const supabase = createServiceSupabaseClient();
  if (!supabase) return null;

  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, ticket_number, qr_token, status, department_id, service_id, office_id, desk_id, estimated_wait_minutes, recall_count')
    .eq('id', ticketId)
    .single();

  if (!ticket) return null;

  const [positionResult, waitResult, servingResult, deskName] = await Promise.all([
    ticket.status === 'waiting'
      ? supabase.rpc('get_queue_position', { p_ticket_id: ticket.id })
      : Promise.resolve({ data: null }),
    ticket.status === 'waiting'
      ? supabase.rpc('estimate_wait_time', {
          p_department_id: ticket.department_id,
          p_service_id: ticket.service_id,
        })
      : Promise.resolve({ data: ticket.estimated_wait_minutes ?? null }),
    supabase
      .from('tickets')
      .select('ticket_number')
      .eq('department_id', ticket.department_id)
      .eq('office_id', ticket.office_id)
      .in('status', ['called', 'serving'])
      .order('called_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    getDeskNameForTicket(supabase, ticket.desk_id),
  ]);

  let type: AndroidPushType = 'position_update';
  let title = `QueueFlow · ${ticket.ticket_number}`;
  let body = 'Waiting for your turn';

  switch (ticket.status) {
    case 'waiting': {
      const position = positionResult.data ?? null;
      const estimatedWait = waitResult.data ?? null;
      const nowServing = servingResult.data?.ticket_number ?? null;
      title = `QueueFlow · Ticket ${ticket.ticket_number}`;
      body = [
        position ? `#${position} in line` : null,
        estimatedWait ? `~${estimatedWait} min` : null,
        nowServing ? `Now ${nowServing}` : null,
      ]
        .filter(Boolean)
      .join(' · ') || 'Waiting for your turn';

      return {
        ticketId: ticket.id,
        ticketNumber: ticket.ticket_number,
        qrToken: ticket.qr_token,
        url: buildAbsoluteQueueUrl(ticket.qr_token),
        status: ticket.status,
        position,
        estimatedWait,
        nowServing,
        deskName,
        recallCount: ticket.recall_count ?? 0,
        type,
        title,
        body,
      };
    }
    case 'called':
      type = 'called';
      title = `Go to ${deskName ?? 'your desk'}`;
      body = `Ticket ${ticket.ticket_number} • Proceed now`;
      break;
    case 'serving':
      type = 'serving';
      title = 'Being Served';
      body = deskName ? `At ${deskName}` : `Ticket ${ticket.ticket_number}`;
      break;
    case 'served':
      type = 'served';
      title = 'Visit Complete';
      body = 'Thanks for visiting. Tap to leave feedback.';
      break;
    case 'no_show':
      type = 'no_show';
      title = 'Missed Your Turn';
      body = `Ticket ${ticket.ticket_number} was marked as no-show.`;
      break;
    default:
      type = 'position_update';
      title = `QueueFlow · ${ticket.ticket_number}`;
      body = 'Open QueueFlow to continue tracking your visit.';
      break;
  }

  return {
    ticketId: ticket.id,
    ticketNumber: ticket.ticket_number,
    qrToken: ticket.qr_token,
    url: buildAbsoluteQueueUrl(ticket.qr_token),
    status: ticket.status,
    position: null,
    estimatedWait: ticket.estimated_wait_minutes ?? null,
    nowServing: servingResult.data?.ticket_number ?? null,
    deskName,
    recallCount: ticket.recall_count ?? 0,
    type,
    title,
    body,
  };
}

export async function sendAndroidLiveUpdateForTicket(ticketId: string): Promise<boolean> {
  const state = await getAndroidTicketState(ticketId);
  if (!state) {
    return false;
  }

  return sendAndroidToTicket(ticketId, {
    type: state.type,
    title: state.title,
    body: state.body,
    url: state.url,
    ticketId: state.ticketId,
    ticketNumber: state.ticketNumber,
    qrToken: state.qrToken,
    position: state.position,
    estimatedWait: state.estimatedWait,
    nowServing: state.nowServing,
    deskName: state.deskName,
    recallCount: state.recallCount,
    status: state.status,
    silent: state.type === 'position_update' || state.type === 'serving',
  });
}

export function scheduleAndroidPositionUpdate(ticketId: string) {
  const existing = pendingAndroidUpdates.get(ticketId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    pendingAndroidUpdates.delete(ticketId);
    await sendAndroidLiveUpdateForTicket(ticketId).catch((error) => {
      console.error('[AndroidPush] Position update failed:', ticketId, error);
    });
  }, ANDROID_UPDATE_DEBOUNCE_MS);

  pendingAndroidUpdates.set(ticketId, timer);
}

export async function notifyWaitingAndroidTickets(
  departmentId: string,
  officeId: string,
  excludeTicketId?: string
): Promise<void> {
  if (!hasAndroidPushCredentials()) {
    return;
  }

  const supabase = createServiceSupabaseClient();
  if (!supabase) {
    return;
  }

  let query = supabase
    .from('tickets')
    .select('id')
    .eq('department_id', departmentId)
    .eq('office_id', officeId)
    .eq('status', 'waiting')
    .limit(MAX_WAITING_ANDROID_UPDATES);

  if (excludeTicketId) {
    query = query.neq('id', excludeTicketId);
  }

  const { data: waitingTickets } = await query;
  if (!waitingTickets?.length) {
    return;
  }

  const ticketIds = waitingTickets.map((ticket) => ticket.id);
  const { data: androidTokens } = await supabase
    .from('android_tokens')
    .select('ticket_id')
    .in('ticket_id', ticketIds);

  const trackedIds = new Set((androidTokens ?? []).map((row) => row.ticket_id));

  for (const waitingTicket of waitingTickets) {
    if (trackedIds.has(waitingTicket.id)) {
      scheduleAndroidPositionUpdate(waitingTicket.id);
    }
  }
}
