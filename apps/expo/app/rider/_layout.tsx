/**
 * Rider section layout — wraps every /rider/* route in the auth
 * provider. Login/verify screens render on top of a logged-out state;
 * home + history + settings render only when authenticated.
 *
 * The per-ticket deeplink screen ([id]/[token]) is the one exception:
 * it works WITHOUT login because the HMAC token is its own auth
 * (legacy WhatsApp-handoff flow). That screen falls inside this
 * layout but renders unconditionally — see how RiderAuthGate handles
 * the deeplink path.
 */

import { Stack } from 'expo-router';
import { RiderAuthProvider } from '@/lib/rider-auth';

export default function RiderLayout() {
  return (
    <RiderAuthProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="verify" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="change-phone" />
        <Stack.Screen name="history" />
        {/* Per-ticket deeplink screen — auth via HMAC token in URL,
            not session. Stays outside the gate. */}
        <Stack.Screen name="[id]/[token]" />
      </Stack>
    </RiderAuthProvider>
  );
}
