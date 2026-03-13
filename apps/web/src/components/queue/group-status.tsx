'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface GroupTicket {
  id: string;
  ticket_number: string;
  status: string;
  service_id: string;
  department_id: string;
  office_id: string;
  desk_id: string | null;
  group_id: string;
  customer_data: Record<string, unknown> | null;
  created_at: string | null;
  called_at: string | null;
  serving_started_at: string | null;
  completed_at: string | null;
}

interface GroupStatusProps {
  groupId: string;
  currentTicketId: string;
  officeName: string;
}

const STATUS_CONFIG: Record<
  string,
  { label: string; bgClass: string; textClass: string; dotClass: string }
> = {
  waiting: {
    label: 'Waiting',
    bgClass: 'bg-muted',
    textClass: 'text-muted-foreground',
    dotClass: 'bg-muted-foreground',
  },
  called: {
    label: 'YOUR TURN',
    bgClass: 'bg-warning/10',
    textClass: 'text-warning',
    dotClass: 'bg-warning animate-pulse',
  },
  serving: {
    label: 'Being Served',
    bgClass: 'bg-success/10',
    textClass: 'text-success',
    dotClass: 'bg-success animate-pulse',
  },
  served: {
    label: 'Completed',
    bgClass: 'bg-primary/10',
    textClass: 'text-primary',
    dotClass: 'bg-primary',
  },
  no_show: {
    label: 'No Show',
    bgClass: 'bg-destructive/10',
    textClass: 'text-destructive',
    dotClass: 'bg-destructive',
  },
  cancelled: {
    label: 'Cancelled',
    bgClass: 'bg-muted',
    textClass: 'text-muted-foreground',
    dotClass: 'bg-muted-foreground',
  },
  transferred: {
    label: 'Transferred',
    bgClass: 'bg-muted',
    textClass: 'text-muted-foreground',
    dotClass: 'bg-muted-foreground',
  },
};

export function GroupStatus({
  groupId,
  currentTicketId: _currentTicketId,
  officeName,
}: GroupStatusProps) {
  const [groupTickets, setGroupTickets] = useState<GroupTicket[]>([]);
  const [services, setServices] = useState<Record<string, string>>({});
  const [desks, setDesks] = useState<Record<string, string>>({});
  const [positions, setPositions] = useState<Record<string, number | null>>({});
  const [isLoading, setIsLoading] = useState(true);

  // Fetch all group tickets and subscribe to changes
  useEffect(() => {
    const supabase = createClient();

    async function fetchGroup() {
      const { data: tickets } = await supabase
        .from('tickets')
        .select('*')
        .eq('group_id', groupId)
        .order('daily_sequence', { ascending: true });

      if (tickets) {
        setGroupTickets(tickets as GroupTicket[]);

        // Fetch service names
        const serviceIds = [...new Set(tickets.map((t) => t.service_id))];
        const { data: svcData } = await supabase
          .from('services')
          .select('id, name')
          .in('id', serviceIds);

        if (svcData) {
          const map: Record<string, string> = {};
          svcData.forEach((s) => (map[s.id] = s.name));
          setServices(map);
        }

        // Fetch desk names for called/serving tickets
        const deskIds = tickets
          .filter((t) => t.desk_id)
          .map((t) => t.desk_id!)
          .filter((id, i, arr) => arr.indexOf(id) === i);

        if (deskIds.length > 0) {
          const { data: deskData } = await supabase
            .from('desks')
            .select('id, name, display_name')
            .in('id', deskIds);

          if (deskData) {
            const dMap: Record<string, string> = {};
            deskData.forEach(
              (d) => (dMap[d.id] = d.display_name ?? d.name)
            );
            setDesks(dMap);
          }
        }

        // Fetch positions for waiting tickets
        const posMap: Record<string, number | null> = {};
        for (const t of tickets) {
          if (t.status === 'waiting') {
            const { count } = await supabase
              .from('tickets')
              .select('*', { count: 'exact', head: true })
              .eq('department_id', t.department_id)
              .eq('office_id', t.office_id)
              .eq('status', 'waiting')
              .lt('created_at', t.created_at!);
            posMap[t.id] = count !== null ? count + 1 : null;
          }
        }
        setPositions(posMap);
      }

      setIsLoading(false);
    }

    fetchGroup();

    // Subscribe to realtime changes for this group
    const channel = supabase
      .channel(`group-${groupId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tickets',
          filter: `group_id=eq.${groupId}`,
        },
        () => {
          // Refetch on any change
          fetchGroup();
        }
      )
      .subscribe();

    // Poll positions every 15 seconds
    const interval = setInterval(fetchGroup, 15000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [groupId]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted p-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const calledTicket = groupTickets.find((t) => t.status === 'called');
  const servingTicket = groupTickets.find((t) => t.status === 'serving');
  const highlightedTicket = calledTicket || servingTicket;

  return (
    <div className="flex min-h-screen flex-col bg-muted">
      {/* Header */}
      <div className="bg-primary px-4 pb-6 pt-6 text-primary-foreground">
        <div className="mx-auto max-w-sm">
          <p className="text-sm font-medium opacity-80">{officeName}</p>
          <p className="text-xs opacity-60">
            Group of {groupTickets.length} tickets
          </p>
        </div>
      </div>

      <div className="mx-auto w-full max-w-sm flex-1 px-4">
        {/* Highlighted ticket if someone is called */}
        {highlightedTicket && (
          <div className="-mt-8 mb-4 rounded-xl border-2 border-warning bg-card p-5 text-center shadow-lg animate-pulse">
            <p className="text-xs font-bold uppercase tracking-wider text-warning mb-1">
              {highlightedTicket.status === 'called' ? 'YOUR TURN' : 'Being Served'}
            </p>
            <p className="text-4xl font-black text-foreground">
              {highlightedTicket.ticket_number}
            </p>
            {highlightedTicket.customer_data &&
              typeof highlightedTicket.customer_data === 'object' &&
              'name' in highlightedTicket.customer_data && (
                <p className="text-sm font-medium text-foreground mt-1">
                  {String(highlightedTicket.customer_data.name)}
                </p>
              )}
            {highlightedTicket.desk_id && desks[highlightedTicket.desk_id] && (
              <div className="mt-3 rounded-lg bg-warning/10 p-3">
                <p className="text-xs text-muted-foreground">Go to</p>
                <p className="text-xl font-bold text-warning">
                  {desks[highlightedTicket.desk_id]}
                </p>
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              {services[highlightedTicket.service_id] ?? 'Service'}
            </p>
          </div>
        )}

        {/* If no one is highlighted, show a spacer */}
        {!highlightedTicket && <div className="-mt-8 mb-4" />}

        {/* Group tickets list */}
        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            All Group Tickets
          </p>

          {groupTickets.map((t, index) => {
            const config = STATUS_CONFIG[t.status] ?? STATUS_CONFIG.waiting;
            const isHighlighted =
              t.status === 'called' || t.status === 'serving';
            const personName =
              t.customer_data &&
              typeof t.customer_data === 'object' &&
              'name' in t.customer_data
                ? String(t.customer_data.name)
                : `Person ${index + 1}`;

            return (
              <div
                key={t.id}
                className={`rounded-xl bg-card p-4 shadow-sm transition-all ${
                  isHighlighted
                    ? 'ring-2 ring-warning shadow-md'
                    : 'border border-border'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-foreground">
                      {t.ticket_number}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${config.bgClass} ${config.textClass}`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${config.dotClass}`}
                      />
                      {config.label}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{personName}</span>
                  <span>{services[t.service_id] ?? 'Service'}</span>
                </div>

                {t.status === 'waiting' && positions[t.id] !== undefined && (
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-700"
                        style={{
                          width: `${Math.max(
                            5,
                            Math.min(
                              95,
                              ((10 - (positions[t.id] ?? 10)) / 10) * 100
                            )
                          )}%`,
                        }}
                      />
                    </div>
                    <span className="text-xs font-semibold text-foreground">
                      #{positions[t.id]}
                    </span>
                  </div>
                )}

                {(t.status === 'called' || t.status === 'serving') &&
                  t.desk_id &&
                  desks[t.desk_id] && (
                    <p className="mt-2 text-xs font-semibold text-warning">
                      Go to: {desks[t.desk_id]}
                    </p>
                  )}
              </div>
            );
          })}
        </div>

        {/* Waiting message */}
        <div className="mt-6 flex flex-col items-center py-4">
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-primary [animation-delay:0ms]" />
            <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-primary [animation-delay:150ms]" />
            <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-primary [animation-delay:300ms]" />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Tracking your group tickets...
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Keep this page open. We&apos;ll notify you when it&apos;s your turn.
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 pb-6 pt-4 text-center">
        <p className="text-xs text-muted-foreground">Powered by QueueFlow</p>
      </div>
    </div>
  );
}
