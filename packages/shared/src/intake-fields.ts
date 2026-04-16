// ── Unified Intake Fields System ─────────────────────────────────
// Replaces the old `require_name_sameday` + `custom_intake_fields` settings
// with a single ordered, toggleable list of preset + custom fields.

export type IntakeFieldType = 'preset' | 'custom';

export type IntakeFieldScope = 'both' | 'sameday' | 'booking';

export interface IntakeField {
  /** Unique key — preset keys: 'name','phone','age','wilaya','reason'; custom keys: 'custom_<timestamp>' */
  key: string;
  type: IntakeFieldType;
  enabled: boolean;
  required: boolean;
  /** Where this field applies: same-day queue, future booking, or both (default: 'both') */
  scope?: IntakeFieldScope;
  /** Display labels — presets use built-in labels, custom fields set these */
  label?: string;
  label_fr?: string;
  label_ar?: string;
}

export type PresetKey = 'name' | 'phone' | 'age' | 'wilaya' | 'reason';

/** Built-in preset definitions with trilingual labels */
export const INTAKE_PRESETS: Record<PresetKey, { label: string; label_fr: string; label_ar: string; placeholder?: string; placeholder_fr?: string; placeholder_ar?: string }> = {
  name: {
    label: 'Full name',
    label_fr: 'Nom complet',
    label_ar: 'الاسم الكامل',
    placeholder: 'Enter your name',
    placeholder_fr: 'Entrez votre nom',
    placeholder_ar: 'أدخل اسمك',
  },
  phone: {
    label: 'Phone number',
    label_fr: 'Numéro de téléphone',
    label_ar: 'رقم الهاتف',
    placeholder: '0555 123 456',
    placeholder_fr: '0555 123 456',
    placeholder_ar: '0555 123 456',
  },
  age: {
    label: 'Age',
    label_fr: 'Âge',
    label_ar: 'العمر',
    placeholder: 'e.g. 32',
    placeholder_fr: 'ex. 32',
    placeholder_ar: 'مثال: 32',
  },
  wilaya: {
    label: 'Wilaya',
    label_fr: 'Wilaya',
    label_ar: 'الولاية',
    placeholder: 'e.g. 16 - Alger',
    placeholder_fr: 'ex. 16 - Alger',
    placeholder_ar: 'مثال: 16 - الجزائر',
  },
  reason: {
    label: 'Reason of visit',
    label_fr: 'Motif de visite',
    label_ar: 'سبب الزيارة',
    placeholder: 'Why are you visiting?',
    placeholder_fr: 'Pourquoi venez-vous ?',
    placeholder_ar: 'لماذا تزورنا؟',
  },
};

export const PRESET_KEYS: PresetKey[] = ['name', 'phone', 'age', 'wilaya', 'reason'];

/** Get the display label for a field in the given locale */
export function getFieldLabel(field: IntakeField, locale: 'en' | 'fr' | 'ar'): string {
  if (field.type === 'preset') {
    const preset = INTAKE_PRESETS[field.key as PresetKey];
    if (preset) {
      if (locale === 'ar') return preset.label_ar;
      if (locale === 'fr') return preset.label_fr;
      return preset.label;
    }
  }
  if (locale === 'ar' && field.label_ar) return field.label_ar;
  if (locale === 'fr' && field.label_fr) return field.label_fr;
  return field.label || field.key;
}

/** Get the placeholder for a field in the given locale */
export function getFieldPlaceholder(field: IntakeField, locale: 'en' | 'fr' | 'ar'): string {
  if (field.type === 'preset') {
    const preset = INTAKE_PRESETS[field.key as PresetKey];
    if (preset) {
      if (locale === 'ar') return preset.placeholder_ar || '';
      if (locale === 'fr') return preset.placeholder_fr || '';
      return preset.placeholder || '';
    }
  }
  return '';
}

/** Default intake fields for a new business */
export function getDefaultIntakeFields(): IntakeField[] {
  return [
    { key: 'name', type: 'preset', enabled: true, required: false },
    { key: 'phone', type: 'preset', enabled: false, required: false },
    { key: 'age', type: 'preset', enabled: false, required: false },
    { key: 'wilaya', type: 'preset', enabled: true, required: false },
    { key: 'reason', type: 'preset', enabled: true, required: false },
  ];
}

/**
 * Migrate legacy settings (require_name_sameday + custom_intake_fields) to the
 * unified intake_fields array. Called when loading settings that don't have
 * intake_fields yet.
 */
export function migrateToIntakeFields(settings: Record<string, any>): IntakeField[] {
  // Already migrated
  if (Array.isArray(settings.intake_fields) && settings.intake_fields.length > 0) {
    return settings.intake_fields;
  }

  const requireName = settings.require_name_sameday ?? false;
  const customFields: { label: string; label_fr?: string; label_ar?: string }[] =
    Array.isArray(settings.custom_intake_fields) ? settings.custom_intake_fields : [];

  const fields: IntakeField[] = [
    { key: 'name', type: 'preset', enabled: !!requireName, required: false },
    { key: 'phone', type: 'preset', enabled: false, required: false },
    { key: 'age', type: 'preset', enabled: false, required: false },
    // Wilaya and reason were always asked in booking flow
    { key: 'wilaya', type: 'preset', enabled: true, required: false },
    { key: 'reason', type: 'preset', enabled: true, required: false },
  ];

  // Append existing custom fields as enabled
  for (const cf of customFields) {
    if (!cf.label?.trim()) continue;
    fields.push({
      key: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: 'custom',
      enabled: true,
      required: false,
      label: cf.label,
      label_fr: cf.label_fr || '',
      label_ar: cf.label_ar || '',
    });
  }

  return fields;
}

/**
 * Get only the enabled intake fields, in order.
 * @param settings  org settings object
 * @param excludeKeys  keys to skip (e.g. ['phone'] in WhatsApp — auto-collected)
 * @param context  'sameday' | 'booking' — filters by field scope. Omit to get all enabled fields.
 */
export function getEnabledIntakeFields(
  settings: Record<string, any>,
  excludeKeys?: string[],
  context?: 'sameday' | 'booking',
): IntakeField[] {
  const fields = migrateToIntakeFields(settings);
  return fields.filter((f) => {
    if (!f.enabled) return false;
    if ((excludeKeys ?? []).includes(f.key)) return false;
    if (context) {
      const scope = f.scope || 'both';
      if (scope !== 'both' && scope !== context) return false;
    }
    return true;
  });
}

/** Generate a unique key for a new custom field */
export function generateCustomFieldKey(): string {
  return `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}
