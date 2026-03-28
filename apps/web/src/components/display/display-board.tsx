'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { LanguageSwitcher } from '@/components/shared/language-switcher';
import { useI18n } from '@/components/providers/locale-provider';

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
  const [viewportWidth, setViewportWidth] = useState<number>(1280);
  const knownCalledAnchorsRef = useRef<Map<string, string>>(new Map());
  const { t, dir } = useI18n();
  const isRtl = dir === 'rtl';
  // Arabic ligatures break with letter-spacing/uppercase — neutralize in RTL
  const ls = (v: string | number) => isRtl ? undefined : v;
  const uc = isRtl ? undefined : ('uppercase' as const);

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
    const updateViewport = () => setViewportWidth(window.innerWidth);
    updateViewport();
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
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
  const isMobile = viewportWidth < 768;
  const isTablet = viewportWidth >= 768 && viewportWidth < 1100;
  const logoSize = isMobile ? 44 : 56;
  const nowServingPaneHeight = isMobile ? '32vh' : undefined;

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
            <div
              className="font-bold uppercase"
              style={{
                color: '#3b82f6',
                letterSpacing: ls(isMobile ? '0.18em' : '0.3em'),
                fontSize: isMobile ? '1.25rem' : '1.875rem',
              }}
            >
              {t('Now Calling')}
            </div>
            <div
              className="mt-6 font-black leading-none"
              style={{
                fontSize: isMobile ? '4.5rem' : '9rem',
                letterSpacing: ls('-0.08em'),
              }}
            >
              {lastCalledTicket.ticket_number}
            </div>
            <div className="mt-4 font-bold" style={{ color: '#16a34a', fontSize: isMobile ? '1.75rem' : '2.25rem' }}>
              {t('Go to {name}', { name: lastCalledTicket.desk?.display_name || lastCalledTicket.desk?.name || t('Desk') })}
            </div>
          </div>
        </div>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: isMobile ? 'flex-start' : 'center',
            flexDirection: isMobile ? 'column' : 'row',
            gap: isMobile ? 16 : 0,
            padding: isMobile ? '16px 18px' : '16px 32px',
            background: '#fff',
            borderBottom: '2px solid #e2e8f0',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 12 : 16, width: isMobile ? '100%' : 'auto' }}>
            {office.organization?.logo_url ? (
              <div
                style={{
                  width: logoSize,
                  height: logoSize,
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
                  style={{ height: logoSize, width: 'auto', objectFit: 'contain' }}
                />
              </div>
            ) : (
              <div
                style={{
                  width: logoSize,
                  height: logoSize,
                  borderRadius: 14,
                  background: '#3b82f6',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 900,
                  fontSize: isMobile ? 22 : 28,
                }}
              >
                Q
              </div>
            )}
            <div>
              <div style={{ fontSize: isMobile ? 18 : 22, fontWeight: 700, color: '#1e293b' }}>
                {office.organization?.name || office.name}
              </div>
              <div style={{ fontSize: isMobile ? 13 : 14, color: '#64748b', fontWeight: 500 }}>
                {office.organization?.name ? office.name : office.organization?.name || office.name}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', gap: 12, width: isMobile ? '100%' : 'auto', justifyContent: isMobile ? 'space-between' : 'flex-start' }}>
            <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'flex-start' : 'center', gap: 10 }}>
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
                {t('Connected')}
              </div>
              <LanguageSwitcher />
            </div>
            <div style={{ textAlign: 'right', marginLeft: isMobile ? 'auto' : 0 }}>
              <div style={{ fontSize: isMobile ? 24 : 42, fontWeight: 800, color: '#0f172a', lineHeight: 1 }}>
                {currentTime.toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
              <div style={{ fontSize: isMobile ? 11 : 15, color: '#64748b', fontWeight: 500, marginTop: 2 }}>
                {currentTime.toLocaleDateString([], {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))',
            background: '#fff',
            borderBottom: '1px solid #e2e8f0',
          }}
        >
          {[
            { label: t('Waiting'), value: waitingCount, color: '#f59e0b' },
            { label: t('Called'), value: calledCount, color: '#3b82f6' },
            { label: t('Serving'), value: servingCount, color: '#22c55e' },
            { label: t('Served Today'), value: servedTodayCount, color: '#64748b' },
          ].map((stat, index) => (
            <div
              key={stat.label}
              style={{
                padding: isMobile ? '12px 10px' : '12px 24px',
                minHeight: isMobile ? 72 : 96,
                textAlign: 'center',
                borderRight:
                  isMobile ? (index % 2 === 0 ? '1px solid #e2e8f0' : 'none') : index < 3 ? '1px solid #e2e8f0' : 'none',
                borderBottom: isMobile && index < 2 ? '1px solid #e2e8f0' : 'none',
              }}
            >
              <div style={{ fontSize: isMobile ? 24 : 36, fontWeight: 800, color: stat.color, lineHeight: 1 }}>
                {stat.value}
              </div>
              <div
                style={{
                  fontSize: isMobile ? 10 : 14,
                  fontWeight: 700,
                  textTransform: uc,
                  letterSpacing: ls(isMobile ? 1.1 : 2),
                  color: '#94a3b8',
                  marginTop: isMobile ? 3 : 4,
                }}
              >
                {stat.label}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            overflow: 'hidden',
            minHeight: 0,
          }}
        >
          <div
            style={{
              flex: isMobile ? `0 0 ${nowServingPaneHeight}` : 55,
              display: 'flex',
              flexDirection: 'column',
              borderRight: isMobile ? 'none' : '2px solid #e2e8f0',
              borderBottom: isMobile ? '2px solid #e2e8f0' : 'none',
              background: '#fff',
              minHeight: 0,
            }}
          >
            <div
              style={{
                padding: isMobile ? '14px 16px 12px' : '18px 24px 14px',
                fontSize: isMobile ? 15 : 18,
                fontWeight: 800,
                textTransform: uc,
                letterSpacing: ls(isMobile ? 2 : 3),
                color: '#64748b',
                borderBottom: '1px solid #f1f5f9',
              }}
            >
              {t('Now Serving')}
            </div>
            <div
              style={{
                flex: 1,
                overflow: 'auto',
                padding: isMobile ? '12px 12px 14px' : '16px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: isMobile ? 8 : 12,
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
                    fontSize: isMobile ? 22 : 28,
                    fontWeight: 600,
                    textAlign: 'center',
                  }}
                >
                  {t('Waiting for customers...')}
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
                    alignItems: isMobile ? 'flex-start' : 'center',
                    flexDirection: isMobile ? 'column' : 'row',
                    gap: isMobile ? 10 : 0,
                    padding: isMobile ? '14px 14px' : '24px 28px',
                    borderRadius: isMobile ? 14 : 16,
                    background: ticket.status === 'called' ? '#eff6ff' : '#f0fdf4',
                    border: `${isMobile ? 2 : 3}px solid ${ticket.status === 'called' ? '#bfdbfe' : '#bbf7d0'}`,
                      }}
                    >
                      <div
                        style={{
                          fontSize: isMobile ? 42 : 72,
                          fontWeight: 900,
                          letterSpacing: ls(isMobile ? -2 : -3),
                          minWidth: isMobile ? 'auto' : 220,
                          color: ticket.status === 'called' ? '#1e40af' : '#166534',
                          lineHeight: 1,
                        }}
                      >
                        {ticket.ticket_number}
                      </div>
                      <div style={{ fontSize: isMobile ? 18 : 36, color: '#94a3b8', margin: isMobile ? '0' : '0 20px' }}>&rarr;</div>
                      <div style={{ flex: 1, width: isMobile ? '100%' : 'auto' }}>
                        <div style={{ fontSize: isMobile ? 18 : 28, fontWeight: 700, color: '#334155' }}>
                          {ticket.desk?.display_name || ticket.desk?.name || 'Desk'}
                        </div>
                        <div style={{ fontSize: isMobile ? 12 : 16, color: '#94a3b8', fontWeight: 500, marginTop: 2 }}>
                          {ticket.department?.name || ticket.service?.name || ''}
                        </div>
                      </div>
                      {ticket.status === 'called' ? (
                        <>
                          <div
                            style={{
                              fontSize: isMobile ? 22 : 32,
                              fontWeight: 900,
                              minWidth: 70,
                              textAlign: isMobile ? 'left' : 'center',
                              fontVariantNumeric: 'tabular-nums',
                              color: urgencyColor,
                            }}
                          >
                            {countdown}s
                          </div>
                          <div
                            style={{
                              padding: isMobile ? '6px 14px' : '8px 20px',
                              borderRadius: 24,
                              fontSize: isMobile ? 12 : 16,
                              fontWeight: 800,
                              textTransform: uc,
                              letterSpacing: ls(1),
                              background: '#3b82f6',
                              color: '#fff',
                            }}
                          >
                            {t('Please Proceed')}
                          </div>
                        </>
                      ) : (
                        <div
                          style={{
                            padding: isMobile ? '6px 14px' : '8px 20px',
                            borderRadius: 24,
                            fontSize: isMobile ? 12 : 16,
                            fontWeight: 800,
                            textTransform: uc,
                            letterSpacing: ls(1),
                            background: '#22c55e',
                            color: '#fff',
                          }}
                        >
                          {t('Serving')}
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
              flex: isMobile ? 1 : 45,
              display: 'flex',
              flexDirection: 'column',
              background: '#f8fafc',
              minHeight: 0,
            }}
          >
            <div
              style={{
                padding: isMobile ? '14px 16px 12px' : '18px 24px 14px',
                fontSize: isMobile ? 15 : 18,
                fontWeight: 800,
                textTransform: uc,
                letterSpacing: ls(isMobile ? 2 : 3),
                color: '#64748b',
                borderBottom: '1px solid #f1f5f9',
                background: '#f8fafc',
              }}
            >
              {t('Queue')}
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '10px 12px 16px' : '8px 16px' }}>
              {waitingTickets.length === 0 ? (
                <div
                  style={{
                    textAlign: 'center',
                    padding: isMobile ? 22 : 60,
                    color: '#cbd5e1',
                    fontSize: isMobile ? 16 : 22,
                    fontWeight: 600,
                  }}
                >
                  {t('No customers in queue')}
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
                        padding: isMobile ? '12px 12px' : '16px 20px',
                        borderRadius: 12,
                        marginBottom: 6,
                        background: '#fff',
                        border: `2px solid ${isNext ? '#fde68a' : '#e2e8f0'}`,
                        boxShadow: isNext ? '0 8px 18px rgba(245,158,11,0.08)' : 'none',
                      }}
                    >
                      <div
                        style={{
                          fontSize: isMobile ? 18 : isNext ? 24 : 22,
                          fontWeight: 900,
                          color: isNext ? '#92400e' : '#94a3b8',
                          minWidth: isMobile ? 28 : 50,
                          textAlign: 'center',
                        }}
                      >
                        #{index + 1}
                      </div>
                      <div
                        style={{
                          fontSize: isMobile ? 22 : 32,
                          fontWeight: 900,
                          color: '#1e293b',
                          minWidth: isMobile ? 88 : 140,
                          letterSpacing: ls(-1),
                        }}
                      >
                        {ticket.ticket_number}
                      </div>
                      <div
                        style={{
                          flex: 1,
                          fontSize: isMobile ? 14 : 18,
                          color: '#64748b',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {customerName}
                        {ticket.department?.name ? (
                          <span style={{ color: '#94a3b8', fontSize: isMobile ? 11 : 13 }}> &middot; {ticket.department.name}</span>
                        ) : null}
                      </div>
                      {ticket.priority > 1 ? (
                        <span
                          style={{
                            padding: '4px 10px',
                            borderRadius: 8,
                            fontSize: isMobile ? 11 : 13,
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
                            fontSize: isMobile ? 11 : 13,
                            fontWeight: 700,
                            marginRight: 6,
                            background: '#dbeafe',
                            color: '#1e40af',
                          }}
                        >
                          {t('Booked')}
                        </span>
                      ) : null}
                      <div style={{ fontSize: isMobile ? 12 : 18, color: '#94a3b8', fontWeight: 700, marginLeft: 8 }}>
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
