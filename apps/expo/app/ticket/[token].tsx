import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/lib/store';
import { fetchTicket } from '@/lib/api';
import { registerForPush } from '@/lib/notifications';
import { isTerminal } from '@/lib/visit';
import { fontSize, spacing, useTheme } from '@/lib/theme';

/**
 * Deep-link landing for a ticket (QR scan, share link, history card tap).
 * Behavior:
 *   1. Fetch the ticket by qr_token.
 *   2. If it's live (waiting/called/serving), promote to the Active tab
 *      and register push. The Active tab's polling + recovery takes over.
 *   3. If it's terminal, route to Activity so the customer sees it in context.
 *
 * This replaces the old full-screen ticket view — that UI is now the
 * Active tab, so there's no reason to render a second copy here.
 */
export default function TicketDeepLink() {
  const { t } = useTranslation();
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const setActiveToken = useAppStore((s) => s.setActiveToken);
  const setActiveTicket = useAppStore((s) => s.setActiveTicket);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) return;
      const data = await fetchTicket(token);
      if (cancelled) return;
      if (!data) {
        router.replace('/(tabs)/history');
        return;
      }
      if (isTerminal(data.status)) {
        router.replace('/(tabs)/history');
        return;
      }
      setActiveToken(token);
      setActiveTicket(data);
      // Fire-and-forget — push permissions may or may not resolve.
      registerForPush(data.id, token).catch(() => {});
      router.replace('/(tabs)');
    })();
    return () => {
      cancelled = true;
    };
  }, [token, router, setActiveToken, setActiveTicket]);

  return (
    <View style={[styles.center, { backgroundColor: colors.background }]}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={[styles.text, { color: colors.textSecondary }]}>
        {t('ticketView.loadingTicket', { defaultValue: 'Loading ticket…' })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
  },
  text: {
    fontSize: fontSize.md,
  },
});
