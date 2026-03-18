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

function handleKioskInfo(url: URL, res: http.ServerResponse) {
  const db = getDB();
  const officeId = url.searchParams.get('officeId');

  if (!officeId) {
    // Return first office
    const office = db.prepare('SELECT * FROM offices LIMIT 1').get() as any;
    if (!office) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No office configured' }));
      return;
    }
    const departments = db.prepare('SELECT * FROM departments WHERE office_id = ?').all(office.id);
    const services = db.prepare('SELECT * FROM services WHERE department_id IN (SELECT id FROM departments WHERE office_id = ?)').all(office.id);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ office, departments, services }));
    return;
  }

  const office = db.prepare('SELECT * FROM offices WHERE id = ?').get(officeId) as any;
  if (!office) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Office not found' }));
    return;
  }

  const departments = db.prepare('SELECT * FROM departments WHERE office_id = ?').all(office.id);
  const services = db.prepare('SELECT * FROM services WHERE department_id IN (SELECT id FROM departments WHERE office_id = ?)').all(office.id);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ office, departments, services }));
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
    let state = { step: 'loading', office: null, departments: [], services: [], selectedDept: null, selectedService: null, ticket: null };
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
        '<h1>' + name + '</h1>' +
        '<div class="subtitle">Take a ticket to join the queue</div>' +
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
            return { ticket_number: t.ticket_number, status: t.status, desk_name: desk?.name ?? null };
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
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: #f8fafc; color: #0f172a; min-height: 100vh; overflow: hidden; }

    .display { display: flex; flex-direction: column; height: 100vh; }
    .display-header { display: flex; justify-content: space-between; align-items: center; padding: 20px 40px; background: white; border-bottom: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
    .display-brand { font-size: 24px; font-weight: 800; color: #3b82f6; }
    .display-office { font-size: 20px; font-weight: 600; color: #475569; }
    .display-stats { display: flex; gap: 24px; font-size: 16px; color: #64748b; }
    .display-stats span { font-weight: 700; }
    .display-stats .num { color: #0f172a; font-size: 20px; }

    .display-body { flex: 1; display: flex; padding: 32px 40px; gap: 32px; overflow: hidden; }

    .now-serving { flex: 2; }
    .now-serving h2 { font-size: 16px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 20px; }
    .serving-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
    .serving-card { background: white; border-radius: 16px; padding: 28px; border-left: 6px solid #22c55e; box-shadow: 0 2px 8px rgba(0,0,0,0.04); transition: opacity 0.3s; }
    .serving-card.called { border-left-color: #3b82f6; background: #eff6ff; }
    .serving-number { font-size: 56px; font-weight: 900; letter-spacing: -2px; color: #0f172a; }
    .serving-desk { font-size: 16px; color: #64748b; margin-top: 4px; font-weight: 500; }
    .serving-status { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-top: 10px; }
    .serving-status.called { color: #1e40af; background: #dbeafe; }
    .serving-status.serving { color: #065f46; background: #d1fae5; }

    .no-serving { color: #94a3b8; font-size: 20px; padding: 60px; text-align: center; }

    .display-footer { padding: 12px 40px; background: white; border-top: 1px solid #e2e8f0; text-align: center; font-size: 13px; color: #94a3b8; }

    .fade-update { animation: fadeIn 0.3s ease-out; }
    @keyframes fadeIn { from { opacity: 0.5; } to { opacity: 1; } }
  </style>
</head>
<body>
  <div class="display">
    <div class="display-header">
      <div class="display-brand">QueueFlow</div>
      <div class="display-office" id="office-name"></div>
      <div class="display-stats">
        <div>Waiting: <span class="num" id="stat-waiting">0</span></div>
        <div>Served today: <span class="num" id="stat-served">0</span></div>
      </div>
    </div>
    <div class="display-body">
      <div class="now-serving">
        <h2>Now Serving</h2>
        <div class="serving-grid" id="serving-grid">
          <div class="no-serving">No customers being served</div>
        </div>
      </div>
    </div>
    <div class="display-footer">
      <span id="time"></span>
    </div>
  </div>
  <script>
    const API = '${apiBase}';
    let lastHash = '';

    function updateText(id, val) {
      var el = document.getElementById(id);
      if (el && el.textContent !== String(val)) el.textContent = val;
    }

    function buildCardHTML(items) {
      if (items.length === 0) return '<div class="no-serving">No customers being served</div>';
      return items.map(function(t) {
        return '<div class="serving-card ' + t.status + ' fade-update">' +
          '<div class="serving-number">' + t.ticket_number + '</div>' +
          '<div class="serving-desk">' + (t.desk_name || 'Desk') + '</div>' +
          '<div class="serving-status ' + t.status + '">' + (t.status === 'called' ? 'Please proceed to desk' : 'Being served') + '</div>' +
          '</div>';
      }).join('');
    }

    async function refresh() {
      try {
        var res = await fetch(API + '/api/display-data');
        var d = await res.json();
        if (d.error) return;

        updateText('office-name', d.office_name);
        updateText('stat-waiting', d.waiting_count);
        updateText('stat-served', d.served_count);

        // Only update grid if data changed (prevents flashing)
        var hash = JSON.stringify(d.now_serving);
        if (hash !== lastHash) {
          lastHash = hash;
          document.getElementById('serving-grid').innerHTML = buildCardHTML(d.now_serving);
        }
      } catch (e) {}

      updateText('time', new Date().toLocaleTimeString());
    }

    refresh();
    setInterval(refresh, 3000);
  <\/script>
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}
