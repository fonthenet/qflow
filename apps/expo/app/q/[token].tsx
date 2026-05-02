import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';

/**
 * Deeplink landing for the canonical customer tracking URL
 * `qflo.net/q/<token>` (the QR + WhatsApp share format). The
 * universal-link / app-link config (apps/expo/app.json + the
 * apple-app-site-association) routes /q/* into the installed app,
 * so this route MUST exist to avoid an "Unmatched Route" screen.
 *
 * The native screen for this is `ticket/[token]` (delivery /
 * dine-in / takeout — fetches the ticket, sets the active tab,
 * registers for push, hands off to the Active tab). We just
 * forward there so we don't maintain two copies of the same flow.
 */
export default function QDeepLink() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();

  useEffect(() => {
    if (!token) {
      router.replace('/(tabs)' as any);
      return;
    }
    router.replace({ pathname: '/ticket/[token]' as any, params: { token: String(token) } });
  }, [token, router]);

  return (
    <View style={s.center}>
      <Stack.Screen options={{ headerShown: false }} />
      <ActivityIndicator size="large" />
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
