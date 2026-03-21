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
  Activity,
  Shield,
  Database,
} from 'lucide-react';
import { logout } from '@/lib/actions/auth-actions';

const navSections = [
  {
    label: 'MAIN',
    items: [
      { href: '/super-admin', label: 'Dashboard', icon: LayoutDashboard, exact: true },
      { href: '/super-admin/analytics', label: 'Analytics', icon: BarChart3 },
    ],
  },
  {
    label: 'MANAGEMENT',
    items: [
      { href: '/super-admin/organizations', label: 'Organizations', icon: Building2 },
      { href: '/super-admin/users', label: 'Users', icon: Users },
      { href: '/super-admin/licenses', label: 'Licenses & Devices', icon: Key },
    ],
  },
  {
    label: 'SYSTEM',
    items: [
      { href: '/super-admin/health', label: 'System Health', icon: Activity },
      { href: '/super-admin/settings', label: 'Settings', icon: Cog },
    ],
  },
];

export function SuperAdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-[260px] flex-col bg-slate-950 text-slate-100 border-r border-slate-800/50">
      {/* Header */}
      <div className="flex h-16 items-center gap-3 border-b border-slate-800/50 px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 shadow-lg shadow-amber-500/20">
          <Crown size={16} className="text-white" />
        </div>
        <div>
          <p className="text-sm font-bold tracking-wide">
            Q<span className="text-amber-400">flo</span>
          </p>
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-medium">Platform Control</p>
        </div>
      </div>

      {/* Navigation Sections */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {navSections.map(section => (
          <div key={section.label}>
            <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-600">
              {section.label}
            </p>
            <div className="space-y-0.5">
              {section.items.map(item => {
                const isActive = item.exact
                  ? pathname === item.href
                  : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-150 ${
                      isActive
                        ? 'bg-amber-500/10 text-amber-400 shadow-sm'
                        : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                    }`}
                  >
                    <item.icon className={`h-4 w-4 ${isActive ? 'text-amber-400' : ''}`} />
                    {item.label}
                    {isActive && (
                      <div className="ml-auto w-1.5 h-1.5 rounded-full bg-amber-400" />
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Back to business dashboard */}
      <div className="border-t border-slate-800/50 px-3 py-2">
        <Link
          href="/admin/overview"
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-500 hover:bg-white/5 hover:text-slate-300 transition-colors"
        >
          <ArrowLeft size={14} />
          Business Dashboard
        </Link>
      </div>

      {/* User */}
      <div className="border-t border-slate-800/50 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center shrink-0">
              <Shield size={14} className="text-amber-400" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-300 truncate">Platform Owner</p>
              <p className="text-[10px] text-slate-600 truncate">Super Admin</p>
            </div>
          </div>
          <form action={logout}>
            <button
              type="submit"
              className="rounded-lg p-2 text-slate-600 hover:bg-white/5 hover:text-slate-400 transition-colors"
              title="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
