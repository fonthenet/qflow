'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import type { RealtimeChannel } from '@supabase/supabase-js';

type Ticket = Database['public']['Tables']['tickets']['Row'];

interface BroadcastPayload {
  type: string;
  message?: string;
  [key: string]: unknown;
}

interface UseRealtimeTicketOptions {
  ticketId: string;
  qrToken: string;
  initialData: Ticket;
  disabled?: boolean;
  sandboxPosition?: number | null;
  sandboxEstimatedWait?: number | null;
}

interface UseRealtimeTicketReturn {
  ticket: Ticket;
  position: number | null;
  estimatedWait: number | null;
  isUpdating: boolean;
  broadcast: BroadcastPayload | null;
  lastSyncedAt: Date | null;
  refresh: () => Promise<void>;
}

export function useRealtimeTicket({
  ticketId,
  qrToken,
  initialData,
  disabled = false,
  sandboxPosition = null,
  sandboxEstimatedWait = null,
}: UseRealtimeTicketOptions): UseRealtimeTicketReturn {
  const [ticket, setTicket] = useState<Ticket>(initialData);
  const [position, setPosition] = useState<number | null>(sandboxPosition);
  const [estimatedWait, setEstimatedWait] = useState<number | null>(sandboxEstimatedWait);
  const [isUpdating, setIsUpdating] = useState(false);
  const [broadcast, setBroadcast] = useState<BroadcastPayload | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const channelsRef = useRef<RealtimeChannel[]>([]);
  const supabaseRef = useRef(createClient());

  const fetchPosition = useCallback(async () => {
    const supabase = supabaseRef.current;
    try {
      const { data } = await supabase.rpc('get_queue_position', {
        p_ticket_id: ticketId,
      });
      if (data !== null && data !== undefined) {
        setPosition(data);
        setLastSyncedAt(new Date());
      }
    } catch {
      // Silently handle - position will remain stale
    }
  }, [ticketId]);

  const fetchWaitTime = useCallback(async (departmentId: string, serviceId: string) => {
    const supabase = supabaseRef.current;
    try {
      const { data } = await supabase.rpc('estimate_wait_time', {
        p_department_id: departmentId,
        p_service_id: serviceId,
      });
      if (data !== null && data !== undefined) {
        setEstimatedWait(data);
        setLastSyncedAt(new Date());
      }
    } catch {
      // Silently handle
    }
  }, []);

  const refresh = useCallback(async () => {
    if (disabled) {
      setTicket(initialData);
      setPosition(sandboxPosition);
      setEstimatedWait(sandboxEstimatedWait);
      setLastSyncedAt(new Date());
      return;
    }

    const supabase = supabaseRef.current;
    const { data } = await supabase
      .from('tickets')
      .select('*')
      .eq('id', ticketId)
      .single();

    if (!data) return;

    setTicket(data as Ticket);
    setLastSyncedAt(new Date());

    if (data.status === 'waiting') {
      await Promise.all([
        fetchPosition(),
        fetchWaitTime(data.department_id, data.service_id),
      ]);
    } else {
      setPosition(null);
      setEstimatedWait(null);
    }
  }, [disabled, fetchPosition, fetchWaitTime, initialData, sandboxEstimatedWait, sandboxPosition, ticketId]);

  useEffect(() => {
    if (!disabled) return;
    setTicket(initialData);
    setPosition(sandboxPosition);
    setEstimatedWait(sandboxEstimatedWait);
    setLastSyncedAt(new Date());
  }, [disabled, initialData, sandboxEstimatedWait, sandboxPosition]);

  // Fetch initial position and wait time for waiting tickets
  useEffect(() => {
    if (disabled) return;
    if (ticket.status === 'waiting') {
      fetchPosition();
      fetchWaitTime(ticket.department_id, ticket.service_id);
    }
  }, [disabled, ticket.status, ticket.department_id, ticket.service_id, fetchPosition, fetchWaitTime]);

  // Refetch when page returns to foreground (mobile browsers suspend WebSockets when backgrounded)
  useEffect(() => {
    if (disabled) return;
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Small delay to let network reconnect
        setTimeout(() => {
          void refresh();
        }, 300);
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [disabled, refresh]);

  // Subscribe to realtime changes
  useEffect(() => {
    if (disabled) return;
    const supabase = supabaseRef.current;

    // Channel 1: Listen for row-level changes on the tickets table
    const ticketChannel = supabase
      .channel(`ticket-row-${ticketId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'tickets',
          filter: `id=eq.${ticketId}`,
        },
        (payload) => {
          setIsUpdating(true);
          const newTicket = payload.new as Ticket;
          setTicket(newTicket);
          setLastSyncedAt(new Date());

          // Refresh position if still waiting
          if (newTicket.status === 'waiting') {
            fetchPosition();
            fetchWaitTime(newTicket.department_id, newTicket.service_id);
          } else {
            setPosition(null);
            setEstimatedWait(null);
          }

          setTimeout(() => setIsUpdating(false), 500);
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[RealtimeTicket] Subscription failed:', status, '— polling fallback active');
        }
      });

    // Channel 2: Listen for ANY ticket status change in same department
    // This triggers position refresh when someone ahead gets called/served
    const deptChannel = supabase
      .channel(`dept-queue-${ticket.department_id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'tickets',
          filter: `department_id=eq.${ticket.department_id}`,
        },
        (payload) => {
          const changed = payload.new as Ticket;
          // Only refresh if a different ticket changed status (not ours)
          if (changed.id !== ticketId && ticket.status === 'waiting') {
            fetchPosition();
            fetchWaitTime(ticket.department_id, ticket.service_id);
          }
        }
      )
      .subscribe();

    // Channel 3: Broadcast channel for direct messages (e.g., custom notifications)
    const broadcastChannel = supabase
      .channel(`ticket:${qrToken}`)
      .on('broadcast', { event: 'notification' }, (payload) => {
        setBroadcast(payload.payload as BroadcastPayload);
      })
      .subscribe();

    channelsRef.current = [ticketChannel, deptChannel, broadcastChannel];

    // Polling fallback: refresh ticket + position every 5s to guarantee updates
    // even if realtime WebSocket is down (e.g., env vars not baked into client bundle)
    const pollInterval = setInterval(() => {
      supabase
        .from('tickets')
        .select('*')
        .eq('id', ticketId)
        .single()
        .then(({ data }) => {
          if (data) {
            setTicket((prev) => {
              if (JSON.stringify(prev) !== JSON.stringify(data)) {
                setLastSyncedAt(new Date());
                return data as Ticket;
              }
              return prev;
            });
            if (data.status === 'waiting') {
              fetchPosition();
              fetchWaitTime(data.department_id, data.service_id);
            } else if (data.status !== (ticket as Ticket).status) {
              setPosition(null);
              setEstimatedWait(null);
            }
          }
        });
    }, 5000);

    return () => {
      clearInterval(pollInterval);
      channelsRef.current.forEach((ch) => supabase.removeChannel(ch));
      channelsRef.current = [];
    };
  }, [disabled, ticketId, qrToken, ticket.status, ticket.department_id, ticket.service_id, fetchPosition, fetchWaitTime]);

  return { ticket, position, estimatedWait, isUpdating, broadcast, lastSyncedAt, refresh };
}
