'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  Building2,
  Users,
  Search,
  Shield,
  Monitor,
  ChevronDown,
  ChevronRight,
  Copy,
  CheckCircle,
  Key,
  Plus,
} from 'lucide-react';

interface OrgStats {
  id: string;
  name: string;
  slug: string;
  plan_id: string | null;
  subscription_status: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  monthly_visit_count: number | null;
  settings: any;
  created_at: string;
  staffCount: number;
  activeStaff: number;
  officeCount: number;
  activeOffices: number;
  licenseCount: number;
  activeLicenses: number;
  totalTickets: number;
  todayTickets: number;
  admins: { name: string; email: string }[];
}

interface License {
  id: string;
  license_key: string;
  organization_id: string | null;
  organization_name: string | null;
  machine_id: string | null;
  machine_name: string | null;
  status: string;
}

interface Props {
  organizations: OrgStats[];
  licenses: License[];
}

const planColors: Record<string, string> = {
  free: 'text-slate-600 bg-slate-100',
  starter: 'text-blue-700 bg-blue-50',
  growth: 'text-purple-700 bg-purple-50',
  pro: 'text-indigo-700 bg-indigo-50',
  enterprise: 'text-amber-800 bg-amber-50',
};

export function OrganizationsManager({ organizations, licenses }: Props) {
  const supabase = createClient();
  const [search, setSearch] = useState('');
  const [expandedOrg, setExpandedOrg] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filtered = organizations.filter(org =>
    org.name.toLowerCase().includes(search.toLowerCase()) ||
    org.slug?.toLowerCase().includes(search.toLowerCase())
  );

  const copyKey = (key: string, id: string) => {
    navigator.clipboard.writeText(key);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const quickGenerate = async (orgId: string, orgName: string) => {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    const key = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase().match(/.{4}/g)!.join('-');
    await supabase.from('station_licenses').insert({
      license_key: key, organization_id: orgId, organization_name: orgName, status: 'active',
    } as any);
    window.location.reload();
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Organizations</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage all businesses on the platform</p>
      </div>

      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search organizations..."
          className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      <div className="space-y-3">
        {filtered.map(org => {
          const isExpanded = expandedOrg === org.id;
          const orgLicenses = licenses.filter(l => l.organization_id === org.id);
          const templateId = org.settings?.platform_template_id ?? org.settings?.platform_trial_template_id;

          return (
            <div key={org.id} className="rounded-xl border border-border bg-background overflow-hidden">
              <button
                onClick={() => setExpandedOrg(isExpanded ? null : org.id)}
                className="w-full px-5 py-4 flex items-center justify-between hover:bg-muted/30 transition-colors text-left"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-100 to-slate-50 border border-border flex items-center justify-center shrink-0">
                    <span className="text-base font-bold text-slate-600">{org.name.charAt(0)}</span>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold truncate">{org.name}</h3>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${planColors[org.plan_id ?? 'free'] ?? planColors.free}`}>
                        {org.plan_id ?? 'free'}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {org.slug} &middot; Created {new Date(org.created_at).toLocaleDateString()}
                      {templateId && <> &middot; {templateId}</>}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-6 shrink-0">
                  <div className="hidden md:flex gap-6 text-sm">
                    <div className="text-center"><p className="font-semibold">{org.activeOffices}</p><p className="text-[10px] text-muted-foreground">offices</p></div>
                    <div className="text-center"><p className="font-semibold">{org.activeStaff}</p><p className="text-[10px] text-muted-foreground">staff</p></div>
                    <div className="text-center"><p className="font-semibold">{org.activeLicenses}</p><p className="text-[10px] text-muted-foreground">devices</p></div>
                    <div className="text-center"><p className="font-semibold">{org.todayTickets}</p><p className="text-[10px] text-muted-foreground">today</p></div>
                  </div>
                  {isExpanded ? <ChevronDown size={18} className="text-muted-foreground" /> : <ChevronRight size={18} className="text-muted-foreground" />}
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-border px-5 py-5 space-y-5 bg-muted/10">
                  {/* Admins */}
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Administrators</h4>
                    <div className="flex flex-wrap gap-2">
                      {org.admins.length > 0 ? org.admins.map((a, i) => (
                        <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-background border border-border text-sm">
                          <Shield size={13} className="text-primary" />
                          <span className="font-medium">{a.name}</span>
                          <span className="text-muted-foreground">{a.email}</span>
                        </div>
                      )) : <span className="text-sm text-muted-foreground">No admins</span>}
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="rounded-lg bg-background border border-border p-3">
                      <p className="text-xs text-muted-foreground">Offices</p>
                      <p className="text-lg font-bold">{org.officeCount} <span className="text-xs font-normal text-green-600">({org.activeOffices} active)</span></p>
                    </div>
                    <div className="rounded-lg bg-background border border-border p-3">
                      <p className="text-xs text-muted-foreground">Staff</p>
                      <p className="text-lg font-bold">{org.staffCount} <span className="text-xs font-normal text-green-600">({org.activeStaff} active)</span></p>
                    </div>
                    <div className="rounded-lg bg-background border border-border p-3">
                      <p className="text-xs text-muted-foreground">Licenses</p>
                      <p className="text-lg font-bold">{org.licenseCount} <span className="text-xs font-normal text-green-600">({org.activeLicenses} active)</span></p>
                    </div>
                    <div className="rounded-lg bg-background border border-border p-3">
                      <p className="text-xs text-muted-foreground">Total Tickets</p>
                      <p className="text-lg font-bold">{org.totalTickets} <span className="text-xs font-normal text-blue-600">({org.todayTickets} today)</span></p>
                    </div>
                  </div>

                  {/* Subscription */}
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Subscription</h4>
                    <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                      <span>Plan: <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${planColors[org.plan_id ?? 'free'] ?? planColors.free}`}>{org.plan_id ?? 'free'}</span></span>
                      {org.trial_ends_at && <span>Trial ends: {new Date(org.trial_ends_at).toLocaleDateString()}</span>}
                      {org.current_period_end && <span>Period ends: {new Date(org.current_period_end).toLocaleDateString()}</span>}
                      {org.monthly_visit_count != null && <span>Monthly visits: {org.monthly_visit_count}</span>}
                    </div>
                  </div>

                  {/* Licenses */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Station Licenses</h4>
                      <button
                        onClick={() => quickGenerate(org.id, org.name)}
                        className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        <Plus size={12} /> Generate License
                      </button>
                    </div>
                    {orgLicenses.length > 0 ? (
                      <div className="space-y-2">
                        {orgLicenses.map(l => (
                          <div key={l.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-background border border-border text-sm">
                            <div className="flex items-center gap-3">
                              <code className="font-mono font-bold tracking-wider">{l.license_key}</code>
                              <button onClick={() => copyKey(l.license_key, l.id)} className="p-1 hover:bg-muted rounded">
                                {copiedId === l.id ? <CheckCircle size={13} className="text-green-500" /> : <Copy size={13} className="text-muted-foreground" />}
                              </button>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${l.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{l.status}</span>
                              {l.machine_id && (
                                <span className="text-xs text-muted-foreground flex items-center gap-1"><Monitor size={12} /> {l.machine_name ?? l.machine_id}</span>
                              )}
                              {!l.machine_id && <span className="text-xs text-amber-600">Not activated</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No licenses assigned</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
