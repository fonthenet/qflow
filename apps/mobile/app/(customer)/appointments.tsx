/**
 * Appointments screen — lists the customer's upcoming and past appointments.
 *
 * Data contract:
 *   - Fetches from Supabase table `bookings` filtered by customer phone / user_id
 *   - Falls back to AsyncStorage cache (last 10 bookings) when offline
 *   - Booking details follow org.country for currency display (not device region)
 *
 * TODO(mobile-sprint-2): Implement real data fetching.
 *   The server-side booking schema is in apps/web. Auth is either:
 *   (a) anonymous with a `calendarToken` (per-booking access token issued by the server)
 *   (b) Supabase authenticated session (when the user signs in via magic link)
 *
 * TODO(mobile-sprint-2): Implement offline cache:
 *   - Store last 10 bookings in AsyncStorage keyed by 'qflo_bookings_cache'
 *   - Show "last updated <time>" banner when network unavailable
 *
 * TODO(mobile-sprint-2): Add "Book new appointment" CTA that deep-links to
 *   the web booking flow at https://qflo.net/book/<slug> (Linking.openURL)
 *   until a native booking screen is built in sprint 3.
 *
 * TODO(i18n-specialist): Appointment dates must be formatted in the org's
 *   timezone (org.timezone), not the device timezone, and labelled with the
 *   ticket's locale strings.
 */

import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme, spacing, fontSize, borderRadius } from '@/lib/theme';

// Stub appointment type — mirrors the bookings table shape
// TODO: import from @qflo/shared when the type is extracted there
interface AppointmentStub {
  id: string;
  orgName: string;
  serviceName: string;
  dateIso: string;
  status: 'confirmed' | 'completed' | 'cancelled';
}

// Empty stub array — replace with Supabase query result
const STUB_APPOINTMENTS: AppointmentStub[] = [];

export default function AppointmentsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.container,
        { paddingBottom: insets.bottom + spacing.xl },
      ]}
    >
      {STUB_APPOINTMENTS.length === 0 ? (
        <View style={styles.emptyState} accessibilityRole="text">
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            {t('appointments.empty')}
          </Text>
          <TouchableOpacity
            style={[styles.ctaButton, { backgroundColor: colors.primary }]}
            onPress={() => {
              // TODO(mobile-sprint-2): deep-link to web booking or native screen
              router.push('/(customer)/scan');
            }}
            accessibilityRole="button"
            accessibilityLabel={t('appointments.bookNew')}
          >
            <Text style={styles.ctaButtonText}>{t('appointments.bookNew')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        STUB_APPOINTMENTS.map((appt) => (
          <View
            key={appt.id}
            style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
            accessibilityRole="button"
          >
            <Text style={[styles.orgName, { color: colors.text }]}>
              {appt.orgName}
            </Text>
            <Text style={[styles.serviceName, { color: colors.textSecondary }]}>
              {appt.serviceName}
            </Text>
            <Text style={[styles.date, { color: colors.textMuted }]}>
              {appt.dateIso}
            </Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: spacing.xxl * 2,
    gap: spacing.lg,
  },
  emptyTitle: {
    fontSize: fontSize.lg,
    fontWeight: '500',
    textAlign: 'center',
  },
  ctaButton: {
    height: 52,
    minHeight: 44,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ctaButtonText: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: '#fff',
  },
  card: {
    borderRadius: borderRadius.md,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.xs,
  },
  orgName: {
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  serviceName: {
    fontSize: fontSize.sm,
  },
  date: {
    fontSize: fontSize.sm,
  },
});
