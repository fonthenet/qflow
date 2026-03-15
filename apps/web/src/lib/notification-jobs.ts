import { createClient } from '@supabase/supabase-js';
import { sendAPNsToTicket, sendLiveActivityUpdateForTicket } from '@/lib/apns';
import { sendAndroidToTicket } from '@/lib/android-push';
import { maybeSendPriorityAlertSms } from '@/lib/priority-alert-delivery';
import { sendPushToTicket } from '@/lib/send-push';

const MAX_JOB_ATTEMPTS = 4;
const JOB_DEDUPE_WINDOW_MS = 2500;

type AlertEvent =
  | 'called'
  | 'recall'
  | 'buzz'
  | 'serving'
  | 'served'
  | 'no_show'
  | 'reset'
  | 'transferred';

type DeliveryAlertEvent = Exclude<AlertEvent, 'reset' | 'transferred'>;

type JobChannel = 'job_pending' | 'job_processing' | 'job_retrying' | 'job_sent' | 'job_failed';

type DeliveryJobKind = 'customer_alert' | 'live_activity_sync';

interface JobDeliveryResult {
  attempted: boolean;
  delivered: boolean;
  note?: string;
}

interface DeliveryResults {
  webpush?: JobDeliveryResult;
  apns?: JobDeliveryResult;
  android?: JobDeliveryResult;
  sms?: JobDeliveryResult;
  liveActivity?: JobDeliveryResult;
}

interface BaseJobPayload {
  kind: DeliveryJobKind;
  event: AlertEvent;
  ticketId: string;
  dedupeKey: string;
  attemptCount: number;
  nextAttemptAt: string | null;
  lastError?: string | null;
  results?: DeliveryResults;
}

interface AlertJobPayload extends BaseJobPayload {
  kind: 'customer_alert';
  event: DeliveryAlertEvent;
  title: string;
  body: string;
  url: string;
  ticketNumber: string;
  qrToken: string;
  officeId: string;
  customerData: unknown;
  deskName: string;
  status: string;
  recallCount: number;
  sendApns: boolean;
  sendAndroid: boolean;
  sendSms: boolean;
  sendWebPush: boolean;
}

interface LiveActivityJobPayload extends BaseJobPayload {
  kind: 'live_activity_sync';
  delayMs?: number;
}

type DeliveryJobPayload = AlertJobPayload | LiveActivityJobPayload;

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
    console.error('[NotificationJobs] Supabase credentials not configured');
    return null;
  }

  return createClient(supabaseUrl, supabaseKey);
}

function buildDedupeKey(kind: DeliveryJobKind, ticketId: string, event: AlertEvent) {
  return `${kind}:${event}:${ticketId}`;
}

function shouldRetry(payload: DeliveryJobPayload) {
  return payload.attemptCount < MAX_JOB_ATTEMPTS;
}

function withRetryDelay(payload: DeliveryJobPayload) {
  const delayMs = Math.min(1000 * 2 ** payload.attemptCount, 15000);
  return {
    ...payload,
    nextAttemptAt: new Date(Date.now() + delayMs).toISOString(),
  };
}

function makeResult(attempted: boolean, delivered: boolean, note?: string): JobDeliveryResult {
  return { attempted, delivered, note };
}

async function upsertJobState(
  jobId: string,
  channel: JobChannel,
  payload: DeliveryJobPayload,
  sentAt?: string | null
) {
  const supabase = createServiceSupabaseClient();
  if (!supabase) return;

  await supabase
    .from('notifications')
    .update({
      channel,
      payload,
      sent_at: sentAt ?? null,
    })
    .eq('id', jobId);
}

async function enqueueJob(payload: DeliveryJobPayload) {
  const supabase = createServiceSupabaseClient();
  if (!supabase) return null;

  const { data: existing } = await supabase
    .from('notifications')
    .select('id, created_at, channel, payload')
    .eq('ticket_id', payload.ticketId)
    .eq('type', `job_${payload.kind}_${payload.event}`)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.created_at) {
    const existingAt = new Date(existing.created_at).getTime();
    if (Date.now() - existingAt < JOB_DEDUPE_WINDOW_MS) {
      const existingPayload = (existing.payload ?? {}) as { dedupeKey?: string };
      if (existingPayload.dedupeKey === payload.dedupeKey) {
        return existing.id;
      }
    }
  }

  const { data, error } = await supabase
    .from('notifications')
    .insert({
      ticket_id: payload.ticketId,
      type: `job_${payload.kind}_${payload.event}`,
      channel: 'job_pending',
      payload,
      sent_at: null,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[NotificationJobs] Failed to enqueue job:', error);
    return null;
  }

  return data?.id ?? null;
}

export async function enqueueAlertJob(params: {
  event: DeliveryAlertEvent;
  ticketId: string;
  ticketNumber: string;
  qrToken: string;
  officeId: string;
  customerData: unknown;
  deskName: string;
  status: string;
  recallCount?: number;
  title: string;
  body: string;
  url: string;
  sendApns?: boolean;
  sendAndroid?: boolean;
  sendSms?: boolean;
  sendWebPush?: boolean;
}) {
  const payload: AlertJobPayload = {
    kind: 'customer_alert',
    event: params.event,
    ticketId: params.ticketId,
    ticketNumber: params.ticketNumber,
    qrToken: params.qrToken,
    officeId: params.officeId,
    customerData: params.customerData,
    deskName: params.deskName,
    status: params.status,
    recallCount: params.recallCount ?? 0,
    title: params.title,
    body: params.body,
    url: params.url,
    sendApns: params.sendApns ?? false,
    sendAndroid: params.sendAndroid ?? true,
    sendSms: params.sendSms ?? false,
    sendWebPush: params.sendWebPush ?? true,
    dedupeKey: buildDedupeKey('customer_alert', params.ticketId, params.event),
    attemptCount: 0,
    nextAttemptAt: null,
    results: {},
  };

  return enqueueJob(payload);
}

export async function enqueueLiveActivitySyncJob(params: {
  event: AlertEvent;
  ticketId: string;
  delayMs?: number;
}) {
  const payload: LiveActivityJobPayload = {
    kind: 'live_activity_sync',
    event: params.event,
    ticketId: params.ticketId,
    dedupeKey: buildDedupeKey('live_activity_sync', params.ticketId, params.event),
    attemptCount: 0,
    nextAttemptAt: params.delayMs ? new Date(Date.now() + params.delayMs).toISOString() : null,
    results: {},
    delayMs: params.delayMs,
  };

  return enqueueJob(payload);
}

async function processAlertJob(jobId: string, payload: AlertJobPayload) {
  const results: DeliveryResults = { ...(payload.results ?? {}) };

  const webPushPromise = payload.sendWebPush
    ? sendPushToTicket(payload.ticketId, {
        type: payload.event,
        title: payload.title,
        body: payload.body,
        tag: payload.event === 'buzz'
          ? `qf-buzz-${payload.ticketId}-${Date.now()}`
          : `qf-${payload.event}-${payload.ticketId}`,
        url: payload.url,
        ticketId: payload.ticketId,
        ticketNumber: payload.ticketNumber,
        deskName: payload.deskName,
        recallCount: payload.recallCount,
        silent: payload.event === 'served' || payload.event === 'serving' || payload.event === 'no_show',
      })
        .then((delivered) => {
          results.webpush = makeResult(true, delivered, delivered ? 'delivered' : 'no subscription');
          return delivered;
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          results.webpush = makeResult(true, false, message);
          return false;
        })
    : Promise.resolve(false);

  const apnsPromise = payload.sendApns
    ? sendAPNsToTicket(payload.ticketId, {
        title: payload.title,
        body: payload.body,
        url: payload.url,
      })
        .then((delivered) => {
          results.apns = makeResult(true, delivered, delivered ? 'delivered' : 'no token or provider rejected');
          return delivered;
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          results.apns = makeResult(true, false, message);
          return false;
        })
    : Promise.resolve(false);

  const androidPromise = payload.sendAndroid
    ? sendAndroidToTicket(payload.ticketId, {
        type: payload.event,
        title: payload.title,
        body: payload.body,
        url: payload.url,
        ticketId: payload.ticketId,
        ticketNumber: payload.ticketNumber,
        qrToken: payload.qrToken,
        deskName: payload.deskName,
        status: payload.status,
        recallCount: payload.recallCount,
        silent: payload.event === 'served' || payload.event === 'serving' || payload.event === 'no_show',
      })
        .then((delivered) => {
          results.android = makeResult(true, delivered, delivered ? 'delivered' : 'no Android target');
          return delivered;
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          results.android = makeResult(true, false, message);
          return false;
        })
    : Promise.resolve(false);

  const smsPromise = payload.sendSms
    ? (() => {
        const supabase = createServiceSupabaseClient();
        if (!supabase) {
          results.sms = makeResult(true, false, 'supabase unavailable');
          return Promise.resolve(false);
        }
        return maybeSendPriorityAlertSms(supabase as any, {
          ticket: {
            id: payload.ticketId,
            office_id: payload.officeId,
            qr_token: payload.qrToken,
            ticket_number: payload.ticketNumber,
            status: payload.status,
            customer_data: payload.customerData,
          },
          event: payload.event as 'called' | 'recall' | 'buzz',
          deskName: payload.deskName,
        })
          .then((result) => {
            results.sms = makeResult(true, result.sent, result.reason);
            return result.sent;
          })
          .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            results.sms = makeResult(true, false, message);
            return false;
          });
      })()
    : Promise.resolve(false);

  const [webpushDelivered, apnsDelivered, androidDelivered, smsDelivered] = await Promise.all([
    webPushPromise,
    apnsPromise,
    androidPromise,
    smsPromise,
  ]);

  const delivered = webpushDelivered || apnsDelivered || androidDelivered || smsDelivered;
  const nextPayload: AlertJobPayload = {
    ...payload,
    attemptCount: payload.attemptCount + 1,
    results,
    lastError: delivered ? null : 'No delivery channel succeeded',
  };

  if (delivered) {
    await upsertJobState(jobId, 'job_sent', nextPayload, new Date().toISOString());
    return;
  }

  const retryPayload = withRetryDelay(nextPayload);
  if (shouldRetry(nextPayload)) {
    await upsertJobState(jobId, 'job_retrying', retryPayload);
    return;
  }

  await upsertJobState(jobId, 'job_failed', retryPayload);
}

async function processLiveActivityJob(jobId: string, payload: LiveActivityJobPayload) {
  const delivered = await sendLiveActivityUpdateForTicket(payload.ticketId).catch((error) => {
    console.error('[NotificationJobs] Live Activity sync error:', error);
    return false;
  });

  const results: DeliveryResults = {
    ...(payload.results ?? {}),
    liveActivity: makeResult(true, delivered, delivered ? 'delivered' : 'no token or update rejected'),
  };

  const nextPayload: LiveActivityJobPayload = {
    ...payload,
    attemptCount: payload.attemptCount + 1,
    results,
    lastError: delivered ? null : 'Live Activity update failed',
  };

  if (delivered) {
    await upsertJobState(jobId, 'job_sent', nextPayload, new Date().toISOString());
    return;
  }

  const retryPayload = withRetryDelay(nextPayload);
  if (shouldRetry(nextPayload)) {
    await upsertJobState(jobId, 'job_retrying', retryPayload);
    return;
  }

  await upsertJobState(jobId, 'job_failed', retryPayload);
}

export async function processPendingNotificationJobs(limit = 10) {
  const supabase = createServiceSupabaseClient();
  if (!supabase) return { processed: 0 };

  const { data: jobs, error } = await supabase
    .from('notifications')
    .select('id, channel, payload, created_at')
    .in('channel', ['job_pending', 'job_retrying'])
    .is('sent_at', null)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    console.error('[NotificationJobs] Failed to load jobs:', error);
    return { processed: 0 };
  }

  let processed = 0;
  for (const job of jobs ?? []) {
    const payload = (job.payload ?? null) as DeliveryJobPayload | null;
    if (!payload) {
      continue;
    }

    if (payload.nextAttemptAt && new Date(payload.nextAttemptAt).getTime() > Date.now()) {
      continue;
    }

    const { data: claimed } = await supabase
      .from('notifications')
      .update({ channel: 'job_processing' })
      .eq('id', job.id)
      .in('channel', ['job_pending', 'job_retrying'])
      .select('id')
      .maybeSingle();

    if (!claimed?.id) {
      continue;
    }

    processed += 1;

    if (payload.kind === 'customer_alert') {
      await processAlertJob(job.id, payload);
      continue;
    }

    await processLiveActivityJob(job.id, payload);
  }

  return { processed };
}

export function kickNotificationJobProcessor() {
  setTimeout(() => {
    processPendingNotificationJobs().catch((error) => {
      console.error('[NotificationJobs] Background processor error:', error);
    });
  }, 0);
}
