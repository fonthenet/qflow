'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Award,
  BarChart3,
  BellRing,
  Building2,
  CalendarCheck,
  CalendarClock,
  ClipboardList,
  Cog,
  Contact,
  CreditCard,
  Crown,
  DoorOpen,
  FileCheck,
  Grid3X3,
  HeartPulse,
  History,
  Key,
  Layers,
  LayoutGrid,
  LogOut,
  Monitor,
  QrCode,
  Shield,
  Star,
  Tablet,
  TicketCheck,
  Tv,
  Users,
  Webhook,
  type LucideIcon,
} from 'lucide-react';
import { logout } from '@/lib/actions/auth-actions';
import { buildSidebarNav } from '@/lib/industry-nav';

const iconMap: Record<string, LucideIcon> = {
  Award,
  BarChart3,
  BellRing,
  Building2,
  CalendarCheck,
  CalendarClock,
  ClipboardList,
  Cog,
  Contact,
  CreditCard,
  Crown,
  DoorOpen,
  FileCheck,
  Grid3X3,
  HeartPulse,
  History,
  Key,
  Layers,
  LayoutGrid,
  Monitor,
  QrCode,
  TicketCheck,
  Tablet,
  Tv,
  Users,
  Webhook,
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

const staffNav = [{ href: '/admin/queue', label: 'Command Center', icon: TicketCheck }];

function formatBusinessType(value: string | null | undefined) {
  if (!value) return 'Service Business';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export function Sidebar({ staff, isPlatformAdmin }: SidebarProps) {
  const pathname = usePathname();
  const isAdmin = staff.role === 'admin' || staff.role === 'manager';
  const orgSettings = (staff.organization?.settings as Record<string, unknown>) || null;
  const dynamicNav = buildSidebarNav(orgSettings);
  const businessType = formatBusinessType(staff.organization?.business_type);

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
    <aside className="flex w-[18rem] flex-col border-r border-white/6 bg-[linear-gradient(180deg,#0c1423_0%,#121c2d_100%)] text-white">
      <div className="border-b border-white/8 px-6 py-5">
        <Link href="/admin/queue" className="block">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-sm font-black text-slate-950">
              QF
            </div>
            <div>
              <p className="text-lg font-bold tracking-tight">QueueFlow</p>
              <p className="text-[11px] uppercase tracking-[0.28em] text-white/38">Command Center</p>
            </div>
          </div>
        </Link>
      </div>

      <div className="border-b border-white/8 px-6 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/38">Workspace</p>
        <p className="mt-2 truncate text-sm font-semibold text-white/92">{staff.organization.name}</p>
        <p className="mt-1 text-xs text-white/46">{businessType}</p>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {isAdmin ? (
          Object.entries(sections).map(([section, items]) => (
            <div key={section} className="mb-5">
              <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.24em] text-white/34">
                {section}
              </p>
              <div className="space-y-1">
                {items.map((item) => {
                  const Icon = iconMap[item.iconName] || Building2;
                  const isActive = pathname.startsWith(item.href);

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-white text-slate-950 shadow-sm'
                          : 'text-white/62 hover:bg-white/6 hover:text-white'
                      }`}
                    >
                      <span
                        className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                          isActive ? 'bg-slate-100 text-slate-950' : 'bg-white/6 text-white/58'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="truncate">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))
        ) : (
          staffNav.map((item) => {
            const isActive = pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive ? 'bg-white text-slate-950 shadow-sm' : 'text-white/62 hover:bg-white/6 hover:text-white'
                }`}
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                    isActive ? 'bg-slate-100 text-slate-950' : 'bg-white/6 text-white/58'
                  }`}
                >
                  <item.icon className="h-4 w-4" />
                </span>
                <span>{item.label}</span>
              </Link>
            );
          })
        )}
      </nav>

      {isPlatformAdmin && (
        <div className="border-t border-white/8 px-3 py-2">
          <Link
            href="/platform-admin"
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-white/62 transition-colors hover:bg-white/6 hover:text-white"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/6 text-white/58">
              <Shield className="h-4 w-4" />
            </span>
            Super Admin
          </Link>
        </div>
      )}

      <div className="border-t border-white/8 p-4">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">{staff.full_name}</p>
            <p className="text-xs capitalize text-white/46">{staff.role.replace('_', ' ')}</p>
          </div>
          <form action={logout}>
            <button
              type="submit"
              className="rounded-xl p-2 text-white/46 transition-colors hover:bg-white/6 hover:text-white"
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
