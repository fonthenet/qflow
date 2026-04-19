import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { SignJWT, importPKCS8 } from 'jose';
import { APP_BASE_URL } from '@/lib/config';

type AndroidPushType =
  | 'position_update'
  | 'called'
  | 'recall'
  | 'serving'
  | 'served'
  | 'no_show'
  | 'buzz'
  | 'stop_tracking'
  | 'appointment_update'
  | 'appointment_rescheduled';

interface AndroidPushPayload {
  type: AndroidPushType;
  title: string;
  body: string;
  url?: string;
  ticketId?: string;
  appointmentId?: string;
  ticketNumber?: string;
  qrToken?: string;
  position?: number | null;
  estimatedWait?: number | null;
  nowServing?: string | null;
  deskName?: string | null;
  officeName?: string | null;
  departmentName?: string | null;
  serviceName?: string | null;
  servingStartedAt?: string | null;
  recallCount?: number;
  status?: string;
  silent?: boolean;
}

interface AndroidTokenRecord {
  id: string;
  ticket_id: string | null;
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
  officeName: string | null;
  departmentName: string | null;
  serviceName: string | null;
  servingStartedAt: string | null;
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
  return `${APP_BASE_URL}/q/${qrToken}`;
}

function buildCollapseKey(payload: AndroidPushPayload): string | undefined {
  if (payload.type === 'buzz') {
    return undefined;
  }

  const key = payload.ticketId ?? payload.appointmentId ?? 'unknown';
  if (payload.type === 'called' || payload.type === 'recall') {
    return `qf-alert-${key}`;
  }
  if (payload.type === 'appointment_update') {
    return `qf-appt-${key}`;
  }

  return `qf-live-${key}`;
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

function getAndroidChannelId(type: AndroidPushType): string {
  switch (type) {
    case 'called':
    case 'recall':
    case 'buzz':
      return 'queue-alerts';
    default:
      return 'queue-updates';
  }
}

function serializePayload(payload: AndroidPushPayload): Record<string, string> {
  const entries: Record<string, string> = {
    type: payload.type,
    title: payload.title,
    body: payload.body,
    ticketId: payload.ticketId ?? '',
    appointmentId: payload.appointmentId ?? '',
    url: payload.url ?? '',
    ticketNumber: payload.ticketNumber ?? '',
    qrToken: payload.qrToken ?? '',
    position: payload.position != null ? String(payload.position) : '',
    estimatedWait: payload.estimatedWait != null ? String(payload.estimatedWait) : '',
    nowServing: payload.nowServing ?? '',
    deskName: payload.deskName ?? '',
    officeName: payload.officeName ?? '',
    departmentName: payload.departmentName ?? '',
    serviceName: payload.serviceName ?? '',
    servingStartedAt: payload.servingStartedAt ?? '',
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
          // data payload: available in foreground AND background handlers
          data: serializePayload(payload),
          // notification block: shown by the OS when app is background or killed
          ...(payload.silent
            ? {}
            : {
                notification: {
                  title: payload.title,
                  body: payload.body,
                },
              }),
          android: {
            priority: getAndroidMessagePriority(payload.type),
            collapse_key: buildCollapseKey(payload),
            ttl: payload.type === 'position_update' ? '120s' : '30s',
            notification: payload.silent
              ? undefined
              : {
                  channel_id: getAndroidChannelId(payload.type),
                  sound: 'default',
                  notification_priority:
                    getAndroidMessagePriority(payload.type) === 'HIGH'
                      ? 'PRIORITY_MAX'
                      : 'PRIORITY_DEFAULT',
                  visibility: 'PUBLIC',
                  // click_action wakes the app and delivers data to the response handler
                  click_action: 'FLUTTER_NOTIFICATION_CLICK',
                },
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

export async function sendAndroidToAppointment(
  appointmentId: string,
  payload: AndroidPushPayload
): Promise<boolean> {
  if (!hasAndroidPushCredentials()) {
    return false;
  }

  const supabase = createServiceSupabaseClient();
  if (!supabase) return false;

  const { data, error } = await supabase
    .from('android_tokens')
    .select('id, ticket_id, device_token, package_name')
    .eq('appointment_id', appointmentId);

  if (error) {
    console.error('[AndroidPush] Failed to fetch appointment tokens:', error);
    return false;
  }

  const tokens = (data ?? []) as AndroidTokenRecord[];
  if (tokens.length === 0) return false;

  let anySent = false;
  for (const token of tokens) {
    const result = await sendFCMMessage(token.device_token, payload);
    if (result.success) {
      anySent = true;
      continue;
    }
    console.error(
      `[AndroidPush] Failed to send to appt token ${token.id}:`,
      result.status,
      result.error
    );
    if (result.status === 404 || result.error?.includes('UNREGISTERED')) {
      await supabase.from('android_tokens').delete().eq('id', token.id);
    }
  }
  return anySent;
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
    .select('id, ticket_number, qr_token, status, department_id, service_id, office_id, desk_id, estimated_wait_minutes, recall_count, serving_started_at, office:offices(name), department:departments(name), service:services(name)')
    .eq('id', ticketId)
    .single();

  if (!ticket) return null;

  const [queueResult, servingResult, deskName] = await Promise.all([
    ticket.status === 'waiting'
      ? supabase.rpc('get_queue_position', { p_ticket_id: ticket.id })
      : Promise.resolve({ data: null }),
    supabase
      .from('tickets')
      .select('ticket_number')
      .eq('service_id', ticket.service_id)
      .eq('office_id', ticket.office_id)
      .in('status', ['called', 'serving'])
      .order('called_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    getDeskNameForTicket(supabase, ticket.desk_id),
  ]);

  // Extract position and wait from canonical jsonb response
  const posObj = queueResult.data as Record<string, unknown> | null;
  const positionResult = { data: typeof posObj?.position === 'number' ? posObj.position : null };
  const waitResult = { data: typeof posObj?.estimated_wait_minutes === 'number' ? posObj.estimated_wait_minutes : null };

  let type: AndroidPushType = 'position_update';
  const officeRaw = ticket.office as unknown as { name: string } | { name: string }[] | null;
  const officeName = (Array.isArray(officeRaw) ? officeRaw[0]?.name : officeRaw?.name) ?? null;
  const deptRaw = ticket.department as unknown as { name: string } | { name: string }[] | null;
  const departmentName = (Array.isArray(deptRaw) ? deptRaw[0]?.name : deptRaw?.name) ?? null;
  const svcRaw = ticket.service as unknown as { name: string } | { name: string }[] | null;
  const serviceName = (Array.isArray(svcRaw) ? svcRaw[0]?.name : svcRaw?.name) ?? departmentName ?? officeName ?? null;
  let title = serviceName ?? `Ticket ${ticket.ticket_number}`;
  let body = 'Waiting for your turn';

  switch (ticket.status) {
    case 'waiting': {
      const position = positionResult.data ?? null;
      const estimatedWait = waitResult.data ?? null;
      const nowServing = servingResult.data?.ticket_number ?? null;
      title = serviceName ?? `Ticket ${ticket.ticket_number}`;
      body = [
        position ? `#${position} in line` : null,
        estimatedWait ? `~${estimatedWait} min` : null,
        nowServing ? `Now ${nowServing}` : null,
        officeName && officeName !== serviceName ? officeName : null,
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
        officeName,
        departmentName,
        serviceName,
        servingStartedAt: ticket.serving_started_at ?? null,
        recallCount: ticket.recall_count ?? 0,
        type,
        title,
        body,
      };
    }
    case 'called':
      type = 'called';
      title = `Go to ${deskName ?? 'your desk'}`;
      body = [serviceName, `Ticket ${ticket.ticket_number}`, 'Proceed now']
        .filter(Boolean)
        .join(' • ');
      break;
    case 'serving':
      type = 'serving';
      title = serviceName ?? 'With staff now';
      body = [deskName ? `At ${deskName}` : null, officeName]
        .filter(Boolean)
        .join(' • ') || `Ticket ${ticket.ticket_number}`;
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
      title = serviceName ?? `Ticket ${ticket.ticket_number}`;
      body = 'Open your visit to continue tracking.';
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
    officeName,
    departmentName,
    serviceName,
    servingStartedAt: ticket.serving_started_at ?? null,
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
