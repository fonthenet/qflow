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
  Star,
  Tablet,
  TicketCheck,
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

export function Sidebar({ staff, isPlatformAdmin }: SidebarProps) {
  const pathname = usePathname();
  const isAdmin = staff.role === 'admin' || staff.role === 'manager';
  const orgSettings = (staff.organization?.settings as Record<string, unknown>) || null;
  const dynamicNav = buildSidebarNav(orgSettings);
  const sections = isAdmin
    ? dynamicNav.reduce(
        (acc, item) => {
          if (!acc[item.section]) acc[item.section] = [];
          acc[item.section].push(item);
          return acc;
        },
        {} as Record<string, typeof dynamicNav>
      )
    : { Operations: [{ href: '/admin/queue', label: 'Command Center', iconName: 'TicketCheck', section: 'Operations' }] };

  const businessType = staff.organization.business_type?.replace(/_/g, ' ') || 'service business';

  return (
    <aside className="flex w-72 flex-col bg-[#0f2328] text-white">
      <div className="border-b border-white/10 px-6 py-6">
        <Link href="/admin/queue" className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight text-white">
          QueueFlow
        </Link>
        <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8de2d5]">Customer flow workspace</p>
        <div className="mt-3 rounded-[24px] border border-white/10 bg-white/5 p-4">
          <p className="text-sm font-semibold text-white">{staff.organization.name}</p>
          <p className="mt-1 text-sm leading-6 text-white/60 capitalize">{businessType}</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-4 py-5">
        {Object.entries(sections).map(([section, items]) => (
          <div key={section} className="mb-6">
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/35">{section}</p>
            <div className="space-y-1.5">
              {items.map((item) => {
                const Icon = iconMap[item.iconName] || Building2;
                const isActive = item.href === '/admin/queue' ? pathname === item.href : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 rounded-[18px] px-3 py-2.5 text-sm font-medium transition ${
                      isActive ? 'bg-white text-[#10292f] shadow-sm' : 'text-white/68 hover:bg-white/7 hover:text-white'
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
      </nav>

      {isPlatformAdmin ? (
        <div className="px-4 pb-3">
          <Link
            href="/platform-admin"
            className="flex items-center gap-3 rounded-[18px] border border-white/10 bg-white/5 px-3 py-2.5 text-sm font-medium text-white/80 transition hover:bg-white/10 hover:text-white"
          >
            <Shield className="h-4 w-4" />
            Owner Console
          </Link>
        </div>
      ) : null}

      <div className="border-t border-white/10 p-4">
        <div className="flex items-center justify-between gap-3 rounded-[22px] bg-white/5 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{staff.full_name}</p>
            <p className="text-xs uppercase tracking-[0.16em] text-white/45">{staff.role.replace('_', ' ')}</p>
          </div>
          <form action={logout}>
            <button
              type="submit"
              className="rounded-full border border-white/10 p-2 text-white/60 transition hover:bg-white/10 hover:text-white"
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
