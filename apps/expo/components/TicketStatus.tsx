import { StyleSheet, Text, View } from 'react-native';
import { colors, borderRadius, fontSize, spacing } from '@/lib/theme';

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  waiting: { label: 'Waiting', color: colors.waiting, bg: colors.waitingBg },
  called: { label: 'Called', color: colors.called, bg: colors.calledBg },
  serving: { label: 'Serving', color: colors.serving, bg: colors.servingBg },
  served: { label: 'Served', color: colors.done, bg: colors.doneBg },
  no_show: { label: 'No Show', color: colors.error, bg: colors.errorLight },
  cancelled: { label: 'Cancelled', color: colors.done, bg: colors.doneBg },
  transferred: { label: 'Transferred', color: colors.info, bg: colors.infoLight },
};

interface Props {
  status: string;
}

export function TicketStatusBadge({ status }: Props) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.waiting;

  return (
    <View style={[styles.badge, { backgroundColor: config.bg }]}>
      <View style={[styles.dot, { backgroundColor: config.color }]} />
      <Text style={[styles.label, { color: config.color }]}>{config.label}</Text>
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
