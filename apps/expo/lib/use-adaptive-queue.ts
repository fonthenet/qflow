/**
 * Adaptive Queue Hook — transparently switches between cloud (Supabase)
 * and local (Station HTTP) based on the connection mode.
 */

import { useLocalConnectionStore } from './local-connection-store';
import { useRealtimeQueue, useNameLookup } from './use-realtime-queue';
import { useRealtimeQueueLocal } from './use-realtime-queue-local';
import * as Station from './station-client';
import { useEffect, useState } from 'react';

interface AdaptiveQueueOptions {
  officeId: string | null;
  departmentId?: string | null;
  enabled?: boolean;
}

export function useAdaptiveQueue({ officeId, departmentId, enabled = true }: AdaptiveQueueOptions) {
  const mode = useLocalConnectionStore((s) => s.mode);

  const cloudResult = useRealtimeQueue({
    officeId,
    departmentId,
    enabled: mode === 'cloud' && enabled,
  });

  const localResult = useRealtimeQueueLocal({
    officeId,
    departmentId,
    enabled: mode === 'local' && enabled,
  });

  return mode === 'local' ? localResult : cloudResult;
}

/**
 * Adaptive Name Lookup — fetches department/service/desk names
 * from either Supabase or Station HTTP based on connection mode.
 */
export function useAdaptiveNameLookup(orgId: string | null, officeIds: string[]) {
  const mode = useLocalConnectionStore((s) => s.mode);
  const stationUrl = useLocalConnectionStore((s) => s.stationUrl);

  // Cloud mode uses the existing hook
  const cloudNames = useNameLookup(mode === 'cloud' ? orgId : null, mode === 'cloud' ? officeIds : []);

  // Local mode fetches from Station
  const [localNames, setLocalNames] = useState<ReturnType<typeof useNameLookup>>({
    offices: {}, departments: {}, services: {}, desks: {}, staff: {}, priorities: {},
  });

  useEffect(() => {
    if (mode !== 'local' || !stationUrl || !officeIds.length) return;

    const load = async () => {
      try {
        const [depts, svcs, desks] = await Promise.all([
          Station.stationQuery(stationUrl, 'departments', officeIds),
          Station.stationQuery(stationUrl, 'services', officeIds),
          Station.stationQuery(stationUrl, 'desks', officeIds),
        ]);

        const map = (arr: any[]) => {
          const m: Record<string, string> = {};
          arr.forEach((r: any) => { m[r.id] = r.name ?? r.full_name; });
          return m;
        };

        setLocalNames({
          offices: {},
          departments: map(depts),
          services: map(svcs),
          desks: map(desks),
          staff: {},
          priorities: {},
        });
      } catch (err: any) {
        console.warn('[local-names] Fetch error:', err?.message);
      }
    };

    load();
  }, [mode, stationUrl, officeIds.join(',')]);

  return mode === 'local' ? localNames : cloudNames;
}
