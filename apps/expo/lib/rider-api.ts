/**
 * Rider API client — wraps the /api/rider/* endpoints the existing web
 * rider portal already uses. Auth is the stateless HMAC token from the
 * deeplink path, NOT a session login: every request body carries
 * { ticketId, token }, the server verifies via verifyRiderToken().
 *
 * The native app and the web portal call the same endpoints with the
 * same shape — single source of truth, per the cross-platform rule.
 *
 * Endpoints:
 *   POST /api/rider/heartbeat  body: { ticketId, token, lat, lng, accuracy?, heading?, speed? }
 *   POST /api/rider/arrived    body: { ticketId, token }
 *   POST /api/rider/delivered  body: { ticketId, token }
 *
 * Heartbeat response can include `{ stopped: true }` — server signal that
 * the order is delivered/cancelled and the watcher should stop. Mobile
 * honours it the same way the web portal does.
 */

import { API_BASE_URL } from './config';

export interface RiderHeartbeatInput {
  ticketId: string;
  token: string;
  lat: number;
  lng: number;
  accuracy?: number | null;
  heading?: number | null;
  speed?: number | null;
}

export interface RiderHeartbeatResult {
  ok: boolean;
  stopped?: boolean;
  error?: string;
}

async function postJson<T>(path: string, body: unknown, timeoutMs = 12000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = (await r.json().catch(() => ({}))) as any;
    if (!r.ok) {
      return { ok: false, error: data?.error ?? `HTTP ${r.status}` } as T;
    }
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function postHeartbeat(input: RiderHeartbeatInput): Promise<RiderHeartbeatResult> {
  return postJson<RiderHeartbeatResult>('/api/rider/heartbeat', input);
}

export async function postAccept(ticketId: string, token: string): Promise<{ ok: boolean; dispatched_at?: string; noop?: boolean; error?: string }> {
  return postJson('/api/rider/accept', { ticketId, token });
}

export async function postDecline(ticketId: string, token: string): Promise<{ ok: boolean; noop?: boolean; error?: string }> {
  return postJson('/api/rider/decline', { ticketId, token });
}

export async function postArrived(ticketId: string, token: string): Promise<{ ok: boolean; arrived_at?: string; noop?: boolean; error?: string }> {
  return postJson('/api/rider/arrived', { ticketId, token });
}

export async function postDelivered(
  ticketId: string,
  token: string,
): Promise<{ ok: boolean; delivered_at?: string; noop?: boolean; error?: string }> {
  return postJson('/api/rider/delivered', { ticketId, token });
}

export async function postRegisterPush(input: {
  ticketId: string;
  token: string;
  deviceToken: string;
  platform: 'ios' | 'android';
}): Promise<{ ok: boolean; error?: string }> {
  return postJson('/api/rider/register-push', input);
}
