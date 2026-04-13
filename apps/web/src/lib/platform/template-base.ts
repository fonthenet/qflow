/**
 * Tier presets for the template composition system.
 *
 * Three tiers define sensible defaults for capability flags, workflow, queue policy,
 * experience, and roles. Vertical overlays then customize the business-specific parts.
 *
 * - light:      Simple waitlist (barbershop, restaurant). No kiosk, no display, no multi-dept.
 * - standard:   Hybrid queue + appointments (clinic, general services). Kiosk + display enabled.
 * - enterprise: Full-featured (public-service, bank). Everything enabled including branch comparison.
 */

import {
  ADMIN_LIKE_ROLES,
  STAFF_ROLES,
  type CapabilityFlags,
  type WorkflowProfile,
  type QueuePolicy,
  type ExperienceProfile,
  type RolePolicy,
  type DefaultSla,
  type StarterPriorityTemplate,
  type TemplateTier,
} from '@qflo/shared';

// ── Capability Flags ────────────────────────────────────────────────────────

const LIGHT_CAPABILITIES: CapabilityFlags = {
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
};

const STANDARD_CAPABILITIES: CapabilityFlags = {
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
};

const ENTERPRISE_CAPABILITIES: CapabilityFlags = {
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
  privacySafeDisplay: false, // enterprise verticals choose individually
};

// ── Workflow Profiles ───────────────────────────────────────────────────────

const LIGHT_WORKFLOW: WorkflowProfile = {
  queueLifecycle: 'waitlist',
  appointmentStrategy: 'blended',
  noShowPolicy: { enabled: true, timeoutMinutes: 8, autoClose: true },
  recallPolicy: { enabled: true, maxRecalls: 2, resetCountdown: true },
  buzzPolicy: { enabled: true, escalationChannel: 'push_and_sms' },
  transferPolicy: { enabled: false, preservePriority: false },
  chainingRules: { enabled: false, allowDepartmentHandOff: false, requireCompletionNotes: false },
};

const STANDARD_WORKFLOW: WorkflowProfile = {
  queueLifecycle: 'hybrid',
  appointmentStrategy: 'blended',
  noShowPolicy: { enabled: true, timeoutMinutes: 12, autoClose: true },
  recallPolicy: { enabled: true, maxRecalls: 2, resetCountdown: true },
  buzzPolicy: { enabled: true, escalationChannel: 'push_and_sms' },
  transferPolicy: { enabled: true, preservePriority: true },
  chainingRules: { enabled: false, allowDepartmentHandOff: false, requireCompletionNotes: false },
};

const ENTERPRISE_WORKFLOW: WorkflowProfile = {
  queueLifecycle: 'ticket',
  appointmentStrategy: 'blended',
  noShowPolicy: { enabled: true, timeoutMinutes: 12, autoClose: true },
  recallPolicy: { enabled: true, maxRecalls: 2, resetCountdown: true },
  buzzPolicy: { enabled: true, escalationChannel: 'push_and_sms' },
  transferPolicy: { enabled: true, preservePriority: true },
  chainingRules: { enabled: false, allowDepartmentHandOff: false, requireCompletionNotes: false },
};

// ── Queue Policies ──────────────────────────────────────────────────────────

const LIGHT_QUEUE: QueuePolicy = {
  numberingFormat: 'named_waitlist',
  priorityMode: 'none',
  routingMode: 'staff_preference',
  capacityLimit: 40,
  estimatedWaitStrategy: 'manual',
  remoteJoin: 'enabled',
  remoteJoinNotice: null,
};

const STANDARD_QUEUE: QueuePolicy = {
  numberingFormat: 'department_sequence',
  priorityMode: 'category_weight',
  routingMode: 'department_first',
  capacityLimit: 80,
  estimatedWaitStrategy: 'historical_average',
  remoteJoin: 'enabled',
  remoteJoinNotice: null,
};

const ENTERPRISE_QUEUE: QueuePolicy = {
  numberingFormat: 'department_sequence',
  priorityMode: 'category_weight',
  routingMode: 'department_first',
  capacityLimit: 140,
  estimatedWaitStrategy: 'historical_average',
  remoteJoin: 'enabled',
  remoteJoinNotice: null,
};

// ── Experience Profiles ─────────────────────────────────────────────────────

const LIGHT_EXPERIENCE: ExperienceProfile = {
  dashboardMode: 'light_service',
  kiosk: {
    welcomeMessage: 'Join the waitlist',
    headerText: 'Welcome',
    themeColor: '#7c3aed',
    buttonLabel: 'Join Waitlist',
    mode: 'normal',
    showPriorities: false,
    showEstimatedTime: true,
    showGroupTickets: false,
    idleTimeoutSeconds: 60,
  },
  publicJoin: {
    headline: 'Your turn is coming',
    subheadline: 'Track your place in line from your phone.',
    requireCustomerName: true,
    namedPartyLabel: 'Name',
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
  vocabulary: {
    officeLabel: 'Location',
    departmentLabel: 'Queue',
    serviceLabel: 'Service',
    deskLabel: 'Station',
    customerLabel: 'Customer',
    bookingLabel: 'Booking',
    queueLabel: 'Waitlist',
  },
};

const STANDARD_EXPERIENCE: ExperienceProfile = {
  dashboardMode: 'clinic',
  kiosk: {
    welcomeMessage: 'Select a service',
    headerText: 'Check in',
    themeColor: '#2563eb',
    buttonLabel: 'Check In',
    mode: 'normal',
    showPriorities: true,
    showEstimatedTime: true,
    showGroupTickets: false,
    idleTimeoutSeconds: 75,
  },
  publicJoin: {
    headline: 'Track your visit',
    subheadline: 'Stay informed without waiting in line.',
    requireCustomerName: true,
    namedPartyLabel: 'Name',
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
  supportedLanguages: ['en', 'es', 'fr', 'ar'],
  accessibility: { highContrast: true, bilingualSignage: true, speakAnnouncements: false },
  branding: { allowBusinessBranding: true, recommendedPrimaryColor: '#2563eb', allowWhiteLabel: false },
  vocabulary: {
    officeLabel: 'Location',
    departmentLabel: 'Department',
    serviceLabel: 'Service',
    deskLabel: 'Station',
    customerLabel: 'Customer',
    bookingLabel: 'Appointment',
    queueLabel: 'Queue',
  },
};

const ENTERPRISE_EXPERIENCE: ExperienceProfile = {
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
  vocabulary: {
    officeLabel: 'Branch',
    departmentLabel: 'Department',
    serviceLabel: 'Service',
    deskLabel: 'Counter',
    customerLabel: 'Customer',
    bookingLabel: 'Appointment',
    queueLabel: 'Queue',
  },
};

// ── Role Policy ─────────────────────────────────────────────────────────────

function buildRolePolicy(extraCapabilities: string[] = []): RolePolicy {
  return {
    roles: [
      {
        role: STAFF_ROLES.ADMIN,
        label: 'Platform Admin',
        scope: 'organization',
        adminAccess: true,
        allowedNavigation: [
          '/admin/overview', '/admin/onboarding', '/admin/template-governance',
          '/admin/offices', '/admin/departments', '/admin/services', '/admin/desks',
          '/admin/staff', '/admin/priorities', '/admin/virtual-codes', '/admin/audit',
          '/admin/analytics', '/admin/customers', '/admin/calendar', '/admin/bookings',
          '/admin/kiosk', '/admin/displays', '/admin/broadcast', '/admin/settings', '/desk',
        ],
        capabilities: ['template_apply', 'governance', 'configuration'],
      },
      {
        role: STAFF_ROLES.MANAGER,
        label: 'Operations Manager',
        scope: 'organization',
        adminAccess: true,
        allowedNavigation: [
          '/admin/overview', '/admin/onboarding', '/admin/template-governance',
          '/admin/offices', '/admin/departments', '/admin/services', '/admin/desks',
          '/admin/staff', '/admin/audit', '/admin/analytics', '/admin/calendar',
          '/admin/bookings', '/admin/kiosk', '/admin/displays', '/admin/broadcast',
          '/admin/settings', '/desk',
        ],
        capabilities: ['configuration', 'analytics', ...extraCapabilities],
      },
      {
        role: STAFF_ROLES.BRANCH_ADMIN,
        label: 'Branch Admin',
        scope: 'office',
        adminAccess: true,
        allowedNavigation: [
          '/admin/overview', '/admin/offices', '/admin/departments', '/admin/services',
          '/admin/desks', '/admin/audit', '/admin/analytics', '/admin/calendar',
          '/admin/bookings', '/admin/kiosk', '/admin/displays', '/admin/broadcast', '/desk',
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
        allowedNavigation: ['/admin/audit', '/admin/analytics', '/admin/customers', '/admin/calendar', '/admin/bookings', '/desk'],
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

// ── Default Navigation ──────────────────────────────────────────────────────

const LIGHT_NAV = [
  '/admin/overview', '/admin/onboarding', '/admin/offices', '/admin/services',
  '/admin/staff', '/admin/analytics', '/admin/customers', '/admin/calendar',
  '/admin/bookings', '/admin/settings', '/desk',
];

const STANDARD_NAV = [
  '/admin/overview', '/admin/onboarding', '/admin/offices', '/admin/departments',
  '/admin/services', '/admin/staff', '/admin/priorities', '/admin/analytics',
  '/admin/calendar', '/admin/bookings', '/admin/kiosk', '/admin/settings', '/desk',
];

const ENTERPRISE_NAV = [
  '/admin/overview', '/admin/onboarding', '/admin/offices', '/admin/departments',
  '/admin/services', '/admin/desks', '/admin/priorities', '/admin/displays',
  '/admin/kiosk', '/admin/calendar', '/admin/bookings', '/admin/analytics',
  '/admin/settings', '/desk',
];

// ── Public API ──────────────────────────────────────────────────────────────

export interface TierPreset {
  capabilityFlags: CapabilityFlags;
  workflowProfile: WorkflowProfile;
  queuePolicy: QueuePolicy;
  experienceProfile: ExperienceProfile;
  rolePolicy: RolePolicy;
  defaultNavigation: string[];
  defaultSlas: DefaultSla[];
  starterPriorities: StarterPriorityTemplate[];
  recommendedRoles: string[];
  enabledModules: string[];
}

export function getTierPreset(tier: TemplateTier): TierPreset {
  switch (tier) {
    case 'light':
      return {
        capabilityFlags: LIGHT_CAPABILITIES,
        workflowProfile: LIGHT_WORKFLOW,
        queuePolicy: LIGHT_QUEUE,
        experienceProfile: LIGHT_EXPERIENCE,
        rolePolicy: buildRolePolicy(),
        defaultNavigation: LIGHT_NAV,
        defaultSlas: [{ metric: 'average_wait', label: 'Average wait under', targetMinutes: 15 }],
        starterPriorities: [],
        recommendedRoles: [...ADMIN_LIKE_ROLES, STAFF_ROLES.RECEPTIONIST, STAFF_ROLES.DESK_OPERATOR],
        enabledModules: ['virtual_join', 'customer_history', 'feedback', 'staff_assignment'],
      };
    case 'standard':
      return {
        capabilityFlags: STANDARD_CAPABILITIES,
        workflowProfile: STANDARD_WORKFLOW,
        queuePolicy: STANDARD_QUEUE,
        experienceProfile: STANDARD_EXPERIENCE,
        rolePolicy: buildRolePolicy(),
        defaultNavigation: STANDARD_NAV,
        defaultSlas: [
          { metric: 'first_call', label: 'Call customer within', targetMinutes: 15 },
          { metric: 'average_wait', label: 'Average wait under', targetMinutes: 20 },
        ],
        starterPriorities: [
          { name: 'Urgent', icon: '⚡', color: '#dc2626', weight: 30 },
          { name: 'Accessible', icon: '♿', color: '#0284c7', weight: 20 },
        ],
        recommendedRoles: [...ADMIN_LIKE_ROLES, STAFF_ROLES.RECEPTIONIST, STAFF_ROLES.DESK_OPERATOR, STAFF_ROLES.FLOOR_MANAGER],
        enabledModules: ['appointments', 'intake_forms', 'display_board', 'priority_categories'],
      };
    case 'enterprise':
      return {
        capabilityFlags: ENTERPRISE_CAPABILITIES,
        workflowProfile: ENTERPRISE_WORKFLOW,
        queuePolicy: ENTERPRISE_QUEUE,
        experienceProfile: ENTERPRISE_EXPERIENCE,
        rolePolicy: buildRolePolicy(['priority_override']),
        defaultNavigation: ENTERPRISE_NAV,
        defaultSlas: [
          { metric: 'first_call', label: 'Call customer within', targetMinutes: 20 },
          { metric: 'average_wait', label: 'Average wait under', targetMinutes: 25 },
        ],
        starterPriorities: [
          { name: 'Senior', icon: '🧓', color: '#f97316', weight: 20 },
          { name: 'Accessible', icon: '♿', color: '#0ea5e9', weight: 25 },
          { name: 'Veteran', icon: '🎖️', color: '#22c55e', weight: 15 },
        ],
        recommendedRoles: [...ADMIN_LIKE_ROLES, STAFF_ROLES.RECEPTIONIST, STAFF_ROLES.DESK_OPERATOR, STAFF_ROLES.FLOOR_MANAGER, STAFF_ROLES.ANALYST],
        enabledModules: ['kiosk', 'display_board', 'priority_categories', 'appointments', 'branch_comparison'],
      };
  }
}
