'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface DisplayBoardProps {
  screen: any;
  office: any;
  departments: any[];
  initialActiveTickets: any[];
  initialWaitingTickets: any[];
}

export function DisplayBoard({
  screen,
  office,
  departments,
  initialActiveTickets,
  initialWaitingTickets,
}: DisplayBoardProps) {
  const [activeTickets, setActiveTickets] = useState(initialActiveTickets);
  const [waitingTickets, setWaitingTickets] = useState(initialWaitingTickets);
  const [lastCalledTicket, setLastCalledTicket] = useState<any>(null);
  const [showAnnouncement, setShowAnnouncement] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Update clock every second
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Subscribe to real-time ticket changes
  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`display-${screen.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tickets',
          filter: `office_id=eq.${office.id}`,
        },
        async (payload) => {
          // Refresh active tickets
          const { data: active } = await supabase
            .from('tickets')
            .select('*, desk:desks(name, display_name), service:services(name)')
            .eq('office_id', office.id)
            .in('status', ['called', 'serving'])
            .order('called_at', { ascending: false });

          const { data: waiting } = await supabase
            .from('tickets')
            .select('id, department_id, ticket_number, created_at')
            .eq('office_id', office.id)
            .eq('status', 'waiting')
            .order('created_at');

          if (active) setActiveTickets(active);
          if (waiting) setWaitingTickets(waiting);

          // Show announcement for newly called tickets
          if (
            payload.eventType === 'UPDATE' &&
            (payload.new as any).status === 'called'
          ) {
            const calledTicket = active?.find(
              (t) => t.id === (payload.new as any).id
            );
            if (calledTicket) {
              setLastCalledTicket(calledTicket);
              setShowAnnouncement(true);
              // Play chime sound
              try {
                const audio = new Audio('/sounds/chime.mp3');
                audio.play().catch(() => {});
              } catch {}
              // Hide announcement after 8 seconds
              setTimeout(() => setShowAnnouncement(false), 8000);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [office.id, screen.id]);

  const nowServing = activeTickets.filter(
    (t) => t.status === 'called' || t.status === 'serving'
  );

  const waitingByDept = departments.map((dept) => ({
    ...dept,
    count: waitingTickets.filter((t) => t.department_id === dept.id).length,
  }));

  return (
    <div className="min-h-screen bg-[#0a1628] text-white overflow-hidden">
      {/* Announcement overlay */}
      {showAnnouncement && lastCalledTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 animate-pulse">
          <div className="text-center space-y-4">
            <p className="text-3xl font-medium text-blue-400">Now Calling</p>
            <p className="text-[10rem] font-black leading-none text-white">
              {lastCalledTicket.ticket_number}
            </p>
            <p className="text-4xl font-medium text-green-400">
              Go to:{' '}
              {lastCalledTicket.desk?.display_name ||
                lastCalledTicket.desk?.name ||
                'Counter'}
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between bg-[#0f1f3d] px-8 py-4">
        <div>
          <h1 className="text-2xl font-bold">
            {office.organization?.name || 'QueueFlow'}
          </h1>
          <p className="text-blue-300">{office.name}</p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-mono font-bold">
            {currentTime.toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
          <p className="text-sm text-blue-300">
            {currentTime.toLocaleDateString([], {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-0 h-[calc(100vh-80px)]">
        {/* Now Serving - Takes 2/3 of the screen */}
        <div className="col-span-2 p-6">
          <h2 className="mb-6 text-xl font-semibold text-blue-400 uppercase tracking-wider">
            Now Serving
          </h2>
          <div className="grid grid-cols-2 gap-4">
            {nowServing.length === 0 ? (
              <div className="col-span-2 flex items-center justify-center py-20">
                <p className="text-2xl text-gray-500">No customers being served</p>
              </div>
            ) : (
              nowServing.map((ticket) => (
                <div
                  key={ticket.id}
                  className={`rounded-xl p-6 ${
                    ticket.status === 'called'
                      ? 'bg-green-500/20 border-2 border-green-500 animate-pulse'
                      : 'bg-blue-500/10 border border-blue-500/30'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-5xl font-black">
                        {ticket.ticket_number}
                      </p>
                      <p className="mt-1 text-sm text-gray-400">
                        {ticket.service?.name}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-medium text-blue-300">
                        {ticket.desk?.display_name || ticket.desk?.name}
                      </p>
                      <p
                        className={`mt-1 text-xs font-medium uppercase ${
                          ticket.status === 'called'
                            ? 'text-green-400'
                            : 'text-blue-400'
                        }`}
                      >
                        {ticket.status === 'called' ? 'Go Now' : 'Serving'}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Waiting Queue Summary - 1/3 of screen */}
        <div className="border-l border-gray-800 bg-[#0c1a30] p-6">
          <h2 className="mb-6 text-xl font-semibold text-blue-400 uppercase tracking-wider">
            Queue Status
          </h2>
          <div className="space-y-4">
            {waitingByDept.map((dept) => (
              <div
                key={dept.id}
                className="rounded-lg bg-[#0f1f3d] p-4"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-lg font-semibold">{dept.name}</p>
                    <p className="text-sm text-gray-400">{dept.code}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-3xl font-bold text-yellow-400">
                      {dept.count}
                    </p>
                    <p className="text-xs text-gray-400">waiting</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Next up list */}
          <div className="mt-8">
            <h3 className="mb-4 text-sm font-semibold text-gray-400 uppercase tracking-wider">
              Next Up
            </h3>
            <div className="space-y-2">
              {waitingTickets.slice(0, 8).map((ticket) => (
                <div
                  key={ticket.id}
                  className="flex items-center justify-between rounded-lg bg-[#0f1f3d] px-4 py-2"
                >
                  <span className="font-mono font-bold">
                    {ticket.ticket_number}
                  </span>
                  <span className="text-xs text-gray-500">
                    {new Date(ticket.created_at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
