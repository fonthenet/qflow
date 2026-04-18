import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useAppStore, type SavedAppointment } from '@/lib/store';
import { useTheme, borderRadius, fontSize, spacing } from '@/lib/theme';
import {
  cancelAppointment,
  checkInAppointment,
  fetchAppointmentByToken,
  getCalendarIcsUrl,
} from '@/lib/api';

type ThemeColors = ReturnType<typeof useTheme>['colors'];

// Terminal statuses — a booking in any of these is read-only
const TERMINAL = new Set(['cancelled', 'completed', 'no_show']);

function isTerminal(status: string | undefined | null) {
  return !!status && TERMINAL.has(status.toLowerCase());
}

function isSameCalendarDay(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function statusColor(status: string, colors: ThemeColors): string {
  switch (status?.toLowerCase()) {
    case 'confirmed':
    case 'checked_in':
    case 'serving':
      return colors.success;
    case 'pending':
      return colors.warning;
    case 'cancelled':
    case 'no_show':
      return colors.error;
    case 'completed':
      return colors.textMuted;
    default:
      return colors.textSecondary;
  }
}

export default function AppointmentsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const savedAppointments = useAppStore((s) => s.savedAppointments);
  const updateAppointment = useAppStore((s) => s.updateAppointment);
  const removeAppointment = useAppStore((s) => s.removeAppointment);

  const [refreshing, setRefreshing] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const { upcoming, past } = useMemo(() => {
    const now = Date.now();
    const up: SavedAppointment[] = [];
    const done: SavedAppointment[] = [];
    for (const a of savedAppointments) {
      if (a.hidden) continue;
      const scheduled = new Date(a.scheduledAt).getTime();
      if (isTerminal(a.status) || scheduled < now - 2 * 3600_000) {
        done.push(a);
      } else {
        up.push(a);
      }
    }
    up.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
    done.sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());
    return { upcoming: up, past: done };
  }, [savedAppointments]);

  const refreshAll = useCallback(async () => {
    if (savedAppointments.length === 0) return;
    setRefreshing(true);
    await Promise.all(
      savedAppointments
        .filter((a) => !a.hidden)
        .map(async (a) => {
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
    setRefreshing(false);
  }, [savedAppointments, updateAppointment]);

  useFocusEffect(
    useCallback(() => {
      refreshAll();
    }, [refreshAll]),
  );

  const markBusy = (id: string, on: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleCancel = (appt: SavedAppointment) => {
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
            const result = await cancelAppointment(appt.calendarToken);
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
          },
        },
      ],
    );
  };

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
    // If the server created a live ticket, jump to the Queue tab so the
    // customer sees their position. setActiveToken triggers the tracker UI.
    const qr = result.ticket?.qr_token;
    if (qr) {
      useAppStore.getState().setActiveToken(qr);
      router.push('/(tabs)' as any);
    }
  };

  const handleAddToCalendar = async (appt: SavedAppointment) => {
    const url = getCalendarIcsUrl(appt.calendarToken);
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
      } else {
        Alert.alert(t('common.error'), t('appointments.calendarOpenFailed'));
      }
    } catch {
      Alert.alert(t('common.error'), t('appointments.calendarOpenFailed'));
    }
  };

  const handleRemove = (appt: SavedAppointment) => {
    Alert.alert(
      t('appointments.removeTitle'),
      t('appointments.removeMessage'),
      [
        { text: t('common.back'), style: 'cancel' },
        {
          text: t('appointments.removeConfirm'),
          style: 'destructive',
          onPress: () => removeAppointment(appt.id),
        },
      ],
    );
  };

  const renderCard = (appt: SavedAppointment) => {
    const busy = busyIds.has(appt.id);
    const terminal = isTerminal(appt.status);
    // Self check-in is disabled — the business checks customers in at the
    // office (staff or kiosk). Flag kept as `false` so render stays simple.
    const canCheckIn = false;

    return (
      <View
        key={appt.id}
        style={[s.card, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}
      >
        <View style={s.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[s.cardTitle, { color: colors.text }]} numberOfLines={1}>
              {appt.businessName}
            </Text>
            {appt.serviceName ? (
              <Text style={[s.cardSub, { color: colors.textSecondary }]} numberOfLines={1}>
                {appt.serviceName}
                {appt.departmentName ? ` · ${appt.departmentName}` : ''}
              </Text>
            ) : null}
          </View>
          <View style={[s.statusPill, { backgroundColor: statusColor(appt.status, colors) + '1a' }]}>
            <View style={[s.statusDot, { backgroundColor: statusColor(appt.status, colors) }]} />
            <Text style={[s.statusText, { color: statusColor(appt.status, colors) }]}>
              {t(`appointments.status.${appt.status}`, { defaultValue: appt.status })}
            </Text>
          </View>
        </View>

        <View style={[s.dateRow, { borderColor: colors.borderLight }]}>
          <Ionicons name="calendar-outline" size={16} color={colors.primary} />
          <Text style={[s.dateText, { color: colors.text }]}>{formatDateTime(appt.scheduledAt)}</Text>
        </View>

        {busy ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.md }} />
        ) : (
          <View style={s.actionsRow}>
            {canCheckIn && (
              <TouchableOpacity
                style={[s.actionBtn, { backgroundColor: colors.primary }]}
                onPress={() => handleCheckIn(appt)}
                activeOpacity={0.8}
              >
                <Ionicons name="log-in-outline" size={16} color="#fff" />
                <Text style={[s.actionText, { color: '#fff' }]}>{t('appointments.checkIn')}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[s.actionBtn, { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderLight, borderWidth: 1 }]}
              onPress={() => handleAddToCalendar(appt)}
              activeOpacity={0.8}
            >
              <Ionicons name="download-outline" size={16} color={colors.text} />
              <Text style={[s.actionText, { color: colors.text }]}>{t('appointments.addToCalendar')}</Text>
            </TouchableOpacity>
            {!terminal && (
              <TouchableOpacity
                style={[s.actionBtn, { backgroundColor: colors.surfaceSecondary, borderColor: colors.error + '40', borderWidth: 1 }]}
                onPress={() => handleCancel(appt)}
                activeOpacity={0.8}
              >
                <Ionicons name="close-outline" size={16} color={colors.error} />
                <Text style={[s.actionText, { color: colors.error }]}>{t('appointments.cancel')}</Text>
              </TouchableOpacity>
            )}
            {terminal && (
              <TouchableOpacity
                style={[s.actionBtn, { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderLight, borderWidth: 1 }]}
                onPress={() => handleRemove(appt)}
                activeOpacity={0.8}
              >
                <Ionicons name="trash-outline" size={16} color={colors.textSecondary} />
                <Text style={[s.actionText, { color: colors.textSecondary }]}>{t('appointments.remove')}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    );
  };

  const isEmpty = upcoming.length === 0 && past.length === 0;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[
        s.content,
        { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xxl },
      ]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refreshAll} tintColor={colors.primary} />
      }
    >
      {/* Back row */}
      <TouchableOpacity style={s.backRow} onPress={() => router.back()} activeOpacity={0.7}>
        <Ionicons name="arrow-back" size={20} color={colors.primary} />
        <Text style={[s.backText, { color: colors.primary }]}>{t('common.back')}</Text>
      </TouchableOpacity>

      <Text style={[s.pageTitle, { color: colors.text }]}>{t('appointments.title')}</Text>
      <Text style={[s.pageSub, { color: colors.textSecondary }]}>{t('appointments.subtitle')}</Text>

      {isEmpty ? (
        <View style={[s.emptyBox, { borderColor: colors.borderLight }]}>
          <Ionicons name="calendar-outline" size={44} color={colors.textMuted} />
          <Text style={[s.emptyTitle, { color: colors.text }]}>{t('appointments.emptyTitle')}</Text>
          <Text style={[s.emptySub, { color: colors.textSecondary }]}>{t('appointments.emptySub')}</Text>
        </View>
      ) : (
        <>
          {upcoming.length > 0 && (
            <>
              <Text style={[s.sectionTitle, { color: colors.text }]}>{t('appointments.upcoming')}</Text>
              {upcoming.map(renderCard)}
            </>
          )}
          {past.length > 0 && (
            <>
              <Text style={[s.sectionTitle, { color: colors.text, marginTop: spacing.lg }]}>
                {t('appointments.past')}
              </Text>
              {past.map(renderCard)}
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
  },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.md },
  backText: { fontSize: fontSize.md, fontWeight: '600' },

  pageTitle: { fontSize: fontSize.xxl, fontWeight: '800', marginBottom: 2 },
  pageSub: { fontSize: fontSize.sm, marginBottom: spacing.lg },

  sectionTitle: { fontSize: fontSize.md, fontWeight: '700', marginBottom: spacing.sm },

  emptyBox: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: borderRadius.xl,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: '700' },
  emptySub: { fontSize: fontSize.sm, textAlign: 'center', maxWidth: 260 },

  card: {
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  cardTitle: { fontSize: fontSize.md, fontWeight: '700' },
  cardSub: { fontSize: fontSize.sm, marginTop: 2 },

  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },

  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  dateText: { fontSize: fontSize.sm, fontWeight: '600' },

  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.md },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: borderRadius.md,
  },
  actionText: { fontSize: fontSize.sm, fontWeight: '600' },
});
