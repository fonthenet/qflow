import { getDefaultTerminology, type IndustryTerminology } from '@/lib/data/industry-templates';

export interface NavItem {
  href: string;
  label: string;
  iconName: string;
  section: string;
  featureFlag?: string; // only show if this flag is present
}

const allNavItems: NavItem[] = [
  // OPERATIONS — the command center (always visible, all roles)
  { href: '/admin/queue', label: 'Command Center', iconName: 'TicketCheck', section: 'COMMAND CENTER' },

  // STRUCTURE — core operating model
  { href: '/admin/offices', label: '{officePlural}', iconName: 'Building2', section: 'STRUCTURE' },
  { href: '/admin/departments', label: '{departmentPlural}', iconName: 'Layers', section: 'STRUCTURE' },
  { href: '/admin/services', label: 'Services', iconName: 'Grid3X3', section: 'STRUCTURE' },
  { href: '/admin/desks', label: '{deskPlural}', iconName: 'Monitor', section: 'STRUCTURE' },
  { href: '/admin/staff', label: 'Staff', iconName: 'Users', section: 'STRUCTURE' },

  // SERVICE RULES — business-specific behavior
  { href: '/admin/reservations', label: 'Reservations', iconName: 'CalendarCheck', section: 'SERVICE RULES', featureFlag: 'reservations' },
  { href: '/admin/appointments', label: 'Appointments', iconName: 'CalendarClock', section: 'SERVICE RULES', featureFlag: 'appointment_booking' },
  { href: '/admin/tables', label: 'Table Management', iconName: 'LayoutGrid', section: 'SERVICE RULES', featureFlag: 'table_management' },
  { href: '/admin/triage', label: 'Triage', iconName: 'HeartPulse', section: 'SERVICE RULES', featureFlag: 'patient_triage' },
  { href: '/admin/intake-forms', label: 'Intake Forms', iconName: 'ClipboardList', section: 'SERVICE RULES', featureFlag: 'intake_forms' },
  { href: '/admin/room-assignment', label: 'Room Assignment', iconName: 'DoorOpen', section: 'SERVICE RULES', featureFlag: 'room_assignment' },
  { href: '/admin/concierge', label: 'Concierge Queue', iconName: 'BellRing', section: 'SERVICE RULES', featureFlag: 'concierge_queue' },
  { href: '/admin/document-checklist', label: 'Document Checklist', iconName: 'FileCheck', section: 'SERVICE RULES', featureFlag: 'document_checklist' },

  // CUSTOMER EXPERIENCE — visitor-facing settings
  { href: '/admin/customers', label: '{customerPlural}', iconName: 'Contact', section: 'CUSTOMER EXPERIENCE' },
  { href: '/admin/priorities', label: 'Priorities', iconName: 'Star', section: 'CUSTOMER EXPERIENCE' },
  { href: '/admin/virtual-codes', label: 'Virtual Codes', iconName: 'QrCode', section: 'CUSTOMER EXPERIENCE' },

  // CUSTOMER EXPERIENCE — business-specific
  { href: '/admin/vip-routing', label: 'VIP Routing', iconName: 'Crown', section: 'CUSTOMER EXPERIENCE', featureFlag: 'vip_routing' },
  { href: '/admin/loyalty', label: 'Loyalty Priority', iconName: 'Award', section: 'CUSTOMER EXPERIENCE', featureFlag: 'loyalty_priority' },

  // SURFACES
  { href: '/admin/kiosk', label: 'Kiosk', iconName: 'Tablet', section: 'SURFACES' },
  { href: '/admin/displays', label: 'Displays', iconName: 'Tv', section: 'SURFACES' },

  // INSIGHTS
  { href: '/admin/analytics', label: 'Analytics', iconName: 'BarChart3', section: 'INSIGHTS' },

  // PLATFORM
  { href: '/admin/settings', label: 'Settings', iconName: 'Cog', section: 'PLATFORM' },
  { href: '/admin/settings/billing', label: 'Billing', iconName: 'CreditCard', section: 'PLATFORM' },
  { href: '/admin/settings/api-keys', label: 'API Keys', iconName: 'Key', section: 'PLATFORM' },
  { href: '/admin/settings/webhooks', label: 'Webhooks', iconName: 'Webhook', section: 'PLATFORM' },
];

function applyTerminology(label: string, terminology: IndustryTerminology): string {
  return label
    .replace('{officePlural}', terminology.officePlural)
    .replace('{deskPlural}', terminology.deskPlural)
    .replace('{customerPlural}', terminology.customerPlural)
    .replace('{departmentPlural}', terminology.departmentPlural);
}

export function buildSidebarNav(
  settings: Record<string, unknown> | null
): { label: string; iconName: string; href: string; section: string }[] {
  const terminology = (settings?.terminology as IndustryTerminology) || getDefaultTerminology();
  const featureFlags = (settings?.feature_flags as string[]) || [];

  return allNavItems
    .filter((item) => {
      if (!item.featureFlag) return true;
      return featureFlags.includes(item.featureFlag);
    })
    .map((item) => ({
      href: item.href,
      label: applyTerminology(item.label, terminology),
      iconName: item.iconName,
      section: item.section,
    }));
}
