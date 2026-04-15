'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Building2,
  Layers,
  Cog,
  Users,
  BarChart3,
  Monitor,
  LogOut,
  TicketCheck,
  Grid3X3,
  Star,
  QrCode,
  Contact,
  Tablet,
  Tv,
  Sparkles,
  ScrollText,
  GitBranchPlus,
  CalendarDays,
  CalendarRange,
  House,
  LayoutDashboard,
  Rocket,
  Megaphone,
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

const adminNav = [
  { href: '/admin/overview', label: 'Business Map', icon: LayoutDashboard, section: 'Work' },
  { href: '/admin/setup-wizard', label: 'Setup Wizard', icon: Rocket, section: 'Work' },
  { href: '/admin/template-governance', label: 'Template Updates', icon: GitBranchPlus, section: 'Setup' },
  { href: '/admin/offices', label: 'Locations', icon: Building2, section: 'Setup' },
  { href: '/admin/departments', label: 'Departments', icon: Layers, section: 'Setup' },
  { href: '/admin/services', label: 'Services', icon: Grid3X3, section: 'Setup' },
  { href: '/admin/desks', label: 'Desks', icon: Monitor, section: 'Setup' },
  { href: '/admin/staff', label: 'Team', icon: Users, section: 'Setup' },
  { href: '/admin/priorities', label: 'Priority Rules', icon: Star, section: 'Setup' },
  { href: '/admin/calendar', label: 'Calendar', icon: CalendarRange, section: 'Customers' },
  { href: '/admin/bookings', label: 'Bookings', icon: CalendarDays, section: 'Customers' },
  { href: '/admin/customers', label: 'Customers', icon: Contact, section: 'Customers' },
  { href: '/admin/virtual-codes', label: 'Join Links & QR', icon: QrCode, section: 'Channels' },
  { href: '/admin/kiosk', label: 'Lobby Kiosk', icon: Tablet, section: 'Channels' },
  { href: '/admin/displays', label: 'Display Screens', icon: Tv, section: 'Channels' },
  { href: '/admin/analytics', label: 'Reports', icon: BarChart3, section: 'Insights' },
  { href: '/admin/audit', label: 'Activity Log', icon: ScrollText, section: 'Insights' },
  { href: '/admin/broadcast', label: 'Broadcast', icon: Megaphone, section: 'Channels' },
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
}: SidebarProps) {
  const { t } = useI18n();
  const pathname = usePathname();
  const navItems = [...deskNav, ...adminNav]
    .filter((item) => {
      // Hide desk link during signup (before template is confirmed)
      if (item.href === '/desk' && !templateConfigured) return false;
      return allowedNavigation.includes(item.href);
    })
    .sort((a, b) => {
      const desiredOrder = [
        '/admin/overview',
        '/admin/setup-wizard',
        '/admin/template-governance',
        ...(templateSummary.defaultNavigation ?? []),
        '/admin/calendar',
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
              {t('Sandbox mode: test the setup before you make it live.')}
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
                const isActive = pathname.startsWith(item.href);
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
