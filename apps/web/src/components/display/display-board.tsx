'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

interface ScreenSettings {
  announcement_sound?: boolean;
  announcement_duration?: number;
}

interface DisplayBoardProps {
  screen: any;
  office: any;
  departments: any[];
  initialActiveTickets: any[];
  initialWaitingTickets: any[];
  initialServedTodayCount?: number;
  calledTicketCountdownSeconds?: number;
  sandboxMode?: boolean;
}

function getCalledTicketRemainingSeconds(
  ticket: any,
  now: Date,
  calledTicketCountdownSeconds: number
) {
  if (!ticket.called_at) return 0;
  const elapsedSeconds = Math.max(
    0,
    Math.floor((now.getTime() - new Date(ticket.called_at).getTime()) / 1000)
  );
  return Math.max(0, calledTicketCountdownSeconds - elapsedSeconds);
}

function formatWait(createdAt: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000));
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function getTicketCustomerName(customerData: unknown) {
  if (!customerData || typeof customerData !== 'object' || Array.isArray(customerData)) {
    return '';
  }

  const data = customerData as Record<string, unknown>;
  const keys = ['name', 'full_name', 'customer_name', 'patient_name', 'guest_name', 'party_name'] as const;
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

export function DisplayBoard({
  screen,
  office,
  initialActiveTickets,
  initialWaitingTickets,
  initialServedTodayCount = 0,
  calledTicketCountdownSeconds = 0,
  sandboxMode = false,
}: DisplayBoardProps) {
  const [displayScreen, setDisplayScreen] = useState(screen);
  const [activeTickets, setActiveTickets] = useState(initialActiveTickets);
  const [waitingTickets, setWaitingTickets] = useState(initialWaitingTickets);
  const [servedTodayCount, setServedTodayCount] = useState(initialServedTodayCount);
  const [lastCalledTicket, setLastCalledTicket] = useState<any>(null);
  const [showAnnouncement, setShowAnnouncement] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const knownCalledAnchorsRef = useRef<Map<string, string>>(new Map());

  const settings: ScreenSettings = displayScreen.settings ?? {};
  const announcementSound = settings.announcement_sound ?? true;
  const announcementDuration = (settings.announcement_duration ?? 8) * 1000;

  const updateCalledAnchors = useMemo(
    () => (tickets: any[]) => {
      const nextMap = new Map<string, string>();
      for (const ticket of tickets) {
        if (ticket.status === 'called' && ticket.called_at) {
          nextMap.set(ticket.id, ticket.called_at);
        }
      }
      return nextMap;
    },
    []
  );

  useEffect(() => {
    knownCalledAnchorsRef.current = updateCalledAnchors(initialActiveTickets);
  }, [initialActiveTickets, updateCalledAnchors]);

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (sandboxMode) return;

    const refreshData = async () => {
      try {
        const response = await fetch(`/api/display-status/${displayScreen.screen_token}`, {
          cache: 'no-store',
        });
        if (!response.ok) return;

        const data = await response.json();
        const nextActive = Array.isArray(data.activeTickets) ? data.activeTickets : [];
        const nextWaiting = Array.isArray(data.waitingTickets) ? data.waitingTickets : [];
        const nextScreen = data.screen ?? displayScreen;
        const nextCalledAnchors = updateCalledAnchors(nextActive);

        for (const ticket of nextActive) {
          if (ticket.status !== 'called' || !ticket.called_at) continue;
          const previousCalledAt = knownCalledAnchorsRef.current.get(ticket.id);
          if (!previousCalledAt || previousCalledAt !== ticket.called_at) {
            setLastCalledTicket(ticket);
            setShowAnnouncement(true);
            if ((nextScreen.settings?.announcement_sound ?? announcementSound) === true) {
              try {
                const audio = new Audio('/sounds/chime.mp3');
                audio.play().catch(() => {});
              } catch {}
            }
            window.setTimeout(
              () => setShowAnnouncement(false),
              ((nextScreen.settings?.announcement_duration ?? (announcementDuration / 1000)) as number) * 1000
            );
            break;
          }
        }

        knownCalledAnchorsRef.current = nextCalledAnchors;
        setDisplayScreen(nextScreen);
        setActiveTickets(nextActive);
        setWaitingTickets(nextWaiting);
        setServedTodayCount(typeof data.servedTodayCount === 'number' ? data.servedTodayCount : 0);
      } catch (error) {
        console.warn('[Display] Failed to refresh display status', error);
      }
    };

    refreshData();
    const pollInterval = setInterval(refreshData, 4000);
    return () => clearInterval(pollInterval);
  }, [announcementDuration, announcementSound, displayScreen.screen_token, sandboxMode, updateCalledAnchors]);

  const visibleActiveTickets = activeTickets.filter((ticket) => {
    if (ticket.status === 'serving') return true;
    if (ticket.status !== 'called') return false;
    return getCalledTicketRemainingSeconds(ticket, currentTime, calledTicketCountdownSeconds) > 0;
  });

  const waitingCount = waitingTickets.length;
  const calledCount = visibleActiveTickets.filter((ticket) => ticket.status === 'called').length;
  const servingCount = visibleActiveTickets.filter((ticket) => ticket.status === 'serving').length;

  return (
    <div
      className="min-h-screen"
      style={{
        background: '#f8fafc',
        color: '#0f172a',
        fontFamily: `-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif`,
      }}
    >
      {showAnnouncement && lastCalledTicket ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(255,255,255,0.97)' }}
        >
          <div className="text-center">
            <div className="text-3xl font-bold uppercase tracking-[0.3em]" style={{ color: '#3b82f6' }}>
              Now Calling
            </div>
            <div className="mt-6 text-[9rem] font-black leading-none tracking-[-0.08em]">
              {lastCalledTicket.ticket_number}
            </div>
            <div className="mt-4 text-4xl font-bold" style={{ color: '#16a34a' }}>
              Go to {lastCalledTicket.desk?.display_name || lastCalledTicket.desk?.name || 'Desk'}
            </div>
          </div>
        </div>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '16px 32px',
            background: '#fff',
            borderBottom: '2px solid #e2e8f0',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {office.organization?.logo_url ? (
              <div
                style={{
                  width: 56,
                  height: 56,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  flexShrink: 0,
                }}
              >
                <img
                  src={office.organization.logo_url}
                  alt={`${office.organization?.name || 'Business'} logo`}
                  style={{ height: 56, width: 'auto', objectFit: 'contain' }}
                />
              </div>
            ) : (
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 14,
                  background: '#3b82f6',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 900,
                  fontSize: 28,
                }}
              >
                Q
              </div>
            )}
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#1e293b' }}>
                {office.organization?.name || office.name}
              </div>
              <div style={{ fontSize: 14, color: '#64748b', fontWeight: 500 }}>
                {office.organization?.name ? office.name : office.organization?.name || office.name}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 14px',
                borderRadius: 20,
                fontSize: 12,
                fontWeight: 700,
                background: '#d1fae5',
                color: '#065f46',
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: '#22c55e',
                }}
              />
              Connected
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 42, fontWeight: 800, color: '#0f172a', lineHeight: 1 }}>
                {currentTime.toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </div>
              <div style={{ fontSize: 15, color: '#64748b', fontWeight: 500, marginTop: 2 }}>
                {currentTime.toLocaleDateString([], {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', background: '#fff', borderBottom: '1px solid #e2e8f0' }}>
          {[
            { label: 'Waiting', value: waitingCount, color: '#f59e0b' },
            { label: 'Called', value: calledCount, color: '#3b82f6' },
            { label: 'Serving', value: servingCount, color: '#22c55e' },
            { label: 'Served Today', value: servedTodayCount, color: '#64748b' },
          ].map((stat, index) => (
            <div
              key={stat.label}
              style={{
                flex: 1,
                padding: '12px 24px',
                textAlign: 'center',
                borderRight: index < 3 ? '1px solid #e2e8f0' : 'none',
              }}
            >
              <div style={{ fontSize: 36, fontWeight: 800, color: stat.color }}>{stat.value}</div>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: 2,
                  color: '#94a3b8',
                  marginTop: 4,
                }}
              >
                {stat.label}
              </div>
            </div>
          ))}
        </div>

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <div
            style={{
              flex: 55,
              display: 'flex',
              flexDirection: 'column',
              borderRight: '2px solid #e2e8f0',
              background: '#fff',
            }}
          >
            <div
              style={{
                padding: '18px 24px 14px',
                fontSize: 18,
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: 3,
                color: '#64748b',
                borderBottom: '1px solid #f1f5f9',
              }}
            >
              Now Serving
            </div>
            <div
              style={{
                flex: 1,
                overflow: 'hidden',
                padding: '16px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              {visibleActiveTickets.length === 0 ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flex: 1,
                    color: '#cbd5e1',
                    fontSize: 28,
                    fontWeight: 600,
                  }}
                >
                  Waiting for customers...
                </div>
              ) : (
                visibleActiveTickets.map((ticket) => {
                  const countdown = getCalledTicketRemainingSeconds(
                    ticket,
                    currentTime,
                    calledTicketCountdownSeconds
                  );
                  const urgencyColor =
                    countdown <= 10 ? '#ef4444' : countdown <= 20 ? '#f59e0b' : '#3b82f6';

                  return (
                    <div
                      key={ticket.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '24px 28px',
                        borderRadius: 16,
                        background: ticket.status === 'called' ? '#eff6ff' : '#f0fdf4',
                        border: `3px solid ${ticket.status === 'called' ? '#bfdbfe' : '#bbf7d0'}`,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 72,
                          fontWeight: 900,
                          letterSpacing: -3,
                          minWidth: 220,
                          color: ticket.status === 'called' ? '#1e40af' : '#166534',
                        }}
                      >
                        {ticket.ticket_number}
                      </div>
                      <div style={{ fontSize: 36, color: '#94a3b8', margin: '0 20px' }}>&rarr;</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 28, fontWeight: 700, color: '#334155' }}>
                          {ticket.desk?.display_name || ticket.desk?.name || 'Desk'}
                        </div>
                        <div style={{ fontSize: 16, color: '#94a3b8', fontWeight: 500, marginTop: 2 }}>
                          {ticket.department?.name || ticket.service?.name || ''}
                        </div>
                      </div>
                      {ticket.status === 'called' ? (
                        <>
                          <div
                            style={{
                              fontSize: 32,
                              fontWeight: 900,
                              minWidth: 70,
                              textAlign: 'center',
                              fontVariantNumeric: 'tabular-nums',
                              color: urgencyColor,
                            }}
                          >
                            {countdown}s
                          </div>
                          <div
                            style={{
                              padding: '8px 20px',
                              borderRadius: 24,
                              fontSize: 16,
                              fontWeight: 800,
                              textTransform: 'uppercase',
                              letterSpacing: 1,
                              background: '#3b82f6',
                              color: '#fff',
                            }}
                          >
                            Please Proceed
                          </div>
                        </>
                      ) : (
                        <div
                          style={{
                            padding: '8px 20px',
                            borderRadius: 24,
                            fontSize: 16,
                            fontWeight: 800,
                            textTransform: 'uppercase',
                            letterSpacing: 1,
                            background: '#22c55e',
                            color: '#fff',
                          }}
                        >
                          Serving
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div
            style={{
              flex: 45,
              display: 'flex',
              flexDirection: 'column',
              background: '#f8fafc',
            }}
          >
            <div
              style={{
                padding: '18px 24px 14px',
                fontSize: 18,
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: 3,
                color: '#64748b',
                borderBottom: '1px solid #f1f5f9',
                background: '#f8fafc',
              }}
            >
              Queue
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px' }}>
              {waitingTickets.length === 0 ? (
                <div
                  style={{
                    textAlign: 'center',
                    padding: 60,
                    color: '#cbd5e1',
                    fontSize: 22,
                    fontWeight: 600,
                  }}
                >
                  No customers in queue
                </div>
              ) : (
                waitingTickets.map((ticket, index) => {
                  const customerName = getTicketCustomerName(ticket.customer_data) || 'Walk-in';
                  const isNext = index === 0;
                  return (
                    <div
                      key={ticket.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '16px 20px',
                        borderRadius: 12,
                        marginBottom: 6,
                        background: '#fff',
                        border: `2px solid ${isNext ? '#fde68a' : '#e2e8f0'}`,
                        boxShadow: isNext ? '0 8px 18px rgba(245,158,11,0.08)' : 'none',
                      }}
                    >
                      <div
                        style={{
                          fontSize: isNext ? 24 : 22,
                          fontWeight: 900,
                          color: isNext ? '#92400e' : '#94a3b8',
                          minWidth: 50,
                          textAlign: 'center',
                        }}
                      >
                        #{index + 1}
                      </div>
                      <div
                        style={{
                          fontSize: 32,
                          fontWeight: 900,
                          color: '#1e293b',
                          minWidth: 140,
                          letterSpacing: -1,
                        }}
                      >
                        {ticket.ticket_number}
                      </div>
                      <div
                        style={{
                          flex: 1,
                          fontSize: 18,
                          color: '#64748b',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {customerName}
                        {ticket.department?.name ? (
                          <span style={{ color: '#94a3b8', fontSize: 13 }}> &middot; {ticket.department.name}</span>
                        ) : null}
                      </div>
                      {ticket.priority > 1 ? (
                        <span
                          style={{
                            padding: '4px 10px',
                            borderRadius: 8,
                            fontSize: 13,
                            fontWeight: 700,
                            marginRight: 6,
                            background: '#fef3c7',
                            color: '#92400e',
                          }}
                        >
                          P{ticket.priority}
                        </span>
                      ) : null}
                      {ticket.appointment_id ? (
                        <span
                          style={{
                            padding: '4px 10px',
                            borderRadius: 8,
                            fontSize: 13,
                            fontWeight: 700,
                            marginRight: 6,
                            background: '#dbeafe',
                            color: '#1e40af',
                          }}
                        >
                          Booked
                        </span>
                      ) : null}
                      <div style={{ fontSize: 18, color: '#94a3b8', fontWeight: 700 }}>
                        {formatWait(ticket.created_at)}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
