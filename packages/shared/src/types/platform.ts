import type { StaffRole } from '../constants';

export type IndustryVertical =
  | 'public_service'
  | 'bank'
  | 'clinic'
  | 'restaurant'
  | 'barbershop';

export type DashboardMode =
  | 'public_service'
  | 'bank'
  | 'clinic'
  | 'light_service';

export type OperatingModel =
  | 'department_first'
  | 'service_routing'
  | 'appointments_first'
  | 'waitlist';

export type BranchType =
  | 'service_center'
  | 'branch_office'
  | 'community_clinic'
  | 'restaurant_floor'
  | 'salon_shop';

export type QueueLifecycleMode = 'ticket' | 'waitlist' | 'hybrid';
export type AppointmentStrategy = 'walk_in_only' | 'appointment_only' | 'blended';
export type PriorityMode = 'none' | 'category_weight' | 'vip_and_priority';
export type RoutingMode =
  | 'department_first'
  | 'service_first'
  | 'desk_assignment'
  | 'staff_preference';
export type EstimatedWaitStrategy =
  | 'historical_average'
  | 'service_average'
  | 'manual';
export type RemoteJoinMode = 'disabled' | 'limited' | 'enabled';
export type MessagingTone = 'institutional' | 'professional' | 'friendly';
export type TemplateSectionKey =
  | 'capability_flags'
  | 'workflow_profile'
  | 'queue_policy'
  | 'experience_profile'
  | 'role_policy';
export type TemplateChangeImpact = 'safe' | 'review_required' | 'breaking';
export type TemplateLifecycleState = 'template_trial_state' | 'template_confirmed';
export type AnalyticsEventName =
  | 'joined'
  | 'checked_in'
  | 'called'
  | 'recalled'
  | 'serving_started'
  | 'served'
  | 'no_show'
  | 'cancelled'
  | 'transferred'
  | 'buzzed'
  | 'feedback_submitted';

export interface CapabilityFlags {
  appointments: boolean;
  virtualJoin: boolean;
  kiosk: boolean;
  displayBoard: boolean;
  branchComparison: boolean;
  customerHistory: boolean;
  feedback: boolean;
  staffAssignment: boolean;
  deviceIntegrations: boolean;
  intakeForms: boolean;
  multiDepartment: boolean;
  privacySafeDisplay: boolean;
}

export interface WorkflowPolicySetting {
  enabled: boolean;
}

export interface NoShowPolicy extends WorkflowPolicySetting {
  timeoutMinutes: number;
  autoClose: boolean;
}

export interface RecallPolicy extends WorkflowPolicySetting {
  maxRecalls: number;
  resetCountdown: boolean;
}

export interface BuzzPolicy extends WorkflowPolicySetting {
  escalationChannel: 'push' | 'push_and_sms';
}

export interface TransferPolicy extends WorkflowPolicySetting {
  preservePriority: boolean;
}

export interface ChainingRules extends WorkflowPolicySetting {
  allowDepartmentHandOff: boolean;
  requireCompletionNotes: boolean;
}

export interface WorkflowProfile {
  queueLifecycle: QueueLifecycleMode;
  appointmentStrategy: AppointmentStrategy;
  noShowPolicy: NoShowPolicy;
  recallPolicy: RecallPolicy;
  buzzPolicy: BuzzPolicy;
  transferPolicy: TransferPolicy;
  chainingRules: ChainingRules;
}

export interface QueuePolicy {
  numberingFormat: 'department_sequence' | 'service_sequence' | 'named_waitlist';
  priorityMode: PriorityMode;
  routingMode: RoutingMode;
  capacityLimit: number;
  estimatedWaitStrategy: EstimatedWaitStrategy;
  remoteJoin: RemoteJoinMode;
  remoteJoinNotice: string | null;
}

export interface IntakeSchemaField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'phone' | 'email' | 'select' | 'checkbox' | 'date';
  required: boolean;
  visibility: 'public' | 'staff_only' | 'internal';
  options?: string[];
  consentFlag?: string;
}

export interface IntakeSchema {
  serviceCode: string;
  title: string;
  fields: IntakeSchemaField[];
  complianceNotes: string[];
}

export interface KioskExperienceProfile {
  welcomeMessage: string;
  headerText: string;
  themeColor: string;
  buttonLabel: string;
  mode: 'normal' | 'quick_book';
  showPriorities: boolean;
  showEstimatedTime: boolean;
  showGroupTickets: boolean;
  idleTimeoutSeconds: number;
}

export interface PublicJoinProfile {
  headline: string;
  subheadline: string;
  requireCustomerName: boolean;
  namedPartyLabel: string;
}

export interface DisplayExperienceProfile {
  defaultLayout: 'list' | 'grid' | 'department_split';
  theme: 'light' | 'dark';
  showClock: boolean;
  showNextUp: boolean;
  showDepartmentBreakdown: boolean;
  announcementSound: boolean;
}

export interface AccessibilityProfile {
  highContrast: boolean;
  bilingualSignage: boolean;
  speakAnnouncements: boolean;
}

export interface BrandingProfile {
  allowBusinessBranding: boolean;
  recommendedPrimaryColor: string;
  allowWhiteLabel: boolean;
}

export interface TemplateVocabulary {
  officeLabel: string;
  departmentLabel: string;
  serviceLabel: string;
  deskLabel: string;
  customerLabel: string;
  bookingLabel: string;
  queueLabel: string;
}

export interface ExperienceProfile {
  dashboardMode: DashboardMode;
  kiosk: KioskExperienceProfile;
  publicJoin: PublicJoinProfile;
  display: DisplayExperienceProfile;
  messagingTone: MessagingTone;
  supportedLanguages: string[];
  accessibility: AccessibilityProfile;
  branding: BrandingProfile;
  vocabulary: TemplateVocabulary;
}

export interface RoleDefinition {
  role: StaffRole;
  label: string;
  scope: 'organization' | 'office' | 'department' | 'shift';
  adminAccess: boolean;
  allowedNavigation: string[];
  capabilities: string[];
}

export interface RolePolicy {
  roles: RoleDefinition[];
}

export interface DefaultSla {
  metric: string;
  label: string;
  targetMinutes: number;
}

export interface StarterPriorityTemplate {
  name: string;
  icon: string;
  color: string;
  weight: number;
}

export interface StarterServiceTemplate {
  name: string;
  code: string;
  description?: string;
  estimatedServiceTime?: number;
  sortOrder?: number;
}

export interface StarterDepartmentTemplate {
  name: string;
  code: string;
  description?: string;
  sortOrder?: number;
  services: StarterServiceTemplate[];
}

export interface OperatingHoursPreset {
  [day: string]: {
    open: string;
    close: string;
  };
}

export interface StarterDeskTemplate {
  name: string;
  departmentCode: string;
  displayName?: string;
  serviceCodes?: string[];
  status?: 'open' | 'closed' | 'on_break';
}

export interface StarterDisplayTemplate {
  name: string;
  layout?: DisplayExperienceProfile['defaultLayout'];
  isActive?: boolean;
  settings?: Record<string, unknown>;
}

export interface TrialTemplateServiceDraft {
  code: string;
  name: string;
  enabled: boolean;
}

export interface TrialTemplateDepartmentDraft {
  code: string;
  name: string;
  enabled: boolean;
  services: TrialTemplateServiceDraft[];
}

export interface TrialTemplateDeskDraft {
  name: string;
  departmentCode: string;
  serviceCodes?: string[];
  displayName?: string;
  status?: 'open' | 'closed' | 'on_break';
  enabled: boolean;
}

export interface TrialTemplateDisplayDraft {
  name: string;
  layout?: DisplayExperienceProfile['defaultLayout'];
  enabled: boolean;
}

export interface TrialTemplateStructure {
  departments: TrialTemplateDepartmentDraft[];
  desks: TrialTemplateDeskDraft[];
  displays: TrialTemplateDisplayDraft[];
}

export interface StarterOfficeTemplate {
  branchType: BranchType;
  name: string;
  timezone: string;
  operatingHours?: OperatingHoursPreset;
  desks: StarterDeskTemplate[];
  displayScreens: StarterDisplayTemplate[];
  officeSettings: Record<string, unknown>;
  departments: StarterDepartmentTemplate[];
}

export interface TemplateVersionChange {
  id: string;
  section: TemplateSectionKey;
  impact: TemplateChangeImpact;
  title: string;
  description: string;
  recommendedAction?: string;
}

export interface TemplateMigration {
  fromVersion: string;
  toVersion: string;
  releasedAt: string;
  summary: string;
  officeRolloutRecommended: boolean;
  changes: TemplateVersionChange[];
}

export interface TemplateVersion {
  current: string;
  previous: string[];
  updatedAt: string;
  notes: string;
  migrations: TemplateMigration[];
}

export interface IndustryTemplate {
  id: string;
  title: string;
  vertical: IndustryVertical;
  version: TemplateVersion;
  dashboardMode: DashboardMode;
  defaultNavigation: string[];
  enabledModules: string[];
  onboardingCopy: {
    headline: string;
    description: string;
    reviewChecklist: string[];
  };
  recommendedRoles: StaffRole[];
  defaultSlas: DefaultSla[];
  capabilityFlags: CapabilityFlags;
  workflowProfile: WorkflowProfile;
  queuePolicy: QueuePolicy;
  experienceProfile: ExperienceProfile;
  rolePolicy: RolePolicy;
  starterPriorities: StarterPriorityTemplate[];
  starterOffices: StarterOfficeTemplate[];
  intakeSchemas: IntakeSchema[];
}

export interface PlatformTemplateSelection {
  templateId: string;
  vertical: IndustryVertical;
  version: string;
  operatingModel: OperatingModel;
  branchType: BranchType;
  appliedAt: string;
}

export interface ResolvedPlatformConfig {
  template: IndustryTemplate;
  selection: PlatformTemplateSelection;
  capabilityFlags: CapabilityFlags;
  workflowProfile: WorkflowProfile;
  queuePolicy: QueuePolicy;
  experienceProfile: ExperienceProfile;
  rolePolicy: RolePolicy;
  organizationSettings: Record<string, unknown>;
  officeSettings: Record<string, unknown>;
}
