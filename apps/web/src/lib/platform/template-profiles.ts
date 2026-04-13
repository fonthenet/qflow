/**
 * Template profiles — sub-vertical variants that layer on top of a base vertical.
 *
 * A profile is a lightweight overlay that customizes a template for a specific
 * business sub-type (e.g., "Dental Practice" vs "General Clinic"). Profiles
 * adjust vocabulary, starter services, intake schemas, and experience copy
 * without changing the tier or core workflow.
 *
 * Profiles are applied AFTER the template factory, so:
 *   tier preset → vertical overlay → profile overlay
 */

import type {
  IndustryVertical,
  IndustryTemplate,
  StarterDepartmentTemplate,
  IntakeSchema,
} from '@qflo/shared';
import { deepMergeRecords } from '@qflo/shared';

// ── Profile definition ──────────────────────────────────────────────────────

export interface TemplateProfile {
  id: string;
  parentVertical: IndustryVertical;
  title: string;
  description: string;
  icon: string;
  /** Partial overrides applied on top of the parent template */
  overrides: {
    experienceProfile?: {
      vocabulary?: Partial<IndustryTemplate['experienceProfile']['vocabulary']>;
      kiosk?: Partial<IndustryTemplate['experienceProfile']['kiosk']>;
      publicJoin?: Partial<IndustryTemplate['experienceProfile']['publicJoin']>;
      branding?: Partial<IndustryTemplate['experienceProfile']['branding']>;
      messagingTone?: IndustryTemplate['experienceProfile']['messagingTone'];
    };
    /** Replace starter departments/services entirely */
    starterDepartments?: StarterDepartmentTemplate[];
    /** Replace intake schemas entirely */
    intakeSchemas?: IntakeSchema[];
    /** Override default SLAs */
    defaultSlas?: IndustryTemplate['defaultSlas'];
    /** Override onboarding copy */
    onboardingCopy?: Partial<IndustryTemplate['onboardingCopy']>;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  PROFILE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

const CLINIC_PROFILES: TemplateProfile[] = [
  {
    id: 'general-clinic',
    parentVertical: 'clinic',
    title: 'General Clinic',
    description: 'Walk-in and appointment visits with triage, check-in, and consultation departments.',
    icon: '🏥',
    overrides: {},  // Uses the clinic defaults as-is
  },
  {
    id: 'dental-practice',
    parentVertical: 'clinic',
    title: 'Dental Practice',
    description: 'Appointment-focused with dental-specific services and intake forms.',
    icon: '🦷',
    overrides: {
      experienceProfile: {
        vocabulary: {
          serviceLabel: 'Treatment',
          deskLabel: 'Operatory',
          customerLabel: 'Patient',
          bookingLabel: 'Appointment',
        },
        kiosk: {
          welcomeMessage: 'Check in for your dental appointment',
          headerText: 'Dental check-in',
          themeColor: '#0891b2',
          buttonLabel: 'Check In',
        },
        publicJoin: {
          headline: 'Your dental appointment',
          subheadline: 'Check in and we\'ll call you when the dentist is ready.',
        },
        branding: { recommendedPrimaryColor: '#0891b2' },
      },
      starterDepartments: [
        {
          name: 'Front Desk', code: 'F', sortOrder: 1,
          services: [
            { name: 'Check-In', code: 'CHECKIN', estimatedServiceTime: 5, sortOrder: 1 },
            { name: 'Insurance Verification', code: 'INSURANCE', estimatedServiceTime: 8, sortOrder: 2 },
          ],
        },
        {
          name: 'Dental Care', code: 'D', sortOrder: 2,
          services: [
            { name: 'Cleaning', code: 'CLEANING', estimatedServiceTime: 30, sortOrder: 1 },
            { name: 'Filling', code: 'FILLING', estimatedServiceTime: 45, sortOrder: 2 },
            { name: 'Consultation', code: 'CONSULT', estimatedServiceTime: 20, sortOrder: 3 },
            { name: 'Emergency', code: 'EMERGENCY', estimatedServiceTime: 30, sortOrder: 4 },
          ],
        },
      ],
      intakeSchemas: [
        {
          serviceCode: 'CHECKIN',
          title: 'Dental patient intake',
          fields: [
            { key: 'patient_name', label: 'Patient name', type: 'text', required: true, visibility: 'public' },
            { key: 'phone', label: 'Mobile number', type: 'phone', required: false, visibility: 'public' },
            { key: 'concern', label: 'Primary concern', type: 'textarea', required: false, visibility: 'staff_only' },
          ],
          complianceNotes: ['Review dental records retention policy.'],
        },
      ],
      defaultSlas: [
        { metric: 'check_in', label: 'Check-in completed within', targetMinutes: 5 },
        { metric: 'chair_wait', label: 'Chair wait under', targetMinutes: 10 },
      ],
    },
  },
  {
    id: 'urgent-care',
    parentVertical: 'clinic',
    title: 'Urgent Care',
    description: 'Walk-in focused with fast triage and shorter wait targets.',
    icon: '🚑',
    overrides: {
      experienceProfile: {
        vocabulary: {
          serviceLabel: 'Visit Type',
          bookingLabel: 'Walk-In Visit',
        },
        kiosk: {
          welcomeMessage: 'Check in for urgent care',
          headerText: 'Urgent care check-in',
          themeColor: '#dc2626',
          buttonLabel: 'Check In Now',
        },
        publicJoin: {
          headline: 'Your urgent care visit',
          subheadline: 'We\'ll see you as quickly as possible.',
        },
        branding: { recommendedPrimaryColor: '#dc2626' },
      },
      starterDepartments: [
        {
          name: 'Triage', code: 'T', sortOrder: 1,
          services: [
            { name: 'Walk-In Triage', code: 'TRIAGE', estimatedServiceTime: 5, sortOrder: 1 },
          ],
        },
        {
          name: 'Treatment', code: 'X', sortOrder: 2,
          services: [
            { name: 'Minor Illness', code: 'ILLNESS', estimatedServiceTime: 15, sortOrder: 1 },
            { name: 'Minor Injury', code: 'INJURY', estimatedServiceTime: 20, sortOrder: 2 },
            { name: 'Lab / X-Ray', code: 'LAB', estimatedServiceTime: 25, sortOrder: 3 },
          ],
        },
      ],
      defaultSlas: [
        { metric: 'triage', label: 'Triage within', targetMinutes: 5 },
        { metric: 'provider_wait', label: 'Provider wait under', targetMinutes: 20 },
      ],
      onboardingCopy: {
        headline: 'Launch an urgent care flow',
        description: 'Fast triage for walk-in patients with minimal wait times.',
      },
    },
  },
  {
    id: 'specialty-office',
    parentVertical: 'clinic',
    title: 'Specialty Office',
    description: 'Appointment-only specialist visits with longer consultation times.',
    icon: '🩺',
    overrides: {
      experienceProfile: {
        vocabulary: {
          serviceLabel: 'Consultation Type',
          deskLabel: 'Office',
          bookingLabel: 'Consultation',
        },
        kiosk: {
          welcomeMessage: 'Check in for your consultation',
          headerText: 'Specialist check-in',
        },
        publicJoin: {
          headline: 'Your specialist appointment',
          subheadline: 'Check in and relax — we\'ll notify you when the doctor is ready.',
        },
      },
      starterDepartments: [
        {
          name: 'Reception', code: 'R', sortOrder: 1,
          services: [
            { name: 'Check-In', code: 'CHECKIN', estimatedServiceTime: 5, sortOrder: 1 },
          ],
        },
        {
          name: 'Consultation', code: 'C', sortOrder: 2,
          services: [
            { name: 'New Patient', code: 'NEW', estimatedServiceTime: 30, sortOrder: 1 },
            { name: 'Follow-Up', code: 'FOLLOWUP', estimatedServiceTime: 20, sortOrder: 2 },
            { name: 'Procedure', code: 'PROCEDURE', estimatedServiceTime: 45, sortOrder: 3 },
          ],
        },
      ],
      defaultSlas: [
        { metric: 'check_in', label: 'Check-in completed within', targetMinutes: 5 },
        { metric: 'provider_wait', label: 'Specialist wait under', targetMinutes: 15 },
      ],
    },
  },
];

const RESTAURANT_PROFILES: TemplateProfile[] = [
  {
    id: 'casual-dining',
    parentVertical: 'restaurant',
    title: 'Casual Dining',
    description: 'Full-service restaurant with walk-in waitlist and reservations.',
    icon: '🍽️',
    overrides: {},  // Uses the restaurant defaults
  },
  {
    id: 'fine-dining',
    parentVertical: 'restaurant',
    title: 'Fine Dining',
    description: 'Reservation-first with longer turn times and VIP guest tracking.',
    icon: '🥂',
    overrides: {
      experienceProfile: {
        vocabulary: {
          customerLabel: 'Guest',
          bookingLabel: 'Reservation',
          queueLabel: 'Guest List',
        },
        kiosk: {
          welcomeMessage: 'Welcome — check in your reservation',
          headerText: 'Guest reception',
          themeColor: '#1e1b4b',
          buttonLabel: 'Check In',
        },
        publicJoin: {
          headline: 'Your table awaits',
          subheadline: 'We\'ll notify you the moment your table is ready.',
        },
        messagingTone: 'professional',
        branding: { recommendedPrimaryColor: '#1e1b4b' },
      },
      defaultSlas: [
        { metric: 'seat_wait', label: 'Seating wait under', targetMinutes: 10 },
        { metric: 'reservation_hold', label: 'Hold reservation for', targetMinutes: 15 },
      ],
      onboardingCopy: {
        headline: 'Set up fine dining reception',
        description: 'Reservation-first guest management with a polished experience.',
      },
    },
  },
  {
    id: 'fast-casual',
    parentVertical: 'restaurant',
    title: 'Fast Casual / Counter',
    description: 'Quick-service with order queue and minimal wait times.',
    icon: '🍔',
    overrides: {
      experienceProfile: {
        vocabulary: {
          deskLabel: 'Counter',
          customerLabel: 'Customer',
          bookingLabel: 'Order',
          queueLabel: 'Order Queue',
        },
        kiosk: {
          welcomeMessage: 'Place your order',
          headerText: 'Order here',
          themeColor: '#ea580c',
          buttonLabel: 'Join Queue',
        },
        publicJoin: {
          headline: 'Your order is being prepared',
          subheadline: 'We\'ll call your name when it\'s ready.',
        },
        messagingTone: 'friendly',
        branding: { recommendedPrimaryColor: '#ea580c' },
      },
      defaultSlas: [
        { metric: 'seat_wait', label: 'Average wait under', targetMinutes: 10 },
      ],
      onboardingCopy: {
        headline: 'Set up a counter-service flow',
        description: 'Quick order queue with fast turnover.',
      },
    },
  },
  {
    id: 'cafe',
    parentVertical: 'restaurant',
    title: 'Cafe / Coffee Shop',
    description: 'Simple order queue with pickup notifications.',
    icon: '☕',
    overrides: {
      experienceProfile: {
        vocabulary: {
          deskLabel: 'Bar',
          customerLabel: 'Customer',
          bookingLabel: 'Order',
          queueLabel: 'Order Queue',
        },
        kiosk: {
          welcomeMessage: 'Join the queue',
          headerText: 'Order pickup',
          themeColor: '#78350f',
          buttonLabel: 'Get in Line',
        },
        publicJoin: {
          headline: 'Your drink is coming up',
          subheadline: 'We\'ll let you know when your order is ready.',
        },
        branding: { recommendedPrimaryColor: '#78350f' },
      },
      defaultSlas: [
        { metric: 'seat_wait', label: 'Average wait under', targetMinutes: 8 },
      ],
    },
  },
];

const BANK_PROFILES: TemplateProfile[] = [
  {
    id: 'retail-bank',
    parentVertical: 'bank',
    title: 'Retail Bank',
    description: 'Full-service branch with teller and advisory departments.',
    icon: '🏦',
    overrides: {},  // Uses bank defaults
  },
  {
    id: 'credit-union',
    parentVertical: 'bank',
    title: 'Credit Union',
    description: 'Member-focused with simplified services and friendly tone.',
    icon: '🤝',
    overrides: {
      experienceProfile: {
        vocabulary: {
          customerLabel: 'Member',
          queueLabel: 'Member Queue',
        },
        kiosk: {
          welcomeMessage: 'Welcome, member',
          headerText: 'Member check-in',
        },
        publicJoin: {
          headline: 'Your visit, timed for you',
          subheadline: 'Track your place and arrive when your representative is ready.',
        },
        messagingTone: 'friendly',
      },
      onboardingCopy: {
        headline: 'Set up your credit union branch',
        description: 'Member-first queue with personal service routing.',
      },
    },
  },
  {
    id: 'investment-office',
    parentVertical: 'bank',
    title: 'Investment Office',
    description: 'Appointment-only advisory with consultation rooms.',
    icon: '📈',
    overrides: {
      experienceProfile: {
        vocabulary: {
          departmentLabel: 'Advisory Area',
          serviceLabel: 'Consultation Type',
          deskLabel: 'Office',
          customerLabel: 'Client',
          bookingLabel: 'Consultation',
          queueLabel: 'Client Queue',
        },
        kiosk: {
          welcomeMessage: 'Welcome to your consultation',
          headerText: 'Client check-in',
          themeColor: '#0c4a6e',
        },
        branding: { recommendedPrimaryColor: '#0c4a6e' },
        messagingTone: 'professional',
      },
      starterDepartments: [
        {
          name: 'Advisory', code: 'A', sortOrder: 1,
          services: [
            { name: 'Portfolio Review', code: 'PORTFOLIO', estimatedServiceTime: 30, sortOrder: 1 },
            { name: 'New Account', code: 'OPEN', estimatedServiceTime: 45, sortOrder: 2 },
            { name: 'Retirement Planning', code: 'RETIRE', estimatedServiceTime: 40, sortOrder: 3 },
          ],
        },
      ],
      defaultSlas: [
        { metric: 'advisor_wait', label: 'Advisor wait under', targetMinutes: 10 },
      ],
    },
  },
];

const BARBERSHOP_PROFILES: TemplateProfile[] = [
  {
    id: 'barbershop-classic',
    parentVertical: 'barbershop',
    title: 'Barbershop',
    description: 'Classic barbershop with walk-in waitlist and preferred barber routing.',
    icon: '💈',
    overrides: {},  // Uses barbershop defaults
  },
  {
    id: 'hair-salon',
    parentVertical: 'barbershop',
    title: 'Hair Salon',
    description: 'Full-service salon with color, styling, and appointment support.',
    icon: '💇',
    overrides: {
      experienceProfile: {
        vocabulary: {
          officeLabel: 'Salon',
          deskLabel: 'Station',
          customerLabel: 'Client',
        },
        kiosk: {
          welcomeMessage: 'Welcome to the salon',
          headerText: 'Salon check-in',
          themeColor: '#be185d',
          buttonLabel: 'Check In',
        },
        publicJoin: {
          headline: 'Your stylist is almost ready',
          subheadline: 'Track your turn and arrive when your station is free.',
          namedPartyLabel: 'Client name',
        },
        branding: { recommendedPrimaryColor: '#be185d' },
      },
      starterDepartments: [
        {
          name: 'Salon Queue', code: 'S', sortOrder: 1,
          services: [
            { name: 'Haircut', code: 'CUT', estimatedServiceTime: 30, sortOrder: 1 },
            { name: 'Color', code: 'COLOR', estimatedServiceTime: 60, sortOrder: 2 },
            { name: 'Blowout', code: 'BLOW', estimatedServiceTime: 25, sortOrder: 3 },
            { name: 'Treatment', code: 'TREAT', estimatedServiceTime: 40, sortOrder: 4 },
          ],
        },
      ],
      onboardingCopy: {
        headline: 'Launch your salon waitlist',
        description: 'Client-first flow with stylist preference routing.',
      },
    },
  },
  {
    id: 'nail-studio',
    parentVertical: 'barbershop',
    title: 'Nail Studio',
    description: 'Walk-in and appointment nail services with technician routing.',
    icon: '💅',
    overrides: {
      experienceProfile: {
        vocabulary: {
          officeLabel: 'Studio',
          deskLabel: 'Station',
          customerLabel: 'Client',
          serviceLabel: 'Treatment',
        },
        kiosk: {
          welcomeMessage: 'Welcome to the studio',
          headerText: 'Nail studio check-in',
          themeColor: '#db2777',
          buttonLabel: 'Check In',
        },
        publicJoin: {
          headline: 'Your technician is almost ready',
          subheadline: 'Relax — we\'ll call you when your station is free.',
        },
        branding: { recommendedPrimaryColor: '#db2777' },
      },
      starterDepartments: [
        {
          name: 'Nail Queue', code: 'N', sortOrder: 1,
          services: [
            { name: 'Manicure', code: 'MANI', estimatedServiceTime: 30, sortOrder: 1 },
            { name: 'Pedicure', code: 'PEDI', estimatedServiceTime: 40, sortOrder: 2 },
            { name: 'Gel Set', code: 'GEL', estimatedServiceTime: 45, sortOrder: 3 },
            { name: 'Nail Art', code: 'ART', estimatedServiceTime: 50, sortOrder: 4 },
          ],
        },
      ],
    },
  },
  {
    id: 'med-spa',
    parentVertical: 'barbershop',
    title: 'Med Spa',
    description: 'Appointment-focused wellness services with intake forms.',
    icon: '🧖',
    overrides: {
      experienceProfile: {
        vocabulary: {
          officeLabel: 'Spa',
          deskLabel: 'Treatment Room',
          customerLabel: 'Client',
          serviceLabel: 'Treatment',
          bookingLabel: 'Appointment',
          queueLabel: 'Client Queue',
        },
        kiosk: {
          welcomeMessage: 'Welcome to your appointment',
          headerText: 'Spa check-in',
          themeColor: '#059669',
          buttonLabel: 'Check In',
        },
        publicJoin: {
          headline: 'Your treatment is coming up',
          subheadline: 'Relax — we\'ll call you when your room is ready.',
        },
        messagingTone: 'professional',
        branding: { recommendedPrimaryColor: '#059669' },
      },
      starterDepartments: [
        {
          name: 'Treatments', code: 'T', sortOrder: 1,
          services: [
            { name: 'Facial', code: 'FACIAL', estimatedServiceTime: 45, sortOrder: 1 },
            { name: 'Massage', code: 'MASSAGE', estimatedServiceTime: 60, sortOrder: 2 },
            { name: 'Body Treatment', code: 'BODY', estimatedServiceTime: 50, sortOrder: 3 },
            { name: 'Consultation', code: 'CONSULT', estimatedServiceTime: 20, sortOrder: 4 },
          ],
        },
      ],
    },
  },
];

const PUBLIC_SERVICE_PROFILES: TemplateProfile[] = [
  {
    id: 'government-office',
    parentVertical: 'public_service',
    title: 'Government Office',
    description: 'Multi-department public service with ticket numbers and display boards.',
    icon: '🏛️',
    overrides: {},  // Uses public-service defaults
  },
  {
    id: 'post-office',
    parentVertical: 'public_service',
    title: 'Post Office',
    description: 'Mail, parcels, and financial services with counter routing.',
    icon: '📮',
    overrides: {
      experienceProfile: {
        vocabulary: {
          officeLabel: 'Post Office',
          deskLabel: 'Window',
        },
        kiosk: {
          welcomeMessage: 'Select your service',
          headerText: 'Post office',
        },
      },
      onboardingCopy: {
        headline: 'Set up a post office queue',
        description: 'Department-first routing for mail, parcels, and financial services.',
      },
    },
  },
  {
    id: 'dmv',
    parentVertical: 'public_service',
    title: 'Motor Vehicle / DMV',
    description: 'High-volume processing with appointment and walk-in lanes.',
    icon: '🚗',
    overrides: {
      experienceProfile: {
        vocabulary: {
          officeLabel: 'Office',
          serviceLabel: 'Transaction',
          deskLabel: 'Window',
        },
        kiosk: {
          welcomeMessage: 'Select your transaction type',
          headerText: 'DMV check-in',
        },
      },
      starterDepartments: [
        {
          name: 'Renewals', code: 'R', sortOrder: 1,
          services: [
            { name: 'License Renewal', code: 'LICENSE', estimatedServiceTime: 10, sortOrder: 1 },
            { name: 'Registration Renewal', code: 'REG', estimatedServiceTime: 8, sortOrder: 2 },
          ],
        },
        {
          name: 'New Applications', code: 'N', sortOrder: 2,
          services: [
            { name: 'New License', code: 'NEW', estimatedServiceTime: 25, sortOrder: 1 },
            { name: 'Title Transfer', code: 'TITLE', estimatedServiceTime: 15, sortOrder: 2 },
            { name: 'ID Card', code: 'ID', estimatedServiceTime: 12, sortOrder: 3 },
          ],
        },
      ],
      defaultSlas: [
        { metric: 'first_call', label: 'First call within', targetMinutes: 25 },
        { metric: 'average_wait', label: 'Average wait under', targetMinutes: 30 },
      ],
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

/** All profiles indexed by parent vertical */
const ALL_PROFILES: Record<IndustryVertical, TemplateProfile[]> = {
  public_service: PUBLIC_SERVICE_PROFILES,
  bank: BANK_PROFILES,
  clinic: CLINIC_PROFILES,
  restaurant: RESTAURANT_PROFILES,
  barbershop: BARBERSHOP_PROFILES,
};

/** Get all available profiles for a given vertical */
export function getProfilesForVertical(vertical: IndustryVertical): TemplateProfile[] {
  return ALL_PROFILES[vertical] ?? [];
}

/** Get a specific profile by ID */
export function getProfileById(profileId: string): TemplateProfile | undefined {
  for (const profiles of Object.values(ALL_PROFILES)) {
    const found = profiles.find((p) => p.id === profileId);
    if (found) return found;
  }
  return undefined;
}

/** Get the default profile for a vertical (first in the list) */
export function getDefaultProfileId(vertical: IndustryVertical): string {
  const profiles = ALL_PROFILES[vertical];
  return profiles?.[0]?.id ?? '';
}

/**
 * Apply a profile's overrides to a resolved IndustryTemplate.
 *
 * This modifies the template's experience profile, starter offices, intake schemas,
 * SLAs, and onboarding copy based on the profile selection.
 */
export function applyProfile(
  template: IndustryTemplate,
  profileId: string,
): IndustryTemplate {
  const profile = getProfileById(profileId);
  if (!profile || Object.keys(profile.overrides).length === 0) return template;

  const overrides = profile.overrides;
  let result = { ...template };

  // Merge experience profile overrides
  if (overrides.experienceProfile) {
    result.experienceProfile = deepMergeRecords(
      result.experienceProfile as unknown as Record<string, unknown>,
      overrides.experienceProfile as unknown as Record<string, unknown>,
    ) as unknown as IndustryTemplate['experienceProfile'];
  }

  // Replace starter departments in all starter offices
  if (overrides.starterDepartments && result.starterOffices.length > 0) {
    result.starterOffices = result.starterOffices.map((office) => ({
      ...office,
      departments: overrides.starterDepartments!,
    }));
  }

  // Replace intake schemas
  if (overrides.intakeSchemas) {
    result.intakeSchemas = overrides.intakeSchemas;
  }

  // Replace SLAs
  if (overrides.defaultSlas) {
    result.defaultSlas = overrides.defaultSlas;
  }

  // Merge onboarding copy
  if (overrides.onboardingCopy) {
    result.onboardingCopy = { ...result.onboardingCopy, ...overrides.onboardingCopy };
  }

  return result;
}
