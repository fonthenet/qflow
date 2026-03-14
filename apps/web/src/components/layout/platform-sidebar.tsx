'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowLeft,
  Building2,
  Cog,
  CreditCard,
  Globe,
  LayoutDashboard,
  Shield,
  Users,
} from 'lucide-react';

const nav = [
  { href: '/platform-admin', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/platform-admin/organizations', label: 'Organizations', icon: Building2 },
  { href: '/platform-admin/users', label: 'Admin Users', icon: Users },
  { href: '/platform-admin/billing', label: 'Revenue & Billing', icon: CreditCard },
  { href: '/platform-admin/website', label: 'Templates', icon: Globe },
  { href: '/platform-admin/settings', label: 'Flags & Settings', icon: Cog },
];

export function PlatformSidebar({ email }: { email: string }) {
  const pathname = usePathname();

  return (
    <aside className="flex w-72 flex-col bg-[#0f2328] text-white">
      <div className="border-b border-white/10 px-6 py-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-[#10292f]">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8de2d5]">Owner console</p>
            <p className="mt-1 text-lg font-semibold tracking-tight text-white">QueueFlow platform</p>
          </div>
        </div>
        <div className="mt-5 rounded-[24px] border border-white/10 bg-white/5 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-white/45">Active operator</p>
          <p className="mt-2 text-sm font-medium text-white/85">{email}</p>
        </div>
      </div>

      <nav className="flex-1 px-4 py-5">
        <div className="space-y-1.5">
          {nav.map((item) => {
            const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-[18px] px-3 py-2.5 text-sm font-medium transition ${
                  isActive ? 'bg-white text-[#10292f]' : 'text-white/68 hover:bg-white/7 hover:text-white'
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="border-t border-white/10 p-4">
        <Link
          href="/admin/queue"
          className="flex items-center gap-2 rounded-[18px] border border-white/10 bg-white/5 px-3 py-2.5 text-sm font-medium text-white/80 transition hover:bg-white/10 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to command center
        </Link>
      </div>
    </aside>
  );
}
