'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import type { RealtimeChannel } from '@supabase/supabase-js';

type Ticket = Database['public']['Tables']['tickets']['Row'];

const EMPTY_QUEUE: QueueData = {
  waiting: [],
  parked: [],
  called: [],
  serving: [],
  recentlyServed: [],
  cancelled: [],
};

export interface QueueData {
  waiting: Ticket[];
  parked: Ticket[];
  called: Ticket[];
  serving: Ticket[];
  recentlyServed: Ticket[];
  cancelled: Ticket[];
}

interface UseRealtimeQueueOptions {
  officeId: string;
  departmentId?: string;
  disabled?: boolean;
  initialQueue?: QueueData;
}

export function useRealtimeQueue({
  officeId,
  departmentId,
  disabled = false,
  initialQueue,
}: UseRealtimeQueueOptions) {
  const [queue, setQueue] = useState<QueueData>(initialQueue ?? EMPTY_QUEUE);
  const [isLoading, setIsLoading] = useState(!disabled);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const reconnectAttemptRef = useRef(0);

  const fetchQueue = useCallback(async () => {
    if (disabled) {
      setQueue(initialQueue ?? EMPTY_QUEUE);
      setIsLoading(false);
      return;
    }
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
      .in('status', ['waiting', 'called', 'serving', 'served', 'cancelled'])
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
    const waitingTickets = tickets.filter((t) => t.status === 'waiting');

    setQueue({
      waiting: waitingTickets.filter((t) => !t.parked_at),
      parked: waitingTickets.filter((t) => !!t.parked_at),
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
      cancelled: tickets
        .filter((t) => t.status === 'cancelled')
        .sort(
          (a, b) =>
            new Date(b.completed_at ?? 0).getTime() -
            new Date(a.completed_at ?? 0).getTime()
        )
        .slice(0, 5),
    });
    setError(null);
  }, [departmentId, disabled, initialQueue, officeId]);

  useEffect(() => {
    if (disabled) {
      setQueue(initialQueue ?? EMPTY_QUEUE);
      setIsLoading(false);
      return;
    }
    const supabase = createClient();
    let realtimeConnected = false;

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
      .subscribe((status) => {
        realtimeConnected = status === 'SUBSCRIBED';
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[RealtimeQueue] Subscription failed:', status, '— using polling fallback');
          // Exponential backoff: avoid hammering reconnections on persistent failures
          const attempt = reconnectAttemptRef.current;
          if (attempt < 5) {
            const backoffMs = Math.min(2000 * Math.pow(2, attempt), 30000);
            reconnectAttemptRef.current = attempt + 1;
            console.log(`[RealtimeQueue] Reconnect attempt ${attempt + 1} in ${backoffMs}ms`);
            setTimeout(() => {
              if (channelRef.current) {
                supabase.removeChannel(channelRef.current);
                channelRef.current = null;
              }
            }, backoffMs);
          }
        } else if (status === 'SUBSCRIBED') {
          reconnectAttemptRef.current = 0; // Reset on success
        }
      });

    channelRef.current = channel;

    // Polling fallback: refresh every 3s to guarantee updates even if realtime is down
    const pollInterval = setInterval(() => {
      fetchQueue();
    }, 3000);

    return () => {
      clearInterval(pollInterval);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [departmentId, disabled, fetchQueue, initialQueue, officeId]);

  return {
    queue,
    isLoading,
    error,
    refetch: fetchQueue,
  };
}
