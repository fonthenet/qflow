// ── Onboarding starter templates ───────────────────────────────────
// Single source of truth for quick-signup starter data, shared by:
//   • apps/web  — /api/onboarding/create-business (seeds into Supabase)
//   • apps/desktop — Signup screen (picker + review UI)
//   • apps/expo — mobile onboarding (when added)
//
// Shape is strictly serializable — no imports beyond primitive types.

export interface StarterService {
  code: string;
  name: string;
  /** Estimated duration in minutes. */
  duration: number;
}

export interface StarterDepartment {
  code: string;
  name: string;
  services: StarterService[];
}

/**
 * A customizable knob shown on the onboarding "Customize" step. The
 * key is echoed back to the API and the seeder interprets it per-
 * subtype (e.g. `tables` → insert N rows into restaurant_tables).
 */
export interface TemplateOption {
  key: string;
  /** Translation key for the label. */
  labelKey: string;
  /** Translation key for help text under the field. */
  helpKey?: string;
  type: 'number';
  default: number;
  min?: number;
  max?: number;
}

export interface StarterSubtype {
  id: string;
  icon: string;
  /** Translation key rendered in the UI. */
  titleKey: string;
  /** Translation key for the one-line description. */
  descKey: string;
  /** Written to organizations.settings.business_category. */
  businessCategory: string;
  /** Default office display name. */
  officeName: string;
  departments: StarterDepartment[];
  desks: string[];
  options?: TemplateOption[];
}

export interface StarterTemplate {
  id: string;
  icon: string;
  titleKey: string;
  subtypes: StarterSubtype[];
}

// ─────────────────────────────────────────────────────────────────
// Template catalog
// ─────────────────────────────────────────────────────────────────

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: 'restaurant',
    icon: '🍽️',
    titleKey: 'Restaurant',
    subtypes: [
      {
        id: 'restaurant-full',
        icon: '🍽️',
        titleKey: 'Full-service restaurant',
        descKey: 'Dine-in, takeout, and delivery.',
        businessCategory: 'restaurant',
        officeName: 'Main location',
        departments: [
          {
            code: 'SERVICE',
            name: 'Service',
            services: [
              { code: 'DINE', name: 'Sur Place', duration: 30 },
              { code: 'TAKEOUT', name: 'À Emporter', duration: 10 },
              { code: 'DELIVERY', name: 'Livraison', duration: 5 },
            ],
          },
        ],
        desks: ['Caisse'],
        options: [
          { key: 'tables', labelKey: 'Number of tables', helpKey: 'T1, T2, … will be created automatically.', type: 'number', default: 10, min: 0, max: 200 },
          { key: 'cashiers', labelKey: 'Number of cashiers', type: 'number', default: 1, min: 1, max: 10 },
        ],
      },
      {
        id: 'restaurant-cafe',
        icon: '☕',
        titleKey: 'Cafe / Quick service',
        descKey: 'Fast counter service with optional seating.',
        businessCategory: 'cafe',
        officeName: 'Main cafe',
        departments: [
          {
            code: 'SERVICE',
            name: 'Service',
            services: [
              { code: 'DINE', name: 'Dine-in', duration: 15 },
              { code: 'TAKEOUT', name: 'Takeout', duration: 5 },
            ],
          },
        ],
        desks: ['Counter'],
        options: [
          { key: 'tables', labelKey: 'Number of tables', type: 'number', default: 6, min: 0, max: 100 },
          { key: 'cashiers', labelKey: 'Number of cashiers', type: 'number', default: 1, min: 1, max: 6 },
        ],
      },
    ],
  },

  {
    id: 'medical',
    icon: '🏥',
    titleKey: 'Medical practice',
    subtypes: [
      {
        id: 'medical-gp',
        icon: '🩺',
        titleKey: 'General practice',
        descKey: 'Consultations and follow-ups.',
        businessCategory: 'clinic',
        officeName: 'Main office',
        departments: [
          {
            code: 'GEN',
            name: 'General',
            services: [
              { code: 'CONSULT', name: 'Consultation', duration: 15 },
              { code: 'FOLLOWUP', name: 'Follow-up', duration: 10 },
            ],
          },
        ],
        desks: ['Reception', 'Doctor'],
        options: [
          { key: 'doctors', labelKey: 'Number of doctors', type: 'number', default: 1, min: 1, max: 20 },
        ],
      },
      {
        id: 'medical-dental',
        icon: '🦷',
        titleKey: 'Dental clinic',
        descKey: 'Checkups, cleaning, and procedures.',
        businessCategory: 'dentist',
        officeName: 'Main office',
        departments: [
          {
            code: 'DENTAL',
            name: 'Dental',
            services: [
              { code: 'CHECKUP', name: 'Checkup', duration: 20 },
              { code: 'CLEANING', name: 'Cleaning', duration: 30 },
              { code: 'CONSULT', name: 'Consultation', duration: 15 },
            ],
          },
        ],
        desks: ['Reception', 'Dentist'],
        options: [
          { key: 'doctors', labelKey: 'Number of dentists', type: 'number', default: 1, min: 1, max: 10 },
        ],
      },
      {
        id: 'medical-pharmacy',
        icon: '💊',
        titleKey: 'Pharmacy',
        descKey: 'Prescription counter and consultation.',
        businessCategory: 'pharmacy',
        officeName: 'Main pharmacy',
        departments: [
          {
            code: 'COUNTER',
            name: 'Counter',
            services: [
              { code: 'RX', name: 'Prescription', duration: 5 },
              { code: 'CONSULT', name: 'Consultation', duration: 10 },
            ],
          },
        ],
        desks: ['Counter'],
        options: [
          { key: 'counters', labelKey: 'Number of counters', type: 'number', default: 1, min: 1, max: 6 },
        ],
      },
    ],
  },

  {
    id: 'bank',
    icon: '🏦',
    titleKey: 'Bank branch',
    subtypes: [
      {
        id: 'bank-full',
        icon: '🏦',
        titleKey: 'Full branch',
        descKey: 'Teller windows plus advisory.',
        businessCategory: 'bank',
        officeName: 'Main branch',
        departments: [
          {
            code: 'TELLER',
            name: 'Teller',
            services: [
              { code: 'DEPOSIT', name: 'Deposit / Withdrawal', duration: 5 },
              { code: 'TRANSFER', name: 'Transfer', duration: 10 },
            ],
          },
          {
            code: 'ADV',
            name: 'Advisory',
            services: [
              { code: 'ACCOUNT', name: 'Account opening', duration: 30 },
              { code: 'LOAN', name: 'Loan inquiry', duration: 25 },
            ],
          },
        ],
        desks: ['Teller 1', 'Teller 2', 'Advisor'],
        options: [
          { key: 'tellers', labelKey: 'Number of teller windows', type: 'number', default: 2, min: 1, max: 20 },
          { key: 'advisors', labelKey: 'Number of advisor desks', type: 'number', default: 1, min: 0, max: 10 },
        ],
      },
      {
        id: 'bank-small',
        icon: '💳',
        titleKey: 'Small branch (teller only)',
        descKey: 'Lean branch with counter service only.',
        businessCategory: 'bank',
        officeName: 'Main branch',
        departments: [
          {
            code: 'TELLER',
            name: 'Teller',
            services: [
              { code: 'DEPOSIT', name: 'Deposit / Withdrawal', duration: 5 },
              { code: 'TRANSFER', name: 'Transfer', duration: 10 },
            ],
          },
        ],
        desks: ['Teller'],
        options: [
          { key: 'tellers', labelKey: 'Number of teller windows', type: 'number', default: 1, min: 1, max: 6 },
        ],
      },
    ],
  },

  {
    id: 'retail',
    icon: '🛍️',
    titleKey: 'Retail & Personal care',
    subtypes: [
      {
        id: 'retail-store',
        icon: '🛍️',
        titleKey: 'Retail store',
        descKey: 'Walk-in service at a counter.',
        businessCategory: 'retail',
        officeName: 'Main store',
        departments: [
          {
            code: 'SVC',
            name: 'Service',
            services: [{ code: 'GENERAL', name: 'General service', duration: 15 }],
          },
        ],
        desks: ['Counter'],
        options: [
          { key: 'counters', labelKey: 'Number of counters', type: 'number', default: 1, min: 1, max: 10 },
        ],
      },
      {
        id: 'retail-salon',
        icon: '💇',
        titleKey: 'Salon',
        descKey: 'Hair, color, and beauty treatments.',
        businessCategory: 'salon',
        officeName: 'Main salon',
        departments: [
          {
            code: 'SVC',
            name: 'Service',
            services: [
              { code: 'CUT', name: 'Haircut', duration: 30 },
              { code: 'COLOR', name: 'Coloring', duration: 60 },
              { code: 'TREAT', name: 'Treatment', duration: 45 },
            ],
          },
        ],
        desks: ['Chair 1', 'Chair 2'],
        options: [
          { key: 'chairs', labelKey: 'Number of chairs / stylists', type: 'number', default: 2, min: 1, max: 20 },
        ],
      },
      {
        id: 'retail-barber',
        icon: '💈',
        titleKey: 'Barber shop',
        descKey: 'Haircut, beard, and shave.',
        businessCategory: 'barber',
        officeName: 'Main shop',
        departments: [
          {
            code: 'SVC',
            name: 'Service',
            services: [
              { code: 'CUT', name: 'Haircut', duration: 20 },
              { code: 'BEARD', name: 'Beard trim', duration: 15 },
              { code: 'SHAVE', name: 'Shave', duration: 20 },
            ],
          },
        ],
        desks: ['Chair 1'],
        options: [
          { key: 'chairs', labelKey: 'Number of chairs / barbers', type: 'number', default: 1, min: 1, max: 10 },
        ],
      },
    ],
  },

  {
    id: 'public',
    icon: '🏛️',
    titleKey: 'Public service',
    subtypes: [
      {
        id: 'public-docs',
        icon: '📄',
        titleKey: 'Document services',
        descKey: 'IDs, certificates, forms.',
        businessCategory: 'government',
        officeName: 'Main office',
        departments: [
          {
            code: 'DOCS',
            name: 'Documents',
            services: [
              { code: 'ID', name: 'ID card', duration: 10 },
              { code: 'CERT', name: 'Certificate', duration: 10 },
            ],
          },
        ],
        desks: ['Counter 1', 'Counter 2'],
        options: [
          { key: 'counters', labelKey: 'Number of counters', type: 'number', default: 2, min: 1, max: 20 },
        ],
      },
      {
        id: 'public-municipal',
        icon: '🏛️',
        titleKey: 'Municipal office',
        descKey: 'Civil registry and general inquiries.',
        businessCategory: 'government',
        officeName: 'Main office',
        departments: [
          {
            code: 'REGISTRY',
            name: 'Registry',
            services: [
              { code: 'REG', name: 'Registration', duration: 15 },
              { code: 'CERT', name: 'Certificate', duration: 10 },
            ],
          },
        ],
        desks: ['Counter'],
        options: [
          { key: 'counters', labelKey: 'Number of counters', type: 'number', default: 1, min: 1, max: 10 },
        ],
      },
    ],
  },
];

export function getStarterTemplate(id: string | null | undefined): StarterTemplate | undefined {
  return STARTER_TEMPLATES.find((t) => t.id === id);
}

export function getStarterSubtype(
  templateId: string | null | undefined,
  subtypeId: string | null | undefined,
): StarterSubtype | undefined {
  const tpl = getStarterTemplate(templateId);
  if (!tpl) return undefined;
  return tpl.subtypes.find((s) => s.id === subtypeId) ?? tpl.subtypes[0];
}

/** Default numeric option values for a subtype. */
export function getDefaultOptions(subtype: StarterSubtype): Record<string, number> {
  const out: Record<string, number> = {};
  for (const opt of subtype.options ?? []) out[opt.key] = opt.default;
  return out;
}

export const DEFAULT_OFFICE_HOURS = {
  monday:    { open: '09:00', close: '18:00', closed: false },
  tuesday:   { open: '09:00', close: '18:00', closed: false },
  wednesday: { open: '09:00', close: '18:00', closed: false },
  thursday:  { open: '09:00', close: '18:00', closed: false },
  friday:    { open: '09:00', close: '18:00', closed: false },
  saturday:  { open: '09:00', close: '18:00', closed: false },
  sunday:    { open: '09:00', close: '18:00', closed: true },
};

export const DEFAULT_TIMEZONE = 'Africa/Algiers';
