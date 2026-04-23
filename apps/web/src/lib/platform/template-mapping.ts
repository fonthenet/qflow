/**
 * Maps STARTER_TEMPLATE IDs (used by Station desktop onboarding) to
 * industryTemplate IDs (used by the portal platform layer).
 *
 * Station sends a coarse `templateId` (e.g. "medical") and a fine-grained
 * `subtypeId` (e.g. "medical-dental"). The portal's `getIndustryTemplateById`
 * expects the more specific industry template IDs (e.g. "clinic").
 *
 * Resolution order: subtypeId mapping → templateId mapping → "general-service"
 *
 * TODO: consolidate STARTER_TEMPLATES and industryTemplates into one registry
 * in @qflo/shared so this mapping is unnecessary.
 */

// Maps STARTER_TEMPLATE subtypeId → industryTemplate id
const SUBTYPE_TO_INDUSTRY: Record<string, string> = {
  'restaurant-full':   'restaurant-waitlist',
  'restaurant-cafe':   'restaurant-waitlist',
  'medical-gp':        'clinic',
  'medical-dental':    'clinic',
  'medical-pharmacy':  'clinic',
  'bank-full':         'bank-branch',
  'bank-small':        'bank-branch',
  'retail-store':      'general-service',
  'retail-salon':      'barbershop',
  'retail-barber':     'barbershop',
  'public-docs':       'public-service',
  'public-municipal':  'public-service',
};

// Fallback: maps STARTER_TEMPLATE templateId → industryTemplate id
const TEMPLATE_TO_INDUSTRY: Record<string, string> = {
  restaurant: 'restaurant-waitlist',
  medical:    'clinic',
  bank:       'bank-branch',
  retail:     'general-service',
  public:     'public-service',
};

/**
 * Given a starter template ID and optional subtype ID (both from Station),
 * returns the corresponding industryTemplate id for use with
 * `getIndustryTemplateById`.
 *
 * Falls back to `"general-service"` for unknown inputs.
 */
export function resolveIndustryTemplateId(
  starterTemplateId: string | null | undefined,
  subtypeId?: string | null,
): string {
  if (subtypeId && SUBTYPE_TO_INDUSTRY[subtypeId]) {
    return SUBTYPE_TO_INDUSTRY[subtypeId];
  }
  if (starterTemplateId && TEMPLATE_TO_INDUSTRY[starterTemplateId]) {
    return TEMPLATE_TO_INDUSTRY[starterTemplateId];
  }
  return 'general-service';
}

// Maps STARTER_TEMPLATE templateId → verticals.slug
// (used to populate organizations.vertical — values MUST match the slug column
// in the verticals table, which uses hyphens, not underscores)
const STARTER_TEMPLATE_TO_VERTICAL: Record<string, string> = {
  restaurant: 'restaurant',
  medical:    'clinic',
  bank:       'bank',
  retail:     'retail',
  public:     'public-service',
};

// Maps STARTER_TEMPLATE subtypeId → verticals.slug (more precise)
// All values must be valid slugs present in the verticals table.
const SUBTYPE_TO_VERTICAL: Record<string, string> = {
  'restaurant-full':   'restaurant',
  'restaurant-cafe':   'restaurant',
  'medical-gp':        'clinic',
  'medical-dental':    'dental',
  'medical-pharmacy':  'pharmacy',
  'bank-full':         'bank',
  'bank-small':        'bank',
  'retail-store':      'retail',
  'retail-salon':      'salon',
  'retail-barber':     'barber',
  'public-docs':       'public-service',
  'public-municipal':  'public-service',
};

/**
 * Resolves the vertical slug for the organizations.vertical column from
 * Station's STARTER_TEMPLATE / subtype IDs.
 */
export function resolveVerticalFromTemplate(
  starterTemplateId: string | null | undefined,
  subtypeId?: string | null,
): string | null {
  if (subtypeId && SUBTYPE_TO_VERTICAL[subtypeId]) {
    return SUBTYPE_TO_VERTICAL[subtypeId];
  }
  if (starterTemplateId && STARTER_TEMPLATE_TO_VERTICAL[starterTemplateId]) {
    return STARTER_TEMPLATE_TO_VERTICAL[starterTemplateId];
  }
  return null;
}
