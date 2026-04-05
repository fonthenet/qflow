/**
 * Station HTTP Client — talks directly to the Station's local server.
 * Every function takes a baseUrl (e.g., "http://192.168.1.50:3847").
 */

const TIMEOUT = 8000;

function abortSignal(ms = TIMEOUT): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

// ── Health ────────────────────────────────────────────────────────

export async function stationHealth(baseUrl: string) {
  const res = await fetch(`${baseUrl}/api/health`, { signal: abortSignal() });
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return res.json() as Promise<{ status: string; version: string; cloud: string }>;
}

// ── Session ──────────────────────────────────────────────────────

export async function stationGetSession(baseUrl: string) {
  const res = await fetch(`${baseUrl}/api/station/session`, {
    signal: abortSignal(),
    headers: { 'Cache-Control': 'no-cache' },
  });
  if (!res.ok) throw new Error(`Session fetch failed: ${res.status}`);
  return res.json();
}

// ── Tickets ──────────────────────────────────────────────────────

export async function stationGetTickets(
  baseUrl: string,
  officeIds: string[],
  statuses: string[] = ['waiting', 'called', 'serving'],
) {
  const params = new URLSearchParams({
    officeIds: officeIds.join(','),
    statuses: statuses.join(','),
  });
  const res = await fetch(`${baseUrl}/api/station/tickets?${params}`, {
    signal: abortSignal(),
  });
  if (!res.ok) throw new Error(`Ticket fetch failed: ${res.status}`);
  return res.json() as Promise<any[]>;
}

export async function stationUpdateDesk(
  baseUrl: string,
  deskId: string,
  updates: Record<string, any>,
) {
  const res = await fetch(`${baseUrl}/api/station/update-desk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deskId, updates }),
    signal: abortSignal(),
  });
  if (!res.ok) throw new Error(`Update desk failed: ${res.status}`);
  return res.json();
}

export async function stationUpdateTicket(
  baseUrl: string,
  ticketId: string,
  updates: Record<string, any>,
) {
  const res = await fetch(`${baseUrl}/api/station/update-ticket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticketId, updates }),
    signal: abortSignal(),
  });
  if (!res.ok) throw new Error(`Update ticket failed: ${res.status}`);
  return res.json();
}

export async function stationCallNext(
  baseUrl: string,
  officeId: string,
  deskId: string,
  staffId: string,
) {
  const res = await fetch(`${baseUrl}/api/station/call-next`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ officeId, deskId, staffId }),
    signal: abortSignal(),
  });
  if (!res.ok) throw new Error(`Call next failed: ${res.status}`);
  return res.json();
}

// ── Query (departments, services, desks) ──────────────────────────

export async function stationQuery(
  baseUrl: string,
  table: 'departments' | 'services' | 'desks',
  officeIds: string[],
) {
  const params = new URLSearchParams({
    table,
    officeIds: officeIds.join(','),
  });
  const res = await fetch(`${baseUrl}/api/station/query?${params}`, {
    signal: abortSignal(),
  });
  if (!res.ok) throw new Error(`Query ${table} failed: ${res.status}`);
  return res.json() as Promise<any[]>;
}

// ── Create Ticket (in-house / walk-in) ──────────────────────────

export async function stationCreateTicket(
  baseUrl: string,
  params: {
    officeId: string;
    departmentId: string;
    serviceId?: string;
    customerName?: string;
    customerPhone?: string;
    customerReason?: string;
    source?: string;
  },
) {
  const res = await fetch(`${baseUrl}/api/take-ticket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      officeId: params.officeId,
      departmentId: params.departmentId,
      serviceId: params.serviceId ?? null,
      customerName: params.customerName ?? null,
      customerPhone: params.customerPhone ?? null,
      customerReason: params.customerReason ?? null,
      source: params.source ?? 'in_house',
    }),
    signal: abortSignal(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error ?? `Create ticket failed: ${res.status}`);
  }
  return res.json();
}

// ── Sync Status ──────────────────────────────────────────────────

export async function stationSyncStatus(baseUrl: string) {
  const res = await fetch(`${baseUrl}/api/station/sync-status`, {
    signal: abortSignal(),
  });
  if (!res.ok) throw new Error(`Sync status failed: ${res.status}`);
  return res.json() as Promise<{ isOnline: boolean; pendingCount: number; lastSyncAt: string | null }>;
}

export async function stationForceSync(baseUrl: string) {
  const res = await fetch(`${baseUrl}/api/station/sync-force`, {
    method: 'POST',
    signal: abortSignal(15000),
  });
  if (!res.ok) throw new Error(`Force sync failed: ${res.status}`);
  return res.json();
}

// ── Device Status ───────────────────────────────────────────────

export async function stationDeviceStatus(baseUrl: string) {
  const res = await fetch(`${baseUrl}/api/device-status`, {
    signal: abortSignal(),
  });
  if (!res.ok) throw new Error(`Device status failed: ${res.status}`);
  return res.json() as Promise<{
    cloud: boolean;
    devices: Array<{
      id: string;
      type: string;
      name: string;
      lastPing: string;
      connected: boolean;
    }>;
  }>;
}

// ── Kiosk Info (URLs + local IP) ────────────────────────────────

export async function stationKioskInfo(baseUrl: string) {
  const res = await fetch(`${baseUrl}/api/station/kiosk-info`, {
    signal: abortSignal(),
  });
  if (!res.ok) throw new Error(`Kiosk info failed: ${res.status}`);
  return res.json() as Promise<{
    kioskUrl: string;
    displayUrl: string;
    localIP: string;
  }>;
}

// ── Public Links (cloud URLs) ───────────────────────────────────

export async function stationPublicLinks(baseUrl: string) {
  const res = await fetch(`${baseUrl}/api/station/public-links`, {
    signal: abortSignal(),
  });
  if (!res.ok) return null;
  return res.json() as Promise<{
    kioskUrl: string;
    displayUrl: string;
  }>;
}

// ── Branding ─────────────────────────────────────────────────────

export async function stationBranding(baseUrl: string) {
  const res = await fetch(`${baseUrl}/api/station/branding`, {
    signal: abortSignal(),
  });
  if (!res.ok) return null;
  return res.json();
}
