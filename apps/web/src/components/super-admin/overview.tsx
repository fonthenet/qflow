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
  ArrowUpRight,
  Zap,
  TrendingUp,
  Clock,
  Activity,
  CheckCircle,
  XCircle,
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
  ticketsThisWeek: number;
  avgTicketsPerDay: number;
  activeOrgsToday: number;
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

interface RecentActivity {
  id: string;
  type: 'org_created' | 'license_activated' | 'device_approved' | 'ticket_milestone';
  message: string;
  timestamp: string;
}

interface Props {
  stats: Stats;
  organizations: OrgSummary[];
  recentDevices: Device[];
  recentActivity: RecentActivity[];
}

const planColors: Record<string, string> = {
  free: 'text-slate-500 bg-slate-100',
  starter: 'text-blue-700 bg-blue-50',
  growth: 'text-purple-700 bg-purple-50',
  pro: 'text-indigo-700 bg-indigo-50',
  enterprise: 'text-amber-800 bg-amber-50',
};

export function SuperAdminOverview({ stats, organizations, recentDevices, recentActivity }: Props) {
  const now = new Date();
  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{greeting}</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Here&apos;s what&apos;s happening across your platform today
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-medium text-emerald-700">All systems operational</span>
          </div>
        </div>
      </div>

      {/* Pending Alert */}
      {stats.pendingDevices > 0 && (
        <Link
          href="/super-admin/licenses"
          className="flex items-center gap-3 px-5 py-3.5 rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 hover:from-amber-100 hover:to-orange-100 transition-colors group"
        >
          <div className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center">
            <AlertCircle size={16} className="text-white" />
          </div>
          <div className="flex-1">
            <span className="font-semibold text-amber-900 text-sm">
              {stats.pendingDevices} device{stats.pendingDevices > 1 ? 's' : ''} waiting for approval
            </span>
            <p className="text-xs text-amber-600 mt-0.5">Click to review and approve device activations</p>
          </div>
          <ArrowRight size={16} className="text-amber-700 group-hover:translate-x-0.5 transition-transform" />
        </Link>
      )}

      {/* Key Metrics Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Tickets Today"
          value={stats.ticketsToday}
          icon={TicketCheck}
          trend={stats.avgTicketsPerDay > 0 ? Math.round(((stats.ticketsToday - stats.avgTicketsPerDay) / stats.avgTicketsPerDay) * 100) : 0}
          color="blue"
        />
        <MetricCard
          label="Active Organizations"
          value={stats.activeOrgsToday}
          subtitle={`of ${stats.totalOrganizations} total`}
          icon={Building2}
          color="purple"
        />
        <MetricCard
          label="Licensed Devices"
          value={stats.boundDevices}
          subtitle={`${stats.activeLicenses} active licenses`}
          icon={Monitor}
          color="emerald"
        />
        <MetricCard
          label="Active Staff"
          value={stats.totalStaff}
          subtitle={`across ${stats.totalOffices} offices`}
          icon={Users}
          color="amber"
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Organizations — 2 columns */}
        <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-slate-900 text-sm">Organizations</h3>
              <p className="text-xs text-slate-500 mt-0.5">{stats.totalOrganizations} registered businesses</p>
            </div>
            <Link href="/super-admin/organizations" className="text-xs font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1 transition-colors">
              View all <ArrowUpRight size={12} />
            </Link>
          </div>
          <div className="divide-y divide-slate-50">
            {organizations.slice(0, 6).map((org, i) => (
              <div key={org.id} className="px-5 py-3 flex items-center justify-between hover:bg-slate-50/50 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-slate-100 to-slate-50 border border-slate-200 flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-slate-600">{org.name.charAt(0)}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{org.name}</p>
                    <p className="text-xs text-slate-400">{org.staffCount} staff &middot; {org.officeCount} offices</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right">
                    <p className="text-sm font-semibold text-slate-900">{org.todayTickets}</p>
                    <p className="text-[10px] text-slate-400">today</p>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${planColors[org.plan_id ?? 'free'] ?? planColors.free}`}>
                    {org.plan_id ?? 'free'}
                  </span>
                </div>
              </div>
            ))}
            {organizations.length === 0 && (
              <div className="px-5 py-12 text-center">
                <Building2 size={28} className="mx-auto mb-2 text-slate-200" />
                <p className="text-sm text-slate-400">No organizations yet</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-5">
          {/* Quick Stats */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 space-y-4">
            <h3 className="font-semibold text-slate-900 text-sm">Platform Summary</h3>
            <div className="space-y-3">
              <SummaryRow label="Total Licenses" value={stats.totalLicenses} icon={Key} />
              <SummaryRow label="Active Licenses" value={stats.activeLicenses} icon={Zap} />
              <SummaryRow label="Bound Devices" value={stats.boundDevices} icon={Monitor} />
              <SummaryRow label="Weekly Tickets" value={stats.ticketsThisWeek} icon={TrendingUp} />
              <SummaryRow label="Avg Daily" value={stats.avgTicketsPerDay} icon={Activity} />
            </div>
          </div>

          {/* Active Devices */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-semibold text-slate-900 text-sm">Active Devices</h3>
              <Link href="/super-admin/licenses" className="text-xs font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1">
                Manage <ArrowUpRight size={12} />
              </Link>
            </div>
            <div className="divide-y divide-slate-50">
              {recentDevices.slice(0, 5).map(d => (
                <div key={d.id} className="px-5 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                      d.status === 'active' ? 'bg-emerald-50' : 'bg-red-50'
                    }`}>
                      <Monitor size={13} className={d.status === 'active' ? 'text-emerald-600' : 'text-red-500'} />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-slate-900">{d.machine_name ?? d.machine_id.slice(0, 12)}</p>
                      <p className="text-[10px] text-slate-400">{d.organization_name ?? 'Unlinked'}</p>
                    </div>
                  </div>
                  <div className={`w-2 h-2 rounded-full ${d.status === 'active' ? 'bg-emerald-500' : 'bg-red-400'}`} />
                </div>
              ))}
              {recentDevices.length === 0 && (
                <div className="px-5 py-8 text-center">
                  <Monitor size={20} className="mx-auto mb-1.5 text-slate-200" />
                  <p className="text-xs text-slate-400">No active devices</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      {recentActivity.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="px-5 py-4 border-b border-slate-100">
            <h3 className="font-semibold text-slate-900 text-sm">Recent Activity</h3>
          </div>
          <div className="divide-y divide-slate-50">
            {recentActivity.map(a => (
              <div key={a.id} className="px-5 py-3 flex items-center gap-3">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                  a.type === 'org_created' ? 'bg-blue-50' :
                  a.type === 'license_activated' ? 'bg-emerald-50' :
                  a.type === 'device_approved' ? 'bg-amber-50' : 'bg-purple-50'
                }`}>
                  {a.type === 'org_created' && <Building2 size={13} className="text-blue-600" />}
                  {a.type === 'license_activated' && <Key size={13} className="text-emerald-600" />}
                  {a.type === 'device_approved' && <CheckCircle size={13} className="text-amber-600" />}
                  {a.type === 'ticket_milestone' && <TrendingUp size={13} className="text-purple-600" />}
                </div>
                <p className="text-sm text-slate-700 flex-1">{a.message}</p>
                <time className="text-[10px] text-slate-400 shrink-0">
                  {formatRelativeTime(a.timestamp)}
                </time>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  subtitle,
  icon: Icon,
  trend,
  color,
}: {
  label: string;
  value: number;
  subtitle?: string;
  icon: any;
  trend?: number;
  color: 'blue' | 'purple' | 'emerald' | 'amber';
}) {
  const colorMap = {
    blue: { bg: 'bg-blue-50', icon: 'text-blue-600', border: 'border-blue-100' },
    purple: { bg: 'bg-purple-50', icon: 'text-purple-600', border: 'border-purple-100' },
    emerald: { bg: 'bg-emerald-50', icon: 'text-emerald-600', border: 'border-emerald-100' },
    amber: { bg: 'bg-amber-50', icon: 'text-amber-600', border: 'border-amber-100' },
  };
  const c = colorMap[color];

  return (
    <div className={`rounded-xl border ${c.border} ${c.bg} p-5`}>
      <div className="flex items-center justify-between mb-3">
        <div className={`w-9 h-9 rounded-lg bg-white/60 flex items-center justify-center`}>
          <Icon size={18} className={c.icon} />
        </div>
        {trend !== undefined && trend !== 0 && (
          <span className={`text-[11px] font-semibold ${trend > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
            {trend > 0 ? '+' : ''}{trend}%
          </span>
        )}
      </div>
      <p className="text-2xl font-bold text-slate-900">{value.toLocaleString()}</p>
      <p className="text-xs text-slate-500 mt-0.5">{subtitle ?? label}</p>
    </div>
  );
}

function SummaryRow({ label, value, icon: Icon }: { label: string; value: number; icon: any }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Icon size={14} className="text-slate-400" />
        <span className="text-xs text-slate-600">{label}</span>
      </div>
      <span className="text-sm font-semibold text-slate-900">{value.toLocaleString()}</span>
    </div>
  );
}

function formatRelativeTime(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
