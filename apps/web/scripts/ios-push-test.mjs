#!/usr/bin/env node

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(webDir, '..', '..');
const schemePath = path.join(
  repoRoot,
  'apps/ios/QueueFlow/QueueFlow.xcodeproj/xcshareddata/xcschemes/QueueFlowClip.xcscheme'
);
const stateDir = path.join(repoRoot, '.tmp');
const statePath = path.join(stateDir, 'ios-push-test.json');
const localEnvPath = path.join(webDir, '.env.local');

const DEFAULT_DEPARTMENT = 'Client Services';
const DEFAULT_SERVICE = 'Mail & Packages';
const DEFAULT_OFFICE_ID = '64439fda-34a0-40df-bbab-ddb7b8dcb3f3';
const DEFAULT_OFFICE_NAME = 'Poste';
const DEFAULT_DEPARTMENT_ID = '0dac4bfc-a502-4db4-acbe-2b454930ccc1';
const DEFAULT_SERVICE_ID = 'a1621c56-2be0-4f93-83b1-9c16f1fc4bd9';
const LIVE_ACTIVITY_FOLLOWUP_DELAY_MS = 2500;

async function loadLocalEnvFile() {
  try {
    const raw = await readFile(localEnvPath, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex <= 0) continue;

      const key = trimmed.slice(0, separatorIndex).trim();
      if (process.env[key]) continue;

      let value = trimmed.slice(separatorIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      process.env[key] = value;
    }
  } catch {
    // Local env file is optional.
  }
}

function getArg(name, fallback) {
  const exact = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (exact) {
    return exact.slice(name.length + 1);
  }

  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }

  return fallback;
}

function requireEnv(name, value) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value.replace(/\\n/g, '\n').trim();
}

function getAppURL() {
  return (process.env.APP_URL ?? 'https://qflo.net').trim();
}

function getSupabaseURL() {
  return process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
}

function getSupabaseServiceKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
}

async function loadState() {
  try {
    return JSON.parse(await readFile(statePath, 'utf8'));
  } catch {
    return null;
  }
}

async function saveState(data) {
  await mkdir(stateDir, { recursive: true });
  await writeFile(statePath, JSON.stringify(data, null, 2));
}

async function updateSchemeURL(ticketURL) {
  const scheme = await readFile(schemePath, 'utf8');
  const next = scheme.replace(
    /(key = "_XCAppClipURL"\s+value = ")[^"]+(")/,
    `$1${ticketURL}$2`
  );

  if (next === scheme) {
    throw new Error(`Could not update _XCAppClipURL in ${schemePath}`);
  }

  await writeFile(schemePath, next);
}

function printUsage() {
  console.log(`Usage:
  pnpm --filter @queueflow/web ios:push-test create
  pnpm --filter @queueflow/web ios:push-test send
  pnpm --filter @queueflow/web ios:push-test call

Optional flags:
  --department "Client Services"
  --service "Mail & Packages"
  --title "Qflo Test"
  --body "Locked iPhone test"

Required environment:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY`);
}

async function createTicket() {
  const departmentName = getArg('--department', DEFAULT_DEPARTMENT);
  const serviceName = getArg('--service', DEFAULT_SERVICE);
  const supabase = createClient(
    requireEnv('SUPABASE_URL', getSupabaseURL()),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY', getSupabaseServiceKey())
  );
  const usingDefaultQueue =
    departmentName === DEFAULT_DEPARTMENT && serviceName === DEFAULT_SERVICE;

  const office = {
    id: DEFAULT_OFFICE_ID,
    name: DEFAULT_OFFICE_NAME,
  };
  const department = {
    id: DEFAULT_DEPARTMENT_ID,
    name: DEFAULT_DEPARTMENT,
  };
  const selectedService = {
    id: DEFAULT_SERVICE_ID,
    name: DEFAULT_SERVICE,
  };

  if (!usingDefaultQueue) {
    throw new Error(
      'This helper is pinned to Client Services -> Mail & Packages. Remove overrides or update the script.'
    );
  }

  const { data: seqData, error: seqError } = await supabase.rpc(
    'generate_daily_ticket_number',
    { p_department_id: department.id }
  );

  if (seqError || !seqData?.[0]) {
    throw new Error(`Failed to generate ticket number: ${seqError?.message ?? 'unknown error'}`);
  }

  const { data: waitMinutes, error: waitError } = await supabase.rpc(
    'estimate_wait_time',
    {
      p_department_id: department.id,
      p_service_id: selectedService.id,
    }
  );

  if (waitError) {
    throw new Error(`Failed to estimate wait time: ${waitError.message}`);
  }

  const qrToken = nanoid(16);
  const { data: ticket, error: insertError } = await supabase
    .from('tickets')
    .insert({
      office_id: office.id,
      department_id: department.id,
      service_id: selectedService.id,
      ticket_number: seqData[0].ticket_num,
      daily_sequence: seqData[0].seq,
      qr_token: qrToken,
      status: 'waiting',
      is_remote: true,
      checked_in_at: new Date().toISOString(),
      customer_data: {
        name: 'APNs Test',
        source: 'ios-push-test-script',
      },
      estimated_wait_minutes: waitMinutes ?? null,
    })
    .select('id, ticket_number, qr_token, estimated_wait_minutes')
    .single();

  if (insertError || !ticket) {
    throw new Error(`Failed to create ticket: ${insertError?.message ?? 'unknown error'}`);
  }

  const ticketURL = `${getAppURL()}/q/${ticket.qr_token}`;
  await updateSchemeURL(ticketURL);
  await saveState({
    officeName: office.name,
    departmentName,
    serviceName,
    ticketId: ticket.id,
    ticketNumber: ticket.ticket_number,
    qrToken: ticket.qr_token,
    ticketURL,
    createdAt: new Date().toISOString(),
  });

  console.log(JSON.stringify({
    ok: true,
    action: 'create',
    office: office.name,
    department: departmentName,
    service: serviceName,
    ticketId: ticket.id,
    ticketNumber: ticket.ticket_number,
    qrToken: ticket.qr_token,
    estimatedWaitMinutes: ticket.estimated_wait_minutes,
    ticketURL,
    schemePath,
    nextSteps: [
      'Open QueueFlow.xcodeproj in Xcode',
      'Run the QueueFlowClip scheme on your iPhone',
      'The App Clip will launch using the fresh ticket URL above',
      'After you see the token register, lock the phone and run the send command',
    ],
  }, null, 2));
}

async function pickDesk(supabase) {
  const { data: desks, error } = await supabase
    .from('desks')
    .select('id, name, display_name')
    .eq('department_id', DEFAULT_DEPARTMENT_ID)
    .eq('office_id', DEFAULT_OFFICE_ID)
    .order('name', { ascending: true })
    .limit(1);

  if (error) {
    throw new Error(`Failed to load desks: ${error.message}`);
  }

  return desks?.[0] ?? null;
}

async function postJSON(pathname, body) {
  const response = await fetch(`${getAppURL()}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  return {
    ok: response.ok,
    status: response.status,
    text: await response.text(),
  };
}

function parseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function sendPush() {
  const state = await loadState();
  if (!state) {
    throw new Error(`No saved test state found. Run "create" first. Expected ${statePath}`);
  }

  const title = getArg('--title', 'Qflo Test');
  const body = getArg('--body', 'Locked iPhone test');
  const response = await postJSON('/api/apns-send', {
    ticketId: state.ticketId,
    title,
    body,
    url: `/q/${state.qrToken}`,
  });

  console.log(JSON.stringify({
    ok: response.ok,
    action: 'send',
    ticketId: state.ticketId,
    ticketNumber: state.ticketNumber,
    qrToken: state.qrToken,
    ticketURL: state.ticketURL,
    responseStatus: response.status,
    responseBody: response.text,
  }, null, 2));
}

async function callTicket() {
  const state = await loadState();
  if (!state) {
    throw new Error(`No saved test state found. Run "create" first. Expected ${statePath}`);
  }

  const supabase = createClient(
    requireEnv('SUPABASE_URL', getSupabaseURL()),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY', getSupabaseServiceKey())
  );

  const desk = await pickDesk(supabase);
  const deskLabel = desk?.display_name?.trim() || desk?.name || 'your desk';
  const calledAt = new Date().toISOString();
  const { data: existingTicket, error: loadError } = await supabase
    .from('tickets')
    .select('status, recall_count')
    .eq('id', state.ticketId)
    .single();

  if (loadError || !existingTicket) {
    throw new Error(`Failed to load test ticket state: ${loadError?.message ?? 'not found'}`);
  }

  const isRecall = existingTicket.status === 'called';
  const nextRecallCount = isRecall ? (existingTicket.recall_count ?? 0) + 1 : 0;

  const { error: updateError } = await supabase
    .from('tickets')
    .update({
      status: 'called',
      called_at: calledAt,
      desk_id: desk?.id ?? null,
      recall_count: nextRecallCount,
    })
    .eq('id', state.ticketId);

  if (updateError) {
    throw new Error(`Failed to update test ticket call state: ${updateError.message}`);
  }

  const alertResponse = await postJSON('/api/apns-send', {
    ticketId: state.ticketId,
    title: getArg('--title', isRecall ? 'Reminder: Your Turn!' : "It's Your Turn!"),
    body: getArg('--body', `Ticket ${state.ticketNumber} — Please go to ${deskLabel}`),
    url: `/q/${state.qrToken}`,
  });

  await new Promise((resolve) => setTimeout(resolve, LIVE_ACTIVITY_FOLLOWUP_DELAY_MS));

  const liveActivityResponse = await postJSON('/api/live-activity-send', {
    ticketId: state.ticketId,
  });

  console.log(JSON.stringify({
    ok: liveActivityResponse.ok && alertResponse.ok,
    action: 'call',
    ticketId: state.ticketId,
    ticketNumber: state.ticketNumber,
    qrToken: state.qrToken,
    ticketURL: state.ticketURL,
    desk: deskLabel,
    isRecall,
    recallCount: nextRecallCount,
    liveActivity: {
      status: liveActivityResponse.status,
      body: liveActivityResponse.text,
    },
    alert: {
      status: alertResponse.status,
      body: alertResponse.text,
    },
  }, null, 2));
}

async function main() {
  await loadLocalEnvFile();
  const command = process.argv[2];

  if (!command || command === '--help' || command === '-h') {
    printUsage();
    return;
  }

  if (command === 'create') {
    await createTicket();
    return;
  }

  if (command === 'send') {
    await sendPush();
    return;
  }

  if (command === 'call') {
    await callTicket();
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
