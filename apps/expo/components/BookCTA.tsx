import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { borderRadius, fontSize, spacing, useTheme } from '@/lib/theme';

export interface BookCTAProps {
  /** Kiosk slug used to route to /book-appointment/[slug] */
  slug: string | null | undefined;
  /** Org booking mode — hides the CTA when 'disabled' or missing. */
  bookingMode?: string | null;
  /** 'primary' fills with brand color; 'outline' is a bordered ghost. */
  variant?: 'primary' | 'outline';
  /** Optional override label */
  label?: string;
  /**
   * Optional second-line hint under the main label — used on queue-peek
   * to distinguish "Book for later" from "Get a ticket now". Omit to keep
   * the compact single-line variant used in Places / place detail.
   */
  subtitle?: string;
  style?: any;
}

/**
 * Single source of truth for the "Book for later" CTA across the app
 * (Places, queue-peek, kiosk-info, place detail). Hides itself when the
 * org has booking disabled or the slug is unknown.
 */
export function BookCTA({
  slug,
  bookingMode,
  variant = 'outline',
  label,
  subtitle,
  style,
}: BookCTAProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();

  if (!slug) return null;
  if (bookingMode === 'disabled') return null;

  const isPrimary = variant === 'primary';
  const bg = isPrimary ? colors.primary : 'transparent';
  const fg = isPrimary ? '#fff' : colors.primary;
  const border = isPrimary ? 'transparent' : colors.border;
  const subFg = isPrimary ? 'rgba(255,255,255,0.8)' : colors.textSecondary;

  return (
    <TouchableOpacity
      onPress={() => router.push(`/book-appointment/${slug}` as any)}
      activeOpacity={0.8}
      style={[
        styles.btn,
        { backgroundColor: bg, borderColor: border, borderWidth: isPrimary ? 0 : 1.5 },
        subtitle ? styles.btnStacked : null,
        style,
      ]}
    >
      <Ionicons name="calendar-outline" size={18} color={fg} />
      <View style={subtitle ? styles.labelCol : undefined}>
        <Text style={[styles.text, { color: fg }]}>
          {label ?? t('queuePeek.bookForLater', { defaultValue: 'Book for later' })}
        </Text>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: subFg }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
  },
  btnStacked: {
    paddingVertical: spacing.md - 2,
  },
  labelCol: {
    alignItems: 'center',
  },
  text: {
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: fontSize.xs,
    fontWeight: '500',
    marginTop: 1,
  },
});
