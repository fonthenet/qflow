/**
 * Station HTTP Client — talks directly to the Station's local server.
 * Every function takes a baseUrl (e.g., "http://192.168.1.50:3847").
 *
 * ───────────────────────────────────────────────────────────────────────
 *  INVARIANT — DO NOT BREAK
 * ───────────────────────────────────────────────────────────────────────
 *  All `/api/station/*` endpoints require an `X-Station-Token` header.
 *  This file is the ONLY place in the Expo app that is allowed to talk to
 *  `/api/station/*` with raw `fetch`. Everywhere else MUST import the
 *  relevant function from here — those go through `authedFetch`, which
 *  fetches/caches the token from the unauthenticated `/api/station/token`
 *  endpoint and retries once on 401/403.
 *
 *  A static guard test (`station-auth-guard.test.ts`) fails CI if any other
 *  file calls `/api/station/*` directly. If you need a new Station endpoint,
 *  add a function here that uses `authedFetch` and consume it from screens.
 * ───────────────────────────────────────────────────────────────────────
 */

/** Thrown when the Station is reachable but has no logged-in operator. */
export class StationNotLoggedInError extends Error {
  constructor() {
    super('Station is running but no operator is signed in. Log in on the Station desktop app first.');
    this.name = 'StationNotLoggedInError';
  }
}

const TIMEOUT = 8000;

function abortSignal(ms = TIMEOUT): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

// ── Station token cache ──────────────────────────────────────────
// Station's /api/station/token is unauthenticated and returns the
// current station_token stored in SQLite. Anyone on the local network
// can read it (by design — same model as the web station UI).

const tokenCache = new Map<string, string>();

async function fetchStationToken(baseUrl: string): Promise<string | null> {
  try {
    const res = await fetch(`${baseUrl}/api/station/token`, {
      signal: abortSignal(),
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null) as { token?: string | null } | null;
    return body?.token ?? null;
  } catch {
    return null;
  }
}

async function getStationToken(baseUrl: string, force = false): Promise<string | null> {
  if (!force) {
    const cached = tokenCache.get(baseUrl);
    if (cached) return cached;
  }
  const token = await fetchStationToken(baseUrl);
  if (token) tokenCache.set(baseUrl, token);
  else tokenCache.delete(baseUrl);
  return token;
}

export function clearStationToken(baseUrl: string) {
  tokenCache.delete(baseUrl);
}

export function getCachedStationToken(baseUrl: string): string | null {
  return tokenCache.get(baseUrl) ?? null;
}

/** Fetch wrapper that injects X-Station-Token and auto-retries on 401/403. */
async function authedFetch(baseUrl: string, path: string, init: RequestInit = {}): Promise<Response> {
  let token = await getStationToken(baseUrl);
  const buildHeaders = (tk: string | null): Record<string, string> => {
    const h: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
    if (tk) h['X-Station-Token'] = tk;
    return h;
  };

  let res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: buildHeaders(token),
    signal: init.signal ?? abortSignal(),
  });

  if (res.status === 401 || res.status === 403) {
    // Token may have rotated, or the Station had no session when we first
    // asked — refetch once and retry.
    token = await getStationToken(baseUrl, true);
    if (!token) {
      // Station reachable + /api/station/token returned null → no logged-in
      // operator. Give the caller a clear, actionable error.
      throw new StationNotLoggedInError();
    }
    res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: buildHeaders(token),
      signal: init.signal ?? abortSignal(),
    });
  }
  return res;
}

// ── Health ────────────────────────────────────────────────────────

export async function stationHealth(baseUrl: string) {
  const res = await fetch(`${baseUrl}/api/health`, { signal: abortSignal() });
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return res.json() as Promise<{ status: string; version: string; cloud: string }>;
}

// ── Session ──────────────────────────────────────────────────────

export async function stationGetSession(baseUrl: string) {
  const res = await authedFetch(baseUrl, `/api/station/session`, {
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
  const res = await authedFetch(baseUrl, `/api/station/tickets?${params}`);
  if (!res.ok) throw new Error(`Ticket fetch failed: ${res.status}`);
  return res.json() as Promise<any[]>;
}

export async function stationUpdateDesk(
  baseUrl: string,
  deskId: string,
  updates: Record<string, any>,
) {
  const res = await authedFetch(baseUrl, `/api/station/update-desk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deskId, updates }),
  });
  if (!res.ok) {
    // Surface the actual server error so CHECK/trigger failures are visible
    // in the UI instead of being hidden behind a bare "500".
    let detail = '';
    try {
      const body = await res.json();
      if (body && typeof body.error === 'string') detail = `: ${body.error}`;
    } catch {
      try {
        const text = await res.text();
        if (text) detail = `: ${text}`;
      } catch { /* ignore */ }
    }
    throw new Error(`Update desk failed (${res.status})${detail}`);
  }
  return res.json();
}

export async function stationUpdateTicket(
  baseUrl: string,
  ticketId: string,
  updates: Record<string, any>,
) {
  const res = await authedFetch(baseUrl, `/api/station/update-ticket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticketId, updates }),
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
  const res = await authedFetch(baseUrl, `/api/station/call-next`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ officeId, deskId, staffId }),
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
  const res = await authedFetch(baseUrl, `/api/station/query?${params}`);
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
  const res = await authedFetch(baseUrl, `/api/station/sync-status`);
  if (!res.ok) throw new Error(`Sync status failed: ${res.status}`);
  return res.json() as Promise<{ isOnline: boolean; pendingCount: number; lastSyncAt: string | null }>;
}

export async function stationForceSync(baseUrl: string) {
  const res = await authedFetch(baseUrl, `/api/station/sync-force`, {
    method: 'POST',
    signal: abortSignal(15000),
  });
  if (!res.ok) throw new Error(`Force sync failed: ${res.status}`);
  return res.json();
}

// ── Device Status ───────────────────────────────────────────────

export async function stationDeviceStatus(baseUrl: string) {
  // /api/device-status is NOT under /api/station/* so no auth needed
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
  const res = await authedFetch(baseUrl, `/api/station/kiosk-info`);
  if (!res.ok) throw new Error(`Kiosk info failed: ${res.status}`);
  return res.json() as Promise<{
    kioskUrl: string;
    displayUrl: string;
    localIP: string;
  }>;
}

// ── Public Links (cloud URLs) ───────────────────────────────────

export async function stationPublicLinks(baseUrl: string) {
  const res = await authedFetch(baseUrl, `/api/station/public-links`);
  if (!res.ok) return null;
  return res.json() as Promise<{
    kioskUrl: string;
    displayUrl: string;
  }>;
}

// ── Branding ─────────────────────────────────────────────────────

export async function stationBranding(baseUrl: string) {
  const res = await authedFetch(baseUrl, `/api/station/branding`);
  if (!res.ok) return null;
  return res.json();
}
