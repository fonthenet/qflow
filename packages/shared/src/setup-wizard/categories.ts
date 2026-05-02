/**
 * Business categories used by the unified setup wizard (Portal + Station).
 *
 * Each category carries localized defaults so the wizard can auto-seed a
 * fully-usable business structure (1 office → 1 department → 1 service → 1 desk)
 * without asking the operator to name everything. Operators can always
 * rename or add more from the Business Structure screens afterwards.
 *
 * Locales supported by the setup wizard copy: fr (primary), ar, en.
 */

export type BusinessCategory =
  | 'healthcare'
  | 'banking'
  | 'government'
  | 'services'
  // Food family — restaurant + cafe share the same template machinery
  // (isRestaurantCategory accepts both) but seed slightly different
  // defaults (cafe has shorter prep + different service vocabulary).
  | 'restaurant'
  | 'cafe'
  | 'education'
  // Beauty / personal-care family. We keep 'beauty' as the legacy
  // catch-all (existing orgs were stamped with it) and add four
  // specific sub-types so the seeded service list matches the actual
  // business — a nail salon getting "Haircut" pre-filled is wrong.
  | 'beauty'
  | 'barbershop'
  | 'hair_salon'
  | 'nail_salon'
  | 'spa'
  | 'telecom'
  | 'insurance'
  | 'automotive'
  | 'legal'
  | 'real_estate'
  | 'other';

export type CategoryLocale = 'en' | 'fr' | 'ar';

export interface LocalizedText {
  en: string;
  fr: string;
  ar: string;
}

/**
 * Top-level grouping for the signup picker. Categories with the same
 * parent slug are shown together under one parent card; clicking a
 * parent that has multiple children opens a sub-picker. Parents with
 * a single child auto-select that child (no sub-picker shown).
 *
 * Parent slugs are stable IDs — only used for UI grouping, never
 * persisted. A category that doesn't fit a parent gets `parent: 'other'`.
 */
export type CategoryParent =
  | 'food'           // Restaurant + Café
  | 'beauty'         // Barbershop / Hair / Nail / Spa
  | 'healthcare'
  | 'government'
  | 'banking'
  | 'education'
  | 'professional'   // Insurance / Legal / Real Estate
  | 'retail'         // Telecom / Automotive / Other catch-all
  ;

export interface CategoryParentDefinition {
  slug: CategoryParent;
  emoji: string;
  label: LocalizedText;
  /** Short pitch shown under the parent card on the picker. */
  hint: LocalizedText;
}

/** Parent groups shown on the first level of the signup picker. */
export const CATEGORY_PARENTS: CategoryParentDefinition[] = [
  {
    slug: 'food',
    emoji: '🍽️',
    label: { en: 'Food & Beverage', fr: 'Restauration', ar: 'مطعم ومقهى' },
    hint: { en: 'Restaurant, café', fr: 'Restaurant, café', ar: 'مطعم، مقهى' },
  },
  {
    slug: 'beauty',
    emoji: '💇',
    label: { en: 'Beauty & Personal Care', fr: 'Beauté & Soins', ar: 'التجميل والعناية' },
    hint: { en: 'Barber, salon, nails, spa', fr: 'Barbier, coiffure, ongles, spa', ar: 'حلاقة، شعر، أظافر، سبا' },
  },
  {
    slug: 'healthcare',
    emoji: '🏥',
    label: { en: 'Healthcare', fr: 'Santé', ar: 'الصحة' },
    hint: { en: 'Clinic, dental, lab', fr: 'Clinique, dentiste, laboratoire', ar: 'عيادة، أسنان، مختبر' },
  },
  {
    slug: 'government',
    emoji: '🏛️',
    label: { en: 'Government & Public Services', fr: 'Administration & Services Publics', ar: 'إدارات وخدمات عمومية' },
    hint: { en: 'Town hall, post office, civil records', fr: 'Mairie, bureau de poste, état civil', ar: 'بلدية، بريد، حالة مدنية' },
  },
  {
    slug: 'banking',
    emoji: '🏦',
    label: { en: 'Banking', fr: 'Banque', ar: 'البنوك' },
    hint: { en: 'Branch, agency', fr: 'Agence, succursale', ar: 'وكالة، فرع' },
  },
  {
    slug: 'education',
    emoji: '📚',
    label: { en: 'Education', fr: 'Éducation', ar: 'التعليم' },
    hint: { en: 'School, university, training', fr: 'École, université, formation', ar: 'مدرسة، جامعة، تدريب' },
  },
  {
    slug: 'professional',
    emoji: '💼',
    label: { en: 'Professional Services', fr: 'Services Professionnels', ar: 'الخدمات المهنية' },
    hint: { en: 'Insurance, legal, real estate', fr: 'Assurance, juridique, immobilier', ar: 'تأمين، قانون، عقارات' },
  },
  {
    slug: 'retail',
    emoji: '🏪',
    label: { en: 'Retail & Other', fr: 'Commerce & Autres', ar: 'تجارة وأخرى' },
    hint: { en: 'Telecom, automotive, anything else', fr: 'Télécom, auto, autres', ar: 'اتصالات، سيارات، غير ذلك' },
  },
];

export function getCategoryParent(slug: CategoryParent | null | undefined): CategoryParentDefinition | undefined {
  if (!slug) return undefined;
  return CATEGORY_PARENTS.find((p) => p.slug === slug);
}

/**
 * Everything the wizard needs to seed a ready-to-use business.
 *
 * All names are localized. The `vertical` maps this category to the
 * `industryTemplates` entry (used by the Portal's navigation vocabulary).
 */
export interface CategoryDefinition {
  value: BusinessCategory;
  /** Parent group for the signup picker. */
  parent: CategoryParent;
  /** Hide from the new-signup picker (still selectable for legacy
   *  orgs whose `business_category` already matches). */
  legacy?: boolean;
  emoji: string;
  label: LocalizedText;
  /** The vocabulary the customer sees on their side (e.g. 'Appointment' vs 'Ticket'). */
  // Must match a slug present in public.verticals — the FK on
  // organizations.vertical enforces that. Don't drift from the DB
  // without adding the new slug there too (see migration
  // 20260501170000_align_verticals_with_categories_spec.sql).
  vertical:
    | 'clinic'
    | 'bank'
    | 'public-service'
    | 'restaurant'
    | 'barber'
    | 'salon'
    | 'spa'
    | 'education'
    | 'telecom'
    | 'insurance'
    | 'automotive'
    | 'legal'
    | 'real_estate'
    | 'general';
  /** Office name proposed in step 2 (operator can override). */
  defaultOfficeName: LocalizedText;
  /** First department created automatically. */
  defaultDepartment: {
    name: LocalizedText;
    code: string;
  };
  /** First service created automatically under the default department. */
  defaultService: {
    name: LocalizedText;
    code: string;
    /** Minutes. A reasonable pick for this category. */
    estimatedMinutes: number;
  };
  /** First desk, created and assigned to the admin automatically. */
  defaultDesk: {
    name: LocalizedText;
  };
}

export const BUSINESS_CATEGORIES: CategoryDefinition[] = [
  {
    value: 'healthcare',
    parent: 'healthcare',
    emoji: '🏥',
    label: { en: 'Healthcare', fr: 'Santé', ar: 'الصحة' },
    vertical: 'clinic',
    defaultOfficeName: { en: 'Main Clinic', fr: 'Clinique Principale', ar: 'العيادة الرئيسية' },
    defaultDepartment: {
      name: { en: 'Consultations', fr: 'Consultations', ar: 'الاستشارات' },
      code: 'CONS',
    },
    defaultService: {
      name: { en: 'General Visit', fr: 'Consultation Générale', ar: 'استشارة عامة' },
      code: 'GEN',
      estimatedMinutes: 15,
    },
    defaultDesk: { name: { en: 'Room 1', fr: 'Cabinet 1', ar: 'غرفة 1' } },
  },
  {
    value: 'banking',
    parent: 'banking',
    emoji: '🏦',
    label: { en: 'Banking & Finance', fr: 'Banque & Finance', ar: 'البنوك والمالية' },
    vertical: 'bank',
    defaultOfficeName: { en: 'Main Branch', fr: 'Agence Principale', ar: 'الوكالة الرئيسية' },
    defaultDepartment: {
      name: { en: 'Teller', fr: 'Guichet', ar: 'الشباك' },
      code: 'TELL',
    },
    defaultService: {
      name: { en: 'General Service', fr: 'Service Général', ar: 'خدمة عامة' },
      code: 'GEN',
      estimatedMinutes: 8,
    },
    defaultDesk: { name: { en: 'Teller 1', fr: 'Guichet 1', ar: 'شباك 1' } },
  },
  {
    value: 'government',
    parent: 'government',
    emoji: '🏛️',
    label: { en: 'Government', fr: 'Gouvernement', ar: 'الإدارات الحكومية' },
    vertical: 'public-service',
    defaultOfficeName: { en: 'Main Office', fr: 'Bureau Principal', ar: 'المكتب الرئيسي' },
    defaultDepartment: {
      name: { en: 'Civil Status', fr: 'État Civil', ar: 'الحالة المدنية' },
      code: 'CIV',
    },
    defaultService: {
      name: { en: 'General Service', fr: 'Service Général', ar: 'خدمة عامة' },
      code: 'GEN',
      estimatedMinutes: 10,
    },
    defaultDesk: { name: { en: 'Counter 1', fr: 'Guichet 1', ar: 'شباك 1' } },
  },
  {
    // Legacy duplicate of 'government' — kept selectable for orgs that
    // were stamped with it before consolidation, but hidden from the
    // new-signup picker so operators only see the canonical
    // 'government' option.
    value: 'services',
    parent: 'government',
    legacy: true,
    emoji: '🏢',
    label: { en: 'Public Services', fr: 'Services Publics', ar: 'الخدمات العمومية' },
    vertical: 'public-service',
    defaultOfficeName: { en: 'Main Office', fr: 'Bureau Principal', ar: 'المكتب الرئيسي' },
    defaultDepartment: {
      name: { en: 'Reception', fr: 'Accueil', ar: 'الاستقبال' },
      code: 'REC',
    },
    defaultService: {
      name: { en: 'General Service', fr: 'Service Général', ar: 'خدمة عامة' },
      code: 'GEN',
      estimatedMinutes: 10,
    },
    defaultDesk: { name: { en: 'Counter 1', fr: 'Guichet 1', ar: 'شباك 1' } },
  },
  {
    value: 'restaurant',
    parent: 'food',
    emoji: '🍽️',
    label: { en: 'Restaurant', fr: 'Restaurant', ar: 'مطعم' },
    vertical: 'restaurant',
    defaultOfficeName: { en: 'Main Dining Room', fr: 'Salle Principale', ar: 'القاعة الرئيسية' },
    defaultDepartment: {
      name: { en: 'Floor', fr: 'Salle', ar: 'القاعة' },
      code: 'FLR',
    },
    defaultService: {
      name: { en: 'Table Seating', fr: 'Placement en Salle', ar: 'الجلوس على الطاولة' },
      code: 'TABLE',
      estimatedMinutes: 45,
    },
    defaultDesk: { name: { en: 'Host Station', fr: 'Accueil', ar: 'محطة الاستقبال' } },
  },
  {
    value: 'cafe',
    parent: 'food',
    emoji: '☕',
    label: { en: 'Café', fr: 'Café', ar: 'مقهى' },
    vertical: 'restaurant',
    defaultOfficeName: { en: 'Main Café', fr: 'Café Principal', ar: 'المقهى الرئيسي' },
    defaultDepartment: {
      name: { en: 'Counter', fr: 'Comptoir', ar: 'الكاونتر' },
      code: 'CTR',
    },
    defaultService: {
      // Cafés default to takeaway as the headline service since most
      // café orders are walk-in-and-go. The full takeout/delivery/
      // dine-in trio is still seeded by the restaurant template.
      name: { en: 'Takeaway Order', fr: 'Commande à Emporter', ar: 'طلب للأخذ' },
      code: 'TAKE',
      estimatedMinutes: 8,
    },
    defaultDesk: { name: { en: 'Counter 1', fr: 'Comptoir 1', ar: 'كاونتر 1' } },
  },
  {
    value: 'education',
    parent: 'education',
    emoji: '📚',
    label: { en: 'Education', fr: 'Éducation', ar: 'التعليم' },
    vertical: 'education',
    defaultOfficeName: { en: 'Main Campus', fr: 'Campus Principal', ar: 'الحرم الجامعي الرئيسي' },
    defaultDepartment: {
      name: { en: 'Student Services', fr: 'Services aux Étudiants', ar: 'خدمات الطلاب' },
      code: 'STU',
    },
    defaultService: {
      name: { en: 'General Inquiry', fr: 'Demande Générale', ar: 'استفسار عام' },
      code: 'INQ',
      estimatedMinutes: 10,
    },
    defaultDesk: { name: { en: 'Counter 1', fr: 'Guichet 1', ar: 'شباك 1' } },
  },
  {
    value: 'barbershop',
    parent: 'beauty',
    emoji: '💈',
    label: { en: 'Barbershop', fr: 'Salon de barbier', ar: 'صالون حلاقة' },
    vertical: 'barber',
    defaultOfficeName: { en: 'Main Barbershop', fr: 'Salon de Barbier', ar: 'صالون الحلاقة' },
    defaultDepartment: {
      name: { en: 'Services', fr: 'Prestations', ar: 'الخدمات' },
      code: 'BRB',
    },
    defaultService: {
      name: { en: 'Haircut', fr: 'Coupe', ar: 'قص الشعر' },
      code: 'CUT',
      estimatedMinutes: 30,
    },
    defaultDesk: { name: { en: 'Chair 1', fr: 'Chaise 1', ar: 'كرسي 1' } },
  },
  {
    value: 'hair_salon',
    parent: 'beauty',
    emoji: '💇',
    label: { en: 'Hair Salon', fr: 'Salon de coiffure', ar: 'صالون شعر' },
    vertical: 'salon',
    defaultOfficeName: { en: 'Main Salon', fr: 'Salon Principal', ar: 'الصالون الرئيسي' },
    defaultDepartment: {
      name: { en: 'Services', fr: 'Prestations', ar: 'الخدمات' },
      code: 'SLN',
    },
    defaultService: {
      name: { en: 'Cut & Style', fr: 'Coupe & Coiffage', ar: 'قص وتصفيف' },
      code: 'CUT',
      estimatedMinutes: 45,
    },
    defaultDesk: { name: { en: 'Chair 1', fr: 'Chaise 1', ar: 'كرسي 1' } },
  },
  {
    value: 'nail_salon',
    parent: 'beauty',
    emoji: '💅',
    label: { en: 'Nail Salon', fr: 'Salon de manucure', ar: 'صالون أظافر' },
    vertical: 'salon',
    defaultOfficeName: { en: 'Main Studio', fr: 'Studio Principal', ar: 'الاستوديو الرئيسي' },
    defaultDepartment: {
      name: { en: 'Services', fr: 'Prestations', ar: 'الخدمات' },
      code: 'NAL',
    },
    defaultService: {
      name: { en: 'Manicure', fr: 'Manucure', ar: 'مانيكير' },
      code: 'MAN',
      estimatedMinutes: 35,
    },
    defaultDesk: { name: { en: 'Station 1', fr: 'Poste 1', ar: 'محطة 1' } },
  },
  {
    value: 'spa',
    parent: 'beauty',
    emoji: '🧖',
    label: { en: 'Spa & Wellness', fr: 'Spa & Bien-être', ar: 'سبا وعافية' },
    vertical: 'spa',
    defaultOfficeName: { en: 'Main Spa', fr: 'Spa Principal', ar: 'السبا الرئيسي' },
    defaultDepartment: {
      name: { en: 'Treatments', fr: 'Soins', ar: 'العلاجات' },
      code: 'SPA',
    },
    defaultService: {
      name: { en: 'Massage', fr: 'Massage', ar: 'مساج' },
      code: 'MSG',
      estimatedMinutes: 60,
    },
    defaultDesk: { name: { en: 'Room 1', fr: 'Cabine 1', ar: 'غرفة 1' } },
  },
  // Legacy catch-all — kept selectable so existing 'beauty' orgs stay
  // routable, but hidden from the new-signup picker (legacy: true)
  // since the four specific sub-types above cover every real case.
  {
    value: 'beauty',
    parent: 'beauty',
    legacy: true,
    emoji: '✂️',
    label: { en: 'Beauty & Spa (mixed)', fr: 'Beauté & Spa (mixte)', ar: 'تجميل وسبا (مختلط)' },
    vertical: 'salon',
    defaultOfficeName: { en: 'Main Salon', fr: 'Salon Principal', ar: 'الصالون الرئيسي' },
    defaultDepartment: {
      name: { en: 'Services', fr: 'Prestations', ar: 'الخدمات' },
      code: 'SRV',
    },
    defaultService: {
      name: { en: 'Haircut', fr: 'Coupe', ar: 'قص الشعر' },
      code: 'CUT',
      estimatedMinutes: 30,
    },
    defaultDesk: { name: { en: 'Chair 1', fr: 'Chaise 1', ar: 'كرسي 1' } },
  },
  {
    value: 'telecom',
    parent: 'retail',
    emoji: '📱',
    label: { en: 'Telecom', fr: 'Télécom', ar: 'الاتصالات' },
    vertical: 'telecom',
    defaultOfficeName: { en: 'Main Store', fr: 'Boutique Principale', ar: 'المتجر الرئيسي' },
    defaultDepartment: {
      name: { en: 'Customer Service', fr: 'Service Client', ar: 'خدمة الزبائن' },
      code: 'CS',
    },
    defaultService: {
      name: { en: 'General Support', fr: 'Support Général', ar: 'دعم عام' },
      code: 'GEN',
      estimatedMinutes: 10,
    },
    defaultDesk: { name: { en: 'Counter 1', fr: 'Guichet 1', ar: 'شباك 1' } },
  },
  {
    value: 'insurance',
    parent: 'professional',
    emoji: '🛡️',
    label: { en: 'Insurance', fr: 'Assurance', ar: 'التأمين' },
    vertical: 'insurance',
    defaultOfficeName: { en: 'Main Agency', fr: 'Agence Principale', ar: 'الوكالة الرئيسية' },
    defaultDepartment: {
      name: { en: 'Advisory', fr: 'Conseil', ar: 'الاستشارة' },
      code: 'ADV',
    },
    defaultService: {
      name: { en: 'General Consultation', fr: 'Consultation Générale', ar: 'استشارة عامة' },
      code: 'GEN',
      estimatedMinutes: 20,
    },
    defaultDesk: { name: { en: 'Advisor 1', fr: 'Conseiller 1', ar: 'مستشار 1' } },
  },
  {
    value: 'automotive',
    parent: 'retail',
    emoji: '🚗',
    label: { en: 'Automotive', fr: 'Automobile', ar: 'السيارات' },
    vertical: 'automotive',
    defaultOfficeName: { en: 'Main Garage', fr: 'Garage Principal', ar: 'المرآب الرئيسي' },
    defaultDepartment: {
      name: { en: 'Service', fr: 'Atelier', ar: 'الورشة' },
      code: 'SRV',
    },
    defaultService: {
      name: { en: 'General Service', fr: 'Service Général', ar: 'خدمة عامة' },
      code: 'GEN',
      estimatedMinutes: 30,
    },
    defaultDesk: { name: { en: 'Bay 1', fr: 'Poste 1', ar: 'ورشة 1' } },
  },
  {
    value: 'legal',
    parent: 'professional',
    emoji: '⚖️',
    label: { en: 'Legal', fr: 'Juridique', ar: 'الشؤون القانونية' },
    vertical: 'legal',
    defaultOfficeName: { en: 'Main Office', fr: 'Bureau Principal', ar: 'المكتب الرئيسي' },
    defaultDepartment: {
      name: { en: 'Consultations', fr: 'Consultations', ar: 'الاستشارات' },
      code: 'CONS',
    },
    defaultService: {
      name: { en: 'Initial Consultation', fr: 'Première Consultation', ar: 'استشارة أولية' },
      code: 'INIT',
      estimatedMinutes: 30,
    },
    defaultDesk: { name: { en: 'Office 1', fr: 'Bureau 1', ar: 'مكتب 1' } },
  },
  {
    value: 'real_estate',
    parent: 'professional',
    emoji: '🏠',
    label: { en: 'Real Estate', fr: 'Immobilier', ar: 'العقارات' },
    vertical: 'real_estate',
    defaultOfficeName: { en: 'Main Agency', fr: 'Agence Principale', ar: 'الوكالة الرئيسية' },
    defaultDepartment: {
      name: { en: 'Sales', fr: 'Ventes', ar: 'المبيعات' },
      code: 'SAL',
    },
    defaultService: {
      name: { en: 'Property Inquiry', fr: 'Demande de Bien', ar: 'استفسار عقاري' },
      code: 'INQ',
      estimatedMinutes: 20,
    },
    defaultDesk: { name: { en: 'Agent 1', fr: 'Agent 1', ar: 'وكيل 1' } },
  },
  {
    value: 'other',
    parent: 'retail',
    emoji: '💼',
    label: { en: 'Other', fr: 'Autre', ar: 'أخرى' },
    vertical: 'general',
    defaultOfficeName: { en: 'Main Office', fr: 'Bureau Principal', ar: 'المكتب الرئيسي' },
    defaultDepartment: {
      name: { en: 'Reception', fr: 'Accueil', ar: 'الاستقبال' },
      code: 'REC',
    },
    defaultService: {
      name: { en: 'General Service', fr: 'Service Général', ar: 'خدمة عامة' },
      code: 'GEN',
      estimatedMinutes: 10,
    },
    defaultDesk: { name: { en: 'Counter 1', fr: 'Guichet 1', ar: 'شباك 1' } },
  },
];

export function getBusinessCategory(value: string | null | undefined): CategoryDefinition | undefined {
  if (!value) return undefined;
  return BUSINESS_CATEGORIES.find((c) => c.value === value);
}

/**
 * Children of a parent group — used by the signup picker to render
 * the second-level sub-category picker. Excludes legacy categories
 * by default so new operators only see canonical options. Pass
 * includeLegacy=true on the Settings page (operator may want to
 * view their existing legacy category).
 */
export function getCategoriesForParent(
  parent: CategoryParent,
  includeLegacy = false,
): CategoryDefinition[] {
  return BUSINESS_CATEGORIES.filter(
    (c) => c.parent === parent && (includeLegacy || !c.legacy),
  );
}

/**
 * Parent groups that have at least one non-legacy child. Used to
 * render the first-level picker — we don't want a parent card
 * appearing if all its children are legacy/hidden.
 */
export function getActiveCategoryParents(): CategoryParentDefinition[] {
  return CATEGORY_PARENTS.filter(
    (p) => BUSINESS_CATEGORIES.some((c) => c.parent === p.slug && !c.legacy),
  );
}

/**
 * Reverse lookup: given a `vertical` (e.g. 'public_service', 'clinic',
 * 'restaurant') return the `BusinessCategory` it belongs to. Useful for
 * orgs provisioned by the Portal's platform wizard which writes
 * `platform_vertical` + `vertical` but may not yet have the
 * `business_category` settings key — this lets readers (Station,
 * reporting) normalize to a single enum.
 */
export function getBusinessCategoryByVertical(
  vertical: string | null | undefined,
): BusinessCategory | undefined {
  if (!vertical) return undefined;
  // Normalize both underscore (TS enum style: 'public_service') and
  // hyphen (DB slug style: 'public-service') so either representation
  // resolves to the same BusinessCategory. The `organizations.vertical`
  // column FK uses DB slugs while `settings.platform_vertical` uses the
  // TS style — readers should never have to care which one they got.
  const normalized = vertical.toLowerCase().replace(/-/g, '_');
  const hit = BUSINESS_CATEGORIES.find(
    (c) => c.vertical.toLowerCase().replace(/-/g, '_') === normalized,
  );
  if (hit) return hit.value;
  // Common DB-slug aliases that don't map 1:1 to a BUSINESS_CATEGORIES
  // vertical. Keep this conservative — only add aliases we've seen in
  // production so we don't silently mis-categorize.
  const aliases: Record<string, BusinessCategory> = {
    gov: 'government',
    // Personal-care DB slugs map to the SPECIFIC sub-categories now —
    // legacy 'beauty' stays selectable but new lookups go to the
    // matching sub-type so the seeded service set is right.
    barber: 'barbershop',
    salon: 'hair_salon',
    spa: 'spa',
    dental: 'healthcare',
    veterinary: 'healthcare',
    pharmacy: 'healthcare',
    retail: 'other',
  };
  return aliases[normalized];
}

export function resolveLocalized(text: LocalizedText, locale: CategoryLocale = 'fr'): string {
  return text[locale] ?? text.fr ?? text.en;
}

/**
 * Maps a category's `vertical` to the id of the matching entry in
 * `apps/web/src/lib/platform/templates.ts#industryTemplates`. The Portal uses
 * this id to pick vocabulary ("Appointment" vs "Ticket") and default
 * navigation for the role policy.
 */
export function getCategoryTemplateId(category: CategoryDefinition): string {
  switch (category.vertical) {
    case 'clinic': return 'clinic';
    case 'bank': return 'bank-branch';
    case 'public-service': return 'public-service';
    case 'restaurant': return 'restaurant-waitlist';
    case 'barber': return 'barbershop';
    case 'salon': return 'salon';
    case 'spa': return 'spa';
    case 'education': return 'education';
    case 'telecom': return 'telecom';
    case 'insurance': return 'insurance';
    case 'automotive': return 'automotive';
    case 'legal': return 'legal';
    case 'real_estate': return 'real-estate';
    case 'general':
    default:
      return 'general-service';
  }
}
