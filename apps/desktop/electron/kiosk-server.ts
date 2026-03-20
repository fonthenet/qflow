import http from 'http';
import { networkInterfaces } from 'os';
import { getDB, generateOfflineTicketNumber } from './db';
import { randomUUID } from 'crypto';
import { CONFIG } from './config';

let isCloudReachable = false;
let onTicketCreated: ((syncQueueId: string) => void) | null = null;
export function setOnTicketCreated(cb: (syncQueueId: string) => void) { onTicketCreated = cb; }

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

// ── Device tracking ───────────────────────────────────────────────
interface DeviceInfo { id: string; type: string; name: string; lastPing: number; }
const devices: Map<string, DeviceInfo> = new Map();
// Station (this PC) is always present
devices.set('station', { id: 'station', type: 'station', name: 'Qflo Station', lastPing: Date.now() });
// Update station heartbeat every 10s
setInterval(() => { const d = devices.get('station'); if (d) d.lastPing = Date.now(); }, 10000);
const { CLOUD_URL, SUPABASE_URL } = CONFIG;
const SUPABASE_KEY = CONFIG.SUPABASE_ANON_KEY;

// Check cloud connectivity every 15s
setInterval(async () => {
  try {
    const res = await fetch(`${CLOUD_URL}/api/queue-status?slug=test`, { signal: AbortSignal.timeout(5000) });
    isCloudReachable = res.status !== 0; // Any response = reachable (even 404)
  } catch { isCloudReachable = false; }
}, 15_000);
// Initial check
setTimeout(async () => {
  try {
    const res = await fetch(`${CLOUD_URL}/api/queue-status?slug=test`, { signal: AbortSignal.timeout(5000) });
    isCloudReachable = res.status !== 0;
  } catch { isCloudReachable = false; }
}, 1000);

let server: http.Server | null = null;
let localPort = 3847;

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
        // Always serve local kiosk — it works offline and registers as a device
        serveKioskPage(res);
      } else if (path === '/display' && req.method === 'GET') {
        serveDisplayPage(res);
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
        res.end(JSON.stringify({ status: 'ok', version: '1.0.0' }));
      } else if (path === '/api/debug-tickets' && req.method === 'GET') {
        const ddb = getDB();
        const all = ddb.prepare("SELECT ticket_number, status, is_offline, created_at FROM tickets ORDER BY created_at DESC LIMIT 20").all();
        const syncQ = ddb.prepare("SELECT record_id, operation, synced_at FROM sync_queue WHERE table_name = 'tickets' ORDER BY created_at DESC LIMIT 20").all();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ tickets: all, sync_queue: syncQ }, null, 2));
      } else if (path === '/api/device-ping' && req.method === 'POST') {
        handleDevicePing(req, res);
      } else if (path === '/api/device-status' && req.method === 'GET') {
        handleDeviceStatus(res);
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
      if (err.code === 'EADDRINUSE') {
        // Try next port
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

// ── API Handlers ──────────────────────────────────────────────────

async function handleKioskInfo(url: URL, res: http.ServerResponse) {
  const db = getDB();
  const officeId = url.searchParams.get('officeId');

  const office = officeId
    ? db.prepare('SELECT * FROM offices WHERE id = ?').get(officeId) as any
    : db.prepare('SELECT * FROM offices LIMIT 1').get() as any;

  if (!office) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'No office configured' }));
    return;
  }

  const departments = db.prepare('SELECT * FROM departments WHERE office_id = ?').all(office.id);
  const services = db.prepare('SELECT * FROM services WHERE department_id IN (SELECT id FROM departments WHERE office_id = ?)').all(office.id);

  // Try to get org name + logo from Supabase
  let logoUrl: string | null = null;
  let orgName: string | null = null;
  if (isCloudReachable && office.organization_id) {
    try {
      const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
      const orgRes = await fetch(`${SUPABASE_URL}/rest/v1/organizations?id=eq.${office.organization_id}&select=name,logo_url,settings`, { headers, signal: AbortSignal.timeout(3000) });
      if (orgRes.ok) {
        const orgs = await orgRes.json();
        orgName = orgs[0]?.name ?? null;
        logoUrl = orgs[0]?.logo_url ?? orgs[0]?.settings?.logo_url ?? null;
      }
    } catch { /* ignore */ }
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ office, departments, services, logo_url: logoUrl, org_name: orgName }));
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
  req.on('end', () => {
    try {
      if (size > MAX_BODY) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request too large' }));
        return;
      }
      const { officeId, departmentId, serviceId, customerName, customerPhone } = JSON.parse(body);

      if (!officeId || !departmentId || !serviceId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing required fields' }));
        return;
      }

      // Input sanitization
      const safeName = typeof customerName === 'string' ? customerName.slice(0, 200).trim() : null;
      const safePhone = typeof customerPhone === 'string' ? customerPhone.replace(/[^\d+\-() ]/g, '').slice(0, 30) : null;

      const db = getDB();

      // Get department code for ticket number
      const dept = db.prepare('SELECT code FROM departments WHERE id = ?').get(departmentId) as any;
      const deptCode = dept?.code ?? 'Q';

      // Generate offline ticket number
      const ticketNumber = generateOfflineTicketNumber(officeId, deptCode);
      const ticketId = randomUUID();
      const now = new Date().toISOString();
      // Generate qr_token for cloud tracking (12 char random string)
      const qrToken = randomUUID().replace(/-/g, '').slice(0, 12);
      // Daily sequence: count today's tickets for this office + 1
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const seqRow = db.prepare(
        "SELECT COUNT(*) as c FROM tickets WHERE office_id = ? AND created_at >= ?"
      ).get(officeId, todayStart.toISOString()) as any;
      const dailySequence = (seqRow?.c ?? 0) + 1;

      const customerData = JSON.stringify({
        name: safeName || null,
        phone: safePhone || null,
      });

      // Transaction: ticket insert + sync queue insert are atomic (crash-safe)
      db.transaction(() => {
        db.prepare(`
          INSERT INTO tickets (id, ticket_number, office_id, department_id, service_id, status, priority, customer_data, created_at, is_offline)
          VALUES (?, ?, ?, ?, ?, 'waiting', 0, ?, ?, 1)
        `).run(ticketId, ticketNumber, officeId, departmentId, serviceId, customerData, now);

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
            customer_data: { name: safeName || null, phone: safePhone || null },
            created_at: now,
            qr_token: qrToken,
            daily_sequence: dailySequence,
          }),
          now
        );
      })();

      notifyDisplays({ type: 'ticket_created', ticket_number: ticketNumber, timestamp: now });
      onTicketCreated?.(ticketId + '-create');

      // Count position
      const position = db.prepare(`
        SELECT COUNT(*) as pos FROM tickets
        WHERE office_id = ? AND department_id = ? AND status = 'waiting'
        AND created_at <= ? AND parked_at IS NULL
      `).get(officeId, departmentId, now) as any;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ticket: {
          id: ticketId,
          ticket_number: ticketNumber,
          status: 'waiting',
          position: position?.pos ?? 1,
          created_at: now,
        },
      }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
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

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    waiting: waiting?.c ?? 0,
    called: called?.c ?? 0,
    serving: serving?.c ?? 0,
    served: served?.c ?? 0,
  }));
}

// ── Kiosk HTML Page (Offline Fallback — matches web kiosk design) ──

function serveKioskPage(res: http.ServerResponse) {
  const ip = getLocalIP();
  const apiBase = `http://${ip}:${localPort}`;
  const db = getDB();
  const office = db.prepare('SELECT * FROM offices LIMIT 1').get() as any;
  const officeName = office?.name ?? 'Qflo';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>${officeName} — Take a Ticket</title>
  <script src="https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js"><\/script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #0f172a; min-height: 100vh; }

    .kiosk { display: flex; flex-direction: column; align-items: center; min-height: 100vh; padding: 32px 24px; }

    .kiosk-header { text-align: center; margin-bottom: 40px; }
    .kiosk-logo { width: 72px; height: 72px; background: white; border-radius: 20px; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; box-shadow: 0 8px 32px rgba(0,0,0,0.15); }
    .kiosk-logo span { font-size: 36px; font-weight: 900; color: #3b82f6; }
    .kiosk-header h1 { font-size: 28px; font-weight: 800; color: white; text-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .kiosk-header .subtitle { font-size: 16px; color: rgba(255,255,255,0.8); margin-top: 4px; }
    .offline-badge { display: inline-block; padding: 4px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; margin-top: 10px; background: rgba(255,255,255,0.2); color: white; backdrop-filter: blur(4px); }

    .step { width: 100%; max-width: 640px; }
    .step-title { font-size: 20px; font-weight: 700; margin-bottom: 20px; text-align: center; color: white; }

    .card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; }
    .card {
      background: white; border-radius: 16px; padding: 28px 20px; text-align: center;
      font-size: 17px; font-weight: 700; color: #1e293b; cursor: pointer;
      transition: all 0.2s; box-shadow: 0 4px 16px rgba(0,0,0,0.08);
      border: 2px solid transparent;
    }
    .card:hover { transform: translateY(-4px); box-shadow: 0 8px 32px rgba(0,0,0,0.12); border-color: #3b82f6; }
    .card:active { transform: translateY(0); }
    .card-icon { font-size: 32px; margin-bottom: 8px; }
    .card-count { font-size: 12px; color: #94a3b8; margin-top: 4px; font-weight: 500; }

    .form-card { background: white; border-radius: 20px; padding: 36px 32px; box-shadow: 0 8px 32px rgba(0,0,0,0.1); }
    .form-group { margin-bottom: 20px; }
    .form-group label { display: block; font-size: 14px; font-weight: 600; color: #64748b; margin-bottom: 8px; }
    .form-group input { width: 100%; padding: 16px 18px; border: 2px solid #e2e8f0; border-radius: 12px; font-size: 17px; outline: none; transition: border-color 0.15s; }
    .form-group input:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.1); }

    .btn { display: block; width: 100%; padding: 18px; border: none; border-radius: 14px; font-size: 18px; font-weight: 700; cursor: pointer; transition: all 0.15s; }
    .btn-primary { background: #3b82f6; color: white; box-shadow: 0 4px 16px rgba(59,130,246,0.3); }
    .btn-primary:hover { background: #2563eb; transform: translateY(-1px); }
    .btn-ghost { background: transparent; color: rgba(255,255,255,0.7); margin-top: 12px; border: 1px solid rgba(255,255,255,0.2); }
    .btn-ghost:hover { background: rgba(255,255,255,0.1); color: white; }
    .btn-white { background: white; color: #3b82f6; margin-top: 16px; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .result-card { text-align: center; background: white; border-radius: 24px; padding: 48px 32px; box-shadow: 0 12px 48px rgba(0,0,0,0.12); }
    .result-check { width: 72px; height: 72px; background: #22c55e; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; }
    .result-check svg { width: 36px; height: 36px; fill: white; }
    .result-number { font-size: 64px; font-weight: 900; color: #1e293b; letter-spacing: -3px; line-height: 1; }
    .result-position { font-size: 18px; color: #64748b; margin-top: 8px; font-weight: 600; }
    .result-divider { height: 1px; background: #e2e8f0; margin: 24px 0; }
    .qr-section { display: flex; align-items: center; gap: 16px; text-align: left; padding: 16px; background: #f0f9ff; border-radius: 12px; }
    .qr-section .qr-box { flex-shrink: 0; }
    .qr-section .qr-text { font-size: 13px; color: #475569; }
    .qr-section .qr-text strong { color: #1e40af; display: block; margin-bottom: 4px; }
    .result-timer { font-size: 13px; color: #94a3b8; margin-top: 16px; }

    .back-btn { display: inline-flex; align-items: center; gap: 6px; color: rgba(255,255,255,0.7); font-weight: 600; font-size: 14px; cursor: pointer; margin-bottom: 16px; }
    .back-btn:hover { color: white; }

    @media (max-width: 480px) {
      .kiosk { padding: 20px 16px; }
      .card-grid { grid-template-columns: 1fr 1fr; gap: 12px; }
      .card { padding: 20px 12px; font-size: 15px; }
      .result-number { font-size: 48px; }
      .qr-section { flex-direction: column; text-align: center; }
    }
  </style>
</head>
<body>
  <div class="kiosk" id="app">
    <div style="color:white;padding:48px;text-align:center">Loading...</div>
  </div>

  <script>
    const API = '${apiBase}';
    const CLOUD = '${CLOUD_URL}';
    let state = { step: 'loading', office: null, orgName: null, departments: [], services: [], selectedDept: null, selectedService: null, ticket: null };
    let resetTimer = null;

    function makeQR(text, size) {
      try {
        var qr = qrcode(0, 'M');
        qr.addData(text);
        qr.make();
        return qr.createSvgTag({ cellSize: size || 3, margin: 0 });
      } catch { return ''; }
    }

    async function init() {
      try {
        const res = await fetch(API + '/api/kiosk-info');
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        state.office = data.office;
        state.orgName = data.org_name || null;
        state.departments = data.departments;
        state.services = data.services;
        state.step = state.departments.length === 1 ? (function() { state.selectedDept = state.departments[0]; var svcs = state.services.filter(function(s){return s.department_id===state.departments[0].id}); return svcs.length === 1 ? (state.selectedService = svcs[0], 'customer') : 'service'; })() : 'department';
        render();
      } catch (err) {
        document.getElementById('app').innerHTML = '<div style="color:white;padding:48px;text-align:center;font-size:18px">Cannot connect to Qflo Station.<br><span style="font-size:14px;opacity:0.7;margin-top:8px;display:block">Make sure the desktop app is running on this network.</span></div>';
      }
    }

    function selectDept(dept) {
      state.selectedDept = dept;
      var deptServices = state.services.filter(function(s){return s.department_id === dept.id});
      if (deptServices.length === 1) { state.selectedService = deptServices[0]; state.step = 'customer'; }
      else { state.step = 'service'; }
      render();
    }

    function selectService(svc) { state.selectedService = svc; state.step = 'customer'; render(); }

    async function takeTicket(skip) {
      var nameInput = document.getElementById('cname');
      var phoneInput = document.getElementById('cphone');
      var btn = document.getElementById('submit-btn');
      if (btn) { btn.disabled = true; btn.textContent = 'Creating...'; }
      try {
        var res = await fetch(API + '/api/take-ticket', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            officeId: state.office.id, departmentId: state.selectedDept.id,
            serviceId: state.selectedService.id,
            customerName: skip ? '' : (nameInput?.value || ''),
            customerPhone: skip ? '' : (phoneInput?.value || ''),
          }),
        });
        var data = await res.json();
        if (data.error) throw new Error(data.error);
        state.ticket = data.ticket;
        state.step = 'done';
        render();
        resetTimer = setTimeout(reset, 20000);
      } catch (err) {
        if (btn) { btn.disabled = false; btn.textContent = 'Get Ticket'; }
        alert('Error: ' + err.message);
      }
    }

    function reset() {
      if (resetTimer) clearTimeout(resetTimer);
      state.step = state.departments.length === 1 ? 'service' : 'department';
      state.selectedDept = state.departments.length === 1 ? state.departments[0] : null;
      state.selectedService = null;
      state.ticket = null;
      render();
    }

    function render() {
      var app = document.getElementById('app');
      var name = state.office?.name ?? 'Qflo';

      var header = '<div class="kiosk-header">' +
        '<div class="kiosk-logo"><span>Q</span></div>' +
        '<h1>' + (state.orgName || name) + '</h1>' +
        (state.orgName && state.orgName !== name ? '<div class="subtitle">' + name + '</div>' : '<div class="subtitle">Take a ticket to join the queue</div>') +
        '<div class="offline-badge" id="kiosk-conn">Local Mode — Tickets sync when online</div>' +
        '</div>';

      if (state.step === 'department') {
        var cards = state.departments.map(function(d) {
          return '<div class="card" onclick="selectDept(' + JSON.stringify(d).replace(/"/g, '&quot;') + ')">' +
            '<div class="card-icon">🏥</div>' + d.name + '</div>';
        }).join('');
        app.innerHTML = header + '<div class="step"><div class="step-title">Select Department</div><div class="card-grid">' + cards + '</div></div>';

      } else if (state.step === 'service') {
        var svcs = state.services.filter(function(s){return s.department_id === state.selectedDept.id});
        var cards = svcs.map(function(s) {
          return '<div class="card" onclick="selectService(' + JSON.stringify(s).replace(/"/g, '&quot;') + ')">' +
            '<div class="card-icon">📋</div>' + s.name + '</div>';
        }).join('');
        app.innerHTML = header + '<div class="step">' +
          '<div class="back-btn" onclick="state.step=\\'department\\';render();">← Back</div>' +
          '<div class="step-title">Select Service</div><div class="card-grid">' + cards + '</div></div>';

      } else if (state.step === 'customer') {
        app.innerHTML = header + '<div class="step">' +
          '<div class="back-btn" onclick="state.step=\\'service\\';render();">← Back</div>' +
          '<div class="form-card">' +
          '<div style="text-align:center;font-size:20px;font-weight:700;margin-bottom:24px">Your Information</div>' +
          '<div class="form-group"><label>Name (optional)</label><input id="cname" placeholder="Enter your name" autocomplete="off"></div>' +
          '<div class="form-group"><label>Phone (optional)</label><input id="cphone" placeholder="Phone number" type="tel" autocomplete="off"></div>' +
          '<button id="submit-btn" class="btn btn-primary" onclick="takeTicket(false)">Get Ticket</button>' +
          '</div>' +
          '<button class="btn btn-ghost" onclick="takeTicket(true)">Skip — Just give me a number</button>' +
          '</div>';

      } else if (state.step === 'done') {
        var t = state.ticket;
        var trackUrl = CLOUD + '/ticket/' + t.id;
        var qrHtml = makeQR(trackUrl, 3);

        app.innerHTML = header.replace('Take a ticket to join the queue', 'Your ticket is ready') + '<div class="step">' +
          '<div class="result-card">' +
          '<div class="result-check"><svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></div>' +
          '<div class="result-number">' + t.ticket_number + '</div>' +
          '<div class="result-position">#' + t.position + ' in queue</div>' +
          '<div class="result-divider"></div>' +
          '<div class="qr-section">' +
          '<div class="qr-box">' + qrHtml + '</div>' +
          '<div class="qr-text"><strong>Track on your phone</strong>Scan this QR code to track your position remotely from anywhere. You will be notified when it is your turn.</div>' +
          '</div>' +
          '<div style="margin-top:12px;font-size:11px;color:#94a3b8;word-break:break-all"><a href="' + trackUrl + '" style="color:#3b82f6;text-decoration:none">' + trackUrl + '</a></div>' +
          '<div class="result-timer">This screen resets automatically in 20 seconds</div>' +
          '</div>' +
          '<button class="btn btn-white" onclick="reset()">Take Another Ticket</button>' +
          '</div>';
      }
    }

    // Device ping — register this kiosk
    var kioskId = 'kiosk-' + Math.random().toString(36).substr(2, 6);
    function pingKiosk() {
      fetch(API + '/api/device-ping', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ id: kioskId, type: 'kiosk', name: 'Local Kiosk' })
      }).catch(function(){});
    }
    pingKiosk();
    setInterval(pingKiosk, 15000);

    init();
  <\/script>
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
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
  const officeId = url.searchParams.get('officeId');

  const office = officeId
    ? db.prepare("SELECT * FROM offices WHERE id = ?").get(officeId) as any
    : db.prepare("SELECT * FROM offices LIMIT 1").get() as any;

  if (!office) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'No office found' }));
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

  res.writeHead(200, { 'Content-Type': 'application/json' });
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
      const { id, type, name } = JSON.parse(body);
      if (id && type) {
        devices.set(id, { id, type, name: name ?? type, lastPing: Date.now() });
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
  const TIMEOUT = 30_000; // 30s = considered disconnected
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
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Track Ticket — Qflo</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: #f8fafc; color: #0f172a; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
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
          '<div class="refresh">Auto-refreshes every 5 seconds</div>';
      } catch (err) {
        document.getElementById('app').innerHTML =
          '<div class="brand">Qflo</div>' +
          '<div style="color:#ef4444;font-weight:600">Ticket not found</div>' +
          '<div style="color:#94a3b8;font-size:13px;margin-top:8px">Make sure you\\'re on the same network as the Qflo station.</div>';
      }
    }

    load();
    // Live updates via SSE
    var es = new EventSource(API + '/api/events');
    es.onmessage = function(e) { if (e.data === 'update') load(); };
    es.onerror = function() { es.close(); setTimeout(function(){ es = new EventSource(API + '/api/events'); es.onmessage = function(e){ if(e.data==='update') load(); }; }, 3000); };
    setInterval(load, 5000);
  </script>
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

// ── Display Page (Waiting Room TV) ────────────────────────────────

function serveDisplayPage(res: http.ServerResponse) {
  const ip = getLocalIP();
  const apiBase = `http://${ip}:${localPort}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Qflo Display</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
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
    .queue-row { display: flex; align-items: center; padding: 16px 20px; border-radius: 12px; margin-bottom: 6px; background: white; border: 2px solid #e2e8f0; transition: all 0.3s; }
    .queue-row.next { background: #fef9c3; border-color: #fde68a; border-width: 3px; }
    .queue-row .pos { font-size: 22px; font-weight: 900; color: #94a3b8; min-width: 50px; text-align: center; }
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

    /* ── Audio chime (hidden) ── */
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); }
  </style>
</head>
<body>
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

    function updateClock() {
      var now = new Date();
      updateText('clock', now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      updateText('date', now.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }));
    }

    var CALL_TIMEOUT = 60;
    var prevCalledIds = [];

    function getCountdown(calledAt) {
      if (!calledAt) return CALL_TIMEOUT;
      var elapsed = Math.floor((Date.now() - new Date(calledAt).getTime()) / 1000);
      return Math.max(0, CALL_TIMEOUT - elapsed);
    }

    function renderServing(active) {
      // Check for newly called tickets (for chime)
      var currentCalledIds = active.filter(function(t){return t.status==='called'}).map(function(t){return t.id});
      var hasNew = currentCalledIds.some(function(id) { return prevCalledIds.indexOf(id) === -1; });
      if (hasNew && prevCalledIds.length > 0) playChime();
      prevCalledIds = currentCalledIds;

      var el = document.getElementById('serving-list');
      if (active.length === 0) {
        el.innerHTML = '<div class="no-active">Waiting for customers...</div>';
        lastServingHash = '';
        return;
      }

      // Filter out expired called tickets (countdown <= 0)
      var visible = active.filter(function(t) {
        if (t.status !== 'called') return true;
        return getCountdown(t.called_at) > 0;
      });

      if (visible.length === 0) {
        el.innerHTML = '<div class="no-active">Waiting for customers...</div>';
        lastServingHash = '';
        return;
      }

      // Always re-render called tickets (countdown changes every second)
      el.innerHTML = visible.map(function(t) {
        var deskName = desks[t.desk_id] || t.desk_name || 'Desk';
        var deptName = departments[t.department_id] || '';

        if (t.status === 'called') {
          var secs = getCountdown(t.called_at);
          var urgency = secs <= 10 ? 'urgent' : secs <= 20 ? 'warning' : 'normal';
          return '<div class="serving-row called">' +
            '<div class="ticket-num">' + t.ticket_number + '</div>' +
            '<div class="arrow">&rarr;</div>' +
            '<div class="desk-info"><div class="desk-name">' + deskName + '</div>' +
            (deptName ? '<div class="dept-name">' + deptName + '</div>' : '') + '</div>' +
            '<div class="countdown ' + urgency + '">' + secs + 's</div>' +
            '<div class="status-pill">Please Proceed</div>' +
            '</div>';
        }

        return '<div class="serving-row serving">' +
          '<div class="ticket-num">' + t.ticket_number + '</div>' +
          '<div class="arrow">&rarr;</div>' +
          '<div class="desk-info"><div class="desk-name">' + deskName + '</div>' +
          (deptName ? '<div class="dept-name">' + deptName + '</div>' : '') + '</div>' +
          '<div class="status-pill">Serving</div>' +
          '</div>';
      }).join('');
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
        if (lastQueueHash !== hash) el.innerHTML = '<div class="queue-empty">No customers in queue</div>';
        lastQueueHash = hash;
        return;
      }

      if (hash === lastQueueHash) return;
      lastQueueHash = hash;

      el.innerHTML = filtered.map(function(t, i) {
        var name = t.customer_data?.name || 'Walk-in';
        var isNext = i === 0;
        var badges = '';
        if (t.priority > 1) badges += '<span class="q-badge priority">P' + t.priority + '</span> ';
        if (t.appointment_id) badges += '<span class="q-badge booked">Booked</span>';
        var deptLabel = departments[t.department_id] || '';
        return '<div class="queue-row' + (isNext ? ' next' : '') + '">' +
          '<div class="pos">#' + (i+1) + '</div>' +
          '<div class="q-ticket">' + t.ticket_number + '</div>' +
          '<div class="q-name">' + name + (deptLabel ? ' <span style="color:#94a3b8;font-size:13px">&middot; ' + deptLabel + '</span>' : '') + '</div>' +
          badges +
          '<div class="q-wait">' + formatWait(t.created_at) + '</div>' +
          '</div>';
      }).join('');
    }

    async function fetchData() {
      // ALWAYS read from local SQLite via the kiosk-server API.
      // The station's sync engine keeps SQLite in sync with the cloud.
      // Reading Supabase directly from the display caused stale-data bugs:
      // the station updates SQLite instantly on call/serve, but those
      // changes only reach Supabase after sync — so the display would
      // show the old cloud state instead of the real local state.
      try {
        // Fetch office info (includes logo + org name)
        var officeRes = await fetch(API + '/api/kiosk-info');
        var officeData = await officeRes.json();
        if (officeData.office) {
          var orgName = officeData.org_name || officeData.office.name;
          var branchName = officeData.org_name ? officeData.office.name : '';
          updateText('office-name', orgName);
          updateText('branch-name', branchName);
          (officeData.departments || []).forEach(function(d) { departments[d.id] = d.name; });

          if (officeData.logo_url) {
            var logoEl = document.getElementById('logo');
            if (logoEl) {
              logoEl.className = 'logo';
              logoEl.style.background = 'none';
              logoEl.innerHTML = '<img src="' + officeData.logo_url + '" alt="Logo" onerror="this.parentElement.className=\\'logo fallback\\';this.parentElement.innerHTML=\\'Q\\'">';
            }
          }
        }

        // Fetch live queue data from local SQLite (always instant, always fresh)
        var res = await fetch(API + '/api/display-data');
        var d = await res.json();
        if (d.error) throw new Error(d.error);

        setConnStatus(d.cloud_connected);

        updateText('s-waiting', d.waiting_count);
        updateText('s-called', d.called_count);
        updateText('s-serving', d.serving_count);
        updateText('s-served', d.served_count);

        // Parse customer_data
        (d.waiting || []).forEach(function(t) {
          if (typeof t.customer_data === 'string') { try { t.customer_data = JSON.parse(t.customer_data); } catch(ex) { t.customer_data = {}; } }
        });

        // Cache desk + department names from the response
        (d.now_serving || []).forEach(function(t) {
          if (t.desk_id && t.desk_name) desks[t.desk_id] = t.desk_name;
          if (t.department_id && t.department_name) departments[t.department_id] = t.department_name;
        });
        (d.waiting || []).forEach(function(t) {
          if (t.department_id && t.department_name) departments[t.department_id] = t.department_name;
        });

        allTickets = [...(d.now_serving || []), ...(d.waiting || [])];
        lastActive = d.now_serving || [];
        renderServing(lastActive);
        renderQueue(d.waiting || []);
      } catch(e) {
        console.error('Display fetch error:', e);
      }
    }

    // Device ping — register this display
    var displayId = 'display-' + Math.random().toString(36).substr(2, 6);
    function pingDevice() {
      fetch(API + '/api/device-ping', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ id: displayId, type: 'display', name: 'Waiting Room Display' })
      }).catch(function(){});
    }
    pingDevice();
    setInterval(pingDevice, 15000);

    // Check device statuses and show disconnected warnings
    async function checkDevices() {
      try {
        var res = await fetch(API + '/api/device-status');
        var d = await res.json();
        var disconnected = (d.devices || []).filter(function(dev) { return !dev.connected && dev.type !== 'display'; });
        var el = document.getElementById('device-warn');
        if (disconnected.length > 0) {
          var names = disconnected.map(function(dev) { return dev.name; }).join(', ');
          if (el) { el.style.display = 'block'; el.textContent = 'Disconnected: ' + names; }
        } else {
          if (el) el.style.display = 'none';
        }
      } catch(e) {}
    }
    setInterval(checkDevices, 10000);

    // Clock + countdown updates every second
    var lastActive = [];
    function tick() {
      updateClock();
      if (lastActive.length > 0) renderServing(lastActive);
    }
    setInterval(tick, 1000);
    tick();

    // ── Live updates via SSE — instant push from station ──
    var evtSource = null;
    function connectSSE() {
      if (evtSource) { try { evtSource.close(); } catch(e){} }
      evtSource = new EventSource(API + '/api/events');
      evtSource.onmessage = function(e) {
        if (e.data === 'update' || e.data === 'connected') {
          fetchData();
          return;
        }
        try {
          var evt = JSON.parse(e.data);
          if (evt.type === 'ticket_called' && evt.ticket_number) {
            playChime();
            // Flash the called ticket in NOW SERVING after data refresh
            fetchData().then(function() {
              var rows = document.querySelectorAll('.serving-row');
              rows.forEach(function(row) {
                if (row.querySelector('.ticket-num') && row.querySelector('.ticket-num').textContent.trim() === evt.ticket_number) {
                  row.style.animation = 'none'; row.offsetHeight; row.style.animation = 'flashNew 1.5s ease-out';
                }
              });
            });
          } else {
            fetchData();
          }
        } catch(ex) { fetchData(); }
      };
      evtSource.onerror = function() {
        // Reconnect after 3s on disconnect
        try { evtSource.close(); } catch(e){}
        setTimeout(connectSSE, 3000);
      };
    }
    connectSSE();

    // Fallback poll every 5s in case SSE drops silently
    fetchData();
    setInterval(fetchData, 5000);
  <\/script>
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}
