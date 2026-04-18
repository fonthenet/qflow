import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { borderRadius, fontSize, spacing, useTheme } from '@/lib/theme';
import { visitStatusColors, type VisitStatus } from '@/lib/visit';

export interface StatusPillProps {
  status: VisitStatus | string | null | undefined;
  /** Optional override label. Falls back to `status.<status>` i18n key. */
  label?: string;
  size?: 'sm' | 'md';
}

/**
 * Shared pill for any Visit status (ticket or appointment).
 * Centralizes the status → color mapping so list rows, headers,
 * and detail screens never drift out of sync.
 */
export function StatusPill({ status, label, size = 'md' }: StatusPillProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();

  const { fg, bg } = visitStatusColors(status, colors);
  const resolvedLabel =
    label ??
    (status ? t(`status.${status}`, { defaultValue: status.replace(/_/g, ' ') }) : '');

  const padH = size === 'sm' ? 8 : spacing.sm;
  const padV = size === 'sm' ? 2 : 4;
  const fs = size === 'sm' ? fontSize.xs : fontSize.sm;

  return (
    <View
      style={[
        styles.pill,
        { backgroundColor: bg, paddingHorizontal: padH, paddingVertical: padV },
      ]}
    >
      <Text
        style={[styles.text, { color: fg, fontSize: fs }]}
        numberOfLines={1}
      >
        {resolvedLabel}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderRadius: borderRadius.full,
    alignSelf: 'flex-start',
  },
  text: {
    fontWeight: '700',
    textTransform: 'capitalize',
  },
});
