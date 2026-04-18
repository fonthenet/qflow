import { useEffect, useRef } from 'react';
import { Platform, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter, useSegments, useNavigation } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { useTranslation } from 'react-i18next';
import '@/lib/i18n'; // initialise i18n
import { isRTL } from '@/lib/i18n';

// ── Global RTL text defaults ────────────────────────────────────────
// Sets writingDirection on ALL Text & TextInput so Arabic renders
// with proper shaping (smooth glyphs) and correct alignment.
const origTextRender = (Text as any).render;
if (origTextRender) {
  (Text as any).render = function (props: any, ref: any) {
    const rtl = isRTL();
    return origTextRender.call(this, {
      ...props,
      style: [
        rtl ? { writingDirection: 'rtl', textAlign: 'right' } : { writingDirection: 'ltr' },
        props.style,
      ],
    }, ref);
  };
}
const origInputRender = (TextInput as any).render;
if (origInputRender) {
  (TextInput as any).render = function (props: any, ref: any) {
    const rtl = isRTL();
    return origInputRender.call(this, {
      ...props,
      style: [
        rtl ? { writingDirection: 'rtl', textAlign: 'right' } : { writingDirection: 'ltr' },
        props.style,
      ],
    }, ref);
  };
}
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme';
import { useAppStore } from '@/lib/store';
import { useLocalConnectionStore } from '@/lib/local-connection-store';
import {
  setupAndroidChannels,
  addNotificationResponseListener,
  getQrTokenFromData,
} from '@/lib/notifications';

/**
 * A Back button that never leaves the user stranded.
 *
 * The default iOS/Android Stack back button relies on `canGoBack()`, which
 * returns false when the user landed on the screen via:
 *   - a deep link (qflo://...)
 *   - a notification tap that navigated directly
 *   - a fresh app launch that redirected into this screen
 *
 * In those cases the native button renders but does nothing on tap — which
 * is exactly the "sometimes it works, sometimes it doesn't" bug. This
 * component gracefully falls back to a known-safe route.
 */
function SafeBackButton({ fallback, label }: { fallback: string; label: string }) {
  const router = useRouter();
  const navigation = useNavigation();
  const onPress = () => {
    if (navigation.canGoBack()) {
      router.back();
    } else {
      router.replace(fallback as any);
    }
  };
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      hitSlop={12}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        marginLeft: Platform.OS === 'ios' ? 0 : 8,
        paddingHorizontal: 6,
        paddingVertical: 4,
      }}
    >
      <Ionicons name="chevron-back" size={22} color="#fff" />
      <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>{label}</Text>
    </TouchableOpacity>
  );
}

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

    const currentGroup = segments[0] as string | undefined;
    const inProSection = currentGroup === '(admin)' || currentGroup === '(operator)';
    const inCustomerSection = currentGroup === '(tabs)' || !currentGroup;
    const inJoinFlow = currentGroup === 'join' || currentGroup === 'ticket';

    // ── Local mode takes over: always stay in operator ──
    const localState = useLocalConnectionStore.getState();
    const isLocalMode = localState.mode === 'local';
    if (isLocalMode && currentGroup && currentGroup !== '(operator)' && !inJoinFlow) {
      router.replace('/(operator)/desk');
      return;
    }

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
    // EXCEPT when in local mode (no Supabase auth needed)
    if (!user && inProSection && !isLocalMode) {
      hasRedirected.current = false;
      router.replace('/(tabs)');
      return;
    }

    // Reset flag when user changes
    if (!user) {
      hasRedirected.current = false;
    }
  }, [isLoading, user, isStaff, staffRole, segments]);

  // ---- Local mode health monitor -----------------------------------------
  const localMode = useLocalConnectionStore((s) => s.mode);
  const startHealthMonitor = useLocalConnectionStore((s) => s.startHealthMonitor);

  useEffect(() => {
    if (localMode !== 'local') return;
    const cleanup = startHealthMonitor();
    return cleanup;
  }, [localMode]);

  // ---- Wait-alert background polling (runs while app is active) ---------
  useEffect(() => {
    // Lazy-import so the polling module doesn't drag its deps into the
    // critical-path bundle.
    let stop: (() => void) | null = null;
    (async () => {
      const { startWaitAlerts } = await import('@/lib/wait-alerts');
      stop = startWaitAlerts();
    })();
    return () => {
      stop?.();
    };
  }, []);

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
  const { t } = useTranslation();

  const rtl = isRTL();

  return (
    <View style={{ flex: 1, direction: rtl ? 'rtl' : 'ltr' }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          headerBackTitle: t('common.back'),
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
            title: t('admin.bookings'),
            headerStyle: { backgroundColor: colors.primary },
            headerTintColor: '#fff',
            // Custom Back button with a guaranteed fallback destination.
            // The default Stack back button silently does nothing when
            // `canGoBack()` is false (fresh launch / deep link entry).
            headerLeft: () => <SafeBackButton fallback="/(admin)" label={t('common.back')} />,
          }}
        />
        <Stack.Screen
          name="admin/virtual-codes"
          options={{
            title: t('virtualCodes.title'),
            headerStyle: { backgroundColor: colors.primary },
            headerTintColor: '#fff',
            headerLeft: () => <SafeBackButton fallback="/(admin)" label={t('common.back')} />,
          }}
        />
        <Stack.Screen
          name="ticket/[token]"
          options={{
            title: t('tabs.queue'),
            headerBackTitle: t('common.back'),
            presentation: 'modal',
          }}
        />
        <Stack.Screen
          name="join/[token]"
          options={{
            title: t('scan.join'),
            headerBackTitle: t('common.back'),
            presentation: 'modal',
          }}
        />
        <Stack.Screen name="kiosk/[slug]" options={{ title: 'Kiosk', headerShown: false }} />
        <Stack.Screen name="queue-peek/[slug]" options={{ headerShown: false }} />
        <Stack.Screen name="book-appointment/[slug]" options={{ headerShown: false }} />
        <Stack.Screen name="appointments/index" options={{ headerShown: false }} />
      </Stack>
    </View>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootNavigator />
    </AuthProvider>
  );
}
