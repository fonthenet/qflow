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
import { TableSuggestion } from '@/components/TableSuggestion';
import { FloorMap } from '@/components/FloorMap';
import { ClientPickerModal } from '@/components/ClientPickerModal';
import { TableActionSheet } from '@/components/TableActionSheet';
import { TablePickerModal } from '@/components/TablePickerModal';
import { OrderPad } from '@/components/OrderPad';
import { fetchTicketItems, updateTicketItem, deleteTicketItem, fetchTicketPayments, fetchTicketIdsWithItems } from '@/lib/data-adapter';
import type { TicketItem, TicketPayment } from '@qflo/shared';
import { CashPaymentSheet } from '@/components/CashPaymentSheet';
import { parsePartySize, type RestaurantTable } from '@qflo/shared';
import { useTabletMode } from '@/lib/use-tablet-mode';
import { useFloorView } from '@/lib/use-floor-view';

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

function useScreenDimensions() {
  const [dims, setDims] = useState(Dimensions.get('window'));
  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => setDims(window));
    return () => sub.remove();
  }, []);
  return dims;
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
  // Client picker modal — opened when an empty table on the FloorMap is tapped
  // so the operator can choose which waiting customer to seat there.
  const [clientPickerTable, setClientPickerTable] = useState<string | null>(null);
  const [clientPickerBusy, setClientPickerBusy] = useState(false);
  // Table action sheet — opened when an occupied/on-hold table is tapped on
  // the FloorMap. Holds the selected table + its current ticket so the sheet
  // can surface status-aware controls (Mark served / Move / Release / etc).
  const [tableSheetTable, setTableSheetTable] = useState<any | null>(null);
  const [tableSheetTicket, setTableSheetTicket] = useState<QueueTicket | null>(null);
  // Move flow — when the operator chooses "Move" inside the action sheet we
  // open the full TablePickerModal scoped to the active ticket so they can
  // pick the destination. Tracks the ticket being moved.
  const [moveTicket, setMoveTicket] = useState<QueueTicket | null>(null);
  const [allTables, setAllTables] = useState<RestaurantTable[]>([]);
  // Counter we bump after a seat / release action so the FloorMap
  // re-fetches `restaurant_tables` immediately instead of waiting on its
  // 4s poll. Gives the operator instant visual feedback on the floor.
  const [floorRefreshKey, setFloorRefreshKey] = useState(0);
  const [tableSheetBusy, setTableSheetBusy] = useState(false);
  // Order flow state. The action sheet renders an inline editable
  // summary of ticket_items; tapping "Add items" opens the OrderPad,
  // which is a sibling modal (iOS can't stack RN Modals — same caveat
  // as moveTicket). When the OrderPad closes, we restore the action
  // sheet on the same table+ticket so the operator picks up where
  // they left off, with the items just added now visible inline.
  const [orderTicket, setOrderTicket] = useState<QueueTicket | null>(null);
  const [orderTable, setOrderTable] = useState<any | null>(null);
  const [tableSheetItems, setTableSheetItems] = useState<TicketItem[]>([]);
  const [tableSheetPayments, setTableSheetPayments] = useState<TicketPayment[]>([]);
  // Combined Serve sheet (file kept as CashPaymentSheet) — opened from
  // the action sheet's "Mark served" button. Snapshots items + payments
  // so the sheet still has data after we close the action sheet (which
  // clears tableSheetItems / tableSheetPayments).
  const [cashTicket, setCashTicket] = useState<QueueTicket | null>(null);
  const [cashTable, setCashTable] = useState<any | null>(null);
  const [cashItems, setCashItems] = useState<TicketItem[]>([]);
  const [cashPayments, setCashPayments] = useState<TicketPayment[]>([]);
  const [upcomingAppts, setUpcomingAppts] = useState<any[]>([]);
  const [businessCategory, setBusinessCategory] = useState<string | null>(null);

  // Tablet mode detection (hardware + user override)
  const { isTablet } = useTabletMode();

  // Floor view toggle (restaurant/cafe only)
  const { supportsFloorView, mode: floorViewMode, toggle: toggleFloorView } = useFloorView(businessCategory);
  const isFloorView = supportsFloorView && floorViewMode === 'floor';

  // Pull org business_category once so TableSuggestion and FloorView know whether
  // to render at all.
  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    supabase.from('organizations').select('settings').eq('id', orgId).single().then(({ data }) => {
      if (cancelled) return;
      const cat = ((data?.settings as any)?.business_category ?? null) as string | null;
      setBusinessCategory(cat);
    });
    return () => { cancelled = true; };
  }, [orgId]);

  // Mirror the FloorMap's table list at desk level so the Move flow's picker
  // shows the full set with capacity / occupancy hints. Refreshed every 5s
  // while in floor view (cheap; matches FloorMap's own polling cadence).
  useEffect(() => {
    if (!officeId || !supportsFloorView) return;
    let cancelled = false;
    const load = async () => {
      try {
        const data = await Actions.fetchRestaurantTables(officeId);
        if (!cancelled) setAllTables((data ?? []) as RestaurantTable[]);
      } catch {
        if (!cancelled) setAllTables([]);
      }
    };
    load();
    const id = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [officeId, supportsFloorView]);

  // Track which active tickets already have at least one ticket_items row
  // — surfaces a small "food served" badge on the FloorMap so operators
  // can spot which tables have already started ordering at a glance.
  const [ticketsWithItems, setTicketsWithItems] = useState<Set<string>>(new Set());
  const activeTicketIdsForItems = useMemo(
    () => [...queue.called, ...queue.serving].map((t) => t.id).sort().join(','),
    [queue.called, queue.serving],
  );
  useEffect(() => {
    if (!supportsFloorView) return;
    const ids = activeTicketIdsForItems ? activeTicketIdsForItems.split(',') : [];
    if (!ids.length) {
      setTicketsWithItems(new Set());
      return;
    }
    let cancelled = false;
    fetchTicketIdsWithItems(ids)
      .then((set) => { if (!cancelled) setTicketsWithItems(set); })
      .catch(() => { if (!cancelled) setTicketsWithItems(new Set()); });
    return () => { cancelled = true; };
  }, [activeTicketIdsForItems, supportsFloorView]);

  const screenDims = useScreenDimensions();
  // Two-pane layout when tablet mode is on OR when the screen is inherently wide (>=768)
  const isWide = isTablet || screenDims.width >= 768;

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

  // ── Active-ticket kitchen status ───────────────────────────────
  // Aggregates ticket_items.kitchen_status into a single badge that
  // sits under "Mark Served" so floor staff know whether the food is
  // still being prepared, ready to run, or already delivered. Polled
  // every 6s while the ticket is active; piggybacks on the existing
  // 'kitchen:order-ready' broadcast for instant flips on "Mark all
  // ready". Restaurant-only — silent for non-food orgs.
  const [activeKitchenAgg, setActiveKitchenAgg] = useState<{
    status: 'new' | 'in_progress' | 'ready' | 'mixed';
    total: number;
  } | null>(null);
  useEffect(() => {
    if (!activeTicket?.id) {
      setActiveKitchenAgg(null);
      return;
    }
    let cancelled = false;
    const compute = (items: any[]) => {
      const active = items.filter((i) => (i.kitchen_status ?? 'new') !== 'served');
      if (!active.length) return null;
      const statuses = new Set(active.map((i) => i.kitchen_status ?? 'new'));
      let s: 'new' | 'in_progress' | 'ready' | 'mixed';
      if (statuses.size === 1) {
        s = (Array.from(statuses)[0] as any);
      } else {
        // Worst-case wins: any 'new' → cooking shows "mixed"; if it's
        // only in_progress + ready, surface "mixed" so staff know some
        // is still on the pass.
        s = 'mixed';
      }
      return { status: s, total: active.length };
    };
    const run = async () => {
      try {
        const items = await fetchTicketItems(activeTicket.id);
        if (!cancelled) setActiveKitchenAgg(compute(items));
      } catch {
        if (!cancelled) setActiveKitchenAgg(null);
      }
    };
    run();
    const id = setInterval(run, 6000);
    return () => { cancelled = true; clearInterval(id); };
  }, [activeTicket?.id]);

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

  // Release any restaurant_table currently linked to this ticket. Called
  // whenever a ticket terminates (served / no-show / cancelled / re-queued)
  // so the floor map shows the seat as free again. Routes through the
  // data-adapter so it works in both local (Station bridge → SQLite + sync)
  // and cloud (Supabase) modes. Best-effort — failures are logged but don't
  // block the primary action.
  const releaseTableForTicket = async (ticketId: string) => {
    if (!officeId) return;
    try {
      await Actions.releaseTableForTicket(officeId, ticketId);
    } catch (e) {
      console.warn('[desk] releaseTableForTicket failed', e);
    }
  };

  const handleNoShow = () => {
    if (!activeTicket) return;
    const id = activeTicket.id;
    confirmAction(
      t('desk.markNoShow'),
      t('adminQueue.noShowMsg', { ticket: activeTicket.ticket_number }),
      async () => {
        await Actions.markNoShow(id);
        await releaseTableForTicket(id);
      },
      true,
    );
  };

  const handleBackToQueue = () => {
    if (!activeTicket) return;
    const id = activeTicket.id;
    confirmAction(
      t('adminQueue.backToQueue'),
      t('adminQueue.backToQueueMsg', { ticket: activeTicket.ticket_number }),
      async () => {
        await Actions.resetToQueue(id);
        await releaseTableForTicket(id);
      },
    );
  };

  const handlePark = () => {
    if (!activeTicket) return;
    const id = activeTicket.id;
    confirmAction(
      t('desk.parkHold'),
      t('adminQueue.parkMsg', { ticket: activeTicket.ticket_number }),
      async () => {
        await Actions.parkTicket(id);
        await releaseTableForTicket(id);
      },
    );
  };

  const handleMarkServed = () => {
    if (!activeTicket) return;
    const id = activeTicket.id;
    confirmAction(
      t('desk.markServed'),
      t('adminQueue.completeMsg', { ticket: activeTicket.ticket_number }),
      async () => {
        await Actions.markServed(id);
        await releaseTableForTicket(id);
      },
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

  // ── Table action sheet handlers ─────────────────────────────────
  // Unified contract for every sheet button:
  //   1. Light haptic on tap (selection feedback).
  //   2. Close the action sheet IMMEDIATELY — RN can't reliably stack
  //      Alert.alert over an open Modal on iOS, and we don't want the
  //      sheet sitting visible behind a confirm dialog or while async
  //      work is in flight.
  //   3. Optional confirm dialog (destructive ops only).
  //   4. Run the action, release the table seat if the ticket is
  //      terminating, and refresh the queue.
  //   5. Success haptic + Alert on failure.
  const closeTableSheet = () => {
    setTableSheetTable(null);
    setTableSheetTicket(null);
    setTableSheetBusy(false);
    setTableSheetItems([]);
    setTableSheetPayments([]);
  };

  // Pull order items + payments whenever the action sheet binds to a
  // ticket so the inline cart, payments list, and Mark Served summary
  // are all in sync with whatever OrderPad / CashPaymentSheet / Station
  // wrote. Re-runs after every inline edit so totals stay live.
  const refreshSheetItems = useCallback(async (ticketId: string) => {
    try {
      const [items, payments] = await Promise.all([
        fetchTicketItems(ticketId),
        fetchTicketPayments(ticketId).catch(() => [] as TicketPayment[]),
      ]);
      setTableSheetItems(items);
      setTableSheetPayments(payments);
    } catch (err) {
      console.warn('[desk] refreshSheetItems failed', err);
    }
  }, []);

  useEffect(() => {
    if (tableSheetTicket?.id) {
      refreshSheetItems(tableSheetTicket.id);
    } else {
      setTableSheetItems([]);
      setTableSheetPayments([]);
    }
  }, [tableSheetTicket?.id, refreshSheetItems]);

  // Live updates while the action sheet is open. Without this the
  // Order list, totals, and kitchen-status pill stay frozen on the
  // values fetched at open time — operators had to close + re-tap the
  // table to see "Preparing → Ready" or new line items added from the
  // kitchen / OrderPad. Supabase realtime gives instant flips; the
  // 4s poll is a safety net for offline → online transitions.
  useEffect(() => {
    const tid = tableSheetTicket?.id;
    if (!tid) return;
    const channel = supabase
      .channel(`table-sheet-${tid}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'ticket_items', filter: `ticket_id=eq.${tid}` },
        () => refreshSheetItems(tid))
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'ticket_payments', filter: `ticket_id=eq.${tid}` },
        () => refreshSheetItems(tid))
      .subscribe();
    const poll = setInterval(() => refreshSheetItems(tid), 4000);
    return () => {
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [tableSheetTicket?.id, refreshSheetItems]);

  type SheetActionOpts = {
    confirm?: { title: string; message: string; destructive?: boolean };
  };

  // Single end-to-end runner used by every sheet button. Closes the
  // sheet first so iOS doesn't have to stack a Modal under an Alert,
  // then runs the action with full lifecycle handling.
  const runSheetAction = (fn: () => Promise<void>, opts: SheetActionOpts = {}) => {
    Haptics.selectionAsync().catch(() => {});
    closeTableSheet();

    const exec = async () => {
      setActionLoading(true);
      try {
        await fn();
        await refresh();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      } catch (err: any) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        Alert.alert(t('common.error'), err?.message ?? t('adminQueue.actionFailed'));
      } finally {
        setActionLoading(false);
      }
    };

    if (opts.confirm) {
      // Defer the Alert one frame so the sheet's dismiss animation
      // completes before iOS presents the alert — avoids the rare case
      // where Alert presentation is dropped while a modal is closing.
      setTimeout(() => {
        Alert.alert(opts.confirm!.title, opts.confirm!.message, [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.confirm'),
            style: opts.confirm!.destructive ? 'destructive' : 'default',
            onPress: exec,
          },
        ]);
      }, 50);
    } else {
      exec();
    }
  };

  // ── Primary action: Start serving (called → serving) ────────────
  const sheetStartServing = (ticket: QueueTicket) => {
    const id = ticket.id;
    runSheetAction(() => Actions.startServing(id));
  };

  // ── Primary action: Mark served (terminate ticket, free table) ──
  // Opens a combined sheet that shows the order summary, lets the
  // operator record a cash payment if one's still due, then on Finish
  // calls markServed which auto-builds the receipt and dispatches it
  // to the customer (server-side notifyCustomer('served')). This
  // replaces the previous "Mark Served alert + separate Cash button"
  // split — one tap, one screen, full visibility into what's being
  // closed and what will be billed/sent.
  const sheetMarkServed = async (ticket: QueueTicket) => {
    Haptics.selectionAsync().catch(() => {});
    // Snapshot the current items/payments BEFORE closing the action
    // sheet — closeTableSheet clears tableSheetItems/Payments, and the
    // combined sheet needs the data immediately on open. Also re-fetch
    // fresh in case OrderPad just modified them and we have stale state.
    setCashTable(tableSheetTable);
    setCashItems(tableSheetItems);
    setCashPayments(tableSheetPayments);
    closeTableSheet();
    setTimeout(() => setCashTicket(ticket), 50);
    // Fire-and-forget refresh so the sheet shows the freshest data
    // even if the action sheet closed before refreshSheetItems landed.
    try {
      const [items, payments] = await Promise.all([
        fetchTicketItems(ticket.id),
        fetchTicketPayments(ticket.id).catch(() => [] as TicketPayment[]),
      ]);
      setCashItems(items);
      setCashPayments(payments);
    } catch {}
  };

  // Called when the combined sheet's "Finish & send receipt" button
  // resolves the (optional) payment. Performs the actual mark-served
  // + table release, returns a promise so the sheet can show a busy
  // state and only close on success.
  const handleServeFinish = async (ticketId: string) => {
    await Actions.markServed(ticketId);
    await releaseTableForTicket(ticketId);
    // Refresh queue immediately — the served ticket should fall out of
    // active lists and the table should flip to free.
    refresh();
  };

  const handleCashSheetClose = () => {
    setCashTicket(null);
    setCashTable(null);
    setCashItems([]);
    setCashPayments([]);
    // No restore — once the operator hits Finish (or cancels), they
    // expect the floor view, not a re-popped action sheet on a now
    // empty table.
  };

  // ── Primary action: Resume a parked ticket back to active ───────
  const sheetResume = (ticket: QueueTicket) => {
    if (!deskId || !staffId) {
      Alert.alert(t('common.error'), t('desk.needDeskSession'));
      return;
    }
    if (hasActive) {
      Alert.alert(t('common.error'), t('desk.needDeskSession'));
      return;
    }
    const id = ticket.id;
    runSheetAction(() => Actions.resumeParkedTicket(id, deskId, staffId));
  };

  // ── Recall: re-fire the "your turn" notification, no state change ─
  const sheetRecall = (ticket: QueueTicket) => {
    const id = ticket.id;
    runSheetAction(() => Actions.recallTicket(id));
  };

  // ── Park: hold this ticket, free the table for someone else ─────
  const sheetPark = (ticket: QueueTicket) => {
    const id = ticket.id;
    runSheetAction(async () => {
      await Actions.parkTicket(id);
      await releaseTableForTicket(id);
    });
  };

  // ── No-show: terminal, destructive — confirm first ──────────────
  const sheetNoShow = (ticket: QueueTicket) => {
    const id = ticket.id;
    runSheetAction(
      async () => {
        await Actions.markNoShow(id);
        await releaseTableForTicket(id);
      },
      {
        confirm: {
          title: t('desk.markNoShow'),
          message: t('adminQueue.noShowMsg', { ticket: ticket.ticket_number }),
          destructive: true,
        },
      },
    );
  };

  // ── Requeue: send the ticket back to waiting (reversible) ───────
  const sheetRequeue = (ticket: QueueTicket) => {
    const id = ticket.id;
    runSheetAction(async () => {
      await Actions.resetToQueue(id);
      await releaseTableForTicket(id);
    });
  };

  // ── Release table: free the seat without touching the ticket ────
  // (Ticket may already be terminal, or the host wants the row back
  //  even though the party is still being processed elsewhere.)
  const sheetReleaseTable = (table: any) => {
    if (!officeId) return;
    const tableId = table.id;
    runSheetAction(
      async () => {
        await Actions.clearTableById(officeId, tableId);
      },
      {
        confirm: {
          title: t('tables.release', { defaultValue: 'Release table' }),
          message: t('tables.releaseConfirm', {
            code: table.code || table.label || '—',
            defaultValue: 'Release table {{code}}? The seat will be marked free.',
          }),
          destructive: true,
        },
      },
    );
  };

  // ── Order / Add items: open OrderPad on the seated ticket ──────
  // iOS modal-stacking: close the action sheet first, then open the
  // OrderPad on the next frame. We stash the current table+ticket so
  // we can re-open the action sheet automatically when the OrderPad
  // closes — operator never loses context.
  const sheetOrder = (ticket: QueueTicket) => {
    Haptics.selectionAsync().catch(() => {});
    setOrderTable(tableSheetTable);
    closeTableSheet();
    setTimeout(() => setOrderTicket(ticket), 50);
  };

  // ── OrderPad close: restore action sheet on same table+ticket ──
  const handleOrderPadClose = () => {
    const ticket = orderTicket;
    const table = orderTable;
    setOrderTicket(null);
    setOrderTable(null);
    if (ticket && table) {
      setTimeout(() => {
        setTableSheetTable(table);
        setTableSheetTicket(ticket);
      }, 50);
    }
  };

  // ── Inline cart edits from the action sheet ────────────────────
  const handleSheetItemQty = async (item: TicketItem, nextQty: number) => {
    if (!tableSheetTicket) return;
    setTableSheetBusy(true);
    try {
      if (nextQty < 1) {
        await deleteTicketItem(item.id);
      } else {
        await updateTicketItem(item.id, { qty: nextQty });
      }
      await refreshSheetItems(tableSheetTicket.id);
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? t('adminQueue.actionFailed'));
    } finally {
      setTableSheetBusy(false);
    }
  };

  const handleSheetItemRemove = async (item: TicketItem) => {
    if (!tableSheetTicket) return;
    setTableSheetBusy(true);
    try {
      await deleteTicketItem(item.id);
      await refreshSheetItems(tableSheetTicket.id);
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? t('adminQueue.actionFailed'));
    } finally {
      setTableSheetBusy(false);
    }
  };

  // ── Move: hand off to TablePickerModal (no confirm) ─────────────
  const sheetMove = (ticket: QueueTicket, _fromTable: any) => {
    // iOS can't stack two RN Modals — opening TablePickerModal while
    // the TableActionSheet's modal is still visible silently no-ops.
    // Close the action sheet first, then open the picker on the next
    // frame so the dismiss animation completes cleanly.
    Haptics.selectionAsync().catch(() => {});
    closeTableSheet();
    setTimeout(() => setMoveTicket(ticket), 50);
  };

  const handleMoveSelectTable = async (target: RestaurantTable) => {
    if (!officeId || !moveTicket) {
      setMoveTicket(null);
      return;
    }
    setActionLoading(true);
    try {
      // seatTicketAtTableId auto-releases any other row holding the same
      // ticket — so a single call moves the seat in one transaction.
      await Actions.seatTicketAtTableId(officeId, target.id, moveTicket.id);
      await refresh();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      Alert.alert(t('common.error'), e?.message ?? t('adminQueue.actionFailed'));
    } finally {
      setActionLoading(false);
      setMoveTicket(null);
    }
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

  // ── Header: Switch Desk (left) + title with desk name + pause/floor-toggle/local (right) ───
  const navigation = useNavigation();
  const connectionStatus = useLocalConnectionStore((s) => s.connectionStatus);
  const isLocalMode = localMode === 'local';
  const showPauseInHeader = !hasActive && deskStatus !== 'on_break';
  useEffect(() => {
    const deskLabel = session?.deskName ? `${t('admin.myDesk')} · ${session.deskName}` : t('admin.myDesk');
    navigation.setOptions({
      title: deskLabel,
      headerLeft: () => (
        <View style={styles.headerLeftRow}>
          <TouchableOpacity
            onPress={openSwitchDesk}
            disabled={actionLoading}
            activeOpacity={0.7}
            style={styles.headerSwitchBtn}
            accessibilityLabel={t('desk.switchDesk')}
          >
            <Ionicons name="swap-horizontal" size={16} color="#fff" />
          </TouchableOpacity>
          {showPauseInHeader ? (
            <TouchableOpacity
              onPress={handleDeskOnBreak}
              disabled={actionLoading}
              activeOpacity={0.7}
              style={styles.headerPauseBtn}
              accessibilityLabel={t('desk.onBreak')}
            >
              <Ionicons name="cafe-outline" size={16} color="#fbbf24" />
            </TouchableOpacity>
          ) : null}
        </View>
      ),
      headerRight: () => (
        <View style={styles.headerRightRow}>
          {/* Floor toggle moved out of the header to a sub-tab strip below
              (header was too crowded on phones — title + local badge + 2 pills
              caused overlap). Toggle now lives just under the header so it has
              breathing room and tap targets are bigger. */}
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

  // Kitchen status badge — shared across called + serving branches so
  // floor staff see the order's state on every active-ticket view, not
  // just after Start Serving. Sits right under the primary action.
  // Renders a strong full-width pill so it's impossible to miss.
  const kitchenStatusBadge = activeKitchenAgg ? (() => {
    const cfg = activeKitchenAgg.status === 'ready'
      ? { bg: '#16a34a', fg: '#fff', icon: 'checkmark-done-circle' as const,
          label: t('desk.kitchenReady', { defaultValue: 'Ready to serve' }) }
      : activeKitchenAgg.status === 'in_progress'
        ? { bg: '#f59e0b', fg: '#fff', icon: 'flame' as const,
            label: t('desk.kitchenPreparing', { defaultValue: 'Preparing' }) }
        : activeKitchenAgg.status === 'mixed'
          ? { bg: '#3b82f6', fg: '#fff', icon: 'restaurant' as const,
              label: t('desk.kitchenPartial', { defaultValue: 'Partially ready' }) }
          : { bg: '#64748b', fg: '#fff', icon: 'time-outline' as const,
              label: t('desk.kitchenNew', { defaultValue: 'In queue' }) };
    return (
      <View style={[styles.kitchenBadge, { backgroundColor: cfg.bg, borderColor: cfg.bg }]}>
        <Ionicons name={cfg.icon} size={18} color={cfg.fg} />
        <Text style={[styles.kitchenBadgeText, { color: cfg.fg }]}>
          {cfg.label}
        </Text>
        <Text style={[styles.kitchenBadgeCount, { color: cfg.fg }]}>
          · {activeKitchenAgg.total} {activeKitchenAgg.total === 1
            ? t('kitchen.itemSingular', { defaultValue: 'item' })
            : t('kitchen.itemPlural', { defaultValue: 'items' })}
        </Text>
      </View>
    );
  })() : null;

  const CurrentTicketCard = activeTicket ? (
    <View
      style={styles.ticketCard}
    >
      {/* Header: ticket # + status capsule (with service timer stacked below on serving) */}
      <View style={styles.ticketHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap', flex: 1 }}>
          <Text style={[
            styles.ticketNumber,
            isTablet && !isFloorView && styles.ticketNumberTablet,
            isFloorView && styles.ticketNumberCompact,
          ]}>
            {activeTicket.ticket_number}
          </Text>
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

      <TableSuggestion
        officeId={officeId}
        category={businessCategory}
        ticket={activeTicket as any}
      />

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

          {kitchenStatusBadge}

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

          {kitchenStatusBadge}

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
  // Right-pane content: either Floor Map or Waiting Queue List
  const RightPaneContent = isFloorView ? (
    <View style={[isWide ? styles.rightColumn : styles.floorMapPhone]}>
      <FloorMap
        officeId={officeId}
        waitingCount={queue.waiting.length}
        activeTickets={[...queue.called, ...queue.serving] as any}
        parkedTickets={queue.parked as any}
        ticketsWithItems={ticketsWithItems}
        refreshKey={floorRefreshKey}
        // Tables tab is dedicated to the floor — drop compact mode so cards
        // breathe (the queue/active-ticket panels are not rendered alongside).
        compact={false}
        onSelectOccupied={(ticket, table) => {
          // Tap an occupied / on-hold table → open the Table Action Sheet
          // (full per-table control surface). The sheet keys off both the
          // table and its current ticket so operators can mark served,
          // move, release, recall, etc. without leaving the floor view.
          setTableSheetTable(table);
          setTableSheetTicket((ticket as QueueTicket | null) ?? null);
        }}
        onSeatNext={(tableLabel) => {
          // Always open the client picker so the operator sees the live
          // waiting list and can choose exactly who to seat. The picker
          // also exposes a "Call next" shortcut and shows an empty state
          // if no one is waiting — no need to short-circuit here.
          setClientPickerTable(tableLabel);
        }}
      />
    </View>
  ) : (
    <View style={isWide ? styles.rightColumn : undefined}>
      {WaitingQueueList}
    </View>
  );

  const leftColumn = (
    <View style={isWide ? styles.leftColumn : undefined}>
      {OnBreakBanner}
      {UpcomingAppointmentsCard}
      {CurrentTicketCard}
      {CallNextButton}
      {ParkedSection}
    </View>
  );

  const rightColumn = RightPaneContent;

  const OfflineBanner = isOffline ? (
    <View style={styles.offlineBanner}>
      <Ionicons name="cloud-offline-outline" size={16} color="#fff" />
      <Text style={styles.offlineBannerText}>
        {t('desk.offlineMsg')}
      </Text>
    </View>
  ) : null;

  // Queue/Floor toggle strip — only when the org supports floor view
  // (restaurant/cafe). Sits below the header so it has room to breathe and
  // doesn't overlap the title or status badges. Full-width segmented control
  // with large tap targets that work on phone and tablet alike.
  const FloorToggleStrip = supportsFloorView ? (
    <View style={styles.floorToggleStrip}>
      <TouchableOpacity
        style={[styles.floorTabBtn, floorViewMode === 'queue' && styles.floorTabBtnActive]}
        onPress={() => floorViewMode !== 'queue' && toggleFloorView()}
        activeOpacity={0.85}
      >
        <Ionicons
          name="list-outline"
          size={16}
          color={floorViewMode === 'queue' ? colors.primary : colors.textSecondary}
        />
        <Text style={[styles.floorTabBtnText, floorViewMode === 'queue' && styles.floorTabBtnTextActive]}>
          {t('desk.viewQueue')}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.floorTabBtn, floorViewMode === 'floor' && styles.floorTabBtnActive]}
        onPress={() => floorViewMode !== 'floor' && toggleFloorView()}
        activeOpacity={0.85}
      >
        <Ionicons
          name="grid-outline"
          size={16}
          color={floorViewMode === 'floor' ? colors.primary : colors.textSecondary}
        />
        <Text style={[styles.floorTabBtnText, floorViewMode === 'floor' && styles.floorTabBtnTextActive]}>
          {t('desk.viewTables')}
        </Text>
      </TouchableOpacity>
    </View>
  ) : null;

  return (
    <>
      {OfflineBanner}
      {FloorToggleStrip}
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
          isFloorView ? (
            // Tables tab on tablet/wide — floor map only, full width. The
            // queue / active-ticket / parked / recently-served panels live
            // in the Queue tab, so we don't repeat them here.
            <>{RightPaneContent}</>
          ) : (
            <>
              <View style={styles.wideRow}>
                {leftColumn}
                {rightColumn}
              </View>
              {RecentlyServedSection}
            </>
          )
        ) : isFloorView ? (
          // Tables tab on phone — table-focused only. No active ticket,
          // no waiting queue, no parked, no recently-served. Operators
          // tap a table to control it via the action sheet.
          <>{RightPaneContent}</>
        ) : (
          <>
            {OnBreakBanner}
            {UpcomingAppointmentsCard}
            {CurrentTicketCard}
            {CallNextButton}
            {ParkedSection}
            {RightPaneContent}
            {RecentlyServedSection}
          </>
        )}
      </ScrollView>

      {/* Table action sheet — opens when an occupied/on-hold FloorMap table
          is tapped. Full per-table control surface (mark served / move /
          release / recall / park / no-show / requeue) so operators can
          run the floor without bouncing back to the queue list. */}
      <TableActionSheet
        visible={tableSheetTable !== null}
        table={tableSheetTable}
        ticket={tableSheetTicket as any}
        busy={actionLoading || tableSheetBusy}
        onClose={closeTableSheet}
        onStartServing={(tk) => sheetStartServing(tk as QueueTicket)}
        onMarkServed={(tk) => sheetMarkServed(tk as QueueTicket)}
        onResume={(tk) => sheetResume(tk as QueueTicket)}
        onRecall={(tk) => sheetRecall(tk as QueueTicket)}
        onMove={(tk, tb) => sheetMove(tk as QueueTicket, tb)}
        onOrder={(tk) => sheetOrder(tk as QueueTicket)}
        onPark={(tk) => sheetPark(tk as QueueTicket)}
        onNoShow={(tk) => sheetNoShow(tk as QueueTicket)}
        onRequeue={(tk) => sheetRequeue(tk as QueueTicket)}
        onReleaseTable={(tb) => sheetReleaseTable(tb)}
        items={tableSheetItems}
        payments={tableSheetPayments}
        onItemQty={handleSheetItemQty}
        onItemRemove={handleSheetItemRemove}
      />

      {/* Move flow — destination picker for an existing seated ticket.
          Reuses the same TablePickerModal as the Suggestion bar so capacity
          / fit / occupancy hints are consistent. seatTicketAtTableId
          auto-releases the previous row, so a single tap completes the move. */}
      <TablePickerModal
        visible={moveTicket !== null}
        tables={allTables}
        partySize={moveTicket ? parsePartySize((moveTicket.customer_data as any)?.party_size) : null}
        ticketNumber={moveTicket?.ticket_number}
        busy={tableSheetBusy}
        onSelect={handleMoveSelectTable}
        onClose={() => setMoveTicket(null)}
      />

      {/* OrderPad — tap "Add items" on the action sheet to open. Restaurant
          flow: pick categories, add items (snapshot price+name into
          ticket_items). Closing returns to the action sheet where the
          items show inline; "Mark Served" triggers the receipt via the
          existing notifyCustomer('served') path. */}
      {orgId && orderTicket ? (
        <OrderPad
          visible={true}
          organizationId={orgId}
          ticketId={orderTicket.id}
          ticketNumber={orderTicket.ticket_number}
          tableCode={(orderTicket as any).table_code ?? null}
          staffId={staffId ?? null}
          onClose={handleOrderPadClose}
          onChanged={() => {
            refresh();
            if (orderTicket) refreshSheetItems(orderTicket.id);
          }}
        />
      ) : null}

      {/* Combined Serve sheet (file kept as CashPaymentSheet) — opened
          from "Mark served". Shows order summary + cash recorder + a
          single "Finish & send receipt" button that records the
          payment (if tendered) then marks served, which auto-builds
          the receipt block server-side and notifies the customer. */}
      {orgId && cashTicket ? (
        <CashPaymentSheet
          visible={true}
          organizationId={orgId}
          ticketId={cashTicket.id}
          ticketNumber={cashTicket.ticket_number}
          tableCode={(cashTicket as any).table_code ?? null}
          staffId={staffId ?? null}
          items={cashItems}
          payments={cashPayments}
          onClose={handleCashSheetClose}
          onFinish={handleServeFinish}
        />
      ) : null}

      {/* Client picker — opens when an empty FloorMap table is tapped.
          Shows BOTH still-waiting tickets AND already-notified ones
          (status='called' without a desk binding). Without this, a
          ticket vanishes from the picker the moment the operator taps
          Notify, leaving them unable to seat the customer when they
          arrive. */}
      <ClientPickerModal
        visible={clientPickerTable !== null}
        tickets={[
          ...queue.waiting,
          ...queue.called.filter((t) => !(t as any).desk_id),
        ] as any}
        tableLabel={clientPickerTable ?? undefined}
        busy={clientPickerBusy}
        onCallNext={() => {
          setClientPickerTable(null);
          handleCallNext();
        }}
        onNotify={async (tk) => {
          if (!staffId) return;
          setClientPickerBusy(true);
          try {
            // Pings the customer over their existing channel
            // (WhatsApp / Messenger / push). Status flips to 'called'
            // but no desk_id is set — multi-party safe.
            await Actions.notifyTableReady(tk.id, staffId);
            await refresh();
          } catch (e: any) {
            Alert.alert(t('common.error'), e?.message ?? t('adminQueue.actionFailed'));
          } finally {
            setClientPickerBusy(false);
          }
        }}
        onSelect={async (tk) => {
          if (!staffId) {
            setClientPickerTable(null);
            return;
          }
          setClientPickerBusy(true);
          try {
            // Restaurant / cafe (floor view): a single host seats many parties
            // in parallel. We promote the ticket straight to 'serving' WITHOUT
            // setting desk_id so the DB's 1-active-per-desk trigger doesn't
            // fire. The party is owned by the floor, not a single desk.
            //
            // Non-tables verticals: keep the old "call to my desk" semantics
            // since only one customer is in front of the operator at a time.
            if (isFloorView && clientPickerTable && officeId) {
              await Actions.seatPartyAtTable(officeId, clientPickerTable, tk.id, staffId);
            } else if (deskId) {
              // 1) Call the ticket to this desk so it shows up in active state
              await Actions.callSpecificTicket(tk.id, deskId, staffId);
              // 2) Bind the ticket to the chosen table (still useful in
              //    non-floor-view orgs that opt-in to table_label tracking).
              if (clientPickerTable && officeId) {
                await Actions.seatTicketAtTable(officeId, clientPickerTable, tk.id);
              }
            }
            // Optimistic local update so the cell flips to occupied INSTANTLY
            // — don't wait for the next FloorMap poll or queue refresh round-trip.
            // Match by label or code (`seatTicketAtTable` accepts either).
            if (clientPickerTable) {
              setAllTables((prev) =>
                prev.map((row: any) =>
                  row.label === clientPickerTable || row.code === clientPickerTable || row.id === clientPickerTable
                    ? { ...row, current_ticket_id: tk.id, status: 'occupied' }
                    : row,
                ),
              );
            }
            // Bump the FloorMap refresh key so it re-reads restaurant_tables
            // from the server right away — closes the gap before the queue
            // realtime / poll catches up.
            setFloorRefreshKey((n) => n + 1);
            // Refresh the queue so the freshly-called ticket appears in
            // active-ticket card right away (especially in local mode where
            // realtime isn't available).
            await refresh();
          } catch (e: any) {
            Alert.alert(t('common.error'), e?.message ?? t('adminQueue.actionFailed'));
          } finally {
            setClientPickerBusy(false);
            setClientPickerTable(null);
          }
        }}
        onClose={() => setClientPickerTable(null)}
      />

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
  kitchenBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    alignSelf: 'stretch',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  kitchenBadgeText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  kitchenBadgeCount: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    opacity: 0.85,
  },
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
  // Tablet: bigger ticker number (128pt)
  ticketNumberTablet: {
    fontSize: 128,
    lineHeight: 132,
  },
  // Compact: smaller ticket number when in floor/table view alongside the map
  ticketNumberCompact: {
    fontSize: 36,
    lineHeight: 40,
    marginTop: 0,
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
  headerLeftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: spacing.sm,
  },
  headerSwitchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    borderRadius: borderRadius.full,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  headerPauseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    borderRadius: borderRadius.full,
    backgroundColor: 'rgba(251, 191, 36, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.40)',
  },
  headerRightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginRight: spacing.sm,
  },
  // Floor/Queue toggle strip — sits below the header (replaces the cramped
  // pill toggle that used to live in the header right and overlapped on phone).
  floorToggleStrip: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    gap: 6,
  },
  floorTabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: borderRadius.md,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  floorTabBtnActive: {
    backgroundColor: colors.primary + '15',
    borderColor: colors.primary,
  },
  floorTabBtnText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  floorTabBtnTextActive: {
    color: colors.primary,
  },
  // Phone floor map wrapper — full-width below the active ticket panel
  floorMapPhone: {
    minHeight: 280,
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    width: '100%',
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
