import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { QueueCard } from '@/components/QueueCard';
import { useAppStore } from '@/lib/store';
import { fetchTicket, type TicketResponse } from '@/lib/api';
import { registerForPush } from '@/lib/notifications';
import { colors, borderRadius, fontSize, spacing } from '@/lib/theme';

export default function TicketScreen() {
  const { t } = useTranslation();
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const { setActiveToken, setActiveTicket } = useAppStore();
  const [ticket, setTicket] = useState<TicketResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [notifRegistered, setNotifRegistered] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevStatusRef = useRef<string | null>(null);

  const prevCalledAtRef = useRef<string | null>(null);

  const poll = useCallback(async () => {
    if (!token) return;
    const data = await fetchTicket(token);
    if (!data) return;

    if (prevStatusRef.current && prevStatusRef.current !== data.status) {
      if (data.status === 'called') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } else if (data.status === 'serving') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    }

    // Detect recall: status is still 'called' but called_at changed
    if (
      data.status === 'called' &&
      prevCalledAtRef.current &&
      data.called_at &&
      prevCalledAtRef.current !== data.called_at
    ) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }

    prevStatusRef.current = data.status;
    prevCalledAtRef.current = data.called_at;
    setTicket(data);
    setLoading(false);
  }, [token]);

  useEffect(() => {
    if (!token) return;
    poll();
    // Start at 5s; the interval updates itself based on current ticket status
    intervalRef.current = setInterval(() => {
      poll();
    }, 5000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [token, poll]);

  const handleTrack = async () => {
    if (!ticket || !token) return;
    setActiveToken(token);
    setActiveTicket(ticket);

    // Register for push notifications
    const registered = await registerForPush(ticket.id, token);
    setNotifRegistered(registered);

    router.replace('/(tabs)');
  };

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>{t('ticketView.loadingTicket')}</Text>
      </View>
    );
  }

  if (!ticket) {
    return (
      <View style={styles.error}>
        <Ionicons name="alert-circle-outline" size={64} color={colors.error} />
        <Text style={styles.errorTitle}>{t('ticketView.ticketNotFound')}</Text>
        <Text style={styles.errorSubtitle}>
          {t('ticketView.ticketExpiredMsg')}
        </Text>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Text style={styles.backButtonText}>{t('ticketView.goBack')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isTerminal = ['served', 'no_show', 'cancelled'].includes(ticket.status);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={poll} tintColor={colors.primary} />
      }
    >
      <QueueCard ticket={ticket} />

      {!isTerminal && (
        <TouchableOpacity style={styles.trackButton} onPress={handleTrack}>
          <Ionicons name="eye-outline" size={20} color="#fff" />
          <Text style={styles.trackButtonText}>{t('ticketView.trackThisTicket')}</Text>
        </TouchableOpacity>
      )}

      {notifRegistered && (
        <View style={styles.notifBanner}>
          <Ionicons name="notifications" size={16} color={colors.success} />
          <Text style={styles.notifText}>{t('ticketView.notificationsEnabled')}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  loading: {
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
  error: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
    padding: spacing.xl,
    gap: spacing.md,
  },
  errorTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.text,
    marginTop: spacing.md,
  },
  errorSubtitle: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  backButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.md,
  },
  backButtonText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  trackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
  },
  trackButtonText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: '#fff',
  },
  notifBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.successLight,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
  },
  notifText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.success,
  },
});
