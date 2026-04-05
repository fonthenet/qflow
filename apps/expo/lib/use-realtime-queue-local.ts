/**
 * Local-mode queue hook — fetches tickets from Station HTTP API
 * and polls for updates. Same return shape as useRealtimeQueue.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useLocalConnectionStore } from './local-connection-store';
import * as Station from './station-client';
import type { QueueData, QueueTicket } from './use-realtime-queue';

const POLL_INTERVAL = 2000; // 2s — local network is fast
const EMPTY: QueueData = { waiting: [], called: [], serving: [], recentlyServed: [], cancelled: [], parked: [], all: [] };

interface UseRealtimeQueueLocalOptions {
  officeId: string | null;
  departmentId?: string | null;
  enabled?: boolean;
}

function parseTicket(raw: any): QueueTicket {
  return {
    ...raw,
    customer_data: typeof raw.customer_data === 'string'
      ? JSON.parse(raw.customer_data || '{}')
      : raw.customer_data ?? null,
    priority: raw.priority ?? 0,
    recall_count: raw.recall_count ?? 0,
    is_remote: raw.is_remote === 1 || raw.is_remote === true,
  };
}

export function useRealtimeQueueLocal({ officeId, departmentId, enabled = true }: UseRealtimeQueueLocalOptions) {
  const [queue, setQueue] = useState<QueueData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stationUrl = useLocalConnectionStore((s) => s.stationUrl);
  const stationSession = useLocalConnectionStore((s) => s.stationSession);
  const mode = useLocalConnectionStore((s) => s.mode);

  const fetchQueue = useCallback(async () => {
    if (!stationUrl || !enabled || mode !== 'local') return;

    const officeIds = stationSession?.office_ids?.length
      ? stationSession.office_ids
      : officeId ? [officeId] : [];

    if (!officeIds.length) return;

    try {
      // Fetch active tickets
      const activeRaw = await Station.stationGetTickets(stationUrl, officeIds, ['waiting', 'called', 'serving']);
      // Fetch recent completed (for recently served list)
      const doneRaw = await Station.stationGetTickets(stationUrl, officeIds, ['served', 'no_show', 'cancelled']);

      const active = activeRaw.map(parseTicket);
      const done = doneRaw.map(parseTicket);

      // Filter by department if specified
      const filterDept = (t: QueueTicket) => !departmentId || t.department_id === departmentId;
      const activeFiltered = active.filter(filterDept);
      const doneFiltered = done.filter(filterDept);

      const waiting = activeFiltered.filter(t => t.status === 'waiting' && !t.parked_at);
      const parked = activeFiltered.filter(t => t.parked_at != null && (t.status === 'called' || t.status === 'serving' || t.status === 'waiting'));
      const called = activeFiltered.filter(t => t.status === 'called' && !t.parked_at);
      const serving = activeFiltered.filter(t => t.status === 'serving' && !t.parked_at);
      const recentlyServed = doneFiltered.filter(t => t.status === 'served').slice(0, 20);
      const cancelled = doneFiltered.filter(t => t.status === 'no_show' || t.status === 'cancelled').slice(0, 20);

      setQueue({
        waiting,
        called,
        serving,
        recentlyServed,
        cancelled,
        parked,
        all: [...activeFiltered, ...doneFiltered],
      });
      setLoading(false);

      // Update connection status on success
      const store = useLocalConnectionStore.getState();
      if (store.connectionStatus === 'error') {
        store.setConnectionStatus('connected');
      }
    } catch (err: any) {
      // Suppress abort errors (expected during cleanup/disconnect)
      if (err?.name === 'AbortError' || err?.message === 'Aborted') return;
      console.warn('[local-queue] Fetch error:', err?.message);
      // Only update status if still in local mode
      if (useLocalConnectionStore.getState().mode === 'local') {
        useLocalConnectionStore.getState().setConnectionStatus('error', err?.message);
      }
    }
  }, [stationUrl, stationSession, officeId, departmentId, enabled, mode]);

  useEffect(() => {
    if (!stationUrl || !enabled || mode !== 'local') {
      // Clean up on disable/disconnect
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setQueue(EMPTY);
      setLoading(false);
      return;
    }

    // Initial fetch
    fetchQueue();

    // Poll
    intervalRef.current = setInterval(fetchQueue, POLL_INTERVAL);

    // Pause polling when app is in background
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        fetchQueue();
        if (!intervalRef.current) {
          intervalRef.current = setInterval(fetchQueue, POLL_INTERVAL);
        }
      } else {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    });

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      sub.remove();
    };
  }, [stationUrl, enabled, mode, fetchQueue]);

  return { queue, loading, refresh: fetchQueue };
}
