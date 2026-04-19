import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  Linking,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useNavigation } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';

import { QueueTicket } from '@/lib/use-realtime-queue';
import { useAdaptiveQueue, useAdaptiveNameLookup } from '@/lib/use-adaptive-queue';
import { useOrg } from '@/lib/use-org';
import * as Actions from '@/lib/data-adapter';
import { sendHeartbeat, triggerRecovery } from '@/lib/api';
import { useOperatorStore } from '@/lib/operator-store';
import { supabase } from '@/lib/supabase';
import { useLocalConnectionStore } from '@/lib/local-connection-store';
import { colors, borderRadius, fontSize, spacing } from '@/lib/theme';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dialPhone(raw: string) {
  const t = raw.trim();
  if (t.startsWith('+')) { Linking.openURL(`tel:${t}`); return; }
  const d = t.replace(/\D/g, '');
  if (d.length === 10 && d.startsWith('0')) { Linking.openURL(`tel:+213${d.slice(1)}`); return; }
  if (d.length === 10) { Linking.openURL(`tel:+1${d}`); return; }
  if (d.length === 11 && d.startsWith('1')) { Linking.openURL(`tel:+${d}`); return; }
  Linking.openURL(`tel:${t}`);
}

function formatElapsed(since: string | null): string {
  if (!since) return '--:--';
  const diff = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 1000));
  const m = Math.floor(diff / 60);
  const s = diff % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function elapsedSeconds(since: string | null): number {
  if (!since) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 1000));
}

function useTimer(running: boolean) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [running]);
  return tick;
}

function useScreenWidth() {
  const [width, setWidth] = useState(Dimensions.get('window').width);
  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => setWidth(window.width));
    return () => sub.remove();
  }, []);
  return width;
}

// ---------------------------------------------------------------------------
// Transfer Modal
// ---------------------------------------------------------------------------

interface TransferTarget {
  departmentId: string;
  departmentName: string;
  serviceId: string;
  serviceName: string;
}

function TransferModal({
  visible,
  officeId,
  onClose,
  onSelect,
}: {
  visible: boolean;
  officeId: string;
  onClose: () => void;
  onSelect: (target: TransferTarget) => void;
}) {
  const { t } = useTranslation();
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [services, setServices] = useState<{ id: string; name: string; department_id: string }[]>([]);
  const [selectedDept, setSelectedDept] = useState<string | null>(null);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (!visible) return;
    setSelectedDept(null);
    setLoadingData(true);

    const load = async () => {
      try {
        const [depts, svcs] = await Promise.all([
          Actions.fetchOfficeDepartments(officeId),
          Actions.fetchDepartmentServices(officeId),
        ]);
        setDepartments((depts as any)?.data ?? depts ?? []);
        setServices((svcs as any)?.data ?? svcs ?? []);
      } catch { /* ignore load errors */ }
      setLoadingData(false);
    };
    load();
  }, [visible, officeId]);

  const filteredServices = selectedDept
    ? services.filter((s) => s.department_id === selectedDept)
    : [];

  const selectedDeptName = departments.find((d) => d.id === selectedDept)?.name ?? '';

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={modalStyles.overlay}>
        <View style={modalStyles.container}>
          <View style={modalStyles.header}>
            <Text style={modalStyles.title}>{t('desk.transferTicket')}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          {loadingData ? (
            <ActivityIndicator size="large" color={colors.primary} style={{ marginVertical: spacing.xxl }} />
          ) : !selectedDept ? (
            <>
              <Text style={modalStyles.sectionLabel}>{t('desk.selectDepartment')}</Text>
              <ScrollView style={modalStyles.list}>
                {departments.map((d) => (
                  <TouchableOpacity
                    key={d.id}
                    style={modalStyles.listItem}
                    onPress={() => setSelectedDept(d.id)}
                  >
                    <Ionicons name="business-outline" size={20} color={colors.primary} />
                    <Text style={modalStyles.listItemText}>{d.name}</Text>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                ))}
                {departments.length === 0 && (
                  <Text style={modalStyles.emptyText}>{t('desk.noDepartments')}</Text>
                )}
              </ScrollView>
            </>
          ) : (
            <>
              <TouchableOpacity
                style={modalStyles.backRow}
                onPress={() => setSelectedDept(null)}
              >
                <Ionicons name="arrow-back" size={20} color={colors.primary} />
                <Text style={modalStyles.backText}>{selectedDeptName}</Text>
              </TouchableOpacity>
              <Text style={modalStyles.sectionLabel}>{t('desk.selectService')}</Text>
              <ScrollView style={modalStyles.list}>
                {filteredServices.map((s) => (
                  <TouchableOpacity
                    key={s.id}
                    style={modalStyles.listItem}
                    onPress={() =>
                      onSelect({
                        departmentId: selectedDept,
                        departmentName: selectedDeptName,
                        serviceId: s.id,
                        serviceName: s.name,
                      })
                    }
                  >
                    <Ionicons name="layers-outline" size={20} color={colors.serving} />
                    <Text style={modalStyles.listItemText}>{s.name}</Text>
                    <Ionicons name="arrow-forward" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                ))}
                {filteredServices.length === 0 && (
                  <Text style={modalStyles.emptyText}>{t('desk.noServicesInDept')}</Text>
                )}
              </ScrollView>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    maxHeight: '80%',
    paddingBottom: spacing.xxl,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.text,
  },
  sectionLabel: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  list: {
    paddingHorizontal: spacing.md,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  listItemText: {
    flex: 1,
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  backText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.primary,
  },
  emptyText: {
    fontSize: fontSize.md,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
});

// ---------------------------------------------------------------------------
// Main Screen
// ---------------------------------------------------------------------------

export default function DeskScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session, clearSession } = useOperatorStore();
  const { orgId } = useOrg();

  const officeId = session?.officeId ?? null;
  const deskId = session?.deskId ?? null;
  const staffId = session?.staffId ?? null;

  const officeIds = useMemo(() => (officeId ? [officeId] : []), [officeId]);
  const { queue, loading, refresh } = useAdaptiveQueue({ officeId });
  const names = useAdaptiveNameLookup(orgId, officeIds);

  const [actionLoading, setActionLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [transferVisible, setTransferVisible] = useState(false);
  const [recentlyServedExpanded, setRecentlyServedExpanded] = useState(false);
  const [servedSortNewest, setServedSortNewest] = useState(true);
  const [deskStatus, setDeskStatus] = useState<'open' | 'closed' | 'on_break'>('open');
  const [switchDeskVisible, setSwitchDeskVisible] = useState(false);
  const [availableDesks, setAvailableDesks] = useState<any[]>([]);
  const [switchLoading, setSwitchLoading] = useState(false);
  const [upcomingAppts, setUpcomingAppts] = useState<any[]>([]);

  const screenWidth = useScreenWidth();
  const isWide = screenWidth > 768;

  // ── Offline detection ────────────────────────────────────────────
  const [isOffline, setIsOffline] = useState(false);
  const consecutiveFailsRef = useRef(0);

  // ── Safety: heartbeat + periodic cleanup ─────────────────────────
  useEffect(() => {
    if (!deskId || !staffId) return;

    const isLocal = useLocalConnectionStore.getState().mode === 'local';
    const ping = async () => {
      if (isLocal) {
        // In local mode, the health monitor handles connectivity
        return;
      }
      Actions.pingDeskHeartbeat(deskId);
      const ok = await sendHeartbeat(deskId, staffId);
      if (!ok) {
        consecutiveFailsRef.current += 1;
        if (consecutiveFailsRef.current >= 3) setIsOffline(true);
      } else {
        consecutiveFailsRef.current = 0;
        setIsOffline(false);
      }
    };

    // Fetch current desk status on mount — only auto-open if closed
    const loadDeskStatus = async () => {
      try {
        const desks = await Actions.fetchAvailableDesks(officeId);
        const myDesk = (desks as any[])?.find?.((d: any) => d.id === deskId);
        if (myDesk?.status === 'on_break') {
          setDeskStatus('on_break');
        } else if (myDesk?.status === 'closed' || !myDesk) {
          Actions.openDesk(deskId, staffId).catch((err) =>
            console.warn('[Desk] auto-open error:', err.message)
          );
        }
      } catch { /* ignore */ }
    };
    loadDeskStatus();

    ping(); // immediate first ping
    const heartbeat = setInterval(ping, 30_000);

    // Requeue expired calls every 30s + auto-resolve stale tickets every 60s
    const cleanup = setInterval(() => {
      Actions.requeueExpiredCalls(90);
      Actions.adjustBookingPriorities();
    }, 30_000);

    const autoResolve = setInterval(() => {
      Actions.autoResolveTickets();
    }, 60_000);

    // Cleanup stale tickets on mount + trigger cloud recovery + auto-resolve
    if (!isLocal) {
      Actions.cleanupStaleTickets();
      Actions.autoResolveTickets();
      triggerRecovery();
    }

    return () => {
      clearInterval(heartbeat);
      clearInterval(cleanup);
      clearInterval(autoResolve);
    };
  }, [deskId, staffId]);

  // ── Upcoming appointments today (read-only heads-up) ─────────────
  useEffect(() => {
    if (!officeId) return;
    let cancelled = false;
    const loadAppts = async () => {
      try {
        const appts = await Actions.fetchAppointments([officeId]);
        if (cancelled) return;
        const now = Date.now();
        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);
        const next = (appts as any[])
          .filter(
            (a) =>
              (a.status === 'pending' || a.status === 'confirmed') &&
              new Date(a.scheduled_at).getTime() >= now - 15 * 60 * 1000 && // include ones that started up to 15min ago
              new Date(a.scheduled_at).getTime() <= endOfDay.getTime(),
          )
          .slice(0, 3);
        setUpcomingAppts(next);
      } catch { /* ignore — cloud may be unreachable in local mode */ }
    };
    loadAppts();
    const iv = setInterval(loadAppts, 60_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [officeId]);

  // ── Realtime desk status sync (pick up changes from Station/web) ──
  const localMode = useLocalConnectionStore((s) => s.mode);
  const stationUrl = useLocalConnectionStore((s) => s.stationUrl);

  // Cloud mode: Supabase realtime
  useEffect(() => {
    if (!deskId || localMode === 'local') return;
    const channel = supabase.channel(`desk-status-${deskId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'desks', filter: `id=eq.${deskId}` },
        (payload: any) => {
          const newStatus = payload.new?.status;
          if (newStatus && (newStatus === 'open' || newStatus === 'closed' || newStatus === 'on_break')) {
            setDeskStatus(newStatus);
          }
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [deskId, localMode]);

  // Local mode: poll Station desk status every 5s
  const deskStatusRef = useRef(deskStatus);
  deskStatusRef.current = deskStatus;
  useEffect(() => {
    if (localMode !== 'local' || !stationUrl || !deskId || !officeId) return;
    const poll = async () => {
      try {
        const SC = require('@/lib/station-client');
        const desks = await SC.stationQuery(stationUrl, 'desks', [officeId]);
        const myDesk = desks.find((d: any) => d.id === deskId);
        if (myDesk?.status && myDesk.status !== deskStatusRef.current) {
          setDeskStatus(myDesk.status);
        }
      } catch {}
    };
    poll();
    const iv = setInterval(poll, 2000);
    return () => clearInterval(iv);
  }, [localMode, stationUrl, deskId, officeId]);

  // ── Derive desk-specific tickets ─────────────────────────────────
  const myCalledTickets = useMemo(
    () => queue.called.filter((t) => t.desk_id === deskId),
    [queue.called, deskId],
  );
  const myServingTickets = useMemo(
    () => queue.serving.filter((t) => t.desk_id === deskId),
    [queue.serving, deskId],
  );

  const activeTicket: QueueTicket | null = myServingTickets[0] ?? myCalledTickets[0] ?? null;
  const hasActive = activeTicket !== null;

  // Timer ticks for live elapsed display
  useTimer(hasActive);

  // Determine status dot color — desk status takes priority when on_break
  const statusColor = deskStatus === 'on_break'
    ? colors.warning
    : myServingTickets.length > 0
      ? colors.serving
      : myCalledTickets.length > 0
        ? colors.called
        : queue.waiting.length > 0
          ? colors.primary
          : colors.success;

  const statusLabel = deskStatus === 'on_break'
    ? t('desk.onBreak')
    : myServingTickets.length > 0
      ? t('status.serving')
      : myCalledTickets.length > 0
        ? t('status.called')
        : queue.waiting.length > 0
          ? t('desk.idle')
          : t('desk.idle');

  // ── Pull-to-refresh ──────────────────────────────────────────────
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  // ── Confirmed action wrapper ─────────────────────────────────────
  const confirmAction = (
    title: string,
    message: string,
    action: () => Promise<void>,
    destructive = false,
  ) => {
    Alert.alert(title, message, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.confirm'),
        style: destructive ? 'destructive' : 'default',
        onPress: async () => {
          setActionLoading(true);
          try {
            await action();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          } catch (err: any) {
            Alert.alert(t('common.error'), err?.message ?? t('adminQueue.actionFailed'));
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          }
          await refresh();
          setActionLoading(false);
        },
      },
    ]);
  };

  // ── Actions ──────────────────────────────────────────────────────
  const handleCallNext = () => {
    if (!deskId || !staffId) return;
    confirmAction(
      t('desk.callNext'),
      t('adminQueue.callTicketMsgGeneric', { ticket: t('adminQueue.nextInLine') }),
      async () => {
        const result = await Actions.callNextTicket(deskId, staffId);
        if (!result) {
          Alert.alert(t('desk.noOneWaiting'), t('desk.noOneWaiting'));
        }
      },
    );
  };

  const handleStartServing = () => {
    if (!activeTicket) return;
    confirmAction(
      t('desk.startService'),
      t('adminQueue.startServingMsg', { ticket: activeTicket.ticket_number }),
      () => Actions.startServing(activeTicket.id),
    );
  };

  const handleRecall = () => {
    if (!activeTicket) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setActionLoading(true);
    Actions.recallTicket(activeTicket.id)
      .then(() => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        refresh();
      })
      .catch((err) => Alert.alert(t('common.error'), err.message))
      .finally(() => setActionLoading(false));
  };

  const handleNoShow = () => {
    if (!activeTicket) return;
    confirmAction(
      t('desk.markNoShow'),
      t('adminQueue.noShowMsg', { ticket: activeTicket.ticket_number }),
      () => Actions.markNoShow(activeTicket.id),
      true,
    );
  };

  const handleBackToQueue = () => {
    if (!activeTicket) return;
    confirmAction(
      t('adminQueue.backToQueue'),
      t('adminQueue.backToQueueMsg', { ticket: activeTicket.ticket_number }),
      () => Actions.resetToQueue(activeTicket.id),
    );
  };

  const handlePark = () => {
    if (!activeTicket) return;
    confirmAction(
      t('desk.parkHold'),
      t('adminQueue.parkMsg', { ticket: activeTicket.ticket_number }),
      () => Actions.parkTicket(activeTicket.id),
    );
  };

  const handleMarkServed = () => {
    if (!activeTicket) return;
    confirmAction(
      t('desk.markServed'),
      t('adminQueue.completeMsg', { ticket: activeTicket.ticket_number }),
      () => Actions.markServed(activeTicket.id),
    );
  };

  const handleTransferSelect = (target: TransferTarget) => {
    if (!activeTicket) return;
    setTransferVisible(false);
    confirmAction(
      t('desk.transferTicket'),
      `${t('desk.transfer')} ${activeTicket.ticket_number} → ${target.departmentName} / ${target.serviceName}?`,
      () => Actions.transferTicket(activeTicket.id, target.departmentId, target.serviceId),
    );
  };

  const handleResumeParked = (ticket: QueueTicket) => {
    if (!deskId || !staffId) return;
    if (hasActive) {
      Alert.alert(t('common.error'), t('desk.needDeskSession'));
      return;
    }
    confirmAction(
      t('adminQueue.callToDesk'),
      t('adminQueue.callTicketMsg', { ticket: ticket.ticket_number, desk: session?.deskName ?? '' }),
      () => Actions.resumeParkedTicket(ticket.id, deskId, staffId),
    );
  };

  const handleUnparkToQueue = (ticket: QueueTicket) => {
    confirmAction(
      t('adminQueue.backToQueue'),
      t('adminQueue.backToQueueMsg', { ticket: ticket.ticket_number }),
      () => Actions.unparkToQueue(ticket.id),
    );
  };

  const handleDeskOnBreak = () => {
    if (!deskId) return;
    confirmAction(
      t('desk.takeBreak'),
      t('desk.takeBreakMsg'),
      async () => {
        await Actions.setDeskOnBreak(deskId);
        setDeskStatus('on_break');
      },
    );
  };

  const handleDeskResume = () => {
    if (!deskId) return;
    setActionLoading(true);
    Actions.setDeskOpen(deskId)
      .then(() => {
        setDeskStatus('open');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      })
      .catch((err) => Alert.alert(t('common.error'), err.message))
      .finally(() => setActionLoading(false));
  };

  const handleCallSpecific = (ticket: QueueTicket) => {
    if (!deskId || !staffId) return;
    confirmAction(
      t('adminQueue.callTicket'),
      t('adminQueue.callTicketMsg', { ticket: ticket.ticket_number, desk: session?.deskName ?? t('desk.noDesk') }),
      () => Actions.callSpecificTicket(ticket.id, deskId, staffId),
    );
  };

  const openSwitchDesk = async () => {
    if (!officeId) return;
    setSwitchLoading(true);
    setSwitchDeskVisible(true);
    try {
      const desks = await Actions.fetchAvailableDesks(officeId);
      setAvailableDesks(desks);
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message ?? t('adminQueue.actionFailed'));
    }
    setSwitchLoading(false);
  };

  const handleSwitchToDesk = async (newDesk: any) => {
    if (!staffId) return;
    if (newDesk.id === deskId) {
      setSwitchDeskVisible(false);
      return;
    }
    if (hasActive) {
      Alert.alert(t('common.error'), t('desk.needDeskSession'));
      return;
    }
    setSwitchLoading(true);
    try {
      const result = await Actions.switchDesk(newDesk.id, staffId, deskId);
      // Update operator store with new desk info
      const { setSession } = useOperatorStore.getState();
      setSession({
        staffId,
        deskId: result.id,
        deskName: result.display_name || result.name,
        officeId: (result as any).offices?.id ?? officeId!,
        officeName: (result as any).offices?.name ?? session!.officeName,
        departmentId: (result as any).departments?.id ?? null,
        departmentName: (result as any).departments?.name ?? null,
      });
      setDeskStatus('open');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSwitchDeskVisible(false);
      refresh();
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message ?? t('adminQueue.actionFailed'));
    }
    setSwitchLoading(false);
  };

  // ── Header: Switch Desk (left) + title with desk name + pause/local (right) ───
  const navigation = useNavigation();
  const connectionStatus = useLocalConnectionStore((s) => s.connectionStatus);
  const isLocalMode = localMode === 'local';
  const showPauseInHeader = !hasActive && deskStatus !== 'on_break';
  useEffect(() => {
    const deskLabel = session?.deskName ? `${t('admin.myDesk')} · ${session.deskName}` : t('admin.myDesk');
    navigation.setOptions({
      title: deskLabel,
      headerLeft: () => (
        <TouchableOpacity
          onPress={openSwitchDesk}
          disabled={actionLoading}
          activeOpacity={0.7}
          style={styles.headerSwitchBtn}
        >
          <Ionicons name="swap-horizontal" size={16} color="#fff" />
        </TouchableOpacity>
      ),
      headerRight: () => (
        <View style={styles.headerRightRow}>
          {showPauseInHeader ? (
            <TouchableOpacity
              style={styles.headerPauseChip}
              onPress={handleDeskOnBreak}
              disabled={actionLoading}
              activeOpacity={0.7}
            >
              <Ionicons name="cafe-outline" size={14} color="#fbbf24" />
              <Text style={styles.headerPauseText}>{t('desk.onBreak')}</Text>
            </TouchableOpacity>
          ) : null}
          {isLocalMode ? (
            <TouchableOpacity
              style={styles.headerLocalBadge}
              onPress={() => router.push('/(operator)/settings')}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.headerLocalDot,
                  connectionStatus === 'error' && styles.headerLocalDotError,
                ]}
              />
              <Text style={styles.headerLocalText}>{t('connectStation.localMode')}</Text>
              <Ionicons name="chevron-down" size={12} color="#86efac" />
            </TouchableOpacity>
          ) : null}
        </View>
      ),
    });
  }, [
    navigation,
    actionLoading,
    t,
    session?.deskName,
    showPauseInHeader,
    isLocalMode,
    connectionStatus,
    router,
  ]);

  // ── Guards ───────────────────────────────────────────────────────
  // If there's no operator session, send the user to the desk picker
  // (role-select) rather than login. They may still be authenticated —
  // they just haven't picked a desk yet (e.g. an admin tapping "My Desk"
  // for the first time, or a fresh install right after login).
  useEffect(() => {
    if (!session) {
      router.replace('/(auth)/role-select');
    }
  }, [session, router]);

  if (!session) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>{t('desk.loadingQueue')}</Text>
      </View>
    );
  }

  // ── Upcoming Appointments card (heads-up, only when any exist) ──
  const UpcomingAppointmentsCard = upcomingAppts.length > 0 ? (
    <View style={styles.upcomingCard}>
      <View style={styles.upcomingHeader}>
        <Ionicons name="calendar-outline" size={16} color={colors.primary} />
        <Text style={styles.upcomingTitle}>
          {t('desk.upcoming', { defaultValue: 'Upcoming today' })}
        </Text>
        <View style={styles.upcomingCount}>
          <Text style={styles.upcomingCountText}>{upcomingAppts.length}</Text>
        </View>
      </View>
      {upcomingAppts.map((a) => {
        const time = new Date(a.scheduled_at).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });
        const svcName = a.service_id ? names.services[a.service_id] ?? '' : '';
        return (
          <View key={a.id} style={styles.upcomingItem}>
            <Text style={styles.upcomingTime}>{time}</Text>
            <Text style={styles.upcomingName} numberOfLines={1}>
              {a.customer_name}
            </Text>
            {svcName ? (
              <Text style={styles.upcomingSvc} numberOfLines={1}>
                {svcName}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  ) : null;

  // ── Take Break chip moved to the header (see navigation.setOptions above) ──

  const WaitingCountCard = (
    <View style={styles.waitingCard}>
      <Ionicons name="people-outline" size={18} color={colors.waiting} />
      <Text style={styles.waitingNumber}>{queue.waiting.length}</Text>
      <Text style={styles.waitingSubtext}>{t('desk.waiting')}</Text>
    </View>
  );

  // ── Current ticket card ──────────────────────────────────────────
  const servingTimerSec = activeTicket?.serving_started_at
    ? elapsedSeconds(activeTicket.serving_started_at)
    : 0;
  const isServingOvertime = servingTimerSec > 600; // >10 min

  const priorityInfo = activeTicket?.priority_category_id
    ? names.priorities[activeTicket.priority_category_id]
    : null;

  // Call elapsed seconds for countdown display
  const calledElapsedSec = activeTicket?.called_at ? elapsedSeconds(activeTicket.called_at) : 0;
  const CALL_TIMEOUT_SEC = 60; // 60 seconds to respond
  const callRemainingPct = activeTicket?.status === 'called'
    ? Math.max(0, 1 - calledElapsedSec / CALL_TIMEOUT_SEC)
    : 0;
  const isCallExpiring = activeTicket?.status === 'called' && calledElapsedSec > CALL_TIMEOUT_SEC * 0.75;

  const CurrentTicketCard = activeTicket ? (
    <View
      style={styles.ticketCard}
    >
      {/* Header: ticket # + status capsule (with service timer stacked below on serving) */}
      <View style={styles.ticketHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap', flex: 1 }}>
          <Text style={styles.ticketNumber}>{activeTicket.ticket_number}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: spacing.xs }}>
          <View
            style={[
              styles.statusBadge,
              {
                backgroundColor:
                  activeTicket.status === 'serving' ? colors.servingBg : colors.calledBg,
              },
            ]}
          >
            <Text
              style={[
                styles.statusBadgeText,
                {
                  color:
                    activeTicket.status === 'serving' ? colors.serving : colors.called,
                },
              ]}
            >
              {activeTicket.status === 'called' ? t('status.called') : t('status.serving')}
            </Text>
          </View>
          {activeTicket.status === 'serving' && activeTicket.serving_started_at ? (
            <View style={[
              styles.inlineTimerChip,
              isServingOvertime && { backgroundColor: colors.error + '15' },
            ]}>
              <Ionicons
                name="time-outline"
                size={13}
                color={isServingOvertime ? colors.error : colors.textSecondary}
              />
              <Text style={[
                styles.inlineTimerText,
                isServingOvertime && { color: colors.error },
              ]}>
                {formatElapsed(activeTicket.serving_started_at)}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* Customer & meta */}
      <View style={styles.metaCompact}>
        {(() => {
          const hasName = !!activeTicket.customer_data?.name;
          const hasPhone = !!activeTicket.customer_data?.phone;
          // Prefer top-level source column, fall back to customer_data.source
          // (messaging-commands mirrors the channel into customer_data for
          // WhatsApp/Messenger; this keeps display correct if either is set).
          const src = activeTicket.source || (activeTicket.customer_data as any)?.source || null;
          const iconMap: Record<string, { name: keyof typeof Ionicons.glyphMap; color: string; labelKey: string }> = {
            whatsapp: { name: 'logo-whatsapp', color: '#25D366', labelKey: 'source.whatsapp' },
            messenger: { name: 'chatbubble-ellipses', color: '#0084FF', labelKey: 'source.messenger' },
            kiosk: { name: 'tablet-portrait-outline', color: '#8B5CF6', labelKey: 'source.kiosk' },
            qr_code: { name: 'qr-code-outline', color: '#F59E0B', labelKey: 'source.qrCode' },
            walk_in: { name: 'walk-outline', color: '#64748B', labelKey: 'source.walkIn' },
            in_house: { name: 'business-outline', color: '#6366F1', labelKey: 'source.inHouse' },
          };
          const info = iconMap[src ?? ''] ?? { name: 'globe-outline' as keyof typeof Ionicons.glyphMap, color: colors.textMuted, labelKey: 'source.web' };

          const sourceBadgeEl = (
            <View style={[styles.sourceBadge, { backgroundColor: info.color + '15' }]}>
              <Ionicons name={info.name} size={13} color={info.color} />
              <Text style={[styles.sourceBadgeText, { color: info.color }]}>{t(info.labelKey)}</Text>
            </View>
          );

          // Single flat row: name · phone · source
          return (
            <View style={styles.sourceBadgeRow}>
              {hasName ? (
                <Text style={styles.metaName} numberOfLines={1}>
                  {activeTicket.customer_data?.name}
                </Text>
              ) : !hasPhone ? (
                <Text style={styles.metaName} numberOfLines={1}>
                  {t('booking.walkIn')}
                </Text>
              ) : null}
              {hasPhone && (
                <TouchableOpacity
                  style={styles.phoneBadge}
                  onPress={() => dialPhone(activeTicket.customer_data!.phone)}
                  activeOpacity={0.6}
                >
                  <Ionicons name="call" size={12} color={colors.primary} />
                  <Text style={{ fontSize: fontSize.xs, color: colors.primary, fontWeight: '600' }}>
                    {activeTicket.customer_data!.phone}
                  </Text>
                </TouchableOpacity>
              )}
              {sourceBadgeEl}
            </View>
          );
        })()}
        {priorityInfo ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons name="flag" size={12} color={priorityInfo.color ?? colors.warning} />
            <Text style={{ fontSize: fontSize.xs, fontWeight: '700', color: priorityInfo.color ?? colors.warning }}>
              {priorityInfo.name}
            </Text>
          </View>
        ) : null}
        {(activeTicket.customer_data?.reason || activeTicket.customer_data?.notes || activeTicket.notes) ? (
          <View style={styles.notesBubble}>
            <Ionicons name="chatbubble-outline" size={12} color={colors.info} />
            <Text style={[styles.notesText, { color: colors.text }]} numberOfLines={3}>
              {activeTicket.customer_data?.reason || activeTicket.customer_data?.notes || activeTicket.notes}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Called state: countdown bar + prominent Start Serving */}
      {activeTicket.status === 'called' ? (
        <>
          {/* Call countdown */}
          <View style={styles.countdownSection}>
            <View style={styles.countdownRow}>
              <Ionicons
                name="timer-outline"
                size={16}
                color={isCallExpiring ? colors.error : colors.called}
              />
              <Text style={[styles.countdownText, isCallExpiring && { color: colors.error }]}>
                {t('desk.secondsRemaining', { seconds: Math.max(0, CALL_TIMEOUT_SEC - calledElapsedSec) })}
              </Text>
            </View>
            <View style={styles.countdownBarBg}>
              <View
                style={[
                  styles.countdownBarFill,
                  {
                    width: `${callRemainingPct * 100}%`,
                    backgroundColor: isCallExpiring ? colors.error : colors.called,
                  },
                ]}
              />
            </View>
          </View>

          {/* Primary: Start Serving */}
          <TouchableOpacity
            style={styles.primaryActionBtn}
            onPress={handleStartServing}
            disabled={actionLoading}
            activeOpacity={0.8}
          >
            <Ionicons name="play-circle" size={28} color="#fff" />
            <Text style={styles.primaryActionText}>{t('desk.startService')}</Text>
          </TouchableOpacity>

          {/* Secondary actions row */}
          <View style={styles.secondaryRow}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={handleRecall} disabled={actionLoading}>
              <Ionicons name="volume-high-outline" size={18} color={colors.primary} />
              <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>{t('desk.recallCustomer')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={handleNoShow} disabled={actionLoading}>
              <Ionicons name="close-circle-outline" size={18} color={colors.error} />
              <Text style={[styles.secondaryBtnText, { color: colors.error }]}>{t('desk.markNoShow')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={handleBackToQueue} disabled={actionLoading}>
              <Ionicons name="arrow-undo-outline" size={18} color={colors.textSecondary} />
              <Text style={[styles.secondaryBtnText, { color: colors.textSecondary }]}>{t('adminQueue.requeue')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={handlePark} disabled={actionLoading}>
              <Ionicons name="pause-outline" size={18} color={colors.warning} />
              <Text style={[styles.secondaryBtnText, { color: colors.warning }]}>{t('adminQueue.park')}</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <>
          {/* Primary: Mark Served */}
          <TouchableOpacity
            style={[styles.primaryActionBtn, { backgroundColor: '#27ae60' }]}
            onPress={handleMarkServed}
            disabled={actionLoading}
            activeOpacity={0.8}
          >
            <Ionicons name="checkmark-circle" size={28} color="#fff" />
            <Text style={styles.primaryActionText}>{t('desk.markServed')}</Text>
          </TouchableOpacity>

          {/* Secondary actions row */}
          <View style={styles.secondaryRow}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={handleNoShow} disabled={actionLoading}>
              <Ionicons name="close-circle-outline" size={18} color={colors.error} />
              <Text style={[styles.secondaryBtnText, { color: colors.error }]}>{t('desk.markNoShow')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => setTransferVisible(true)} disabled={actionLoading}>
              <Ionicons name="swap-horizontal-outline" size={18} color={colors.primary} />
              <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>{t('desk.transfer')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={handlePark} disabled={actionLoading}>
              <Ionicons name="pause-outline" size={18} color={colors.warning} />
              <Text style={[styles.secondaryBtnText, { color: colors.warning }]}>{t('adminQueue.park')}</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {actionLoading && (
        <ActivityIndicator
          size="small"
          color={colors.primary}
          style={{ marginTop: spacing.sm }}
        />
      )}
    </View>
  ) : null;

  // ── On Break banner ─────────────────────────────────────────────
  const OnBreakBanner = deskStatus === 'on_break' ? (
    <View style={styles.onBreakBanner}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Ionicons name="cafe" size={22} color={colors.warning} />
        <View>
          <Text style={styles.onBreakTitle}>{t('desk.onBreak')}</Text>
          <Text style={styles.onBreakSub}>{t('desk.waitingInQueue', { count: queue.waiting.length })}</Text>
        </View>
      </View>
      <TouchableOpacity
        style={styles.onBreakResumeBtn}
        onPress={handleDeskResume}
        disabled={actionLoading}
      >
        <Text style={styles.onBreakResumeText}>{t('adminQueue.resumeServing')}</Text>
      </TouchableOpacity>
    </View>
  ) : null;

  // ── Call Next button (when ready) ────────────────────────────────
  const CallNextButton = !hasActive && deskStatus !== 'on_break' ? (
    <TouchableOpacity
      style={[
        styles.callNextButton,
        queue.waiting.length === 0 && { opacity: 0.5 },
      ]}
      onPress={handleCallNext}
      disabled={actionLoading || queue.waiting.length === 0}
      activeOpacity={0.8}
    >
      {actionLoading ? (
        <ActivityIndicator color="#fff" size="small" />
      ) : (
        <>
          <Ionicons name="megaphone-outline" size={20} color="#fff" />
          <Text style={styles.callNextText}>{t('desk.callNext')}</Text>
          {queue.waiting.length > 0 && (
            <Text style={styles.callNextSub}>
              ({queue.waiting.length})
            </Text>
          )}
        </>
      )}
    </TouchableOpacity>
  ) : null;

  // ── Parked / On Hold ─────────────────────────────────────────────
  const ParkedSection = queue.parked.length > 0 ? (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <Ionicons name="pause-circle-outline" size={20} color={colors.warning} />
        <Text style={styles.sectionTitle}>{t('operatorQueue.onHold')} ({queue.parked.length})</Text>
      </View>
      {queue.parked.map((ticket) => (
        <View key={ticket.id} style={styles.parkedItem}>
          <View style={{ flex: 1 }}>
            <Text style={styles.parkedTicketNum}>{ticket.ticket_number}</Text>
            <Text style={styles.parkedDetail}>
              {ticket.customer_data?.name ?? t('booking.walkIn')}
              {' \u00B7 '}
              {formatElapsed(ticket.parked_at)} {t('operatorQueue.onHold').toLowerCase()}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <TouchableOpacity
              style={styles.resumeBtn}
              onPress={() => handleResumeParked(ticket)}
              disabled={actionLoading || hasActive}
            >
              <Ionicons name="megaphone-outline" size={14} color={hasActive ? colors.textMuted : colors.called} />
              <Text style={[styles.resumeBtnText, hasActive && { color: colors.textMuted }]}>{t('adminQueue.callToDesk')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.requeueBtn}
              onPress={() => handleUnparkToQueue(ticket)}
              disabled={actionLoading}
            >
              <Ionicons name="arrow-undo-outline" size={14} color={colors.warning} />
              <Text style={styles.requeueBtnText}>{t('adminQueue.toQueue')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </View>
  ) : null;

  // ── Waiting Queue List ───────────────────────────────────────────
  const WaitingQueueList = (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <Ionicons name="people-outline" size={20} color={colors.waiting} />
        <Text style={styles.sectionTitle}>{t('adminQueue.waitingQueue')} ({queue.waiting.length})</Text>
      </View>
      {queue.waiting.length === 0 ? (
        <Text style={styles.emptyText}>{t('desk.noOneWaiting')}</Text>
      ) : (
        queue.waiting.map((ticket, idx) => {
          const srcMap: Record<string, { name: keyof typeof Ionicons.glyphMap; color: string }> = {
            whatsapp: { name: 'logo-whatsapp', color: '#25D366' },
            messenger: { name: 'chatbubble-ellipses', color: '#0084FF' },
            kiosk: { name: 'tablet-portrait-outline', color: '#8B5CF6' },
            qr_code: { name: 'qr-code-outline', color: '#F59E0B' },
            walk_in: { name: 'walk-outline', color: '#64748B' },
            in_house: { name: 'business-outline', color: '#6366F1' },
          };
          const srcInfo = srcMap[ticket.source ?? ''] ?? { name: 'globe-outline' as keyof typeof Ionicons.glyphMap, color: colors.textMuted };
          return (
            <View key={ticket.id} style={styles.queueItem}>
              <Text style={styles.queuePos}>{idx + 1}</Text>
              <Text style={styles.queueTicketNum}>{ticket.ticket_number}</Text>
              <Ionicons name={srcInfo.name} size={13} color={srcInfo.color} />
              <Text style={styles.queueName} numberOfLines={1}>
                {ticket.customer_data?.name ?? t('booking.walkIn')}
              </Text>
              {ticket.priority_category_id && names.priorities[ticket.priority_category_id] ? (
                <Ionicons name="flag" size={10} color={names.priorities[ticket.priority_category_id].color ?? colors.warning} />
              ) : null}
              <Text style={styles.queueWait}>{formatElapsed(ticket.created_at)}</Text>
              <TouchableOpacity
                style={styles.callSpecificBtn}
                onPress={() => handleCallSpecific(ticket)}
                disabled={actionLoading || hasActive}
              >
                <Ionicons
                  name="megaphone-outline"
                  size={14}
                  color={hasActive ? colors.textMuted : colors.primary}
                />
              </TouchableOpacity>
            </View>
          );
        })
      )}
    </View>
  );

  // ── Recently Served (collapsed) ──────────────────────────────────
  const sortedServed = servedSortNewest
    ? [...queue.recentlyServed].sort((a, b) =>
        new Date(b.completed_at ?? b.created_at).getTime() - new Date(a.completed_at ?? a.created_at).getTime())
    : [...queue.recentlyServed].sort((a, b) =>
        new Date(a.completed_at ?? a.created_at).getTime() - new Date(b.completed_at ?? b.created_at).getTime());

  const RecentlyServedSection = queue.recentlyServed.length > 0 ? (
    <View style={styles.sectionCard}>
      <TouchableOpacity
        style={styles.sectionHeader}
        onPress={() => setRecentlyServedExpanded(!recentlyServedExpanded)}
        activeOpacity={0.7}
      >
        <Ionicons name="checkmark-done-outline" size={20} color={colors.success} />
        <Text style={styles.sectionTitle}>
          {t('desk.recentlyServed')} ({queue.recentlyServed.length})
        </Text>
        <View style={{ flex: 1 }} />
        <Ionicons
          name={recentlyServedExpanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.textMuted}
        />
      </TouchableOpacity>
      {recentlyServedExpanded && (
        <>
          <View style={styles.sortRow}>
            <TouchableOpacity
              style={[styles.sortChip, servedSortNewest && styles.sortChipActive]}
              onPress={() => setServedSortNewest(true)}
            >
              <Text style={[styles.sortChipText, servedSortNewest && styles.sortChipTextActive]}>
                {t('desk.newest')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sortChip, !servedSortNewest && styles.sortChipActive]}
              onPress={() => setServedSortNewest(false)}
            >
              <Text style={[styles.sortChipText, !servedSortNewest && styles.sortChipTextActive]}>
                {t('desk.oldest')}
              </Text>
            </TouchableOpacity>
          </View>
          {sortedServed.map((ticket) => (
            <View key={ticket.id} style={styles.servedItem}>
              <Text style={styles.servedTicketNum}>{ticket.ticket_number}</Text>
              <Text style={styles.servedDetail}>
                {ticket.customer_data?.name ?? t('booking.walkIn')}
              </Text>
              <Text style={styles.servedTime}>
                {ticket.completed_at
                  ? new Date(ticket.completed_at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    })
                  : ''}
              </Text>
            </View>
          ))}
        </>
      )}
    </View>
  ) : null;

  // Quick Links removed — queue tab handles this

  // ── Layout ───────────────────────────────────────────────────────
  const leftColumn = (
    <View style={isWide ? styles.leftColumn : undefined}>
      {OnBreakBanner}
      {UpcomingAppointmentsCard}
      {CurrentTicketCard}
      {CallNextButton}
      {ParkedSection}
    </View>
  );

  const rightColumn = (
    <View style={isWide ? styles.rightColumn : undefined}>
      {WaitingQueueList}
    </View>
  );

  const OfflineBanner = isOffline ? (
    <View style={styles.offlineBanner}>
      <Ionicons name="cloud-offline-outline" size={16} color="#fff" />
      <Text style={styles.offlineBannerText}>
        {t('desk.offlineMsg')}
      </Text>
    </View>
  ) : null;

  return (
    <>
      {OfflineBanner}
      <ScrollView
        style={styles.container}
        contentContainerStyle={[
          styles.content,
          isWide && styles.contentWide,
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {isWide ? (
          <>
            <View style={styles.wideRow}>
              {leftColumn}
              {rightColumn}
            </View>
            {RecentlyServedSection}
          </>
        ) : (
          <>
            {OnBreakBanner}
            {UpcomingAppointmentsCard}
            {CurrentTicketCard}
            {CallNextButton}
            {ParkedSection}
            {WaitingQueueList}
            {RecentlyServedSection}
          </>
        )}
      </ScrollView>

      {/* Switch Desk Modal */}
      <Modal
        visible={switchDeskVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setSwitchDeskVisible(false)}
      >
        <View style={switchStyles.overlay}>
          <View style={switchStyles.container}>
            <View style={switchStyles.header}>
              <Text style={switchStyles.title}>{t('desk.switchDesk')}</Text>
              <TouchableOpacity onPress={() => setSwitchDeskVisible(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            {switchLoading ? (
              <View style={switchStyles.loadingWrap}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            ) : availableDesks.length === 0 ? (
              <Text style={switchStyles.emptyText}>{t('desk.noDesksAvailable')}</Text>
            ) : (
              <ScrollView style={switchStyles.list}>
                {availableDesks.map((desk) => {
                  const isCurrent = desk.id === deskId;
                  const isOccupied = desk.current_staff_id && desk.current_staff_id !== staffId;
                  const deptName = (desk as any).departments?.name ?? null;
                  const deskStatusColor =
                    desk.status === 'open'
                      ? colors.success
                      : desk.status === 'on_break'
                      ? colors.warning
                      : colors.textMuted;

                  return (
                    <TouchableOpacity
                      key={desk.id}
                      style={[
                        switchStyles.deskItem,
                        isCurrent && switchStyles.deskItemCurrent,
                        isOccupied && { opacity: 0.5 },
                      ]}
                      onPress={() => handleSwitchToDesk(desk)}
                      disabled={isOccupied || switchLoading}
                      activeOpacity={0.7}
                    >
                      <View style={[switchStyles.deskDot, { backgroundColor: deskStatusColor }]} />
                      <View style={{ flex: 1 }}>
                        <View style={switchStyles.deskNameRow}>
                          <Text style={switchStyles.deskName}>
                            {desk.display_name || desk.name}
                          </Text>
                          {isCurrent && (
                            <View style={switchStyles.currentBadge}>
                              <Text style={switchStyles.currentBadgeText}>{t('desk.current')}</Text>
                            </View>
                          )}
                        </View>
                        {deptName && (
                          <Text style={switchStyles.deskDept}>{deptName}</Text>
                        )}
                        {isOccupied && (
                          <Text style={switchStyles.deskOccupied}>{t('desk.occupied')}</Text>
                        )}
                      </View>
                      {!isCurrent && !isOccupied && (
                        <Ionicons name="arrow-forward" size={18} color={colors.primary} />
                      )}
                      {isCurrent && (
                        <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {officeId && (
        <TransferModal
          visible={transferVisible}
          officeId={officeId}
          onClose={() => setTransferVisible(false)}
          onSelect={handleTransferSelect}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#dc2626',
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
  },
  offlineBannerText: {
    color: '#fff',
    fontSize: fontSize.sm,
    fontWeight: '600',
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing.xxl + spacing.xl,
  },
  contentWide: {
    padding: spacing.xl,
  },
  wideRow: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  leftColumn: {
    flex: 1,
    gap: spacing.lg,
  },
  rightColumn: {
    flex: 1,
    gap: spacing.lg,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
    gap: spacing.md,
  },
  loadingText: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
  },

  // Station header
  stationCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
  },
  stationTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  stationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stationIcon: {
    width: 24,
    height: 24,
    borderRadius: 6,
  },
  stationDeskName: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.text,
  },
  stationSubtext: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  statusDotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: borderRadius.full,
  },
  statusDotLabel: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Waiting count — compact horizontal bar
  waitingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.waitingBg,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  waitingNumber: {
    fontSize: fontSize.xl,
    fontWeight: '800',
    color: colors.primary,
  },
  waitingSubtext: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textSecondary,
  },

  // Current ticket card
  ticketCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    gap: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  inlineTimerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceSecondary,
  },
  inlineTimerText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'] as any,
  },
  ticketHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  ticketLabel: {
    fontSize: fontSize.xs,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  ticketNumber: {
    fontSize: fontSize.hero,
    fontWeight: '800',
    color: colors.text,
    marginTop: spacing.xs,
  },
  statusBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: borderRadius.full,
  },
  statusBadgeText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  metaCompact: {
    gap: 5,
  },
  metaName: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.text,
  },
  metaSub: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  sourceBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  sourceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  sourceBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
  phoneBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primaryLight + '12',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  notesBubble: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    backgroundColor: colors.infoLight,
    padding: spacing.sm,
    borderRadius: borderRadius.md,
    marginTop: spacing.xs,
  },
  notesText: {
    flex: 1,
    fontSize: fontSize.sm,
    fontStyle: 'italic',
  },
  countdownSection: {
    gap: spacing.xs,
  },
  countdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  countdownText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.called,
    fontVariant: ['tabular-nums'] as any,
  },
  countdownBarBg: {
    height: 4,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 2,
    overflow: 'hidden',
  },
  countdownBarFill: {
    height: '100%',
    borderRadius: 2,
  },
  primaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: spacing.lg,
    borderRadius: borderRadius.xl,
  },
  primaryActionText: {
    fontSize: fontSize.xl,
    fontWeight: '800',
    color: '#fff',
  },
  secondaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  secondaryBtn: {
    alignItems: 'center',
    gap: 2,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  secondaryBtnText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  timerRow: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginTop: spacing.xs,
  },
  timerBlock: {
    alignItems: 'center',
    gap: 2,
  },
  timerLabel: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  timerValue: {
    fontSize: fontSize.xxl,
    fontWeight: '800',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },

  // (action grid removed — using primaryActionBtn + secondaryRow)

  // Call next button
  callNextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: borderRadius.lg,
  },
  callNextText: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: '#fff',
  },
  callNextSub: {
    fontSize: fontSize.sm,
    color: 'rgba(255,255,255,0.7)',
    fontWeight: '600',
  },

  // Section card (shared)
  sectionCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  sectionTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.text,
  },
  emptyText: {
    fontSize: fontSize.md,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },

  // Parked items
  parkedItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  parkedTicketNum: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.text,
  },
  parkedDetail: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  resumeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.primaryLight + '15',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: borderRadius.md,
  },
  resumeBtnText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.primary,
  },
  requeueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.warning + '15',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: borderRadius.md,
  },
  requeueBtnText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.warning,
  },

  // Queue items — compact single row
  queueItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  queuePos: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.textMuted,
    width: 16,
    textAlign: 'center',
  },
  queueTicketNum: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.text,
  },
  queueName: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  queueWait: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'] as any,
  },
  callSpecificBtn: {
    padding: spacing.xs,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primaryLight + '15',
  },

  // Recently served
  sortRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  sortChip: {
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceSecondary,
  },
  sortChipActive: {
    backgroundColor: colors.primary + '15',
  },
  sortChipText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.textMuted,
  },
  sortChipTextActive: {
    color: colors.primary,
    fontWeight: '700',
  },
  servedItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  servedTicketNum: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  servedDetail: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  servedTime: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },

  // Quick links
  quickLinks: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
  },
  linkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  linkText: {
    flex: 1,
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
  },

  // Desk status controls
  deskControlsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    paddingTop: spacing.md,
  },
  deskControlBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  deskControlText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
  },

  // Header Switch Desk button (sits on the nav bar, left of title)
  headerSwitchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    marginLeft: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  headerRightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginRight: spacing.sm,
  },
  headerPauseChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    backgroundColor: 'rgba(251, 191, 36, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.40)',
  },
  headerPauseText: {
    color: '#fbbf24',
    fontSize: 11,
    fontWeight: '700',
  },
  headerLocalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
  },
  headerLocalDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#22c55e',
  },
  headerLocalDotError: {
    backgroundColor: '#ef4444',
  },
  headerLocalText: {
    color: '#86efac',
    fontSize: 10,
    fontWeight: '700',
  },
  headerSwitchText: {
    color: '#fff',
    fontSize: fontSize.sm,
    fontWeight: '600',
  },

  // Upcoming Appointments card
  upcomingCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    gap: 4,
  },
  upcomingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  upcomingTitle: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    flex: 1,
  },
  upcomingCount: {
    backgroundColor: colors.primary + '18',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: borderRadius.full,
  },
  upcomingCountText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.primary,
  },
  upcomingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 3,
  },
  upcomingTime: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.text,
    fontVariant: ['tabular-nums'] as any,
    minWidth: 48,
  },
  upcomingName: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
  },
  upcomingSvc: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    maxWidth: 120,
  },

  // Inline chip row (e.g., Take Break)
  inlineChipRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  inlineChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  inlineChipText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
  },

  // On Break banner
  onBreakBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.warning + '12',
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.warning + '30',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  onBreakTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.warning,
  },
  onBreakSub: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  onBreakResumeBtn: {
    backgroundColor: colors.success,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: borderRadius.lg,
  },
  onBreakResumeText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: '#fff',
  },
});

// Switch Desk Modal styles
const switchStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    maxHeight: '70%',
    paddingBottom: spacing.xxl,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.text,
  },
  loadingWrap: {
    padding: spacing.xxl,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: fontSize.md,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.xxl,
  },
  list: {
    paddingHorizontal: spacing.md,
  },
  deskItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  deskItemCurrent: {
    backgroundColor: colors.primaryLight + '10',
    borderRadius: borderRadius.lg,
    borderBottomWidth: 0,
    marginVertical: 2,
  },
  deskDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  deskNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  deskName: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
  },
  deskDept: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  deskOccupied: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.error,
    marginTop: 2,
  },
  currentBadge: {
    backgroundColor: colors.success + '20',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  currentBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.success,
  },
});
