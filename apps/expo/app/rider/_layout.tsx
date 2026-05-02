/**
 * Rider section layout — Stack only. RiderAuthProvider is now at the
 * app root (apps/expo/app/_layout.tsx) so customer-facing tabs can
 * read the rider session too (e.g. for the "signed in as driver"
 * indicator on the Profile tab).
 *
 * The per-ticket deeplink screen ([id]/[token]) renders without a
 * session — its HMAC token in the URL is its own auth.
 */

import { Stack } from 'expo-router';

export default function RiderLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="login" />
      <Stack.Screen name="verify" />
      <Stack.Screen name="settings" />
      <Stack.Screen name="edit-profile" />
      <Stack.Screen name="change-phone" />
      <Stack.Screen name="history" />
      <Stack.Screen name="[id]/[token]" />
    </Stack>
  );
}
