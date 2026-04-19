import { useState } from 'react';
import {
  Alert,
  FlatList,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { QueueTicket } from '@/lib/use-realtime-queue';
import { useAdaptiveQueue, useAdaptiveNameLookup } from '@/lib/use-adaptive-queue';
import { useOrg } from '@/lib/use-org';
import { useOperatorStore } from '@/lib/operator-store';
import * as Actions from '@/lib/data-adapter';
import { colors, borderRadius, fontSize, spacing } from '@/lib/theme';

type FilterTab = 'waiting' | 'called' | 'serving' | 'parked' | 'all';

function getTabs(t: (key: string) => string): { key: FilterTab; label: string; icon: keyof typeof Ionicons.glyphMap; color: string }[] {
  return [
    { key: 'waiting', label: t('operatorQueue.waiting'), icon: 'time-outline', color: colors.waiting },
    { key: 'called', label: t('operatorQueue.called'), icon: 'megaphone-outline', color: colors.called },
    { key: 'serving', label: t('operatorQueue.serving'), icon: 'hand-left-outline', color: colors.serving },
    { key: 'parked', label: t('operatorQueue.parked'), icon: 'pause-circle-outline', color: colors.warning },
    { key: 'all', label: t('operatorQueue.all'), icon: 'list-outline', color: colors.textSecondary },
  ];
}

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

/**
 * Resolve the effective source for a ticket.
 * The top-level `source` column is authoritative, but some creation paths
 * (e.g. WhatsApp/Messenger via messaging-commands) also mirror the channel
 * into `customer_data.source`. Prefer top-level, fall back to nested, then
 * fall back to null (→ "Web" label).
 */
function resolveSource(ticket: QueueTicket): string | null {
  return ticket.source || (ticket.customer_data as any)?.source || null;
}

function getSourceIcon(source: string | null): { name: keyof typeof Ionicons.glyphMap; color: string } {
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

function getSourceLabel(source: string | null, t: (key: string) => string): string {
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

function getWaitTime(createdAt: string, t: (key: string, opts?: any) => string): string {
  const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
  if (mins < 1) return t('time.lessThan1m');
  if (mins < 60) return t('time.minutes', { count: mins });
  return t('time.hoursMinutes', { h: Math.floor(mins / 60), m: mins % 60 });
}

export default function QueueScreen() {
  const { t } = useTranslation();
  const TABS = getTabs(t);
  const { session } = useOperatorStore();
  const { orgId, officeIds: orgOfficeIds } = useOrg();
  const officeId = session?.officeId ?? null;
  // In local mode, useOrg() returns empty — derive from session
  const officeIds = orgOfficeIds.length > 0 ? orgOfficeIds : (officeId ? [officeId] : []);
  const { queue, loading, refresh } = useAdaptiveQueue({ officeId });
  const names = useAdaptiveNameLookup(orgId, officeIds);
  const [activeTab, setActiveTab] = useState<FilterTab>('waiting');
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const tabFiltered = (() => {
    switch (activeTab) {
      case 'waiting': return [...queue.waiting, ...queue.parked];
      case 'called': return queue.called;
      case 'serving': return queue.serving;
      case 'parked': return queue.parked;
      case 'all': return [...queue.waiting, ...queue.called, ...queue.serving, ...queue.parked];
    }
  })();

  // Apply search filter (ticket number or customer name, case-insensitive)
  const filtered = searchQuery.trim()
    ? tabFiltered.filter((tk) => {
        const q = searchQuery.trim().toLowerCase();
        const num = (tk.ticket_number ?? '').toLowerCase();
        const name = (tk.customer_data?.name ?? '').toLowerCase();
        const phone = (tk.customer_data?.phone ?? '').toLowerCase();
        return num.includes(q) || name.includes(q) || phone.includes(q);
      })
    : tabFiltered;

  const counts: Record<FilterTab, number> = {
    waiting: queue.waiting.length + queue.parked.length,
    called: queue.called.length,
    serving: queue.serving.length,
    parked: queue.parked.length,
    all: queue.waiting.length + queue.called.length + queue.serving.length + queue.parked.length,
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

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
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            refresh();
          } catch (err: any) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            Alert.alert(t('common.error'), err.message ?? t('adminQueue.actionFailed'));
          }
        },
      },
    ]);
  };

  const handleCallToDesk = (tk: QueueTicket) => {
    if (!session?.deskId || !session?.staffId) {
      Alert.alert(t('desk.noDesk'), t('desk.noDeskMsg'));
      return;
    }
    confirmAction(t('adminQueue.callToDesk'), t('adminQueue.callTicketMsg', { ticket: tk.ticket_number, desk: session.deskName ?? t('desk.noDesk') }), () =>
      Actions.callSpecificTicket(tk.id, session.deskId!, session.staffId),
    );
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

  const handleResumeCall = (tk: QueueTicket) => {
    if (!session?.deskId || !session?.staffId) {
      Alert.alert(t('desk.noDesk'), t('desk.needDeskSession'));
      return;
    }
    confirmAction(t('adminQueue.callToDesk'), t('adminQueue.callTicketMsg', { ticket: tk.ticket_number, desk: session.deskName ?? t('desk.noDesk') }), () =>
      Actions.resumeParkedTicket(tk.id, session.deskId!, session.staffId),
    );
  };

  const handleUnparkToQueue = (tk: QueueTicket) => {
    confirmAction(t('adminQueue.backToQueue'), t('adminQueue.backToQueueMsg', { ticket: tk.ticket_number }), () =>
      Actions.unparkToQueue(tk.id),
    );
  };

  const handleRequeue = (tk: QueueTicket) => {
    confirmAction(t('adminQueue.backToQueue'), t('adminQueue.backToQueueMsg', { ticket: tk.ticket_number }), () =>
      Actions.resetToQueue(tk.id),
    );
  };

  // ── Render ───────────────────────────────────────────────────────

  const renderTicket = ({ item, index }: { item: QueueTicket; index: number }) => {
    const customerName = item.customer_data?.name || null;
    const customerPhone = item.customer_data?.phone ?? null;
    const customerNotes = item.customer_data?.notes || (item as any).customer_data?.reason || item.notes || null;
    const serviceName = item.service_id ? names.services[item.service_id] : null;
    const deskName = item.desk_id ? names.desks[item.desk_id] : null;
    const deptName = item.department_id ? names.departments[item.department_id] : null;
    const priority = item.priority_category_id ? names.priorities[item.priority_category_id] : null;
    const effectiveSource = resolveSource(item);
    const source = getSourceIcon(effectiveSource);
    const statusColor = getStatusColor(item.status);
    const statusBg = getStatusBg(item.status);
    const isParked = item.parked_at != null;
    const isTerminal = ['served', 'no_show', 'cancelled'].includes(item.status);

    return (
      <View style={styles.ticketCard}>
        {/* Top row: position + ticket number + status badge */}
        <View style={styles.ticketTopRow}>
          <View style={styles.ticketLeftGroup}>
            {activeTab === 'waiting' && (
              <View style={styles.positionCircle}>
                <Text style={styles.positionText}>{index + 1}</Text>
              </View>
            )}
            <Text style={styles.ticketNumber}>{item.ticket_number}</Text>
            {priority && (
              <View style={[styles.priorityBadge, { backgroundColor: (priority.color ?? colors.warning) + '20' }]}>
                <Ionicons name="flag" size={10} color={priority.color ?? colors.warning} />
                <Text style={[styles.priorityText, { color: priority.color ?? colors.warning }]}>{priority.name}</Text>
              </View>
            )}
            {item.parked_at && (
              <View style={styles.parkedBadge}>
                <Ionicons name="pause-circle" size={10} color={colors.warning} />
                <Text style={styles.parkedBadgeText}>{t('adminQueue.hold')}</Text>
              </View>
            )}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={styles.waitChip}>
              <Ionicons name="time-outline" size={12} color={colors.textMuted} />
              <Text style={styles.waitTime}>{getWaitTime(item.created_at, t)}</Text>
            </View>
            <View style={[styles.statusChip, { backgroundColor: statusBg }]}>
              <View style={[styles.statusDotSmall, { backgroundColor: statusColor }]} />
              <Text style={[styles.statusChipText, { color: statusColor }]}>
                {t(`status.${item.status === 'no_show' ? 'noShow' : item.status}`)}
              </Text>
            </View>
          </View>
        </View>

        {/* Middle: customer name + meta */}
        <View style={styles.ticketMiddle}>
          {/* Name row — or source badge if no name & no phone */}
          {(!customerName && !customerPhone) ? (
            <View style={styles.customerRow}>
              <View style={[styles.sourceChipInline, { backgroundColor: source.color + '15' }]}>
                <Ionicons name={source.name} size={12} color={source.color} />
                <Text style={[styles.sourceText, { color: source.color }]}>{getSourceLabel(effectiveSource, t)}</Text>
              </View>
            </View>
          ) : (
            <View style={styles.customerRow}>
              <Ionicons name="person-outline" size={14} color={colors.textSecondary} />
              <Text style={styles.customerName} numberOfLines={1}>{customerName || t('booking.walkIn')}</Text>
            </View>
          )}
          {(serviceName || deptName) && (
            <Text style={styles.ticketMeta} numberOfLines={1}>
              {[serviceName, deptName].filter(Boolean).join(' \u00B7 ')}
            </Text>
          )}
          {/* Phone + source row (only when source is NOT in name slot) */}
          {(customerName || customerPhone) && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap', marginLeft: spacing.xs + 14 }}>
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
              <View style={[styles.sourceChipInline, { backgroundColor: source.color + '15' }]}>
                <Ionicons name={source.name} size={11} color={source.color} />
                <Text style={[styles.sourceText, { color: source.color }]}>{getSourceLabel(effectiveSource, t)}</Text>
              </View>
            </View>
          )}
          {customerNotes && (
            <View style={styles.notesBubble}>
              <Ionicons name="chatbubble-outline" size={11} color={colors.info} />
              <Text style={styles.notesText} numberOfLines={2}>{customerNotes}</Text>
            </View>
          )}
        </View>

        {/* Bottom row: desk (only when assigned) */}
        {deskName ? (
          <View style={styles.ticketBottomRow}>
            <View style={styles.deskChip}>
              <Ionicons name="desktop-outline" size={12} color={colors.textSecondary} />
              <Text style={styles.deskChipText}>{deskName}</Text>
            </View>
          </View>
        ) : null}

        {/* Action buttons */}
        {!isTerminal && (
          <View style={styles.actionsRow}>
            {isParked ? (
              <>
                <ActionBtn label={t('adminQueue.callToDesk')} icon="megaphone-outline" color={colors.called} onPress={() => handleResumeCall(item)} />
                <ActionBtn label={t('adminQueue.toQueue')} icon="arrow-undo-outline" color={colors.warning} onPress={() => handleUnparkToQueue(item)} />
              </>
            ) : (
              <>
                {item.status === 'waiting' && (
                  <>
                    <ActionBtn label={t('adminQueue.callToDesk')} icon="megaphone-outline" color={colors.called} onPress={() => handleCallToDesk(item)} />
                    <ActionBtn label={t('adminQueue.park')} icon="pause-outline" color={colors.textSecondary} onPress={() => handlePark(item)} />
                    <ActionBtn label={t('common.cancel')} icon="close-circle-outline" color={colors.error} onPress={() => handleCancel(item)} />
                  </>
                )}
                {item.status === 'called' && (
                  <>
                    <ActionBtn label={t('adminQueue.serve')} icon="play-outline" color={colors.serving} onPress={() => handleServe(item)} />
                    <ActionBtn label={t('adminQueue.noShowTicket')} icon="alert-circle-outline" color={colors.warning} onPress={() => handleNoShow(item)} />
                    <ActionBtn label={t('adminQueue.park')} icon="pause-outline" color={colors.textSecondary} onPress={() => handlePark(item)} />
                    <ActionBtn label={t('adminQueue.requeue')} icon="arrow-undo-outline" color={colors.info} onPress={() => handleRequeue(item)} />
                  </>
                )}
                {item.status === 'serving' && (
                  <>
                    <ActionBtn label={t('adminQueue.complete')} icon="checkmark-circle-outline" color={colors.success} onPress={() => handleComplete(item)} />
                    <ActionBtn label={t('adminQueue.noShowTicket')} icon="alert-circle-outline" color={colors.warning} onPress={() => handleNoShow(item)} />
                    <ActionBtn label={t('adminQueue.park')} icon="pause-outline" color={colors.textSecondary} onPress={() => handlePark(item)} />
                  </>
                )}
              </>
            )}
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Summary bar */}
      <View style={styles.summaryBar}>
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryCount, { color: colors.waiting }]}>{counts.waiting}</Text>
          <Text style={styles.summaryLabel}>{t('operatorQueue.waiting')}</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryCount, { color: colors.called }]}>{counts.called}</Text>
          <Text style={styles.summaryLabel}>{t('operatorQueue.called')}</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryCount, { color: colors.serving }]}>{counts.serving}</Text>
          <Text style={styles.summaryLabel}>{t('operatorQueue.serving')}</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryCount, { color: colors.warning }]}>{counts.parked}</Text>
          <Text style={styles.summaryLabel}>{t('operatorQueue.onHold')}</Text>
        </View>
      </View>

      {/* Search bar */}
      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={16} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder={t('operatorQueue.searchPlaceholder', { defaultValue: 'Search ticket #, name, phone…' })}
          placeholderTextColor={colors.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={10}>
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Filter Tabs — segmented control inside a single capsule */}
      <View style={styles.tabsOuter}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabsContainer}
        >
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                style={[
                  styles.tabPill,
                  isActive && { backgroundColor: tab.color + '18' },
                ]}
                onPress={() => setActiveTab(tab.key)}
                activeOpacity={0.7}
              >
                <Ionicons name={tab.icon} size={14} color={isActive ? tab.color : colors.textMuted} />
                <Text style={[
                  styles.tabPillText,
                  isActive && { color: tab.color, fontWeight: '700' },
                ]}>
                  {tab.label}
                </Text>
                <View style={[
                  styles.tabCountBadge,
                  isActive && { backgroundColor: tab.color },
                ]}>
                  <Text style={[
                    styles.tabCountText,
                    isActive && { color: '#fff' },
                  ]}>
                    {counts[tab.key]}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIconCircle}>
              <Ionicons name="checkmark-done" size={32} color={colors.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>
              {loading ? t('common.loading') : t('operatorQueue.allClear')}
            </Text>
            <Text style={styles.emptyText}>
              {loading ? '' : activeTab !== 'all' ? t('operatorQueue.noTicketsNow', { status: activeTab }) : t('operatorQueue.noTickets')}
            </Text>
          </View>
        }
        renderItem={renderTicket}
      />
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

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

  // Search bar
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: borderRadius.full,
  },
  searchInput: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.text,
    paddingVertical: 4,
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

  // Pill tabs
  tabsOuter: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceSecondary,
    borderRadius: borderRadius.full,
    padding: 3,
    gap: 2,
  },
  tabPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.full,
    backgroundColor: 'transparent',
  },
  tabPillText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
  },
  tabCountBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.border,
    paddingHorizontal: 4,
  },
  tabCountText: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.textMuted,
  },

  // List
  list: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.sm,
    paddingBottom: spacing.xxl,
  },

  // Empty state
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.xxl + spacing.xl,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surfaceSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  emptyTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.text,
  },
  emptyText: {
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
  ticketTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ticketLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  positionCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primaryLight + '18',
    alignItems: 'center',
    justifyContent: 'center',
  },
  positionText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.primary,
  },
  ticketNumber: {
    fontSize: fontSize.lg,
    fontWeight: '800',
    color: colors.text,
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

  // Customer info
  ticketMiddle: {
    gap: 3,
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
    flex: 1,
  },
  ticketMeta: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginLeft: spacing.xs + 14, // align with name after icon
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
    marginLeft: spacing.xs + 14,
  },
  notesText: {
    flex: 1,
    fontSize: fontSize.xs,
    fontStyle: 'italic',
    color: colors.text,
  },

  // Bottom row
  ticketBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  sourceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceSecondary,
  },
  sourceChipInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceSecondary,
  },
  sourceText: {
    fontSize: 10,
    fontWeight: '700',
  },
  deskChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceSecondary,
  },
  deskChipText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  waitChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  waitTime: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.textMuted,
    fontVariant: ['tabular-nums'] as any,
  },

  // Priority + parked badges
  priorityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  priorityText: { fontSize: 9, fontWeight: '700' },
  parkedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.warningLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  parkedBadgeText: { fontSize: 9, fontWeight: '700', color: colors.warning },

  // Action buttons
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    flexWrap: 'wrap',
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
});
