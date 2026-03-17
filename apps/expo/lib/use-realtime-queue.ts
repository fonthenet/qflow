import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

export interface QueueTicket {
  id: string;
  ticket_number: string;
  status: string;
  customer_data: { name?: string; phone?: string; email?: string } | null;
  priority_category_id: string | null;
  priority: number | null;
  created_at: string;
  called_at: string | null;
  serving_started_at: string | null;
  completed_at: string | null;
  desk_id: string | null;
  office_id: string;
  service_id: string | null;
  department_id: string | null;
  called_by_staff_id: string | null;
  recall_count: number;
  estimated_wait_minutes: number | null;
  is_remote: boolean | null;
  appointment_id: string | null;
  notes: string | null;
  parked_at: string | null;
  transferred_from_ticket_id: string | null;
  qr_token: string | null;
}

export interface QueueData {
  waiting: QueueTicket[];
  called: QueueTicket[];
  serving: QueueTicket[];
  recentlyServed: QueueTicket[];
  cancelled: QueueTicket[];
  parked: QueueTicket[];
  all: QueueTicket[];
}

interface UseRealtimeQueueOptions {
  officeId: string | null;
  departmentId?: string | null;
  enabled?: boolean;
}

const EMPTY: QueueData = { waiting: [], called: [], serving: [], recentlyServed: [], cancelled: [], parked: [], all: [] };

export function useRealtimeQueue({ officeId, departmentId, enabled = true }: UseRealtimeQueueOptions) {
  const [queue, setQueue] = useState<QueueData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const fetchQueue = useCallback(async () => {
    if (!officeId) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString();

    let query = supabase
      .from('tickets')
      .select('id, ticket_number, status, customer_data, priority_category_id, priority, created_at, called_at, serving_started_at, completed_at, desk_id, office_id, service_id, department_id, called_by_staff_id, recall_count, estimated_wait_minutes, is_remote, appointment_id, notes, parked_at, transferred_from_ticket_id, qr_token')
      .eq('office_id', officeId)
      .gte('created_at', todayISO)
      .in('status', ['waiting', 'called', 'serving', 'served', 'no_show', 'cancelled'])
      .order('priority', { ascending: false, nullsFirst: true })
      .order('created_at', { ascending: true });

    if (departmentId) {
      query = query.eq('department_id', departmentId);
    }

    const { data, error } = await query;
    if (error) {
      console.warn('fetchQueue error:', error.message);
      return;
    }

    const tickets = (data ?? []) as QueueTicket[];

    const waiting = tickets.filter(t => t.status === 'waiting' && !t.parked_at);
    const called = tickets.filter(t => t.status === 'called' && !t.parked_at);
    const serving = tickets.filter(t => t.status === 'serving' && !t.parked_at);
    const parked = tickets.filter(t => t.parked_at != null && (t.status === 'called' || t.status === 'serving' || t.status === 'waiting'));
    const recentlyServed = tickets.filter(t => t.status === 'served').slice(-5).reverse();
    const cancelled = tickets.filter(t => t.status === 'no_show' || t.status === 'cancelled').slice(-5).reverse();

    setQueue({ waiting, called, serving, recentlyServed, cancelled, parked, all: tickets });
    setLoading(false);
  }, [officeId, departmentId]);

  // Supabase Realtime subscription
  useEffect(() => {
    if (!officeId || !enabled) return;

    fetchQueue();

    const channel = supabase
      .channel(`queue-${officeId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tickets',
          filter: `office_id=eq.${officeId}`,
        },
        () => {
          fetchQueue();
        }
      )
      .subscribe();

    channelRef.current = channel;

    // Polling fallback every 3 seconds
    const interval = setInterval(fetchQueue, 3000);

    return () => {
      clearInterval(interval);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [officeId, enabled, fetchQueue]);

  return { queue, loading, refresh: fetchQueue };
}

// Name lookup cache
export interface NameLookup {
  offices: Record<string, string>;
  departments: Record<string, string>;
  services: Record<string, string>;
  desks: Record<string, string>;
  staff: Record<string, string>;
  priorities: Record<string, { name: string; icon: string | null; color: string | null }>;
}

export function useNameLookup(orgId: string | null, officeIds: string[]) {
  const [names, setNames] = useState<NameLookup>({
    offices: {}, departments: {}, services: {}, desks: {}, staff: {}, priorities: {},
  });

  useEffect(() => {
    if (!orgId || officeIds.length === 0) return;

    const load = async () => {
      const [offices, depts, svcs, desks, staffData, priorities] = await Promise.all([
        supabase.from('offices').select('id, name').eq('organization_id', orgId),
        supabase.from('departments').select('id, name').in('office_id', officeIds),
        supabase.from('services').select('id, name').in('office_id', officeIds),
        supabase.from('desks').select('id, name').in('office_id', officeIds),
        supabase.from('staff').select('id, full_name').eq('organization_id', orgId),
        supabase.from('priority_categories').select('id, name, icon, color').eq('organization_id', orgId),
      ]);

      const map = (arr: any[] | null) => {
        const m: Record<string, string> = {};
        (arr ?? []).forEach((r: any) => { m[r.id] = r.name ?? r.full_name; });
        return m;
      };

      const prioMap: Record<string, { name: string; icon: string | null; color: string | null }> = {};
      (priorities.data ?? []).forEach((p: any) => { prioMap[p.id] = { name: p.name, icon: p.icon, color: p.color }; });

      setNames({
        offices: map(offices.data),
        departments: map(depts.data),
        services: map(svcs.data),
        desks: map(desks.data),
        staff: map(staffData.data),
        priorities: prioMap,
      });
    };

    load();
  }, [orgId, officeIds.join(',')]);

  return names;
}
