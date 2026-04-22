/**
 * Vertical-specific overlays for each business type.
 *
 * Each overlay function returns a DeepPartial<IndustryTemplate> with ONLY the fields
 * that differ from the tier preset. The factory merges these onto the tier base.
 */

import {
  ADMIN_LIKE_ROLES,
  STAFF_ROLES,
  type IndustryTemplate,
  type IntakeSchema,
  type OperatingHoursPreset,
  type StarterDeskTemplate,
  type StarterDisplayTemplate,
} from '@qflo/shared';
import type { DeepPartial } from './template-factory';

// ── Shared helpers ──────────────────────────────────────────────────────────

function starterDesk(
  name: string,
  departmentCode: string,
  serviceCodes: string[],
  displayName?: string,
  status: StarterDeskTemplate['status'] = 'open',
): StarterDeskTemplate {
  return { name, departmentCode, serviceCodes, displayName, status };
}

function starterDisplay(
  name: string,
  layout?: StarterDisplayTemplate['layout'],
  settings?: StarterDisplayTemplate['settings'],
): StarterDisplayTemplate {
  return { name, layout, isActive: true, settings };
}

// ── Operating hours presets ─────────────────────────────────────────────────

// Algeria schedule: Sun–Thu workdays, Fri & Sat weekend
const WEEKDAY_SERVICE_HOURS: OperatingHoursPreset = {
  sunday: { open: '08:00', close: '17:00' },
  monday: { open: '08:00', close: '17:00' },
  tuesday: { open: '08:00', close: '17:00' },
  wednesday: { open: '08:00', close: '17:00' },
  thursday: { open: '08:00', close: '17:00' },
  friday: { open: '00:00', close: '00:00' },
  saturday: { open: '00:00', close: '00:00' },
};

const EXTENDED_BRANCH_HOURS: OperatingHoursPreset = {
  sunday: { open: '09:00', close: '18:00' },
  monday: { open: '09:00', close: '18:00' },
  tuesday: { open: '09:00', close: '18:00' },
  wednesday: { open: '09:00', close: '18:00' },
  thursday: { open: '09:00', close: '18:00' },
  friday: { open: '00:00', close: '00:00' },
  saturday: { open: '00:00', close: '00:00' },
};

const CLINIC_HOURS: OperatingHoursPreset = {
  sunday: { open: '08:30', close: '17:30' },
  monday: { open: '08:30', close: '17:30' },
  tuesday: { open: '08:30', close: '17:30' },
  wednesday: { open: '08:30', close: '17:30' },
  thursday: { open: '08:30', close: '17:30' },
  friday: { open: '00:00', close: '00:00' },
  saturday: { open: '00:00', close: '00:00' },
};

const HOSPITALITY_HOURS: OperatingHoursPreset = {
  sunday: { open: '11:00', close: '22:00' },
  monday: { open: '11:00', close: '22:00' },
  tuesday: { open: '11:00', close: '22:00' },
  wednesday: { open: '11:00', close: '22:00' },
  thursday: { open: '11:00', close: '23:00' },
  friday: { open: '00:00', close: '00:00' },
  saturday: { open: '00:00', close: '00:00' },
};

const SHOP_HOURS: OperatingHoursPreset = {
  sunday: { open: '09:00', close: '19:00' },
  monday: { open: '09:00', close: '19:00' },
  tuesday: { open: '09:00', close: '19:00' },
  wednesday: { open: '09:00', close: '19:00' },
  thursday: { open: '09:00', close: '19:00' },
  friday: { open: '00:00', close: '00:00' },
  saturday: { open: '00:00', close: '00:00' },
};

// ── Restaurant intake helper ────────────────────────────────────────────────

function restaurantIntakeSchema(serviceCode: string, includeReservationReference = false): IntakeSchema {
  return {
    serviceCode,
    title: includeReservationReference ? 'Reservation arrival details' : 'Party details',
    fields: [
      { key: 'party_name', label: 'Party name', type: 'text', required: true, visibility: 'public' as const },
      { key: 'mobile_number', label: 'Mobile number', type: 'phone', required: true, visibility: 'public' as const },
      { key: 'party_size', label: 'Party size', type: 'select', required: true, visibility: 'public' as const, options: ['1-2', '3-4', '5-6', '7+'] },
      { key: 'seating_preference', label: 'Seating preference', type: 'select', required: false, visibility: 'public' as const, options: ['First available', 'Indoor', 'Outdoor', 'Bar'] },
      { key: 'accessibility_seating', label: 'Need accessible seating', type: 'checkbox', required: false, visibility: 'public' as const },
      { key: 'high_chair', label: 'Need a high chair', type: 'checkbox', required: false, visibility: 'public' as const },
      ...(includeReservationReference
        ? [{ key: 'reservation_reference', label: 'Reservation name or reference', type: 'text' as const, required: false, visibility: 'public' as const }]
        : []),
      { key: 'host_notes', label: 'Host notes', type: 'textarea', required: false, visibility: 'staff_only' as const },
    ],
    complianceNotes: [],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  VERTICAL OVERLAYS
// ═══════════════════════════════════════════════════════════════════════════

export function getPublicServiceOverlay(): DeepPartial<IndustryTemplate> {
  return {
    dashboardMode: 'public_service',
    defaultNavigation: [
      '/admin/overview', '/admin/setup-wizard', '/admin/offices', '/admin/departments',
      '/admin/services', '/admin/desks', '/admin/staff', '/admin/priorities',
      '/admin/displays', '/admin/kiosk', '/admin/analytics', '/admin/settings', '/desk',
    ],
    enabledModules: ['kiosk', 'display_board', 'priority_categories', 'branch_comparison'],
    onboardingCopy: {
      headline: 'Configurez votre administration',
      description: 'File d\'attente par ticket avec guichets, écrans d\'appel et gestion des priorités.',
      reviewChecklist: ['Vérifier les services proposés', 'Configurer les guichets', 'Activer les écrans d\'appel'],
    },
    recommendedRoles: [...ADMIN_LIKE_ROLES, STAFF_ROLES.RECEPTIONIST, STAFF_ROLES.DESK_OPERATOR, STAFF_ROLES.FLOOR_MANAGER, STAFF_ROLES.ANALYST],
    defaultSlas: [
      { metric: 'first_call', label: 'Appel citoyen en moins de', targetMinutes: 20 },
      { metric: 'average_wait', label: 'Attente moyenne sous', targetMinutes: 25 },
    ],
    capabilityFlags: { privacySafeDisplay: false, appointments: false },
    workflowProfile: {
      queueLifecycle: 'ticket',
      noShowPolicy: { enabled: true, timeoutMinutes: 12, autoClose: true },
    },
    queuePolicy: {
      numberingFormat: 'department_sequence',
      routingMode: 'department_first',
      capacityLimit: 150,
      remoteJoinNotice: 'Prenez votre ticket à distance et venez quand votre numéro approche.',
    },
    experienceProfile: {
      dashboardMode: 'public_service',
      kiosk: {
        welcomeMessage: 'Choisissez votre service',
        headerText: 'Prenez votre ticket',
        themeColor: '#1d4ed8',
        buttonLabel: 'Prendre un ticket',
        showPriorities: true,
        idleTimeoutSeconds: 75,
      },
      publicJoin: {
        headline: 'Suivez votre ticket',
        subheadline: 'Suivez votre position dans la file depuis votre téléphone.',
        requireCustomerName: false,
        namedPartyLabel: 'Nom',
      },
      display: { defaultLayout: 'department_split', showNextUp: true, showDepartmentBreakdown: true, announcementSound: true },
      messagingTone: 'institutional',
      supportedLanguages: ['fr', 'ar', 'en'],
      accessibility: { highContrast: true, bilingualSignage: true, speakAnnouncements: true },
      branding: { recommendedPrimaryColor: '#1d4ed8' },
      vocabulary: {
        officeLabel: 'Office',
        departmentLabel: 'Department',
        serviceLabel: 'Service',
        deskLabel: 'Counter',
        customerLabel: 'Citizen',
        bookingLabel: 'Ticket',
        queueLabel: 'Queue',
      },
    },
    rolePolicy: {
      roles: [],
    },
    starterPriorities: [
      { name: 'Personne âgée', icon: '🧓', color: '#f97316', weight: 20 },
      { name: 'Accessible', icon: '♿', color: '#0ea5e9', weight: 25 },
      { name: 'Femme enceinte', icon: '🤰', color: '#e11d48', weight: 20 },
      { name: 'Ancien Combattant', icon: '🎖️', color: '#22c55e', weight: 15 },
    ],
    starterOffices: [
      {
        branchType: 'service_center',
        name: 'Administration',
        timezone: 'Africa/Algiers',
        operatingHours: WEEKDAY_SERVICE_HOURS,
        departments: [
          {
            name: 'État Civil', code: 'EC', sortOrder: 1,
            services: [
              { name: 'Extrait de Naissance', code: 'NAISSANCE', estimatedServiceTime: 5, sortOrder: 1 },
              { name: 'Acte de Mariage', code: 'MARIAGE', estimatedServiceTime: 8, sortOrder: 2 },
              { name: 'Légalisation', code: 'LEGAL', estimatedServiceTime: 3, sortOrder: 3 },
              { name: 'Certificat de Résidence', code: 'RESIDENCE', estimatedServiceTime: 5, sortOrder: 4 },
            ],
          },
          {
            name: 'Documents', code: 'D', sortOrder: 2,
            services: [
              { name: 'Passeport', code: 'PASSEPORT', estimatedServiceTime: 15, sortOrder: 1 },
              { name: 'Carte Nationale', code: 'CNI', estimatedServiceTime: 12, sortOrder: 2 },
              { name: 'Permis de Conduire', code: 'PERMIS', estimatedServiceTime: 10, sortOrder: 3 },
            ],
          },
          {
            name: 'Guichet Unique', code: 'GU', sortOrder: 3,
            services: [
              { name: 'Renseignement', code: 'INFO', estimatedServiceTime: 5, sortOrder: 1 },
              { name: 'Dépôt Dossier', code: 'DEPOT', estimatedServiceTime: 8, sortOrder: 2 },
              { name: 'Retrait Document', code: 'RETRAIT', estimatedServiceTime: 3, sortOrder: 3 },
            ],
          },
        ],
        desks: [
          starterDesk('guichet-1', 'EC', ['NAISSANCE', 'MARIAGE', 'LEGAL', 'RESIDENCE'], 'Guichet 1'),
          starterDesk('guichet-2', 'EC', ['NAISSANCE', 'LEGAL', 'RESIDENCE'], 'Guichet 2'),
          starterDesk('guichet-3', 'D', ['PASSEPORT', 'CNI', 'PERMIS'], 'Guichet 3'),
          starterDesk('guichet-4', 'D', ['PASSEPORT', 'CNI', 'PERMIS'], 'Guichet 4'),
          starterDesk('guichet-5', 'GU', ['INFO', 'DEPOT', 'RETRAIT'], 'Guichet 5'),
          starterDesk('accueil', 'GU', ['INFO', 'DEPOT'], 'Accueil'),
        ],
        displayScreens: [
          starterDisplay('Écran Principal', 'department_split'),
          starterDisplay('Écran État Civil', 'list', { show_next_up: true }),
        ],
        officeSettings: {
          platform_service_areas: [
            { id: 'hall', label: 'Hall d\'attente', type: 'waiting_area' },
            { id: 'etat-civil', label: 'Espace État Civil', type: 'queue_lane' },
            { id: 'documents', label: 'Espace Documents', type: 'queue_lane' },
            { id: 'priorite', label: 'File Prioritaire', type: 'priority_zone' },
          ],
        },
      },
    ],
    intakeSchemas: [],
  };
}

export function getBankBranchOverlay(): DeepPartial<IndustryTemplate> {
  return {
    dashboardMode: 'bank',
    defaultNavigation: [
      '/admin/overview', '/admin/setup-wizard', '/admin/offices', '/admin/departments',
      '/admin/services', '/admin/desks', '/admin/staff', '/admin/priorities',
      '/admin/displays', '/admin/kiosk', '/admin/analytics', '/admin/settings', '/desk',
    ],
    enabledModules: ['kiosk', 'display_board', 'priority_categories', 'customer_history', 'branch_comparison'],
    onboardingCopy: {
      headline: 'Configurez votre agence bancaire',
      description: 'File d\'attente par ticket avec guichets, conseillers et écran d\'appel.',
      reviewChecklist: ['Vérifier les guichets', 'Configurer les priorités', 'Activer l\'écran d\'appel'],
    },
    recommendedRoles: [...ADMIN_LIKE_ROLES, STAFF_ROLES.RECEPTIONIST, STAFF_ROLES.DESK_OPERATOR, STAFF_ROLES.ANALYST],
    defaultSlas: [
      { metric: 'lobby_wait', label: 'Attente hall sous', targetMinutes: 15 },
      { metric: 'advisor_wait', label: 'Attente conseiller sous', targetMinutes: 20 },
    ],
    capabilityFlags: { privacySafeDisplay: true, appointments: false },
    workflowProfile: {
      queueLifecycle: 'ticket',
      noShowPolicy: { enabled: true, timeoutMinutes: 10, autoClose: true },
    },
    queuePolicy: {
      numberingFormat: 'department_sequence',
      priorityMode: 'category_weight',
      routingMode: 'department_first',
      capacityLimit: 90,
      estimatedWaitStrategy: 'historical_average',
      remoteJoinNotice: 'Prenez votre ticket à distance et venez quand votre numéro approche.',
    },
    experienceProfile: {
      dashboardMode: 'bank',
      kiosk: {
        welcomeMessage: 'Choisissez votre opération',
        headerText: 'Bienvenue à l\'agence',
        themeColor: '#0f766e',
        buttonLabel: 'Prendre un ticket',
        showPriorities: true,
        idleTimeoutSeconds: 75,
      },
      publicJoin: {
        headline: 'Suivez votre ticket',
        subheadline: 'Suivez votre position dans la file depuis votre téléphone.',
        requireCustomerName: false,
        namedPartyLabel: 'Nom du client',
      },
      display: { defaultLayout: 'department_split', showNextUp: true, showDepartmentBreakdown: true, announcementSound: true },
      messagingTone: 'institutional',
      supportedLanguages: ['fr', 'ar', 'en'],
      accessibility: { highContrast: true, bilingualSignage: true, speakAnnouncements: true },
      branding: { recommendedPrimaryColor: '#0f766e' },
      vocabulary: {
        officeLabel: 'Branch',
        departmentLabel: 'Department',
        serviceLabel: 'Operation',
        deskLabel: 'Counter',
        customerLabel: 'Client',
        bookingLabel: 'Ticket',
        queueLabel: 'Queue',
      },
    },
    starterPriorities: [
      { name: 'Personne âgée', icon: '🧓', color: '#f97316', weight: 20 },
      { name: 'Accessible', icon: '♿', color: '#0284c7', weight: 25 },
      { name: 'Femme enceinte', icon: '🤰', color: '#e11d48', weight: 20 },
    ],
    starterOffices: [
      {
        branchType: 'branch_office',
        name: 'Agence Principale',
        timezone: 'Africa/Algiers',
        operatingHours: WEEKDAY_SERVICE_HOURS,
        departments: [
          {
            name: 'Caisse', code: 'C', sortOrder: 1,
            services: [
              { name: 'Retrait', code: 'RETRAIT', estimatedServiceTime: 7, sortOrder: 1 },
              { name: 'Versement', code: 'VERSEMENT', estimatedServiceTime: 8, sortOrder: 2 },
              { name: 'Virement', code: 'VIREMENT', estimatedServiceTime: 10, sortOrder: 3 },
              { name: 'Change', code: 'CHANGE', estimatedServiceTime: 8, sortOrder: 4 },
            ],
          },
          {
            name: 'Opérations', code: 'O', sortOrder: 2,
            services: [
              { name: 'Relevé de Compte', code: 'RELEVE', estimatedServiceTime: 5, sortOrder: 1 },
              { name: 'Attestation', code: 'ATTEST', estimatedServiceTime: 8, sortOrder: 2 },
              { name: 'Chéquier', code: 'CHEQUE', estimatedServiceTime: 6, sortOrder: 3 },
              { name: 'Carte Bancaire', code: 'CARTE', estimatedServiceTime: 10, sortOrder: 4 },
            ],
          },
          {
            name: 'Conseiller', code: 'A', sortOrder: 3,
            services: [
              { name: 'Ouverture de Compte', code: 'OPEN', estimatedServiceTime: 20, sortOrder: 1 },
              { name: 'Crédit', code: 'CREDIT', estimatedServiceTime: 25, sortOrder: 2 },
              { name: 'Réclamation', code: 'RECLAM', estimatedServiceTime: 15, sortOrder: 3 },
            ],
          },
        ],
        desks: [
          starterDesk('guichet-1', 'C', ['RETRAIT', 'VERSEMENT', 'CHANGE'], 'Guichet 1'),
          starterDesk('guichet-2', 'C', ['RETRAIT', 'VIREMENT', 'CHANGE'], 'Guichet 2'),
          starterDesk('guichet-3', 'O', ['RELEVE', 'ATTEST', 'CHEQUE', 'CARTE'], 'Guichet 3'),
          starterDesk('conseiller-1', 'A', ['OPEN', 'CREDIT', 'RECLAM'], 'Conseiller 1'),
          starterDesk('accueil', 'C', ['RETRAIT', 'VERSEMENT'], 'Accueil'),
        ],
        displayScreens: [
          starterDisplay('Écran Hall', 'department_split', { theme: 'light', show_next_up: true }),
        ],
        officeSettings: {
          platform_service_areas: [
            { id: 'hall', label: 'Hall d\'attente', type: 'waiting_area' },
            { id: 'caisse', label: 'Espace Caisse', type: 'queue_lane' },
            { id: 'conseiller', label: 'Bureau Conseiller', type: 'consult_zone' },
          ],
        },
      },
    ],
    intakeSchemas: [],
  };
}

export function getClinicOverlay(): DeepPartial<IndustryTemplate> {
  return {
    dashboardMode: 'light_service',
    defaultNavigation: [
      '/admin/overview', '/admin/setup-wizard', '/admin/offices', '/admin/services',
      '/admin/staff', '/admin/analytics', '/admin/customers', '/admin/calendar',
      '/admin/bookings', '/admin/settings', '/desk',
    ],
    enabledModules: ['appointments', 'virtual_join', 'customer_history', 'feedback', 'staff_assignment'],
    onboardingCopy: {
      headline: 'Set up your medical practice',
      description: 'Simple patient queue — secretary checks patients in, doctor calls them when ready.',
      reviewChecklist: ['Set your consultation types', 'Configure your working hours', 'Enable remote queue join for patients'],
    },
    recommendedRoles: [...ADMIN_LIKE_ROLES, STAFF_ROLES.RECEPTIONIST, STAFF_ROLES.DESK_OPERATOR],
    defaultSlas: [
      { metric: 'patient_wait', label: 'Average patient wait under', targetMinutes: 20 },
    ],
    capabilityFlags: { kiosk: false, displayBoard: false, intakeForms: false, multiDepartment: false, branchComparison: false, privacySafeDisplay: true },
    workflowProfile: {
      queueLifecycle: 'waitlist',
      appointmentStrategy: 'blended',
      noShowPolicy: { enabled: true, timeoutMinutes: 10, autoClose: true },
      transferPolicy: { enabled: false, preservePriority: false },
      chainingRules: { enabled: false, allowDepartmentHandOff: false, requireCompletionNotes: false },
    },
    queuePolicy: {
      numberingFormat: 'named_waitlist',
      priorityMode: 'none',
      routingMode: 'staff_preference',
      capacityLimit: 40,
      estimatedWaitStrategy: 'manual',
      remoteJoin: 'enabled',
      remoteJoinNotice: 'Join the queue remotely and come when your turn is near.',
    },
    experienceProfile: {
      dashboardMode: 'light_service',
      kiosk: {
        welcomeMessage: 'Check in for your visit',
        headerText: 'Patient check-in',
        themeColor: '#2563eb',
        buttonLabel: 'Check In',
        showPriorities: false,
        showEstimatedTime: true,
        idleTimeoutSeconds: 60,
      },
      publicJoin: {
        headline: 'Your appointment',
        subheadline: 'Join the queue and we\'ll notify you when the doctor is ready.',
        requireCustomerName: true,
        namedPartyLabel: 'Patient name',
      },
      display: { defaultLayout: 'list', showNextUp: false, showDepartmentBreakdown: false, announcementSound: false },
      messagingTone: 'professional',
      supportedLanguages: ['en', 'fr', 'ar'],
      accessibility: { highContrast: false, bilingualSignage: false, speakAnnouncements: false },
      branding: { recommendedPrimaryColor: '#2563eb' },
      vocabulary: {
        officeLabel: 'Practice',
        departmentLabel: 'Department',
        serviceLabel: 'Consultation',
        deskLabel: 'Office',
        customerLabel: 'Patient',
        bookingLabel: 'Appointment',
        queueLabel: 'Queue',
      },
    },
    starterPriorities: [
      { name: 'Urgent', icon: '⚡', color: '#dc2626', weight: 30 },
    ],
    starterOffices: [
      {
        branchType: 'medical_office',
        name: 'Cabinet Médical',
        timezone: 'Africa/Algiers',
        operatingHours: CLINIC_HOURS,
        displayScreens: [],
        departments: [
          {
            name: 'Consultations', code: 'C', sortOrder: 1,
            services: [
              { name: 'Consultation Générale', code: 'CONSULT', estimatedServiceTime: 20, sortOrder: 1 },
              { name: 'Contrôle', code: 'CONTROL', estimatedServiceTime: 15, sortOrder: 2 },
              { name: 'Certificat Médical', code: 'CERT', estimatedServiceTime: 10, sortOrder: 3 },
            ],
          },
        ],
        desks: [
          starterDesk('accueil', 'C', ['CONSULT', 'CONTROL', 'CERT'], 'Accueil'),
          starterDesk('cabinet', 'C', ['CONSULT', 'CONTROL', 'CERT'], 'Cabinet'),
        ],
        officeSettings: {
          platform_service_areas: [
            { id: 'reception', label: 'Salle d\'attente', type: 'waiting_room' },
            { id: 'cabinet', label: 'Cabinet du médecin', type: 'consultation_room' },
          ],
        },
      },
    ],
    intakeSchemas: [],
  };
}

export function getRestaurantOverlay(): DeepPartial<IndustryTemplate> {
  return {
    dashboardMode: 'light_service',
    defaultNavigation: [
      '/admin/overview', '/admin/setup-wizard', '/admin/offices', '/admin/services',
      '/admin/staff', '/admin/analytics', '/admin/customers', '/admin/calendar',
      '/admin/bookings', '/admin/settings', '/desk',
    ],
    enabledModules: ['appointments', 'virtual_join', 'customer_history', 'feedback', 'staff_assignment'],
    onboardingCopy: {
      headline: 'Set up your restaurant',
      description: 'Simple queue for dine-in, takeout, and delivery — with optional reservations.',
      reviewChecklist: ['Set your service types', 'Configure your hours', 'Enable remote queue join'],
    },
    recommendedRoles: [...ADMIN_LIKE_ROLES, STAFF_ROLES.RECEPTIONIST, STAFF_ROLES.DESK_OPERATOR],
    defaultSlas: [
      { metric: 'seat_wait', label: 'Average wait under', targetMinutes: 15 },
    ],
    capabilityFlags: {
      kiosk: false,
      displayBoard: false,
      intakeForms: false,
      multiDepartment: false,
      controllerHost: true,
    },
    workflowProfile: {
      noShowPolicy: { enabled: true, timeoutMinutes: 8, autoClose: true },
      transferPolicy: { enabled: false, preservePriority: false },
    },
    queuePolicy: {
      numberingFormat: 'named_waitlist',
      priorityMode: 'none',
      routingMode: 'staff_preference',
      capacityLimit: 40,
      estimatedWaitStrategy: 'manual',
      remoteJoinNotice: 'Rejoignez la file et on vous prévient quand votre table est prête.',
    },
    experienceProfile: {
      dashboardMode: 'light_service',
      kiosk: {
        welcomeMessage: 'Bienvenue',
        headerText: 'File d\'attente',
        themeColor: '#dc2626',
        buttonLabel: 'Rejoindre',
        showPriorities: false,
        idleTimeoutSeconds: 60,
      },
      publicJoin: {
        headline: 'Votre table arrive',
        subheadline: 'Rejoignez la file et revenez quand c\'est votre tour.',
        requireCustomerName: true,
        namedPartyLabel: 'Nom',
      },
      display: { showNextUp: true, showDepartmentBreakdown: false },
      messagingTone: 'friendly',
      supportedLanguages: ['fr', 'ar', 'en'],
      accessibility: { highContrast: false, bilingualSignage: false, speakAnnouncements: false },
      branding: { recommendedPrimaryColor: '#dc2626' },
      vocabulary: {
        officeLabel: 'Restaurant',
        departmentLabel: 'Section',
        serviceLabel: 'Order',
        deskLabel: 'Register',
        customerLabel: 'Customer',
        bookingLabel: 'Reservation',
        queueLabel: 'Waitlist',
      },
    },
    starterPriorities: [],
    starterOffices: [
      {
        branchType: 'restaurant_floor',
        name: 'Restaurant',
        timezone: 'Africa/Algiers',
        operatingHours: HOSPITALITY_HOURS,
        displayScreens: [],
        departments: [
          {
            name: 'Service', code: 'S', sortOrder: 1,
            services: [
              { name: 'Sur Place', code: 'DINE', estimatedServiceTime: 30, sortOrder: 1 },
              { name: 'À Emporter', code: 'TAKEOUT', estimatedServiceTime: 10, sortOrder: 2 },
              { name: 'Livraison', code: 'DELIVERY', estimatedServiceTime: 5, sortOrder: 3 },
            ],
          },
        ],
        desks: [
          starterDesk('caisse', 'S', ['DINE', 'TAKEOUT', 'DELIVERY'], 'Caisse'),
          starterDesk('salle', 'S', ['DINE'], 'Salle'),
        ],
        officeSettings: {
          platform_service_areas: [
            { id: 'salle', label: 'Salle', type: 'floor_zone' },
            { id: 'terrasse', label: 'Terrasse', type: 'floor_zone' },
          ],
        },
      },
    ],
    intakeSchemas: [],
  };
}

export function getBarbershopOverlay(): DeepPartial<IndustryTemplate> {
  return {
    dashboardMode: 'light_service',
    defaultNavigation: [
      '/admin/overview', '/admin/setup-wizard', '/admin/offices', '/admin/services',
      '/admin/staff', '/admin/analytics', '/admin/customers', '/admin/calendar',
      '/admin/bookings', '/admin/settings', '/desk',
    ],
    enabledModules: ['virtual_join', 'customer_history', 'feedback', 'staff_assignment'],
    onboardingCopy: {
      headline: 'Launch a client-first waitlist',
      description: 'Keep the flow simple while supporting preferred barber or stylist routing.',
      reviewChecklist: ['Assign barbers to desks', 'Review named client copy', 'Tune manual wait estimates'],
    },
    recommendedRoles: [...ADMIN_LIKE_ROLES, STAFF_ROLES.RECEPTIONIST, STAFF_ROLES.DESK_OPERATOR],
    defaultSlas: [{ metric: 'client_wait', label: 'Average client wait under', targetMinutes: 15 }],
    capabilityFlags: { kiosk: false, displayBoard: false, intakeForms: false, multiDepartment: false, controllerHost: false },
    workflowProfile: {
      noShowPolicy: { enabled: true, timeoutMinutes: 5, autoClose: true },
      transferPolicy: { enabled: false, preservePriority: false },
    },
    queuePolicy: {
      capacityLimit: 40,
      remoteJoinNotice: 'Track your turn and head back when your barber or stylist is almost ready.',
    },
    experienceProfile: {
      dashboardMode: 'light_service',
      kiosk: {
        welcomeMessage: 'Join the shop waitlist',
        headerText: 'Welcome',
        themeColor: '#7c3aed',
        buttonLabel: 'Join Waitlist',
        showPriorities: false,
        idleTimeoutSeconds: 45,
      },
      publicJoin: {
        headline: 'Your chair is almost ready',
        subheadline: 'Track your turn and head back when your barber is ready.',
        requireCustomerName: true,
        namedPartyLabel: 'Client name',
      },
      display: { showNextUp: true, showDepartmentBreakdown: false },
      messagingTone: 'friendly',
      supportedLanguages: ['en', 'es'],
      accessibility: { highContrast: false, bilingualSignage: false, speakAnnouncements: false },
      branding: { recommendedPrimaryColor: '#7c3aed' },
      vocabulary: {
        officeLabel: 'Shop',
        departmentLabel: 'Queue',
        serviceLabel: 'Service',
        deskLabel: 'Chair',
        customerLabel: 'Client',
        bookingLabel: 'Booking',
        queueLabel: 'Waitlist',
      },
    },
    starterPriorities: [],
    starterOffices: [
      {
        branchType: 'salon_shop',
        name: 'Main Shop',
        timezone: 'Africa/Algiers',
        operatingHours: SHOP_HOURS,
        displayScreens: [],
        departments: [
          {
            name: 'Chair Queue', code: 'C', sortOrder: 1,
            services: [
              { name: 'Haircut', code: 'CUT', estimatedServiceTime: 25, sortOrder: 1 },
              { name: 'Beard Trim', code: 'BEARD', estimatedServiceTime: 15, sortOrder: 2 },
              { name: 'Kids Cut', code: 'KIDS', estimatedServiceTime: 20, sortOrder: 3 },
              { name: 'Color Touch-Up', code: 'COLOR', estimatedServiceTime: 35, sortOrder: 4 },
            ],
          },
        ],
        desks: [
          starterDesk('chair-1', 'C', ['CUT', 'BEARD'], 'Chair 1'),
          starterDesk('chair-2', 'C', ['CUT', 'KIDS'], 'Chair 2'),
          starterDesk('chair-3', 'C', ['CUT', 'COLOR'], 'Chair 3'),
          starterDesk('wash-station', 'C', ['COLOR'], 'Wash Station'),
        ],
        officeSettings: {
          platform_service_areas: [
            { id: 'front', label: 'Front Desk', type: 'check_in' },
            { id: 'chairs', label: 'Cutting Chairs', type: 'service_zone' },
            { id: 'wash', label: 'Wash Station', type: 'prep_zone' },
          ],
          platform_chair_presets: [
            { code: 'CH1', label: 'Chair 1', specialty: 'Classic cuts' },
            { code: 'CH2', label: 'Chair 2', specialty: 'Kids and quick cuts' },
            { code: 'CH3', label: 'Chair 3', specialty: 'Color and styling' },
          ],
          platform_staff_preferences: { allowPreferredStaff: true, showReturnSoonMessaging: true },
        },
      },
    ],
    intakeSchemas: [],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  EDUCATION
// ═══════════════════════════════════════════════════════════════════════════

export function getEducationOverlay(): DeepPartial<IndustryTemplate> {
  return {
    onboardingCopy: {
      headline: 'Launch your campus service desk',
      description: 'Student services, admissions, and advising with appointment and walk-in support.',
      reviewChecklist: [
        'Set up your departments (Admissions, Advising, Financial Aid, etc.)',
        'Configure appointment slots for advising sessions',
        'Customize the student-facing check-in flow',
      ],
    },
    experienceProfile: {
      dashboardMode: 'standard_service',
      messagingTone: 'friendly',
      vocabulary: {
        officeLabel: 'Campus Office',
        departmentLabel: 'Department',
        serviceLabel: 'Service',
        deskLabel: 'Window',
        customerLabel: 'Student',
        bookingLabel: 'Appointment',
        queueLabel: 'Queue',
      },
      kiosk: {
        welcomeMessage: 'Welcome to Student Services',
        headerText: 'Student check-in',
        themeColor: '#1d4ed8',
        buttonLabel: 'Check In',
      },
      publicJoin: {
        headline: 'Your campus visit',
        subheadline: 'Check in and we\'ll call you when it\'s your turn.',
        requireCustomerName: true,
        namedPartyLabel: 'Student name',
      },
      branding: { recommendedPrimaryColor: '#1d4ed8' },
    },
    starterOffices: [
      {
        branchType: 'campus_office',
        name: 'Student Services Center',
        timezone: 'Africa/Algiers',
        operatingHours: WEEKDAY_SERVICE_HOURS,
        departments: [
          {
            name: 'Admissions', code: 'ADM', sortOrder: 1,
            services: [
              { name: 'New Application', code: 'APP', estimatedServiceTime: 20, sortOrder: 1 },
              { name: 'Status Inquiry', code: 'STATUS', estimatedServiceTime: 10, sortOrder: 2 },
            ],
          },
          {
            name: 'Advising', code: 'ADV', sortOrder: 2,
            services: [
              { name: 'Academic Advising', code: 'ACAD', estimatedServiceTime: 25, sortOrder: 1 },
              { name: 'Course Registration', code: 'REG', estimatedServiceTime: 15, sortOrder: 2 },
            ],
          },
          {
            name: 'Financial Aid', code: 'FIN', sortOrder: 3,
            services: [
              { name: 'Aid Application', code: 'AID', estimatedServiceTime: 20, sortOrder: 1 },
              { name: 'Payment Inquiry', code: 'PAY', estimatedServiceTime: 10, sortOrder: 2 },
            ],
          },
        ],
        desks: [
          starterDesk('window-1', 'ADM', ['APP', 'STATUS'], 'Window 1'),
          starterDesk('window-2', 'ADV', ['ACAD', 'REG'], 'Window 2'),
          starterDesk('window-3', 'FIN', ['AID', 'PAY'], 'Window 3'),
        ],
        displayScreens: [starterDisplay('Lobby Display', 'list')],
        officeSettings: {},
      },
    ],
    intakeSchemas: [],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  TELECOM
// ═══════════════════════════════════════════════════════════════════════════

export function getTelecomOverlay(): DeepPartial<IndustryTemplate> {
  return {
    onboardingCopy: {
      headline: 'Launch your telecom store queue',
      description: 'Walk-in and appointment support for sales, repairs, and account services.',
      reviewChecklist: [
        'Set up service areas (Sales, Technical, Account)',
        'Configure walk-in and appointment flow',
        'Customize customer-facing kiosk messaging',
      ],
    },
    experienceProfile: {
      dashboardMode: 'standard_service',
      messagingTone: 'professional',
      vocabulary: {
        officeLabel: 'Store',
        departmentLabel: 'Service Area',
        serviceLabel: 'Service',
        deskLabel: 'Counter',
        customerLabel: 'Customer',
        bookingLabel: 'Appointment',
        queueLabel: 'Queue',
      },
      kiosk: {
        welcomeMessage: 'How can we help today?',
        headerText: 'Store check-in',
        themeColor: '#7c3aed',
        buttonLabel: 'Get in Line',
      },
      publicJoin: {
        headline: 'Your store visit',
        subheadline: 'We\'ll call you when a representative is available.',
        requireCustomerName: true,
        namedPartyLabel: 'Customer name',
      },
      branding: { recommendedPrimaryColor: '#7c3aed' },
    },
    starterOffices: [
      {
        branchType: 'retail_store',
        name: 'Main Store',
        timezone: 'Africa/Algiers',
        operatingHours: SHOP_HOURS,
        departments: [
          {
            name: 'Sales', code: 'S', sortOrder: 1,
            services: [
              { name: 'New Line', code: 'NEW', estimatedServiceTime: 20, sortOrder: 1 },
              { name: 'Upgrade', code: 'UPGRADE', estimatedServiceTime: 15, sortOrder: 2 },
              { name: 'Accessories', code: 'ACC', estimatedServiceTime: 10, sortOrder: 3 },
            ],
          },
          {
            name: 'Technical Support', code: 'T', sortOrder: 2,
            services: [
              { name: 'Device Repair', code: 'REPAIR', estimatedServiceTime: 25, sortOrder: 1 },
              { name: 'Troubleshooting', code: 'TROUBLE', estimatedServiceTime: 15, sortOrder: 2 },
            ],
          },
          {
            name: 'Account Services', code: 'A', sortOrder: 3,
            services: [
              { name: 'Billing', code: 'BILL', estimatedServiceTime: 10, sortOrder: 1 },
              { name: 'Plan Change', code: 'PLAN', estimatedServiceTime: 12, sortOrder: 2 },
            ],
          },
        ],
        desks: [
          starterDesk('counter-1', 'S', ['NEW', 'UPGRADE', 'ACC'], 'Counter 1'),
          starterDesk('counter-2', 'T', ['REPAIR', 'TROUBLE'], 'Counter 2'),
          starterDesk('counter-3', 'A', ['BILL', 'PLAN'], 'Counter 3'),
        ],
        displayScreens: [starterDisplay('Store Display', 'list')],
        officeSettings: {},
      },
    ],
    intakeSchemas: [],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  INSURANCE
// ═══════════════════════════════════════════════════════════════════════════

export function getInsuranceOverlay(): DeepPartial<IndustryTemplate> {
  return {
    onboardingCopy: {
      headline: 'Launch your insurance office queue',
      description: 'Claims, policy reviews, and new applications with appointment support.',
      reviewChecklist: [
        'Configure service types (Claims, New Policy, Review)',
        'Set up appointment and walk-in flow',
        'Customize intake forms for claim details',
      ],
    },
    experienceProfile: {
      dashboardMode: 'standard_service',
      messagingTone: 'professional',
      vocabulary: {
        officeLabel: 'Agency',
        departmentLabel: 'Department',
        serviceLabel: 'Service',
        deskLabel: 'Office',
        customerLabel: 'Client',
        bookingLabel: 'Appointment',
        queueLabel: 'Client Queue',
      },
      kiosk: {
        welcomeMessage: 'Welcome — how can we assist you?',
        headerText: 'Client check-in',
        themeColor: '#0369a1',
        buttonLabel: 'Check In',
      },
      publicJoin: {
        headline: 'Your appointment',
        subheadline: 'Check in and your agent will be with you shortly.',
        requireCustomerName: true,
        namedPartyLabel: 'Client name',
      },
      branding: { recommendedPrimaryColor: '#0369a1' },
    },
    starterOffices: [
      {
        branchType: 'agency_office',
        name: 'Insurance Agency',
        timezone: 'Africa/Algiers',
        operatingHours: EXTENDED_BRANCH_HOURS,
        departments: [
          {
            name: 'Claims', code: 'CL', sortOrder: 1,
            services: [
              { name: 'File a Claim', code: 'FILE', estimatedServiceTime: 25, sortOrder: 1 },
              { name: 'Claim Status', code: 'STATUS', estimatedServiceTime: 10, sortOrder: 2 },
            ],
          },
          {
            name: 'Policies', code: 'PO', sortOrder: 2,
            services: [
              { name: 'New Policy', code: 'NEW', estimatedServiceTime: 30, sortOrder: 1 },
              { name: 'Policy Review', code: 'REVIEW', estimatedServiceTime: 20, sortOrder: 2 },
              { name: 'Renewal', code: 'RENEW', estimatedServiceTime: 15, sortOrder: 3 },
            ],
          },
        ],
        desks: [
          starterDesk('desk-1', 'CL', ['FILE', 'STATUS'], 'Desk 1'),
          starterDesk('desk-2', 'PO', ['NEW', 'REVIEW', 'RENEW'], 'Desk 2'),
        ],
        displayScreens: [starterDisplay('Lobby Display', 'list')],
        officeSettings: {},
      },
    ],
    intakeSchemas: [],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  AUTOMOTIVE
// ═══════════════════════════════════════════════════════════════════════════

export function getAutomotiveOverlay(): DeepPartial<IndustryTemplate> {
  return {
    onboardingCopy: {
      headline: 'Launch your automotive service queue',
      description: 'Service appointments, walk-in repairs, and parts counter with technician routing.',
      reviewChecklist: [
        'Set up service bays and parts counter',
        'Configure appointment and walk-in flow',
        'Customize the customer-facing check-in',
      ],
    },
    experienceProfile: {
      dashboardMode: 'standard_service',
      messagingTone: 'friendly',
      vocabulary: {
        officeLabel: 'Shop',
        departmentLabel: 'Service Area',
        serviceLabel: 'Service',
        deskLabel: 'Bay',
        customerLabel: 'Customer',
        bookingLabel: 'Appointment',
        queueLabel: 'Service Queue',
      },
      kiosk: {
        welcomeMessage: 'Welcome — check in for service',
        headerText: 'Service check-in',
        themeColor: '#b91c1c',
        buttonLabel: 'Check In',
      },
      publicJoin: {
        headline: 'Your vehicle service',
        subheadline: 'We\'ll notify you when your vehicle is ready.',
        requireCustomerName: true,
        namedPartyLabel: 'Customer name',
      },
      branding: { recommendedPrimaryColor: '#b91c1c' },
    },
    starterOffices: [
      {
        branchType: 'workshop',
        name: 'Service Center',
        timezone: 'Africa/Algiers',
        operatingHours: SHOP_HOURS,
        departments: [
          {
            name: 'Service', code: 'SVC', sortOrder: 1,
            services: [
              { name: 'Oil Change', code: 'OIL', estimatedServiceTime: 30, sortOrder: 1 },
              { name: 'Tire Service', code: 'TIRE', estimatedServiceTime: 40, sortOrder: 2 },
              { name: 'Brake Service', code: 'BRAKE', estimatedServiceTime: 60, sortOrder: 3 },
              { name: 'General Repair', code: 'REPAIR', estimatedServiceTime: 45, sortOrder: 4 },
            ],
          },
          {
            name: 'Parts Counter', code: 'PRT', sortOrder: 2,
            services: [
              { name: 'Parts Pickup', code: 'PICKUP', estimatedServiceTime: 10, sortOrder: 1 },
              { name: 'Parts Order', code: 'ORDER', estimatedServiceTime: 15, sortOrder: 2 },
            ],
          },
        ],
        desks: [
          starterDesk('bay-1', 'SVC', ['OIL', 'TIRE', 'BRAKE', 'REPAIR'], 'Bay 1'),
          starterDesk('bay-2', 'SVC', ['OIL', 'TIRE', 'BRAKE', 'REPAIR'], 'Bay 2'),
          starterDesk('parts-counter', 'PRT', ['PICKUP', 'ORDER'], 'Parts Counter'),
        ],
        displayScreens: [starterDisplay('Waiting Room Display', 'list')],
        officeSettings: {},
      },
    ],
    intakeSchemas: [],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  LEGAL
// ═══════════════════════════════════════════════════════════════════════════

export function getLegalOverlay(): DeepPartial<IndustryTemplate> {
  return {
    onboardingCopy: {
      headline: 'Launch your law office queue',
      description: 'Appointment-focused client management for consultations and case reviews.',
      reviewChecklist: [
        'Configure consultation types',
        'Set up appointment scheduling',
        'Customize the client intake flow',
      ],
    },
    experienceProfile: {
      dashboardMode: 'light_service',
      messagingTone: 'professional',
      vocabulary: {
        officeLabel: 'Office',
        departmentLabel: 'Practice Area',
        serviceLabel: 'Consultation',
        deskLabel: 'Office',
        customerLabel: 'Client',
        bookingLabel: 'Appointment',
        queueLabel: 'Client Queue',
      },
      kiosk: {
        welcomeMessage: 'Welcome — please check in',
        headerText: 'Client check-in',
        themeColor: '#1e3a5f',
        buttonLabel: 'Check In',
      },
      publicJoin: {
        headline: 'Your consultation',
        subheadline: 'Your attorney will be with you shortly.',
        requireCustomerName: true,
        namedPartyLabel: 'Client name',
      },
      branding: { recommendedPrimaryColor: '#1e3a5f' },
    },
    starterOffices: [
      {
        branchType: 'law_office',
        name: 'Law Office',
        timezone: 'Africa/Algiers',
        operatingHours: EXTENDED_BRANCH_HOURS,
        departments: [
          {
            name: 'Consultations', code: 'C', sortOrder: 1,
            services: [
              { name: 'Initial Consultation', code: 'INITIAL', estimatedServiceTime: 30, sortOrder: 1 },
              { name: 'Follow-Up', code: 'FOLLOWUP', estimatedServiceTime: 20, sortOrder: 2 },
              { name: 'Document Review', code: 'DOCS', estimatedServiceTime: 25, sortOrder: 3 },
            ],
          },
        ],
        desks: [
          starterDesk('office-1', 'C', ['INITIAL', 'FOLLOWUP', 'DOCS'], 'Office 1'),
          starterDesk('office-2', 'C', ['INITIAL', 'FOLLOWUP', 'DOCS'], 'Office 2'),
        ],
        displayScreens: [],
        officeSettings: {},
      },
    ],
    intakeSchemas: [],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  REAL ESTATE
// ═══════════════════════════════════════════════════════════════════════════

export function getRealEstateOverlay(): DeepPartial<IndustryTemplate> {
  return {
    onboardingCopy: {
      headline: 'Launch your real estate office queue',
      description: 'Walk-in and appointment visits for property viewings, signings, and inquiries.',
      reviewChecklist: [
        'Set up service types (Viewing, Inquiry, Signing)',
        'Configure appointment availability',
        'Customize the visitor check-in flow',
      ],
    },
    experienceProfile: {
      dashboardMode: 'light_service',
      messagingTone: 'professional',
      vocabulary: {
        officeLabel: 'Office',
        departmentLabel: 'Department',
        serviceLabel: 'Service',
        deskLabel: 'Office',
        customerLabel: 'Client',
        bookingLabel: 'Appointment',
        queueLabel: 'Client Queue',
      },
      kiosk: {
        welcomeMessage: 'Welcome — please check in',
        headerText: 'Visitor check-in',
        themeColor: '#15803d',
        buttonLabel: 'Check In',
      },
      publicJoin: {
        headline: 'Your appointment',
        subheadline: 'Your agent will be with you shortly.',
        requireCustomerName: true,
        namedPartyLabel: 'Client name',
      },
      branding: { recommendedPrimaryColor: '#15803d' },
    },
    starterOffices: [
      {
        branchType: 'property_office',
        name: 'Real Estate Office',
        timezone: 'Africa/Algiers',
        operatingHours: EXTENDED_BRANCH_HOURS,
        departments: [
          {
            name: 'Client Services', code: 'CS', sortOrder: 1,
            services: [
              { name: 'Property Inquiry', code: 'INQUIRY', estimatedServiceTime: 15, sortOrder: 1 },
              { name: 'Viewing Appointment', code: 'VIEWING', estimatedServiceTime: 30, sortOrder: 2 },
              { name: 'Contract Signing', code: 'SIGNING', estimatedServiceTime: 40, sortOrder: 3 },
            ],
          },
        ],
        desks: [
          starterDesk('office-1', 'CS', ['INQUIRY', 'VIEWING', 'SIGNING'], 'Office 1'),
          starterDesk('office-2', 'CS', ['INQUIRY', 'VIEWING', 'SIGNING'], 'Office 2'),
        ],
        displayScreens: [],
        officeSettings: {},
      },
    ],
    intakeSchemas: [],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  OTHER / GENERAL SERVICE
// ═══════════════════════════════════════════════════════════════════════════

export function getGeneralServiceOverlay(): DeepPartial<IndustryTemplate> {
  return {
    onboardingCopy: {
      headline: 'Configurez votre file d\'attente',
      description: 'File d\'attente flexible pour tout type de commerce ou service.',
      reviewChecklist: [
        'Nommez vos services',
        'Configurez vos guichets',
        'Activez la file à distance',
      ],
    },
    experienceProfile: {
      dashboardMode: 'light_service',
      messagingTone: 'friendly',
      vocabulary: {
        officeLabel: 'Office',
        departmentLabel: 'Department',
        serviceLabel: 'Service',
        deskLabel: 'Desk',
        customerLabel: 'Customer',
        bookingLabel: 'Appointment',
        queueLabel: 'Queue',
      },
      kiosk: {
        welcomeMessage: 'Bienvenue',
        headerText: 'File d\'attente',
        themeColor: '#2563eb',
        buttonLabel: 'Rejoindre',
      },
      publicJoin: {
        headline: 'Votre tour arrive',
        subheadline: 'On vous prévient quand c\'est votre tour.',
        requireCustomerName: true,
        namedPartyLabel: 'Nom',
      },
      branding: { recommendedPrimaryColor: '#2563eb' },
    },
    starterOffices: [
      {
        branchType: 'general_office',
        name: 'Local',
        timezone: 'Africa/Algiers',
        operatingHours: WEEKDAY_SERVICE_HOURS,
        departments: [
          {
            name: 'Service', code: 'S', sortOrder: 1,
            services: [
              { name: 'Accueil', code: 'ACCUEIL', estimatedServiceTime: 5, sortOrder: 1 },
              { name: 'Service Standard', code: 'STANDARD', estimatedServiceTime: 15, sortOrder: 2 },
              { name: 'Rendez-vous', code: 'RDV', estimatedServiceTime: 20, sortOrder: 3 },
            ],
          },
        ],
        desks: [
          starterDesk('accueil', 'S', ['ACCUEIL', 'STANDARD', 'RDV'], 'Accueil'),
          starterDesk('guichet-1', 'S', ['STANDARD', 'RDV'], 'Guichet 1'),
        ],
        displayScreens: [],
        officeSettings: {},
      },
    ],
    intakeSchemas: [],
  };
}
