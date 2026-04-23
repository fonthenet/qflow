/**
 * OfflineBanner — displays a "last updated" notice when the network is down.
 *
 * Mount this at the top of any screen that shows cached data.
 * The banner is hidden when the device is online.
 *
 * TODO(mobile-sprint-2): subscribe to network state changes so the banner
 *   appears / disappears reactively without a polling interval.
 */

import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme, spacing, fontSize, borderRadius } from '@/lib/theme';

interface Props {
  lastUpdated?: string; // human-readable time string, e.g. "2 minutes ago"
  visible: boolean;
}

export function OfflineBanner({ lastUpdated, visible }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();

  if (!visible) return null;

  return (
    <View
      style={[styles.banner, { backgroundColor: colors.warningLight }]}
      accessibilityRole="alert"
      accessibilityLabel={
        lastUpdated
          ? t('common.lastUpdated', { time: lastUpdated })
          : t('landing.offlineBanner')
      }
    >
      <Text style={[styles.text, { color: colors.warning }]}>
        {lastUpdated
          ? t('common.lastUpdated', { time: lastUpdated })
          : t('landing.offlineBanner')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderRadius: borderRadius.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  text: {
    fontSize: fontSize.sm,
    fontWeight: '500',
    textAlign: 'center',
  },
});
