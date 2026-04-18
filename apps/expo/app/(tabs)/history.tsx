import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAppStore, type SavedAppointment } from '@/lib/store';
import {
  cancelAppointment,
  checkInAppointment,
  fetchAppointmentByToken,
  getCalendarIcsUrl,
} from '@/lib/api';
import { useTheme, borderRadius, fontSize, spacing } from '@/lib/theme';

type ThemeColors = ReturnType<typeof useTheme>['colors'];

// Ticket history entry (existing shape)
interface HistoryEntry {
  token: string;
  ticketNumber: string;
  officeName: string;
  serviceName: string;
  status: string;
  date: string; // ISO
  officeId?: string;
  kioskSlug?: string;
  joinToken?: string;
}

// Unified feed item — either a scanned ticket or a booked appointment
type FeedItem =
  | ({ kind: 'ticket' } & HistoryEntry)
  | ({ kind: 'appt' } & SavedAppointment);

const TICKET_STATUS: Record<string, { statusKey: string; colorKey: string; icon: string }> = {
  served: { statusKey: 'status.served', colorKey: 'success', icon: 'checkmark-circle' },
  no_show: { statusKey: 'status.missed', colorKey: 'warning', icon: 'alert-circle' },
  cancelled: { statusKey: 'status.cancelled', colorKey: 'error', icon: 'close-circle' },
  waiting: { statusKey: 'status.waiting', colorKey: 'waiting', icon: 'time' },
  called: { statusKey: 'status.called', colorKey: 'called', icon: 'megaphone' },
  serving: { statusKey: 'status.serving', colorKey: 'serving', icon: 'pulse' },
};

// Appointments that are still actionable — anything else drops into "Past".
const UPCOMING_APPT = new Set(['pending', 'confirmed', 'checked_in', 'serving']);
const TERMINAL_APPT = new Set(['cancelled', 'completed', 'no_show']);

function isSameDay(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return d.toDateString() === now.toDateString();
}

function formatSectionDate(dateStr: string, t: (k: string) => string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((todayOnly.getTime() - dateOnly.getTime()) / 86_400_000);
  if (diff === 0) return t('time.today');
  if (diff === 1) return t('time.yesterday');
  if (diff === -1) return t('time.tomorrow');
  return date.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

/** Human-readable countdown: "In 12 min", "In 3 h", "Starts now". */
function formatCountdown(iso: string, t: (k: string, o?: any) => string): string | null {
  const diffMs = new Date(iso).getTime() - Date.now();
  if (diffMs < -15 * 60_000) return null; // >15 min past → show nothing (live status will cover it)
  const mins = Math.round(diffMs / 60_000);
  if (mins <= 0 && mins >= -15) return t('history.startingNow');
  if (mins < 60) return t('history.inMinutes', { count: mins });
  const hours = Math.round(mins / 60);
  if (hours < 24) return t('history.inHours', { count: hours });
  const days = Math.round(hours / 24);
  return t('history.inDays', { count: days });
}

function apptStatusColor(status: string, colors: ThemeColors): string {
  const s = status?.toLowerCase();
  if (s === 'confirmed' || s === 'checked_in' || s === 'serving') return colors.success;
  if (s === 'pending') return colors.warning;
  if (s === 'cancelled' || s === 'no_show') return colors.error;
  if (s === 'completed') return colors.textMuted;
  return colors.textSecondary;
}

export default function HistoryScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const { history, savedAppointments } = useAppStore();
  const updateAppointment = useAppStore((s) => s.updateAppointment);
  const removeAppointment = useAppStore((s) => s.removeAppointment);

  const [refreshing, setRefreshing] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  // --- Refresh upcoming/same-day appointments (live status tracking) --------
  const refreshAppointments = useCallback(async () => {
    const targets = savedAppointments.filter(
      (a) => !a.hidden && !TERMINAL_APPT.has(a.status),
    );
    if (targets.length === 0) return;
    await Promise.all(
      targets.map(async (a) => {
        const latest = await fetchAppointmentByToken(a.calendarToken);
        if (latest) {
          updateAppointment(a.id, {
            status: latest.status,
            scheduledAt: latest.scheduled_at,
            lastSyncedAt: new Date().toISOString(),
          });
        }
      }),
    );
  }, [savedAppointments, updateAppointment]);

  // Refresh on screen focus
  useFocusEffect(
    useCallback(() => {
      refreshAppointments();
    }, [refreshAppointments]),
  );

  // Poll every 20s while focused — keeps same-day/upcoming status "instant".
  // `focused` is flipped by useFocusEffect so we don't poll in the background.
  const focusedRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      const id = setInterval(() => {
        if (focusedRef.current) refreshAppointments();
      }, 20_000);
      return () => {
        focusedRef.current = false;
        clearInterval(id);
      };
    }, [refreshAppointments]),
  );

  const onPullToRefresh = useCallback(async () => {
    setRefreshing(true);
    Haptics.selectionAsync();
    await refreshAppointments();
    setRefreshing(false);
  }, [refreshAppointments]);

  // --- Appointment actions --------------------------------------------------
  const markBusy = (id: string, on: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      on ? next.add(id) : next.delete(id);
      return next;
    });

  const handleCheckIn = async (appt: SavedAppointment) => {
    markBusy(appt.id, true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const result = await checkInAppointment(appt.calendarToken);
    markBusy(appt.id, false);
    if ('error' in result) {
      Alert.alert(t('common.error'), result.error);
      return;
    }
    updateAppointment(appt.id, {
      status: result.status,
      lastSyncedAt: new Date().toISOString(),
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const qr = result.ticket?.qr_token;
    if (qr) {
      useAppStore.getState().setActiveToken(qr);
      router.push('/(tabs)' as any);
    }
  };

  const handleCancelAppt = (appt: SavedAppointment) => {
    Alert.alert(
      t('appointments.cancelTitle'),
      t('appointments.cancelMessage'),
      [
        { text: t('common.back'), style: 'cancel' },
        {
          text: t('appointments.cancelConfirm'),
          style: 'destructive',
          onPress: async () => {
            markBusy(appt.id, true);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            const r = await cancelAppointment(appt.calendarToken);
            markBusy(appt.id, false);
            if ('error' in r) {
              Alert.alert(t('common.error'), r.error);
              return;
            }
            updateAppointment(appt.id, {
              status: r.status,
              lastSyncedAt: new Date().toISOString(),
            });
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          },
        },
      ],
    );
  };

  const handleAddToCalendar = async (appt: SavedAppointment) => {
    const url = getCalendarIcsUrl(appt.calendarToken);
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) await Linking.openURL(url);
      else Alert.alert(t('common.error'), t('appointments.calendarOpenFailed'));
    } catch {
      Alert.alert(t('common.error'), t('appointments.calendarOpenFailed'));
    }
  };

  const handleRemoveAppt = (appt: SavedAppointment) =>
    Alert.alert(t('appointments.removeTitle'), t('appointments.removeMessage'), [
      { text: t('common.back'), style: 'cancel' },
      {
        text: t('appointments.removeConfirm'),
        style: 'destructive',
        onPress: () => removeAppointment(appt.id),
      },
    ]);

  // Tab state: Today (same-day) / Upcoming (future days) / Past (history).
  type Tab = 'today' | 'upcoming' | 'past';
  const [tab, setTab] = useState<Tab>('today');

  // --- Build per-tab sections -----------------------------------------------
  const { todaySections, upcomingSections, pastSections } = useMemo(() => {
    // Active appointments — anything not terminal. Live tickets are tracked
    // on the Queue tab, not here.
    const activeAppts = savedAppointments.filter(
      (a) => !a.hidden && UPCOMING_APPT.has(a.status),
    );
    const todayAppts: FeedItem[] = activeAppts
      .filter((a) => isSameDay(a.scheduledAt))
      .map((a) => ({ kind: 'appt' as const, ...a }))
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
    const futureAppts: FeedItem[] = activeAppts
      .filter((a) => !isSameDay(a.scheduledAt))
      .map((a) => ({ kind: 'appt' as const, ...a }))
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

    // Past: everything else — grouped by calendar day, newest first
    const pastApptItems: FeedItem[] = savedAppointments
      .filter((a) => !a.hidden && !UPCOMING_APPT.has(a.status))
      .map((a) => ({ kind: 'appt' as const, ...a }));

    const ticketItems: FeedItem[] = history.map((h) => ({ kind: 'ticket' as const, ...h }));

    const pastItems = [...pastApptItems, ...ticketItems];
    const groups: Record<string, FeedItem[]> = {};
    for (const item of pastItems) {
      const iso = item.kind === 'appt' ? item.scheduledAt : item.date;
      const d = new Date(iso);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      (groups[key] ??= []).push(item);
    }
    const pastSections = Object.entries(groups)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([key, data]) => ({
        title: formatSectionDate(
          data[0].kind === 'appt' ? data[0].scheduledAt : data[0].date,
          t,
        ),
        data: data.sort((a, b) => {
          const ai = a.kind === 'appt' ? a.scheduledAt : a.date;
          const bi = b.kind === 'appt' ? b.scheduledAt : b.date;
          return new Date(bi).getTime() - new Date(ai).getTime();
        }),
      }));

    // Upcoming — group future appointments by day so users see Apr 20 / Apr 21.
    const upcomingGroups: Record<string, FeedItem[]> = {};
    for (const item of futureAppts) {
      const iso = item.kind === 'appt' ? item.scheduledAt : (item as any).date;
      const d = new Date(iso);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      (upcomingGroups[key] ??= []).push(item);
    }
    const upcomingSections = Object.entries(upcomingGroups)
      .sort(([a], [b]) => a.localeCompare(b)) // ascending — nearest first
      .map(([_key, data]) => ({
        title: formatSectionDate(
          data[0].kind === 'appt' ? data[0].scheduledAt : (data[0] as any).date,
          t,
        ),
        data,
      }));

    // Today section is a single "flat" group — no date header needed.
    const todaySections =
      todayAppts.length > 0
        ? [{ title: t('history.today'), data: todayAppts }]
        : [];

    return { todaySections, upcomingSections, pastSections };
  }, [savedAppointments, history, t]);

  const sections =
    tab === 'today' ? todaySections : tab === 'upcoming' ? upcomingSections : pastSections;
  const counts = {
    today: todaySections.reduce((n, s) => n + s.data.length, 0),
    upcoming: upcomingSections.reduce((n, s) => n + s.data.length, 0),
    past: pastSections.reduce((n, s) => n + s.data.length, 0),
  };

  const emptyCopy = {
    today: { title: t('history.emptyTodayTitle'), sub: t('history.emptyTodaySub') },
    upcoming: { title: t('history.emptyUpcomingTitle'), sub: t('history.emptyUpcomingSub') },
    past: { title: t('history.emptyPastTitle'), sub: t('history.emptyPastSub') },
  }[tab];

  const TabBar = (
    <View style={[styles.tabBar, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
      {(['today', 'upcoming', 'past'] as Tab[]).map((key) => {
        const active = tab === key;
        const count = counts[key];
        return (
          <TouchableOpacity
            key={key}
            style={[
              styles.tabPill,
              active && { backgroundColor: colors.primary },
            ]}
            onPress={() => {
              Haptics.selectionAsync();
              setTab(key);
            }}
            activeOpacity={0.8}
          >
            <Text
              style={[
                styles.tabText,
                { color: active ? '#fff' : colors.textSecondary },
              ]}
            >
              {t(`history.tab${key[0].toUpperCase() + key.slice(1)}`)}
            </Text>
            {count > 0 && (
              <View
                style={[
                  styles.tabBadge,
                  {
                    backgroundColor: active ? 'rgba(255,255,255,0.25)' : colors.surfaceSecondary,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.tabBadgeText,
                    { color: active ? '#fff' : colors.textSecondary },
                  ]}
                >
                  {count}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );

  return (
    <SectionList
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      sections={sections as any}
      keyExtractor={(item: FeedItem) => (item.kind === 'appt' ? `a:${item.id}` : `t:${item.token}`)}
      stickySectionHeadersEnabled={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onPullToRefresh}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
      ListHeaderComponent={TabBar}
      ListEmptyComponent={
        <View style={[styles.empty, { backgroundColor: colors.background }]}>
          <View style={[styles.emptyIconCircle, { backgroundColor: isDark ? 'rgba(59,130,246,0.12)' : colors.primaryLight + '15' }]}>
            <Ionicons
              name={tab === 'past' ? 'time-outline' : 'calendar-outline'}
              size={56}
              color={colors.primary}
            />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>{emptyCopy.title}</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>{emptyCopy.sub}</Text>
          {tab === 'today' && (
            <TouchableOpacity
              style={[styles.emptyButton, { backgroundColor: colors.primary }]}
              activeOpacity={0.7}
              onPress={() => router.push('/scan' as any)}
            >
              <Ionicons name="qr-code-outline" size={18} color="#fff" />
              <Text style={styles.emptyButtonText}>{t('history.scanToJoin')}</Text>
            </TouchableOpacity>
          )}
        </View>
      }
      renderSectionHeader={({ section }) =>
        // "Today" tab is a single flat group — no date header needed there.
        tab === 'today' ? null : (
          <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>{section.title}</Text>
        )
      }
      renderItem={({ item }: { item: FeedItem }) => {
        if (item.kind === 'appt') {
          return (
            <ApptCard
              appt={item}
              busy={busyIds.has(item.id)}
              colors={colors}
              t={t}
              onCheckIn={() => handleCheckIn(item)}
              onCancel={() => handleCancelAppt(item)}
              onCalendar={() => handleAddToCalendar(item)}
              onRemove={() => handleRemoveAppt(item)}
            />
          );
        }
        return <TicketRow item={item} colors={colors} isDark={isDark} t={t} router={router} />;
      }}
    />
  );
}

// ---- Ticket row (past ticket-based visits) ---------------------------------
function TicketRow({
  item,
  colors,
  isDark,
  t,
  router,
}: {
  item: HistoryEntry & { kind: 'ticket' };
  colors: ThemeColors;
  isDark: boolean;
  t: (k: string, o?: any) => string;
  router: ReturnType<typeof useRouter>;
}) {
  const cfg = TICKET_STATUS[item.status] ?? TICKET_STATUS.served;
  const statusColor = (colors as any)[cfg.colorKey] ?? colors.success;
  const date = new Date(item.date);
  const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.surface, shadowOpacity: isDark ? 0.15 : 0.03 }]}
      activeOpacity={0.6}
      onPress={() => router.push(`/ticket/${item.token}`)}
    >
      <View style={styles.cardLeft}>
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        <View style={styles.cardLeftText}>
          <Text style={[styles.ticketNumber, { color: colors.text }]}>{item.ticketNumber}</Text>
          <Text style={[styles.serviceName, { color: colors.textMuted }]} numberOfLines={1}>
            {item.serviceName}
          </Text>
        </View>
      </View>
      <View style={styles.cardCenter}>
        <Text style={[styles.officeName, { color: colors.textSecondary }]} numberOfLines={1}>
          {item.officeName}
        </Text>
        <Text style={[styles.timeText, { color: colors.textMuted }]}>{timeStr}</Text>
      </View>
      <View style={styles.cardRight}>
        <View style={[styles.statusBadge, { backgroundColor: statusColor + '18' }]}>
          <Text style={[styles.statusText, { color: statusColor }]}>{t(cfg.statusKey)}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} style={styles.chevron} />
      </View>
    </TouchableOpacity>
  );
}

// ---- Appointment card (supports actions) -----------------------------------
function ApptCard({
  appt,
  busy,
  colors,
  t,
  onCheckIn,
  onCancel,
  onCalendar,
  onRemove,
}: {
  appt: SavedAppointment;
  busy: boolean;
  colors: ThemeColors;
  t: (k: string, o?: any) => string;
  onCheckIn: () => void;
  onCancel: () => void;
  onCalendar: () => void;
  onRemove: () => void;
}) {
  const terminal = TERMINAL_APPT.has(appt.status);
  const canCheckIn =
    !terminal && (appt.status === 'confirmed' || appt.status === 'pending') && isSameDay(appt.scheduledAt);

  const color = apptStatusColor(appt.status, colors);
  const when = new Date(appt.scheduledAt);
  const whenStr = when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const countdown = !terminal ? formatCountdown(appt.scheduledAt, t) : null;

  return (
    <View style={[styles.apptCard, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
      <View style={styles.apptHeader}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.apptTitle, { color: colors.text }]} numberOfLines={1}>
            {appt.businessName}
          </Text>
          {appt.serviceName ? (
            <Text style={[styles.apptSub, { color: colors.textSecondary }]} numberOfLines={1}>
              {appt.serviceName}
              {appt.departmentName ? ` · ${appt.departmentName}` : ''}
            </Text>
          ) : null}
        </View>
        <View style={[styles.apptPill, { backgroundColor: color + '1a' }]}>
          <View style={[styles.apptDot, { backgroundColor: color }]} />
          <Text style={[styles.apptPillText, { color }]}>
            {t(`appointments.status.${appt.status}`, { defaultValue: appt.status })}
          </Text>
        </View>
      </View>

      <View style={[styles.apptWhen, { borderColor: colors.borderLight }]}>
        <Ionicons name="calendar-outline" size={14} color={colors.primary} />
        <Text style={[styles.apptWhenText, { color: colors.text }]}>{whenStr}</Text>
        {countdown && (
          <>
            <View style={[styles.apptWhenDivider, { backgroundColor: colors.border }]} />
            <Text style={[styles.apptWhenCountdown, { color: colors.primary }]}>{countdown}</Text>
          </>
        )}
      </View>

      {busy ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.sm }} />
      ) : (
        <View style={styles.apptActions}>
          {canCheckIn && (
            <TouchableOpacity
              style={[styles.apptBtn, { backgroundColor: colors.primary }]}
              onPress={onCheckIn}
              activeOpacity={0.8}
            >
              <Ionicons name="log-in-outline" size={14} color="#fff" />
              <Text style={[styles.apptBtnText, { color: '#fff' }]}>{t('appointments.checkIn')}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.apptBtn, { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderLight, borderWidth: 1 }]}
            onPress={onCalendar}
            activeOpacity={0.8}
          >
            <Ionicons name="download-outline" size={14} color={colors.text} />
            <Text style={[styles.apptBtnText, { color: colors.text }]}>{t('appointments.addToCalendar')}</Text>
          </TouchableOpacity>
          {!terminal && (
            <TouchableOpacity
              style={[styles.apptBtn, { backgroundColor: colors.surfaceSecondary, borderColor: colors.error + '40', borderWidth: 1 }]}
              onPress={onCancel}
              activeOpacity={0.8}
            >
              <Ionicons name="close-outline" size={14} color={colors.error} />
              <Text style={[styles.apptBtnText, { color: colors.error }]}>{t('appointments.cancel')}</Text>
            </TouchableOpacity>
          )}
          {terminal && (
            <TouchableOpacity
              style={[styles.apptBtn, { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderLight, borderWidth: 1 }]}
              onPress={onRemove}
              activeOpacity={0.8}
            >
              <Ionicons name="trash-outline" size={14} color={colors.textSecondary} />
              <Text style={[styles.apptBtnText, { color: colors.textSecondary }]}>{t('appointments.remove')}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  emptyIconCircle: {
    width: 112,
    height: 112,
    borderRadius: 56,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  emptyTitle: { fontSize: fontSize.xl, fontWeight: '700', marginBottom: spacing.xs },
  emptySubtitle: { fontSize: fontSize.md, textAlign: 'center', lineHeight: 22, maxWidth: 260, marginBottom: spacing.lg },
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md - 2,
    borderRadius: borderRadius.full,
  },
  emptyButtonText: { fontSize: fontSize.md, fontWeight: '600', color: '#fff' },
  // Segmented tab bar (Today / Upcoming / Past)
  tabBar: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  tabPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: borderRadius.full,
  },
  tabText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  tabBadge: {
    minWidth: 20,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  sectionHeader: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    paddingLeft: spacing.xs,
  },

  // Ticket row
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 6,
    elevation: 1,
  },
  cardLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: spacing.sm },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  cardLeftText: { gap: 1 },
  ticketNumber: { fontSize: fontSize.md, fontWeight: '700' },
  serviceName: { fontSize: fontSize.xs },
  cardCenter: { flex: 1, alignItems: 'center', gap: 1 },
  officeName: { fontSize: fontSize.sm, fontWeight: '500' },
  timeText: { fontSize: fontSize.xs },
  cardRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusBadge: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  statusText: { fontSize: fontSize.xs, fontWeight: '600' },
  chevron: { marginLeft: 2 },

  // Appointment card
  apptCard: {
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  apptHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  apptTitle: { fontSize: fontSize.md, fontWeight: '700' },
  apptSub: { fontSize: fontSize.xs, marginTop: 2 },
  apptPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  apptDot: { width: 6, height: 6, borderRadius: 3 },
  apptPillText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  apptWhen: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  apptWhenText: { fontSize: fontSize.sm, fontWeight: '600' },
  apptWhenDivider: { width: 1, height: 12 },
  apptWhenCountdown: { fontSize: fontSize.xs, fontWeight: '700' },
  apptActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  apptBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: borderRadius.md,
  },
  apptBtnText: { fontSize: fontSize.xs, fontWeight: '600' },
});
