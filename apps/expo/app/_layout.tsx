import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme';
import { useAppStore } from '@/lib/store';
import {
  setupAndroidChannels,
  addNotificationResponseListener,
  getQrTokenFromData,
} from '@/lib/notifications';

function RootNavigator() {
  const router = useRouter();
  const segments = useSegments();
  const { user, isLoading, isStaff, staffRole } = useAuth();
  const hasRedirected = useRef(false);

  useEffect(() => {
    if (isLoading) return;

    // On web, the Expo app is the customer-facing app only.
    // The admin dashboard is the separate Next.js app — never redirect to it.
    if (Platform.OS === 'web') return;

    // Only auto-redirect once on app start / auth change
    // Don't redirect if user is already in a pro section or deliberately navigated
    const currentGroup = segments[0] as string | undefined;
    const inProSection = currentGroup === '(admin)' || currentGroup === '(operator)' || currentGroup === '(auth)';
    const inCustomerSection = currentGroup === '(tabs)' || !currentGroup;
    const inJoinFlow = currentGroup === 'join' || currentGroup === 'ticket';

    // Staff user landed on customer section → redirect to pro
    // But NOT if they're in the join or ticket flow (those are customer-facing)
    if (user && isStaff && inCustomerSection && !inJoinFlow && !hasRedirected.current) {
      hasRedirected.current = true;
      if (staffRole === 'admin' || staffRole === 'manager' || staffRole === 'branch_admin') {
        router.replace('/(admin)');
      } else {
        router.replace('/(auth)/role-select');
      }
      return;
    }

    // Signed out but in pro section → redirect to customer
    if (!user && inProSection) {
      hasRedirected.current = false;
      router.replace('/(tabs)');
      return;
    }

    // Reset flag when user changes
    if (!user) {
      hasRedirected.current = false;
    }
  }, [isLoading, user, isStaff, staffRole, segments]);

  // ---- Push notification setup -------------------------------------------
  useEffect(() => {
    // Create Android channels on app startup (no-op on iOS/web)
    setupAndroidChannels();

    // Handle notification tapped while app is open or in background
    const responseSub = addNotificationResponseListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown> | null;
      const qrToken = getQrTokenFromData(data);
      if (qrToken) {
        useAppStore.getState().setActiveToken(qrToken);
        router.push('/(tabs)' as any);
      }
    });

    // Handle notification that cold-started the app (killed state)
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const data = response.notification.request.content.data as Record<string, unknown> | null;
      const qrToken = getQrTokenFromData(data);
      if (qrToken) {
        useAppStore.getState().setActiveToken(qrToken);
        router.push('/(tabs)' as any);
      }
    });

    return () => {
      responseSub.remove();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { colors, isDark } = useTheme();

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(operator)" options={{ headerShown: false }} />
        <Stack.Screen name="(admin)" options={{ headerShown: false }} />
        <Stack.Screen
          name="admin/bookings"
          options={{
            title: 'Bookings',
            headerStyle: { backgroundColor: colors.primary },
            headerTintColor: '#fff',
          }}
        />
        <Stack.Screen
          name="admin/virtual-codes"
          options={{
            title: 'Virtual Codes',
            headerStyle: { backgroundColor: colors.primary },
            headerTintColor: '#fff',
          }}
        />
        <Stack.Screen
          name="ticket/[token]"
          options={{
            title: 'Your Ticket',
            presentation: 'modal',
          }}
        />
        <Stack.Screen
          name="join/[token]"
          options={{
            title: 'Join Queue',
            presentation: 'modal',
          }}
        />
        <Stack.Screen name="kiosk/[slug]" options={{ title: 'Kiosk', headerShown: false }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootNavigator />
    </AuthProvider>
  );
}
