// ── Onboarding starter templates ───────────────────────────────────
// Single source of truth for the quick-signup starter data. Used by:
//   • apps/web  — /api/onboarding/create-business (seeds into Supabase)
//   • apps/desktop — Signup screen (renders the picker UI)
//   • apps/expo — mobile onboarding (when added)
//
// Keep this file free of platform-specific imports so every client can
// consume it directly. Any field needed by the server seeder must be
// serializable — no functions, no class instances.

export interface StarterService {
  code: string;
  name: string;
  duration: number; // minutes
}

export interface StarterDepartment {
  code: string;
  name: string;
  services: StarterService[];
}

export interface StarterTemplate {
  id: string;
  icon: string;
  /** Translation key rendered in the UI (resolved client-side). */
  titleKey: string;
  officeName: string;
  departments: StarterDepartment[];
  desks: string[];
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: 'restaurant',
    icon: '🍽️',
    titleKey: 'Restaurant',
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
  },
  {
    id: 'clinic',
    icon: '🏥',
    titleKey: 'Medical practice',
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
  },
  {
    id: 'bank',
    icon: '🏦',
    titleKey: 'Bank branch',
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
  },
  {
    id: 'retail',
    icon: '🛍️',
    titleKey: 'Retail / Services',
    officeName: 'Main store',
    departments: [
      {
        code: 'SVC',
        name: 'Service',
        services: [{ code: 'GENERAL', name: 'General service', duration: 15 }],
      },
    ],
    desks: ['Counter'],
  },
  {
    id: 'public',
    icon: '🏛️',
    titleKey: 'Public service',
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
  },
];

export function getStarterTemplate(id: string | null | undefined): StarterTemplate | undefined {
  return STARTER_TEMPLATES.find((t) => t.id === id);
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
