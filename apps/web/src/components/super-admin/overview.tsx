'use client';

import Link from 'next/link';
import {
  Building2,
  Users,
  Key,
  Monitor,
  TicketCheck,
  Globe,
  AlertCircle,
  ArrowRight,
  Zap,
} from 'lucide-react';

interface Stats {
  totalOrganizations: number;
  totalStaff: number;
  totalOffices: number;
  totalLicenses: number;
  activeLicenses: number;
  boundDevices: number;
  pendingDevices: number;
  ticketsToday: number;
}

interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  plan_id: string | null;
  created_at: string;
  staffCount: number;
  officeCount: number;
  todayTickets: number;
  totalTickets: number;
}

interface Device {
  id: string;
  machine_id: string;
  machine_name: string | null;
  organization_name: string | null;
  license_key: string;
  status: string;
  activated_at: string | null;
}

interface Props {
  stats: Stats;
  organizations: OrgSummary[];
  recentDevices: Device[];
}

const planColors: Record<string, string> = {
  free: 'text-slate-500 bg-slate-100',
  starter: 'text-blue-700 bg-blue-50',
  growth: 'text-purple-700 bg-purple-50',
  pro: 'text-indigo-700 bg-indigo-50',
  enterprise: 'text-amber-800 bg-amber-50',
};

export function SuperAdminOverview({ stats, organizations, recentDevices }: Props) {
  return (
    <div className="space-y-8 max-w-7xl">
      {/* Page Title */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Platform Overview</h1>
        <p className="text-sm text-muted-foreground mt-1">Real-time view of your entire platform</p>
      </div>

      {/* Pending Alert */}
      {stats.pendingDevices > 0 && (
        <Link
          href="/super-admin/licenses"
          className="flex items-center gap-3 px-5 py-4 rounded-xl border-2 border-amber-300 bg-amber-50 hover:bg-amber-100 transition-colors"
        >
          <div className="w-3 h-3 rounded-full bg-amber-500 animate-pulse" />
          <span className="font-semibold text-amber-900">
            {stats.pendingDevices} device{stats.pendingDevices > 1 ? 's' : ''} waiting for approval
          </span>
          <ArrowRight size={16} className="text-amber-700 ml-auto" />
        </Link>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Organizations', value: stats.totalOrganizations, icon: Building2, color: 'from-blue-500 to-blue-600', bg: 'bg-blue-50' },
          { label: 'Active Staff', value: stats.totalStaff, icon: Users, color: 'from-purple-500 to-purple-600', bg: 'bg-purple-50' },
          { label: 'Active Offices', value: stats.totalOffices, icon: Globe, color: 'from-emerald-500 to-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Tickets Today', value: stats.ticketsToday, icon: TicketCheck, color: 'from-rose-500 to-rose-600', bg: 'bg-rose-50' },
          { label: 'Total Licenses', value: stats.totalLicenses, icon: Key, color: 'from-amber-500 to-amber-600', bg: 'bg-amber-50' },
          { label: 'Active Licenses', value: stats.activeLicenses, icon: Zap, color: 'from-cyan-500 to-cyan-600', bg: 'bg-cyan-50' },
          { label: 'Bound Devices', value: stats.boundDevices, icon: Monitor, color: 'from-indigo-500 to-indigo-600', bg: 'bg-indigo-50' },
          { label: 'Pending Approval', value: stats.pendingDevices, icon: AlertCircle, color: 'from-orange-500 to-orange-600', bg: 'bg-orange-50' },
        ].map(stat => (
          <div key={stat.label} className="rounded-xl border border-border bg-background p-5">
            <div className="flex items-center justify-between mb-3">
              <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${stat.color} flex items-center justify-center`}>
                <stat.icon size={18} className="text-white" />
              </div>
            </div>
            <p className="text-3xl font-bold text-foreground">{stat.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Organizations */}
        <div className="rounded-xl border border-border bg-background">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <h3 className="font-semibold">Organizations</h3>
            <Link href="/super-admin/organizations" className="text-xs text-primary hover:underline flex items-center gap-1">
              View all <ArrowRight size={12} />
            </Link>
          </div>
          <div className="divide-y divide-border">
            {organizations.slice(0, 8).map(org => (
              <div key={org.id} className="px-5 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-slate-100 to-slate-50 border border-border flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-slate-600">{org.name.charAt(0)}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{org.name}</p>
                    <p className="text-xs text-muted-foreground">{org.staffCount} staff &middot; {org.officeCount} offices</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-sm font-medium">{org.todayTickets} <span className="text-xs text-muted-foreground">today</span></span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${planColors[org.plan_id ?? 'free'] ?? planColors.free}`}>
                    {org.plan_id ?? 'free'}
                  </span>
                </div>
              </div>
            ))}
            {organizations.length === 0 && (
              <div className="px-5 py-10 text-center text-sm text-muted-foreground">No organizations yet</div>
            )}
          </div>
        </div>

        {/* Active Devices */}
        <div className="rounded-xl border border-border bg-background">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <h3 className="font-semibold">Active Devices</h3>
            <Link href="/super-admin/licenses" className="text-xs text-primary hover:underline flex items-center gap-1">
              Manage <ArrowRight size={12} />
            </Link>
          </div>
          <div className="divide-y divide-border">
            {recentDevices.map(d => (
              <div key={d.id} className="px-5 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Monitor size={16} className="text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{d.machine_name ?? d.machine_id}</p>
                    <p className="text-xs text-muted-foreground">{d.organization_name ?? 'Unlinked'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                    d.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                  }`}>{d.status}</span>
                </div>
              </div>
            ))}
            {recentDevices.length === 0 && (
              <div className="px-5 py-10 text-center text-sm text-muted-foreground">No devices activated yet</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
