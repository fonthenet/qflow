/**
 * (customer) route group layout — Stack-based navigation.
 *
 * Screens in this group:
 *   scan         — QR scanner (full-screen, no header)
 *   queue/[ticketId] — live ticket status
 *   appointments — list of upcoming / past bookings
 *   profile      — settings, language, biometric, notifications
 *
 * Navigation pattern: the root landing screen (app/index.tsx) acts as the
 * customer home and starts the scan flow. Stack navigation is used rather
 * than a tab bar so the scan screen can be presented full-screen without
 * a persistent tab bar covering the camera view.
 *
 * TODO(mobile-sprint-2): Consider switching to a Tabs layout once the ticket
 *   status screen has a stable non-dynamic entry point (e.g. "My Ticket" tab
 *   that reads the active ticketId from the global store rather than route params).
 *
 * TODO(accessibility-auditor): Verify that the back button in each header meets
 *   the 44x44pt minimum tap target on both platforms.
 */

import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/lib/theme';

export default function CustomerLayout() {
  const { t } = useTranslation();
  const { colors } = useTheme();

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.background },
        headerBackTitle: t('common.back'),
      }}
    >
      <Stack.Screen
        name="scan"
        options={{
          headerShown: false, // full-screen camera view
          presentation: 'fullScreenModal',
        }}
      />
      <Stack.Screen
        name="queue/[ticketId]"
        options={{
          title: t('queue.yourTicket'),
          headerBackTitle: t('common.back'),
        }}
      />
      <Stack.Screen
        name="appointments"
        options={{ title: t('appointments.title') }}
      />
      <Stack.Screen
        name="profile"
        options={{ title: t('profile.title') }}
      />
    </Stack>
  );
}
