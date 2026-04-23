/**
 * Root layout for the Qflo customer mobile app.
 *
 * Responsibilities:
 *   - Initialises i18n (must happen before any screen renders)
 *   - Applies RTL direction wrapper
 *   - Sets up the Stack navigator with theme-aware header styles
 *   - Wires deep links via useDeepLink
 *   - Defers splash screen until fonts are ready
 *
 * TODO(mobile-sprint-2): Add Supabase session observer here so the Profile
 *   screen can reflect signed-in state without a full re-mount.
 */

import { useEffect } from 'react';
import { Platform, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import '@/lib/i18n'; // initialise i18n before any screen
import { isRTL } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { useDeepLink } from '@/hooks/useDeepLink';

// Keep the splash screen visible until we signal readiness
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const { colors, isDark } = useTheme();
  const router = useRouter();
  const rtl = isRTL();

  // Hide splash once layout is mounted (fonts loaded via expo-font plugin)
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  // Wire incoming deep links to navigation
  useDeepLink({
    onJoin: (joinCode) => {
      // Navigate to the scan screen with the pre-filled code
      // so the user lands in context rather than on a blank screen.
      router.push({
        pathname: '/(customer)/scan',
        params: { code: joinCode },
      });
    },
    onTicket: (ticketToken) => {
      router.push({
        pathname: '/(customer)/queue/[ticketId]',
        params: { ticketId: ticketToken },
      });
    },
  });

  return (
    // direction prop ensures the entire navigator tree respects RTL
    <View style={{ flex: 1, direction: rtl ? 'rtl' : 'ltr' }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
          // Minimum 44pt back-button tap target enforced by headerBackVisible
          headerBackVisible: true,
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(customer)" options={{ headerShown: false }} />
      </Stack>
    </View>
  );
}
