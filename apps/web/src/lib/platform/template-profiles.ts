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
          welcomeMessage: 'Bienvenue — enregistrez-vous',
          headerText: 'Cabinet Médical',
          themeColor: '#2563eb',
          buttonLabel: 'S\'enregistrer',
          showEstimatedTime: true,
        },
        publicJoin: {
          headline: 'Votre rendez-vous',
          subheadline: 'Suivez votre position et recevez une notification quand le docteur est prêt.',
        },
      },
      starterDepartments: [
        {
          name: 'Consultations', code: 'C', sortOrder: 1,
          services: [
            { name: 'Consultation Générale', code: 'CONSULT', estimatedServiceTime: 20, sortOrder: 1 },
            { name: 'Contrôle', code: 'CONTROL', estimatedServiceTime: 15, sortOrder: 2 },
            { name: 'Certificat Médical', code: 'CERT', estimatedServiceTime: 10, sortOrder: 3 },
            { name: 'Urgence', code: 'URGENT', estimatedServiceTime: 15, sortOrder: 4 },
            { name: 'Consultation Spécialisée', code: 'SPECIAL', estimatedServiceTime: 30, sortOrder: 5 },
            { name: 'Acte Médical', code: 'ACTE', estimatedServiceTime: 25, sortOrder: 6 },
          ],
        },
      ],
      intakeSchemas: [
        {
          serviceCode: 'CONSULT',
          title: 'Fiche patient',
          fields: [
            { key: 'patient_name', label: 'Nom du patient', type: 'text', required: true, visibility: 'public' },
            { key: 'phone', label: 'Numéro de téléphone', type: 'phone', required: true, visibility: 'public' },
            { key: 'date_of_birth', label: 'Date de naissance', type: 'text', required: false, visibility: 'staff_only' },
            { key: 'motif', label: 'Motif de la visite', type: 'textarea', required: true, visibility: 'staff_only' },
          ],
          complianceNotes: [],
        },
      ],
      defaultSlas: [
        { metric: 'patient_wait', label: 'Attente patient sous', targetMinutes: 15 },
        { metric: 'check_in', label: 'Enregistrement en moins de', targetMinutes: 3 },
      ],
      onboardingCopy: {
        headline: 'Cabinet médical tout équipé',
        description: 'Rendez-vous, notifications WhatsApp, historique patient, formulaires d\'accueil et file à distance — tout est inclus.',
        reviewChecklist: [
          'Configurer les types de consultation',
          'Activer les notifications WhatsApp',
          'Configurer le calendrier des rendez-vous',
          'Personnaliser le formulaire d\'accueil patient',
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
            { name: 'Consultation Générale', code: 'CONSULT', estimatedServiceTime: 20, sortOrder: 1 },
            { name: 'Contrôle', code: 'CONTROL', estimatedServiceTime: 15, sortOrder: 2 },
            { name: 'Certificat Médical', code: 'CERT', estimatedServiceTime: 10, sortOrder: 3 },
            { name: 'Urgence', code: 'URGENT', estimatedServiceTime: 15, sortOrder: 4 },
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
          serviceLabel: 'Soin',
          deskLabel: 'Fauteuil',
          bookingLabel: 'Rendez-vous',
        },
        kiosk: {
          welcomeMessage: 'Bienvenue — enregistrez-vous',
          headerText: 'Cabinet dentaire',
          themeColor: '#0891b2',
          buttonLabel: 'S\'enregistrer',
        },
        publicJoin: {
          headline: 'Votre rendez-vous dentaire',
          subheadline: 'Le dentiste vous recevra dès que possible.',
        },
        branding: { recommendedPrimaryColor: '#0891b2' },
      },
      starterDepartments: [
        {
          name: 'Soins Dentaires', code: 'D', sortOrder: 1,
          services: [
            { name: 'Détartrage', code: 'CLEANING', estimatedServiceTime: 30, sortOrder: 1 },
            { name: 'Plombage', code: 'FILLING', estimatedServiceTime: 40, sortOrder: 2 },
            { name: 'Extraction', code: 'EXTRACT', estimatedServiceTime: 30, sortOrder: 3 },
            { name: 'Consultation', code: 'CONSULT', estimatedServiceTime: 15, sortOrder: 4 },
            { name: 'Urgence Dentaire', code: 'EMERGENCY', estimatedServiceTime: 25, sortOrder: 5 },
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
    title: 'Clinique',
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
    title: 'Grill / Traditional',
    description: 'Traditional sit-down restaurant with dining room, terrace, and family room. Reservations supported.',
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
        headline: 'Set up your traditional restaurant',
        description: 'Grilled dishes, couscous, tajine — dining room, terrace, and family room.',
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
    description: 'Réservation obligatoire, service haut de gamme, suivi VIP.',
    icon: '🥂',
    overrides: {
      experienceProfile: {
        vocabulary: {
          customerLabel: 'Invité',
          bookingLabel: 'Réservation',
          queueLabel: 'Liste des invités',
        },
        kiosk: {
          welcomeMessage: 'Bienvenue — enregistrez votre réservation',
          headerText: 'Réception',
          themeColor: '#1e1b4b',
          buttonLabel: 'S\'enregistrer',
        },
        publicJoin: {
          headline: 'Votre table vous attend',
          subheadline: 'Nous vous prévenons dès que votre table est prête.',
        },
        messagingTone: 'professional',
        branding: { recommendedPrimaryColor: '#1e1b4b' },
      },
      starterDepartments: [
        {
          name: 'Service', code: 'S', sortOrder: 1,
          services: [
            { name: 'Réservation', code: 'RSVP', estimatedServiceTime: 5, sortOrder: 1 },
            { name: 'Sur Place', code: 'DINE', estimatedServiceTime: 60, sortOrder: 2 },
          ],
        },
      ],
      defaultSlas: [
        { metric: 'seat_wait', label: 'Attente table sous', targetMinutes: 5 },
      ],
      onboardingCopy: {
        headline: 'Configurez votre restaurant gastronomique',
        description: 'Réservation-first avec suivi personnalisé des invités.',
      },
    },
  },
];

const BANK_PROFILES: TemplateProfile[] = [
  {
    id: 'banque-agence',
    parentVertical: 'bank',
    title: 'Agence Bancaire',
    description: 'Agence complète — caisse, opérations et conseiller.',
    icon: '🏦',
    overrides: {},  // Uses bank defaults
  },
  {
    id: 'banque-poste',
    parentVertical: 'bank',
    title: 'Bureau de Poste',
    description: 'Services postaux et financiers — courrier, colis, mandats et CCP.',
    icon: '📮',
    overrides: {
      experienceProfile: {
        vocabulary: {
          officeLabel: 'Bureau',
          serviceLabel: 'Service',
          queueLabel: 'File d\'attente',
        },
        kiosk: {
          welcomeMessage: 'Choisissez votre service',
          headerText: 'Bienvenue à la poste',
          themeColor: '#1d4ed8',
          buttonLabel: 'Prendre un ticket',
        },
        branding: { recommendedPrimaryColor: '#1d4ed8' },
      },
      starterDepartments: [
        {
          name: 'Courrier & Colis', code: 'CP', sortOrder: 1,
          services: [
            { name: 'Envoi Courrier', code: 'COURRIER', estimatedServiceTime: 5, sortOrder: 1 },
            { name: 'Envoi Colis', code: 'COLIS', estimatedServiceTime: 8, sortOrder: 2 },
            { name: 'Retrait Colis', code: 'RETRAIT_COLIS', estimatedServiceTime: 5, sortOrder: 3 },
          ],
        },
        {
          name: 'Services Financiers', code: 'SF', sortOrder: 2,
          services: [
            { name: 'Retrait CCP', code: 'CCP', estimatedServiceTime: 7, sortOrder: 1 },
            { name: 'Mandat', code: 'MANDAT', estimatedServiceTime: 10, sortOrder: 2 },
            { name: 'Versement', code: 'VERSEMENT', estimatedServiceTime: 8, sortOrder: 3 },
          ],
        },
      ],
      onboardingCopy: {
        headline: 'Configurez votre bureau de poste',
        description: 'Courrier, colis, mandats et services CCP.',
      },
    },
  },
  {
    id: 'assurance-agence',
    parentVertical: 'bank',
    title: 'Agence d\'Assurance',
    description: 'Déclarations de sinistre, souscriptions et renouvellements.',
    icon: '🛡️',
    overrides: {
      experienceProfile: {
        vocabulary: {
          officeLabel: 'Agence',
          serviceLabel: 'Prestation',
          customerLabel: 'Assuré',
        },
        kiosk: {
          welcomeMessage: 'Bienvenue — choisissez votre service',
          headerText: 'Agence d\'assurance',
          themeColor: '#0369a1',
          buttonLabel: 'Prendre un ticket',
        },
        branding: { recommendedPrimaryColor: '#0369a1' },
      },
      starterDepartments: [
        {
          name: 'Sinistres', code: 'SIN', sortOrder: 1,
          services: [
            { name: 'Déclaration de Sinistre', code: 'SINISTRE', estimatedServiceTime: 20, sortOrder: 1 },
            { name: 'Suivi Dossier', code: 'SUIVI', estimatedServiceTime: 10, sortOrder: 2 },
          ],
        },
        {
          name: 'Contrats', code: 'CT', sortOrder: 2,
          services: [
            { name: 'Nouvelle Souscription', code: 'SOUSCRIPTION', estimatedServiceTime: 25, sortOrder: 1 },
            { name: 'Renouvellement', code: 'RENOUVELLEMENT', estimatedServiceTime: 15, sortOrder: 2 },
            { name: 'Attestation', code: 'ATTEST', estimatedServiceTime: 8, sortOrder: 3 },
          ],
        },
      ],
      onboardingCopy: {
        headline: 'Configurez votre agence d\'assurance',
        description: 'Sinistres, souscriptions et renouvellements de contrats.',
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
  {
    id: 'administration-generale',
    parentVertical: 'public_service',
    title: 'Administration Générale',
    description: 'Administration multi-services — état civil, documents et guichet unique.',
    icon: '🏛️',
    overrides: {},  // Uses public-service defaults
  },
  {
    id: 'apc-mairie',
    parentVertical: 'public_service',
    title: 'APC / Mairie',
    description: 'État civil, légalisations, urbanisme et services communaux.',
    icon: '🏢',
    overrides: {
      experienceProfile: {
        vocabulary: {
          officeLabel: 'Mairie',
          customerLabel: 'Administré',
        },
        kiosk: {
          welcomeMessage: 'Bienvenue à la mairie',
          headerText: 'Services communaux',
        },
      },
      starterDepartments: [
        {
          name: 'État Civil', code: 'EC', sortOrder: 1,
          services: [
            { name: 'Extrait de Naissance', code: 'NAISSANCE', estimatedServiceTime: 5, sortOrder: 1 },
            { name: 'Acte de Mariage', code: 'MARIAGE', estimatedServiceTime: 8, sortOrder: 2 },
            { name: 'Acte de Décès', code: 'DECES', estimatedServiceTime: 8, sortOrder: 3 },
            { name: 'Légalisation', code: 'LEGAL', estimatedServiceTime: 3, sortOrder: 4 },
          ],
        },
        {
          name: 'Urbanisme', code: 'URB', sortOrder: 2,
          services: [
            { name: 'Permis de Construire', code: 'PERMIS_C', estimatedServiceTime: 15, sortOrder: 1 },
            { name: 'Certificat d\'Urbanisme', code: 'CERT_URB', estimatedServiceTime: 10, sortOrder: 2 },
          ],
        },
        {
          name: 'Services Divers', code: 'SD', sortOrder: 3,
          services: [
            { name: 'Certificat de Résidence', code: 'RESIDENCE', estimatedServiceTime: 5, sortOrder: 1 },
            { name: 'Attestation', code: 'ATTEST', estimatedServiceTime: 5, sortOrder: 2 },
            { name: 'Renseignement', code: 'INFO', estimatedServiceTime: 5, sortOrder: 3 },
          ],
        },
      ],
      onboardingCopy: {
        headline: 'Configurez votre mairie / APC',
        description: 'État civil, légalisations, urbanisme et services communaux.',
      },
    },
  },
  {
    id: 'daira-wilaya',
    parentVertical: 'public_service',
    title: 'Daïra / Wilaya',
    description: 'Documents d\'identité — passeport, carte nationale, casier judiciaire.',
    icon: '🪪',
    overrides: {
      experienceProfile: {
        vocabulary: {
          officeLabel: 'Daïra',
        },
        kiosk: {
          welcomeMessage: 'Choisissez votre démarche',
          headerText: 'Bienvenue à la daïra',
        },
      },
      starterDepartments: [
        {
          name: 'Biométrie', code: 'BIO', sortOrder: 1,
          services: [
            { name: 'Passeport Biométrique', code: 'PASSEPORT', estimatedServiceTime: 15, sortOrder: 1 },
            { name: 'Carte Nationale d\'Identité', code: 'CNI', estimatedServiceTime: 12, sortOrder: 2 },
            { name: 'Permis de Conduire', code: 'PERMIS', estimatedServiceTime: 10, sortOrder: 3 },
          ],
        },
        {
          name: 'Documents Administratifs', code: 'DA', sortOrder: 2,
          services: [
            { name: 'Casier Judiciaire', code: 'CASIER', estimatedServiceTime: 8, sortOrder: 1 },
            { name: 'Fiche Familiale', code: 'FICHE', estimatedServiceTime: 10, sortOrder: 2 },
            { name: 'Légalisation', code: 'LEGAL', estimatedServiceTime: 3, sortOrder: 3 },
          ],
        },
      ],
      onboardingCopy: {
        headline: 'Configurez votre daïra',
        description: 'Passeport, carte nationale, casier judiciaire et documents administratifs.',
      },
    },
  },
  {
    id: 'cnas-securite-sociale',
    parentVertical: 'public_service',
    title: 'CNAS / Sécurité Sociale',
    description: 'Remboursements, attestations, affiliation et prestations sociales.',
    icon: '🏥',
    overrides: {
      experienceProfile: {
        vocabulary: {
          officeLabel: 'Agence CNAS',
          customerLabel: 'Assuré',
        },
        kiosk: {
          welcomeMessage: 'Bienvenue — choisissez votre prestation',
          headerText: 'Sécurité Sociale',
          themeColor: '#0369a1',
          buttonLabel: 'Prendre un ticket',
        },
        branding: { recommendedPrimaryColor: '#0369a1' },
      },
      starterDepartments: [
        {
          name: 'Prestations', code: 'PR', sortOrder: 1,
          services: [
            { name: 'Remboursement', code: 'REMBOURS', estimatedServiceTime: 10, sortOrder: 1 },
            { name: 'Attestation d\'Affiliation', code: 'AFFIL', estimatedServiceTime: 8, sortOrder: 2 },
            { name: 'Carte Chifa', code: 'CHIFA', estimatedServiceTime: 12, sortOrder: 3 },
          ],
        },
        {
          name: 'Affiliation & Cotisation', code: 'AC', sortOrder: 2,
          services: [
            { name: 'Nouvelle Affiliation', code: 'NEW_AFFIL', estimatedServiceTime: 15, sortOrder: 1 },
            { name: 'Mise à Jour Dossier', code: 'MAJ', estimatedServiceTime: 10, sortOrder: 2 },
            { name: 'Réclamation', code: 'RECLAM', estimatedServiceTime: 12, sortOrder: 3 },
          ],
        },
      ],
      onboardingCopy: {
        headline: 'Configurez votre agence CNAS',
        description: 'Remboursements, carte Chifa, attestations et affiliation.',
      },
    },
  },
  {
    id: 'centre-impots',
    parentVertical: 'public_service',
    title: 'Centre des Impôts',
    description: 'Déclarations fiscales, paiements et attestations.',
    icon: '🧾',
    overrides: {
      experienceProfile: {
        vocabulary: {
          officeLabel: 'Centre des Impôts',
          customerLabel: 'Contribuable',
          serviceLabel: 'Démarche',
        },
        kiosk: {
          welcomeMessage: 'Choisissez votre démarche fiscale',
          headerText: 'Centre des Impôts',
          themeColor: '#15803d',
          buttonLabel: 'Prendre un ticket',
        },
        branding: { recommendedPrimaryColor: '#15803d' },
      },
      starterDepartments: [
        {
          name: 'Déclarations', code: 'DEC', sortOrder: 1,
          services: [
            { name: 'Déclaration Annuelle', code: 'DECL', estimatedServiceTime: 15, sortOrder: 1 },
            { name: 'Déclaration G50', code: 'G50', estimatedServiceTime: 10, sortOrder: 2 },
          ],
        },
        {
          name: 'Paiements & Attestations', code: 'PA', sortOrder: 2,
          services: [
            { name: 'Paiement Impôt', code: 'PAIEMENT', estimatedServiceTime: 8, sortOrder: 1 },
            { name: 'Attestation Fiscale', code: 'ATTEST', estimatedServiceTime: 5, sortOrder: 2 },
            { name: 'Réclamation', code: 'RECLAM', estimatedServiceTime: 12, sortOrder: 3 },
          ],
        },
      ],
      onboardingCopy: {
        headline: 'Configurez votre centre des impôts',
        description: 'Déclarations, paiements et attestations fiscales.',
      },
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
    title: 'Service Général',
    description: 'File d\'attente flexible pour tout type de commerce ou service.',
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
