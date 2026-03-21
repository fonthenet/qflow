'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Building2,
  Key,
  Users,
  BarChart3,
  Cog,
  LogOut,
  ArrowLeft,
  Crown,
} from 'lucide-react';
import { logout } from '@/lib/actions/auth-actions';

const nav = [
  { href: '/super-admin', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/super-admin/organizations', label: 'Organizations', icon: Building2 },
  { href: '/super-admin/licenses', label: 'Licenses & Devices', icon: Key },
  { href: '/super-admin/users', label: 'All Users', icon: Users },
  { href: '/super-admin/analytics', label: 'Platform Analytics', icon: BarChart3 },
  { href: '/super-admin/settings', label: 'Settings', icon: Cog },
];

export function SuperAdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-64 flex-col bg-slate-900 text-slate-100">
      {/* Header */}
      <div className="flex h-16 items-center gap-3 border-b border-slate-700/50 px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-500">
          <Crown size={16} className="text-white" />
        </div>
        <div>
          <p className="text-sm font-bold tracking-wide">
            Q<span className="text-amber-400">flo</span> Platform
          </p>
          <p className="text-[10px] uppercase tracking-widest text-slate-500">Control Center</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {nav.map(item => {
          const isActive = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-white/10 text-white'
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
              }`}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Back to business dashboard */}
      <div className="border-t border-slate-700/50 px-3 py-3">
        <Link
          href="/admin/overview"
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-500 hover:bg-white/5 hover:text-slate-300 transition-colors"
        >
          <ArrowLeft size={14} />
          Back to Business Dashboard
        </Link>
      </div>

      {/* User */}
      <div className="border-t border-slate-700/50 p-4">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-200 truncate">Platform Owner</p>
            <p className="text-xs text-slate-500">f.onthenet@gmail.com</p>
          </div>
          <form action={logout}>
            <button
              type="submit"
              className="rounded-lg p-2 text-slate-500 hover:bg-white/5 hover:text-slate-300 transition-colors"
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
