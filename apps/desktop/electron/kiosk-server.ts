import http from 'http';
import { networkInterfaces } from 'os';
import { getDB, generateOfflineTicketNumber } from './db';
import { randomUUID } from 'crypto';

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

// ── Kiosk HTML Page ───────────────────────────────────────────────

function serveKioskPage(res: http.ServerResponse) {
  const ip = getLocalIP();
  const apiBase = `http://${ip}:${localPort}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>QueueFlow Kiosk</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: #f8fafc; color: #0f172a; min-height: 100vh; }

    .kiosk { display: flex; flex-direction: column; align-items: center; min-height: 100vh; padding: 24px; }
    .kiosk-header { text-align: center; margin-bottom: 32px; }
    .kiosk-header h1 { font-size: 28px; font-weight: 800; color: #3b82f6; }
    .kiosk-header .office-name { font-size: 20px; color: #475569; margin-top: 4px; }
    .kiosk-header .status { font-size: 13px; padding: 4px 12px; border-radius: 20px; display: inline-block; margin-top: 8px; }
    .kiosk-header .status.local { background: #fef3c7; color: #92400e; }
    .kiosk-header .status.online { background: #d1fae5; color: #065f46; }

    .step { width: 100%; max-width: 600px; }
    .step h2 { font-size: 22px; font-weight: 700; margin-bottom: 16px; text-align: center; }

    .dept-grid, .service-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
    .dept-card, .service-card {
      background: white; border: 2px solid #e2e8f0; border-radius: 12px; padding: 24px 16px;
      text-align: center; font-size: 16px; font-weight: 700; cursor: pointer; transition: all 0.15s;
      box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    }
    .dept-card:hover, .service-card:hover { border-color: #3b82f6; background: #eff6ff; transform: translateY(-2px); box-shadow: 0 4px 12px rgba(59,130,246,0.15); }
    .dept-card:active, .service-card:active { transform: translateY(0); }

    .form-step { background: white; border-radius: 16px; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
    .form-group { margin-bottom: 20px; }
    .form-group label { display: block; font-size: 14px; font-weight: 600; color: #475569; margin-bottom: 6px; }
    .form-group input { width: 100%; padding: 14px 16px; border: 2px solid #e2e8f0; border-radius: 10px; font-size: 16px; outline: none; transition: border-color 0.15s; }
    .form-group input:focus { border-color: #3b82f6; }

    .btn { display: block; width: 100%; padding: 16px; border: none; border-radius: 12px; font-size: 18px; font-weight: 700; cursor: pointer; transition: all 0.15s; }
    .btn-primary { background: #3b82f6; color: white; }
    .btn-primary:hover { background: #2563eb; }
    .btn-secondary { background: #f1f5f9; color: #475569; margin-top: 12px; }
    .btn-secondary:hover { background: #e2e8f0; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .ticket-result { text-align: center; background: white; border-radius: 20px; padding: 48px 32px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .ticket-result .check { font-size: 64px; margin-bottom: 16px; }
    .ticket-result .number { font-size: 56px; font-weight: 900; color: #3b82f6; letter-spacing: -2px; }
    .ticket-result .position { font-size: 18px; color: #475569; margin-top: 8px; }
    .ticket-result .info { font-size: 14px; color: #94a3b8; margin-top: 16px; }

    .loading { text-align: center; padding: 48px; color: #94a3b8; font-size: 16px; }
    .back-link { display: inline-block; margin-bottom: 16px; color: #3b82f6; font-weight: 600; cursor: pointer; font-size: 14px; }

    @media (max-width: 480px) {
      .kiosk { padding: 16px; }
      .dept-grid, .service-grid { grid-template-columns: 1fr; }
      .ticket-result .number { font-size: 44px; }
    }
  </style>
</head>
<body>
  <div class="kiosk" id="app">
    <div class="loading">Connecting to QueueFlow Station...</div>
  </div>

  <script>
    const API = '${apiBase}';
    let state = { step: 'loading', office: null, departments: [], services: [], selectedDept: null, selectedService: null, ticket: null };

    async function init() {
      try {
        const res = await fetch(API + '/api/kiosk-info');
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        state.office = data.office;
        state.departments = data.departments;
        state.services = data.services;
        state.step = 'department';
        render();
      } catch (err) {
        document.getElementById('app').innerHTML = '<div class="loading">Cannot connect to QueueFlow Station.<br>Make sure the desktop app is running.</div>';
      }
    }

    function selectDept(dept) {
      state.selectedDept = dept;
      const deptServices = state.services.filter(s => s.department_id === dept.id);
      if (deptServices.length === 1) {
        selectService(deptServices[0]);
      } else {
        state.step = 'service';
        render();
      }
    }

    function selectService(svc) {
      state.selectedService = svc;
      state.step = 'customer';
      render();
    }

    async function takeTicket() {
      const nameInput = document.getElementById('cname');
      const phoneInput = document.getElementById('cphone');

      const btn = document.querySelector('.btn-primary');
      btn.disabled = true;
      btn.textContent = 'Creating ticket...';

      try {
        const res = await fetch(API + '/api/take-ticket', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            officeId: state.office.id,
            departmentId: state.selectedDept.id,
            serviceId: state.selectedService.id,
            customerName: nameInput?.value || '',
            customerPhone: phoneInput?.value || '',
          }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        state.ticket = data.ticket;
        state.step = 'done';
        render();

        // Auto-reset after 15 seconds
        setTimeout(reset, 15000);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Get Ticket';
        alert('Error: ' + err.message);
      }
    }

    function reset() {
      state.step = 'department';
      state.selectedDept = null;
      state.selectedService = null;
      state.ticket = null;
      render();
    }

    function render() {
      const app = document.getElementById('app');
      const officeName = state.office?.name ?? '';

      let header = '<div class="kiosk-header">' +
        '<h1>QueueFlow</h1>' +
        '<div class="office-name">' + officeName + '</div>' +
        '<div class="status local">Local Kiosk Mode</div>' +
        '</div>';

      if (state.step === 'department') {
        let cards = state.departments.map(d =>
          '<div class="dept-card" onclick="selectDept(' + JSON.stringify(d).replace(/"/g, '&quot;') + ')">' + d.name + '</div>'
        ).join('');
        app.innerHTML = header + '<div class="step"><h2>Select Department</h2><div class="dept-grid">' + cards + '</div></div>';

      } else if (state.step === 'service') {
        let deptServices = state.services.filter(s => s.department_id === state.selectedDept.id);
        let cards = deptServices.map(s =>
          '<div class="service-card" onclick="selectService(' + JSON.stringify(s).replace(/"/g, '&quot;') + ')">' + s.name + '</div>'
        ).join('');
        app.innerHTML = header + '<div class="step">' +
          '<span class="back-link" onclick="state.step=\\'department\\';render();">← Back</span>' +
          '<h2>Select Service</h2><div class="service-grid">' + cards + '</div></div>';

      } else if (state.step === 'customer') {
        app.innerHTML = header + '<div class="step">' +
          '<span class="back-link" onclick="state.step=\\'service\\';render();">← Back</span>' +
          '<div class="form-step">' +
          '<h2>Your Information (Optional)</h2>' +
          '<div class="form-group"><label>Name</label><input id="cname" placeholder="Your name" autocomplete="off"></div>' +
          '<div class="form-group"><label>Phone</label><input id="cphone" placeholder="Phone number" type="tel" autocomplete="off"></div>' +
          '<button class="btn btn-primary" onclick="takeTicket()">Get Ticket</button>' +
          '<button class="btn btn-secondary" onclick="takeTicket()">Skip — Just Give Me a Number</button>' +
          '</div></div>';

      } else if (state.step === 'done') {
        const t = state.ticket;
        const trackLocal = API + '/track/' + encodeURIComponent(t.ticket_number);
        const trackCloud = 'https://qflow-sigma.vercel.app/ticket/' + t.id;
        app.innerHTML = header + '<div class="step">' +
          '<div class="ticket-result">' +
          '<div class="check">✓</div>' +
          '<div class="number">' + t.ticket_number + '</div>' +
          '<div class="position">Position #' + t.position + ' in queue</div>' +
          '<div style="margin-top:20px;padding:16px;background:#eff6ff;border-radius:12px;text-align:left">' +
          '<div style="font-weight:700;color:#1e40af;margin-bottom:8px">Track Your Ticket</div>' +
          '<div style="font-size:14px;color:#475569;margin-bottom:4px">On your phone, visit:</div>' +
          '<div style="font-family:monospace;font-size:13px;color:#3b82f6;word-break:break-all;font-weight:600">' + trackCloud + '</div>' +
          '<div style="font-size:12px;color:#94a3b8;margin-top:8px">Or scan the QR code at the entrance. You can track your position remotely from anywhere.</div>' +
          '</div>' +
          '<div style="font-size:13px;color:#94a3b8;margin-top:12px">Please wait for your number to be called. This screen resets in 15 seconds.</div>' +
          '</div>' +
          '<button class="btn btn-secondary" onclick="reset()" style="margin-top:16px">Take Another Ticket</button>' +
          '</div>';
      }
    }

    init();
  </script>
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

// ── Track Ticket API ──────────────────────────────────────────────

function handleTrackTicket(url: URL, res: http.ServerResponse) {
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

function handleDisplayData(url: URL, res: http.ServerResponse) {
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

  const today = new Date();
  today.setHours(0, 0, 0, 0);
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
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: #0f172a; color: #f1f5f9; min-height: 100vh; overflow: hidden; }

    .display { display: flex; flex-direction: column; height: 100vh; }
    .display-header { display: flex; justify-content: space-between; align-items: center; padding: 24px 40px; background: #1e293b; }
    .display-brand { font-size: 24px; font-weight: 800; color: #3b82f6; }
    .display-office { font-size: 20px; font-weight: 600; color: #94a3b8; }
    .display-stats { display: flex; gap: 24px; font-size: 16px; color: #64748b; }
    .display-stats span { font-weight: 700; }
    .display-stats .num { color: #f1f5f9; }

    .display-body { flex: 1; display: flex; padding: 32px 40px; gap: 32px; overflow: hidden; }

    .now-serving { flex: 2; }
    .now-serving h2 { font-size: 18px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 20px; }
    .serving-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
    .serving-card { background: #1e293b; border-radius: 16px; padding: 24px; border-left: 5px solid #22c55e; }
    .serving-card.called { border-left-color: #3b82f6; }
    .serving-number { font-size: 48px; font-weight: 900; letter-spacing: -2px; }
    .serving-desk { font-size: 16px; color: #94a3b8; margin-top: 4px; }
    .serving-status { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-top: 8px; }
    .serving-status.called { color: #3b82f6; }
    .serving-status.serving { color: #22c55e; }

    .no-serving { color: #475569; font-size: 20px; padding: 40px; text-align: center; }

    .display-footer { padding: 16px 40px; background: #1e293b; text-align: center; font-size: 14px; color: #475569; }

    @keyframes slideIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
    .serving-card { animation: slideIn 0.3s ease-out; }
  </style>
</head>
<body>
  <div class="display" id="app">
    <div class="display-header">
      <div class="display-brand">QueueFlow</div>
      <div class="display-office" id="office-name">Loading...</div>
      <div class="display-stats">
        <div>Waiting: <span class="num" id="stat-waiting">-</span></div>
        <div>Served today: <span class="num" id="stat-served">-</span></div>
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
      <span id="time"></span> &middot; Auto-updating
    </div>
  </div>
  <script>
    const API = '${apiBase}';

    async function refresh() {
      try {
        const res = await fetch(API + '/api/display-data');
        const d = await res.json();
        if (d.error) return;

        document.getElementById('office-name').textContent = d.office_name;
        document.getElementById('stat-waiting').textContent = d.waiting_count;
        document.getElementById('stat-served').textContent = d.served_count;

        const grid = document.getElementById('serving-grid');
        if (d.now_serving.length === 0) {
          grid.innerHTML = '<div class="no-serving">No customers being served</div>';
        } else {
          grid.innerHTML = d.now_serving.map(t =>
            '<div class="serving-card ' + t.status + '">' +
            '<div class="serving-number">' + t.ticket_number + '</div>' +
            '<div class="serving-desk">' + (t.desk_name || 'Desk') + '</div>' +
            '<div class="serving-status ' + t.status + '">' + (t.status === 'called' ? 'Please proceed' : 'Being served') + '</div>' +
            '</div>'
          ).join('');
        }
      } catch {}

      document.getElementById('time').textContent = new Date().toLocaleTimeString();
    }

    refresh();
    setInterval(refresh, 3000);
  </script>
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}
