import http from 'http';
import { networkInterfaces } from 'os';
import { getDB, generateOfflineTicketNumber } from './db';
import { randomUUID } from 'crypto';

let isCloudReachable = false;
const CLOUD_URL = 'https://qflow-sigma.vercel.app';
const SUPABASE_URL = 'https://ofyyzuocifigyyhqxxqw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9meXl6dW9jaWZpZ3l5aHF4eHF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyNjcwNDMsImV4cCI6MjA4ODg0MzA0M30.WzFn3aNgu7amI8ddplcnJJeD2Kilfy-HrsxrFTAWgeQ';

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
        // Smart proxy: online → redirect to cloud kiosk, offline → local page
        const db = getDB();
        const office = db.prepare('SELECT * FROM offices LIMIT 1').get() as any;
        const slug = office?.settings ? (JSON.parse(office.settings)?.platform_office_slug ?? '') : '';

        if (isCloudReachable && slug) {
          res.writeHead(302, { Location: `${CLOUD_URL}/kiosk/${slug}` });
          res.end();
        } else {
          serveKioskPage(res);
        }
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
      } else if (path === '/api/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', version: '1.0.0' }));
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
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    try {
      const { officeId, departmentId, serviceId, customerName, customerPhone } = JSON.parse(body);

      if (!officeId || !departmentId || !serviceId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing required fields' }));
        return;
      }

      const db = getDB();

      // Get department code for ticket number
      const dept = db.prepare('SELECT code FROM departments WHERE id = ?').get(departmentId) as any;
      const deptCode = dept?.code ?? 'Q';

      // Generate offline ticket number
      const ticketNumber = generateOfflineTicketNumber(officeId, deptCode);
      const ticketId = randomUUID();
      const now = new Date().toISOString();

      const customerData = JSON.stringify({
        name: customerName || null,
        phone: customerPhone || null,
      });

      // Insert ticket locally
      db.prepare(`
        INSERT INTO tickets (id, ticket_number, office_id, department_id, service_id, status, priority, customer_data, created_at, is_offline)
        VALUES (?, ?, ?, ?, ?, 'waiting', 0, ?, ?, 1)
      `).run(ticketId, ticketNumber, officeId, departmentId, serviceId, customerData, now);

      // Queue for cloud sync
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
          customer_data: { name: customerName || null, phone: customerPhone || null },
          created_at: now,
        }),
        now
      );

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
  const officeName = office?.name ?? 'QueueFlow';

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
        document.getElementById('app').innerHTML = '<div style="color:white;padding:48px;text-align:center;font-size:18px">Cannot connect to QueueFlow Station.<br><span style="font-size:14px;opacity:0.7;margin-top:8px;display:block">Make sure the desktop app is running on this network.</span></div>';
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
      var name = state.office?.name ?? 'QueueFlow';

      var header = '<div class="kiosk-header">' +
        '<div class="kiosk-logo"><span>Q</span></div>' +
        '<h1>' + (state.orgName || name) + '</h1>' +
        (state.orgName && state.orgName !== name ? '<div class="subtitle">' + name + '</div>' : '<div class="subtitle">Take a ticket to join the queue</div>') +
        '<div class="offline-badge">Offline Mode — Connected locally</div>' +
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
        var trackLocal = API + '/track/' + encodeURIComponent(t.ticket_number);
        var qrHtml = makeQR(trackUrl, 3) || makeQR(trackLocal, 3);

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
          '<div class="result-timer">This screen resets automatically in 20 seconds</div>' +
          '</div>' +
          '<button class="btn btn-white" onclick="reset()">Take Another Ticket</button>' +
          '</div>';
      }
    }

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

  // When online, fetch live data from Supabase for real-time accuracy
  if (isCloudReachable) {
    try {
      const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const todayISO = today.toISOString();

      const [ticketsRes, servedRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/tickets?office_id=eq.${office.id}&status=in.(called,serving,waiting)&created_at=gte.${todayISO}&order=called_at.desc`, { headers, signal: AbortSignal.timeout(5000) }),
        fetch(`${SUPABASE_URL}/rest/v1/tickets?office_id=eq.${office.id}&status=eq.served&created_at=gte.${todayISO}&select=id`, { headers, signal: AbortSignal.timeout(5000) }),
      ]);

      if (ticketsRes.ok && servedRes.ok) {
        const tickets = await ticketsRes.json();
        const served = await servedRes.json();

        // Get desk names from local cache
        const nowServing = tickets
          .filter((t: any) => t.status === 'called' || t.status === 'serving')
          .map((t: any) => {
            const desk = t.desk_id ? db.prepare("SELECT name FROM desks WHERE id = ?").get(t.desk_id) as any : null;
            return { id: t.id, ticket_number: t.ticket_number, status: t.status, desk_id: t.desk_id, desk_name: desk?.name ?? null, department_id: t.department_id, called_at: t.called_at };
          });

        const waitingCount = tickets.filter((t: any) => t.status === 'waiting').length;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          office_name: office.name,
          now_serving: nowServing,
          waiting_count: waitingCount,
          served_count: served.length,
        }));
        return;
      }
    } catch {
      // Fall through to SQLite
    }
  }

  // Offline fallback: use local SQLite
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString();

  const nowServing = db.prepare(`
    SELECT t.ticket_number, t.status, d.name as desk_name
    FROM tickets t LEFT JOIN desks d ON d.id = t.desk_id
    WHERE t.office_id = ? AND t.status IN ('called', 'serving') AND t.created_at >= ?
    ORDER BY t.called_at DESC
  `).all(office.id, todayISO) as any[];

  const waitingCount = db.prepare(
    "SELECT COUNT(*) as c FROM tickets WHERE office_id = ? AND status = 'waiting' AND created_at >= ?"
  ).get(office.id, todayISO) as any;

  const servedCount = db.prepare(
    "SELECT COUNT(*) as c FROM tickets WHERE office_id = ? AND status = 'served' AND created_at >= ?"
  ).get(office.id, todayISO) as any;

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    office_name: office.name,
    now_serving: nowServing,
    waiting_count: waitingCount?.c ?? 0,
    served_count: servedCount?.c ?? 0,
  }));
}

// ── Tracking Page ─────────────────────────────────────────────────

function serveTrackingPage(ticketNumber: string, res: http.ServerResponse) {
  const ip = getLocalIP();
  const apiBase = `http://${ip}:${localPort}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Track Ticket — QueueFlow</title>
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
    <div class="brand">QueueFlow</div>
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
          '<div class="brand">QueueFlow</div>' +
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
          '<div class="brand">QueueFlow</div>' +
          '<div style="color:#ef4444;font-weight:600">Ticket not found</div>' +
          '<div style="color:#94a3b8;font-size:13px;margin-top:8px">Make sure you\\'re on the same network as the QueueFlow station.</div>';
      }
    }

    load();
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
  <title>QueueFlow Display</title>
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
      <div class="header-right">
        <div class="clock" id="clock"></div>
        <div class="date" id="date"></div>
      </div>
    </div>

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
    var SUPABASE_URL = '${SUPABASE_URL}';
    var SUPABASE_KEY = '${SUPABASE_KEY}';
    var lastServingHash = '';
    var lastQueueHash = '';
    var activeDept = 'all';
    var allTickets = [];
    var departments = {};
    var desks = {};
    var chimeAudio = null;

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
      try {
        // Try Supabase directly for real-time accuracy
        var headers = { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY };
        var today = new Date(); today.setHours(0,0,0,0);

        var officeRes = await fetch(API + '/api/kiosk-info');
        var officeData = await officeRes.json();
        if (officeData.office) {
          // Show org name as primary, office/branch as secondary
          var orgName = officeData.org_name || officeData.office.name;
          var branchName = officeData.org_name ? officeData.office.name : '';
          updateText('office-name', orgName);
          updateText('branch-name', branchName);
          (officeData.departments || []).forEach(function(d) { departments[d.id] = d.name; });

          // Set logo if available from org settings
          if (officeData.logo_url) {
            var logoEl = document.getElementById('logo');
            if (logoEl && !logoEl.querySelector('img')) {
              logoEl.className = 'logo';
              logoEl.innerHTML = '<img src="' + officeData.logo_url + '" alt="Logo">';
            }
          }
        }

        var ticketsRes = await fetch(SUPABASE_URL + '/rest/v1/tickets?office_id=eq.' + officeData.office.id + '&created_at=gte.' + today.toISOString() + '&order=priority.desc.nullsfirst,created_at.asc&limit=300', { headers: headers, signal: AbortSignal.timeout(5000) });

        if (!ticketsRes.ok) throw new Error('API error');
        var tickets = await ticketsRes.json();
        allTickets = tickets;

        // Parse customer_data
        tickets.forEach(function(t) {
          if (typeof t.customer_data === 'string') try { t.customer_data = JSON.parse(t.customer_data); } catch(e) { t.customer_data = {}; }
        });

        // Get desk names
        var desksRes = await fetch(SUPABASE_URL + '/rest/v1/desks?office_id=eq.' + officeData.office.id + '&select=id,name', { headers: headers, signal: AbortSignal.timeout(5000) });
        if (desksRes.ok) {
          var deskList = await desksRes.json();
          deskList.forEach(function(d) { desks[d.id] = d.name; });
        }

        var waiting = tickets.filter(function(t) { return t.status === 'waiting'; });
        var called = tickets.filter(function(t) { return t.status === 'called'; });
        var serving = tickets.filter(function(t) { return t.status === 'serving'; });
        var served = tickets.filter(function(t) { return t.status === 'served'; });

        updateText('s-waiting', waiting.length);
        updateText('s-called', called.length);
        updateText('s-serving', serving.length);
        updateText('s-served', served.length);

        lastActive = [...called, ...serving];
        renderServing(lastActive);
        renderQueue(waiting);
      } catch(e) {
        // Fallback to local API
        try {
          var res = await fetch(API + '/api/display-data');
          var d = await res.json();
          if (!d.error) {
            updateText('office-name', d.office_name);
            updateText('s-waiting', d.waiting_count);
            updateText('s-served', d.served_count);
            lastActive = d.now_serving || [];
            renderServing(lastActive);
          }
        } catch(e2) {}
      }
    }

    // Clock + countdown updates every second
    var lastActive = [];
    function tick() {
      updateClock();
      // Re-render serving panel for countdown updates
      if (lastActive.length > 0) renderServing(lastActive);
    }
    setInterval(tick, 1000);
    tick();

    // Data refresh every 2 seconds
    var origFetch = fetchData;
    async function fetchAndStore() {
      await origFetch();
    }
    fetchAndStore();
    setInterval(fetchAndStore, 2000);
  <\/script>
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}
