'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Building2,
  Users,
  CreditCard,
  Globe,
  Cog,
  ArrowLeft,
  Shield,
} from 'lucide-react';

const nav = [
  { href: '/platform-admin', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/platform-admin/organizations', label: 'Organizations', icon: Building2 },
  { href: '/platform-admin/users', label: 'Users & Signups', icon: Users },
  { href: '/platform-admin/billing', label: 'Billing & Stripe', icon: CreditCard },
  { href: '/platform-admin/website', label: 'Website Config', icon: Globe },
  { href: '/platform-admin/settings', label: 'Platform Settings', icon: Cog },
];

export function PlatformSidebar({ email }: { email: string }) {
  const pathname = usePathname();

  return (
    <aside className="flex w-64 flex-col border-r border-gray-200 bg-white">
      <div className="flex h-16 items-center gap-2 border-b border-gray-200 px-6">
        <Shield className="h-5 w-5 text-gray-900" />
        <span className="text-lg font-bold text-gray-900">Super Admin</span>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {nav.map((item) => {
          const isActive = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-gray-200 p-4 space-y-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Super Admin</p>
          <p className="mt-0.5 text-sm text-gray-700 truncate">{email}</p>
        </div>
        <Link
          href="/admin/offices"
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>
      </div>
    </aside>
  );
}
