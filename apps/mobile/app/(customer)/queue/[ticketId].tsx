/**
 * Ticket / Queue Status screen.
 *
 * Shows the customer's current position, estimated wait, and live status.
 *
 * Data contract (thin client — no business logic here):
 *   - Fetches ticket state from Supabase: table `tickets` + `queues`
 *   - Subscribes to realtime changes on `tickets` for live status updates
 *   - Falls back to AsyncStorage cached state when offline
 *
 * TODO(mobile-sprint-2): Implement real data fetching + realtime subscription.
 *   See apps/expo/lib/use-realtime-queue.ts for the production implementation
 *   to adapt or import from @qflo/shared if extracted.
 *
 * TODO(mobile-sprint-2): Implement offline cache:
 *   - Store last 10 tickets in AsyncStorage keyed by ticketId
 *   - Show "last updated" banner when network unavailable
 *   - Use expo-network (or @react-native-community/netinfo) to detect state
 *
 * TODO(i18n-specialist): The ticket status labels (waiting/called/serving/done)
 *   must follow ticket.locale (set at join time), NOT the device locale.
 *   This matches the WhatsApp channel behaviour.
 *
 * Currency display: always use the org's currency (org.country), not device region.
 *   DA amounts must render with 2 decimals (e.g. 500.00 DA, never 500 DA).
 */

import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme, spacing, fontSize, borderRadius } from '@/lib/theme';

type TicketStatus = 'waiting' | 'called' | 'serving' | 'done' | 'cancelled';

function statusLabel(status: TicketStatus, t: (key: string) => string): string {
  const map: Record<TicketStatus, string> = {
    waiting: t('queue.status_waiting'),
    called: t('queue.status_called'),
    serving: t('queue.status_serving'),
    done: t('queue.status_done'),
    cancelled: t('queue.status_cancelled'),
  };
  return map[status] ?? status;
}

export default function QueueStatusScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { ticketId } = useLocalSearchParams<{ ticketId: string }>();

  // TODO(mobile-sprint-2): Replace stub state with real Supabase query
  // Cast through string so TypeScript doesn't collapse the literal type and
  // flag comparisons against other members of TicketStatus as unreachable.
  const stubStatus = 'waiting' as TicketStatus;
  const stubPosition = 3;
  const stubWaitMin = 12;
  const isOfflineCached = false; // TODO: detect via expo-network

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
          paddingTop: insets.top + spacing.md,
          paddingBottom: insets.bottom + spacing.md,
        },
      ]}
    >
      {/* Offline cache banner */}
      {isOfflineCached && (
        <View
          style={[styles.offlineBanner, { backgroundColor: colors.warningLight }]}
          accessibilityRole="alert"
        >
          <Text style={[styles.offlineBannerText, { color: colors.warning }]}>
            {t('queue.offlineCached', { time: 'a moment ago' })}
          </Text>
        </View>
      )}

      {/* Ticket card */}
      <View
        style={[
          styles.card,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
        accessibilityRole="summary"
        accessibilityLabel={`Ticket ${ticketId}, ${statusLabel(stubStatus, t)}`}
      >
        <Text style={[styles.cardLabel, { color: colors.textSecondary }]}>
          {t('queue.yourTicket')}
        </Text>

        <Text style={[styles.ticketId, { color: colors.text }]}>
          #{ticketId ?? '---'}
        </Text>

        <Text
          style={[
            styles.status,
            { color: stubStatus === 'called' ? colors.called : colors.primary },
          ]}
        >
          {statusLabel(stubStatus, t)}
        </Text>

        <View style={styles.meta}>
          <Text style={[styles.metaItem, { color: colors.textSecondary }]}>
            {t('queue.position', { pos: stubPosition })}
          </Text>
          <Text style={[styles.metaItem, { color: colors.textSecondary }]}>
            {t('queue.estimatedWait', { min: stubWaitMin })}
          </Text>
        </View>
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.secondaryButton, { borderColor: colors.border }]}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <Text style={[styles.secondaryButtonText, { color: colors.text }]}>
            {t('common.back')}
          </Text>
        </TouchableOpacity>
      </View>

      {/*
        TODO(mobile-sprint-2):
        - Subscribe to realtime updates: supabase.channel('ticket-<ticketId>')
            .on('postgres_changes', { event: 'UPDATE', table: 'tickets', filter: `id=eq.${ticketId}` }, ...)
        - Display a pulsing animation when status === 'called'
        - Cache ticket state to AsyncStorage for offline recovery
        - Show share button so user can share their position in WhatsApp
      */}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  offlineBanner: {
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
  },
  offlineBannerText: {
    fontSize: fontSize.sm,
    textAlign: 'center',
    fontWeight: '500',
  },
  card: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  cardLabel: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  ticketId: {
    fontSize: fontSize.hero,
    fontWeight: '800',
    letterSpacing: -2,
  },
  status: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    textAlign: 'center',
  },
  meta: {
    gap: spacing.xs,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  metaItem: {
    fontSize: fontSize.md,
  },
  actions: {
    marginTop: spacing.xl,
    gap: spacing.md,
  },
  secondaryButton: {
    height: 52,
    minHeight: 44,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: fontSize.md,
    fontWeight: '600',
  },
});
