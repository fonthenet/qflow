'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Building2,
  Cog,
  BarChart3,
  LogOut,
  TicketCheck,
  QrCode,
  Contact,
  Tablet,
  CalendarDays,
  House,
  LayoutDashboard,
  Rocket,
} from 'lucide-react';
import { logout } from '@/lib/actions/auth-actions';
import { useI18n } from '@/components/providers/locale-provider';

interface SidebarProps {
  staff: {
    id: string;
    full_name: string;
    role: string;
    organization: {
      name: string;
    };
  };
  allowedNavigation: string[];
  templateConfigured: boolean;
  wizardCompleted: boolean;
  templateSummary: {
    id: string;
    title: string;
    vertical: string;
    version: string;
    dashboardMode: string;
    operatingModel: string;
    branchType: string;
    enabledModules: string[];
    recommendedRoles: string[];
    defaultNavigation?: string[];
    vocabulary?: {
      officeLabel: string;
      departmentLabel: string;
      serviceLabel: string;
      deskLabel: string;
      customerLabel: string;
      bookingLabel: string;
      queueLabel: string;
    };
  };
}

// Grouped sidebar — related routes collapse behind a single entry whose
// internal tab bar (rendered via <PageTabs>) exposes the siblings. `siblings`
// lists the routes that should also highlight this entry as active.
const adminNav: Array<{
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  section: string;
  siblings?: string[];
}> = [
  { href: '/admin/overview', label: 'Overview', icon: LayoutDashboard, section: 'Work' },
  { href: '/admin/setup-wizard', label: 'Setup Wizard', icon: Rocket, section: 'Work' },

  // Business Structure — 6 related admin pages grouped behind one entry.
  // Clicking it lands on Locations; the in-page tab bar reveals the rest.
  {
    href: '/admin/offices',
    label: 'Business Structure',
    icon: Building2,
    section: 'Setup',
    siblings: ['/admin/departments', '/admin/services', '/admin/desks', '/admin/staff', '/admin/priorities'],
  },

  { href: '/admin/bookings', label: 'Bookings', icon: CalendarDays, section: 'Customers' },
  { href: '/admin/customers', label: 'Customers', icon: Contact, section: 'Customers' },

  { href: '/admin/virtual-codes', label: 'Join Links & QR', icon: QrCode, section: 'Channels' },

  // Kiosk + Display share one entry; opens to Kiosk, tabs swap between them.
  {
    href: '/admin/kiosk',
    label: 'Public Screens',
    icon: Tablet,
    section: 'Channels',
    siblings: ['/admin/displays'],
  },

  // Reports + Activity Log merged under Insights.
  {
    href: '/admin/analytics',
    label: 'Insights',
    icon: BarChart3,
    section: 'Insights',
    siblings: ['/admin/audit'],
  },

  { href: '/admin/settings', label: 'Business Settings', icon: Cog, section: 'Insights' },
];

const deskNav = [
  { href: '/desk', label: 'My Desk', icon: TicketCheck, section: 'Work' },
];

function getLabelOverrides(templateSummary: SidebarProps['templateSummary']) {
  const vocabulary = templateSummary.vocabulary ?? {
    officeLabel: 'Office',
    departmentLabel: 'Department',
    serviceLabel: 'Service',
    deskLabel: 'Desk',
    customerLabel: 'Customer',
    bookingLabel: 'Booking',
    queueLabel: 'Queue',
  };
  return {
    '/admin/offices': vocabulary.officeLabel,
    '/admin/departments': `${vocabulary.departmentLabel}s`,
    '/admin/services': `${vocabulary.serviceLabel}s`,
    '/admin/desks': `${vocabulary.deskLabel}s`,
    '/admin/customers': `${vocabulary.customerLabel}s`,
    '/admin/bookings': `${vocabulary.bookingLabel}s`,
    '/desk': `My ${vocabulary.deskLabel}`,
  } as Record<string, string>;
}

const sectionOrder = ['Work', 'Setup', 'Customers', 'Channels', 'Insights'] as const;

export function Sidebar({
  staff,
  allowedNavigation,
  templateSummary,
  templateConfigured,
  wizardCompleted,
}: SidebarProps) {
  const { t } = useI18n();
  const pathname = usePathname();
  const navItems = [...deskNav, ...adminNav]
    // Hide desk link during signup (before template is confirmed).
    // For grouped items, keep the group visible when the role has access to
    // ANY sibling; retarget the primary href to the first allowed sibling
    // so clicking the group still lands somewhere the user can open.
    .map((item) => {
      const anyItem = item as typeof item & { siblings?: string[] };
      const siblings = anyItem.siblings ?? [];
      if (siblings.length === 0) return item;
      if (allowedNavigation.includes(item.href)) return item;
      const firstAllowedSibling = siblings.find((s) => allowedNavigation.includes(s));
      return firstAllowedSibling ? { ...item, href: firstAllowedSibling } : item;
    })
    .filter((item) => {
      if (item.href === '/desk' && !templateConfigured) return false;
      // Hide Setup Wizard once the admin has finished it — they can reach it
      // again from Overview or Settings if they want to edit structure in bulk.
      if (item.href === '/admin/setup-wizard' && wizardCompleted) return false;
      // Pre-launch focus mode: before the wizard is complete, strip the nav
      // down to the essentials so new admins aren't distracted by empty
      // modules (customers, bookings, channels, insights — all blank until
      // structure is seeded). Keep Overview (structure checklist lives there),
      // Setup Wizard (the one required path), and Business Settings (org
      // name / locale / timezone).
      if (!wizardCompleted) {
        const allowedPreLaunch = ['/admin/overview', '/admin/setup-wizard'];
        if (!allowedPreLaunch.includes(item.href)) return false;
      }
      const anyItem = item as typeof item & { siblings?: string[] };
      const allHrefs = [item.href, ...(anyItem.siblings ?? [])];
      return allHrefs.some((h) => allowedNavigation.includes(h));
    })
    .sort((a, b) => {
      const desiredOrder = [
        '/admin/overview',
        '/admin/setup-wizard',
        ...(templateSummary.defaultNavigation ?? []),
        '/admin/bookings',
        '/admin/audit',
        '/admin/analytics',
        '/admin/settings',
        '/desk',
      ];
      const ai = desiredOrder.indexOf(a.href);
      const bi = desiredOrder.indexOf(b.href);
      if (ai === -1 && bi === -1) return a.label.localeCompare(b.label);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  const labelOverrides = getLabelOverrides(templateSummary);
  const navGroups = sectionOrder
    .map((section) => ({
      section,
      items: navItems.filter((item) => item.section === section),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <aside className="flex w-64 flex-col border-r border-border bg-[var(--color-sidebar)]">
      {/* Logo */}
      <div className="flex h-16 items-center border-b border-border px-6">
        <Link href="/admin/overview" className="text-xl font-bold">
          Q<span className="text-primary">flo</span>
        </Link>
      </div>

      {/* Organization */}
      <div className="border-b border-border px-6 py-3">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('Organization')}</p>
        <p className="mt-1 text-sm font-medium truncate">
          {staff.organization.name}
        </p>
        <div className="mt-3 rounded-lg bg-muted/60 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('Active Template')}
          </p>
          <p className="mt-1 text-sm font-medium text-foreground">{templateSummary.title}</p>
          <p className="text-xs text-muted-foreground">
            {templateSummary.dashboardMode.replace(/_/g, ' ')} · v{templateSummary.version}
          </p>
          {!templateConfigured && (
            <div className="mt-2 rounded-md bg-amber-50 px-2 py-2 text-xs font-medium text-amber-800">
              {t('Finish the setup wizard to go live.')}
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
        {navGroups.map((group) => (
          <div key={group.section}>
            <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {t(group.section)}
            </p>
            <div className="space-y-1">
              {group.items.map((item) => {
                const anyItem = item as typeof item & { siblings?: string[] };
                const activePaths = [item.href, ...(anyItem.siblings ?? [])];
                const isActive = activePaths.some((p) => pathname === p || pathname.startsWith(p + '/'));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    <item.icon className="h-4 w-4" />
                    {t(labelOverrides[item.href] ?? item.label)}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User */}
      <div className="border-t border-border p-4">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{staff.full_name}</p>
            <p className="text-xs text-muted-foreground capitalize">
              {staff.role.replace('_', ' ')}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Link
              href="/"
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title={t('Home')}
            >
              <House className="h-4 w-4" />
            </Link>
            <form action={logout}>
              <button
                type="submit"
                className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                title={t('Sign out')}
              >
                <LogOut className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </aside>
  );
}
