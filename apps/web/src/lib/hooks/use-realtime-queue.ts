'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import type { RealtimeChannel } from '@supabase/supabase-js';

export type QueueTicket = Database['public']['Tables']['tickets']['Row'] & {
  service?: { name: string } | null;
  department?: { name: string } | null;
  office?: { name: string } | null;
  desk?: { name: string | null; display_name?: string | null } | null;
};

export interface QueueData {
  issued: QueueTicket[];
  waiting: QueueTicket[];
  called: QueueTicket[];
  serving: QueueTicket[];
  recentlyServed: QueueTicket[];
  cancelled: QueueTicket[];
  noShows: QueueTicket[];
  transferred: QueueTicket[];
}

interface UseRealtimeQueueOptions {
  officeId: string;
  departmentId?: string;
}

const ACTIVE_STATUSES = ['issued', 'waiting', 'called', 'serving'] as const;
const RECENT_STATUSES = ['served', 'cancelled', 'no_show', 'transferred'] as const;

export function useRealtimeQueue({ officeId, departmentId }: UseRealtimeQueueOptions) {
  const [queue, setQueue] = useState<QueueData>({
    issued: [],
    waiting: [],
    called: [],
    serving: [],
    recentlyServed: [],
    cancelled: [],
    noShows: [],
    transferred: [],
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const supabaseRef = useRef(createClient());

  const fetchQueue = useCallback(async () => {
    const supabase = supabaseRef.current;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayIso = today.toISOString();

    let query = supabase
      .from('tickets')
      .select(
        '*, service:services(name), department:departments(name), office:offices(name), desk:desks(name, display_name)'
      )
      .eq('office_id', officeId)
      .gte('created_at', todayIso)
      .in('status', [...ACTIVE_STATUSES, ...RECENT_STATUSES])
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

    const tickets = (data ?? []).map((ticket: any) => ({
      ...ticket,
      service: Array.isArray(ticket.service) ? ticket.service[0] || null : ticket.service,
      department: Array.isArray(ticket.department) ? ticket.department[0] || null : ticket.department,
      office: Array.isArray(ticket.office) ? ticket.office[0] || null : ticket.office,
      desk: Array.isArray(ticket.desk) ? ticket.desk[0] || null : ticket.desk,
    })) as QueueTicket[];

    const byCompletedAtDesc = (left: QueueTicket, right: QueueTicket) =>
      new Date(right.completed_at ?? 0).getTime() - new Date(left.completed_at ?? 0).getTime();

    setQueue({
      issued: tickets.filter((ticket) => ticket.status === 'issued'),
      waiting: tickets.filter((ticket) => ticket.status === 'waiting'),
      called: tickets.filter((ticket) => ticket.status === 'called'),
      serving: tickets.filter((ticket) => ticket.status === 'serving'),
      recentlyServed: tickets.filter((ticket) => ticket.status === 'served').sort(byCompletedAtDesc).slice(0, 6),
      cancelled: tickets.filter((ticket) => ticket.status === 'cancelled').sort(byCompletedAtDesc).slice(0, 6),
      noShows: tickets.filter((ticket) => ticket.status === 'no_show').sort(byCompletedAtDesc).slice(0, 6),
      transferred: tickets.filter((ticket) => ticket.status === 'transferred').sort(byCompletedAtDesc).slice(0, 6),
    });
    setError(null);
  }, [officeId, departmentId]);

  useEffect(() => {
    const supabase = supabaseRef.current;

    setIsLoading(true);
    fetchQueue().finally(() => setIsLoading(false));

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
          if (departmentId) {
            const changed = (payload.new ?? payload.old) as Database['public']['Tables']['tickets']['Row'] | undefined;
            if (changed && changed.department_id !== departmentId) return;
          }
          void fetchQueue();
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          void fetchQueue();
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[RealtimeQueue] Subscription degraded:', status, '— falling back to polling.');
          void fetchQueue();
        }
      });

    channelRef.current = channel;

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        window.setTimeout(() => {
          void fetchQueue();
        }, 300);
      }
    };

    const handleOnline = () => {
      void fetchQueue();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', handleOnline);

    const pollInterval = setInterval(() => {
      void fetchQueue();
    }, 2000);

    return () => {
      clearInterval(pollInterval);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', handleOnline);
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
