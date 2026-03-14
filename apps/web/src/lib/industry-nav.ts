import { getDefaultTerminology, type IndustryTerminology } from '@/lib/data/industry-templates';

export interface NavItem {
  href: string;
  label: string;
  iconName: string;
  section: string;
  featureFlag?: string; // only show if this flag is present
}

const allNavItems: NavItem[] = [
  // QUEUE MANAGEMENT
  { href: '/admin/offices', label: '{officePlural}', iconName: 'Building2', section: 'MANAGEMENT' },
  { href: '/admin/departments', label: '{departmentPlural}', iconName: 'Layers', section: 'MANAGEMENT' },
  { href: '/admin/services', label: 'Services', iconName: 'Grid3X3', section: 'MANAGEMENT' },
  { href: '/admin/desks', label: '{deskPlural}', iconName: 'Monitor', section: 'MANAGEMENT' },
  { href: '/admin/staff', label: 'Staff', iconName: 'Users', section: 'MANAGEMENT' },

  // ENGAGEMENT
  { href: '/admin/customers', label: '{customerPlural}', iconName: 'Contact', section: 'ENGAGEMENT' },
  { href: '/admin/priorities', label: 'Priorities', iconName: 'Star', section: 'ENGAGEMENT' },
  { href: '/admin/virtual-codes', label: 'Virtual Codes', iconName: 'QrCode', section: 'ENGAGEMENT' },

  // DISPLAY
  { href: '/admin/kiosk', label: 'Kiosk', iconName: 'Tablet', section: 'DISPLAY' },
  { href: '/admin/displays', label: 'Displays', iconName: 'Tv', section: 'DISPLAY' },

  // INSIGHTS
  { href: '/admin/analytics', label: 'Analytics', iconName: 'BarChart3', section: 'INSIGHTS' },

  // SETTINGS
  { href: '/admin/settings', label: 'Settings', iconName: 'Cog', section: 'SETTINGS' },
  { href: '/admin/settings/billing', label: 'Billing', iconName: 'CreditCard', section: 'SETTINGS' },
  { href: '/admin/settings/api-keys', label: 'API Keys', iconName: 'Key', section: 'SETTINGS' },
  { href: '/admin/settings/webhooks', label: 'Webhooks', iconName: 'Webhook', section: 'SETTINGS' },
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
