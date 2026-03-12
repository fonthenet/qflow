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
} from 'lucide-react';
import { logout } from '@/lib/actions/auth-actions';

interface SidebarProps {
  staff: {
    id: string;
    full_name: string;
    role: string;
    organization: {
      name: string;
    };
  };
}

const adminNav = [
  { href: '/admin/offices', label: 'Offices', icon: Building2 },
  { href: '/admin/departments', label: 'Departments', icon: Layers },
  { href: '/admin/services', label: 'Services', icon: Grid3X3 },
  { href: '/admin/desks', label: 'Desks', icon: Monitor },
  { href: '/admin/staff', label: 'Staff', icon: Users },
  { href: '/admin/priorities', label: 'Priorities', icon: Star },
  { href: '/admin/virtual-codes', label: 'Virtual Codes', icon: QrCode },
  { href: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/admin/customers', label: 'Customers', icon: Contact },
  { href: '/admin/kiosk', label: 'Kiosk', icon: Tablet },
  { href: '/admin/displays', label: 'Displays', icon: Tv },
  { href: '/admin/settings', label: 'Settings', icon: Cog },
];

const deskNav = [
  { href: '/desk', label: 'My Desk', icon: TicketCheck },
];

export function Sidebar({ staff }: SidebarProps) {
  const pathname = usePathname();
  const isAdmin = staff.role === 'admin' || staff.role === 'manager';
  const navItems = isAdmin ? [...adminNav, ...deskNav] : deskNav;

  return (
    <aside className="flex w-64 flex-col border-r border-border bg-card">
      {/* Logo */}
      <div className="flex h-16 items-center border-b border-border px-6">
        <Link href="/admin/offices" className="text-xl font-bold">
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
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map((item) => {
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
