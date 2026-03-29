import http from 'http';
import { networkInterfaces } from 'os';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { getDB, generateOfflineTicketNumber, reserveTicketNumber, logTicketEvent } from './db';
import { randomUUID } from 'crypto';
import { CONFIG } from './config';
import QRCode from 'qrcode';
import { normalizeLocale } from '../src/lib/i18n';

// ── Static kiosk assets (loaded once at startup, served from memory) ──
const KIOSK_DIR = join(__dirname, 'kiosk');
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
};

// ── Business hours check (runs server-side, no npm dependency needed) ──
const DAYS_OF_WEEK = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function normalizeOfficeTimezone(timezone: string | null | undefined) {
  const value = (timezone ?? '').trim();
  if (!value) return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const aliases: Record<string, string> = {
    'Europe/Algiers': 'Africa/Algiers',
  };

  return aliases[value] ?? value;
}

interface BusinessHoursStatus {
  isOpen: boolean;
  reason: string;
  todayHours: { open: string; close: string } | null;
  currentTime: string;
  currentDay: string;
  nextOpen?: { day: string; time: string };
  holidayName?: string;
}

type VisitIntakeOverrideMode = 'business_hours' | 'always_open' | 'always_closed';

function checkBusinessHours(
  operatingHours: Record<string, { open: string; close: string }> | null,
  timezone: string,
  _officeId?: string,
): BusinessHoursStatus {
  const now = new Date();
  let day: string, time: string, dayIndex: number;
  const normalizedTimezone = normalizeOfficeTimezone(timezone);

  try {
    const dayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: normalizedTimezone });
    day = dayFmt.format(now).toLowerCase();
    const timeFmt = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: normalizedTimezone });
    const parts = timeFmt.formatToParts(now);
    const h = parts.find(p => p.type === 'hour')?.value ?? '00';
    const m = parts.find(p => p.type === 'minute')?.value ?? '00';
    time = `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
    dayIndex = DAYS_OF_WEEK.indexOf(day);
  } catch {
    day = DAYS_OF_WEEK[now.getDay()];
    time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    dayIndex = now.getDay();
  }

  const base = { currentTime: time, currentDay: day };

  if (!operatingHours || Object.keys(operatingHours).length === 0) {
    return { ...base, isOpen: true, reason: 'no_hours', todayHours: null };
  }

  // Check holidays from local DB
  let holidayName: string | undefined;
  try {
    const db = getDB();
    const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: normalizedTimezone }).format(now);
    const holiday = db.prepare('SELECT name FROM office_holidays WHERE office_id = ? AND holiday_date = ?').get(_officeId, dateStr) as any;
    if (holiday) {
      holidayName = holiday.name;
      const next = findNextOpenDay(operatingHours, dayIndex);
      return { ...base, isOpen: false, reason: 'holiday', todayHours: null, holidayName, nextOpen: next };
    }
  } catch { /* table may not exist yet */ }

  const todayHours = operatingHours[day];
  if (!todayHours || (todayHours.open === '00:00' && todayHours.close === '00:00')) {
    const next = findNextOpenDay(operatingHours, dayIndex);
    return { ...base, isOpen: false, reason: 'closed_today', todayHours: null, nextOpen: next };
  }

  const toMins = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const currentMins = toMins(time);
  const openMins = toMins(todayHours.open);
  const closeMins = toMins(todayHours.close);

  if (currentMins < openMins) {
    return { ...base, isOpen: false, reason: 'before_hours', todayHours, nextOpen: { day, time: todayHours.open } };
  }
  if (currentMins >= closeMins) {
    const next = findNextOpenDay(operatingHours, dayIndex);
    return { ...base, isOpen: false, reason: 'after_hours', todayHours, nextOpen: next };
  }

  return { ...base, isOpen: true, reason: 'open', todayHours };
}

function parseSettings(settings: unknown): Record<string, any> {
  if (!settings) return {};
  if (typeof settings === 'string') {
    try {
      return JSON.parse(settings);
    } catch {
      return {};
    }
  }
  if (typeof settings === 'object') {
    return settings as Record<string, any>;
  }
  return {};
}

function resolveVisitIntakeOverrideMode(
  organizationSettings: unknown,
  officeSettings: unknown
): VisitIntakeOverrideMode {
  const orgSettings = parseSettings(organizationSettings);
  const branchSettings = parseSettings(officeSettings);
  const value =
    typeof orgSettings.visit_intake_override_mode === 'string'
      ? orgSettings.visit_intake_override_mode
      : typeof branchSettings.visit_intake_override_mode === 'string'
        ? branchSettings.visit_intake_override_mode
        : 'business_hours';

  if (value === 'always_open' || value === 'always_closed') {
    return value;
  }

  return 'business_hours';
}

function resolveBusinessAvailability(
  overrideMode: VisitIntakeOverrideMode,
  operatingHours: Record<string, { open: string; close: string }> | null,
  timezone: string,
  officeId?: string
): BusinessHoursStatus {
  const fallback = checkBusinessHours(operatingHours, timezone, officeId);
  if (overrideMode === 'always_open') {
    return {
      ...fallback,
      isOpen: true,
      reason: 'always_open',
    };
  }

  if (overrideMode === 'always_closed') {
    return {
      ...fallback,
      isOpen: false,
      reason: 'always_closed',
      todayHours: fallback.todayHours ?? null,
    };
  }

  return fallback;
}

function findNextOpenDay(hours: Record<string, { open: string; close: string }>, currentDayIndex: number) {
  for (let offset = 1; offset <= 7; offset++) {
    const idx = (currentDayIndex + offset) % 7;
    const dayName = DAYS_OF_WEEK[idx];
    const h = hours[dayName];
    if (h && !(h.open === '00:00' && h.close === '00:00')) {
      return { day: dayName, time: h.open };
    }
  }
  return undefined;
}

async function refreshOfficeRuntimeConfig(officeId: string) {
  const db = getDB();
  const localOffice = db.prepare('SELECT * FROM offices WHERE id = ?').get(officeId) as any;

  if (!isCloudReachable) {
    return localOffice;
  }

  try {
    const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
    const officeRes = await fetch(
      `${SUPABASE_URL}/rest/v1/offices?id=eq.${officeId}&select=id,name,address,organization_id,settings,operating_hours,timezone`,
      { headers, signal: AbortSignal.timeout(3000) }
    );

    if (!officeRes.ok) {
      return localOffice;
    }

    const offices = await officeRes.json();
    const freshOffice = offices[0];
    if (!freshOffice) {
      return localOffice;
    }

    db.prepare(`
      INSERT OR REPLACE INTO offices (id, name, address, organization_id, settings, operating_hours, timezone, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      freshOffice.id,
      freshOffice.name,
      freshOffice.address ?? null,
      freshOffice.organization_id ?? null,
      JSON.stringify(freshOffice.settings ?? {}),
      JSON.stringify(freshOffice.operating_hours ?? {}),
      freshOffice.timezone ?? null,
      new Date().toISOString(),
    );

    return db.prepare('SELECT * FROM offices WHERE id = ?').get(officeId) as any;
  } catch {
    return localOffice;
  }
}

let isCloudReachable = false;
let onTicketCreated: ((syncQueueId: string) => void) | null = null;
export function setOnTicketCreated(cb: (syncQueueId: string) => void) { onTicketCreated = cb; }

// ── HTML entity escaping (prevent XSS) ──────────────────────────
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── SSE: push instant updates to all connected displays/kiosks ───
const sseClients: Set<http.ServerResponse> = new Set();

export interface SSEEvent {
  type: 'ticket_called' | 'ticket_created' | 'ticket_served' | 'ticket_cancelled' | 'data_refreshed';
  ticket_number?: string;
  desk_name?: string;
  timestamp: string;
}

/** Call this whenever a ticket changes — every connected display refreshes instantly */
export function notifyDisplays(event?: SSEEvent) {
  const dead: http.ServerResponse[] = [];
  for (const client of sseClients) {
    try {
      // Send typed event if provided, otherwise generic update — never both
      if (event) {
        client.write(`data: ${JSON.stringify(event)}\n\n`);
      } else {
        client.write('data: update\n\n');
      }
    } catch { dead.push(client); }
  }
  for (const c of dead) sseClients.delete(c);
}

function handleSSE(_req: http.IncomingMessage, res: http.ServerResponse) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  res.write('data: connected\n\n');
  sseClients.add(res);
  _req.on('close', () => sseClients.delete(res));
}

// SSE heartbeat — send a data event every 15s so clients detect silent drops
// Must be a 'data:' line (not a ':' comment) so EventSource.onmessage fires
setInterval(() => {
  const dead: http.ServerResponse[] = [];
  for (const client of sseClients) {
    try { client.write('data: heartbeat\n\n'); } catch { dead.push(client); }
  }
  for (const c of dead) sseClients.delete(c);
}, 15_000);

// ── Device tracking ───────────────────────────────────────────────
interface DeviceInfo { id: string; type: string; name: string; lastPing: number; }
const devices: Map<string, DeviceInfo> = new Map();
// Station (this PC) is always present
devices.set('station', { id: 'station', type: 'station', name: 'Qflo Station', lastPing: Date.now() });
// Update station heartbeat every 10s
setInterval(() => { const d = devices.get('station'); if (d) d.lastPing = Date.now(); }, 10000);
const { CLOUD_URL, SUPABASE_URL } = CONFIG;
const SUPABASE_KEY = CONFIG.SUPABASE_ANON_KEY;

// Check cloud connectivity every 15s — only mark reachable on real success (2xx/3xx/4xx)
async function checkCloudReachability() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      headers: { apikey: SUPABASE_KEY },
      signal: AbortSignal.timeout(5000),
    });
    isCloudReachable = res.status < 500;
  } catch { isCloudReachable = false; }
}
setInterval(checkCloudReachability, 15_000);
setTimeout(checkCloudReachability, 1000);

let server: http.Server | null = null;
let localPort = 3847;

function loadStoredLocale() {
  try {
    const db = getDB();
    const row = db.prepare("SELECT value FROM session WHERE key = 'locale'").get() as { value?: string } | undefined;
    return normalizeLocale(row?.value);
  } catch {
    return 'en';
  }
}

function storeLocale(locale: string) {
  const normalized = normalizeLocale(locale);
  const db = getDB();
  db.prepare("INSERT OR REPLACE INTO session (key, value) VALUES ('locale', ?)").run(normalized);
  return normalized;
}

// ── Get local network IP ──────────────────────────────────────────

export function getLocalIP(): string {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]!) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

// ── Start kiosk server ────────────────────────────────────────────

export function startKioskServer(port = 3847): Promise<{ url: string; port: number }> {
  localPort = port;

  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      // CORS headers for tablet browsers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url ?? '/', `http://localhost:${localPort}`);
      const path = url.pathname;

      // Route requests
      if (path === '/kiosk' && req.method === 'GET') {
        serveStaticKioskFile('kiosk.html', res);
      } else if (path.startsWith('/kiosk/') && req.method === 'GET') {
        // Serve static kiosk assets (CSS, JS)
        const fileName = path.replace('/kiosk/', '');
        // Security: only allow known filenames, no path traversal
        if (/^[a-zA-Z0-9._-]+\.(css|js)$/.test(fileName)) {
          serveStaticKioskFile(fileName, res);
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not found' }));
        }
      } else if (path === '/display' && req.method === 'GET') {
        void serveDisplayPage(url, res);
      } else if (path.startsWith('/track/') && req.method === 'GET') {
        const ticketNumber = decodeURIComponent(path.replace('/track/', ''));
        serveTrackingPage(ticketNumber, res);
      } else if (path === '/api/kiosk-info' && req.method === 'GET') {
        handleKioskInfo(url, res);
      } else if (path === '/api/take-ticket' && req.method === 'POST') {
        handleTakeTicket(req, res);
      } else if (path === '/api/queue-status' && req.method === 'GET') {
        handleQueueStatus(url, res);
      } else if (path === '/api/track' && req.method === 'GET') {
        handleTrackTicket(url, res);
      } else if (path === '/api/display-data' && req.method === 'GET') {
        handleDisplayData(url, res);
      } else if (path === '/api/events' && req.method === 'GET') {
        handleSSE(req, res);
      } else if (path === '/api/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', version: CONFIG.APP_VERSION, cloud: isCloudReachable ? CLOUD_URL : '' }));
      } else if (path === '/api/device-ping' && req.method === 'POST') {
        handleDevicePing(req, res);
      } else if (path === '/api/device-status' && req.method === 'GET') {
        handleDeviceStatus(res);
      // ── Station UI served over local network ─────────────────────
      } else if (path === '/station' || path === '/station/') {
        serveStationIndex(res);
      } else if (path.startsWith('/station/assets/')) {
        serveStationAsset(path.replace('/station/', ''), res);
      // ── Station HTTP API (mirrors Electron IPC) ──────────────────
      } else if (path === '/api/station/config' && req.method === 'GET') {
        handleStationConfig(res);
      } else if (path === '/api/station/tickets' && req.method === 'GET') {
        handleStationGetTickets(url, res);
      } else if (path === '/api/station/update-ticket' && req.method === 'POST') {
        handleStationBody(req, res, handleStationUpdateTicket);
      } else if (path === '/api/station/call-next' && req.method === 'POST') {
        handleStationBody(req, res, handleStationCallNext);
      } else if (path === '/api/station/query' && req.method === 'GET') {
        handleStationQuery(url, res);
      } else if (path === '/api/station/sync-status' && req.method === 'GET') {
        handleStationSyncStatus(res);
      } else if (path === '/api/station/session' && req.method === 'GET') {
        handleStationSessionLoad(res);
      } else if (path === '/api/station/settings' && req.method === 'GET') {
        handleStationSettings(res);
      } else if (path === '/api/station/settings/locale' && req.method === 'POST') {
        handleStationBody(req, res, handleStationSetLocale);
      } else if (path === '/api/station/activity' && req.method === 'GET') {
        handleStationActivity(url, res);
      } else if (path === '/api/station/events' && req.method === 'GET') {
        handleStationSSE(req, res);
      } else if (path === '/api/station/kiosk-info' && req.method === 'GET') {
        handleStationKioskInfo(res);
      } else if (path === '/api/station/branding' && req.method === 'GET') {
        handleStationBranding(res);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    });

    server.listen(port, '0.0.0.0', () => {
      const ip = getLocalIP();
      const url = `http://${ip}:${port}`;
      console.log(`Kiosk server running at ${url}/kiosk`);
      resolve({ url, port });
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (port < 9000) {
        // Try next port on any error (EADDRINUSE, EACCES, EPERM, etc.)
        startKioskServer(port + 1).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });
  });
}

export function stopKioskServer() {
  server?.close();
  server = null;
}

function getCurrentSessionOfficeIds() {
  const db = getDB();
  try {
    const session = db.prepare("SELECT value FROM session WHERE key = 'current'").get() as any;
    if (!session?.value) return null;
    const parsed = JSON.parse(session.value);
    const officeIds = new Set<string>();
    if (typeof parsed?.office_id === 'string' && parsed.office_id.length > 0) {
      officeIds.add(parsed.office_id);
    }
    if (Array.isArray(parsed?.office_ids)) {
      parsed.office_ids.forEach((officeId: unknown) => {
        if (typeof officeId === 'string' && officeId.length > 0) {
          officeIds.add(officeId);
        }
      });
    }
    if (officeIds.size === 0) return null;
    return {
      primaryOfficeId:
        typeof parsed?.office_id === 'string' && parsed.office_id.length > 0
          ? parsed.office_id
          : Array.from(officeIds)[0],
      officeIds: Array.from(officeIds),
    };
  } catch {
    return null;
  }
}

function getSessionDefaultOffice() {
  const db = getDB();
  const sessionOfficeIds = getCurrentSessionOfficeIds();
  const officeId = sessionOfficeIds?.primaryOfficeId;
  if (!officeId) return null;
  return db.prepare('SELECT * FROM offices WHERE id = ?').get(officeId) as any;
}

function resolveRequestedOffice(url: URL) {
  const db = getDB();
  const sessionOfficeIds = getCurrentSessionOfficeIds();
  if (!sessionOfficeIds) return null;

  const officeId = url.searchParams.get('officeId');

  if (officeId) {
    if (!sessionOfficeIds.officeIds.includes(officeId)) {
      return null;
    }
    return db.prepare('SELECT * FROM offices WHERE id = ?').get(officeId) as any;
  }

  return db.prepare('SELECT * FROM offices WHERE id = ?').get(sessionOfficeIds.primaryOfficeId) as any;
}

// ── API Handlers ──────────────────────────────────────────────────

async function handleKioskInfo(url: URL, res: http.ServerResponse) {
  const db = getDB();
  const requestedOffice = resolveRequestedOffice(url);
  const office = requestedOffice?.id ? await refreshOfficeRuntimeConfig(requestedOffice.id) : null;

  if (!office) {
    res.writeHead(404, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });
    res.end(JSON.stringify({ error: 'No active office configured' }));
    return;
  }

  const departments = db.prepare('SELECT * FROM departments WHERE office_id = ?').all(office.id);
  const services = db.prepare('SELECT * FROM services WHERE department_id IN (SELECT id FROM departments WHERE office_id = ?)').all(office.id);

  // Try to get org name + logo from Supabase
  let logoUrl: string | null = null;
  let orgName: string | null = null;
  let organizationSettings: Record<string, any> = {};
  if (isCloudReachable && office.organization_id) {
    try {
      const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
      const orgRes = await fetch(`${SUPABASE_URL}/rest/v1/organizations?id=eq.${office.organization_id}&select=name,logo_url,settings`, { headers, signal: AbortSignal.timeout(3000) });
      if (orgRes.ok) {
        const orgs = await orgRes.json();
        orgName = orgs[0]?.name ?? null;
        logoUrl = orgs[0]?.logo_url ?? orgs[0]?.settings?.logo_url ?? null;
        organizationSettings = parseSettings(orgs[0]?.settings);
      }
    } catch { /* ignore */ }
  }

  // ── Business hours check ──────────────────────────────────────
  const operatingHours = office.operating_hours ? (typeof office.operating_hours === 'string' ? JSON.parse(office.operating_hours) : office.operating_hours) : null;
  const timezone = normalizeOfficeTimezone(office.timezone);
  const visitIntakeOverrideMode = resolveVisitIntakeOverrideMode(
    organizationSettings,
    office.settings
  );
  const businessStatus = resolveBusinessAvailability(
    visitIntakeOverrideMode,
    operatingHours,
    timezone,
    office.id
  );

  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  });
  // Merge organization-level kiosk settings so the local kiosk respects
  // the same config as the remote web kiosk (theme, text, behavior, visibility)
  const kioskConfig = {
    theme_color: organizationSettings.kiosk_theme_color || null,
    welcome_message: organizationSettings.kiosk_welcome_message || null,
    header_text: organizationSettings.kiosk_header_text || null,
    button_label: organizationSettings.kiosk_button_label || null,
    mode: organizationSettings.kiosk_mode || 'normal',
    show_logo: organizationSettings.kiosk_show_logo ?? true,
    logo_url: organizationSettings.kiosk_logo_url || null,
    show_estimated_time: organizationSettings.kiosk_show_estimated_time ?? true,
    show_priorities: organizationSettings.kiosk_show_priorities ?? false,
    hidden_departments: organizationSettings.kiosk_hidden_departments || [],
    hidden_services: organizationSettings.kiosk_hidden_services || [],
    locked_department_id: organizationSettings.kiosk_locked_department_id || null,
    idle_timeout: organizationSettings.kiosk_idle_timeout || 60,
  };

  res.end(JSON.stringify({
    office,
    departments,
    services,
    locale: loadStoredLocale(),
    logo_url: logoUrl,
    org_name: orgName,
    is_open: businessStatus.isOpen,
    business_hours: businessStatus,
    visit_intake_override_mode: visitIntakeOverrideMode,
    kiosk_config: kioskConfig,
  }));
}

function handleTakeTicket(req: http.IncomingMessage, res: http.ServerResponse) {
  let body = '';
  let size = 0;
  const MAX_BODY = 8192; // 8KB max
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY) { req.destroy(); return; }
    body += chunk;
  });
  req.on('end', async () => {
    try {
      if (size > MAX_BODY) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request too large' }));
        return;
      }

      let parsed: any;
      try { parsed = JSON.parse(body); } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }
      const { officeId, departmentId, serviceId, customerName, customerPhone, customerReason, source: rawSource } = parsed;
      const ticketSource = typeof rawSource === 'string' && rawSource.length <= 30 ? rawSource : 'kiosk';

      if (!officeId || !departmentId || !serviceId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing required fields' }));
        return;
      }

      // Validate IDs are valid UUIDs (prevent injection)
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(officeId) || !uuidRegex.test(departmentId) || !uuidRegex.test(serviceId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid ID format' }));
        return;
      }

      // Input sanitization
      const safeName = typeof customerName === 'string' ? customerName.replace(/[<>&"']/g, '').slice(0, 200).trim() : null;
      const safePhone = typeof customerPhone === 'string' ? customerPhone.replace(/[^\d+\-() ]/g, '').slice(0, 30) : null;
      const safeReason = typeof customerReason === 'string' ? customerReason.replace(/[<>&"']/g, '').slice(0, 500).trim() : null;

      const db = getDB();

      // Validate department and service exist in this office
      const dept = db.prepare('SELECT id, code FROM departments WHERE id = ? AND office_id = ?').get(departmentId, officeId) as any;
      if (!dept) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid department' }));
        return;
      }
      const svc = db.prepare('SELECT id FROM services WHERE id = ? AND department_id = ?').get(serviceId, departmentId) as any;
      if (!svc) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid service' }));
        return;
      }

      // ── Business hours enforcement — reject if office is closed ──
      const officeRow = await refreshOfficeRuntimeConfig(officeId);
      if (officeRow) {
        const opHours = officeRow.operating_hours ? (typeof officeRow.operating_hours === 'string' ? JSON.parse(officeRow.operating_hours) : officeRow.operating_hours) : null;
        const tz = normalizeOfficeTimezone(officeRow.timezone);
        const visitIntakeOverrideMode = resolveVisitIntakeOverrideMode(null, officeRow.settings);
        const bh = resolveBusinessAvailability(visitIntakeOverrideMode, opHours, tz, officeId);
        if (!bh.isOpen) {
          const reason = bh.reason === 'always_closed'
            ? 'This business is not taking visits right now.'
            : bh.reason === 'holiday' ? `Closed for ${bh.holidayName || 'holiday'}` :
            bh.reason === 'closed_today' ? 'Closed today' :
            bh.reason === 'before_hours' ? `Opens at ${bh.todayHours?.open || ''}` :
            bh.reason === 'after_hours' ? 'Closed for the day' : 'Office is closed';
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: reason, closed: true, business_hours: bh }));
          return;
        }
      }

      const deptCode = dept?.code ?? 'Q';
      const ticketId = randomUUID();
      const now = new Date().toISOString();
      const qrToken = randomUUID().replace(/-/g, '').slice(0, 12);

      // ── Generate ticket number (single source of truth) ──────────
      // Online: Supabase RPC atomically reserves next sequence (no duplicates)
      // Offline: local SQLite atomic counter with L-prefix
      const reserved = await reserveTicketNumber(
        SUPABASE_URL, SUPABASE_KEY, officeId, departmentId, deptCode, isCloudReachable, db,
      );
      const { ticketNumber, dailySequence, isOffline } = reserved;

      const customerData = JSON.stringify({
        name: safeName || null,
        phone: safePhone || null,
        ...(safeReason ? { reason: safeReason } : {}),
      });

      // Transaction: ticket insert + sync queue insert are atomic (crash-safe)
      db.transaction(() => {
        db.prepare(`
          INSERT INTO tickets (id, ticket_number, office_id, department_id, service_id, status, priority, customer_data, created_at, is_offline, daily_sequence, source)
          VALUES (?, ?, ?, ?, ?, 'waiting', 0, ?, ?, ?, ?, ?)
        `).run(ticketId, ticketNumber, officeId, departmentId, serviceId, customerData, now, isOffline ? 1 : 0, dailySequence, ticketSource);

        db.prepare(`
          INSERT INTO sync_queue (id, operation, table_name, record_id, payload, created_at)
          VALUES (?, 'INSERT', 'tickets', ?, ?, ?)
        `).run(
          ticketId + '-create',
          ticketId,
          JSON.stringify({
            id: ticketId,
            ticket_number: ticketNumber,
            office_id: officeId,
            department_id: departmentId,
            service_id: serviceId,
            status: 'waiting',
            priority: 0,
            customer_data: { name: safeName || null, phone: safePhone || null, ...(safeReason ? { reason: safeReason } : {}) },
            created_at: now,
            qr_token: qrToken,
            daily_sequence: dailySequence,
            source: ticketSource,
          }),
          now
        );
      })();

      // Audit log — immutable trail
      logTicketEvent(ticketId, 'created', {
        ticketNumber,
        toStatus: 'waiting',
        source: ticketSource,
        details: {
          officeId, departmentId, serviceId, deptCode,
          isOffline, dailySequence,
          customerName: safeName || null,
        },
      });

      notifyDisplays({ type: 'ticket_created', ticket_number: ticketNumber, timestamp: now });
      onTicketCreated?.(ticketId + '-create');

      // Count position
      const position = db.prepare(`
        SELECT COUNT(*) as pos FROM tickets
        WHERE office_id = ? AND department_id = ? AND status = 'waiting'
        AND created_at <= ? AND parked_at IS NULL
      `).get(officeId, departmentId, now) as any;

      // Generate QR code server-side (proper library, guaranteed scannable)
      const trackUrl = `${CLOUD_URL}/ticket/${ticketId}`;
      let qrDataUrl = '';
      try {
        qrDataUrl = await QRCode.toDataURL(trackUrl, {
          errorCorrectionLevel: 'M',
          margin: 4,
          scale: 8,
          color: { dark: '#000000', light: '#ffffff' },
        });
      } catch (qrErr) {
        console.error('[kiosk] QR generation error:', qrErr);
      }

      // Estimate wait: position * avg service time for this service
      const svcRow = db.prepare(
        'SELECT estimated_service_time FROM services WHERE id = ? LIMIT 1'
      ).get(serviceId) as any;
      const avgMin = svcRow?.estimated_service_time ?? 10;
      const pos = position?.pos ?? 1;
      const estimatedWait = Math.round((pos > 1 ? pos - 1 : 0) * avgMin);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ticket: {
          id: ticketId,
          ticket_number: ticketNumber,
          status: 'waiting',
          position: pos,
          estimated_wait: estimatedWait,
          created_at: now,
          qr_data_url: qrDataUrl,
          qr_token: qrToken,
          has_phone: Boolean(safePhone),
        },
      }));
    } catch (err: any) {
      console.error('[kiosk] Ticket creation error:', err?.message, err?.stack);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Failed to create ticket: ${err?.message || 'Unknown error'}. Please try again.` }));
    }
  });
}

function handleQueueStatus(url: URL, res: http.ServerResponse) {
  const db = getDB();
  const officeId = url.searchParams.get('officeId');

  if (!officeId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'officeId required' }));
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString();

  const waiting = db.prepare(
    "SELECT COUNT(*) as c FROM tickets WHERE office_id = ? AND status = 'waiting' AND created_at >= ?"
  ).get(officeId, todayISO) as any;

  const called = db.prepare(
    "SELECT COUNT(*) as c FROM tickets WHERE office_id = ? AND status = 'called' AND created_at >= ?"
  ).get(officeId, todayISO) as any;

  const serving = db.prepare(
    "SELECT COUNT(*) as c FROM tickets WHERE office_id = ? AND status = 'serving' AND created_at >= ?"
  ).get(officeId, todayISO) as any;

  const served = db.prepare(
    "SELECT COUNT(*) as c FROM tickets WHERE office_id = ? AND status = 'served' AND created_at >= ?"
  ).get(officeId, todayISO) as any;

  // Per-department breakdown for kiosk display
  const deptCounts = db.prepare(`
    SELECT d.id, d.name, COUNT(t.id) as waiting,
      COALESCE(AVG(s.estimated_service_time), 10) as avg_service_time
    FROM departments d
    LEFT JOIN tickets t ON t.department_id = d.id AND t.status = 'waiting' AND t.office_id = ? AND t.created_at >= ?
    LEFT JOIN services s ON t.service_id = s.id
    WHERE d.office_id = ?
    GROUP BY d.id, d.name
  `).all(officeId, todayISO, officeId) as any[];

  const departments = deptCounts.map(d => ({
    id: d.id,
    name: d.name,
    waiting: d.waiting ?? 0,
    estimated_wait: Math.round((d.waiting ?? 0) * (d.avg_service_time ?? 10)),
  }));

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    waiting: waiting?.c ?? 0,
    called: called?.c ?? 0,
    serving: serving?.c ?? 0,
    served: served?.c ?? 0,
    departments,
  }));
}

// ── Static kiosk file serving ──────────────────────────────────────
// All kiosk UI lives in separate .html/.css/.js files under electron/kiosk/.
// Files are read from disk on each request (simple, no caching issues during dev).

function serveStaticKioskFile(fileName: string, res: http.ServerResponse) {
  const ext = fileName.substring(fileName.lastIndexOf('.'));
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  try {
    const filePath = join(KIOSK_DIR, fileName);
    const content = readFileSync(filePath, 'utf-8');
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
}

// ── Track Ticket API ──────────────────────────────────────────────

async function handleTrackTicket(url: URL, res: http.ServerResponse) {
  const db = getDB();
  const ticketNumber = url.searchParams.get('number');
  const ticketId = url.searchParams.get('id');

  let ticket: any = null;
  if (ticketId) {
    ticket = db.prepare("SELECT * FROM tickets WHERE id = ?").get(ticketId);
  } else if (ticketNumber) {
    ticket = db.prepare("SELECT * FROM tickets WHERE ticket_number = ? ORDER BY created_at DESC LIMIT 1").get(ticketNumber);
  }

  if (!ticket) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Ticket not found' }));
    return;
  }

  // Calculate position
  let position = 0;
  if (ticket.status === 'waiting') {
    const ahead = db.prepare(`
      SELECT COUNT(*) as c FROM tickets
      WHERE office_id = ? AND service_id = ? AND status = 'waiting' AND parked_at IS NULL
      AND (priority > ? OR (priority = ? AND created_at < ?))
    `).get(ticket.office_id, ticket.service_id, ticket.priority, ticket.priority, ticket.created_at) as any;
    position = (ahead?.c ?? 0) + 1;
  }

  // Get names
  const dept = db.prepare("SELECT name FROM departments WHERE id = ?").get(ticket.department_id) as any;
  const svc = db.prepare("SELECT name FROM services WHERE id = ?").get(ticket.service_id) as any;
  const desk = ticket.desk_id ? db.prepare("SELECT name FROM desks WHERE id = ?").get(ticket.desk_id) as any : null;
  const office = db.prepare("SELECT name FROM offices WHERE id = ?").get(ticket.office_id) as any;

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    ticket_number: ticket.ticket_number,
    status: ticket.status,
    position,
    office_name: office?.name ?? '',
    department_name: dept?.name ?? '',
    service_name: svc?.name ?? '',
    desk_name: desk?.name ?? null,
    created_at: ticket.created_at,
    called_at: ticket.called_at,
  }));
}

// ── Display Data API ──────────────────────────────────────────────

async function handleDisplayData(url: URL, res: http.ServerResponse) {
  const db = getDB();
  const office = resolveRequestedOffice(url);

  if (!office) {
    res.writeHead(404, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });
    res.end(JSON.stringify({ error: 'No active office configured' }));
    return;
  }

  // ALWAYS read from SQLite — sync engine keeps it up to date
  // Active tickets (called/serving/waiting) never filtered by date — they must always appear
  // Historical (served) filtered to today only

  const nowServing = db.prepare(`
    SELECT t.id, t.ticket_number, t.status, t.desk_id, t.department_id, t.called_at,
           d.name as desk_name, dep.name as department_name
    FROM tickets t
    LEFT JOIN desks d ON d.id = t.desk_id
    LEFT JOIN departments dep ON dep.id = t.department_id
    WHERE t.office_id = ? AND t.status IN ('called', 'serving')
    ORDER BY t.called_at DESC
  `).all(office.id) as any[];

  const waitingTickets = db.prepare(`
    SELECT t.id, t.ticket_number, t.status, t.priority, t.created_at, t.service_id,
           t.department_id, t.customer_data, t.appointment_id,
           dep.name as department_name, s.name as service_name
    FROM tickets t
    LEFT JOIN departments dep ON dep.id = t.department_id
    LEFT JOIN services s ON s.id = t.service_id
    WHERE t.office_id = ? AND t.status = 'waiting' AND t.parked_at IS NULL
    ORDER BY t.priority DESC, t.created_at ASC
  `).all(office.id) as any[];

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString();

  const servedCount = db.prepare(
    "SELECT COUNT(*) as c FROM tickets WHERE office_id = ? AND status = 'served' AND created_at >= ?"
  ).get(office.id, todayISO) as any;

  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  });
  res.end(JSON.stringify({
    office_name: office.name,
    cloud_connected: isCloudReachable,
    now_serving: nowServing,
    waiting: waitingTickets,
    waiting_count: waitingTickets.length,
    called_count: nowServing.filter((t: any) => t.status === 'called').length,
    serving_count: nowServing.filter((t: any) => t.status === 'serving').length,
    served_count: servedCount?.c ?? 0,
  }));
}

// ── Tracking Page ─────────────────────────────────────────────────

// ── Device Ping/Status ────────────────────────────────────────────

function handleDevicePing(req: http.IncomingMessage, res: http.ServerResponse) {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    try {
      const { type, name } = JSON.parse(body);
      if (type) {
        // Key by type + client IP — one entry per physical device per type
        // Multiple tabs from the same device merge; different devices stay separate
        const clientIP = (req.socket.remoteAddress ?? 'unknown').replace('::ffff:', '');
        const deviceKey = `${type}-${clientIP}`;

        // Remove any old random-ID entries of the same type from this IP
        for (const [existingId, d] of devices) {
          if (d.type === type && existingId !== deviceKey && existingId !== 'station') {
            // Check if this old entry is from the same IP (embedded in id or stale)
            if ((Date.now() - d.lastPing) > 20000 || existingId.startsWith(`${type}-`)) {
              devices.delete(existingId);
            }
          }
        }

        devices.set(deviceKey, { id: deviceKey, type, name: name ?? type, lastPing: Date.now() });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid body' }));
    }
  });
}

function handleDeviceStatus(res: http.ServerResponse) {
  const now = Date.now();
  const TIMEOUT = 90_000; // 90s = considered disconnected (tolerates 2 missed 30s pings)
  const STALE = 180_000;  // 3min = remove from list entirely

  // Prune devices that haven't pinged in 2+ minutes (closed tabs, disconnected devices)
  for (const [id, d] of devices) {
    if (id !== 'station' && (now - d.lastPing) > STALE) {
      devices.delete(id);
    }
  }

  const list = Array.from(devices.values()).map(d => ({
    ...d,
    connected: (now - d.lastPing) < TIMEOUT,
    lastPing: new Date(d.lastPing).toISOString(),
  }));
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ cloud: isCloudReachable, devices: list }));
}

function serveTrackingPage(ticketNumber: string, res: http.ServerResponse) {
  const ip = getLocalIP();
  const apiBase = `http://${ip}:${localPort}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Track Ticket — Qflo</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; -webkit-user-select: none; user-select: none; }
    html, body { overscroll-behavior: none; -webkit-overflow-scrolling: touch; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: #f8fafc; color: #0f172a; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding-bottom: env(safe-area-inset-bottom); }
    .card { width: 100%; max-width: 400px; margin: 24px; background: white; border-radius: 20px; padding: 40px 32px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); text-align: center; }
    .brand { font-size: 14px; font-weight: 700; color: #3b82f6; margin-bottom: 24px; }
    .number { font-size: 52px; font-weight: 900; color: #0f172a; letter-spacing: -2px; }
    .status-badge { display: inline-block; padding: 6px 16px; border-radius: 20px; font-size: 13px; font-weight: 700; margin-top: 12px; text-transform: uppercase; letter-spacing: 1px; }
    .status-waiting { background: #fef3c7; color: #92400e; }
    .status-called { background: #dbeafe; color: #1e40af; animation: pulse 1.5s infinite; }
    .status-serving { background: #d1fae5; color: #065f46; }
    .status-served { background: #f1f5f9; color: #64748b; }
    .position { font-size: 32px; font-weight: 800; color: #3b82f6; margin-top: 20px; }
    .position-label { font-size: 14px; color: #94a3b8; }
    .meta { margin-top: 20px; font-size: 13px; color: #64748b; }
    .meta div { margin: 4px 0; }
    .desk-alert { margin-top: 16px; padding: 12px; background: #dbeafe; border-radius: 10px; font-weight: 700; color: #1e40af; font-size: 16px; }
    .next-alert { margin-top: 16px; padding: 16px; background: #d1fae5; border-radius: 10px; font-weight: 800; color: #065f46; font-size: 18px; animation: pulse 1s infinite; }
    .refresh { font-size: 12px; color: #94a3b8; margin-top: 20px; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.6; } }
    html[dir="rtl"] .number, html[dir="rtl"] .status-badge { letter-spacing: normal; text-transform: none; }
  </style>
</head>
<body>
  <div class="card" id="app">
    <div class="brand">Qflo</div>
    <div style="color:#94a3b8">Loading...</div>
  </div>
  <script>
    const API = '${apiBase}';
    const ticketNumber = '${ticketNumber.replace(/'/g, "\\'")}';

    async function load() {
      try {
        const res = await fetch(API + '/api/track?number=' + encodeURIComponent(ticketNumber));
        const d = await res.json();
        if (d.error) throw new Error(d.error);

        let statusClass = 'status-' + d.status;
        let statusText = d.status.charAt(0).toUpperCase() + d.status.slice(1);
        if (d.status === 'served') statusText = 'Completed';
        if (d.status === 'no_show') { statusText = 'No Show'; statusClass = 'status-served'; }

        let posHtml = '';
        if (d.status === 'waiting') {
          if (d.position === 1) {
            posHtml = '<div class="next-alert">You\\'re Next!</div>';
          } else {
            posHtml = '<div class="position">#' + d.position + '</div><div class="position-label">in line</div>';
          }
        } else if (d.status === 'called') {
          posHtml = '<div class="desk-alert">Go to ' + (d.desk_name || 'the desk') + '</div>';
        }

        document.getElementById('app').innerHTML =
          '<div class="brand">Qflo</div>' +
          '<div class="number">' + d.ticket_number + '</div>' +
          '<div class="status-badge ' + statusClass + '">' + statusText + '</div>' +
          posHtml +
          '<div class="meta">' +
          '<div>' + d.office_name + '</div>' +
          '<div>' + d.service_name + ' &middot; ' + d.department_name + '</div>' +
          '</div>' +
          '<div class="refresh">Live updates via server</div>';
      } catch (err) {
        document.getElementById('app').innerHTML =
          '<div class="brand">Qflo</div>' +
          '<div style="color:#ef4444;font-weight:600">Ticket not found</div>' +
          '<div style="color:#94a3b8;font-size:13px;margin-top:8px">Make sure you\\'re on the same network as the Qflo station.</div>';
      }
    }

    var loadDebounce = null;
    function debouncedLoad() { if (loadDebounce) clearTimeout(loadDebounce); loadDebounce = setTimeout(function(){ loadDebounce = null; load(); }, 150); }

    load();
    var sseOk = false; var lastHB = 0;
    function connectFollowSSE() {
      var es = new EventSource(API + '/api/events');
      es.onopen = function() { sseOk = true; lastHB = Date.now(); };
      es.onmessage = function(e) { lastHB = Date.now(); sseOk = true; if (e.data !== 'connected' && e.data !== 'heartbeat') debouncedLoad(); };
      es.onerror = function() { sseOk = false; es.close(); setTimeout(connectFollowSSE, 3000); };
    }
    connectFollowSSE();
    // Heartbeat watchdog + fallback poll
    setInterval(function() {
      if (sseOk && (Date.now() - lastHB) > 25000) { sseOk = false; connectFollowSSE(); }
      if (!sseOk) load();
    }, 10000);
  </script>
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

// ── Display Page (Waiting Room TV) ────────────────────────────────

async function serveDisplayPage(url: URL, res: http.ServerResponse) {
  const ip = getLocalIP();
  const apiBase = `http://${ip}:${localPort}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Qflo Display</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; -webkit-user-select: none; user-select: none; }
    html, body { overscroll-behavior: none; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: #f0f4f8; color: #0f172a; height: 100vh; overflow: hidden; }

    .display { display: flex; flex-direction: column; height: 100vh; }

    /* ── Header ── */
    .header { display: flex; justify-content: space-between; align-items: center; padding: 16px 32px; background: white; border-bottom: 2px solid #e2e8f0; }
    .header-left { display: flex; align-items: center; gap: 16px; }
    .logo { width: 56px; height: 56px; display: flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0; }
    .logo.fallback { background: #3b82f6; border-radius: 14px; color: white; font-weight: 900; font-size: 28px; }
    .logo img { height: 56px; width: auto; object-fit: contain; }
    .office-name { font-size: 22px; font-weight: 700; color: #1e293b; }
    .branch-name { font-size: 14px; color: #64748b; font-weight: 500; }
    .header-right { text-align: right; }
    .clock { font-size: 42px; font-weight: 800; color: #0f172a; letter-spacing: -1px; line-height: 1; }
    .date { font-size: 15px; color: #64748b; font-weight: 500; margin-top: 2px; }
    .conn-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; }
    .conn-badge.connected { background: #d1fae5; color: #065f46; }
    .conn-badge.local { background: #fef3c7; color: #92400e; }
    .conn-badge .dot { width: 8px; height: 8px; border-radius: 50%; }
    .conn-badge.connected .dot { background: #22c55e; animation: pulse-dot 2s infinite; }
    .conn-badge.local .dot { background: #f59e0b; }
    @keyframes pulse-dot { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }

    /* ── Stats strip ── */
    .stats-strip { display: flex; gap: 0; background: white; border-bottom: 1px solid #e2e8f0; }
    .stat-box { flex: 1; padding: 12px 24px; text-align: center; border-right: 1px solid #e2e8f0; }
    .stat-box:last-child { border-right: none; }
    .stat-num { font-size: 36px; font-weight: 800; }
    .stat-num.waiting { color: #f59e0b; }
    .stat-num.called { color: #3b82f6; }
    .stat-num.serving { color: #22c55e; }
    .stat-num.served { color: #64748b; }
    .stat-label { font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; color: #94a3b8; margin-top: 4px; }

    /* ── Main content ── */
    .content { flex: 1; display: flex; gap: 0; overflow: hidden; }

    /* ── Now Serving panel (left 55%) ── */
    .now-serving-panel { flex: 55; display: flex; flex-direction: column; border-right: 2px solid #e2e8f0; background: white; }
    .panel-title { padding: 18px 24px 14px; font-size: 18px; font-weight: 800; text-transform: uppercase; letter-spacing: 3px; color: #64748b; border-bottom: 1px solid #f1f5f9; }
    .serving-list { flex: 1; overflow: hidden; padding: 16px 20px; display: flex; flex-direction: column; gap: 12px; }

    .serving-row { display: flex; align-items: center; padding: 24px 28px; border-radius: 16px; transition: all 0.4s ease; }
    .serving-row.called { background: #eff6ff; border: 3px solid #bfdbfe; }
    .serving-row.serving { background: #f0fdf4; border: 3px solid #bbf7d0; }
    .serving-row .ticket-num { font-size: 72px; font-weight: 900; letter-spacing: -3px; min-width: 220px; }
    .serving-row.called .ticket-num { color: #1e40af; }
    .serving-row.serving .ticket-num { color: #166534; }
    .serving-row .arrow { font-size: 36px; color: #94a3b8; margin: 0 20px; }
    .serving-row .desk-info { flex: 1; }
    .serving-row .desk-name { font-size: 28px; font-weight: 700; color: #334155; }
    .serving-row .dept-name { font-size: 16px; color: #94a3b8; font-weight: 500; margin-top: 2px; }
    .serving-row .status-pill { padding: 8px 20px; border-radius: 24px; font-size: 16px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; }
    .serving-row.called .status-pill { background: #3b82f6; color: white; animation: pulse 1.5s infinite; }
    .serving-row.serving .status-pill { background: #22c55e; color: white; }
    .countdown { font-size: 32px; font-weight: 900; min-width: 70px; text-align: center; font-variant-numeric: tabular-nums; }
    .countdown.urgent { color: #ef4444; }
    .countdown.warning { color: #f59e0b; }
    .countdown.normal { color: #3b82f6; }
    .serving-row.expired { opacity: 0.3; transform: scale(0.97); }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.7; } }

    .no-active { display: flex; align-items: center; justify-content: center; flex: 1; color: #cbd5e1; font-size: 28px; font-weight: 600; }

    /* ── Queue panel (right 45%) ── */
    .queue-panel { flex: 45; display: flex; flex-direction: column; background: #f8fafc; }
    .queue-panel .panel-title { background: #f8fafc; }

    /* ── Department tabs ── */
    .dept-tabs { display: flex; gap: 0; padding: 0 16px; background: #f1f5f9; border-bottom: 1px solid #e2e8f0; overflow-x: auto; }
    .dept-tab { padding: 14px 24px; font-size: 16px; font-weight: 700; color: #64748b; cursor: pointer; border-bottom: 3px solid transparent; transition: all 0.2s; white-space: nowrap; }
    .dept-tab.active { color: #3b82f6; border-bottom-color: #3b82f6; background: white; }
    .dept-tab .count { display: inline-block; min-width: 24px; text-align: center; padding: 2px 8px; border-radius: 12px; background: #e2e8f0; font-size: 14px; font-weight: 800; margin-left: 6px; }
    .dept-tab.active .count { background: #dbeafe; color: #1e40af; }

    /* ── Queue list ── */
    .queue-list { flex: 1; overflow-y: auto; padding: 8px 16px; }
    .queue-row { display: flex; align-items: center; padding: 16px 20px; border-radius: 12px; margin-bottom: 6px; background: #fefce8; border: 2px solid #fde68a; transition: all 0.3s; }
    .queue-row.next { background: #fef9c3; border-color: #facc15; border-width: 3px; }
    .queue-row .pos { font-size: 22px; font-weight: 900; color: #94a3b8; min-width: 50px; text-align: center; margin-right: 12px; }
    .queue-row.next .pos { color: #92400e; font-size: 24px; }
    .queue-row .q-ticket { font-size: 32px; font-weight: 900; color: #1e293b; min-width: 140px; letter-spacing: -1px; }
    .queue-row .q-name { flex: 1; font-size: 18px; color: #64748b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .queue-row .q-wait { font-size: 18px; color: #94a3b8; font-weight: 700; }
    .queue-row .q-badge { padding: 4px 10px; border-radius: 8px; font-size: 13px; font-weight: 700; margin-right: 6px; }
    .queue-row .q-badge.priority { background: #fef3c7; color: #92400e; }
    .queue-row .q-badge.booked { background: #dbeafe; color: #1e40af; }

    .queue-empty { text-align: center; padding: 60px; color: #cbd5e1; font-size: 22px; font-weight: 600; }

    /* ── New ticket animation ── */
    .flash-new { animation: flashNew 0.6s ease-out; }
    @keyframes flashNew { 0% { background: #fef08a; transform: scale(1.02); } 100% { background: white; transform: scale(1); } }

    /* ── Full-screen calling overlay ── */
    .call-overlay {
      position: fixed; inset: 0; z-index: 9999;
      display: none; flex-direction: column; align-items: center; justify-content: center;
      background: rgba(255,255,255,0.97);
      animation: fadeInOverlay 0.3s ease-out;
    }
    .call-overlay.visible { display: flex; }
    .call-overlay .call-label { font-size: 32px; font-weight: 800; text-transform: uppercase; letter-spacing: 6px; color: #3b82f6; margin-bottom: 16px; animation: pulse 1.5s infinite; }
    .call-overlay .call-number { font-size: 140px; font-weight: 900; color: #0f172a; letter-spacing: -6px; line-height: 1; }
    .call-overlay .call-desk { font-size: 42px; font-weight: 700; color: #22c55e; margin-top: 20px; }
    .call-overlay .call-dept { font-size: 22px; color: #64748b; margin-top: 8px; }
    @keyframes fadeInOverlay { from { opacity: 0; transform: scale(1.05); } to { opacity: 1; transform: scale(1); } }
    @media (max-width: 767px) {
      .call-overlay .call-number { font-size: 80px; }
      .call-overlay .call-desk { font-size: 28px; }
      .call-overlay .call-label { font-size: 22px; }
    }

    /* ── Audio chime (hidden) ── */
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); }

    /* ── Tablet ── */
    @media (max-width: 1100px) {
      .header { padding: 14px 18px; }
      .office-name { font-size: 20px; }
      .branch-name { font-size: 13px; }
      .clock { font-size: 36px; }
      .stat-box { padding: 10px 14px; }
      .stat-num { font-size: 30px; }
      .panel-title { padding: 14px 18px 12px; font-size: 16px; letter-spacing: 2px; }
      .serving-list { padding: 12px 14px; }
      .serving-row { padding: 18px 18px; }
      .serving-row .ticket-num { font-size: 56px; min-width: 170px; }
      .serving-row .desk-name { font-size: 24px; }
      .queue-list { padding: 8px 10px; }
      .queue-row { padding: 14px 14px; }
      .queue-row .q-ticket { font-size: 26px; min-width: 110px; }
      .queue-row .q-name, .queue-row .q-wait { font-size: 16px; }
    }

    /* ── Mobile ── */
    @media (max-width: 767px) {
      body { overflow: hidden; }
      .header {
        flex-direction: column;
        align-items: flex-start;
        gap: 12px;
        padding: 14px 14px;
      }
      .header-left { width: 100%; gap: 12px; }
      .logo, .logo img { width: 44px; height: 44px; }
      .logo.fallback { font-size: 22px; border-radius: 12px; }
      .office-name { font-size: 18px; }
      .branch-name { font-size: 12px; }
      .header-right { width: 100%; display: flex; align-items: center; justify-content: space-between; text-align: left; }
      .clock { font-size: 28px; }
      .date { font-size: 12px; }

      .stats-strip {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .stat-box {
        padding: 10px 10px;
        min-height: 72px;
        border-right: 1px solid #e2e8f0;
        border-bottom: 1px solid #e2e8f0;
      }
      .stat-box:nth-child(2n) { border-right: none; }
      .stat-box:nth-last-child(-n+2) { border-bottom: none; }
      .stat-num { font-size: 24px; line-height: 1; }
      .stat-label { font-size: 10px; letter-spacing: 1.1px; margin-top: 3px; }

      .content { flex-direction: column; min-height: 0; }
      .now-serving-panel {
        flex: 0 0 32vh;
        border-right: none;
        border-bottom: 2px solid #e2e8f0;
        min-height: 0;
      }
      .queue-panel { flex: 1 1 auto; min-height: 0; }
      .panel-title { padding: 14px 14px 12px; font-size: 15px; letter-spacing: 2px; }
      .serving-list { padding: 10px 10px 14px; overflow: auto; gap: 8px; }
      .serving-row {
        flex-direction: column;
        align-items: flex-start;
        gap: 10px;
        padding: 14px 14px;
        border-radius: 14px;
      }
      .serving-row.called, .serving-row.serving { border-width: 2px; }
      .serving-row .ticket-num { font-size: 42px; min-width: auto; line-height: 1; letter-spacing: -2px; }
      .serving-row .arrow { font-size: 18px; margin: 0; }
      .serving-row .desk-name { font-size: 18px; }
      .serving-row .dept-name { font-size: 12px; }
      .serving-row .status-pill { font-size: 12px; padding: 6px 14px; }
      .countdown { font-size: 22px; min-width: auto; text-align: left; }
      .no-active { font-size: 22px; padding: 0 20px; text-align: center; }

      .dept-tabs { padding: 0 10px; }
      .dept-tab { padding: 12px 16px; font-size: 14px; }
      .dept-tab .count { font-size: 12px; }
      .queue-list { padding: 10px 10px 16px; }
      .queue-row { padding: 12px 12px; }
      .queue-row .pos { font-size: 18px; min-width: 28px; }
      .queue-row .q-ticket { font-size: 22px; min-width: 88px; }
      .queue-row .q-name { font-size: 14px; }
      .queue-row .q-wait { font-size: 12px; margin-left: 8px; }
      .queue-row .q-badge { font-size: 11px; padding: 3px 8px; }
      .queue-empty { padding: 22px 18px; font-size: 16px; }
    }
    /* RTL: neutralize letter-spacing and uppercase that break Arabic ligatures */
    html[dir="rtl"] .stat-label,
    html[dir="rtl"] .panel-title,
    html[dir="rtl"] .serving-row .status-pill,
    html[dir="rtl"] .status-badge,
    html[dir="rtl"] .call-overlay .call-label { letter-spacing: normal; text-transform: none; }
    html[dir="rtl"] .clock,
    html[dir="rtl"] .number,
    html[dir="rtl"] .serving-row .ticket-num,
    html[dir="rtl"] .queue-row .q-ticket,
    html[dir="rtl"] .call-overlay .call-number { letter-spacing: normal; }
  </style>
</head>
<body>
  <div class="call-overlay" id="call-overlay">
    <div class="call-label" id="call-overlay-label">NOW CALLING</div>
    <div class="call-number" id="call-overlay-number"></div>
    <div class="call-desk" id="call-overlay-desk"></div>
    <div class="call-dept" id="call-overlay-dept"></div>
  </div>
  <div class="display">
    <div class="header">
      <div class="header-left">
        <div class="logo fallback" id="logo">Q</div>
        <div>
          <div class="office-name" id="office-name"></div>
          <div class="branch-name" id="branch-name"></div>
        </div>
      </div>
      <div class="header-right" style="display:flex;align-items:center;gap:16px">
        <div class="conn-badge connected" id="conn-badge"><span class="dot"></span><span id="conn-text">Connected</span></div>
        <select id="lang-select" style="padding:6px 12px;border-radius:8px;border:2px solid #e2e8f0;font-size:14px;font-weight:700;background:white;cursor:pointer" onchange="setLang(this.value)">
          <option value="en">EN</option>
          <option value="fr">FR</option>
          <option value="ar">AR</option>
        </select>
        <div style="text-align:right">
          <div class="clock" id="clock"></div>
          <div class="date" id="date"></div>
        </div>
      </div>
    </div>

    <div id="device-warn" style="display:none;background:#fef3c7;color:#92400e;text-align:center;padding:8px;font-size:14px;font-weight:700"></div>
    <div class="stats-strip">
      <div class="stat-box"><div class="stat-num waiting" id="s-waiting">0</div><div class="stat-label">Waiting</div></div>
      <div class="stat-box"><div class="stat-num called" id="s-called">0</div><div class="stat-label">Called</div></div>
      <div class="stat-box"><div class="stat-num serving" id="s-serving">0</div><div class="stat-label">Serving</div></div>
      <div class="stat-box"><div class="stat-num served" id="s-served">0</div><div class="stat-label">Served Today</div></div>
    </div>

    <div class="content">
      <div class="now-serving-panel">
        <div class="panel-title">Now Serving</div>
        <div class="serving-list" id="serving-list">
          <div class="no-active">Waiting for customers...</div>
        </div>
      </div>

      <div class="queue-panel">
        <div class="panel-title">Queue</div>
        <div class="dept-tabs" id="dept-tabs"></div>
        <div class="queue-list" id="queue-list">
          <div class="queue-empty">No customers in queue</div>
        </div>
      </div>
    </div>
  </div>

  <script>
    var API = '${apiBase}';
    var PAGE_PARAMS = new URLSearchParams(window.location.search || '');
    var REQUESTED_OFFICE_ID = PAGE_PARAMS.get('officeId');
    var OFFICE_QUERY = REQUESTED_OFFICE_ID ? ('?officeId=' + encodeURIComponent(REQUESTED_OFFICE_ID)) : '';
    var lastServingHash = '';
    var lastQueueHash = '';
    var activeDept = 'all';
    var allTickets = [];
    var departments = {};
    var desks = {};
    var isCloud = false;

    function setConnStatus(online) {
      isCloud = online;
      var badge = document.getElementById('conn-badge');
      var text = document.getElementById('conn-text');
      if (badge) { badge.className = 'conn-badge ' + (online ? 'connected' : 'local'); }
      if (text) { text.textContent = online ? 'Connected' : 'Local Mode'; }
    }

    // Simple chime via Web Audio API
    function playChime() {
      try {
        var ctx = new (window.AudioContext || window.webkitAudioContext)();
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = 800;
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.5);
      } catch(e) {}
    }

    function updateText(id, val) {
      var el = document.getElementById(id);
      if (el && el.textContent !== String(val)) el.textContent = String(val);
    }

    function formatWait(created) {
      var mins = Math.floor((Date.now() - new Date(created).getTime()) / 60000);
      if (mins < 1) return '<1m';
      if (mins < 60) return mins + 'm';
      return Math.floor(mins/60) + 'h ' + (mins%60) + 'm';
    }

    var displayLang = localStorage.getItem('qf_display_lang') || 'en';
    var displayI18n = {
      en: { waiting: 'WAITING', called: 'CALLED', serving: 'SERVING', served: 'SERVED TODAY', nowServing: 'NOW SERVING', queue: 'QUEUE', waitingFor: 'Waiting for customers...', noQueue: 'No customers in queue', proceed: 'Please Proceed', nowCalling: 'NOW CALLING', goTo: 'Go to', connected: 'Connected' },
      fr: { waiting: 'EN ATTENTE', called: 'APPEL\u00c9', serving: 'EN SERVICE', served: 'SERVIS AUJOURD\\'HUI', nowServing: 'EN COURS', queue: 'FILE D\\'ATTENTE', waitingFor: 'En attente de clients...', noQueue: 'Aucun client en file', proceed: 'Veuillez vous pr\u00e9senter', nowCalling: 'APPEL EN COURS', goTo: 'Rendez-vous \u00e0', connected: 'Connect\u00e9' },
      ar: { waiting: '\u0641\u064a \u0627\u0644\u0627\u0646\u062a\u0638\u0627\u0631', called: '\u062a\u0645 \u0627\u0644\u0627\u0633\u062a\u062f\u0639\u0627\u0621', serving: '\u0642\u064a\u062f \u0627\u0644\u062e\u062f\u0645\u0629', served: '\u062a\u0645\u062a \u062e\u062f\u0645\u062a\u0647\u0645 \u0627\u0644\u064a\u0648\u0645', nowServing: '\u0642\u064a\u062f \u0627\u0644\u062e\u062f\u0645\u0629 \u0627\u0644\u0622\u0646', queue: '\u0637\u0627\u0628\u0648\u0631', waitingFor: '\u0641\u064a \u0627\u0646\u062a\u0638\u0627\u0631 \u0627\u0644\u0639\u0645\u0644\u0627\u0621...', noQueue: '\u0644\u0627 \u064a\u0648\u062c\u062f \u0639\u0645\u0644\u0627\u0621 \u0641\u064a \u0627\u0644\u0637\u0627\u0628\u0648\u0631', proceed: '\u064a\u0631\u062c\u0649 \u0627\u0644\u062a\u0642\u062f\u0645', nowCalling: '\u062c\u0627\u0631\u064d \u0627\u0644\u0627\u0633\u062a\u062f\u0639\u0627\u0621', goTo: '\u062a\u0648\u062c\u0647 \u0625\u0644\u0649', connected: '\u0645\u062a\u0635\u0644' }
    };
    function dt(key) { return (displayI18n[displayLang] || displayI18n.en)[key] || key; }
    function setLang(lang) {
      displayLang = lang;
      localStorage.setItem('qf_display_lang', lang);
      document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
      applyLabels();
      if (allTickets.length) { renderServing(allTickets.filter(function(t){return t.status==='called'||t.status==='serving'})); renderQueue(allTickets.filter(function(t){return t.status==='waiting'})); }
    }
    function applyLabels() {
      document.querySelectorAll('.stat-label').forEach(function(el, i) {
        el.textContent = [dt('waiting'), dt('called'), dt('serving'), dt('served')][i] || el.textContent;
      });
      document.querySelectorAll('.panel-title').forEach(function(el, i) {
        el.textContent = i === 0 ? dt('nowServing') : dt('queue');
      });
      var langSel = document.getElementById('lang-select');
      if (langSel) langSel.value = displayLang;
      var connText = document.getElementById('conn-text');
      if (connText) connText.textContent = dt('connected');
    }
    // Apply saved lang on load
    (function() {
      var langSel = document.getElementById('lang-select');
      if (langSel) langSel.value = displayLang;
      if (displayLang === 'ar') document.documentElement.dir = 'rtl';
      applyLabels();
    })();

    function updateClock() {
      var now = new Date();
      updateText('clock', now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      updateText('date', now.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }));
    }

    var CALL_TIMEOUT = 60;
    var prevCalledIds = [];

    function getCountdown(calledAt) {
      if (!calledAt) return CALL_TIMEOUT;
      var elapsed = Math.floor((Date.now() - new Date(calledAt).getTime()) / 1000);
      return Math.max(0, CALL_TIMEOUT - elapsed);
    }

    var overlayTimer = null;
    function showCallOverlay(ticket, deskName, deptName) {
      var overlay = document.getElementById('call-overlay');
      document.getElementById('call-overlay-label').textContent = dt('nowCalling');
      document.getElementById('call-overlay-number').textContent = ticket.ticket_number;
      document.getElementById('call-overlay-desk').textContent = dt('goTo') + ' ' + deskName;
      document.getElementById('call-overlay-dept').textContent = deptName || '';
      overlay.classList.add('visible');
      if (overlayTimer) clearTimeout(overlayTimer);
      overlayTimer = setTimeout(function() { overlay.classList.remove('visible'); overlayTimer = null; }, 8000);
    }

    function renderServing(active, forceRebuild) {
      // Check for newly called tickets (for chime + overlay)
      var currentCalledIds = active.filter(function(t){return t.status==='called'}).map(function(t){return t.id});
      var hasNew = currentCalledIds.some(function(id) { return prevCalledIds.indexOf(id) === -1; });
      if (hasNew) {
        if (prevCalledIds.length > 0) playChime();
        // Show full-screen overlay for the newest called ticket
        var newTicket = active.find(function(t) { return t.status === 'called' && prevCalledIds.indexOf(t.id) === -1; });
        if (newTicket) {
          var dn = desks[newTicket.desk_id] || newTicket.desk_name || 'Desk';
          var dpn = departments[newTicket.department_id] || '';
          showCallOverlay(newTicket, dn, dpn);
        }
        forceRebuild = true;
      }
      prevCalledIds = currentCalledIds;

      var el = document.getElementById('serving-list');
      if (active.length === 0) {
        if (lastServingHash !== '') { el.innerHTML = '<div class="no-active">' + dt('waitingFor') + '</div>'; lastServingHash = ''; }
        return;
      }

      // Filter out expired called tickets (countdown <= 0)
      var visible = active.filter(function(t) {
        if (t.status !== 'called') return true;
        return getCountdown(t.called_at) > 0;
      });

      if (visible.length === 0) {
        if (lastServingHash !== '') { el.innerHTML = '<div class="no-active">' + dt('waitingFor') + '</div>'; lastServingHash = ''; }
        return;
      }

      // Build a structural hash (ids + statuses) to detect real changes
      var structHash = visible.map(function(t){ return t.id + ':' + t.status; }).join(',');
      var needsRebuild = forceRebuild || structHash !== lastServingHash;
      lastServingHash = structHash;

      if (needsRebuild) {
        // Full DOM rebuild only when tickets change
        el.innerHTML = visible.map(function(t) {
          var deskName = desks[t.desk_id] || t.desk_name || 'Desk';
          var deptName = departments[t.department_id] || '';

          if (t.status === 'called') {
            var secs = getCountdown(t.called_at);
            var urgency = secs <= 10 ? 'urgent' : secs <= 20 ? 'warning' : 'normal';
            return '<div class="serving-row called" data-id="' + t.id + '">' +
              '<div class="ticket-num">' + t.ticket_number + '</div>' +
              '<div class="arrow">&rarr;</div>' +
              '<div class="desk-info"><div class="desk-name">' + deskName + '</div>' +
              (deptName ? '<div class="dept-name">' + deptName + '</div>' : '') + '</div>' +
              '<div class="countdown ' + urgency + '">' + secs + 's</div>' +
              '<div class="status-pill">' + dt('proceed') + '</div>' +
              '</div>';
          }

          return '<div class="serving-row serving" data-id="' + t.id + '">' +
            '<div class="ticket-num">' + t.ticket_number + '</div>' +
            '<div class="arrow">&rarr;</div>' +
            '<div class="desk-info"><div class="desk-name">' + deskName + '</div>' +
            (deptName ? '<div class="dept-name">' + deptName + '</div>' : '') + '</div>' +
            '<div class="status-pill">' + dt('serving') + '</div>' +
            '</div>';
        }).join('');
      } else {
        // Lightweight update: only patch countdown text + urgency class in-place
        visible.forEach(function(t) {
          if (t.status !== 'called') return;
          var secs = getCountdown(t.called_at);
          var urgency = secs <= 10 ? 'urgent' : secs <= 20 ? 'warning' : 'normal';
          var rows = el.querySelectorAll('.serving-row[data-id="' + t.id + '"] .countdown');
          rows.forEach(function(cd) { cd.textContent = secs + 's'; cd.className = 'countdown ' + urgency; });
        });
      }
    }

    function renderDeptTabs(waiting) {
      var counts = { all: waiting.length };
      waiting.forEach(function(t) {
        var did = t.department_id || 'unknown';
        counts[did] = (counts[did] || 0) + 1;
      });

      var deptIds = Object.keys(counts).filter(function(k) { return k !== 'all'; });
      if (deptIds.length <= 1) {
        document.getElementById('dept-tabs').innerHTML = '';
        activeDept = 'all';
        return;
      }

      var tabs = '<div class="dept-tab ' + (activeDept === 'all' ? 'active' : '') + '" onclick="setDept(\\'all\\')">All<span class="count">' + counts.all + '</span></div>';
      deptIds.forEach(function(did) {
        var name = departments[did] || did.substring(0,8);
        tabs += '<div class="dept-tab ' + (activeDept === did ? 'active' : '') + '" onclick="setDept(\\'' + did + '\\')">' + name + '<span class="count">' + (counts[did]||0) + '</span></div>';
      });
      document.getElementById('dept-tabs').innerHTML = tabs;
    }

    function setDept(d) { activeDept = d; renderQueue(allTickets.filter(function(t){return t.status==='waiting'})); }

    function renderQueue(waiting) {
      renderDeptTabs(waiting);

      var filtered = activeDept === 'all' ? waiting : waiting.filter(function(t) { return t.department_id === activeDept; });
      var hash = JSON.stringify(filtered.map(function(t){return t.id}));

      var el = document.getElementById('queue-list');
      if (filtered.length === 0) {
        if (lastQueueHash !== hash) el.innerHTML = '<div class="queue-empty">' + dt('noQueue') + '</div>';
        lastQueueHash = hash;
        return;
      }

      if (hash === lastQueueHash) return;
      lastQueueHash = hash;

      el.innerHTML = filtered.map(function(t, i) {
        var isNext = i === 0;
        var badges = '';
        if (t.priority > 1) badges += '<span class="q-badge priority">P' + t.priority + '</span> ';
        if (t.appointment_id) badges += '<span class="q-badge booked">Booked</span>';
        var deptLabel = departments[t.department_id] || '';
        return '<div class="queue-row' + (isNext ? ' next' : '') + '">' +
          '<div class="pos">#' + (i+1) + '</div>' +
          '<div class="q-ticket">' + t.ticket_number + '</div>' +
          '<div class="q-name">' + (deptLabel || '') + '</div>' +
          badges +
          '<div class="q-wait">' + formatWait(t.created_at) + '</div>' +
          '</div>';
      }).join('');
    }

    // ── Office info — fetched once, refreshed every 5 min ──
    var officeLoaded = false;
    async function fetchOfficeInfo() {
      try {
        var officeRes = await fetch(API + '/api/kiosk-info' + OFFICE_QUERY, { cache: 'no-store' });
        var officeData = await officeRes.json();
        if (officeData.error) return;
        if (officeData.office) {
          var orgName = officeData.org_name || officeData.office.name;
          var branchName = officeData.org_name ? officeData.office.name : '';
          updateText('office-name', orgName);
          updateText('branch-name', branchName);
          (officeData.departments || []).forEach(function(d) { departments[d.id] = d.name; });
          if (officeData.logo_url) {
            var logoEl = document.getElementById('logo');
            if (logoEl && !officeLoaded) {
              logoEl.className = 'logo';
              logoEl.style.background = 'none';
              logoEl.innerHTML = '<img src="' + officeData.logo_url + '" alt="Logo" onerror="this.parentElement.className=\\'logo fallback\\';this.parentElement.innerHTML=\\'Q\\'">';
            }
          }
          officeLoaded = true;
        }
      } catch(e) {}
    }
    fetchOfficeInfo();
    setInterval(fetchOfficeInfo, 300000); // refresh every 5 min

    // ── Ticket data — the fast path ──
    var fetchInFlight = false;
    async function fetchData() {
      if (fetchInFlight) return; // prevent concurrent fetches
      fetchInFlight = true;
      try {
        var res = await fetch(API + '/api/display-data' + OFFICE_QUERY, { cache: 'no-store' });
        var d = await res.json();
        if (d.error) throw new Error(d.error);

        setConnStatus(d.cloud_connected);
        updateText('s-waiting', d.waiting_count);
        updateText('s-called', d.called_count);
        updateText('s-serving', d.serving_count);
        updateText('s-served', d.served_count);

        (d.waiting || []).forEach(function(t) {
          if (typeof t.customer_data === 'string') { try { t.customer_data = JSON.parse(t.customer_data); } catch(ex) { t.customer_data = {}; } }
        });
        (d.now_serving || []).forEach(function(t) {
          if (t.desk_id && t.desk_name) desks[t.desk_id] = t.desk_name;
          if (t.department_id && t.department_name) departments[t.department_id] = t.department_name;
        });
        (d.waiting || []).forEach(function(t) {
          if (t.department_id && t.department_name) departments[t.department_id] = t.department_name;
        });

        allTickets = [...(d.now_serving || []), ...(d.waiting || [])];
        lastActive = d.now_serving || [];
        renderServing(lastActive, true);
        renderQueue(d.waiting || []);
      } catch(e) {
        console.error('Display fetch error:', e);
        if (!officeLoaded) {
          updateText('office-name', 'Qflo Station');
          updateText('branch-name', 'No active office connected');
        }
        updateText('s-waiting', '0');
        updateText('s-called', '0');
        updateText('s-serving', '0');
        updateText('s-served', '0');
        setConnStatus(false);
        lastServingHash = '';
        lastQueueHash = '';
        lastActive = [];
        var servingEl = document.getElementById('serving-list');
        if (servingEl) servingEl.innerHTML = '<div class="no-active">Connect Qflo Station to load this display</div>';
        var queueEl = document.getElementById('queue-list');
        if (queueEl) queueEl.innerHTML = '<div class="queue-empty">No active office connected</div>';
        var tabsEl = document.getElementById('dept-tabs');
        if (tabsEl) tabsEl.innerHTML = '';
      } finally {
        fetchInFlight = false;
      }
    }

    // ── Debounced fetch — coalesces rapid SSE events (e.g. 3 calls in 1s) ──
    var debounceTimer = null;
    function debouncedFetch(delay) {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function() { debounceTimer = null; fetchData(); }, delay || 150);
    }

    // ── Device ping — register this display ──
    var displayId = localStorage.getItem('qf_device_id') || ('display-' + Math.random().toString(36).substr(2, 6));
    localStorage.setItem('qf_device_id', displayId);
    function pingDevice() {
      fetch(API + '/api/device-ping', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ id: displayId, type: 'display', name: 'Waiting Room Display' })
      }).catch(function(){});
    }
    pingDevice();
    setInterval(pingDevice, 30000);

    // ── Device status warnings ──
    var disconnectCount = 0;
    async function checkDevices() {
      try {
        var res = await fetch(API + '/api/device-status');
        var d = await res.json();
        var disconnected = (d.devices || []).filter(function(dev) { return !dev.connected && dev.type !== 'display'; });
        var el = document.getElementById('device-warn');
        if (disconnected.length > 0) {
          disconnectCount++;
          if (disconnectCount >= 3) {
            var names = disconnected.map(function(dev) { return dev.name; }).join(', ');
            if (el) { el.style.display = 'block'; el.textContent = 'Disconnected: ' + names; }
          }
        } else {
          disconnectCount = 0;
          if (el) el.style.display = 'none';
        }
      } catch(e) {}
    }
    setInterval(checkDevices, 10000);

    // ── Clock + countdown — lightweight 1s tick (no DOM rebuild) ──
    var lastActive = [];
    function tick() {
      updateClock();
      if (lastActive.length > 0) renderServing(lastActive, false);
    }
    setInterval(tick, 1000);
    tick();

    // ── SSE — primary real-time channel with heartbeat detection ──
    var evtSource = null;
    var sseAlive = false;
    var lastHeartbeat = 0;
    var pendingCallFlash = null;

    function connectSSE() {
      if (evtSource) { try { evtSource.close(); } catch(e){} }
      evtSource = new EventSource(API + '/api/events');
      sseAlive = false;

      evtSource.onopen = function() {
        sseAlive = true;
        lastHeartbeat = Date.now();
      };

      evtSource.onmessage = function(e) {
        lastHeartbeat = Date.now();
        sseAlive = true;

        // SSE heartbeat comments come as empty data or ':' lines — EventSource
        // only fires onmessage for 'data:' lines, so heartbeat comments are
        // invisible here. 'connected' is our initial handshake.
        if (e.data === 'heartbeat') return; // keep-alive, no action needed
        if (e.data === 'connected') { debouncedFetch(50); return; }
        if (e.data === 'update') { debouncedFetch(150); return; }

        try {
          var evt = JSON.parse(e.data);
          if (evt.type === 'ticket_called' && evt.ticket_number) {
            playChime();
            pendingCallFlash = evt.ticket_number;
            // Fetch immediately for ticket_called (user expects instant feedback)
            if (debounceTimer) clearTimeout(debounceTimer);
            fetchData().then(function() {
              if (!pendingCallFlash) return;
              var rows = document.querySelectorAll('.serving-row');
              rows.forEach(function(row) {
                var numEl = row.querySelector('.ticket-num');
                if (numEl && numEl.textContent.trim() === pendingCallFlash) {
                  row.style.animation = 'none'; row.offsetHeight; row.style.animation = 'flashNew 1.5s ease-out';
                }
              });
              pendingCallFlash = null;
            });
          } else {
            debouncedFetch(150);
          }
        } catch(ex) { debouncedFetch(150); }
      };

      evtSource.onerror = function() {
        sseAlive = false;
        try { evtSource.close(); } catch(e){}
        // Exponential backoff: 2s, 4s, 8s, max 15s
        var delay = Math.min(2000 * Math.pow(2, Math.floor(Math.random() * 3)), 15000);
        setTimeout(connectSSE, delay);
      };
    }
    connectSSE();

    // ── Heartbeat watchdog — detect silent SSE drops ──
    setInterval(function() {
      if (sseAlive && (Date.now() - lastHeartbeat) > 25000) {
        // No heartbeat for 25s (server sends every 15s) — SSE silently died
        console.warn('SSE heartbeat lost, reconnecting...');
        sseAlive = false;
        try { evtSource.close(); } catch(e){}
        connectSSE();
      }
    }, 10000);

    // ── Fallback poll — only when SSE is down ──
    fetchData();
    setInterval(function() {
      if (!sseAlive) fetchData();
    }, 10000);
  <\/script>
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

// ══════════════════════════════════════════════════════════════════════
// ── Station Web Interface — mirrors the Electron IPC over HTTP ──────
// Allows any browser on the local network to use the full station UI
// at http://<station-ip>:3847/station
// ══════════════════════════════════════════════════════════════════════

const STATION_DIR = join(__dirname, '../dist');
const STATION_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// SSE clients for station UI (separate from display SSE)
const stationSSEClients: Set<http.ServerResponse> = new Set();

/** Notify all station browser clients of a change */
export function notifyStationClients(event: Record<string, any>) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of stationSSEClients) {
    try { client.write(data); } catch { stationSSEClients.delete(client); }
  }
}

/** Serve the station index.html with the HTTP shim injected */
function serveStationIndex(res: http.ServerResponse) {
  try {
    let html = readFileSync(join(STATION_DIR, 'index.html'), 'utf-8');

    // Inject the HTTP shim BEFORE the app script — this creates window.qf
    // using fetch() instead of ipcRenderer
    const shimScript = `<script>
// ── HTTP Bridge — replaces Electron IPC with fetch calls ──
(function() {
  window.__QF_HTTP_MODE__ = true;
  var API = window.location.origin;

  function get(path) {
    return fetch(API + path).then(function(r) { return r.json(); });
  }
  function post(path, body) {
    return fetch(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function(r) { return r.json(); });
  }

  // Ticket change listeners (SSE-powered)
  var ticketListeners = [];
  var syncListeners = [];
  var errorListeners = [];
  var sse = null;

  function connectSSE() {
    if (sse) { try { sse.close(); } catch(e) {} }
    sse = new EventSource(API + '/api/station/events');
    sse.onmessage = function(e) {
      try {
        var data = JSON.parse(e.data);
        if (data.type === 'tickets_changed') {
          ticketListeners.forEach(function(cb) { cb(); });
        } else if (data.type === 'sync_status') {
          syncListeners.forEach(function(cb) { cb(data.status); });
        } else if (data.type === 'sync_error') {
          errorListeners.forEach(function(cb) { cb(data.error); });
        }
      } catch(err) {}
    };
    sse.onerror = function() {
      setTimeout(connectSSE, 3000);
    };
  }
  connectSSE();

  window.qf = {
    getConfig: function() { return get('/api/station/config'); },

    db: {
      getTickets: function(officeId, statuses) {
        var ids = Array.isArray(officeId) ? officeId.join(',') : officeId;
        return get('/api/station/tickets?officeIds=' + ids + '&statuses=' + statuses.join(','));
      },
      createTicket: function(ticket) {
        return post('/api/take-ticket', {
          officeId: ticket.office_id,
          departmentId: ticket.department_id,
          serviceId: ticket.service_id,
          customerName: ticket.customer_data?.name || '',
          customerPhone: ticket.customer_data?.phone || '',
          customerReason: ticket.customer_data?.reason || '',
          source: ticket.source || 'in_house',
        });
      },
      updateTicket: function(ticketId, updates) {
        return post('/api/station/update-ticket', { ticketId: ticketId, updates: updates });
      },
      callNext: function(officeId, deskId, staffId) {
        return post('/api/station/call-next', { officeId: officeId, deskId: deskId, staffId: staffId });
      },
      query: function(table, officeIds) {
        return get('/api/station/query?table=' + table + '&officeIds=' + officeIds.join(','));
      },
    },

    sync: {
      getStatus: function() { return get('/api/station/sync-status'); },
      forceSync: function() { return post('/api/station/sync-force', {}); },
      getPendingDetails: function() { return get('/api/station/sync-pending'); },
      discardItem: function() { return Promise.resolve(); },
      discardAll: function() { return Promise.resolve(); },
      retryItem: function() { return Promise.resolve(); },
      onStatusChange: function(cb) {
        syncListeners.push(cb);
        return function() { syncListeners = syncListeners.filter(function(c) { return c !== cb; }); };
      },
      onProgress: function(cb) { return function() {}; },
      onError: function(cb) {
        errorListeners.push(cb);
        return function() { errorListeners = errorListeners.filter(function(c) { return c !== cb; }); };
      },
    },

    session: {
      save: function(session) { return Promise.resolve(); },
      load: function() { return get('/api/station/session'); },
      clear: function() { return Promise.resolve(); },
    },

    settings: {
      _localeCallbacks: [],
      getLocale: function() {
        var stored = localStorage.getItem('qflo_station_locale');
        if (stored) return Promise.resolve(stored);
        return get('/api/station/settings').then(function(s) { return s.locale; });
      },
      setLocale: function(locale) {
        localStorage.setItem('qflo_station_locale', locale);
        currentLang = locale;
        var btn = document.getElementById('qf-lang-toggle');
        if (btn) btn.textContent = langLabels[locale] || locale.toUpperCase();
        return post('/api/station/settings/locale', { locale: locale }).then(function(s) { return s.locale; });
      },
      onLocaleChange: function(cb) {
        window.qf.settings._localeCallbacks.push(cb);
        return function() { window.qf.settings._localeCallbacks = window.qf.settings._localeCallbacks.filter(function(c) { return c !== cb; }); };
      },
    },

    isOnline: function() { return get('/api/station/sync-status').then(function(s) { return s.isOnline; }); },

    auth: {
      onSessionExpired: function(cb) { return function() {}; },
    },

    tickets: {
      onChange: function(cb) {
        ticketListeners.push(cb);
        return function() { ticketListeners = ticketListeners.filter(function(c) { return c !== cb; }); };
      },
    },

    activity: {
      getRecent: function(officeId, limit) {
        return get('/api/station/activity?officeId=' + officeId + '&limit=' + (limit || 20));
      },
    },

    debug: {
      dbStats: function() { return get('/api/station/debug-stats'); },
    },

    getKioskPort: function() { return Promise.resolve(location.port || (location.protocol === 'https:' ? 443 : 80)); },

    kiosk: {
      getUrl: function() { return get('/api/station/kiosk-info').then(function(d) { return d.kioskUrl; }); },
      getLocalIP: function() { return get('/api/station/kiosk-info').then(function(d) { return d.localIP; }); },
    },

    org: {
      getBranding: function() { return get('/api/station/branding'); },
    },

    updater: {
      onStatusChange: function() { return function() {}; },
      getStatus: function() { return Promise.resolve({ status: 'idle', version: null, progress: null, message: null }); },
      checkForUpdates: function() { return Promise.resolve(); },
      installUpdate: function() { return Promise.resolve(); },
    },

    license: {
      activate: function() { return Promise.resolve({ ok: false }); },
      getStatus: function() { return Promise.resolve({ licensed: true, machineId: 'local-network' }); },
    },
  };

  // ── Shared bottom bar: language toggle + mode badge ──
  var langs = ['en', 'fr', 'ar'];
  var langLabels = { en: 'EN', fr: 'FR', ar: 'عر' };
  var currentLang = localStorage.getItem('qflo_station_locale') || 'ar';

  window.addEventListener('load', function() {
    var bar = document.createElement('div');
    bar.id = 'qf-bottom-bar';

    var langBtn = document.createElement('button');
    langBtn.id = 'qf-lang-toggle';
    langBtn.textContent = langLabels[currentLang] || 'EN';
    langBtn.onclick = function() {
      var idx = langs.indexOf(currentLang);
      currentLang = langs[(idx + 1) % langs.length];
      localStorage.setItem('qflo_station_locale', currentLang);
      langBtn.textContent = langLabels[currentLang];
      if (window.qf && window.qf.settings && window.qf.settings._localeCallbacks) {
        window.qf.settings._localeCallbacks.forEach(function(cb) { cb(currentLang); });
      }
      document.documentElement.lang = currentLang;
      document.documentElement.dir = currentLang === 'ar' ? 'rtl' : 'ltr';
      document.body.dir = currentLang === 'ar' ? 'rtl' : 'ltr';
    };

    var badge = document.createElement('div');
    badge.id = 'qf-mode-badge';
    badge.className = 'local';
    badge.textContent = '📡 Local';

    bar.appendChild(langBtn);
    bar.appendChild(badge);
    document.body.appendChild(bar);
  });
})();
</script>`;

    // Inject shim before the app's module script
    html = html.replace('<script type="module"', shimScript + '\n  <script type="module"');
    // Fix asset paths for /station/ base
    html = html.replace(/\.\/assets\//g, '/station/assets/');

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(html);
  } catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Station UI not available: ' + (err?.message || 'unknown') }));
  }
}

/** Serve static station assets (JS, CSS, images) */
function serveStationAsset(relPath: string, res: http.ServerResponse) {
  try {
    const filePath = join(STATION_DIR, relPath);
    if (!filePath.startsWith(STATION_DIR)) { res.writeHead(403); res.end(); return; }
    if (!existsSync(filePath)) { res.writeHead(404); res.end(); return; }
    const ext = extname(filePath);
    const mime = STATION_MIME[ext] || 'application/octet-stream';
    const content = readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=31536000, immutable' });
    res.end(content);
  } catch {
    res.writeHead(404); res.end();
  }
}

// ── Station API Handlers ────────────────────────────────────────────

function handleStationConfig(res: http.ServerResponse) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ supabaseUrl: CONFIG.SUPABASE_URL, supabaseAnonKey: CONFIG.SUPABASE_ANON_KEY }));
}

function handleStationGetTickets(url: URL, res: http.ServerResponse) {
  const db = getDB();
  const officeIds = (url.searchParams.get('officeIds') || '').split(',').filter(Boolean);
  const statuses = (url.searchParams.get('statuses') || '').split(',').filter(Boolean);
  if (!officeIds.length || !statuses.length) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('[]'); return; }
  const oPh = officeIds.map(() => '?').join(',');
  const sPh = statuses.map(() => '?').join(',');
  const result = db.prepare(`SELECT * FROM tickets WHERE office_id IN (${oPh}) AND status IN (${sPh}) ORDER BY priority DESC, created_at ASC`).all(...officeIds, ...statuses);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result));
}

function handleStationQuery(url: URL, res: http.ServerResponse) {
  const db = getDB();
  const table = url.searchParams.get('table') || '';
  const officeIds = (url.searchParams.get('officeIds') || '').split(',').filter(Boolean);
  if (!officeIds.length) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('[]'); return; }
  const ph = officeIds.map(() => '?').join(',');
  let result: any[] = [];
  switch (table) {
    case 'departments': result = db.prepare(`SELECT id, name, code FROM departments WHERE office_id IN (${ph})`).all(...officeIds); break;
    case 'services': result = db.prepare('SELECT id, name, department_id FROM services').all(); break;
    case 'desks': result = db.prepare(`SELECT id, name FROM desks WHERE office_id IN (${ph})`).all(...officeIds); break;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result));
}

function handleStationSyncStatus(res: http.ServerResponse) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ isOnline: isCloudReachable, pendingCount: 0, lastSyncAt: null }));
}

function handleStationSessionLoad(res: http.ServerResponse) {
  const db = getDB();
  try {
    const row = db.prepare("SELECT value FROM session WHERE key = 'current'").get() as any;
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });
    res.end(row ? row.value : 'null');
  } catch {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });
    res.end('null');
  }
}

function handleStationSettings(res: http.ServerResponse) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ locale: loadStoredLocale() }));
}

function handleStationSetLocale(body: any, res: http.ServerResponse) {
  const locale = storeLocale(body?.locale);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ locale }));
}

function handleStationActivity(url: URL, res: http.ServerResponse) {
  const db = getDB();
  const limit = parseInt(url.searchParams.get('limit') || '20', 10);
  try {
    const rows = db.prepare(`
      SELECT a.ticket_number, a.event_type, a.to_status, a.created_at
      FROM ticket_audit_log a
      INNER JOIN (
        SELECT ticket_id, MAX(created_at) as max_created
        FROM ticket_audit_log WHERE created_at >= datetime('now', '-24 hours')
        GROUP BY ticket_id
      ) latest ON a.ticket_id = latest.ticket_id AND a.created_at = latest.max_created
      ORDER BY a.created_at DESC LIMIT ?
    `).all(limit) as any[];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(rows.map((r: any) => ({ ticket: r.ticket_number || '?', action: r.to_status || r.event_type || 'unknown', time: r.created_at }))));
  } catch { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('[]'); }
}

function handleStationKioskInfo(res: http.ServerResponse) {
  const ip = getLocalIP();
  const office = getSessionDefaultOffice();
  const officeIdQuery = office?.id ? `?officeId=${encodeURIComponent(office.id)}` : '';
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  });
  res.end(JSON.stringify({
    kioskUrl: `http://${ip}:${localPort}/kiosk${officeIdQuery}`,
    displayUrl: `http://${ip}:${localPort}/display${officeIdQuery}`,
    localIP: ip,
  }));
}

function handleStationBranding(res: http.ServerResponse) {
  const db = getDB();
  try {
    const session = db.prepare("SELECT value FROM session WHERE key = 'current'").get() as any;
    if (!session) {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      });
      res.end('{}');
      return;
    }
    const s = JSON.parse(session.value);
    const office = db.prepare('SELECT * FROM offices WHERE id = ?').get(s.office_id) as any;
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });
    res.end(JSON.stringify({ office_name: office?.name || s.office_name, organization_id: office?.organization_id }));
  } catch {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });
    res.end('{}');
  }
}

function handleStationSSE(req: http.IncomingMessage, res: http.ServerResponse) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
  res.write('data: {"type":"connected"}\n\n');
  stationSSEClients.add(res);
  req.on('close', () => { stationSSEClients.delete(res); });
}

function handleStationBody(req: http.IncomingMessage, res: http.ServerResponse, handler: (body: any, res: http.ServerResponse) => void) {
  let body = '';
  let size = 0;
  req.on('data', (chunk) => { size += chunk.length; if (size > 8192) { req.destroy(); return; } body += chunk; });
  req.on('end', () => {
    try { handler(JSON.parse(body), res); }
    catch { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid JSON' })); }
  });
}

function handleStationUpdateTicket(body: any, res: http.ServerResponse) {
  const db = getDB();
  const { ticketId, updates } = body;
  if (!ticketId || !updates) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Missing ticketId or updates' })); return; }

  const ALLOWED = new Set(['status', 'desk_id', 'called_at', 'called_by_staff_id', 'serving_started_at', 'completed_at', 'cancelled_at', 'parked_at', 'recall_count', 'notes', 'priority']);
  const safe: Record<string, any> = {};
  for (const [k, v] of Object.entries(updates)) { if (ALLOWED.has(k)) safe[k] = v; }
  if (!Object.keys(safe).length) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('null'); return; }

  const sets = Object.entries(safe).map(([k]) => `${k} = ?`).join(', ');
  const vals = Object.values(safe);
  const prev = safe.status ? db.prepare('SELECT ticket_number, status FROM tickets WHERE id = ?').get(ticketId) as any : null;

  if (safe.status === 'called') {
    const r = db.prepare(`UPDATE tickets SET ${sets} WHERE id = ? AND status = 'waiting' RETURNING *`).get(...vals, ticketId);
    if (!r) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('null'); return; }
  } else {
    db.prepare(`UPDATE tickets SET ${sets} WHERE id = ?`).run(...vals, ticketId);
  }

  if (safe.status && prev) {
    logTicketEvent(ticketId, safe.status === 'waiting' ? 'requeued' : safe.status, {
      ticketNumber: prev.ticket_number, fromStatus: prev.status, toStatus: safe.status, source: 'station_web',
    });
  }

  const syncId = `${ticketId}-${Date.now()}`;
  db.prepare(`INSERT INTO sync_queue (id, operation, table_name, record_id, payload, created_at) VALUES (?, 'UPDATE', 'tickets', ?, ?, ?)`).run(syncId, ticketId, JSON.stringify(safe), new Date().toISOString());
  onTicketCreated?.(syncId);

  const tk = db.prepare('SELECT ticket_number FROM tickets WHERE id = ?').get(ticketId) as any;
  if (safe.status === 'called') {
    const dsk = safe.desk_id ? db.prepare('SELECT name FROM desks WHERE id = ?').get(safe.desk_id) as any : null;
    notifyDisplays({ type: 'ticket_called', ticket_number: tk?.ticket_number, desk_name: dsk?.name, timestamp: new Date().toISOString() });
  } else { notifyDisplays({ type: 'data_refreshed', timestamp: new Date().toISOString() }); }
  notifyStationClients({ type: 'tickets_changed' });

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ id: ticketId, ...safe }));
}

async function handleStationCallNext(body: any, res: http.ServerResponse) {
  const db = getDB();
  const { officeId, deskId, staffId } = body;
  if (!officeId || !deskId || !staffId) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Missing fields' })); return; }

  const now = new Date().toISOString();
  let ticket: any = null;
  let syncId = '';

  db.transaction(() => {
    const candidates = db.prepare(`SELECT id FROM tickets WHERE office_id = ? AND status = 'waiting' AND parked_at IS NULL ORDER BY priority DESC, created_at ASC LIMIT 10`).all(officeId) as any[];
    for (const c of candidates) {
      ticket = db.prepare(`UPDATE tickets SET status = 'called', desk_id = ?, called_by_staff_id = ?, called_at = ? WHERE id = ? AND status = 'waiting' RETURNING *`).get(deskId, staffId, now, c.id) as any;
      if (ticket) {
        syncId = `${ticket.id}-call-${Date.now()}`;
        db.prepare(`INSERT INTO sync_queue (id, operation, table_name, record_id, payload, created_at) VALUES (?, 'CALL', 'tickets', ?, ?, ?)`)
          .run(syncId, ticket.id, JSON.stringify({ status: 'called', desk_id: deskId, called_by_staff_id: staffId, called_at: now }), now);
        logTicketEvent(ticket.id, 'called', { ticketNumber: ticket.ticket_number, fromStatus: 'waiting', toStatus: 'called', source: 'station_web', details: { deskId, staffId } });
        break;
      }
    }
  })();

  if (!ticket) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('null'); return; }

  onTicketCreated?.(syncId);
  const desk = db.prepare('SELECT name FROM desks WHERE id = ?').get(deskId) as any;
  notifyDisplays({ type: 'ticket_called', ticket_number: ticket.ticket_number, desk_name: desk?.name ?? deskId, timestamp: now });
  notifyStationClients({ type: 'tickets_changed' });

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(ticket));
}
