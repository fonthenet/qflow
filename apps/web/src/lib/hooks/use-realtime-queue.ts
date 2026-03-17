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
  cancelled: Ticket[];
}

interface UseRealtimeQueueOptions {
  officeId: string;
  departmentId?: string;
  disabled?: boolean;
  initialQueue?: QueueData;
}

const EMPTY_QUEUE: QueueData = {
  waiting: [],
  called: [],
  serving: [],
  recentlyServed: [],
  cancelled: [],
};

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
  const hasLoadedRef = useRef(false);
  // Use a ref so initialQueue changes don't recreate fetchQueue
  const initialQueueRef = useRef(initialQueue);
  initialQueueRef.current = initialQueue;

  const fetchQueue = useCallback(async () => {
    if (disabled) {
      setQueue(initialQueueRef.current ?? EMPTY_QUEUE);
      setIsLoading(false);
      return;
    }
    const supabase = createClient();

    // Fetch active tickets — no date cutoff for waiting/called/serving so
    // tickets from previous days still appear.  Only limit served/cancelled
    // to the last 24 h so the list stays manageable.
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // 1) All currently-active tickets (no date filter)
    let activeQuery = supabase
      .from('tickets')
      .select('*')
      .eq('office_id', officeId)
      .in('status', ['waiting', 'called', 'serving'])
      .order('priority', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: true });

    // 2) Recently-completed tickets (last 24 h only)
    let completedQuery = supabase
      .from('tickets')
      .select('*')
      .eq('office_id', officeId)
      .in('status', ['served', 'cancelled'])
      .gte('completed_at', yesterday)
      .order('completed_at', { ascending: false })
      .limit(20);

    if (departmentId) {
      activeQuery = activeQuery.eq('department_id', departmentId);
      completedQuery = completedQuery.eq('department_id', departmentId);
    }

    const [activeResult, completedResult] = await Promise.all([activeQuery, completedQuery]);

    if (activeResult.error) {
      setError(activeResult.error.message);
      return;
    }
    if (completedResult.error) {
      setError(completedResult.error.message);
      return;
    }

    const tickets = [...(activeResult.data ?? []), ...(completedResult.data ?? [])];

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
  }, [departmentId, disabled, officeId]);

  useEffect(() => {
    if (disabled) {
      setQueue(initialQueueRef.current ?? EMPTY_QUEUE);
      setIsLoading(false);
      return;
    }
    const supabase = createClient();
    let realtimeConnected = false;

    // Only show loading spinner on the very first fetch, not on re-subscriptions
    if (!hasLoadedRef.current) {
      setIsLoading(true);
    }
    fetchQueue().finally(() => {
      setIsLoading(false);
      hasLoadedRef.current = true;
    });

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
  }, [departmentId, disabled, fetchQueue, officeId]);

  return {
    queue,
    isLoading,
    error,
    refetch: fetchQueue,
  };
}
