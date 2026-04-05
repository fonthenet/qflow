import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, borderRadius, fontSize, spacing } from '@/lib/theme';

const STATUS_CONFIG: Record<string, { labelKey: string; color: string; bg: string }> = {
  waiting: { labelKey: 'status.waiting', color: colors.waiting, bg: colors.waitingBg },
  called: { labelKey: 'status.called', color: colors.called, bg: colors.calledBg },
  serving: { labelKey: 'status.serving', color: colors.serving, bg: colors.servingBg },
  served: { labelKey: 'status.served', color: colors.done, bg: colors.doneBg },
  no_show: { labelKey: 'status.noShow', color: colors.error, bg: colors.errorLight },
  cancelled: { labelKey: 'status.cancelled', color: colors.done, bg: colors.doneBg },
  transferred: { labelKey: 'status.transferred', color: colors.info, bg: colors.infoLight },
};

interface Props {
  status: string;
}

export function TicketStatusBadge({ status }: Props) {
  const { t } = useTranslation();
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.waiting;

  return (
    <View style={[styles.badge, { backgroundColor: config.bg }]}>
      <View style={[styles.dot, { backgroundColor: config.color }]} />
      <Text style={[styles.label, { color: config.color }]}>{t(config.labelKey)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.xs + 2,
    borderRadius: borderRadius.full,
    gap: spacing.xs + 2,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
});
