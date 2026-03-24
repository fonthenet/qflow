'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

interface ScreenSettings {
  layout?: string;
  theme?: string;
  bg_color?: string;
  accent_color?: string;
  text_size?: string;
  show_clock?: boolean;
  show_next_up?: boolean;
  show_department_breakdown?: boolean;
  show_estimated_wait?: boolean;
  max_tickets_shown?: number;
  announcement_sound?: boolean;
  announcement_duration?: number;
  auto_scroll_interval?: number;
  visible_department_ids?: string[];
}

interface DisplayBoardProps {
  screen: any;
  office: any;
  departments: any[];
  initialActiveTickets: any[];
  initialWaitingTickets: any[];
  calledTicketCountdownSeconds?: number;
  sandboxMode?: boolean;
}

export function DisplayBoard({
  screen,
  office,
  departments,
  initialActiveTickets,
  initialWaitingTickets,
  calledTicketCountdownSeconds = 0,
  sandboxMode = false,
}: DisplayBoardProps) {
  const [displayScreen, setDisplayScreen] = useState(screen);
  const [activeTickets, setActiveTickets] = useState(initialActiveTickets);
  const [waitingTickets, setWaitingTickets] = useState(initialWaitingTickets);
  const [lastCalledTicket, setLastCalledTicket] = useState<any>(null);
  const [showAnnouncement, setShowAnnouncement] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const knownCalledAnchorsRef = useRef<Map<string, string>>(new Map());

  // Extract settings with defaults
  const s: ScreenSettings = displayScreen.settings ?? {};
  const theme = s.theme ?? 'dark';
  const isLight = theme === 'light';
  const bgColor = s.bg_color ?? (isLight ? '#f8fafc' : '#0a1628');
  const accentColor = s.accent_color ?? (isLight ? '#2563eb' : '#3b82f6');
  const textSize = s.text_size ?? 'md';
  const showClock = s.show_clock ?? true;
  const showNextUp = s.show_next_up ?? true;
  const showDeptBreakdown = s.show_department_breakdown ?? true;
  const maxTicketsShown = s.max_tickets_shown ?? 8;
  const announcementSound = s.announcement_sound ?? true;
  const announcementDuration = (s.announcement_duration ?? 8) * 1000;
  const visibleDeptIds = s.visible_department_ids ?? departments.map((d) => d.id);
  const layout = displayScreen.layout ?? s.layout ?? 'list';

  // Theme-aware color palette
  const colors = isLight
    ? {
        text: '#0f172a',
        textMuted: '#334155',
        textFaint: '#475569',
        border: 'rgba(15, 23, 42, 0.18)',
        headerBorder: 'rgba(15, 23, 42, 0.12)',
        panelBg: 'rgba(255,255,255,0.92)',
        panelStrong: '#ffffff',
        calledBg: '#dcfce7',
        calledBorder: '#15803d',
        servingBg: '#dbeafe',
        servingBorder: accentColor,
        calledText: '#166534',
        servingText: '#1d4ed8',
        waitingCount: '#92400e',
        badgeBg: 'rgba(15,23,42,0.08)',
        badgeText: '#0f172a',
        announceBg: 'rgba(255,255,255,0.96)',
        announceText: '#020617',
        announceGoTo: '#15803d',
      }
    : {
        text: '#f8fafc',
        textMuted: '#e2e8f0',
        textFaint: '#cbd5e1',
        border: 'rgba(148, 163, 184, 0.26)',
        headerBorder: 'rgba(148, 163, 184, 0.18)',
        panelBg: 'rgba(7, 12, 24, 0.92)',
        panelStrong: '#020617',
        calledBg: 'rgba(20, 83, 45, 0.98)',
        calledBorder: '#4ade80',
        servingBg: 'rgba(15, 23, 42, 0.98)',
        servingBorder: accentColor,
        calledText: '#dcfce7',
        servingText: '#dbeafe',
        waitingCount: '#fde68a',
        badgeBg: 'rgba(255,255,255,0.12)',
        badgeText: '#f8fafc',
        announceBg: 'rgba(2,6,23,0.92)',
        announceText: '#ffffff',
        announceGoTo: '#4ade80',
      };

  // Text size classes
  const ticketNumClass =
    textSize === 'lg' ? 'text-[9rem]' : textSize === 'sm' ? 'text-6xl' : 'text-8xl';
  const headingClass =
    textSize === 'lg' ? 'text-4xl' : textSize === 'sm' ? 'text-2xl' : 'text-3xl';
  const bodyClass =
    textSize === 'lg' ? 'text-2xl' : textSize === 'sm' ? 'text-base' : 'text-xl';

  // Filter departments by visibility setting
  const visibleDepartments = departments.filter((d) => visibleDeptIds.includes(d.id));

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

  // Update clock every second
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Poll through a server route so public displays don't depend on public row access
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
      } catch (error) {
        console.warn('[Display] Failed to refresh display status', error);
      }
    };

    refreshData();
    const pollInterval = setInterval(refreshData, 4000);

    return () => {
      clearInterval(pollInterval);
    };
  }, [announcementDuration, announcementSound, displayScreen.screen_token, sandboxMode, updateCalledAnchors]);

  // Filter active tickets by visible departments
  const nowServing = activeTickets.filter((t) => {
    if (!visibleDeptIds.includes(t.department_id)) return false;
    if (t.status === 'serving') return true;
    if (t.status !== 'called') return false;
    return getCalledTicketRemainingSeconds(t, currentTime, calledTicketCountdownSeconds) > 0;
  });

  const filteredWaiting = waitingTickets.filter((t) =>
    visibleDeptIds.includes(t.department_id)
  );

  const waitingByDept = visibleDepartments.map((dept) => ({
    ...dept,
    count: filteredWaiting.filter((t) => t.department_id === dept.id).length,
  })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  // Derive card/header/sidebar backgrounds from base
  const headerBg = isLight ? 'rgba(255,255,255,0.82)' : 'rgba(2,6,23,0.86)';
  const cardBg = colors.panelBg;
  const sidebarBg = isLight ? 'rgba(241,245,249,0.92)' : 'rgba(10,18,33,0.94)';
  const totalWaiting = filteredWaiting.length;
  const activeCount = nowServing.length;

  return (
    <div
      className="min-h-screen overflow-hidden"
      style={{
        color: colors.text,
        background: isLight
          ? `linear-gradient(180deg, #e2e8f0 0%, ${bgColor} 24%, #d8e4f5 100%)`
          : `radial-gradient(circle at top, ${accentColor}30 0%, ${bgColor} 24%, #01040b 100%)`,
      }}
    >
      {/* Announcement overlay */}
      {showAnnouncement && lastCalledTicket && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center animate-pulse"
          style={{ backgroundColor: colors.announceBg }}
        >
          <div className="text-center space-y-4">
            <p className="text-3xl font-medium" style={{ color: accentColor }}>
              Now Calling
            </p>
            <p className="text-[10rem] font-black leading-none" style={{ color: colors.announceText }}>
              {lastCalledTicket.ticket_number}
            </p>
            <p className="text-4xl font-medium" style={{ color: colors.announceGoTo }}>
              Go to:{' '}
              {lastCalledTicket.desk?.display_name ||
                lastCalledTicket.desk?.name ||
                'Counter'}
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div
        className="flex items-center justify-between border-b px-8 py-5"
        style={{ backgroundColor: headerBg, borderColor: colors.headerBorder, backdropFilter: 'blur(12px)' }}
      >
        <div className="flex items-center gap-5">
          {office.organization?.logo_url ? (
            <div className="flex h-20 w-20 items-center justify-center rounded-3xl border" style={{ backgroundColor: colors.panelStrong, borderColor: colors.border }}>
              <img
                src={office.organization.logo_url}
                alt={`${office.organization?.name || 'Business'} logo`}
                className="max-h-14 w-auto max-w-[64px] object-contain"
              />
            </div>
          ) : null}
          <div>
            <h1 className={`${headingClass} font-bold`}>
              {office.organization?.name || 'QueueFlow'}
            </h1>
            <p className="mt-1 text-2xl font-medium" style={{ color: colors.textMuted }}>{office.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="rounded-2xl border px-5 py-3" style={{ backgroundColor: colors.badgeBg, borderColor: colors.border }}>
            <p className="text-xs font-semibold uppercase tracking-[0.22em]" style={{ color: colors.textMuted }}>Waiting</p>
            <p className="mt-1 text-4xl font-black" style={{ color: colors.waitingCount }}>{totalWaiting}</p>
          </div>
          <div className="rounded-2xl border px-5 py-3" style={{ backgroundColor: colors.badgeBg, borderColor: colors.border }}>
            <p className="text-xs font-semibold uppercase tracking-[0.22em]" style={{ color: colors.textMuted }}>Active</p>
            <p className="mt-1 text-4xl font-black" style={{ color: accentColor }}>{activeCount}</p>
          </div>
          {showClock && (
            <div className="rounded-2xl border px-5 py-3 text-right" style={{ backgroundColor: colors.panelStrong, borderColor: colors.border }}>
              <p className="text-5xl font-black tabular-nums">
              {currentTime.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
              </p>
              <p className="mt-2 text-xl font-semibold" style={{ color: accentColor }}>
                {currentTime.toLocaleDateString([], {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Main content - layout dependent */}
      {layout === 'department_split' ? (
        <DepartmentSplitLayout
          departments={waitingByDept}
          nowServing={nowServing}
          filteredWaiting={filteredWaiting}
          ticketNumClass={ticketNumClass}
          headingClass={headingClass}
          bodyClass={bodyClass}
          accentColor={accentColor}
          cardBg={cardBg}
          sidebarBg={sidebarBg}
          maxTicketsShown={maxTicketsShown}
          colors={colors}
          currentTime={currentTime}
          calledTicketCountdownSeconds={calledTicketCountdownSeconds}
        />
      ) : layout === 'grid' ? (
        <GridLayout
          nowServing={nowServing}
          filteredWaiting={filteredWaiting}
          waitingByDept={waitingByDept}
          ticketNumClass={ticketNumClass}
          headingClass={headingClass}
          bodyClass={bodyClass}
          accentColor={accentColor}
          cardBg={cardBg}
          sidebarBg={sidebarBg}
          showNextUp={showNextUp}
          showDeptBreakdown={showDeptBreakdown}
          maxTicketsShown={maxTicketsShown}
          colors={colors}
          currentTime={currentTime}
          calledTicketCountdownSeconds={calledTicketCountdownSeconds}
        />
      ) : (
        <ListLayout
          nowServing={nowServing}
          filteredWaiting={filteredWaiting}
          waitingByDept={waitingByDept}
          ticketNumClass={ticketNumClass}
          headingClass={headingClass}
          bodyClass={bodyClass}
          accentColor={accentColor}
          cardBg={cardBg}
          sidebarBg={sidebarBg}
          showNextUp={showNextUp}
          showDeptBreakdown={showDeptBreakdown}
          maxTicketsShown={maxTicketsShown}
          colors={colors}
          currentTime={currentTime}
          calledTicketCountdownSeconds={calledTicketCountdownSeconds}
        />
      )}
    </div>
  );
}

function formatTicketTimer(ticket: any, now: Date, calledTicketCountdownSeconds: number) {
  if (ticket.status === 'called') {
    const remainingSeconds = getCalledTicketRemainingSeconds(
      ticket,
      now,
      calledTicketCountdownSeconds
    );
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  const anchor = ticket.serving_started_at ?? ticket.called_at;

  if (!anchor) return '--';

  const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - new Date(anchor).getTime()) / 1000));
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
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

  if (calledTicketCountdownSeconds <= 0) {
    return 0;
  }

  return Math.max(0, calledTicketCountdownSeconds - elapsedSeconds);
}

// ─── List Layout (default, original 2/3 + 1/3 split) ────────────────────

function ListLayout({
  nowServing,
  filteredWaiting,
  waitingByDept,
  ticketNumClass,
  headingClass,
  bodyClass,
  accentColor,
  cardBg,
  sidebarBg,
  showNextUp,
  showDeptBreakdown,
  maxTicketsShown,
  colors,
  currentTime,
  calledTicketCountdownSeconds,
}: any) {
  return (
    <div className="grid h-[calc(100vh-102px)] grid-cols-3 gap-0">
      {/* Now Serving - 2/3 */}
      <div className="col-span-2 border-r p-7" style={{ borderColor: colors.border }}>
        <h2
          className={`mb-6 ${headingClass} font-black uppercase tracking-[0.28em]`}
          style={{ color: accentColor }}
        >
          Now Serving
        </h2>
        <div className="grid grid-cols-2 gap-4">
          {nowServing.length === 0 ? (
            <div
              className="col-span-2 min-h-[34rem] rounded-[2.25rem] border shadow-[0_24px_60px_rgba(15,23,42,0.12)]"
              style={{
                background: `linear-gradient(180deg, ${colors.panelStrong} 0%, ${colors.panelBg} 100%)`,
                borderColor: colors.border,
              }}
            />
          ) : (
            nowServing.map((ticket: any) => (
              <div
                key={ticket.id}
                className={`rounded-[2rem] p-7 shadow-[0_20px_50px_rgba(15,23,42,0.18)] ${
                  ticket.status === 'called' ? 'border-[3px] animate-pulse' : 'border-[3px]'
                }`}
                style={{
                  backgroundColor:
                    ticket.status === 'called' ? colors.calledBg : colors.servingBg,
                  borderColor:
                    ticket.status === 'called' ? colors.calledBorder : colors.servingBorder,
                }}
              >
                <div className="flex h-full flex-col justify-between gap-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-base font-bold uppercase tracking-[0.24em]" style={{ color: colors.textMuted }}>
                        {ticket.status === 'called' ? 'Go now' : 'Serving'}
                      </p>
                      <p className={`${ticketNumClass} font-black leading-none tracking-tight`}>
                      {ticket.ticket_number}
                      </p>
                    </div>
                    <div className="rounded-full px-5 py-3 text-lg font-bold" style={{ backgroundColor: colors.badgeBg, color: ticket.status === 'called' ? colors.calledText : colors.servingText }}>
                      {ticket.desk?.display_name || ticket.desk?.name}
                    </div>
                  </div>
                  <div>
                    <p className="text-2xl font-semibold" style={{ color: colors.text }}>
                      {ticket.service?.name}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="rounded-full px-4 py-2 text-base font-semibold" style={{ backgroundColor: colors.badgeBg, color: colors.badgeText }}>
                        {ticket.department?.name || ticket.department?.code || 'Queue'}
                      </span>
                      <span
                        className="rounded-full px-4 py-2 text-base font-bold uppercase tracking-wide"
                        style={{
                          backgroundColor: ticket.status === 'called' ? 'rgba(22,163,74,0.16)' : colors.badgeBg,
                          color: ticket.status === 'called' ? colors.calledText : colors.servingText,
                        }}
                      >
                        {ticket.status === 'called' ? 'Proceed to desk' : 'In service'}
                      </span>
                    </div>
                    <p className={`mt-4 ${bodyClass} font-medium`} style={{ color: colors.textMuted }}>
                      Desk: {ticket.desk?.display_name || ticket.desk?.name || 'Counter'}
                    </p>
                    <p className="mt-2 text-2xl font-black tabular-nums" style={{ color: ticket.status === 'called' ? colors.calledText : colors.servingText }}>
                      {ticket.status === 'called' ? 'Counter countdown ' : 'Serving '}
                      {formatTicketTimer(ticket, currentTime, calledTicketCountdownSeconds)}
                    </p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Sidebar - 1/3 */}
      <div
        className="border-l p-6"
        style={{ backgroundColor: sidebarBg, borderColor: colors.border }}
      >
        {showDeptBreakdown && (
          <>
            <h2
              className={`mb-5 ${headingClass} font-black uppercase tracking-[0.22em]`}
              style={{ color: accentColor }}
            >
              Queue Status
            </h2>
            <div className="space-y-4">
              {waitingByDept.map((dept: any) => (
                <div
                  key={dept.id}
                  className="rounded-[1.75rem] border px-6 py-5 shadow-[0_16px_36px_rgba(15,23,42,0.08)]"
                  style={{
                    background: dept.count > 0
                      ? `linear-gradient(90deg, ${colors.panelStrong} 0%, ${cardBg} 100%)`
                      : cardBg,
                    borderColor: dept.count > 0 ? accentColor : colors.border,
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="text-3xl font-black leading-tight">{dept.name}</p>
                      <p className="mt-2 text-lg font-semibold uppercase tracking-[0.18em]" style={{ color: colors.textMuted }}>
                        Department {dept.code}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-6xl font-black leading-none" style={{ color: colors.waitingCount }}>{dept.count}</p>
                      <p className="mt-1 text-lg font-semibold" style={{ color: colors.textMuted }}>waiting</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {showNextUp && (
          <div className={showDeptBreakdown ? 'mt-8' : ''}>
            <h3
              className={`mb-4 ${bodyClass} font-bold uppercase tracking-[0.22em]`}
              style={{ color: colors.textMuted }}
            >
              Next Up
            </h3>
            <div className="space-y-2">
              {filteredWaiting.length === 0 ? (
                <div
                  className="rounded-[1.5rem] border px-5 py-6"
                  style={{ backgroundColor: cardBg, borderColor: colors.border }}
                >
                  <p className="text-xl font-semibold" style={{ color: colors.textFaint }}>
                    No tickets waiting right now
                  </p>
                </div>
              ) : (
                filteredWaiting.slice(0, maxTicketsShown).map((ticket: any, index: number) => (
                  <div
                    key={ticket.id}
                    className="flex items-center justify-between rounded-[1.35rem] border px-5 py-4"
                    style={{ backgroundColor: cardBg, borderColor: colors.border }}
                  >
                    <div>
                      <span className="block text-sm font-bold uppercase tracking-[0.22em]" style={{ color: colors.textMuted }}>
                        #{index + 1} in line
                      </span>
                      <span className="mt-1 block text-4xl font-black tracking-tight">{ticket.ticket_number}</span>
                    </div>
                    <span className="text-base font-medium" style={{ color: colors.textFaint }}>
                      {new Date(ticket.created_at).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Grid Layout ─────────────────────────────────────────────────────────

function GridLayout({
  nowServing,
  filteredWaiting,
  waitingByDept,
  ticketNumClass,
  headingClass,
  bodyClass,
  accentColor,
  cardBg,
  showNextUp,
  showDeptBreakdown,
  maxTicketsShown,
  colors,
  currentTime,
  calledTicketCountdownSeconds,
}: any) {
  return (
    <div className="p-6 h-[calc(100vh-102px)] overflow-hidden">
      <h2
        className={`mb-6 ${headingClass} font-black uppercase tracking-[0.22em]`}
        style={{ color: accentColor }}
      >
        Now Serving
      </h2>

      {nowServing.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <p className="text-2xl" style={{ color: colors.textFaint }}>No customers being served</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4 mb-6">
          {nowServing.map((ticket: any) => (
            <div
              key={ticket.id}
              className={`rounded-[1.75rem] p-6 text-center shadow-[0_18px_40px_rgba(15,23,42,0.18)] ${
                ticket.status === 'called' ? 'border-[3px] animate-pulse' : 'border-[3px]'
              }`}
              style={{
                backgroundColor:
                  ticket.status === 'called' ? colors.calledBg : colors.servingBg,
                borderColor:
                  ticket.status === 'called' ? colors.calledBorder : colors.servingBorder,
              }}
            >
              <p className={`${ticketNumClass} font-black leading-none tracking-tight`}>
                {ticket.ticket_number}
              </p>
              <p className="mt-3 text-3xl font-bold" style={{ color: accentColor }}>
                {ticket.desk?.display_name || ticket.desk?.name}
              </p>
              <p className="mt-2 text-xl font-semibold" style={{ color: colors.textMuted }}>
                {ticket.service?.name || 'Service'}
              </p>
              <p className="mt-3 text-2xl font-black tabular-nums" style={{ color: ticket.status === 'called' ? colors.calledText : colors.servingText }}>
                {ticket.status === 'called' ? 'Counter countdown ' : 'Serving '}
                {formatTicketTimer(ticket, currentTime, calledTicketCountdownSeconds)}
              </p>
              <p
                className="mt-2 text-base font-bold uppercase tracking-[0.2em]"
                style={{
                  color: ticket.status === 'called' ? colors.calledText : colors.textMuted,
                }}
              >
                {ticket.status === 'called' ? 'Go Now' : 'Serving'}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Bottom row: dept summary + next up */}
      <div className="grid grid-cols-2 gap-6">
        {showDeptBreakdown && (
          <div>
            <h3
              className={`mb-3 ${bodyClass} font-semibold uppercase tracking-wider`}
              style={{ color: accentColor }}
            >
              Queue Status
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {waitingByDept.map((dept: any) => (
                <div key={dept.id} className="rounded-[1.25rem] border p-4" style={{ backgroundColor: cardBg, borderColor: colors.border }}>
                  <p className="text-xl font-bold">{dept.name}</p>
                  <p className="mt-2 text-4xl font-black" style={{ color: colors.waitingCount }}>{dept.count}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {showNextUp && (
          <div>
            <h3
              className={`mb-3 ${bodyClass} font-semibold uppercase tracking-wider`}
              style={{ color: colors.textMuted }}
            >
              Next Up
            </h3>
            <div className="space-y-1.5">
              {filteredWaiting.slice(0, maxTicketsShown).map((ticket: any) => (
                <div
                  key={ticket.id}
                  className="flex items-center justify-between rounded-[1.15rem] border px-4 py-3"
                  style={{ backgroundColor: cardBg, borderColor: colors.border }}
                >
                  <span className="text-2xl font-black tracking-tight">{ticket.ticket_number}</span>
                  <span className="text-base font-medium" style={{ color: colors.textFaint }}>
                    {new Date(ticket.created_at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Department Split Layout ──────────────────────────────────────────────

function DepartmentSplitLayout({
  departments,
  nowServing,
  filteredWaiting,
  ticketNumClass,
  headingClass,
  bodyClass,
  accentColor,
  cardBg,
  maxTicketsShown,
  colors,
  currentTime,
  calledTicketCountdownSeconds,
}: any) {
  const cols = departments.length <= 2 ? departments.length : departments.length <= 4 ? 2 : 3;

  return (
    <div
      className="h-[calc(100vh-102px)] overflow-hidden p-6"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: '1rem',
      }}
    >
      {departments.map((dept: any) => {
        const deptServing = nowServing.filter(
          (t: any) => t.department_id === dept.id
        );
        const deptWaiting = filteredWaiting
          .filter((t: any) => t.department_id === dept.id)
          .slice(0, Math.floor(maxTicketsShown / departments.length) || 3);

        return (
          <div
            key={dept.id}
            className="overflow-hidden rounded-[1.75rem] border p-5 shadow-[0_18px_40px_rgba(15,23,42,0.16)]"
            style={{ backgroundColor: cardBg, borderColor: colors.border }}
          >
            <h3
              className={`${headingClass} font-black mb-4 pb-3 border-b`}
              style={{ color: accentColor, borderColor: colors.border }}
            >
              {dept.name}
              <span className="ml-2 text-lg font-semibold" style={{ color: colors.waitingCount }}>
                ({dept.count} waiting)
              </span>
            </h3>

            {/* Now serving in this dept */}
            {deptServing.length > 0 ? (
              <div className="space-y-2 mb-4">
                {deptServing.map((ticket: any) => (
                  <div
                    key={ticket.id}
                    className={`rounded-[1.25rem] p-4 ${
                      ticket.status === 'called' ? 'border-[3px] animate-pulse' : 'border-[3px]'
                    }`}
                    style={{
                      backgroundColor:
                        ticket.status === 'called' ? colors.calledBg : colors.servingBg,
                      borderColor:
                        ticket.status === 'called' ? colors.calledBorder : 'transparent',
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-6xl font-black leading-none tracking-tight">{ticket.ticket_number}</p>
                      <div className="text-right">
                        <p className={`${bodyClass} font-bold`} style={{ color: accentColor }}>
                          {ticket.desk?.display_name || ticket.desk?.name}
                        </p>
                        <p className="mt-1 text-xl font-black tabular-nums" style={{ color: ticket.status === 'called' ? colors.calledText : colors.servingText }}>
                          {formatTicketTimer(ticket, currentTime, calledTicketCountdownSeconds)}
                        </p>
                        <p
                          className="text-base uppercase font-bold tracking-[0.18em]"
                          style={{
                            color: ticket.status === 'called' ? colors.calledText : colors.textMuted,
                          }}
                        >
                          {ticket.status === 'called' ? 'Go Now' : 'Serving'}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className={`${bodyClass} mb-4`} style={{ color: colors.textFaint }}>No one being served</p>
            )}

            {/* Next up in this dept */}
            {deptWaiting.length > 0 && (
              <div>
                <p className="text-sm uppercase tracking-wider mb-2" style={{ color: colors.textMuted }}>
                  Next Up
                </p>
                <div className="space-y-1">
                  {deptWaiting.map((t: any) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between rounded-[1rem] border px-3 py-2"
                      style={{ backgroundColor: colors.servingBg, borderColor: colors.border }}
                    >
                      <span className="text-2xl font-black tracking-tight">{t.ticket_number}</span>
                      <span className="text-base font-medium" style={{ color: colors.textFaint }}>
                        {new Date(t.created_at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Utility ──────────────────────────────────────────────────────────────

function adjustBrightness(hex: string, percent: number): string {
  // Parse hex color and lighten slightly
  const num = parseInt(hex.replace('#', ''), 16);
  if (isNaN(num)) return hex;
  const r = Math.min(255, ((num >> 16) & 0xff) + percent);
  const g = Math.min(255, ((num >> 8) & 0xff) + percent);
  const b = Math.min(255, (num & 0xff) + percent);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
