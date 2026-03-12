'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import type { RealtimeChannel } from '@supabase/supabase-js';

type Ticket = Database['public']['Tables']['tickets']['Row'];

export interface QueueData {
  waiting: Ticket[];
  called: Ticket[];
  serving: Ticket[];
  recentlyServed: Ticket[];
}

interface UseRealtimeQueueOptions {
  officeId: string;
  departmentId?: string;
}

export function useRealtimeQueue({ officeId, departmentId }: UseRealtimeQueueOptions) {
  const [queue, setQueue] = useState<QueueData>({
    waiting: [],
    called: [],
    serving: [],
    recentlyServed: [],
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const fetchQueue = useCallback(async () => {
    const supabase = createClient();

    // Fetch today's active tickets
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayIso = today.toISOString();

    let query = supabase
      .from('tickets')
      .select('*')
      .eq('office_id', officeId)
      .gte('created_at', todayIso)
      .in('status', ['waiting', 'called', 'serving', 'served'])
      .order('priority', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: true });

    if (departmentId) {
      query = query.eq('department_id', departmentId);
    }

    const { data, error: fetchError } = await query;

    if (fetchError) {
      setError(fetchError.message);
      return;
    }

    const tickets = data ?? [];

    setQueue({
      waiting: tickets.filter((t) => t.status === 'waiting'),
      called: tickets.filter((t) => t.status === 'called'),
      serving: tickets.filter((t) => t.status === 'serving'),
      recentlyServed: tickets
        .filter((t) => t.status === 'served')
        .sort(
          (a, b) =>
            new Date(b.completed_at ?? 0).getTime() -
            new Date(a.completed_at ?? 0).getTime()
        )
        .slice(0, 5),
    });
    setError(null);
  }, [officeId, departmentId]);

  useEffect(() => {
    const supabase = createClient();

    // Initial fetch
    setIsLoading(true);
    fetchQueue().finally(() => setIsLoading(false));

    // Subscribe to realtime changes
    // Note: postgres_changes only supports filtering on ONE column.
    // Filter by office_id, then client-side filter by department if needed.
    const channel = supabase
      .channel(`queue-${officeId}-${departmentId ?? 'all'}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tickets',
          filter: `office_id=eq.${officeId}`,
        },
        (payload) => {
          // If filtering by department, ignore changes from other departments
          if (departmentId) {
            const changed = (payload.new ?? payload.old) as Ticket | undefined;
            if (changed && changed.department_id !== departmentId) return;
          }
          // Re-fetch on any ticket change for consistency
          fetchQueue();
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [officeId, departmentId, fetchQueue]);

  return {
    queue,
    isLoading,
    error,
    refetch: fetchQueue,
  };
}
