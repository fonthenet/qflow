import {
  ADMIN_LIKE_ROLES,
  STAFF_ROLES,
  type BranchType,
  type IndustryTemplate,
  type IntakeSchema,
  type OperatingHoursPreset,
  type RolePolicy,
  type StarterDeskTemplate,
  type StarterDisplayTemplate,
  type TemplateMigration,
  type TemplateVersionChange,
} from '@queueflow/shared';

function rolePolicy(extraCapabilities: string[] = []): RolePolicy {
  return {
    roles: [
      {
        role: STAFF_ROLES.ADMIN,
        label: 'Platform Admin',
        scope: 'organization',
        adminAccess: true,
        allowedNavigation: [
          '/admin/overview',
          '/admin/onboarding',
          '/admin/template-governance',
          '/admin/offices',
          '/admin/departments',
          '/admin/services',
          '/admin/desks',
          '/admin/staff',
          '/admin/priorities',
          '/admin/virtual-codes',
          '/admin/audit',
          '/admin/analytics',
          '/admin/customers',
          '/admin/bookings',
          '/admin/kiosk',
          '/admin/displays',
          '/admin/settings',
          '/desk',
        ],
        capabilities: ['template_apply', 'governance', 'configuration'],
      },
      {
        role: STAFF_ROLES.MANAGER,
        label: 'Operations Manager',
        scope: 'organization',
        adminAccess: true,
        allowedNavigation: [
          '/admin/overview',
          '/admin/onboarding',
          '/admin/template-governance',
          '/admin/offices',
          '/admin/departments',
          '/admin/services',
          '/admin/desks',
          '/admin/staff',
          '/admin/audit',
          '/admin/analytics',
          '/admin/bookings',
          '/admin/kiosk',
          '/admin/displays',
          '/admin/settings',
          '/desk',
        ],
        capabilities: ['configuration', 'analytics', ...extraCapabilities],
      },
      {
        role: STAFF_ROLES.BRANCH_ADMIN,
        label: 'Branch Admin',
        scope: 'office',
        adminAccess: true,
        allowedNavigation: [
          '/admin/overview',
          '/admin/offices',
          '/admin/departments',
          '/admin/services',
          '/admin/desks',
          '/admin/audit',
          '/admin/analytics',
          '/admin/bookings',
          '/admin/kiosk',
          '/admin/displays',
          '/desk',
        ],
        capabilities: ['branch_configuration', 'queue_supervision'],
      },
      {
        role: STAFF_ROLES.RECEPTIONIST,
        label: 'Reception / Check-In',
        scope: 'shift',
        adminAccess: false,
        allowedNavigation: ['/desk'],
        capabilities: ['check_in', 'customer_lookup'],
      },
      {
        role: STAFF_ROLES.DESK_OPERATOR,
        label: 'Desk Operator',
        scope: 'shift',
        adminAccess: false,
        allowedNavigation: ['/desk'],
        capabilities: ['call_next', 'serve', 'recall', 'buzz'],
      },
      {
        role: STAFF_ROLES.FLOOR_MANAGER,
        label: 'Floor Manager',
        scope: 'office',
        adminAccess: false,
        allowedNavigation: ['/admin/analytics', '/desk'],
        capabilities: ['queue_supervision', 'transfer'],
      },
      {
        role: STAFF_ROLES.ANALYST,
        label: 'Analyst',
        scope: 'organization',
        adminAccess: false,
        allowedNavigation: ['/admin/audit', '/admin/analytics', '/admin/customers', '/admin/bookings', '/desk'],
        capabilities: ['analytics', 'branch_comparison'],
      },
      {
        role: STAFF_ROLES.AGENT,
        label: 'Legacy Agent',
        scope: 'shift',
        adminAccess: false,
        allowedNavigation: ['/desk'],
        capabilities: ['call_next', 'serve'],
      },
    ],
  };
}

const WEEKDAY_SERVICE_HOURS: OperatingHoursPreset = {
  monday: { open: '08:00', close: '17:00' },
  tuesday: { open: '08:00', close: '17:00' },
  wednesday: { open: '08:00', close: '17:00' },
  thursday: { open: '08:00', close: '17:00' },
  friday: { open: '08:00', close: '17:00' },
  saturday: { open: '09:00', close: '13:00' },
  sunday: { open: '00:00', close: '00:00' },
};

const EXTENDED_BRANCH_HOURS: OperatingHoursPreset = {
  monday: { open: '09:00', close: '18:00' },
  tuesday: { open: '09:00', close: '18:00' },
  wednesday: { open: '09:00', close: '18:00' },
  thursday: { open: '09:00', close: '18:00' },
  friday: { open: '09:00', close: '18:00' },
  saturday: { open: '10:00', close: '14:00' },
  sunday: { open: '00:00', close: '00:00' },
};

const CLINIC_HOURS: OperatingHoursPreset = {
  monday: { open: '08:30', close: '17:30' },
  tuesday: { open: '08:30', close: '17:30' },
  wednesday: { open: '08:30', close: '17:30' },
  thursday: { open: '08:30', close: '17:30' },
  friday: { open: '08:30', close: '17:30' },
  saturday: { open: '09:00', close: '13:00' },
  sunday: { open: '00:00', close: '00:00' },
};

const HOSPITALITY_HOURS: OperatingHoursPreset = {
  monday: { open: '11:00', close: '22:00' },
  tuesday: { open: '11:00', close: '22:00' },
  wednesday: { open: '11:00', close: '22:00' },
  thursday: { open: '11:00', close: '22:00' },
  friday: { open: '11:00', close: '23:00' },
  saturday: { open: '10:00', close: '23:00' },
  sunday: { open: '10:00', close: '21:00' },
};

const SHOP_HOURS: OperatingHoursPreset = {
  monday: { open: '09:00', close: '18:00' },
  tuesday: { open: '09:00', close: '18:00' },
  wednesday: { open: '09:00', close: '18:00' },
  thursday: { open: '09:00', close: '19:00' },
  friday: { open: '09:00', close: '19:00' },
  saturday: { open: '09:00', close: '17:00' },
  sunday: { open: '00:00', close: '00:00' },
};

function starterDesk(
  name: string,
  departmentCode: string,
  serviceCodes: string[],
  displayName?: string,
  status: StarterDeskTemplate['status'] = 'open'
): StarterDeskTemplate {
  return {
    name,
    departmentCode,
    serviceCodes,
    displayName,
    status,
  };
}

function starterDisplay(
  name: string,
  layout?: StarterDisplayTemplate['layout'],
  settings?: StarterDisplayTemplate['settings']
): StarterDisplayTemplate {
  return {
    name,
    layout,
    isActive: true,
    settings,
  };
}

function restaurantIntakeSchema(
  serviceCode: string,
  includeReservationReference = false
): IntakeSchema {
  return {
    serviceCode,
    title: includeReservationReference ? 'Reservation arrival details' : 'Party details',
    fields: [
      { key: 'party_name', label: 'Party name', type: 'text', required: true, visibility: 'public' as const },
      { key: 'mobile_number', label: 'Mobile number', type: 'phone', required: true, visibility: 'public' as const },
      {
        key: 'party_size',
        label: 'Party size',
        type: 'select',
        required: true,
        visibility: 'public' as const,
        options: ['1-2', '3-4', '5-6', '7+'],
      },
      {
        key: 'seating_preference',
        label: 'Seating preference',
        type: 'select',
        required: false,
        visibility: 'public' as const,
        options: ['First available', 'Indoor', 'Outdoor', 'Bar'],
      },
      {
        key: 'accessibility_seating',
        label: 'Need accessible seating',
        type: 'checkbox',
        required: false,
        visibility: 'public' as const,
      },
      {
        key: 'high_chair',
        label: 'Need a high chair',
        type: 'checkbox',
        required: false,
        visibility: 'public' as const,
      },
      ...(includeReservationReference
        ? [
            {
              key: 'reservation_reference',
              label: 'Reservation name or reference',
              type: 'text' as const,
              required: false,
              visibility: 'public' as const,
            },
          ]
        : []),
      {
        key: 'host_notes',
        label: 'Host notes',
        type: 'textarea',
        required: false,
        visibility: 'staff_only' as const,
      },
    ],
    complianceNotes: [],
  };
}

function templateVocabulary(labels: {
  officeLabel: string;
  departmentLabel: string;
  serviceLabel: string;
  deskLabel: string;
  customerLabel: string;
  bookingLabel: string;
  queueLabel: string;
}) {
  return labels;
}

function starterOffice(
  branchType: BranchType,
  name: string,
  departments: IndustryTemplate['starterOffices'][number]['departments'],
  options: Partial<Omit<IndustryTemplate['starterOffices'][number], 'branchType' | 'name' | 'timezone' | 'departments'>> = {}
) {
  return {
    branchType,
    name,
    timezone: 'America/Los_Angeles',
    operatingHours: options.operatingHours,
    desks: options.desks ?? [],
    displayScreens: options.displayScreens ?? [],
    officeSettings: options.officeSettings ?? {},
    departments,
  };
}

function migrationChange(
  id: string,
  section: TemplateVersionChange['section'],
  impact: TemplateVersionChange['impact'],
  title: string,
  description: string,
  recommendedAction?: string
): TemplateVersionChange {
  return {
    id,
    section,
    impact,
    title,
    description,
    recommendedAction,
  };
}

function versionMetadata(
  current: string,
  previous: string[],
  notes: string,
  migrations: TemplateMigration[]
) {
  return {
    current,
    previous,
    updatedAt: '2026-03-15',
    notes,
    migrations,
  };
}

export const industryTemplates: IndustryTemplate[] = [
  {
    id: 'public-service',
    title: 'Public Service Branch',
    vertical: 'public_service',
    version: versionMetadata('1.1.0', ['1.0.0'], 'Canonical structured ticket flow with stronger self-service defaults.', [
      {
        fromVersion: '1.0.0',
        toVersion: '1.1.0',
        releasedAt: '2026-03-15',
        summary: 'Improves queue resilience and kiosk pacing for public-service branches.',
        officeRolloutRecommended: true,
        changes: [
          migrationChange(
            'public-service-kiosk-timeout',
            'experience_profile',
            'safe',
            'Longer kiosk idle timeout',
            'Kiosk idle timeout increases from 60 to 75 seconds to reduce unintended resets.'
          ),
          migrationChange(
            'public-service-no-show-window',
            'workflow_profile',
            'review_required',
            'Adjusted no-show timeout',
            'The no-show timeout increases from 10 to 12 minutes to better match high-volume public counters.',
            'Review whether branch staffing can tolerate the longer grace period.'
          ),
          migrationChange(
            'public-service-capacity',
            'queue_policy',
            'safe',
            'Higher queue capacity default',
            'Default queue capacity increases from 120 to 140 customers.'
          ),
        ],
      },
    ]),
    dashboardMode: 'public_service',
    defaultNavigation: ['/admin/overview', '/admin/onboarding', '/admin/offices', '/admin/departments', '/admin/services', '/admin/desks', '/admin/priorities', '/admin/displays', '/admin/kiosk', '/admin/bookings', '/admin/analytics', '/admin/settings', '/desk'],
    enabledModules: ['kiosk', 'display_board', 'priority_categories', 'appointments', 'branch_comparison'],
    onboardingCopy: {
      headline: 'Launch a public-service branch',
      description: 'Department-first queue with ticket numbers, accessibility defaults, and display-heavy operations.',
      reviewChecklist: ['Confirm branch timezone', 'Review department names', 'Enable accessibility languages'],
    },
    recommendedRoles: [...ADMIN_LIKE_ROLES, STAFF_ROLES.RECEPTIONIST, STAFF_ROLES.DESK_OPERATOR, STAFF_ROLES.FLOOR_MANAGER, STAFF_ROLES.ANALYST],
    defaultSlas: [
      { metric: 'first_call', label: 'Call customer within', targetMinutes: 20 },
      { metric: 'average_wait', label: 'Average wait under', targetMinutes: 25 },
    ],
    capabilityFlags: {
      appointments: true,
      virtualJoin: true,
      kiosk: true,
      displayBoard: true,
      branchComparison: true,
      customerHistory: true,
      feedback: true,
      staffAssignment: true,
      deviceIntegrations: true,
      intakeForms: true,
      multiDepartment: true,
      privacySafeDisplay: false,
    },
    workflowProfile: {
      queueLifecycle: 'ticket',
      appointmentStrategy: 'blended',
      noShowPolicy: { enabled: true, timeoutMinutes: 12, autoClose: true },
      recallPolicy: { enabled: true, maxRecalls: 2, resetCountdown: true },
      buzzPolicy: { enabled: true, escalationChannel: 'push_and_sms' },
      transferPolicy: { enabled: true, preservePriority: true },
      chainingRules: { enabled: false, allowDepartmentHandOff: false, requireCompletionNotes: false },
    },
    queuePolicy: {
      numberingFormat: 'department_sequence',
      priorityMode: 'category_weight',
      routingMode: 'department_first',
      capacityLimit: 140,
      estimatedWaitStrategy: 'historical_average',
      remoteJoin: 'enabled',
      remoteJoinNotice: 'Join remotely and arrive when your number is close.',
    },
    experienceProfile: {
      dashboardMode: 'public_service',
      kiosk: {
        welcomeMessage: 'Select a service',
        headerText: 'Take your ticket',
        themeColor: '#1d4ed8',
        buttonLabel: 'Get Ticket',
        mode: 'normal',
        showPriorities: true,
        showEstimatedTime: true,
        showGroupTickets: false,
        idleTimeoutSeconds: 75,
      },
      publicJoin: {
        headline: 'Track your ticket live',
        subheadline: 'Use your QR code to follow your place in line from anywhere nearby.',
        requireCustomerName: false,
        namedPartyLabel: 'Customer name',
      },
      display: {
        defaultLayout: 'department_split',
        theme: 'light',
        showClock: true,
        showNextUp: true,
        showDepartmentBreakdown: true,
        announcementSound: true,
      },
      messagingTone: 'institutional',
      supportedLanguages: ['en', 'es', 'fr', 'ar'],
      accessibility: { highContrast: true, bilingualSignage: true, speakAnnouncements: true },
      branding: { allowBusinessBranding: true, recommendedPrimaryColor: '#1d4ed8', allowWhiteLabel: false },
      vocabulary: templateVocabulary({
        officeLabel: 'Branch',
        departmentLabel: 'Department',
        serviceLabel: 'Service',
        deskLabel: 'Counter',
        customerLabel: 'Customer',
        bookingLabel: 'Appointment',
        queueLabel: 'Queue',
      }),
    },
    rolePolicy: rolePolicy(['priority_override']),
    starterPriorities: [
      { name: 'Senior', icon: '🧓', color: '#f97316', weight: 20 },
      { name: 'Accessible', icon: '♿', color: '#0ea5e9', weight: 25 },
      { name: 'Veteran', icon: '🎖️', color: '#22c55e', weight: 15 },
    ],
    starterOffices: [
      starterOffice(
        'service_center',
        'Main Branch',
        [
          {
            name: 'Mail & Parcels',
            code: 'M',
            sortOrder: 1,
            services: [
              { name: 'Drop-off', code: 'DROP', estimatedServiceTime: 6, sortOrder: 1 },
              { name: 'Collection', code: 'COLLECT', estimatedServiceTime: 4, sortOrder: 2 },
              { name: 'Registered Mail', code: 'REGMAIL', estimatedServiceTime: 9, sortOrder: 3 },
            ],
          },
          {
            name: 'Financial Services',
            code: 'F',
            sortOrder: 2,
            services: [
              { name: 'Money Order', code: 'MONEY', estimatedServiceTime: 10, sortOrder: 1 },
              { name: 'Bill Pay', code: 'BILL', estimatedServiceTime: 7, sortOrder: 2 },
              { name: 'Identity Verification', code: 'VERIFY', estimatedServiceTime: 12, sortOrder: 3 },
            ],
          },
        ],
        {
          operatingHours: WEEKDAY_SERVICE_HOURS,
          desks: [
            starterDesk('counter-1', 'M', ['DROP', 'COLLECT'], 'Counter 1'),
            starterDesk('counter-2', 'M', ['DROP', 'REGMAIL'], 'Counter 2'),
            starterDesk('counter-3', 'F', ['MONEY', 'BILL'], 'Counter 3'),
            starterDesk('accessibility-desk', 'F', ['VERIFY', 'MONEY'], 'Accessibility Desk'),
          ],
          displayScreens: [
            starterDisplay('Main Hall Screen', 'department_split', {
              theme: 'light',
              show_clock: true,
              show_next_up: true,
              zone: 'main_lobby',
            }),
            starterDisplay('Parcel Pickup Screen', 'list', {
              theme: 'light',
              show_department_breakdown: false,
              zone: 'parcel_wall',
            }),
          ],
          officeSettings: {
            platform_service_areas: [
              { id: 'lobby', label: 'Main Lobby', type: 'queue_zone' },
              { id: 'parcel-wall', label: 'Parcel Wall', type: 'pickup_zone' },
              { id: 'accessibility-lane', label: 'Accessibility Lane', type: 'priority_zone' },
            ],
            platform_counter_map: [
              { counter: 'Counter 1', departmentCode: 'M' },
              { counter: 'Counter 2', departmentCode: 'M' },
              { counter: 'Counter 3', departmentCode: 'F' },
              { counter: 'Accessibility Desk', departmentCode: 'F' },
            ],
            platform_signage_messages: [
              'Have your ID and forms ready.',
              'Priority tickets are supported at all counters.',
            ],
          },
        }
      ),
    ],
    intakeSchemas: [
      {
        serviceCode: 'DROP',
        title: 'Package details',
        fields: [
          { key: 'package_type', label: 'Package type', type: 'select', required: true, visibility: 'public', options: ['Letter', 'Parcel', 'Box'] },
        ],
        complianceNotes: [],
      },
    ],
  },
  {
    id: 'bank-branch',
    title: 'Bank Branch',
    vertical: 'bank',
    version: versionMetadata('1.1.0', ['1.0.0'], 'Appointments plus service routing with clearer lobby pacing.', [
      {
        fromVersion: '1.0.0',
        toVersion: '1.1.0',
        releasedAt: '2026-03-15',
        summary: 'Refines branch capacity and privacy defaults for mixed teller/advisory traffic.',
        officeRolloutRecommended: true,
        changes: [
          migrationChange(
            'bank-capacity',
            'queue_policy',
            'safe',
            'Higher branch capacity default',
            'Capacity increases from 80 to 90 to better reflect larger mixed-service branches.'
          ),
          migrationChange(
            'bank-display-next-up',
            'experience_profile',
            'review_required',
            'More privacy-conscious display layout',
            'The public display stops showing next-up by default in order to reduce lobby exposure.',
            'Review whether your branch still wants pre-call visibility on the display.'
          ),
          migrationChange(
            'bank-no-show-window',
            'workflow_profile',
            'safe',
            'Slightly longer appointment grace period',
            'No-show timeout increases from 8 to 10 minutes.'
          ),
        ],
      },
    ]),
    dashboardMode: 'bank',
    defaultNavigation: ['/admin/overview', '/admin/onboarding', '/admin/offices', '/admin/services', '/admin/desks', '/admin/staff', '/admin/analytics', '/admin/customers', '/admin/bookings', '/admin/displays', '/admin/settings', '/desk'],
    enabledModules: ['appointments', 'branch_comparison', 'vip_priority', 'customer_history', 'display_board'],
    onboardingCopy: {
      headline: 'Stand up a banking flow',
      description: 'Blend appointments, teller routing, and premium service tiers without forking the dashboard.',
      reviewChecklist: ['Confirm teller desks', 'Review VIP priorities', 'Enable branch comparison'],
    },
    recommendedRoles: [...ADMIN_LIKE_ROLES, STAFF_ROLES.RECEPTIONIST, STAFF_ROLES.DESK_OPERATOR, STAFF_ROLES.ANALYST],
    defaultSlas: [
      { metric: 'lobby_wait', label: 'Lobby wait under', targetMinutes: 12 },
      { metric: 'advisor_wait', label: 'Advisor wait under', targetMinutes: 20 },
    ],
    capabilityFlags: {
      appointments: true,
      virtualJoin: true,
      kiosk: true,
      displayBoard: true,
      branchComparison: true,
      customerHistory: true,
      feedback: true,
      staffAssignment: true,
      deviceIntegrations: true,
      intakeForms: true,
      multiDepartment: true,
      privacySafeDisplay: true,
    },
    workflowProfile: {
      queueLifecycle: 'hybrid',
      appointmentStrategy: 'blended',
      noShowPolicy: { enabled: true, timeoutMinutes: 10, autoClose: true },
      recallPolicy: { enabled: true, maxRecalls: 2, resetCountdown: true },
      buzzPolicy: { enabled: true, escalationChannel: 'push_and_sms' },
      transferPolicy: { enabled: true, preservePriority: true },
      chainingRules: { enabled: false, allowDepartmentHandOff: false, requireCompletionNotes: false },
    },
    queuePolicy: {
      numberingFormat: 'service_sequence',
      priorityMode: 'vip_and_priority',
      routingMode: 'service_first',
      capacityLimit: 90,
      estimatedWaitStrategy: 'service_average',
      remoteJoin: 'enabled',
      remoteJoinNotice: 'Join before arrival for teller or advisor services.',
    },
    experienceProfile: {
      dashboardMode: 'bank',
      kiosk: {
        welcomeMessage: 'Choose your banking service',
        headerText: 'Welcome to your branch',
        themeColor: '#0f766e',
        buttonLabel: 'Join Queue',
        mode: 'normal',
        showPriorities: true,
        showEstimatedTime: true,
        showGroupTickets: false,
        idleTimeoutSeconds: 75,
      },
      publicJoin: {
        headline: 'Your banking visit, timed better',
        subheadline: 'Track your queue and arrive when your specialist is nearly ready.',
        requireCustomerName: true,
        namedPartyLabel: 'Customer name',
      },
      display: {
        defaultLayout: 'list',
        theme: 'light',
        showClock: true,
        showNextUp: false,
        showDepartmentBreakdown: true,
        announcementSound: true,
      },
      messagingTone: 'professional',
      supportedLanguages: ['en', 'es', 'fr'],
      accessibility: { highContrast: true, bilingualSignage: true, speakAnnouncements: false },
      branding: { allowBusinessBranding: true, recommendedPrimaryColor: '#0f766e', allowWhiteLabel: false },
      vocabulary: templateVocabulary({
        officeLabel: 'Branch',
        departmentLabel: 'Service Area',
        serviceLabel: 'Banking Service',
        deskLabel: 'Counter',
        customerLabel: 'Customer',
        bookingLabel: 'Appointment',
        queueLabel: 'Lobby Queue',
      }),
    },
    rolePolicy: rolePolicy(['vip_override', 'customer_lookup']),
    starterPriorities: [
      { name: 'Premium', icon: '👑', color: '#ca8a04', weight: 25 },
      { name: 'Accessible', icon: '♿', color: '#0284c7', weight: 20 },
    ],
    starterOffices: [
      starterOffice(
        'branch_office',
        'Downtown Branch',
        [
          {
            name: 'Teller Services',
            code: 'T',
            sortOrder: 1,
            services: [
              { name: 'Deposit / Withdrawal', code: 'TELLER', estimatedServiceTime: 7, sortOrder: 1 },
              { name: 'Card Support', code: 'CARD', estimatedServiceTime: 8, sortOrder: 2 },
              { name: 'Wire Transfer', code: 'WIRE', estimatedServiceTime: 12, sortOrder: 3 },
            ],
          },
          {
            name: 'Advisory',
            code: 'A',
            sortOrder: 2,
            services: [
              { name: 'Account Opening', code: 'OPEN', estimatedServiceTime: 20, sortOrder: 1 },
              { name: 'Loan Consultation', code: 'LOAN', estimatedServiceTime: 30, sortOrder: 2 },
              { name: 'Business Banking', code: 'BUSINESS', estimatedServiceTime: 25, sortOrder: 3 },
            ],
          },
        ],
        {
          operatingHours: EXTENDED_BRANCH_HOURS,
          desks: [
            starterDesk('teller-1', 'T', ['TELLER', 'CARD'], 'Teller 1'),
            starterDesk('teller-2', 'T', ['TELLER', 'WIRE'], 'Teller 2'),
            starterDesk('advisor-1', 'A', ['OPEN', 'LOAN'], 'Advisor 1'),
            starterDesk('advisor-2', 'A', ['OPEN', 'BUSINESS'], 'Advisor 2'),
            starterDesk('welcome-desk', 'T', ['TELLER', 'CARD'], 'Welcome Desk'),
          ],
          displayScreens: [
            starterDisplay('Lobby Display', 'list', {
              theme: 'light',
              show_next_up: false,
              privacy_mode: 'ticket_only',
            }),
          ],
          officeSettings: {
            platform_service_areas: [
              { id: 'express', label: 'Express Teller Lane', type: 'queue_lane' },
              { id: 'advisory', label: 'Advisory Lounge', type: 'consult_zone' },
              { id: 'vip', label: 'Premium Check-In', type: 'priority_zone' },
            ],
            platform_meeting_rooms: [
              { id: 'room-1', label: 'Advisor Room 1', departmentCode: 'A' },
              { id: 'room-2', label: 'Advisor Room 2', departmentCode: 'A' },
            ],
            platform_staffing_defaults: {
              conciergeEnabled: true,
              advisorAppointmentsPreferred: true,
            },
          },
        }
      ),
    ],
    intakeSchemas: [
      {
        serviceCode: 'OPEN',
        title: 'Account opening intake',
        fields: [
          { key: 'customer_name', label: 'Full name', type: 'text', required: true, visibility: 'public' },
          { key: 'account_type', label: 'Account type', type: 'select', required: true, visibility: 'public', options: ['Checking', 'Savings', 'Business'] },
        ],
        complianceNotes: ['Review KYC requirements before going live.'],
      },
    ],
  },
  {
    id: 'clinic',
    title: 'Clinic',
    vertical: 'clinic',
    version: versionMetadata('1.1.0', ['1.0.0'], 'Privacy-aware clinic flow with stronger triage and accessibility defaults.', [
      {
        fromVersion: '1.0.0',
        toVersion: '1.1.0',
        releasedAt: '2026-03-15',
        summary: 'Improves clinic handoff behavior and multilingual support.',
        officeRolloutRecommended: true,
        changes: [
          migrationChange(
            'clinic-language-support',
            'experience_profile',
            'safe',
            'Expanded supported languages',
            'French is added to the supported language list for clinics with multilingual intake.'
          ),
          migrationChange(
            'clinic-capacity',
            'queue_policy',
            'review_required',
            'Reduced default capacity',
            'Capacity decreases from 60 to 50 to better reflect privacy-aware waiting rooms.',
            'Review waiting room throughput before adopting the lower capacity.'
          ),
          migrationChange(
            'clinic-recall-policy',
            'workflow_profile',
            'safe',
            'Shorter recall limit',
            'Maximum recalls decreases from 3 to 2 to keep check-in lanes moving.'
          ),
        ],
      },
    ]),
    dashboardMode: 'clinic',
    defaultNavigation: ['/admin/overview', '/admin/onboarding', '/admin/offices', '/admin/departments', '/admin/services', '/admin/staff', '/admin/priorities', '/admin/analytics', '/admin/bookings', '/admin/kiosk', '/admin/settings', '/desk'],
    enabledModules: ['appointments', 'intake_forms', 'display_board', 'priority_categories'],
    onboardingCopy: {
      headline: 'Launch a clinic flow',
      description: 'Start with appointments, triage, and handoffs while keeping public displays privacy-safe.',
      reviewChecklist: ['Confirm privacy-safe displays', 'Review intake fields', 'Set appointment blending rules'],
    },
    recommendedRoles: [...ADMIN_LIKE_ROLES, STAFF_ROLES.RECEPTIONIST, STAFF_ROLES.DESK_OPERATOR, STAFF_ROLES.FLOOR_MANAGER],
    defaultSlas: [
      { metric: 'check_in', label: 'Check-in completed within', targetMinutes: 5 },
      { metric: 'provider_wait', label: 'Provider wait under', targetMinutes: 15 },
    ],
    capabilityFlags: {
      appointments: true,
      virtualJoin: true,
      kiosk: true,
      displayBoard: true,
      branchComparison: false,
      customerHistory: true,
      feedback: true,
      staffAssignment: true,
      deviceIntegrations: true,
      intakeForms: true,
      multiDepartment: true,
      privacySafeDisplay: true,
    },
    workflowProfile: {
      queueLifecycle: 'hybrid',
      appointmentStrategy: 'blended',
      noShowPolicy: { enabled: true, timeoutMinutes: 15, autoClose: false },
      recallPolicy: { enabled: true, maxRecalls: 2, resetCountdown: true },
      buzzPolicy: { enabled: true, escalationChannel: 'push_and_sms' },
      transferPolicy: { enabled: true, preservePriority: true },
      chainingRules: { enabled: true, allowDepartmentHandOff: true, requireCompletionNotes: true },
    },
    queuePolicy: {
      numberingFormat: 'department_sequence',
      priorityMode: 'category_weight',
      routingMode: 'department_first',
      capacityLimit: 50,
      estimatedWaitStrategy: 'historical_average',
      remoteJoin: 'limited',
      remoteJoinNotice: 'Remote waiting supported after check-in confirmation.',
    },
    experienceProfile: {
      dashboardMode: 'clinic',
      kiosk: {
        welcomeMessage: 'Check in for your visit',
        headerText: 'Patient check-in',
        themeColor: '#2563eb',
        buttonLabel: 'Start Check-In',
        mode: 'normal',
        showPriorities: true,
        showEstimatedTime: false,
        showGroupTickets: false,
        idleTimeoutSeconds: 90,
      },
      publicJoin: {
        headline: 'Your visit status',
        subheadline: 'Stay informed without sitting in a crowded waiting room.',
        requireCustomerName: true,
        namedPartyLabel: 'Patient name',
      },
      display: {
        defaultLayout: 'list',
        theme: 'light',
        showClock: true,
        showNextUp: false,
        showDepartmentBreakdown: true,
        announcementSound: false,
      },
      messagingTone: 'professional',
      supportedLanguages: ['en', 'es', 'ar', 'fr'],
      accessibility: { highContrast: true, bilingualSignage: true, speakAnnouncements: false },
      branding: { allowBusinessBranding: true, recommendedPrimaryColor: '#2563eb', allowWhiteLabel: false },
      vocabulary: templateVocabulary({
        officeLabel: 'Location',
        departmentLabel: 'Department',
        serviceLabel: 'Visit Type',
        deskLabel: 'Station',
        customerLabel: 'Patient',
        bookingLabel: 'Visit',
        queueLabel: 'Check-In Queue',
      }),
    },
    rolePolicy: rolePolicy(['handoff', 'intake_review']),
    starterPriorities: [
      { name: 'Urgent', icon: '⚡', color: '#dc2626', weight: 30 },
      { name: 'Accessible', icon: '♿', color: '#0284c7', weight: 20 },
    ],
    starterOffices: [
      starterOffice(
        'community_clinic',
        'Main Clinic',
        [
          {
            name: 'Reception',
            code: 'R',
            sortOrder: 1,
            services: [
              { name: 'General Check-In', code: 'CHECKIN', estimatedServiceTime: 5, sortOrder: 1 },
              { name: 'Insurance Verification', code: 'INSURANCE', estimatedServiceTime: 6, sortOrder: 2 },
            ],
          },
          {
            name: 'Triage',
            code: 'T',
            sortOrder: 2,
            services: [
              { name: 'Vitals & Nurse Intake', code: 'TRIAGE', estimatedServiceTime: 8, sortOrder: 1 },
            ],
          },
          {
            name: 'Consultation',
            code: 'C',
            sortOrder: 3,
            services: [
              { name: 'Walk-In Consultation', code: 'CONSULT', estimatedServiceTime: 15, sortOrder: 1 },
              { name: 'Follow-Up Visit', code: 'FOLLOWUP', estimatedServiceTime: 12, sortOrder: 2 },
            ],
          },
        ],
        {
          operatingHours: CLINIC_HOURS,
          desks: [
            starterDesk('checkin-a', 'R', ['CHECKIN', 'INSURANCE'], 'Check-In A'),
            starterDesk('checkin-b', 'R', ['CHECKIN'], 'Check-In B'),
            starterDesk('triage-room-1', 'T', ['TRIAGE'], 'Triage Room 1'),
            starterDesk('exam-room-1', 'C', ['CONSULT', 'FOLLOWUP'], 'Exam Room 1'),
            starterDesk('exam-room-2', 'C', ['CONSULT', 'FOLLOWUP'], 'Exam Room 2'),
          ],
          displayScreens: [
            starterDisplay('Reception Board', 'list', {
              theme: 'light',
              show_next_up: false,
              privacy_mode: 'first_name_initial',
            }),
          ],
          officeSettings: {
            platform_service_areas: [
              { id: 'check-in', label: 'Check-In Zone', type: 'front_desk' },
              { id: 'triage', label: 'Triage Zone', type: 'clinical_intake' },
              { id: 'exam', label: 'Exam Rooms', type: 'care_zone' },
            ],
            platform_room_map: [
              { id: 'triage-1', label: 'Triage Room 1', departmentCode: 'T' },
              { id: 'exam-1', label: 'Exam Room 1', departmentCode: 'C' },
              { id: 'exam-2', label: 'Exam Room 2', departmentCode: 'C' },
            ],
            platform_privacy_defaults: {
              hideFullNamesOnDisplays: true,
              requireCheckInConsent: true,
            },
          },
        }
      ),
    ],
    intakeSchemas: [
      {
        serviceCode: 'CHECKIN',
        title: 'Patient intake',
        fields: [
          { key: 'patient_name', label: 'Patient name', type: 'text', required: true, visibility: 'public' },
          { key: 'phone', label: 'Mobile number', type: 'phone', required: false, visibility: 'public' },
          { key: 'symptoms', label: 'Visit reason', type: 'textarea', required: true, visibility: 'staff_only' },
        ],
        complianceNotes: ['Review data retention policy for health-related fields.'],
      },
    ],
  },
  {
    id: 'restaurant-waitlist',
    title: 'Restaurant Waitlist',
    vertical: 'restaurant',
    version: versionMetadata('1.2.0', ['1.1.0', '1.0.0'], 'Host-stand waitlist with reservation-ready defaults and staff-controlled seating decisions.', [
      {
        fromVersion: '1.1.0',
        toVersion: '1.2.0',
        releasedAt: '2026-03-16',
        summary: 'Adds staff-controlled seating preferences, reservation-ready intake, and clearer host workflow defaults.',
        officeRolloutRecommended: false,
        changes: [
          migrationChange(
            'restaurant-reservations',
            'workflow_profile',
            'review_required',
            'Reservations can share the host flow',
            'The restaurant template now assumes reservations and walk-ins can be managed from one host queue.',
            'Review whether your host stand wants reservation arrival handled in the same screen as walk-ins.'
          ),
          migrationChange(
            'restaurant-intake',
            'experience_profile',
            'safe',
            'Guests provide party details instead of choosing tables',
            'The public flow now emphasizes party size and seating preference rather than table-like options.'
          ),
          migrationChange(
            'restaurant-host-controls',
            'queue_policy',
            'safe',
            'Richer host workflow metadata',
            'Starter offices now include seating zones, table presets, hold windows, and manual host assignment defaults.'
          ),
        ],
      },
    ]),
    dashboardMode: 'light_service',
    defaultNavigation: ['/admin/overview', '/admin/onboarding', '/admin/offices', '/admin/services', '/admin/desks', '/admin/staff', '/admin/bookings', '/admin/analytics', '/admin/customers', '/admin/settings', '/desk'],
    enabledModules: ['appointments', 'virtual_join', 'customer_history', 'feedback', 'staff_assignment'],
    onboardingCopy: {
      headline: 'Set up a host stand and waitlist',
      description: 'Guests join by party size and seating preference while hosts stay in control of actual table assignment.',
      reviewChecklist: ['Review seating areas', 'Confirm host stands', 'Check reservation arrival flow', 'Tune hold and quote timing'],
    },
    recommendedRoles: [...ADMIN_LIKE_ROLES, STAFF_ROLES.RECEPTIONIST, STAFF_ROLES.DESK_OPERATOR, STAFF_ROLES.FLOOR_MANAGER],
    defaultSlas: [
      { metric: 'seat_wait', label: 'Average seating wait under', targetMinutes: 20 },
      { metric: 'reservation_hold', label: 'Hold reservation arrivals for', targetMinutes: 10 },
    ],
    capabilityFlags: {
      appointments: true,
      virtualJoin: true,
      kiosk: true,
      displayBoard: false,
      branchComparison: false,
      customerHistory: true,
      feedback: true,
      staffAssignment: true,
      deviceIntegrations: true,
      intakeForms: true,
      multiDepartment: false,
      privacySafeDisplay: false,
    },
    workflowProfile: {
      queueLifecycle: 'waitlist',
      appointmentStrategy: 'blended',
      noShowPolicy: { enabled: true, timeoutMinutes: 8, autoClose: true },
      recallPolicy: { enabled: true, maxRecalls: 2, resetCountdown: true },
      buzzPolicy: { enabled: true, escalationChannel: 'push_and_sms' },
      transferPolicy: { enabled: true, preservePriority: false },
      chainingRules: { enabled: false, allowDepartmentHandOff: false, requireCompletionNotes: false },
    },
    queuePolicy: {
      numberingFormat: 'named_waitlist',
      priorityMode: 'none',
      routingMode: 'staff_preference',
      capacityLimit: 50,
      estimatedWaitStrategy: 'manual',
      remoteJoin: 'enabled',
      remoteJoinNotice: 'Join remotely and we will ping you when your table is nearly ready.',
    },
    experienceProfile: {
      dashboardMode: 'light_service',
      kiosk: {
        welcomeMessage: 'Join the waitlist or check in a reservation',
        headerText: 'Host stand check-in',
        themeColor: '#dc2626',
        buttonLabel: 'Join Waitlist',
        mode: 'normal',
        showPriorities: false,
        showEstimatedTime: true,
        showGroupTickets: false,
        idleTimeoutSeconds: 60,
      },
      publicJoin: {
        headline: 'Your table is almost ready',
        subheadline: 'Join the waitlist, check in a reservation, and come back when the host stand is ready for your party.',
        requireCustomerName: true,
        namedPartyLabel: 'Party name',
      },
      display: {
        defaultLayout: 'list',
        theme: 'light',
        showClock: true,
        showNextUp: true,
        showDepartmentBreakdown: false,
        announcementSound: false,
      },
      messagingTone: 'friendly',
      supportedLanguages: ['en', 'es'],
      accessibility: { highContrast: false, bilingualSignage: false, speakAnnouncements: false },
      branding: { allowBusinessBranding: true, recommendedPrimaryColor: '#dc2626', allowWhiteLabel: false },
      vocabulary: templateVocabulary({
        officeLabel: 'Restaurant',
        departmentLabel: 'Seating Area',
        serviceLabel: 'Party Size',
        deskLabel: 'Host Stand',
        customerLabel: 'Party',
        bookingLabel: 'Reservation',
        queueLabel: 'Waitlist',
      }),
    },
    rolePolicy: rolePolicy(['guest_reassignment', 'table_assignment']),
    starterPriorities: [],
    starterOffices: [
      starterOffice(
        'restaurant_floor',
        'Main Restaurant',
        [
          {
            name: 'Host Queue',
            code: 'H',
            sortOrder: 1,
            services: [
              { name: 'Party of 1-2', code: 'P2', estimatedServiceTime: 12, sortOrder: 1 },
              { name: 'Party of 3-4', code: 'P4', estimatedServiceTime: 18, sortOrder: 2 },
              { name: 'Party of 5-6', code: 'P6', estimatedServiceTime: 24, sortOrder: 3 },
              { name: 'Party of 7+', code: 'P7', estimatedServiceTime: 30, sortOrder: 4 },
              { name: 'Reservation Arrival', code: 'RSVP', estimatedServiceTime: 6, sortOrder: 5 },
            ],
          },
        ],
        {
          operatingHours: HOSPITALITY_HOURS,
          desks: [
            starterDesk('host-stand', 'H', ['P2', 'P4', 'P6', 'P7', 'RSVP'], 'Main Host Stand'),
            starterDesk('patio-host', 'H', ['P2', 'P4', 'RSVP'], 'Patio Host Stand'),
            starterDesk('bar-lead', 'H', ['P2', 'P4'], 'Bar Lead'),
          ],
          officeSettings: {
            platform_service_areas: [
              { id: 'main-floor', label: 'Main Dining Floor', type: 'floor_zone' },
              { id: 'patio', label: 'Patio', type: 'floor_zone' },
              { id: 'bar', label: 'Bar Seating', type: 'floor_zone' },
              { id: 'private', label: 'Private Room', type: 'floor_zone' },
            ],
            platform_seating_preferences: [
              { id: 'first-available', label: 'First available', public: true },
              { id: 'indoor', label: 'Indoor', public: true },
              { id: 'outdoor', label: 'Outdoor', public: true },
              { id: 'bar', label: 'Bar', public: true },
            ],
            platform_table_presets: [
              { code: 'T1', label: 'Table 1', zone: 'main-floor', capacity: 2, minPartySize: 1, maxPartySize: 2, reservable: true },
              { code: 'T2', label: 'Table 2', zone: 'main-floor', capacity: 4, minPartySize: 2, maxPartySize: 4, reservable: true },
              { code: 'T3', label: 'Table 3', zone: 'main-floor', capacity: 4, minPartySize: 2, maxPartySize: 4, mergeGroup: 'B', reservable: true },
              { code: 'T4', label: 'Table 4', zone: 'main-floor', capacity: 6, minPartySize: 4, maxPartySize: 6, mergeGroup: 'B', reservable: true },
              { code: 'P1', label: 'Patio 1', zone: 'patio', capacity: 4, minPartySize: 2, maxPartySize: 4, reservable: true },
              { code: 'B1', label: 'Bar 1', zone: 'bar', capacity: 2, minPartySize: 1, maxPartySize: 2, reservable: false },
              { code: 'PR1', label: 'Private 1', zone: 'private', capacity: 8, minPartySize: 6, maxPartySize: 10, reservable: true },
            ],
            platform_host_workflow: {
              manualTableAssignment: true,
              allowReservationCheckIn: true,
              showSeatingPreferenceToGuests: true,
              pagerEnabled: true,
              holdTableMinutes: 10,
              autoReturnReminderMinutes: 5,
              quoteWaitByPartySize: true,
              quoteWaitByZone: true,
            },
          },
        }
      ),
    ],
    intakeSchemas: [
      restaurantIntakeSchema('P2'),
      restaurantIntakeSchema('P4'),
      restaurantIntakeSchema('P6'),
      restaurantIntakeSchema('P7'),
      restaurantIntakeSchema('RSVP', true),
    ],
  },
  {
    id: 'barbershop',
    title: 'Barbershop / Salon',
    vertical: 'barbershop',
    version: versionMetadata('1.1.0', ['1.0.0'], 'Named-client waitlist with stronger staff-preference defaults.', [
      {
        fromVersion: '1.0.0',
        toVersion: '1.1.0',
        releasedAt: '2026-03-15',
        summary: 'Improves small-shop throughput and client communication defaults.',
        officeRolloutRecommended: false,
        changes: [
          migrationChange(
            'barbershop-capacity',
            'queue_policy',
            'safe',
            'Higher waitlist capacity',
            'Capacity increases from 35 to 40 clients.'
          ),
          migrationChange(
            'barbershop-remote-join-copy',
            'queue_policy',
            'review_required',
            'Updated remote join messaging',
            'Remote join notice is rewritten to encourage clients to return closer to chair availability.',
            'Review the copy if the shop prefers a more casual tone.'
          ),
        ],
      },
    ]),
    dashboardMode: 'light_service',
    defaultNavigation: ['/admin/overview', '/admin/onboarding', '/admin/offices', '/admin/services', '/admin/staff', '/admin/analytics', '/admin/customers', '/admin/bookings', '/admin/settings', '/desk'],
    enabledModules: ['virtual_join', 'customer_history', 'feedback', 'staff_assignment'],
    onboardingCopy: {
      headline: 'Launch a client-first waitlist',
      description: 'Keep the flow simple while supporting preferred barber or stylist routing.',
      reviewChecklist: ['Assign barbers to desks', 'Review named client copy', 'Tune manual wait estimates'],
    },
    recommendedRoles: [...ADMIN_LIKE_ROLES, STAFF_ROLES.RECEPTIONIST, STAFF_ROLES.DESK_OPERATOR],
    defaultSlas: [{ metric: 'client_wait', label: 'Average client wait under', targetMinutes: 15 }],
    capabilityFlags: {
      appointments: true,
      virtualJoin: true,
      kiosk: false,
      displayBoard: false,
      branchComparison: false,
      customerHistory: true,
      feedback: true,
      staffAssignment: true,
      deviceIntegrations: true,
      intakeForms: false,
      multiDepartment: false,
      privacySafeDisplay: false,
    },
    workflowProfile: {
      queueLifecycle: 'waitlist',
      appointmentStrategy: 'blended',
      noShowPolicy: { enabled: true, timeoutMinutes: 5, autoClose: true },
      recallPolicy: { enabled: true, maxRecalls: 2, resetCountdown: true },
      buzzPolicy: { enabled: true, escalationChannel: 'push_and_sms' },
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
      remoteJoinNotice: 'Track your turn and head back when your barber or stylist is almost ready.',
    },
    experienceProfile: {
      dashboardMode: 'light_service',
      kiosk: {
        welcomeMessage: 'Join the shop waitlist',
        headerText: 'Welcome',
        themeColor: '#7c3aed',
        buttonLabel: 'Join Waitlist',
        mode: 'normal',
        showPriorities: false,
        showEstimatedTime: true,
        showGroupTickets: false,
        idleTimeoutSeconds: 45,
      },
      publicJoin: {
        headline: 'Your chair is almost ready',
        subheadline: 'Track your turn and head back when your barber is ready.',
        requireCustomerName: true,
        namedPartyLabel: 'Client name',
      },
      display: {
        defaultLayout: 'list',
        theme: 'light',
        showClock: true,
        showNextUp: true,
        showDepartmentBreakdown: false,
        announcementSound: false,
      },
      messagingTone: 'friendly',
      supportedLanguages: ['en', 'es'],
      accessibility: { highContrast: false, bilingualSignage: false, speakAnnouncements: false },
      branding: { allowBusinessBranding: true, recommendedPrimaryColor: '#7c3aed', allowWhiteLabel: false },
      vocabulary: templateVocabulary({
        officeLabel: 'Shop',
        departmentLabel: 'Queue',
        serviceLabel: 'Service',
        deskLabel: 'Chair',
        customerLabel: 'Client',
        bookingLabel: 'Booking',
        queueLabel: 'Waitlist',
      }),
    },
    rolePolicy: rolePolicy(['staff_preference']),
    starterPriorities: [],
    starterOffices: [
      starterOffice(
        'salon_shop',
        'Main Shop',
        [
          {
            name: 'Chair Queue',
            code: 'C',
            sortOrder: 1,
            services: [
              { name: 'Haircut', code: 'CUT', estimatedServiceTime: 25, sortOrder: 1 },
              { name: 'Beard Trim', code: 'BEARD', estimatedServiceTime: 15, sortOrder: 2 },
              { name: 'Kids Cut', code: 'KIDS', estimatedServiceTime: 20, sortOrder: 3 },
              { name: 'Color Touch-Up', code: 'COLOR', estimatedServiceTime: 35, sortOrder: 4 },
            ],
          },
        ],
        {
          operatingHours: SHOP_HOURS,
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
            platform_staff_preferences: {
              allowPreferredStaff: true,
              showReturnSoonMessaging: true,
            },
          },
        }
      ),
    ],
    intakeSchemas: [],
  },
];

export function getIndustryTemplateById(templateId: string | null | undefined) {
  return industryTemplates.find((template) => template.id === templateId) ?? industryTemplates[0];
}

export function getTemplateOptions() {
  return industryTemplates.map((template) => ({
    id: template.id,
    title: template.title,
    vertical: template.vertical,
    dashboardMode: template.dashboardMode,
    enabledModules: template.enabledModules,
    onboardingCopy: template.onboardingCopy,
    recommendedRoles: template.recommendedRoles,
    branchTypes: template.starterOffices.map((office) => office.branchType),
  }));
}
