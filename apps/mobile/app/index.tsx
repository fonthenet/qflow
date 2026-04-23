/**
 * Landing screen — the first screen a new user sees.
 *
 * Responsibilities:
 *   - Value proposition copy (join queues, book appointments)
 *   - CTA to scan a QR code → /(customer)/scan
 *   - Offline banner when network is unavailable
 *
 * TODO(mobile-sprint-2): Check AsyncStorage for cached bookings. If found,
 *   redirect returning users directly to /(customer)/appointments so they
 *   can see their history without re-scanning.
 *
 * TODO(mobile-sprint-2): Add an illustrated hero asset (Lottie or static PNG)
 *   to the assets/ folder. Co-ordinate with qflo-marketing-writer for copy
 *   and qflo-accessibility-auditor for contrast + VoiceOver labels.
 *
 * Parity note: business logic (joining queues, booking) lives in Supabase edge
 *   functions consumed by apps/web. This screen is a thin entry point only.
 */

import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Network from 'expo-network';
import { useTranslation } from 'react-i18next';
import { useTheme, spacing, fontSize, borderRadius } from '@/lib/theme';

export default function LandingScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    // Check network state on mount and on a short interval.
    // expo-network doesn't support event subscription, so we poll lightly.
    // TODO(mobile-sprint-2): Replace with a more reactive approach if needed
    //   (e.g. AppState change listener to re-check when app comes to foreground).
    let cancelled = false;

    async function check() {
      const state = await Network.getNetworkStateAsync();
      if (!cancelled) {
        setIsOffline(state.isConnected === false);
      }
    }

    check();
    const interval = setInterval(check, 10_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const handleScan = () => {
    router.push('/(customer)/scan');
  };

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background, paddingTop: insets.top + spacing.xl },
      ]}
    >
      {/* Offline banner */}
      {isOffline && (
        <View
          style={[styles.offlineBanner, { backgroundColor: colors.warningLight }]}
          accessibilityRole="alert"
          accessibilityLabel={t('landing.offlineBanner')}
        >
          <Text style={[styles.offlineBannerText, { color: colors.warning }]}>
            {t('landing.offlineBanner')}
          </Text>
        </View>
      )}

      {/* Hero section */}
      <View style={styles.hero}>
        {/* Placeholder for app icon / illustration */}
        <View
          style={[styles.iconPlaceholder, { backgroundColor: colors.primaryDark }]}
          accessible
          accessibilityLabel="Qflo app logo"
        >
          <Text style={styles.iconPlaceholderText}>Q</Text>
        </View>

        <Text
          style={[styles.title, { color: colors.text }]}
          accessibilityRole="header"
        >
          {t('landing.title')}
        </Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {t('landing.subtitle')}
        </Text>
      </View>

      {/* Primary CTA */}
      <View style={[styles.actions, { paddingBottom: insets.bottom + spacing.xl }]}>
        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: colors.primary }]}
          onPress={handleScan}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={t('landing.scanCta')}
          // Minimum 44pt tap target enforced by minHeight below
        >
          <Text style={styles.primaryButtonText}>{t('landing.scanCta')}</Text>
        </TouchableOpacity>

        {/* Secondary: view appointments (requires sign-in — stub for now) */}
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => router.push('/(customer)/appointments')}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={t('appointments.title')}
        >
          <Text style={[styles.secondaryButtonText, { color: colors.primary }]}>
            {t('appointments.title')}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  offlineBanner: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
  },
  offlineBannerText: {
    fontSize: fontSize.sm,
    fontWeight: '500',
    textAlign: 'center',
  },
  hero: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  iconPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: borderRadius.xl,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  iconPlaceholderText: {
    fontSize: 48,
    fontWeight: '800',
    color: '#ffffff',
  },
  title: {
    fontSize: fontSize.hero,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: spacing.sm,
    letterSpacing: -1,
  },
  subtitle: {
    fontSize: fontSize.lg,
    textAlign: 'center',
    lineHeight: 26,
  },
  actions: {
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  primaryButton: {
    height: 56, // >= 44pt tap target
    borderRadius: borderRadius.lg,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 44,
  },
  primaryButtonText: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: '#ffffff',
  },
  secondaryButton: {
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 44,
  },
  secondaryButtonText: {
    fontSize: fontSize.md,
    fontWeight: '600',
  },
});
