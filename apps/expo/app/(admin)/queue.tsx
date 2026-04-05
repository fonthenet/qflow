import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Linking,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { QueueTicket } from '@/lib/use-realtime-queue';
import { useNameLookup } from '@/lib/use-realtime-queue';
import { useOrg } from '@/lib/use-org';
import * as Actions from '@/lib/ticket-actions';
import { colors, borderRadius, fontSize, spacing } from '@/lib/theme';

// ── Types ────────────────────────────────────────────────────────────

type Filter = 'active' | 'waiting' | 'called' | 'serving' | 'parked' | 'done';
type ViewMode = 'list' | 'by_desk';

const FILTERS: { key: Filter; labelKey: string; icon: string }[] = [
  { key: 'active', labelKey: 'adminQueue.active', icon: 'pulse' },
  { key: 'waiting', labelKey: 'adminQueue.waiting', icon: 'time-outline' },
  { key: 'called', labelKey: 'adminQueue.called', icon: 'megaphone-outline' },
  { key: 'serving', labelKey: 'adminQueue.serving', icon: 'hand-left-outline' },
  { key: 'parked', labelKey: 'adminQueue.onHold', icon: 'pause-circle-outline' },
  { key: 'done', labelKey: 'adminQueue.done', icon: 'checkmark-done-outline' },
];

const TICKET_COLUMNS =
  'id, ticket_number, status, customer_data, priority_category_id, priority, created_at, called_at, serving_started_at, completed_at, desk_id, office_id, service_id, department_id, called_by_staff_id, recall_count, is_remote, source, appointment_id, parked_at, notes';

// ── Desk info type ───────────────────────────────────────────────────

interface DeskInfo {
  id: string;
  name: string;
  display_name: string | null;
  status: string;
  current_staff_id: string | null;
  department_id: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────

function getStatusColor(status: string): string {
  switch (status) {
    case 'waiting': return colors.waiting;
    case 'called': return colors.called;
    case 'serving': return colors.serving;
    case 'served': return colors.success;
    case 'no_show': return colors.warning;
    case 'cancelled': return colors.error;
    default: return colors.textMuted;
  }
}

function getStatusBg(status: string): string {
  switch (status) {
    case 'waiting': return colors.waitingBg;
    case 'called': return colors.calledBg;
    case 'serving': return colors.servingBg;
    case 'served': return colors.successLight;
    case 'no_show': return colors.warningLight;
    case 'cancelled': return colors.errorLight;
    default: return colors.surfaceSecondary;
  }
}

function getDeskStatusColor(status: string): string {
  switch (status) {
    case 'open': return colors.success;
    case 'on_break': return colors.warning;
    case 'closed': return colors.textMuted;
    default: return colors.textMuted;
  }
}

function getDeskStatusLabel(status: string, t: any): string {
  switch (status) {
    case 'open': return t('common.open');
    case 'on_break': return t('desk.onBreak');
    case 'closed': return t('common.closed');
    default: return status;
  }
}

function getSourceIcon(source: string | null): { name: string; color: string } {
  switch (source) {
    case 'whatsapp': return { name: 'logo-whatsapp', color: '#25D366' };
    case 'messenger': return { name: 'chatbubble-ellipses', color: '#0084FF' };
    case 'kiosk': return { name: 'tablet-portrait-outline', color: '#8B5CF6' };
    case 'qr_code': return { name: 'qr-code-outline', color: '#F59E0B' };
    case 'walk_in': return { name: 'walk-outline', color: '#64748B' };
    case 'in_house': return { name: 'business-outline', color: '#6366F1' };
    default: return { name: 'globe-outline', color: colors.textMuted };
  }
}

function getSourceLabel(source: string | null, t: any): string {
  switch (source) {
    case 'whatsapp': return t('source.whatsapp');
    case 'messenger': return t('source.messenger');
    case 'kiosk': return t('source.kiosk');
    case 'qr_code': return t('source.qrCode');
    case 'walk_in': return t('source.walkIn');
    case 'in_house': return t('source.inHouse');
    default: return t('source.web');
  }
}

function dialPhone(raw: string) {
  const t = raw.trim();
  if (t.startsWith('+')) { Linking.openURL(`tel:${t}`); return; }
  const d = t.replace(/\D/g, '');
  if (d.length === 10 && d.startsWith('0')) { Linking.openURL(`tel:+213${d.slice(1)}`); return; }
  if (d.length === 10) { Linking.openURL(`tel:+1${d}`); return; }
  if (d.length === 11 && d.startsWith('1')) { Linking.openURL(`tel:+${d}`); return; }
  Linking.openURL(`tel:${t}`);
}

function formatWait(dateStr: string, t: any): string {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (mins < 1) return t('time.lessThan1m');
  if (mins < 60) return t('time.minutes', { count: mins });
  return t('time.hoursMinutes', { h: Math.floor(mins / 60), m: mins % 60 });
}

function statusesForFilter(filter: Filter): string[] {
  switch (filter) {
    case 'active': return ['waiting', 'called', 'serving'];
    case 'parked': return ['waiting', 'called', 'serving']; // parked tickets have these statuses + parked_at
    case 'done': return ['served', 'no_show', 'cancelled'];
    default: return [filter];
  }
}

// ── Main Screen ──────────────────────────────────────────────────────

export default function AdminQueueScreen() {
  const { t } = useTranslation();
  const { orgId, officeIds, staffId } = useOrg();
  const names = useNameLookup(orgId, officeIds);

  const [tickets, setTickets] = useState<QueueTicket[]>([]);
  const [desks, setDesks] = useState<DeskInfo[]>([]);
  const [filter, setFilter] = useState<Filter>('active');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch tickets ────────────────────────────────────────────────

  const fetchAllTickets = useCallback(async () => {
    if (officeIds.length === 0) return;

    const statuses = statusesForFilter(filter);

    let query = supabase
      .from('tickets')
      .select(TICKET_COLUMNS)
      .in('office_id', officeIds)
      .in('status', statuses);

    if (filter === 'done') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      query = query.gte('created_at', today.toISOString());
    }

    const { data, error } = await query
      .order('priority', { ascending: false, nullsFirst: true })
      .order('created_at', { ascending: true })
      .limit(200);

    if (error) {
      console.warn('Admin queue fetch error:', error.message);
      return;
    }

    setTickets((data as unknown as QueueTicket[]) ?? []);
    setLoading(false);
  }, [officeIds, filter]);

  // ── Fetch desks with staff ───────────────────────────────────────

  const fetchDesks = useCallback(async () => {
    if (officeIds.length === 0) return;

    const { data, error } = await supabase
      .from('desks')
      .select('id, name, display_name, status, current_staff_id, department_id')
      .in('office_id', officeIds)
      .eq('is_active', true)
      .order('name');

    if (!error && data) {
      setDesks(data as DeskInfo[]);
    }
  }, [officeIds]);

  useEffect(() => {
    setLoading(true);
    fetchAllTickets();
    fetchDesks();
    intervalRef.current = setInterval(() => {
      fetchAllTickets();
      fetchDesks();
    }, 3000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchAllTickets, fetchDesks]);

  // ── Derived data ─────────────────────────────────────────────────

  const filteredTickets = useMemo(() => {
    if (filter === 'parked') {
      return tickets.filter((t) => t.parked_at != null);
    }
    return tickets.filter((t) => t.parked_at == null);
  }, [tickets, filter]);

  const parkedCount = useMemo(
    () => tickets.filter((t) => t.parked_at != null).length,
    [tickets],
  );

  const counts = useMemo(() => {
    // For counts, get all active tickets to show accurate numbers
    const active = tickets.filter((t) => t.parked_at == null);
    const parked = tickets.filter((t) => t.parked_at != null);
    return {
      active: active.length,
      waiting: active.filter((t) => t.status === 'waiting').length,
      called: active.filter((t) => t.status === 'called').length,
      serving: active.filter((t) => t.status === 'serving').length,
      parked: parked.length,
      done: filter === 'done' ? tickets.length : 0,
    };
  }, [tickets, filter]);

  const longestWait = useMemo(() => {
    const activeTickets = tickets.filter(
      (t) => (t.status === 'waiting' || t.status === 'called') && !t.parked_at,
    );
    if (activeTickets.length === 0) return null;
    const oldest = activeTickets.reduce((a, b) =>
      new Date(a.created_at) < new Date(b.created_at) ? a : b,
    );
    return formatWait(oldest.created_at, t);
  }, [tickets, t]);

  // ── Desk-grouped data ────────────────────────────────────────────

  const deskSections = useMemo(() => {
    if (viewMode !== 'by_desk') return [];

    const activeDesks = desks.filter((d) => d.status !== 'closed' || d.current_staff_id);

    // Group tickets by desk
    const deskTicketMap: Record<string, QueueTicket[]> = {};
    const unassigned: QueueTicket[] = [];

    filteredTickets.forEach((t) => {
      if (t.desk_id) {
        if (!deskTicketMap[t.desk_id]) deskTicketMap[t.desk_id] = [];
        deskTicketMap[t.desk_id].push(t);
      } else {
        unassigned.push(t);
      }
    });

    const sections: {
      title: string;
      deskInfo: DeskInfo | null;
      staffName: string | null;
      deptName: string | null;
      ticketCount: number;
      data: QueueTicket[];
    }[] = [];

    // Unassigned section first (waiting tickets not yet at a desk)
    if (unassigned.length > 0) {
      sections.push({
        title: t('adminQueue.waitingQueue'),
        deskInfo: null,
        staffName: null,
        deptName: null,
        ticketCount: unassigned.length,
        data: unassigned,
      });
    }

    // Then each active desk — only if it has tickets for the current filter
    activeDesks.forEach((desk) => {
      const deskTickets = deskTicketMap[desk.id] ?? [];
      if (deskTickets.length === 0) return; // skip empty desks

      const staffName = desk.current_staff_id
        ? names.staff[desk.current_staff_id] ?? null
        : null;
      const deptName = desk.department_id
        ? names.departments[desk.department_id] ?? null
        : null;

      sections.push({
        title: desk.display_name || desk.name,
        deskInfo: desk,
        staffName,
        deptName,
        ticketCount: deskTickets.length,
        data: deskTickets,
      });
    });

    // Add desks with tickets that aren't in activeDesks
    Object.keys(deskTicketMap).forEach((deskId) => {
      if (!activeDesks.some((d) => d.id === deskId)) {
        const deskTickets = deskTicketMap[deskId];
        const deskName = names.desks[deskId] ?? 'Unknown Desk';
        sections.push({
          title: deskName,
          deskInfo: null,
          staffName: null,
          deptName: null,
          ticketCount: deskTickets.length,
          data: deskTickets,
        });
      }
    });

    return sections;
  }, [viewMode, desks, filteredTickets, names, t]);

  // ── Actions ──────────────────────────────────────────────────────

  const confirmAction = (
    title: string,
    message: string,
    onConfirm: () => Promise<void>,
  ) => {
    Alert.alert(title, message, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.confirm'),
        onPress: async () => {
          try {
            await onConfirm();
            fetchAllTickets();
          } catch (err: any) {
            Alert.alert(t('common.error'), err.message ?? t('adminQueue.actionFailed'));
          }
        },
      },
    ]);
  };

  const handleCall = (tk: QueueTicket) => {
    confirmAction(t('adminQueue.callTicket'), t('adminQueue.callTicketMsgGeneric', { ticket: tk.ticket_number }), async () => {
      await supabase
        .from('tickets')
        .update({
          status: 'called',
          called_at: new Date().toISOString(),
          called_by_staff_id: staffId,
        })
        .eq('id', tk.id);
    });
  };

  const handleServe = (tk: QueueTicket) => {
    confirmAction(t('adminQueue.startServingTicket'), t('adminQueue.startServingMsg', { ticket: tk.ticket_number }), () =>
      Actions.startServing(tk.id),
    );
  };

  const handleComplete = (tk: QueueTicket) => {
    confirmAction(t('adminQueue.completeTicket'), t('adminQueue.completeMsg', { ticket: tk.ticket_number }), () =>
      Actions.markServed(tk.id),
    );
  };

  const handleNoShow = (tk: QueueTicket) => {
    confirmAction(t('adminQueue.noShowTicket'), t('adminQueue.noShowMsg', { ticket: tk.ticket_number }), () =>
      Actions.markNoShow(tk.id),
    );
  };

  const handleCancel = (tk: QueueTicket) => {
    confirmAction(t('adminQueue.cancelTicket'), t('adminQueue.cancelMsg', { ticket: tk.ticket_number }), () =>
      Actions.cancelTicket(tk.id),
    );
  };

  const handlePark = (tk: QueueTicket) => {
    confirmAction(t('adminQueue.parkTicket'), t('adminQueue.parkMsg', { ticket: tk.ticket_number }), () =>
      Actions.parkTicket(tk.id),
    );
  };

  const handleBackToQueue = (tk: QueueTicket) => {
    confirmAction(t('adminQueue.backToQueue'), t('adminQueue.backToQueueMsg', { ticket: tk.ticket_number }), () =>
      Actions.resetToQueue(tk.id),
    );
  };

  const handleUnparkToQueue = (tk: QueueTicket) => {
    confirmAction(t('adminQueue.backToQueue'), t('adminQueue.backToQueueMsg', { ticket: tk.ticket_number }), () =>
      Actions.unparkToQueue(tk.id),
    );
  };

  // ── Pull to refresh ──────────────────────────────────────────────

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchAllTickets(), fetchDesks()]);
    setRefreshing(false);
  };

  // ── Render helpers ───────────────────────────────────────────────

  const renderTicketCard = ({ item: ticket }: { item: QueueTicket }) => {
    const customerName = ticket.customer_data?.name ?? null;
    const customerPhone = ticket.customer_data?.phone ?? null;
    const customerNotes = (ticket.customer_data as any)?.reason || ticket.customer_data?.notes || ticket.notes || null;
    const officeName = names.offices[ticket.office_id] ?? '';
    const serviceName = ticket.service_id
      ? names.services[ticket.service_id] ?? ''
      : '';
    const deptName = ticket.department_id
      ? names.departments[ticket.department_id] ?? ''
      : '';
    const deskName = ticket.desk_id ? names.desks[ticket.desk_id] ?? '' : '';
    const staffName = ticket.called_by_staff_id
      ? names.staff[ticket.called_by_staff_id] ?? ''
      : '';
    const priorityInfo = ticket.priority_category_id
      ? names.priorities[ticket.priority_category_id] ?? null
      : null;

    const isTerminal = ['served', 'no_show', 'cancelled'].includes(ticket.status);
    const isParked = ticket.parked_at != null;
    const statusColor = getStatusColor(ticket.status);
    const statusBg = getStatusBg(ticket.status);

    return (
      <View
        style={[
          styles.ticketCard,
          isParked && styles.ticketCardParked,
        ]}
      >
        {/* Header row: ticket number + status badge */}
        <View style={styles.ticketHeader}>
          <View style={styles.ticketLeft}>
            <View
              style={[styles.statusDot, { backgroundColor: statusColor }]}
            />
            <Text style={styles.ticketNumber}>{ticket.ticket_number}</Text>
            {priorityInfo && (
              <View
                style={[
                  styles.priorityBadge,
                  priorityInfo.color
                    ? { backgroundColor: priorityInfo.color + '20' }
                    : undefined,
                ]}
              >
                <Ionicons
                  name="flag"
                  size={10}
                  color={priorityInfo.color ?? colors.warning}
                />
                <Text
                  style={[
                    styles.priorityText,
                    { color: priorityInfo.color ?? colors.warning },
                  ]}
                >
                  {priorityInfo.name}
                </Text>
              </View>
            )}
            {isParked && (
              <View style={styles.parkedBadge}>
                <Ionicons name="pause-circle" size={10} color={colors.warning} />
                <Text style={styles.parkedBadgeText}>{t('adminQueue.hold')}</Text>
              </View>
            )}
          </View>
          <View style={styles.ticketRight}>
            <View style={[styles.statusChip, { backgroundColor: statusBg }]}>
              <View style={[styles.statusDotSmall, { backgroundColor: statusColor }]} />
              <Text style={[styles.statusChipText, { color: statusColor }]}>
                {ticket.status.charAt(0).toUpperCase() + ticket.status.slice(1)}
              </Text>
            </View>
            <Text style={styles.waitTime}>{formatWait(ticket.created_at, t)}</Text>
          </View>
        </View>

        {/* Customer + meta info */}
        <View style={styles.ticketMeta}>
          {/* Name row — or source badge if no name & no phone */}
          {(!customerName && !customerPhone) ? (
            <View style={styles.customerRow}>
              {(() => {
                const src = getSourceIcon(ticket.source);
                return (
                  <View style={[styles.sourceBadge, { backgroundColor: src.color + '15' }]}>
                    <Ionicons name={src.name as any} size={12} color={src.color} />
                    <Text style={[styles.sourceBadgeText, { color: src.color }]}>{getSourceLabel(ticket.source, t)}</Text>
                  </View>
                );
              })()}
              {ticket.appointment_id && (
                <View style={[styles.sourceBadge, { backgroundColor: colors.primaryLight + '15' }]}>
                  <Ionicons name="calendar-outline" size={10} color={colors.primary} />
                  <Text style={[styles.sourceBadgeText, { color: colors.primary }]}>{t('source.booked')}</Text>
                </View>
              )}
            </View>
          ) : (
            <View style={styles.customerRow}>
              <Ionicons name="person-outline" size={13} color={colors.textSecondary} />
              <Text style={styles.customerName}>{customerName || t('booking.walkIn')}</Text>
            </View>
          )}
          {/* Phone + source row (only when source NOT in name slot) */}
          {(customerName || customerPhone) && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
              {customerPhone && (
                <TouchableOpacity
                  style={styles.phoneBadge}
                  onPress={() => dialPhone(customerPhone!)}
                  activeOpacity={0.6}
                >
                  <Ionicons name="call" size={12} color={colors.primary} />
                  <Text style={styles.phoneText}>{customerPhone}</Text>
                </TouchableOpacity>
              )}
              {(() => {
                const src = getSourceIcon(ticket.source);
                return (
                  <View style={[styles.sourceBadge, { backgroundColor: src.color + '15' }]}>
                    <Ionicons name={src.name as any} size={11} color={src.color} />
                    <Text style={[styles.sourceBadgeText, { color: src.color }]}>{getSourceLabel(ticket.source, t)}</Text>
                  </View>
                );
              })()}
              {ticket.appointment_id && (
                <View style={[styles.sourceBadge, { backgroundColor: colors.primaryLight + '15' }]}>
                  <Ionicons name="calendar-outline" size={10} color={colors.primary} />
                  <Text style={[styles.sourceBadgeText, { color: colors.primary }]}>{t('source.booked')}</Text>
                </View>
              )}
            </View>
          )}
          {customerNotes && (
            <View style={styles.notesBubble}>
              <Ionicons name="chatbubble-outline" size={11} color={colors.info} />
              <Text style={styles.notesText} numberOfLines={2}>{customerNotes}</Text>
            </View>
          )}
        </View>

        {/* Desk row */}
        {deskName ? (
          <View style={styles.deskStaffRow}>
            <View style={styles.deskBadge}>
              <Ionicons name="desktop-outline" size={12} color={colors.primary} />
              <Text style={styles.deskBadgeText}>{deskName}</Text>
            </View>
          </View>
        ) : null}

        {/* Actions */}
        {!isTerminal && (
          <View style={styles.ticketActions}>
            {isParked ? (
              <>
                <ActionBtn
                  label={t('adminQueue.toQueue')}
                  icon="arrow-undo-outline"
                  color={colors.primary}
                  onPress={() => handleUnparkToQueue(ticket)}
                />
              </>
            ) : (
              <>
                {ticket.status === 'waiting' && (
                  <>
                    <ActionBtn
                      label={t('adminQueue.callToDesk')}
                      icon="megaphone-outline"
                      color={colors.called}
                      onPress={() => handleCall(ticket)}
                    />
                    <ActionBtn
                      label={t('adminQueue.cancelTicket')}
                      icon="close-circle-outline"
                      color={colors.error}
                      onPress={() => handleCancel(ticket)}
                    />
                  </>
                )}
                {ticket.status === 'called' && (
                  <>
                    <ActionBtn
                      label={t('adminQueue.serve')}
                      icon="play-outline"
                      color={colors.serving}
                      onPress={() => handleServe(ticket)}
                    />
                    <ActionBtn
                      label={t('adminQueue.noShowTicket')}
                      icon="alert-circle-outline"
                      color={colors.warning}
                      onPress={() => handleNoShow(ticket)}
                    />
                    <ActionBtn
                      label={t('adminQueue.park')}
                      icon="pause-outline"
                      color={colors.textSecondary}
                      onPress={() => handlePark(ticket)}
                    />
                    <ActionBtn
                      label={t('adminQueue.requeue')}
                      icon="arrow-undo-outline"
                      color={colors.info}
                      onPress={() => handleBackToQueue(ticket)}
                    />
                  </>
                )}
                {ticket.status === 'serving' && (
                  <>
                    <ActionBtn
                      label={t('adminQueue.complete')}
                      icon="checkmark-circle-outline"
                      color={colors.success}
                      onPress={() => handleComplete(ticket)}
                    />
                    <ActionBtn
                      label={t('adminQueue.noShowTicket')}
                      icon="alert-circle-outline"
                      color={colors.warning}
                      onPress={() => handleNoShow(ticket)}
                    />
                    <ActionBtn
                      label={t('adminQueue.park')}
                      icon="pause-outline"
                      color={colors.textSecondary}
                      onPress={() => handlePark(ticket)}
                    />
                  </>
                )}
              </>
            )}
          </View>
        )}
      </View>
    );
  };

  // ── Desk section header ──────────────────────────────────────────

  const renderDeskSectionHeader = ({
    section,
  }: {
    section: {
      title: string;
      deskInfo: DeskInfo | null;
      staffName: string | null;
      deptName: string | null;
      ticketCount: number;
    };
  }) => {
    const { title, deskInfo, staffName, deptName, ticketCount } = section;
    const isUnassigned = deskInfo === null && title === t('adminQueue.waitingQueue');

    return (
      <View style={[styles.deskSectionHeader, isUnassigned && styles.deskSectionUnassigned]}>
        <View style={styles.deskSectionLeft}>
          {deskInfo ? (
            <View style={[styles.deskStatusIndicator, { backgroundColor: getDeskStatusColor(deskInfo.status) }]} />
          ) : (
            <Ionicons name="people-outline" size={16} color={colors.waiting} />
          )}
          <View style={{ flex: 1 }}>
            <View style={styles.deskTitleRow}>
              <Text style={styles.deskSectionTitle}>{title}</Text>
              {deskInfo && (
                <View style={[styles.deskStatusBadge, { backgroundColor: getDeskStatusColor(deskInfo.status) + '20' }]}>
                  <Text style={[styles.deskStatusBadgeText, { color: getDeskStatusColor(deskInfo.status) }]}>
                    {getDeskStatusLabel(deskInfo.status, t)}
                  </Text>
                </View>
              )}
            </View>
            <View style={styles.deskSubRow}>
              {deptName && (
                <View style={styles.deskMetaItem}>
                  <Ionicons name="folder-outline" size={11} color={colors.textMuted} />
                  <Text style={styles.deskMetaText}>{deptName}</Text>
                </View>
              )}
            </View>
          </View>
        </View>
        <View style={styles.deskCountCircle}>
          <Text style={styles.deskCountText}>{ticketCount}</Text>
        </View>
      </View>
    );
  };

  // ── Render ───────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Summary stats */}
      <View style={styles.summaryBar}>
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryCount, { color: colors.waiting }]}>{counts.waiting}</Text>
          <Text style={styles.summaryLabel}>{t('adminQueue.waiting')}</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryCount, { color: colors.called }]}>{counts.called}</Text>
          <Text style={styles.summaryLabel}>{t('adminQueue.called')}</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryCount, { color: colors.serving }]}>{counts.serving}</Text>
          <Text style={styles.summaryLabel}>{t('adminQueue.serving')}</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryCount, { color: colors.warning }]}>{counts.parked}</Text>
          <Text style={styles.summaryLabel}>{t('adminQueue.onHold')}</Text>
        </View>
        {longestWait && (
          <>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryCount, { color: colors.error }]}>{longestWait}</Text>
              <Text style={styles.summaryLabel}>Longest</Text>
            </View>
          </>
        )}
      </View>

      {/* Filter chips + view mode toggle */}
      <View style={styles.filterBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filtersScroll}
          contentContainerStyle={styles.filtersContent}
        >
          {FILTERS.map((f) => {
            const isActive = filter === f.key;
            const count = f.key === 'parked' ? parkedCount : counts[f.key as keyof typeof counts] ?? 0;
            return (
              <TouchableOpacity
                key={f.key}
                style={[
                  styles.filterChip,
                  isActive && styles.filterChipActive,
                ]}
                onPress={() => setFilter(f.key)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={f.icon as any}
                  size={13}
                  color={isActive ? '#fff' : colors.textSecondary}
                />
                <Text
                  style={[
                    styles.filterText,
                    isActive && styles.filterTextActive,
                  ]}
                >
                  {t(f.labelKey)}
                </Text>
                {typeof count === 'number' && count > 0 && (
                  <View style={[styles.filterCountBadge, isActive && styles.filterCountBadgeActive]}>
                    <Text style={[styles.filterCountText, isActive && styles.filterCountTextActive]}>
                      {count}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* View mode toggle */}
        {filter !== 'done' && (
          <View style={styles.viewToggle}>
            <TouchableOpacity
              style={[styles.viewBtn, viewMode === 'list' && styles.viewBtnActive]}
              onPress={() => setViewMode('list')}
            >
              <Ionicons
                name="list-outline"
                size={16}
                color={viewMode === 'list' ? colors.primary : colors.textMuted}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.viewBtn, viewMode === 'by_desk' && styles.viewBtnActive]}
              onPress={() => setViewMode('by_desk')}
            >
              <Ionicons
                name="grid-outline"
                size={16}
                color={viewMode === 'by_desk' ? colors.primary : colors.textMuted}
              />
            </TouchableOpacity>
          </View>
        )}
      </View>


      {/* Content */}
      {viewMode === 'by_desk' && filter !== 'done' ? (
        <SectionList
          sections={deskSections}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
            />
          }
          renderSectionHeader={renderDeskSectionHeader}
          renderItem={renderTicketCard}
          stickySectionHeadersEnabled={false}
          ListEmptyComponent={
            !loading ? (
              <View style={styles.empty}>
                <Ionicons name="checkmark-done-outline" size={48} color={colors.textMuted} />
                <Text style={styles.emptyText}>{t('adminQueue.noTickets')}</Text>
                <Text style={styles.emptySubtext}>{t('adminQueue.allClear')}</Text>
              </View>
            ) : null
          }
          renderSectionFooter={() => <View style={{ height: spacing.md }} />}
        />
      ) : (
        <FlatList
          data={filteredTickets}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            !loading ? (
              <View style={styles.empty}>
                <Ionicons
                  name="checkmark-done-outline"
                  size={48}
                  color={colors.textMuted}
                />
                <Text style={styles.emptyText}>{t('adminQueue.noTickets')}</Text>
                <Text style={styles.emptySubtext}>
                  {filter === 'active'
                    ? t('adminQueue.allClear')
                    : filter === 'parked'
                    ? t('adminQueue.noOnHold')
                    : t('adminQueue.noStatus', { status: t(`adminQueue.${filter}`).toLowerCase() })}
                </Text>
              </View>
            ) : null
          }
          renderItem={renderTicketCard}
        />
      )}
    </View>
  );
}

// ── ActionBtn ────────────────────────────────────────────────────────

function ActionBtn({
  label,
  icon,
  color,
  onPress,
}: {
  label: string;
  icon: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.actionBtn, { borderColor: color }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Ionicons name={icon as any} size={13} color={color} />
      <Text style={[styles.actionBtnText, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── Styles ───────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },

  // Summary bar
  summaryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  summaryCount: {
    fontSize: fontSize.xl,
    fontWeight: '800',
  },
  summaryLabel: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.textMuted,
  },
  summaryDivider: {
    width: 1,
    height: 28,
    backgroundColor: colors.border,
  },

  // Filter bar
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  filtersScroll: {
    flex: 1,
    flexGrow: 1,
  },
  filtersContent: {
    flexDirection: 'row',
    padding: spacing.sm,
    gap: spacing.xs,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 2,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceSecondary,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
  },
  filterText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  filterTextActive: {
    color: '#fff',
  },
  filterCountBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.border,
    paddingHorizontal: 4,
  },
  filterCountBadgeActive: {
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  filterCountText: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.textMuted,
  },
  filterCountTextActive: {
    color: '#fff',
  },

  // View mode toggle
  viewToggle: {
    flexDirection: 'row',
    marginRight: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  viewBtn: {
    padding: spacing.xs + 2,
    backgroundColor: colors.surfaceSecondary,
  },
  viewBtnActive: {
    backgroundColor: colors.primaryLight + '18',
  },

  // List
  list: {
    padding: spacing.md,
    gap: spacing.sm,
    paddingBottom: spacing.xxl,
  },

  // Empty state
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.xxl * 2,
  },
  emptyText: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.textMuted,
  },
  emptySubtext: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },

  // Ticket card
  ticketCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    gap: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  ticketCardParked: {
    borderWidth: 1,
    borderColor: colors.warning + '40',
  },
  ticketHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  ticketLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
  },
  ticketRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
  },
  statusDotSmall: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusChipText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
  ticketNumber: {
    fontSize: fontSize.lg,
    fontWeight: '800',
    color: colors.text,
  },
  priorityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
    backgroundColor: colors.warningLight,
  },
  priorityText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
  parkedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.warningLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  parkedBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.warning,
  },
  waitTime: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textSecondary,
  },

  // Ticket meta
  ticketMeta: {
    gap: 3,
    paddingLeft: 22,
  },
  customerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  customerName: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
  },
  metaText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  phoneBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primaryLight + '12',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    alignSelf: 'flex-start',
  },
  phoneText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.primary,
  },
  notesBubble: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    backgroundColor: colors.infoLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
  },
  notesText: {
    flex: 1,
    fontSize: fontSize.xs,
    fontStyle: 'italic',
    color: colors.text,
  },

  // Desk + staff row
  deskStaffRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: 22,
  },
  deskBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primaryLight + '15',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  deskBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
  },
  staffBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceSecondary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  staffBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
  },

  // Source row
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: 22,
  },
  sourceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  sourceBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
  },

  // Action buttons
  ticketActions: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingLeft: 22,
    flexWrap: 'wrap',
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 1,
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  actionBtnText: {
    fontSize: 11,
    fontWeight: '700',
  },

  // ── Desk Section (by_desk view) ──────────────────────────────────

  deskSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.xs,
  },
  deskSectionUnassigned: {
    borderColor: colors.waiting + '40',
    backgroundColor: colors.waitingBg,
  },
  deskSectionLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  deskStatusIndicator: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  deskTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  deskSectionTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.text,
  },
  deskStatusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  deskStatusBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  deskSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: 2,
  },
  deskMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  deskMetaText: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  deskCountCircle: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  deskCountText: {
    fontSize: fontSize.sm,
    fontWeight: '800',
    color: '#fff',
  },
});
