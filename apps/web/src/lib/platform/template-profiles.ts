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
  StarterDeskTemplate,
  IntakeSchema,
  CapabilityFlags,
} from '@qflo/shared';
import { deepMergeRecords } from '@qflo/shared';

// ── Profile definition ──────────────────────────────────────────────────────

export interface TemplateProfile {
  id: string;
  parentVertical: IndustryVertical;
  title: string;
  description: string;
  icon: string;
  /**
   * @deprecated No longer used — the catalog is now universal across all
   * countries. Kept on the interface so existing call sites don't break
   * if any external data sets it. Every profile is available everywhere
   * and operators rename the starter departments/services to match local
   * terminology after setup. Country-specific overlays (payment rails,
   * tax rules, compliance copy) live elsewhere — not in this file.
   */
  countries?: string[];
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
    /** Replace starter desks (auto-generated from departments if omitted) */
    starterDesks?: StarterDeskTemplate[];
    /** Replace intake schemas entirely */
    intakeSchemas?: IntakeSchema[];
    /** Override default SLAs */
    defaultSlas?: IndustryTemplate['defaultSlas'];
    /** Override onboarding copy */
    onboardingCopy?: Partial<IndustryTemplate['onboardingCopy']>;
    /** Override capability flags */
    capabilityFlags?: Partial<CapabilityFlags>;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  PROFILE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

const CLINIC_PROFILES: TemplateProfile[] = [
  {
    id: 'solo-doctor',
    parentVertical: 'clinic',
    title: 'Solo Doctor Office',
    description: 'Simple setup — secretary desk upfront, doctor sees patients in the cabinet.',
    icon: '👨‍⚕️',
    overrides: {},  // Uses the clinic defaults (solo doctor office)
  },
  {
    id: 'doctor-premium',
    parentVertical: 'clinic',
    title: 'Doctor Premium',
    description: 'Full-featured doctor\'s office — appointments, WhatsApp notifications, patient history, intake forms, and remote queue.',
    icon: '⭐',
    overrides: {
      capabilityFlags: {
        appointments: true,
        kiosk: true,
        intakeForms: true,
        customerHistory: true,
        feedback: true,
        virtualJoin: true,
        staffAssignment: true,
        controllerHost: true,
      },
      experienceProfile: {
        kiosk: {
          welcomeMessage: 'Welcome — check in',
          headerText: 'Doctor\'s office',
          themeColor: '#2563eb',
          buttonLabel: 'Check in',
          showEstimatedTime: true,
        },
        publicJoin: {
          headline: 'Your appointment',
          subheadline: 'Track your place in line — we\'ll notify you when the doctor is ready.',
        },
      },
      starterDepartments: [
        {
          name: 'Consultations', code: 'C', sortOrder: 1,
          services: [
            { name: 'General Consultation', code: 'CONSULT', estimatedServiceTime: 20, sortOrder: 1 },
            { name: 'Follow-up', code: 'CONTROL', estimatedServiceTime: 15, sortOrder: 2 },
            { name: 'Medical Certificate', code: 'CERT', estimatedServiceTime: 10, sortOrder: 3 },
            { name: 'Urgent Visit', code: 'URGENT', estimatedServiceTime: 15, sortOrder: 4 },
            { name: 'Specialist Consultation', code: 'SPECIAL', estimatedServiceTime: 30, sortOrder: 5 },
            { name: 'Procedure', code: 'ACTE', estimatedServiceTime: 25, sortOrder: 6 },
          ],
        },
      ],
      intakeSchemas: [
        {
          serviceCode: 'CONSULT',
          title: 'Patient intake',
          fields: [
            { key: 'patient_name', label: 'Patient name', type: 'text', required: true, visibility: 'public' },
            { key: 'phone', label: 'Phone number', type: 'phone', required: true, visibility: 'public' },
            { key: 'date_of_birth', label: 'Date of birth', type: 'text', required: false, visibility: 'staff_only' },
            { key: 'motif', label: 'Reason for visit', type: 'textarea', required: true, visibility: 'staff_only' },
          ],
          complianceNotes: [],
        },
      ],
      defaultSlas: [
        { metric: 'patient_wait', label: 'Patient wait under', targetMinutes: 15 },
        { metric: 'check_in', label: 'Check in under', targetMinutes: 3 },
      ],
      onboardingCopy: {
        headline: 'Full-featured doctor\'s office',
        description: 'Appointments, WhatsApp notifications, patient history, intake forms, and remote queue — all included.',
        reviewChecklist: [
          'Configure consultation types',
          'Enable WhatsApp notifications',
          'Configure the appointment calendar',
          'Customize the patient intake form',
        ],
      },
    },
  },
  {
    id: 'multi-doctor',
    parentVertical: 'clinic',
    title: 'Multi-Doctor Practice',
    description: 'Multiple doctors sharing a practice with 3-4 exam rooms and a shared reception.',
    icon: '🏥',
    overrides: {
      starterDepartments: [
        {
          name: 'Consultations', code: 'C', sortOrder: 1,
          services: [
            { name: 'General Consultation', code: 'CONSULT', estimatedServiceTime: 20, sortOrder: 1 },
            { name: 'Follow-up', code: 'CONTROL', estimatedServiceTime: 15, sortOrder: 2 },
            { name: 'Medical Certificate', code: 'CERT', estimatedServiceTime: 10, sortOrder: 3 },
            { name: 'Urgent Visit', code: 'URGENT', estimatedServiceTime: 15, sortOrder: 4 },
          ],
        },
      ],
      onboardingCopy: {
        headline: 'Set up your multi-doctor practice',
        description: 'Shared reception with multiple exam rooms and doctors.',
      },
    },
  },
  {
    id: 'dental-practice',
    parentVertical: 'clinic',
    title: 'Dental Practice',
    description: 'Dental-specific services — cleanings, fillings, extractions, and emergencies.',
    icon: '🦷',
    overrides: {
      experienceProfile: {
        vocabulary: {
          serviceLabel: 'Treatment',
          deskLabel: 'Chair',
          bookingLabel: 'Appointment',
        },
        kiosk: {
          welcomeMessage: 'Welcome — check in',
          headerText: 'Dental office',
          themeColor: '#0891b2',
          buttonLabel: 'Check in',
        },
        publicJoin: {
          headline: 'Your dental appointment',
          subheadline: 'The dentist will see you as soon as possible.',
        },
        branding: { recommendedPrimaryColor: '#0891b2' },
      },
      starterDepartments: [
        {
          name: 'Dental Care', code: 'D', sortOrder: 1,
          services: [
            { name: 'Cleaning', code: 'CLEANING', estimatedServiceTime: 30, sortOrder: 1 },
            { name: 'Filling', code: 'FILLING', estimatedServiceTime: 40, sortOrder: 2 },
            { name: 'Extraction', code: 'EXTRACT', estimatedServiceTime: 30, sortOrder: 3 },
            { name: 'Consultation', code: 'CONSULT', estimatedServiceTime: 15, sortOrder: 4 },
            { name: 'Dental Emergency', code: 'EMERGENCY', estimatedServiceTime: 25, sortOrder: 5 },
          ],
        },
      ],
      defaultSlas: [
        { metric: 'patient_wait', label: 'Patient wait under', targetMinutes: 15 },
      ],
    },
  },
  {
    id: 'clinique',
    parentVertical: 'clinic',
    title: 'Polyclinic',
    description: 'Multi-department polyclinic — reception, general medicine, specialists, lab, and imaging.',
    icon: '🏨',
    overrides: {
      experienceProfile: {
        vocabulary: {
          officeLabel: 'Clinic',
          departmentLabel: 'Department',
          serviceLabel: 'Service',
          deskLabel: 'Office',
        },
        kiosk: {
          welcomeMessage: 'Welcome — choose your service',
          headerText: 'Registration',
          themeColor: '#1d4ed8',
          buttonLabel: 'Check in',
          showPriorities: true,
        },
        publicJoin: {
          headline: 'Your visit',
          subheadline: 'Track your place in line from your phone.',
        },
        branding: { recommendedPrimaryColor: '#1d4ed8' },
      },
      starterDepartments: [
        {
          name: 'Reception', code: 'A', sortOrder: 1,
          services: [
            { name: 'Check in', code: 'REGISTER', estimatedServiceTime: 5, sortOrder: 1 },
            { name: 'Record verification', code: 'VERIFY', estimatedServiceTime: 8, sortOrder: 2 },
          ],
        },
        {
          name: 'General Medicine', code: 'MG', sortOrder: 2,
          services: [
            { name: 'General consultation', code: 'CONSULT', estimatedServiceTime: 20, sortOrder: 1 },
            { name: 'Follow-up', code: 'CONTROL', estimatedServiceTime: 15, sortOrder: 2 },
          ],
        },
        {
          name: 'Specialties', code: 'SP', sortOrder: 3,
          services: [
            { name: 'Specialist consultation', code: 'SPECIALIST', estimatedServiceTime: 25, sortOrder: 1 },
            { name: 'Specialist opinion', code: 'OPINION', estimatedServiceTime: 20, sortOrder: 2 },
          ],
        },
        {
          name: 'Laboratory', code: 'LAB', sortOrder: 4,
          services: [
            { name: 'Blood draw', code: 'BLOOD', estimatedServiceTime: 10, sortOrder: 1 },
            { name: 'Results', code: 'RESULTS', estimatedServiceTime: 5, sortOrder: 2 },
          ],
        },
        {
          name: 'Imaging', code: 'IMG', sortOrder: 5,
          services: [
            { name: 'X-ray', code: 'XRAY', estimatedServiceTime: 15, sortOrder: 1 },
            { name: 'Ultrasound', code: 'ECHO', estimatedServiceTime: 20, sortOrder: 2 },
          ],
        },
      ],
      defaultSlas: [
        { metric: 'check_in', label: 'Check in under', targetMinutes: 5 },
        { metric: 'patient_wait', label: 'Patient wait under', targetMinutes: 25 },
      ],
      onboardingCopy: {
        headline: 'Set up your clinic',
        description: 'Multi-department polyclinic — reception, general medicine, specialties, laboratory, and imaging.',
      },
    },
  },
  {
    id: 'specialist-office',
    parentVertical: 'clinic',
    title: 'Specialist Office',
    description: 'Appointment-focused specialist — longer consultations, fewer walk-ins.',
    icon: '🩺',
    overrides: {
      experienceProfile: {
        vocabulary: {
          serviceLabel: 'Consultation',
          deskLabel: 'Office',
        },
        publicJoin: {
          headline: 'Your specialist appointment',
          subheadline: 'The specialist will see you as soon as possible.',
        },
      },
      starterDepartments: [
        {
          name: 'Consultations', code: 'C', sortOrder: 1,
          services: [
            { name: 'First consultation', code: 'FIRST', estimatedServiceTime: 30, sortOrder: 1 },
            { name: 'Follow-up', code: 'FOLLOWUP', estimatedServiceTime: 20, sortOrder: 2 },
            { name: 'Medical procedure', code: 'PROCEDURE', estimatedServiceTime: 40, sortOrder: 3 },
          ],
        },
      ],
      defaultSlas: [
        { metric: 'patient_wait', label: 'Patient wait under', targetMinutes: 15 },
      ],
    },
  },
];

const RESTAURANT_PROFILES: TemplateProfile[] = [
  {
    id: 'restaurant-simple',
    parentVertical: 'restaurant',
    title: 'Simple Restaurant',
    description: 'Dine-in, takeout, and delivery — the most common setup.',
    icon: '🍽️',
    overrides: {},  // Uses the restaurant defaults
  },
  {
    id: 'fast-food',
    parentVertical: 'restaurant',
    title: 'Fast Food',
    description: 'Quick counter service — order, prep, pickup.',
    icon: '🌮',
    overrides: {
      experienceProfile: {
        vocabulary: {
          serviceLabel: 'Order',
          deskLabel: 'Counter',
          queueLabel: 'Order queue',
        },
        kiosk: {
          welcomeMessage: 'Place your order',
          headerText: 'Order here',
          themeColor: '#ea580c',
          buttonLabel: 'Order',
        },
        publicJoin: {
          headline: 'Your order is being prepared',
          subheadline: 'We\'ll call you when it\'s ready.',
        },
        branding: { recommendedPrimaryColor: '#ea580c' },
      },
      starterDepartments: [
        {
          name: 'Counter', code: 'C', sortOrder: 1,
          services: [
            { name: 'Order', code: 'ORDER', estimatedServiceTime: 5, sortOrder: 1 },
            { name: 'Pickup', code: 'PICKUP', estimatedServiceTime: 3, sortOrder: 2 },
            { name: 'Takeout', code: 'TAKEOUT', estimatedServiceTime: 8, sortOrder: 3 },
          ],
        },
      ],
      defaultSlas: [
        { metric: 'order_wait', label: 'Order wait under', targetMinutes: 8 },
      ],
      onboardingCopy: {
        headline: 'Set up your fast food',
        description: 'Quick counter flow — order, prep, and pickup.',
      },
    },
  },
  {
    id: 'grillades',
    parentVertical: 'restaurant',
    title: 'Sit-Down Restaurant',
    description: 'Traditional sit-down restaurant with dining room and reservations.',
    icon: '🥩',
    overrides: {
      experienceProfile: {
        vocabulary: {
          serviceLabel: 'Service',
          bookingLabel: 'Reservation',
        },
        publicJoin: {
          headline: 'Your table is almost ready',
          subheadline: 'We\'ll let you know as soon as a table opens up.',
        },
      },
      starterDepartments: [
        {
          name: 'Service', code: 'S', sortOrder: 1,
          services: [
            { name: 'Dine in', code: 'DINE', estimatedServiceTime: 40, sortOrder: 1 },
            { name: 'Reservation', code: 'RSVP', estimatedServiceTime: 5, sortOrder: 2 },
            { name: 'Takeout', code: 'TAKEOUT', estimatedServiceTime: 15, sortOrder: 3 },
          ],
        },
      ],
      defaultSlas: [
        { metric: 'seat_wait', label: 'Table wait under', targetMinutes: 20 },
      ],
      onboardingCopy: {
        headline: 'Set up your sit-down restaurant',
        description: 'Full-service dining with reservations and takeout.',
      },
    },
  },
  {
    id: 'pizzeria',
    parentVertical: 'restaurant',
    title: 'Pizzeria',
    description: 'Dine-in, takeout, and delivery — optimized for pizza.',
    icon: '🍕',
    overrides: {
      experienceProfile: {
        vocabulary: {
          serviceLabel: 'Order',
        },
        kiosk: {
          themeColor: '#b91c1c',
        },
        branding: { recommendedPrimaryColor: '#b91c1c' },
      },
      starterDepartments: [
        {
          name: 'Service', code: 'S', sortOrder: 1,
          services: [
            { name: 'Dine in', code: 'DINE', estimatedServiceTime: 25, sortOrder: 1 },
            { name: 'Takeout', code: 'TAKEOUT', estimatedServiceTime: 15, sortOrder: 2 },
            { name: 'Delivery', code: 'DELIVERY', estimatedServiceTime: 5, sortOrder: 3 },
          ],
        },
      ],
    },
  },
  {
    id: 'cafe',
    parentVertical: 'restaurant',
    title: 'Café',
    description: 'Café with indoor seating and terrace — casual atmosphere, simple service.',
    icon: '☕',
    overrides: {
      experienceProfile: {
        vocabulary: {
          officeLabel: 'Café',
          serviceLabel: 'Order',
          deskLabel: 'Counter',
          queueLabel: 'Waitlist',
        },
        kiosk: {
          welcomeMessage: 'Welcome to the café',
          headerText: 'Order here',
          themeColor: '#78350f',
          buttonLabel: 'Order',
        },
        publicJoin: {
          headline: 'Your order is on the way',
          subheadline: 'We\'ll call you when it\'s ready.',
        },
        branding: { recommendedPrimaryColor: '#78350f' },
      },
      starterDepartments: [
        {
          name: 'Service', code: 'S', sortOrder: 1,
          services: [
            { name: 'Dine in', code: 'DINE', estimatedServiceTime: 5, sortOrder: 1 },
            { name: 'Takeout', code: 'TAKEOUT', estimatedServiceTime: 3, sortOrder: 2 },
          ],
        },
      ],
      defaultSlas: [
        { metric: 'order_wait', label: 'Order wait under', targetMinutes: 5 },
      ],
    },
  },
  {
    id: 'fine-dining',
    parentVertical: 'restaurant',
    title: 'Fine Dining',
    description: 'Reservation-first, upscale service with VIP follow-up.',
    icon: '🥂',
    overrides: {
      experienceProfile: {
        vocabulary: {
          customerLabel: 'Guest',
          bookingLabel: 'Reservation',
          queueLabel: 'Guest list',
        },
        kiosk: {
          welcomeMessage: 'Welcome — check in for your reservation',
          headerText: 'Reception',
          themeColor: '#1e1b4b',
          buttonLabel: 'Check in',
        },
        publicJoin: {
          headline: 'Your table is waiting',
          subheadline: 'We\'ll let you know as soon as your table is ready.',
        },
        messagingTone: 'professional',
        branding: { recommendedPrimaryColor: '#1e1b4b' },
      },
      starterDepartments: [
        {
          name: 'Service', code: 'S', sortOrder: 1,
          services: [
            { name: 'Reservation', code: 'RSVP', estimatedServiceTime: 5, sortOrder: 1 },
            { name: 'Dine in', code: 'DINE', estimatedServiceTime: 60, sortOrder: 2 },
          ],
        },
      ],
      defaultSlas: [
        { metric: 'seat_wait', label: 'Table wait under', targetMinutes: 5 },
      ],
      onboardingCopy: {
        headline: 'Set up your fine dining restaurant',
        description: 'Reservation-first flow with personalized guest follow-up.',
      },
    },
  },
];

const BANK_PROFILES: TemplateProfile[] = [
  {
    id: 'bank-branch',
    parentVertical: 'bank',
    title: 'Bank Branch',
    description: 'Full branch — teller, operations, and advisor services.',
    icon: '🏦',
    overrides: {},  // Uses bank defaults
  },
  {
    id: 'post-office',
    parentVertical: 'bank',
    title: 'Post Office',
    description: 'Mail, parcels, money transfers, and financial services.',
    icon: '📮',
    overrides: {
      experienceProfile: {
        vocabulary: {
          officeLabel: 'Post Office',
          serviceLabel: 'Service',
          queueLabel: 'Queue',
        },
        kiosk: {
          welcomeMessage: 'Select your service',
          headerText: 'Welcome to the post office',
          themeColor: '#1d4ed8',
          buttonLabel: 'Get a ticket',
        },
        branding: { recommendedPrimaryColor: '#1d4ed8' },
      },
      starterDepartments: [
        {
          name: 'Mail & Parcels', code: 'MP', sortOrder: 1,
          services: [
            { name: 'Send Mail', code: 'MAIL', estimatedServiceTime: 5, sortOrder: 1 },
            { name: 'Send Parcel', code: 'PARCEL', estimatedServiceTime: 8, sortOrder: 2 },
            { name: 'Pick Up Parcel', code: 'PICKUP_PARCEL', estimatedServiceTime: 5, sortOrder: 3 },
          ],
        },
        {
          name: 'Financial Services', code: 'FS', sortOrder: 2,
          services: [
            { name: 'Cash Withdrawal', code: 'WITHDRAW', estimatedServiceTime: 7, sortOrder: 1 },
            { name: 'Money Transfer', code: 'TRANSFER', estimatedServiceTime: 10, sortOrder: 2 },
            { name: 'Deposit', code: 'DEPOSIT', estimatedServiceTime: 8, sortOrder: 3 },
          ],
        },
      ],
      onboardingCopy: {
        headline: 'Set up your post office',
        description: 'Mail, parcels, money transfers, and financial services.',
      },
    },
  },
  {
    id: 'insurance-branch',
    parentVertical: 'bank',
    title: 'Insurance Branch',
    description: 'Claims, new policies, and policy renewals.',
    icon: '🛡️',
    overrides: {
      experienceProfile: {
        vocabulary: {
          officeLabel: 'Insurance Branch',
          serviceLabel: 'Service',
          customerLabel: 'Policyholder',
        },
        kiosk: {
          welcomeMessage: 'Welcome — select your service',
          headerText: 'Insurance services',
          themeColor: '#0369a1',
          buttonLabel: 'Get a ticket',
        },
        branding: { recommendedPrimaryColor: '#0369a1' },
      },
      starterDepartments: [
        {
          name: 'Claims', code: 'CL', sortOrder: 1,
          services: [
            { name: 'File a Claim', code: 'FILE_CLAIM', estimatedServiceTime: 20, sortOrder: 1 },
            { name: 'Claim Follow-up', code: 'CLAIM_FOLLOW', estimatedServiceTime: 10, sortOrder: 2 },
          ],
        },
        {
          name: 'Policies', code: 'PO', sortOrder: 2,
          services: [
            { name: 'New Policy', code: 'NEW_POLICY', estimatedServiceTime: 25, sortOrder: 1 },
            { name: 'Policy Renewal', code: 'RENEW', estimatedServiceTime: 15, sortOrder: 2 },
            { name: 'Certificate of Coverage', code: 'CERT', estimatedServiceTime: 8, sortOrder: 3 },
          ],
        },
      ],
      onboardingCopy: {
        headline: 'Set up your insurance branch',
        description: 'Claims, new policies, and renewals.',
      },
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
  // Universal public-service profiles — no country-specific hardcoding.
  // Every country sees the same list. Operators rename the starter
  // departments/services to match local terminology after setup.
  {
    id: 'city-hall',
    parentVertical: 'public_service',
    title: 'City Hall / Municipal Office',
    description: 'Permits, licenses, vital records, and community services.',
    icon: '🏛️',
    overrides: {
      experienceProfile: {
        vocabulary: {
          officeLabel: 'City Hall',
          customerLabel: 'Resident',
        },
        kiosk: {
          welcomeMessage: 'Welcome to City Hall',
          headerText: 'Municipal services',
        },
      },
      starterDepartments: [
        {
          name: 'Vital Records', code: 'VR', sortOrder: 1,
          services: [
            { name: 'Birth Certificate', code: 'BIRTH', estimatedServiceTime: 10, sortOrder: 1 },
            { name: 'Marriage License', code: 'MARRIAGE', estimatedServiceTime: 15, sortOrder: 2 },
            { name: 'Death Certificate', code: 'DEATH', estimatedServiceTime: 10, sortOrder: 3 },
          ],
        },
        {
          name: 'Permits & Licensing', code: 'PL', sortOrder: 2,
          services: [
            { name: 'Building Permit', code: 'BUILD', estimatedServiceTime: 20, sortOrder: 1 },
            { name: 'Business License', code: 'BIZ', estimatedServiceTime: 15, sortOrder: 2 },
            { name: 'Parking Permit', code: 'PARK', estimatedServiceTime: 8, sortOrder: 3 },
          ],
        },
        {
          name: 'Resident Services', code: 'RS', sortOrder: 3,
          services: [
            { name: 'Utility Account', code: 'UTIL', estimatedServiceTime: 10, sortOrder: 1 },
            { name: 'Tax Inquiry', code: 'TAX', estimatedServiceTime: 12, sortOrder: 2 },
            { name: 'General Inquiry', code: 'INFO', estimatedServiceTime: 5, sortOrder: 3 },
          ],
        },
      ],
      onboardingCopy: {
        headline: 'Set up your City Hall',
        description: 'Vital records, permits, licenses, and resident services.',
      },
    },
  },
  {
    id: 'dmv-office',
    parentVertical: 'public_service',
    title: 'Motor Vehicle Office',
    description: 'Driver licenses, vehicle registration, and titles.',
    icon: '🚗',
    overrides: {
      experienceProfile: {
        vocabulary: {
          officeLabel: 'Motor Vehicle Office',
          customerLabel: 'Customer',
          serviceLabel: 'Transaction',
        },
        kiosk: {
          welcomeMessage: 'Welcome — select your transaction',
          headerText: 'Motor vehicle services',
          themeColor: '#1d4ed8',
          buttonLabel: 'Get in line',
        },
        branding: { recommendedPrimaryColor: '#1d4ed8' },
      },
      starterDepartments: [
        {
          name: 'Driver Services', code: 'DR', sortOrder: 1,
          services: [
            { name: 'New Driver License', code: 'NEW_DL', estimatedServiceTime: 20, sortOrder: 1 },
            { name: 'License Renewal', code: 'RENEW_DL', estimatedServiceTime: 10, sortOrder: 2 },
            { name: 'ID Card', code: 'ID', estimatedServiceTime: 12, sortOrder: 3 },
            { name: 'Road Test', code: 'ROAD', estimatedServiceTime: 30, sortOrder: 4 },
          ],
        },
        {
          name: 'Vehicle Services', code: 'VH', sortOrder: 2,
          services: [
            { name: 'Title Transfer', code: 'TITLE', estimatedServiceTime: 15, sortOrder: 1 },
            { name: 'Registration', code: 'REG', estimatedServiceTime: 12, sortOrder: 2 },
            { name: 'License Plate', code: 'PLATE', estimatedServiceTime: 10, sortOrder: 3 },
          ],
        },
      ],
      onboardingCopy: {
        headline: 'Set up your motor vehicle office',
        description: 'Driver licenses, vehicle registration, and title services.',
      },
    },
  },
  {
    id: 'social-security-office',
    parentVertical: 'public_service',
    title: 'Social Security Office',
    description: 'Benefits, cards, and beneficiary services.',
    icon: '🪪',
    overrides: {
      experienceProfile: {
        vocabulary: {
          officeLabel: 'Social Security Office',
          customerLabel: 'Beneficiary',
        },
        kiosk: {
          welcomeMessage: 'Welcome — how can we help?',
          headerText: 'Social Security services',
          themeColor: '#1e3a8a',
          buttonLabel: 'Check in',
        },
        branding: { recommendedPrimaryColor: '#1e3a8a' },
      },
      starterDepartments: [
        {
          name: 'Benefits', code: 'BEN', sortOrder: 1,
          services: [
            { name: 'Apply for Benefits', code: 'APPLY', estimatedServiceTime: 30, sortOrder: 1 },
            { name: 'Benefit Verification', code: 'VERIFY', estimatedServiceTime: 10, sortOrder: 2 },
            { name: 'Direct Deposit Change', code: 'DEPOSIT', estimatedServiceTime: 10, sortOrder: 3 },
          ],
        },
        {
          name: 'SSN Cards', code: 'SSN', sortOrder: 2,
          services: [
            { name: 'Replacement Card', code: 'REPLACE', estimatedServiceTime: 15, sortOrder: 1 },
            { name: 'Name Change', code: 'NAME', estimatedServiceTime: 15, sortOrder: 2 },
            { name: 'Original Card', code: 'ORIGINAL', estimatedServiceTime: 20, sortOrder: 3 },
          ],
        },
      ],
      onboardingCopy: {
        headline: 'Set up your Social Security office',
        description: 'Benefits applications, card services, and beneficiary support.',
      },
    },
  },
  {
    id: 'tax-office',
    parentVertical: 'public_service',
    title: 'Tax Office',
    description: 'Filings, payments, identity verification.',
    icon: '🧾',
    overrides: {
      experienceProfile: {
        vocabulary: {
          officeLabel: 'Tax Office',
          customerLabel: 'Taxpayer',
          serviceLabel: 'Service',
        },
        kiosk: {
          welcomeMessage: 'Select your service',
          headerText: 'Tax services',
          themeColor: '#166534',
        },
        branding: { recommendedPrimaryColor: '#166534' },
      },
      starterDepartments: [
        {
          name: 'Filings', code: 'FIL', sortOrder: 1,
          services: [
            { name: 'Return Filing Help', code: 'RETURN', estimatedServiceTime: 25, sortOrder: 1 },
            { name: 'Amended Return', code: 'AMEND', estimatedServiceTime: 20, sortOrder: 2 },
          ],
        },
        {
          name: 'Payments & Verification', code: 'PV', sortOrder: 2,
          services: [
            { name: 'Payment Plan', code: 'PLAN', estimatedServiceTime: 20, sortOrder: 1 },
            { name: 'Identity Verification', code: 'IDV', estimatedServiceTime: 15, sortOrder: 2 },
            { name: 'Transcript Request', code: 'TRANS', estimatedServiceTime: 10, sortOrder: 3 },
          ],
        },
      ],
    },
  },
  {
    id: 'court-clerk',
    parentVertical: 'public_service',
    title: 'Court Clerk Office',
    description: 'Filings, records, and court services.',
    icon: '⚖️',
    overrides: {
      experienceProfile: {
        vocabulary: {
          officeLabel: 'Clerk Office',
          customerLabel: 'Visitor',
        },
        kiosk: {
          welcomeMessage: 'Welcome to the Clerk Office',
          headerText: 'Clerk services',
        },
      },
      starterDepartments: [
        {
          name: 'Records', code: 'REC', sortOrder: 1,
          services: [
            { name: 'Certified Copy', code: 'CERT', estimatedServiceTime: 10, sortOrder: 1 },
            { name: 'Case Lookup', code: 'LOOKUP', estimatedServiceTime: 8, sortOrder: 2 },
          ],
        },
        {
          name: 'Filings', code: 'FIL', sortOrder: 2,
          services: [
            { name: 'Civil Filing', code: 'CIVIL', estimatedServiceTime: 20, sortOrder: 1 },
            { name: 'Marriage License', code: 'MARRIAGE', estimatedServiceTime: 15, sortOrder: 2 },
            { name: 'Name Change', code: 'NAME', estimatedServiceTime: 15, sortOrder: 3 },
          ],
        },
      ],
    },
  },
];

const EDUCATION_PROFILES: TemplateProfile[] = [
  {
    id: 'student-services',
    parentVertical: 'education',
    title: 'Student Services',
    description: 'Admissions, advising, and financial aid for campus offices.',
    icon: '📚',
    overrides: {},
  },
  {
    id: 'library-helpdesk',
    parentVertical: 'education',
    title: 'Library Help Desk',
    description: 'Research help, equipment checkout, and room reservations.',
    icon: '📖',
    overrides: {
      experienceProfile: {
        vocabulary: {
          departmentLabel: 'Service',
          deskLabel: 'Help Desk',
          customerLabel: 'Patron',
        },
        kiosk: {
          welcomeMessage: 'Welcome to the Library',
          headerText: 'Library services',
        },
      },
      starterDepartments: [
        {
          name: 'Library Services', code: 'LIB', sortOrder: 1,
          services: [
            { name: 'Research Help', code: 'RESEARCH', estimatedServiceTime: 15, sortOrder: 1 },
            { name: 'Equipment Checkout', code: 'EQUIP', estimatedServiceTime: 5, sortOrder: 2 },
            { name: 'Room Reservation', code: 'ROOM', estimatedServiceTime: 5, sortOrder: 3 },
          ],
        },
      ],
    },
  },
  {
    id: 'it-helpdesk',
    parentVertical: 'education',
    title: 'IT Help Desk',
    description: 'Technical support for students and staff.',
    icon: '💻',
    overrides: {
      experienceProfile: {
        vocabulary: {
          departmentLabel: 'Support Area',
          serviceLabel: 'Issue Type',
          deskLabel: 'Station',
        },
        kiosk: {
          welcomeMessage: 'IT Support — how can we help?',
          headerText: 'IT help desk',
          themeColor: '#059669',
        },
        branding: { recommendedPrimaryColor: '#059669' },
      },
      starterDepartments: [
        {
          name: 'IT Support', code: 'IT', sortOrder: 1,
          services: [
            { name: 'Password Reset', code: 'PASS', estimatedServiceTime: 5, sortOrder: 1 },
            { name: 'Software Install', code: 'SW', estimatedServiceTime: 15, sortOrder: 2 },
            { name: 'Network Issue', code: 'NET', estimatedServiceTime: 20, sortOrder: 3 },
            { name: 'Hardware Repair', code: 'HW', estimatedServiceTime: 25, sortOrder: 4 },
          ],
        },
      ],
    },
  },
];

const TELECOM_PROFILES: TemplateProfile[] = [
  {
    id: 'telecom-store',
    parentVertical: 'telecom',
    title: 'Telecom Store',
    description: 'Retail store with sales, support, and account services.',
    icon: '📱',
    overrides: {},
  },
  {
    id: 'service-center',
    parentVertical: 'telecom',
    title: 'Service Center',
    description: 'Technical support and repairs only.',
    icon: '🔧',
    overrides: {
      experienceProfile: {
        vocabulary: {
          officeLabel: 'Service Center',
          deskLabel: 'Workbench',
        },
        kiosk: {
          welcomeMessage: 'Welcome to the Service Center',
          headerText: 'Device support',
        },
      },
      starterDepartments: [
        {
          name: 'Device Support', code: 'DS', sortOrder: 1,
          services: [
            { name: 'Screen Repair', code: 'SCREEN', estimatedServiceTime: 30, sortOrder: 1 },
            { name: 'Battery Replacement', code: 'BATTERY', estimatedServiceTime: 20, sortOrder: 2 },
            { name: 'Diagnostics', code: 'DIAG', estimatedServiceTime: 15, sortOrder: 3 },
            { name: 'Data Transfer', code: 'DATA', estimatedServiceTime: 25, sortOrder: 4 },
          ],
        },
      ],
    },
  },
];

const INSURANCE_PROFILES: TemplateProfile[] = [
  {
    id: 'insurance-agency',
    parentVertical: 'insurance',
    title: 'Insurance Agency',
    description: 'Full-service agency with claims, policies, and advisory.',
    icon: '🛡️',
    overrides: {},
  },
  {
    id: 'claims-office',
    parentVertical: 'insurance',
    title: 'Claims Office',
    description: 'Claims-focused office for filing and status checks.',
    icon: '📋',
    overrides: {
      experienceProfile: {
        vocabulary: {
          officeLabel: 'Claims Office',
          serviceLabel: 'Claim Type',
        },
        kiosk: {
          welcomeMessage: 'File or check your claim',
          headerText: 'Claims check-in',
        },
      },
      starterDepartments: [
        {
          name: 'Claims', code: 'CL', sortOrder: 1,
          services: [
            { name: 'New Claim', code: 'NEW', estimatedServiceTime: 25, sortOrder: 1 },
            { name: 'Claim Status', code: 'STATUS', estimatedServiceTime: 10, sortOrder: 2 },
            { name: 'Documentation', code: 'DOCS', estimatedServiceTime: 15, sortOrder: 3 },
            { name: 'Settlement Review', code: 'SETTLE', estimatedServiceTime: 20, sortOrder: 4 },
          ],
        },
      ],
    },
  },
];

const AUTOMOTIVE_PROFILES: TemplateProfile[] = [
  {
    id: 'auto-service',
    parentVertical: 'automotive',
    title: 'Auto Service Center',
    description: 'Full-service shop with bays and parts counter.',
    icon: '🔧',
    overrides: {},
  },
  {
    id: 'auto-dealership',
    parentVertical: 'automotive',
    title: 'Dealership Service',
    description: 'Dealership service department with advisor routing.',
    icon: '🚗',
    overrides: {
      experienceProfile: {
        vocabulary: {
          officeLabel: 'Dealership',
          deskLabel: 'Service Advisor',
          customerLabel: 'Customer',
        },
        kiosk: {
          welcomeMessage: 'Welcome to our service department',
          headerText: 'Service check-in',
          themeColor: '#0f172a',
        },
        messagingTone: 'professional',
        branding: { recommendedPrimaryColor: '#0f172a' },
      },
    },
  },
  {
    id: 'quick-lube',
    parentVertical: 'automotive',
    title: 'Quick Lube / Express',
    description: 'Express oil change and maintenance with fast turnover.',
    icon: '⚡',
    overrides: {
      experienceProfile: {
        vocabulary: {
          officeLabel: 'Shop',
          deskLabel: 'Bay',
        },
        kiosk: {
          welcomeMessage: 'Quick service — check in here',
          headerText: 'Express service',
          themeColor: '#ea580c',
        },
        branding: { recommendedPrimaryColor: '#ea580c' },
      },
      starterDepartments: [
        {
          name: 'Express Service', code: 'EXP', sortOrder: 1,
          services: [
            { name: 'Oil Change', code: 'OIL', estimatedServiceTime: 15, sortOrder: 1 },
            { name: 'Tire Rotation', code: 'TIRE', estimatedServiceTime: 20, sortOrder: 2 },
            { name: 'Fluid Top-Off', code: 'FLUID', estimatedServiceTime: 10, sortOrder: 3 },
          ],
        },
      ],
    },
  },
];

const LEGAL_PROFILES: TemplateProfile[] = [
  {
    id: 'law-firm',
    parentVertical: 'legal',
    title: 'Law Office',
    description: 'Appointment-focused consultations and case reviews.',
    icon: '⚖️',
    overrides: {},
  },
  {
    id: 'notary-office',
    parentVertical: 'legal',
    title: 'Notary Office',
    description: 'Document notarization and certification services.',
    icon: '📜',
    overrides: {
      experienceProfile: {
        vocabulary: {
          officeLabel: 'Notary Office',
          serviceLabel: 'Service',
          deskLabel: 'Window',
          customerLabel: 'Client',
        },
        kiosk: {
          welcomeMessage: 'Welcome — select your service',
          headerText: 'Notary services',
        },
      },
      starterDepartments: [
        {
          name: 'Notary Services', code: 'N', sortOrder: 1,
          services: [
            { name: 'Document Notarization', code: 'NOTARY', estimatedServiceTime: 15, sortOrder: 1 },
            { name: 'Certification', code: 'CERT', estimatedServiceTime: 10, sortOrder: 2 },
            { name: 'Apostille', code: 'APOST', estimatedServiceTime: 20, sortOrder: 3 },
          ],
        },
      ],
    },
  },
];

const REAL_ESTATE_PROFILES: TemplateProfile[] = [
  {
    id: 'real-estate-office',
    parentVertical: 'real_estate',
    title: 'Real Estate Office',
    description: 'Property inquiries, viewings, and contract signings.',
    icon: '🏠',
    overrides: {},
  },
  {
    id: 'property-management',
    parentVertical: 'real_estate',
    title: 'Property Management',
    description: 'Tenant services, maintenance requests, and lease management.',
    icon: '🏢',
    overrides: {
      experienceProfile: {
        vocabulary: {
          officeLabel: 'Management Office',
          customerLabel: 'Tenant',
          serviceLabel: 'Request Type',
        },
        kiosk: {
          welcomeMessage: 'Welcome — how can we help?',
          headerText: 'Tenant services',
          themeColor: '#0d9488',
        },
        branding: { recommendedPrimaryColor: '#0d9488' },
      },
      starterDepartments: [
        {
          name: 'Tenant Services', code: 'TS', sortOrder: 1,
          services: [
            { name: 'Maintenance Request', code: 'MAINT', estimatedServiceTime: 10, sortOrder: 1 },
            { name: 'Lease Inquiry', code: 'LEASE', estimatedServiceTime: 15, sortOrder: 2 },
            { name: 'Payment Issue', code: 'PAY', estimatedServiceTime: 10, sortOrder: 3 },
          ],
        },
      ],
    },
  },
];

const OTHER_PROFILES: TemplateProfile[] = [
  {
    id: 'general-service',
    parentVertical: 'other',
    title: 'General Service',
    description: 'Flexible queue for any type of business or service.',
    icon: '💼',
    overrides: {},
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
  education: EDUCATION_PROFILES,
  telecom: TELECOM_PROFILES,
  insurance: INSURANCE_PROFILES,
  automotive: AUTOMOTIVE_PROFILES,
  legal: LEGAL_PROFILES,
  real_estate: REAL_ESTATE_PROFILES,
  other: OTHER_PROFILES,
};

/**
 * Get all available profiles for a given vertical.
 *
 * The catalog is universal — every profile is available in every country.
 * The `country` parameter is kept on the signature so existing callers keep
 * compiling, but it is intentionally ignored: business types and starter
 * services are the same worldwide. Operators rename services to match local
 * terminology after setup.
 */
export function getProfilesForVertical(
  vertical: IndustryVertical,
  _country?: string | null,
): TemplateProfile[] {
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

/**
 * Get the default profile for a vertical — always the first in the list.
 * The optional `country` arg is ignored (kept for API compatibility).
 */
export function getDefaultProfileId(
  vertical: IndustryVertical,
  _country?: string | null,
): string {
  const profiles = ALL_PROFILES[vertical] ?? [];
  return profiles[0]?.id ?? '';
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

  // Replace starter departments (and remap desks) in all starter offices
  if (overrides.starterDepartments && result.starterOffices.length > 0) {
    const newDepts = overrides.starterDepartments;
    const newDeptCodes = new Set(newDepts.map((d) => d.code));

    result.starterOffices = result.starterOffices.map((office) => {
      let desks: StarterDeskTemplate[];

      if (overrides.starterDesks) {
        // Explicit desk overrides from profile
        desks = overrides.starterDesks;
      } else {
        // Auto-remap existing desks to new department codes
        const allDesksValid = office.desks.every((d) => newDeptCodes.has(d.departmentCode));
        if (allDesksValid) {
          // Department codes unchanged — assign all services from the (replaced) department
          desks = office.desks.map((desk) => {
            const dept = newDepts.find((d) => d.code === desk.departmentCode)!;
            return {
              ...desk,
              serviceCodes: dept.services.map((s) => s.code),
            };
          });
        } else {
          // Department codes changed — redistribute desks across new departments
          desks = newDepts.flatMap((dept, deptIdx) => {
            // First department gets 2 desks, rest get 1 desk each
            const deskCount = deptIdx === 0 ? Math.max(2, Math.ceil(office.desks.length / newDepts.length)) : 1;
            const svcCodes = dept.services.map((s) => s.code);
            return Array.from({ length: deskCount }, (_, i) => ({
              name: `${dept.name} ${i + 1}`,
              departmentCode: dept.code,
              serviceCodes: svcCodes,
              displayName: `${dept.name} ${i + 1}`,
            }));
          });
        }
      }

      return { ...office, departments: newDepts, desks };
    });
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

  // Merge capability flags
  if (overrides.capabilityFlags) {
    result.capabilityFlags = { ...result.capabilityFlags, ...overrides.capabilityFlags };
  }

  return result;
}
