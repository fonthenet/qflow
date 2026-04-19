import { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import {
  getFieldLabel,
  getFieldPlaceholder,
  type IntakeField,
} from '@qflo/shared';
import { borderRadius, fontSize, spacing, useTheme } from '@/lib/theme';
import { WILAYAS, formatWilaya, type Wilaya } from '@/lib/wilayas';

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
        const isWilaya = field.key === 'wilaya';
        const isMultiline = field.key === 'reason' || field.key === 'notes';

        return (
          <View key={field.key}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
              {label}
              {field.required ? (
                <Text style={{ color: colors.error }}> *</Text>
              ) : null}
            </Text>
            {isWilaya ? (
              <WilayaPicker
                value={values[field.key] ?? ''}
                onChange={(v) => onChange(field.key, v)}
                placeholder={placeholder}
                locale={locale === 'ar' ? 'ar' : 'fr'}
              />
            ) : (
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
                // Per-field length caps — match the WhatsApp validators in
                // messaging-commands.ts so every surface enforces the same
                // limits. Prevents a paste-bomb into "reason" (or any other
                // free-text field) from reaching the server.
                maxLength={
                  isName ? 100 :
                  isPhone ? 20 :
                  isAge ? 3 :
                  isMultiline ? 200 : 200
                }
              />
            )}
          </View>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Wilaya picker — matches the <select> dropdown used by web/kiosk/booking form
// and the Station desktop app. Tapping opens a modal with a searchable list
// of the 58 Algerian wilayas.
// ---------------------------------------------------------------------------
function WilayaPicker({
  value,
  onChange,
  placeholder,
  locale,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  locale: 'fr' | 'ar';
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();

  const filtered = useMemo(() => {
    const q = norm(query);
    if (!q) return WILAYAS;
    return WILAYAS.filter((w) => {
      if (String(w.code).startsWith(q)) return true;
      if (norm(w.name).includes(q)) return true;
      if (w.name_ar.includes(query.trim())) return true;
      return false;
    });
  }, [query]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  const pick = (w: Wilaya) => {
    onChange(formatWilaya(w, locale));
    close();
  };

  return (
    <>
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => setOpen(true)}
        style={[
          styles.input,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          },
        ]}
      >
        <Text
          style={{
            color: value ? colors.text : colors.textMuted,
            fontSize: fontSize.md,
            flex: 1,
          }}
          numberOfLines={1}
        >
          {value || placeholder}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={close}
      >
        <Pressable style={styles.modalBackdrop} onPress={close}>
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={[
              styles.modalSheet,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {t('intake.selectWilaya', { defaultValue: 'Select wilaya' })}
              </Text>
              <TouchableOpacity onPress={close} hitSlop={10}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('common.search', { defaultValue: 'Search' })}
              placeholderTextColor={colors.textMuted}
              style={[
                styles.searchInput,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                  color: colors.text,
                },
              ]}
              autoCorrect={false}
              autoCapitalize="none"
            />

            <FlatList
              data={filtered}
              keyExtractor={(w) => String(w.code)}
              keyboardShouldPersistTaps="handled"
              initialNumToRender={20}
              renderItem={({ item }) => {
                const label = formatWilaya(item, locale);
                const selected = value === label;
                return (
                  <TouchableOpacity
                    onPress={() => pick(item)}
                    style={[
                      styles.row,
                      { borderBottomColor: colors.borderLight },
                      selected && { backgroundColor: colors.primary + '15' },
                    ]}
                    activeOpacity={0.6}
                  >
                    <Text style={{ color: colors.text, fontSize: fontSize.md, flex: 1 }}>
                      {label}
                    </Text>
                    {selected && (
                      <Ionicons name="checkmark" size={18} color={colors.primary} />
                    )}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <Text
                  style={{
                    color: colors.textMuted,
                    textAlign: 'center',
                    padding: spacing.lg,
                  }}
                >
                  {t('common.noResults', { defaultValue: 'No results' })}
                </Text>
              }
            />
          </Pressable>
        </Pressable>
      </Modal>
    </>
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    maxHeight: '80%',
    minHeight: '55%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  modalTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  searchInput: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: fontSize.md,
    marginBottom: spacing.sm,
  },
  row: {
    paddingVertical: 14,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
  },
});
