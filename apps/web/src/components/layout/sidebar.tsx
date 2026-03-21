'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Cog,
  Users,
  BarChart3,
  LogOut,
  TicketCheck,
  Grid3X3,
  Star,
  QrCode,
  Contact,
  Tablet,
  Tv,
  ScrollText,
  CalendarDays,
  Building2,
  House,
  Map,
  Key,
  Crown,
} from 'lucide-react';
import { logout } from '@/lib/actions/auth-actions';
import { DesktopStatusBadge } from '@/components/desktop-status-badge';

interface SidebarProps {
  staff: {
    id: string;
    full_name: string;
    role: string;
    organization_id: string;
    organization: {
      name: string;
    };
  };
  allowedNavigation: string[];
  isSuperAdmin?: boolean;
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
  { href: '/admin/overview', label: 'Overview', icon: Map, section: 'Business' },
  { href: '/admin/offices', label: 'Offices & Desks', icon: Building2, section: 'Business' },
  { href: '/admin/staff', label: 'Team', icon: Users, section: 'Business' },
  { href: '/admin/services', label: 'Services', icon: Grid3X3, section: 'Business' },
  { href: '/admin/priorities', label: 'Priority Rules', icon: Star, section: 'Business' },
  { href: '/admin/customers', label: 'Customers', icon: Contact, section: 'Customers' },
  { href: '/admin/bookings', label: 'Bookings', icon: CalendarDays, section: 'Customers' },
  { href: '/admin/virtual-codes', label: 'Join Links & QR', icon: QrCode, section: 'Channels' },
  { href: '/admin/kiosk', label: 'Lobby Kiosk', icon: Tablet, section: 'Channels' },
  { href: '/admin/displays', label: 'Display Screens', icon: Tv, section: 'Channels' },
  { href: '/admin/analytics', label: 'Reports', icon: BarChart3, section: 'Insights' },
  { href: '/admin/audit', label: 'Activity Log', icon: ScrollText, section: 'Insights' },
  { href: '/admin/settings', label: 'Settings', icon: Cog, section: 'Insights' },
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
    '/admin/services': `${vocabulary.serviceLabel}s`,
    '/admin/customers': `${vocabulary.customerLabel}s`,
    '/admin/bookings': `${vocabulary.bookingLabel}s`,
    '/desk': `My ${vocabulary.deskLabel}`,
  } as Record<string, string>;
}

const sectionOrder = ['Work', 'Business', 'Customers', 'Channels', 'Insights'] as const;

export function Sidebar({
  staff,
  allowedNavigation,
  isSuperAdmin,
  templateSummary,
  templateConfigured,
}: SidebarProps) {
  const pathname = usePathname();
  const navItems = [...deskNav, ...adminNav]
    .filter((item) => item.href === '/admin/overview' ? allowedNavigation.some(n => n.startsWith('/admin/')) : allowedNavigation.includes(item.href))
    .sort((a, b) => {
      const desiredOrder = [
        '/admin/platform',
        '/desk',
        '/admin/overview',
        '/admin/offices',
        '/admin/staff',
        '/admin/services',
        '/admin/priorities',
        '/admin/customers',
        '/admin/bookings',
        '/admin/virtual-codes',
        '/admin/kiosk',
        '/admin/displays',
        '/admin/licenses',
        '/admin/analytics',
        '/admin/audit',
        '/admin/settings',
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
    <aside className="flex w-64 flex-col border-r border-border bg-card">
      {/* Logo */}
      <div className="flex h-16 items-center border-b border-border px-6">
        <Link href="/admin/overview" className="text-xl font-bold">
          Q<span className="text-primary">flo</span>
        </Link>
      </div>

      {/* Organization */}
      <div className="border-b border-border px-6 py-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Organization
        </p>
        <p className="mt-1 text-sm font-medium truncate">
          {staff.organization.name}
        </p>
        <div className="mt-3 rounded-lg bg-muted/60 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Active Template
          </p>
          <p className="mt-1 text-sm font-medium text-foreground">{templateSummary.title}</p>
          <p className="text-xs text-muted-foreground">
            {templateSummary.dashboardMode.replace(/_/g, ' ')} · v{templateSummary.version}
          </p>
          {!templateConfigured && (
            <div className="mt-2 rounded-md bg-amber-50 px-2 py-2 text-xs font-medium text-amber-800">
              Sandbox mode: test the setup before you make it live.
            </div>
          )}
        </div>
      </div>

      {/* Super Admin Quick Link */}
      {isSuperAdmin && (
        <div className="border-b border-border px-3 py-2">
          <Link
            href="/super-admin"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium bg-gradient-to-r from-amber-50 to-orange-50 text-amber-800 border border-amber-200 hover:from-amber-100 hover:to-orange-100 transition-colors"
          >
            <Crown className="h-4 w-4" />
            Platform Control Center
          </Link>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
        {navGroups.map((group) => (
          <div key={group.section}>
            <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {group.section}
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
                    {labelOverrides[item.href] ?? item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Desktop Connection Status */}
      <div className="border-t border-border px-2 py-2">
        <DesktopStatusBadge organizationId={staff.organization_id} />
      </div>

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
              title="Home"
            >
              <House className="h-4 w-4" />
            </Link>
            <form action={logout}>
              <button
                type="submit"
                className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                title="Sign out"
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
