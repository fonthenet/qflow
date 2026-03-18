import { Stack } from 'expo-router';
import { colors } from '@/lib/theme';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        headerBackTitle: 'Back',
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="login" options={{ title: 'Staff Login', headerBackTitle: 'Back' }} />
      <Stack.Screen name="role-select" options={{ title: 'Select Station', headerBackTitle: 'Back' }} />
    </Stack>
  );
}
