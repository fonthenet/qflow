/**
 * Rider auth context. Phone-OTP login, long-lived bearer token stored
 * in AsyncStorage, sliding `last_seen_at` server-side. Stays signed in
 * until the rider taps Sign Out or the operator deactivates them.
 *
 * Token is opaque to the client — server stores sha256(token), so we
 * literally can't validate it locally. On cold start we call /me to
 * confirm the cached token still works; if it doesn't (revoked,
 * inactive, network issue) we fall back to logged-out state and let
 * the rider log in again.
 */

import { createContext, useContext, useEffect, useMemo, useState, useCallback, type ReactNode } from 'react';
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { API_BASE_URL } from './config';

const STORAGE_KEY_TOKEN = 'qflo:rider:token';
const STORAGE_KEY_RIDER = 'qflo:rider:profile';

export interface RiderProfile {
  id: string;
  name: string;
  phone: string;
  organization_id: string;
}

interface RiderAuthState {
  ready: boolean;
  rider: RiderProfile | null;
  token: string | null;
}

interface RiderAuthContextValue extends RiderAuthState {
  /** Step 1: send OTP to phone. Server quietly succeeds for unknown
   *  phones to prevent enumeration — the UI should always show "code
   *  sent" regardless. */
  startLogin(phone: string): Promise<{ ok: boolean; error?: string }>;
  /** Step 2: verify OTP, mint session, persist locally. */
  verifyLogin(phone: string, code: string): Promise<{ ok: boolean; error?: string }>;
  signOut(): Promise<void>;
  /** Re-fetch /me — useful after a phone-change to refresh the cached profile. */
  refresh(): Promise<void>;
  /** Authenticated fetch helper — adds the Bearer token automatically. */
  authedFetch(path: string, init?: RequestInit): Promise<Response>;
}

const RiderAuthContext = createContext<RiderAuthContextValue | null>(null);

export function useRiderAuth(): RiderAuthContextValue {
  const ctx = useContext(RiderAuthContext);
  if (!ctx) throw new Error('useRiderAuth must be used inside <RiderAuthProvider>');
  return ctx;
}

async function postJson(path: string, body: unknown, token?: string | null): Promise<{ ok: boolean; status: number; data: any }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  } finally {
    clearTimeout(timer);
  }
}

export function RiderAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<RiderAuthState>({ ready: false, rider: null, token: null });

  const persist = useCallback(async (token: string | null, rider: RiderProfile | null) => {
    if (token && rider) {
      await AsyncStorage.multiSet([
        [STORAGE_KEY_TOKEN, token],
        [STORAGE_KEY_RIDER, JSON.stringify(rider)],
      ]);
    } else {
      await AsyncStorage.multiRemove([STORAGE_KEY_TOKEN, STORAGE_KEY_RIDER]);
    }
  }, []);

  // Cold-start: load cached token, validate against /me, hydrate.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [[, token], [, riderRaw]] = await AsyncStorage.multiGet([STORAGE_KEY_TOKEN, STORAGE_KEY_RIDER]);
        if (!token) {
          if (!cancelled) setState({ ready: true, rider: null, token: null });
          return;
        }

        // Optimistically hydrate from cache so the UI doesn't blink
        // through a logged-out state on every cold launch.
        const cachedRider = riderRaw ? safeParse<RiderProfile>(riderRaw) : null;
        if (cachedRider && !cancelled) {
          setState({ ready: false, rider: cachedRider, token });
        }

        // Validate against the server. If the token's been revoked
        // (operator deactivated rider, manual revoke, etc.) /me 401s
        // and we drop the cache.
        try {
          const r = await fetch(`${API_BASE_URL}/api/rider/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (cancelled) return;
          if (r.ok) {
            const data = await r.json();
            if (data?.rider) {
              await persist(token, data.rider);
              setState({ ready: true, rider: data.rider, token });
              return;
            }
          }
          // Either non-OK or no rider — drop the session.
          await persist(null, null);
          setState({ ready: true, rider: null, token: null });
        } catch {
          // Offline cold start — keep the cached session usable.
          // Subsequent API calls that need the network will re-validate.
          if (!cancelled) {
            setState({ ready: true, rider: cachedRider, token: cachedRider ? token : null });
          }
        }
      } catch (e: any) {
        console.warn('[rider-auth] cold-start failed', e?.message);
        if (!cancelled) setState({ ready: true, rider: null, token: null });
      }
    })();
    return () => { cancelled = true; };
  }, [persist]);

  const startLogin = useCallback(async (phone: string) => {
    const r = await postJson('/api/rider/auth/start', { phone: phone.trim() });
    if (!r.ok && r.status >= 500) {
      return { ok: false, error: r.data?.error ?? 'Server error' };
    }
    return { ok: true };
  }, []);

  const verifyLogin = useCallback(async (phone: string, code: string) => {
    const deviceLabel = `${Platform.OS === 'ios' ? 'iPhone' : 'Android'} • Qflo Rider`;
    const r = await postJson('/api/rider/auth/verify', { phone: phone.trim(), code: code.trim(), deviceLabel });
    if (!r.ok || !r.data?.token) {
      return { ok: false, error: r.data?.error ?? 'Invalid code' };
    }
    await persist(r.data.token, r.data.rider);
    setState({ ready: true, rider: r.data.rider, token: r.data.token });
    return { ok: true };
  }, [persist]);

  const signOut = useCallback(async () => {
    const token = state.token;
    if (token) {
      // Best-effort revoke — even if the network call fails, the
      // local cache is gone, so the device can't use the token.
      void fetch(`${API_BASE_URL}/api/rider/auth/signout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    await persist(null, null);
    setState({ ready: true, rider: null, token: null });
  }, [persist, state.token]);

  const refresh = useCallback(async () => {
    if (!state.token) return;
    try {
      const r = await fetch(`${API_BASE_URL}/api/rider/auth/me`, {
        headers: { Authorization: `Bearer ${state.token}` },
      });
      if (r.ok) {
        const data = await r.json();
        if (data?.rider) {
          await persist(state.token, data.rider);
          setState((s) => ({ ...s, rider: data.rider }));
        }
      } else if (r.status === 401) {
        await persist(null, null);
        setState({ ready: true, rider: null, token: null });
      }
    } catch { /* offline — keep current state */ }
  }, [persist, state.token]);

  const authedFetch = useCallback(async (path: string, init?: RequestInit) => {
    const r = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      },
    });
    if (r.status === 401 && state.token) {
      // Token rejected — drop the session so the next render boots login.
      await persist(null, null);
      setState({ ready: true, rider: null, token: null });
    }
    return r;
  }, [persist, state.token]);

  const value = useMemo<RiderAuthContextValue>(() => ({
    ready: state.ready,
    rider: state.rider,
    token: state.token,
    startLogin,
    verifyLogin,
    signOut,
    refresh,
    authedFetch,
  }), [state, startLogin, verifyLogin, signOut, refresh, authedFetch]);

  return React.createElement(RiderAuthContext.Provider, { value }, children);
}

function safeParse<T>(raw: string): T | null {
  try { return JSON.parse(raw) as T; } catch { return null; }
}
