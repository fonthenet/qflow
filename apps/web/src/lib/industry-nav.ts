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
  { href: '/admin/queue', label: 'Command Center', iconName: 'TicketCheck', section: 'Operations' },

  // MANAGEMENT — core (always visible)
  { href: '/admin/offices', label: '{officePlural}', iconName: 'Building2', section: 'Workspace' },
  { href: '/admin/departments', label: '{departmentPlural}', iconName: 'Layers', section: 'Workspace' },
  { href: '/admin/services', label: 'Services', iconName: 'Grid3X3', section: 'Workspace' },
  { href: '/admin/desks', label: '{deskPlural}', iconName: 'Monitor', section: 'Workspace' },
  { href: '/admin/staff', label: 'Staff', iconName: 'Users', section: 'Workspace' },

  // MANAGEMENT — business-specific (feature-gated)
  { href: '/admin/reservations', label: 'Reservations', iconName: 'CalendarCheck', section: 'Workspace', featureFlag: 'reservations' },
  { href: '/admin/appointments', label: 'Appointments', iconName: 'CalendarClock', section: 'Workspace', featureFlag: 'appointment_booking' },
  { href: '/admin/tables', label: 'Table Management', iconName: 'LayoutGrid', section: 'Workspace', featureFlag: 'table_management' },
  { href: '/admin/triage', label: 'Triage', iconName: 'HeartPulse', section: 'Workspace', featureFlag: 'patient_triage' },
  { href: '/admin/intake-forms', label: 'Intake Forms', iconName: 'ClipboardList', section: 'Workspace', featureFlag: 'intake_forms' },
  { href: '/admin/room-assignment', label: 'Room Assignment', iconName: 'DoorOpen', section: 'Workspace', featureFlag: 'room_assignment' },
  { href: '/admin/concierge', label: 'Concierge Queue', iconName: 'BellRing', section: 'Workspace', featureFlag: 'concierge_queue' },
  { href: '/admin/document-checklist', label: 'Document Checklist', iconName: 'FileCheck', section: 'Workspace', featureFlag: 'document_checklist' },

  // ENGAGEMENT — core
  { href: '/admin/customers', label: '{customerPlural}', iconName: 'Contact', section: 'Customer Flow' },
  { href: '/admin/priorities', label: 'Priorities', iconName: 'Star', section: 'Customer Flow' },
  { href: '/admin/virtual-codes', label: 'Virtual Codes', iconName: 'QrCode', section: 'Customer Flow' },

  // ENGAGEMENT — business-specific
  { href: '/admin/vip-routing', label: 'VIP Routing', iconName: 'Crown', section: 'Customer Flow', featureFlag: 'vip_routing' },
  { href: '/admin/loyalty', label: 'Loyalty Priority', iconName: 'Award', section: 'Customer Flow', featureFlag: 'loyalty_priority' },

  // DISPLAY
  { href: '/admin/kiosk', label: 'Kiosk', iconName: 'Tablet', section: 'Experience' },
  { href: '/admin/displays', label: 'Displays', iconName: 'Tv', section: 'Experience' },

  // INSIGHTS
  { href: '/admin/analytics', label: 'Analytics', iconName: 'BarChart3', section: 'Insights' },

  // SETTINGS
  { href: '/admin/settings', label: 'Settings', iconName: 'Cog', section: 'Settings' },
  { href: '/admin/settings/billing', label: 'Billing', iconName: 'CreditCard', section: 'Settings' },
  { href: '/admin/settings/api-keys', label: 'API Keys', iconName: 'Key', section: 'Settings' },
  { href: '/admin/settings/webhooks', label: 'Webhooks', iconName: 'Webhook', section: 'Settings' },
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
