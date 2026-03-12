'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

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
}

export function DisplayBoard({
  screen,
  office,
  departments,
  initialActiveTickets,
  initialWaitingTickets,
}: DisplayBoardProps) {
  // Extract settings with defaults
  const s: ScreenSettings = screen.settings ?? {};
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
  const layout = screen.layout ?? s.layout ?? 'list';

  // Theme-aware color palette
  const colors = isLight
    ? {
        text: '#1e293b',
        textMuted: '#64748b',
        textFaint: '#94a3b8',
        border: '#e2e8f0',
        calledBg: 'rgba(34, 197, 94, 0.12)',
        calledBorder: '#22c55e',
        servingBg: `${accentColor}10`,
        servingBorder: `${accentColor}30`,
        calledText: '#16a34a',
        servingText: accentColor,
        waitingCount: '#d97706',
        announceBg: 'rgba(255,255,255,0.95)',
        announceText: '#0f172a',
        announceGoTo: '#16a34a',
      }
    : {
        text: '#ffffff',
        textMuted: '#9ca3af',
        textFaint: '#6b7280',
        border: '#374151',
        calledBg: 'rgba(34, 197, 94, 0.2)',
        calledBorder: '#22c55e',
        servingBg: `${accentColor}10`,
        servingBorder: `${accentColor}30`,
        calledText: '#4ade80',
        servingText: accentColor,
        waitingCount: '#facc15',
        announceBg: 'rgba(0,0,0,0.85)',
        announceText: '#ffffff',
        announceGoTo: '#4ade80',
      };

  // Text size classes
  const ticketNumClass =
    textSize === 'lg' ? 'text-7xl' : textSize === 'sm' ? 'text-4xl' : 'text-5xl';
  const headingClass =
    textSize === 'lg' ? 'text-2xl' : textSize === 'sm' ? 'text-lg' : 'text-xl';
  const bodyClass =
    textSize === 'lg' ? 'text-lg' : textSize === 'sm' ? 'text-xs' : 'text-sm';

  // Filter departments by visibility setting
  const visibleDepartments = departments.filter((d) => visibleDeptIds.includes(d.id));

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
            .select('*, desk:desks(name, display_name), service:services(name), department:departments(name, code)')
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
              // Play chime sound (if enabled)
              if (announcementSound) {
                try {
                  const audio = new Audio('/sounds/chime.mp3');
                  audio.play().catch(() => {});
                } catch {}
              }
              // Hide announcement after configured duration
              setTimeout(() => setShowAnnouncement(false), announcementDuration);
            }
          }
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[Display] Realtime subscription failed:', status);
        }
      });

    // Polling fallback
    const refreshData = async () => {
      const { data: active } = await supabase
        .from('tickets')
        .select('*, desk:desks(name, display_name), service:services(name), department:departments(name, code)')
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
    };

    const pollInterval = setInterval(refreshData, 4000);

    return () => {
      clearInterval(pollInterval);
      supabase.removeChannel(channel);
    };
  }, [office.id, screen.id, announcementSound, announcementDuration]);

  // Filter active tickets by visible departments
  const nowServing = activeTickets.filter(
    (t) =>
      (t.status === 'called' || t.status === 'serving') &&
      visibleDeptIds.includes(t.department_id)
  );

  const filteredWaiting = waitingTickets.filter((t) =>
    visibleDeptIds.includes(t.department_id)
  );

  const waitingByDept = visibleDepartments.map((dept) => ({
    ...dept,
    count: filteredWaiting.filter((t) => t.department_id === dept.id).length,
  }));

  // Derive card/header/sidebar backgrounds from base
  const headerBg = isLight ? adjustBrightness(bgColor, -8) : adjustBrightness(bgColor, 15);
  const cardBg = isLight ? adjustBrightness(bgColor, -5) : adjustBrightness(bgColor, 10);
  const sidebarBg = isLight ? adjustBrightness(bgColor, -3) : adjustBrightness(bgColor, 5);

  return (
    <div className="min-h-screen overflow-hidden" style={{ backgroundColor: bgColor, color: colors.text }}>
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
        className="flex items-center justify-between px-8 py-4"
        style={{ backgroundColor: headerBg }}
      >
        <div>
          <h1 className={`${headingClass} font-bold`}>
            {office.organization?.name || 'QueueFlow'}
          </h1>
          <p style={{ color: accentColor }}>{office.name}</p>
        </div>
        {showClock && (
          <div className="text-right">
            <p className="text-3xl font-mono font-bold">
              {currentTime.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
            <p className={`${bodyClass}`} style={{ color: accentColor }}>
              {currentTime.toLocaleDateString([], {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
            </p>
          </div>
        )}
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
        />
      )}
    </div>
  );
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
}: any) {
  return (
    <div className="grid grid-cols-3 gap-0 h-[calc(100vh-80px)]">
      {/* Now Serving - 2/3 */}
      <div className="col-span-2 p-6">
        <h2
          className={`mb-6 ${headingClass} font-semibold uppercase tracking-wider`}
          style={{ color: accentColor }}
        >
          Now Serving
        </h2>
        <div className="grid grid-cols-2 gap-4">
          {nowServing.length === 0 ? (
            <div className="col-span-2 flex items-center justify-center py-20">
              <p className="text-2xl" style={{ color: colors.textFaint }}>No customers being served</p>
            </div>
          ) : (
            nowServing.map((ticket: any) => (
              <div
                key={ticket.id}
                className={`rounded-xl p-6 ${
                  ticket.status === 'called' ? 'border-2 animate-pulse' : 'border'
                }`}
                style={{
                  backgroundColor:
                    ticket.status === 'called' ? colors.calledBg : colors.servingBg,
                  borderColor:
                    ticket.status === 'called' ? colors.calledBorder : colors.servingBorder,
                }}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className={`${ticketNumClass} font-black`}>
                      {ticket.ticket_number}
                    </p>
                    <p className={`mt-1 ${bodyClass}`} style={{ color: colors.textMuted }}>
                      {ticket.service?.name}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-medium" style={{ color: accentColor }}>
                      {ticket.desk?.display_name || ticket.desk?.name}
                    </p>
                    <p
                      className="mt-1 text-xs font-medium uppercase"
                      style={{
                        color: ticket.status === 'called' ? colors.calledText : colors.servingText,
                      }}
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

      {/* Sidebar - 1/3 */}
      <div
        className="border-l p-6"
        style={{ backgroundColor: sidebarBg, borderColor: colors.border }}
      >
        {showDeptBreakdown && (
          <>
            <h2
              className={`mb-6 ${headingClass} font-semibold uppercase tracking-wider`}
              style={{ color: accentColor }}
            >
              Queue Status
            </h2>
            <div className="space-y-4">
              {waitingByDept.map((dept: any) => (
                <div
                  key={dept.id}
                  className="rounded-lg p-4"
                  style={{ backgroundColor: cardBg }}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-lg font-semibold">{dept.name}</p>
                      <p className={bodyClass} style={{ color: colors.textMuted }}>{dept.code}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-3xl font-bold" style={{ color: colors.waitingCount }}>{dept.count}</p>
                      <p className="text-xs" style={{ color: colors.textMuted }}>waiting</p>
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
              className={`mb-4 ${bodyClass} font-semibold uppercase tracking-wider`}
              style={{ color: colors.textMuted }}
            >
              Next Up
            </h3>
            <div className="space-y-2">
              {filteredWaiting.slice(0, maxTicketsShown).map((ticket: any) => (
                <div
                  key={ticket.id}
                  className="flex items-center justify-between rounded-lg px-4 py-2"
                  style={{ backgroundColor: cardBg }}
                >
                  <span className="font-mono font-bold">{ticket.ticket_number}</span>
                  <span className="text-xs" style={{ color: colors.textFaint }}>
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
}: any) {
  return (
    <div className="p-6 h-[calc(100vh-80px)] overflow-hidden">
      <h2
        className={`mb-6 ${headingClass} font-semibold uppercase tracking-wider`}
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
              className={`rounded-xl p-5 text-center ${
                ticket.status === 'called' ? 'border-2 animate-pulse' : 'border'
              }`}
              style={{
                backgroundColor:
                  ticket.status === 'called' ? colors.calledBg : colors.servingBg,
                borderColor:
                  ticket.status === 'called' ? colors.calledBorder : colors.servingBorder,
              }}
            >
              <p className={`${ticketNumClass} font-black`}>
                {ticket.ticket_number}
              </p>
              <p className="text-lg font-medium mt-2" style={{ color: accentColor }}>
                {ticket.desk?.display_name || ticket.desk?.name}
              </p>
              <p
                className="mt-1 text-xs font-medium uppercase"
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
                <div key={dept.id} className="rounded-lg p-3" style={{ backgroundColor: cardBg }}>
                  <p className="font-semibold">{dept.name}</p>
                  <p className="text-2xl font-bold" style={{ color: colors.waitingCount }}>{dept.count}</p>
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
                  className="flex items-center justify-between rounded-lg px-3 py-1.5"
                  style={{ backgroundColor: cardBg }}
                >
                  <span className="font-mono font-bold">{ticket.ticket_number}</span>
                  <span className="text-xs" style={{ color: colors.textFaint }}>
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
}: any) {
  const cols = departments.length <= 2 ? departments.length : departments.length <= 4 ? 2 : 3;

  return (
    <div
      className="h-[calc(100vh-80px)] overflow-hidden p-6"
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
            className="rounded-xl border p-4 overflow-hidden"
            style={{ backgroundColor: cardBg, borderColor: colors.border }}
          >
            <h3
              className={`${headingClass} font-bold mb-3 pb-2 border-b`}
              style={{ color: accentColor, borderColor: colors.border }}
            >
              {dept.name}
              <span className="ml-2 text-base font-normal" style={{ color: colors.waitingCount }}>
                ({dept.count} waiting)
              </span>
            </h3>

            {/* Now serving in this dept */}
            {deptServing.length > 0 ? (
              <div className="space-y-2 mb-4">
                {deptServing.map((ticket: any) => (
                  <div
                    key={ticket.id}
                    className={`rounded-lg p-3 ${
                      ticket.status === 'called' ? 'border animate-pulse' : ''
                    }`}
                    style={{
                      backgroundColor:
                        ticket.status === 'called' ? colors.calledBg : colors.servingBg,
                      borderColor:
                        ticket.status === 'called' ? colors.calledBorder : 'transparent',
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-3xl font-black">{ticket.ticket_number}</p>
                      <div className="text-right">
                        <p className={`${bodyClass} font-medium`} style={{ color: accentColor }}>
                          {ticket.desk?.display_name || ticket.desk?.name}
                        </p>
                        <p
                          className="text-xs uppercase font-medium"
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
                <p className="text-xs uppercase tracking-wider mb-2" style={{ color: colors.textMuted }}>
                  Next Up
                </p>
                <div className="space-y-1">
                  {deptWaiting.map((t: any) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between rounded px-2 py-1"
                      style={{ backgroundColor: colors.servingBg }}
                    >
                      <span className="font-mono font-bold text-sm">{t.ticket_number}</span>
                      <span className="text-xs" style={{ color: colors.textFaint }}>
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
