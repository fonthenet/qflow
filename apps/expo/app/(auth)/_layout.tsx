import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors } from '@/lib/theme';

export default function AuthLayout() {
  const { t } = useTranslation();

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        headerBackTitle: t('common.back'),
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="role-select" options={{ title: t('auth.selectStation'), headerBackTitle: t('common.back') }} />
      <Stack.Screen name="connect-station" options={{ headerShown: false }} />
    </Stack>
  );
}
