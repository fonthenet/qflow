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
  CreditCard,
  Key,
  Webhook,
  Shield,
  CalendarCheck,
  CalendarClock,
  LayoutGrid,
  HeartPulse,
  ClipboardList,
  DoorOpen,
  BellRing,
  FileCheck,
  Crown,
  Award,
  History,
  type LucideIcon,
} from 'lucide-react';
import { logout } from '@/lib/actions/auth-actions';
import { buildSidebarNav } from '@/lib/industry-nav';

const iconMap: Record<string, LucideIcon> = {
  Building2, Layers, Cog, Users, BarChart3, Monitor,
  Grid3X3, Star, QrCode, Contact, Tablet, Tv,
  CreditCard, Key, Webhook, TicketCheck,
  CalendarCheck, CalendarClock, LayoutGrid, HeartPulse,
  ClipboardList, DoorOpen, BellRing, FileCheck, Crown, Award, History,
};

interface SidebarProps {
  staff: {
    id: string;
    full_name: string;
    role: string;
    organization: {
      name: string;
      settings?: Record<string, unknown> | null;
      business_type?: string | null;
    };
  };
  isPlatformAdmin?: boolean;
}

const staffNav = [
  { href: '/admin/queue', label: 'Queue', icon: TicketCheck },
];

export function Sidebar({ staff, isPlatformAdmin }: SidebarProps) {
  const pathname = usePathname();
  const isAdmin = staff.role === 'admin' || staff.role === 'manager';

  // Build dynamic nav based on business type and terminology
  const orgSettings = (staff.organization?.settings as Record<string, unknown>) || null;
  const dynamicNav = buildSidebarNav(orgSettings);

  // Group nav items by section
  const sections = isAdmin
    ? dynamicNav.reduce(
        (acc, item) => {
          if (!acc[item.section]) acc[item.section] = [];
          acc[item.section].push(item);
          return acc;
        },
        {} as Record<string, typeof dynamicNav>
      )
    : {};

  return (
    <aside className="flex w-64 flex-col border-r border-border bg-card">
      {/* Logo */}
      <div className="flex h-16 items-center border-b border-border px-6">
        <Link href="/admin/queue" className="text-xl font-bold">
          Queue<span className="text-primary">Flow</span>
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
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {isAdmin && (
          <>
            {Object.entries(sections).map(([section, items]) => (
              <div key={section} className="mb-4">
                <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                  {section}
                </p>
                <div className="space-y-0.5">
                  {items.map((item) => {
                    const Icon = iconMap[item.iconName] || Building2;
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
                        <Icon className="h-4 w-4" />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* OPERATIONS section is now part of dynamic nav via buildSidebarNav() */}
          </>
        )}

        {!isAdmin &&
          staffNav.map((item) => {
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
                {item.label}
              </Link>
            );
          })}
      </nav>

      {/* Super Admin Link — only for platform admins */}
      {isPlatformAdmin && (
        <div className="border-t border-border px-3 py-2">
          <Link
            href="/platform-admin"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <Shield className="h-4 w-4" />
            Super Admin
          </Link>
        </div>
      )}

      {/* User */}
      <div className="border-t border-border p-4">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{staff.full_name}</p>
            <p className="text-xs text-muted-foreground capitalize">
              {staff.role.replace('_', ' ')}
            </p>
          </div>
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
    </aside>
  );
}
