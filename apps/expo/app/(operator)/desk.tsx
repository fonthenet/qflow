import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { useRealtimeQueue, QueueTicket } from '@/lib/use-realtime-queue';
import { useNameLookup } from '@/lib/use-realtime-queue';
import { useOrg } from '@/lib/use-org';
import * as Actions from '@/lib/ticket-actions';
import { sendHeartbeat, triggerRecovery } from '@/lib/api';
import { useOperatorStore } from '@/lib/operator-store';
import { supabase } from '@/lib/supabase';
import { colors, borderRadius, fontSize, spacing } from '@/lib/theme';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [services, setServices] = useState<{ id: string; name: string; department_id: string }[]>([]);
  const [selectedDept, setSelectedDept] = useState<string | null>(null);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (!visible) return;
    setSelectedDept(null);
    setLoadingData(true);

    const load = async () => {
      const [dResp, sResp] = await Promise.all([
        supabase.from('departments').select('id, name').eq('office_id', officeId).order('name'),
        supabase.from('services').select('id, name, department_id').eq('office_id', officeId).order('name'),
      ]);
      setDepartments(dResp.data ?? []);
      setServices(sResp.data ?? []);
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
            <Text style={modalStyles.title}>Transfer Ticket</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          {loadingData ? (
            <ActivityIndicator size="large" color={colors.primary} style={{ marginVertical: spacing.xxl }} />
          ) : !selectedDept ? (
            <>
              <Text style={modalStyles.sectionLabel}>Select Department</Text>
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
                  <Text style={modalStyles.emptyText}>No departments available</Text>
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
              <Text style={modalStyles.sectionLabel}>Select Service</Text>
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
                  <Text style={modalStyles.emptyText}>No services in this department</Text>
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
  const router = useRouter();
  const { session, clearSession } = useOperatorStore();
  const { orgId } = useOrg();

  const officeId = session?.officeId ?? null;
  const deskId = session?.deskId ?? null;
  const staffId = session?.staffId ?? null;

  const officeIds = useMemo(() => (officeId ? [officeId] : []), [officeId]);
  const { queue, loading, refresh } = useRealtimeQueue({ officeId });
  const names = useNameLookup(orgId, officeIds);

  const [actionLoading, setActionLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [transferVisible, setTransferVisible] = useState(false);
  const [recentlyServedExpanded, setRecentlyServedExpanded] = useState(false);

  const screenWidth = useScreenWidth();
  const isWide = screenWidth > 768;

  // ── Offline detection ────────────────────────────────────────────
  const [isOffline, setIsOffline] = useState(false);
  const consecutiveFailsRef = useRef(0);

  // ── Safety: heartbeat + periodic cleanup ─────────────────────────
  useEffect(() => {
    if (!deskId || !staffId) return;

    const ping = async () => {
      // Ping both local Supabase and cloud API
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

    ping(); // immediate first ping
    const heartbeat = setInterval(ping, 30_000);

    // Requeue expired calls every 30s
    const cleanup = setInterval(() => {
      Actions.requeueExpiredCalls(90);
      Actions.adjustBookingPriorities();
    }, 30_000);

    // Cleanup stale tickets on mount + trigger cloud recovery
    Actions.cleanupStaleTickets();
    triggerRecovery();

    return () => {
      clearInterval(heartbeat);
      clearInterval(cleanup);
    };
  }, [deskId, staffId]);

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

  // Determine status dot color
  const statusColor = myServingTickets.length > 0
    ? colors.serving
    : myCalledTickets.length > 0
      ? colors.called
      : colors.textMuted;

  const statusLabel = myServingTickets.length > 0
    ? 'Serving'
    : myCalledTickets.length > 0
      ? 'Called'
      : 'Idle';

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
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm',
        style: destructive ? 'destructive' : 'default',
        onPress: async () => {
          setActionLoading(true);
          try {
            await action();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          } catch (err: any) {
            Alert.alert('Error', err?.message ?? 'Action failed');
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
      'Call Next',
      'Call the next ticket in the queue?',
      async () => {
        const result = await Actions.callNextTicket(deskId, staffId);
        if (!result) {
          Alert.alert('Queue Empty', 'No tickets waiting in queue');
        }
      },
    );
  };

  const handleStartServing = () => {
    if (!activeTicket) return;
    confirmAction(
      'Start Serving',
      `Start serving ticket ${activeTicket.ticket_number}?`,
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
      .catch((err) => Alert.alert('Error', err.message))
      .finally(() => setActionLoading(false));
  };

  const handleNoShow = () => {
    if (!activeTicket) return;
    confirmAction(
      'No Show',
      `Mark ${activeTicket.ticket_number} as no-show?`,
      () => Actions.markNoShow(activeTicket.id),
      true,
    );
  };

  const handleBackToQueue = () => {
    if (!activeTicket) return;
    confirmAction(
      'Back to Queue',
      `Send ${activeTicket.ticket_number} back to the waiting queue?`,
      () => Actions.resetToQueue(activeTicket.id),
    );
  };

  const handlePark = () => {
    if (!activeTicket) return;
    confirmAction(
      'Park Ticket',
      `Put ${activeTicket.ticket_number} on hold?`,
      () => Actions.parkTicket(activeTicket.id),
    );
  };

  const handleMarkServed = () => {
    if (!activeTicket) return;
    confirmAction(
      'Mark Served',
      `Complete service for ${activeTicket.ticket_number}?`,
      () => Actions.markServed(activeTicket.id),
    );
  };

  const handleTransferSelect = (target: TransferTarget) => {
    if (!activeTicket) return;
    setTransferVisible(false);
    confirmAction(
      'Transfer Ticket',
      `Transfer ${activeTicket.ticket_number} to ${target.departmentName} / ${target.serviceName}?`,
      () => Actions.transferTicket(activeTicket.id, target.departmentId, target.serviceId),
    );
  };

  const handleUnpark = (ticket: QueueTicket) => {
    confirmAction(
      'Resume Ticket',
      `Resume ticket ${ticket.ticket_number} from hold?`,
      () => Actions.unparkTicket(ticket.id),
    );
  };

  const handleCallSpecific = (ticket: QueueTicket) => {
    if (!deskId || !staffId) return;
    confirmAction(
      'Call Ticket',
      `Call ticket ${ticket.ticket_number} to your desk?`,
      () => Actions.callSpecificTicket(ticket.id, deskId, staffId),
    );
  };

  const handleLogout = () => {
    Alert.alert('Sign Out', 'End your desk session and sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await supabase.auth.signOut();
          clearSession();
          router.replace('/(tabs)');
        },
      },
    ]);
  };

  // ── Guards ───────────────────────────────────────────────────────
  if (!session) {
    router.replace('/(auth)/login');
    return null;
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading queue data...</Text>
      </View>
    );
  }

  // ── Subcomponents ────────────────────────────────────────────────
  const StationHeader = (
    <View style={styles.stationCard}>
      <View style={styles.stationTopRow}>
        <View style={{ flex: 1, gap: spacing.xs }}>
          <View style={styles.stationRow}>
            <Ionicons name="desktop-outline" size={20} color={colors.primary} />
            <Text style={styles.stationDeskName}>{session.deskName ?? 'No desk'}</Text>
          </View>
          <View style={styles.stationRow}>
            <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.stationSubtext}>{session.officeName}</Text>
          </View>
        </View>
        <View style={styles.statusDotRow}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusDotLabel, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      </View>
    </View>
  );

  const WaitingCountCard = (
    <View style={styles.waitingCard}>
      <Ionicons name="people-outline" size={18} color={colors.waiting} />
      <Text style={styles.waitingNumber}>{queue.waiting.length}</Text>
      <Text style={styles.waitingSubtext}>waiting</Text>
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
      style={[
        styles.ticketCard,
        {
          borderColor:
            activeTicket.status === 'serving' ? colors.serving : colors.called,
        },
      ]}
    >
      {/* Header */}
      <View style={styles.ticketHeader}>
        <View>
          <Text style={styles.ticketLabel}>
            {activeTicket.status === 'serving' ? 'Now Serving' : 'Called'}
          </Text>
          <Text style={styles.ticketNumber}>{activeTicket.ticket_number}</Text>
        </View>
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
            {activeTicket.status === 'called' ? 'Called' : 'Serving'}
          </Text>
        </View>
      </View>

      {/* Customer & meta — compact row */}
      <View style={styles.metaCompact}>
        {activeTicket.customer_data?.name ? (
          <Text style={styles.metaName}>{activeTicket.customer_data.name}</Text>
        ) : null}
        {activeTicket.customer_data?.phone ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons name="call-outline" size={12} color={colors.textSecondary} />
            <Text style={{ fontSize: fontSize.sm, color: colors.textSecondary }}>{activeTicket.customer_data.phone}</Text>
          </View>
        ) : null}
        <Text style={styles.metaSub} numberOfLines={1}>
          {[
            activeTicket.service_id ? names.services[activeTicket.service_id] : null,
            activeTicket.department_id ? names.departments[activeTicket.department_id] : null,
          ].filter(Boolean).join(' · ')}
        </Text>
        {priorityInfo ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons name="flag" size={12} color={priorityInfo.color ?? colors.warning} />
            <Text style={{ fontSize: fontSize.xs, fontWeight: '700', color: priorityInfo.color ?? colors.warning }}>
              {priorityInfo.name}
            </Text>
          </View>
        ) : null}
        {(activeTicket.customer_data?.notes || activeTicket.notes) ? (
          <View style={styles.notesBubble}>
            <Ionicons name="chatbubble-outline" size={12} color={colors.info} />
            <Text style={[styles.notesText, { color: colors.text }]} numberOfLines={3}>
              {activeTicket.customer_data?.notes || activeTicket.notes}
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
                {Math.max(0, CALL_TIMEOUT_SEC - calledElapsedSec)}s remaining
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
            <Text style={styles.primaryActionText}>Start Serving</Text>
          </TouchableOpacity>

          {/* Secondary actions row */}
          <View style={styles.secondaryRow}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={handleRecall} disabled={actionLoading}>
              <Ionicons name="volume-high-outline" size={18} color={colors.primary} />
              <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>Recall</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={handleNoShow} disabled={actionLoading}>
              <Ionicons name="close-circle-outline" size={18} color={colors.error} />
              <Text style={[styles.secondaryBtnText, { color: colors.error }]}>No Show</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={handleBackToQueue} disabled={actionLoading}>
              <Ionicons name="arrow-undo-outline" size={18} color={colors.textSecondary} />
              <Text style={[styles.secondaryBtnText, { color: colors.textSecondary }]}>Requeue</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={handlePark} disabled={actionLoading}>
              <Ionicons name="pause-outline" size={18} color={colors.warning} />
              <Text style={[styles.secondaryBtnText, { color: colors.warning }]}>Park</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <>
          {/* Serving state: service timer */}
          {activeTicket.serving_started_at ? (
            <View style={styles.timerRow}>
              <View style={styles.timerBlock}>
                <Text style={styles.timerLabel}>Service Time</Text>
                <Text
                  style={[
                    styles.timerValue,
                    isServingOvertime && { color: colors.error },
                  ]}
                >
                  {formatElapsed(activeTicket.serving_started_at)}
                </Text>
              </View>
            </View>
          ) : null}

          {/* Primary: Mark Served */}
          <TouchableOpacity
            style={[styles.primaryActionBtn, { backgroundColor: colors.success }]}
            onPress={handleMarkServed}
            disabled={actionLoading}
            activeOpacity={0.8}
          >
            <Ionicons name="checkmark-circle" size={28} color="#fff" />
            <Text style={styles.primaryActionText}>Mark Served</Text>
          </TouchableOpacity>

          {/* Secondary actions row */}
          <View style={styles.secondaryRow}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={handleNoShow} disabled={actionLoading}>
              <Ionicons name="close-circle-outline" size={18} color={colors.error} />
              <Text style={[styles.secondaryBtnText, { color: colors.error }]}>No Show</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => setTransferVisible(true)} disabled={actionLoading}>
              <Ionicons name="swap-horizontal-outline" size={18} color={colors.primary} />
              <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>Transfer</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={handlePark} disabled={actionLoading}>
              <Ionicons name="pause-outline" size={18} color={colors.warning} />
              <Text style={[styles.secondaryBtnText, { color: colors.warning }]}>Park</Text>
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

  // ── Call Next button (when idle) ─────────────────────────────────
  const CallNextButton = !hasActive ? (
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
        <ActivityIndicator color="#fff" size="large" />
      ) : (
        <>
          <Ionicons name="megaphone-outline" size={32} color="#fff" />
          <Text style={styles.callNextText}>Call Next</Text>
          {queue.waiting.length > 0 && (
            <Text style={styles.callNextSub}>
              {queue.waiting.length} waiting
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
        <Text style={styles.sectionTitle}>On Hold ({queue.parked.length})</Text>
      </View>
      {queue.parked.map((ticket) => (
        <View key={ticket.id} style={styles.parkedItem}>
          <View style={{ flex: 1 }}>
            <Text style={styles.parkedTicketNum}>{ticket.ticket_number}</Text>
            <Text style={styles.parkedDetail}>
              {ticket.customer_data?.name ?? 'Walk-in'}
              {' \u00B7 '}
              {formatElapsed(ticket.parked_at)} on hold
            </Text>
          </View>
          <TouchableOpacity
            style={styles.resumeBtn}
            onPress={() => handleUnpark(ticket)}
            disabled={actionLoading}
          >
            <Ionicons name="play-outline" size={16} color={colors.primary} />
            <Text style={styles.resumeBtnText}>Resume</Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  ) : null;

  // ── Waiting Queue List ───────────────────────────────────────────
  const WaitingQueueList = (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <Ionicons name="people-outline" size={20} color={colors.waiting} />
        <Text style={styles.sectionTitle}>Waiting Queue ({queue.waiting.length})</Text>
      </View>
      {queue.waiting.length === 0 ? (
        <Text style={styles.emptyText}>No customers waiting</Text>
      ) : (
        queue.waiting.map((ticket, idx) => (
          <View key={ticket.id} style={styles.queueItem}>
            <Text style={styles.queuePos}>{idx + 1}</Text>
            <Text style={styles.queueTicketNum}>{ticket.ticket_number}</Text>
            <Text style={styles.queueName} numberOfLines={1}>
              {ticket.customer_data?.name ?? 'Walk-in'}
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
        ))
      )}
    </View>
  );

  // ── Recently Served (collapsed) ──────────────────────────────────
  const RecentlyServedSection = queue.recentlyServed.length > 0 ? (
    <View style={styles.sectionCard}>
      <TouchableOpacity
        style={styles.sectionHeader}
        onPress={() => setRecentlyServedExpanded(!recentlyServedExpanded)}
        activeOpacity={0.7}
      >
        <Ionicons name="checkmark-done-outline" size={20} color={colors.success} />
        <Text style={styles.sectionTitle}>
          Recently Served ({queue.recentlyServed.length})
        </Text>
        <View style={{ flex: 1 }} />
        <Ionicons
          name={recentlyServedExpanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.textMuted}
        />
      </TouchableOpacity>
      {recentlyServedExpanded &&
        queue.recentlyServed.map((ticket) => (
          <View key={ticket.id} style={styles.servedItem}>
            <Text style={styles.servedTicketNum}>{ticket.ticket_number}</Text>
            <Text style={styles.servedDetail}>
              {ticket.customer_data?.name ?? 'Walk-in'}
            </Text>
            <Text style={styles.servedTime}>
              {ticket.completed_at
                ? new Date(ticket.completed_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : ''}
            </Text>
          </View>
        ))}
    </View>
  ) : null;

  // ── Quick Links ──────────────────────────────────────────────────
  const QuickLinks = (
    <View style={styles.quickLinks}>
      <TouchableOpacity
        style={styles.linkButton}
        onPress={() => router.push('/(operator)/queue')}
      >
        <Ionicons name="list-outline" size={22} color={colors.primary} />
        <Text style={styles.linkText}>Queue Overview</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.linkButton}
        onPress={() => router.push('/(operator)/settings')}
      >
        <Ionicons name="settings-outline" size={22} color={colors.textSecondary} />
        <Text style={styles.linkText}>Settings</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </TouchableOpacity>
      <TouchableOpacity style={[styles.linkButton, { borderBottomWidth: 0 }]} onPress={handleLogout}>
        <Ionicons name="log-out-outline" size={22} color={colors.error} />
        <Text style={[styles.linkText, { color: colors.error }]}>Sign Out</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </TouchableOpacity>
    </View>
  );

  // ── Layout ───────────────────────────────────────────────────────
  const leftColumn = (
    <View style={isWide ? styles.leftColumn : undefined}>
      {StationHeader}
      {WaitingCountCard}
      {CurrentTicketCard}
      {CallNextButton}
      {ParkedSection}
    </View>
  );

  const rightColumn = (
    <View style={isWide ? styles.rightColumn : undefined}>
      {WaitingQueueList}
      {RecentlyServedSection}
      {QuickLinks}
    </View>
  );

  const OfflineBanner = isOffline ? (
    <View style={styles.offlineBanner}>
      <Ionicons name="cloud-offline-outline" size={16} color="#fff" />
      <Text style={styles.offlineBannerText}>
        Connection lost — working offline. Actions will sync when restored.
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
          <View style={styles.wideRow}>
            {leftColumn}
            {rightColumn}
          </View>
        ) : (
          <>
            {StationHeader}
            {WaitingCountCard}
            {CurrentTicketCard}
            {CallNextButton}
            {ParkedSection}
            {WaitingQueueList}
            {RecentlyServedSection}
            {QuickLinks}
          </>
        )}
      </ScrollView>

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
    borderWidth: 2,
  },
  ticketHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  ticketLabel: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.textMuted,
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
    gap: 2,
  },
  metaName: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
  },
  metaSub: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
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
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: spacing.xl + spacing.md,
    borderRadius: borderRadius.xl,
  },
  callNextText: {
    fontSize: fontSize.xxl,
    fontWeight: '800',
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
    gap: spacing.xs,
    backgroundColor: colors.primaryLight + '15',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.lg,
  },
  resumeBtnText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.primary,
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
});
