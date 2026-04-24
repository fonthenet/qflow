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
  | 'restaurant'
  | 'education'
  | 'beauty'
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
 * Everything the wizard needs to seed a ready-to-use business.
 *
 * All names are localized. The `vertical` maps this category to the
 * `industryTemplates` entry (used by the Portal's navigation vocabulary).
 */
export interface CategoryDefinition {
  value: BusinessCategory;
  emoji: string;
  label: LocalizedText;
  /** The vocabulary the customer sees on their side (e.g. 'Appointment' vs 'Ticket'). */
  vertical:
    | 'clinic'
    | 'bank'
    | 'public_service'
    | 'restaurant'
    | 'barbershop'
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
    emoji: '🏛️',
    label: { en: 'Government', fr: 'Gouvernement', ar: 'الإدارات الحكومية' },
    vertical: 'public_service',
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
    value: 'services',
    emoji: '🏢',
    label: { en: 'Public Services', fr: 'Services Publics', ar: 'الخدمات العمومية' },
    vertical: 'public_service',
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
    emoji: '🍽️',
    label: { en: 'Restaurants', fr: 'Restaurants', ar: 'المطاعم' },
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
    value: 'education',
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
    value: 'beauty',
    emoji: '✂️',
    label: { en: 'Beauty & Spa', fr: 'Beauté & Spa', ar: 'التجميل والعناية' },
    vertical: 'barbershop',
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
    barber: 'beauty',
    salon: 'beauty',
    spa: 'beauty',
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
    case 'public_service': return 'public-service';
    case 'restaurant': return 'restaurant-waitlist';
    case 'barbershop': return 'barbershop';
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
