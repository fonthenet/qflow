import { AppState, AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { stationGetSession, clearStationToken, StationNotLoggedInError } from './station-client';

export interface StationSession {
  staff_id: string;
  staff_name: string;
  role: string;
  desk_id: string | null;
  desk_name: string | null;
  office_id: string;
  office_name: string;
  office_ids: string[];
  organization_id: string;
  department_id: string | null;
  department_name: string | null;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface LocalConnectionState {
  mode: 'cloud' | 'local';
  stationUrl: string | null;
  connectionStatus: ConnectionStatus;
  lastError: string | null;
  stationSession: StationSession | null;

  connect: (url: string) => Promise<boolean>;
  disconnect: () => void;
  setConnectionStatus: (status: ConnectionStatus, error?: string) => void;
  updateStationSession: (session: StationSession) => void;
  /** Start background health-check polling (call once from top-level layout) */
  startHealthMonitor: () => () => void;
}

// ── Health monitor internals ──────────────────────────────────────
let healthTimer: ReturnType<typeof setTimeout> | null = null;
let appStateSub: { remove: () => void } | null = null;
let consecutiveFailures = 0;

const HEALTH_INTERVAL_OK = 10_000;      // 10s while connected
const HEALTH_INTERVAL_MAX = 60_000;     // 60s max back-off
const HEALTH_TIMEOUT = 5_000;           // 5s per check

function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

function getBackoff(failures: number): number {
  if (failures <= 0) return HEALTH_INTERVAL_OK;
  // Exponential: 10s → 20s → 40s → 60s cap
  return Math.min(HEALTH_INTERVAL_OK * Math.pow(2, failures), HEALTH_INTERVAL_MAX);
}

function stopHealthTimer() {
  if (healthTimer) {
    clearTimeout(healthTimer);
    healthTimer = null;
  }
}

export const useLocalConnectionStore = create<LocalConnectionState>()(
  persist(
    (set, get) => ({
      mode: 'cloud',
      stationUrl: null,
      connectionStatus: 'disconnected',
      lastError: null,
      stationSession: null,

      connect: async (url: string) => {
        const cleanUrl = url.replace(/\/+$/, '');
        set({ connectionStatus: 'connecting', lastError: null, stationUrl: cleanUrl });

        try {
          // Health check
          const healthRes = await fetch(`${cleanUrl}/api/health`, {
            signal: timeoutSignal(HEALTH_TIMEOUT),
          });
          if (!healthRes.ok) throw new Error('Station not reachable');
          const health = await healthRes.json();
          if (!health?.status) throw new Error('Invalid station response');

          // Load session (station-client handles X-Station-Token auth).
          // StationNotLoggedInError has an actionable message — let it bubble
          // up as-is. Anything else stays as the original error.
          clearStationToken(cleanUrl); // force fresh token fetch on reconnect
          const session = await stationGetSession(cleanUrl);
          if (!session?.staff_id) throw new StationNotLoggedInError();

          set({
            mode: 'local',
            stationUrl: cleanUrl,
            connectionStatus: 'connected',
            lastError: null,
            stationSession: session,
          });
          consecutiveFailures = 0;
          return true;
        } catch (err: any) {
          set({
            connectionStatus: 'error',
            lastError: err?.message ?? 'Connection failed',
          });
          return false;
        }
      },

      disconnect: () => {
        stopHealthTimer();
        if (appStateSub) {
          appStateSub.remove();
          appStateSub = null;
        }
        consecutiveFailures = 0;
        set({
          mode: 'cloud',
          stationUrl: null,
          connectionStatus: 'disconnected',
          lastError: null,
          stationSession: null,
        });
      },

      setConnectionStatus: (status, error) => {
        set({ connectionStatus: status, lastError: error ?? null });
      },

      updateStationSession: (session) => {
        set({ stationSession: session });
      },

      startHealthMonitor: () => {
        // Runs a periodic health check while in local mode.
        // Returns a cleanup function.

        const runCheck = async () => {
          const { mode, stationUrl, connectionStatus } = get();
          if (mode !== 'local' || !stationUrl) return;

          try {
            const res = await fetch(`${stationUrl}/api/health`, {
              signal: timeoutSignal(HEALTH_TIMEOUT),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (!data?.status) throw new Error('Invalid response');

            // Recovered
            consecutiveFailures = 0;
            if (connectionStatus !== 'connected') {
              set({ connectionStatus: 'connected', lastError: null });
              // Refresh session on recovery (station-client handles auth)
              try {
                const sess = await stationGetSession(stationUrl);
                if (sess?.staff_id) set({ stationSession: sess });
              } catch { /* keep going with old session */ }
            }
          } catch (err: any) {
            consecutiveFailures++;
            if (connectionStatus !== 'error') {
              set({
                connectionStatus: consecutiveFailures >= 2 ? 'error' : 'connecting',
                lastError: err?.message ?? 'Health check failed',
              });
            }
          }

          // Schedule next check with backoff
          scheduleNext();
        };

        const scheduleNext = () => {
          stopHealthTimer();
          const { mode } = get();
          if (mode !== 'local') return;
          const delay = getBackoff(consecutiveFailures);
          healthTimer = setTimeout(runCheck, delay);
        };

        // Handle app state changes — pause in background, resume in foreground
        const handleAppState = (state: AppStateStatus) => {
          const { mode } = get();
          if (mode !== 'local') return;

          if (state === 'active') {
            // Immediately check and restart polling
            runCheck();
          } else {
            stopHealthTimer();
          }
        };

        // Start
        appStateSub = AppState.addEventListener('change', handleAppState);
        scheduleNext();

        // Return cleanup
        return () => {
          stopHealthTimer();
          if (appStateSub) {
            appStateSub.remove();
            appStateSub = null;
          }
          consecutiveFailures = 0;
        };
      },
    }),
    {
      name: 'qflo-local-connection',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        mode: state.mode,
        stationUrl: state.stationUrl,
      }),
    },
  ),
);

// ── Auto-reconnect after rehydration ────────────────────────────
// When the app restarts, persisted state restores mode + stationUrl
// but connectionStatus defaults to 'disconnected'. Attempt reconnect.
useLocalConnectionStore.persist.onFinishHydration((state) => {
  if (state.mode === 'local' && state.stationUrl) {
    state.connect(state.stationUrl).catch(() => {});
  }
});
