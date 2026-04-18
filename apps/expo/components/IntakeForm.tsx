import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  getFieldLabel,
  getFieldPlaceholder,
  type IntakeField,
} from '@qflo/shared';
import { borderRadius, fontSize, spacing, useTheme } from '@/lib/theme';

export type IntakeValues = Record<string, string>;

export interface IntakeFormProps {
  fields: IntakeField[];
  values: IntakeValues;
  onChange: (key: string, value: string) => void;
  /** When true, the first field receives autoFocus. Default false — suits
   *  inline use; the wizard variant in book-appointment sets it true. */
  autoFocusFirst?: boolean;
  /** Optional header copy. Pass null to omit. Default: none. */
  title?: string | null;
  subtitle?: string | null;
}

/**
 * Single source of truth for rendering dynamic intake fields on mobile.
 * Reads the enabled/required config that came from the shared
 * `getEnabledIntakeFields(settings)` helper. Walk-in join and future
 * booking both mount this.
 */
export function IntakeForm({
  fields,
  values,
  onChange,
  autoFocusFirst = false,
  title,
  subtitle,
}: IntakeFormProps) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const locale: 'en' | 'fr' | 'ar' =
    i18n.language === 'ar' ? 'ar' : i18n.language === 'fr' ? 'fr' : 'en';

  if (fields.length === 0) return null;

  return (
    <View>
      {title !== null && (
        <Text style={[styles.title, { color: colors.text }]}>
          {title ?? t('join.yourDetails', { defaultValue: 'Your details' })}
        </Text>
      )}
      {subtitle !== null && subtitle !== undefined && (
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {subtitle}
        </Text>
      )}

      {fields.map((field, idx) => {
        const label = getFieldLabel(field, locale);
        const placeholder = getFieldPlaceholder(field, locale) || label;
        const isPhone = field.key === 'phone';
        const isAge = field.key === 'age';
        const isName = field.key === 'name';
        const isMultiline = field.key === 'reason' || field.key === 'notes';

        return (
          <View key={field.key}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
              {label}
              {field.required ? (
                <Text style={{ color: colors.error }}> *</Text>
              ) : null}
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  color: colors.text,
                },
                isMultiline && { minHeight: 72, textAlignVertical: 'top' },
              ]}
              value={values[field.key] ?? ''}
              onChangeText={(v) => onChange(field.key, v)}
              placeholder={placeholder}
              placeholderTextColor={colors.textMuted}
              keyboardType={
                isPhone ? 'phone-pad' : isAge ? 'number-pad' : 'default'
              }
              autoCapitalize={
                isName ? 'words' : isMultiline ? 'sentences' : 'none'
              }
              autoCorrect={false}
              multiline={isMultiline}
              numberOfLines={isMultiline ? 3 : 1}
              autoFocus={autoFocusFirst && idx === 0}
              returnKeyType={idx === fields.length - 1 ? 'done' : 'next'}
            />
          </View>
        );
      })}
    </View>
  );
}

/** Utility used by callers — returns true when any required field is empty
 *  after trimming. Kept here so screens don't re-derive it. */
export function hasMissingRequired(
  fields: IntakeField[],
  values: IntakeValues,
): boolean {
  return fields.some(
    (f) => f.required && !(values[f.key] ?? '').trim(),
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: fontSize.sm,
    marginBottom: spacing.md,
  },
  fieldLabel: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    marginTop: spacing.md,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: fontSize.md,
  },
});
