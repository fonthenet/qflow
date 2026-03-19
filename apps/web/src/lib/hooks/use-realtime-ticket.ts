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

  const fetchPositionAndWait = useCallback(async () => {
    const supabase = supabaseRef.current;
    try {
      const { data } = await supabase.rpc('get_queue_position', {
        p_ticket_id: ticketId,
      });

      // Extract position + wait from whatever format the RPC returns:
      // - JSONB object: { position: N, estimated_wait_minutes: N, ... }
      // - Plain integer: N (legacy)
      // - String-wrapped number: "3" (edge case)
      let pos: number | null = null;
      let wait: number | null = null;

      if (data && typeof data === 'object' && !Array.isArray(data)) {
        const obj = data as Record<string, unknown>;
        const rawPos = obj.position;
        const rawWait = obj.estimated_wait_minutes;
        if (rawPos != null && !isNaN(Number(rawPos))) pos = Number(rawPos);
        if (rawWait != null && !isNaN(Number(rawWait))) wait = Number(rawWait);
      } else if (data != null && !isNaN(Number(data))) {
        pos = Number(data);
      }

      if (pos !== null) setPosition(pos);
      if (wait !== null) setEstimatedWait(wait);
      setLastSyncedAt(new Date());
    } catch {
      // Silently handle - position will remain stale
    }
  }, [ticketId]);

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
      await fetchPositionAndWait();
    } else {
      setPosition(null);
      setEstimatedWait(null);
    }
  }, [disabled, fetchPositionAndWait, initialData, sandboxEstimatedWait, sandboxPosition, ticketId]);

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
      fetchPositionAndWait();
    }
  }, [disabled, ticket.status, ticket.service_id, fetchPositionAndWait]);

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
            fetchPositionAndWait();
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

    // Channel 2: Listen for ANY ticket status change in same service
    // This triggers position refresh when someone ahead gets called/served
    const serviceChannel = supabase
      .channel(`service-queue-${ticket.service_id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'tickets',
          filter: `service_id=eq.${ticket.service_id}`,
        },
        (payload) => {
          const changed = payload.new as Ticket;
          // Only refresh if a different ticket changed status (not ours)
          if (changed.id !== ticketId && ticket.status === 'waiting') {
            fetchPositionAndWait();
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

    channelsRef.current = [ticketChannel, serviceChannel, broadcastChannel];

    // Polling fallback: refresh ticket + position every 3s to guarantee updates
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
              fetchPositionAndWait();
            } else if (data.status !== (ticket as Ticket).status) {
              setPosition(null);
              setEstimatedWait(null);
            }
          }
        });
    }, 3000);

    return () => {
      clearInterval(pollInterval);
      channelsRef.current.forEach((ch) => supabase.removeChannel(ch));
      channelsRef.current = [];
    };
  }, [disabled, ticketId, qrToken, ticket.status, ticket.service_id, fetchPositionAndWait]);

  return { ticket, position, estimatedWait, isUpdating, broadcast, lastSyncedAt, refresh };
}
