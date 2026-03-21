'use client';

import { useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  Building2,
  Users,
  Key,
  TicketCheck,
  Monitor,
  Plus,
  Copy,
  Trash2,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertCircle,
  Search,
  Shield,
  Globe,
  ChevronDown,
  ChevronRight,
  Power,
  PowerOff,
  Eye,
  Zap,
  Crown,
} from 'lucide-react';

interface OrgStats {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
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
  status: 'active' | 'suspended' | 'revoked';
  activated_at: string | null;
  expires_at: string | null;
  notes: string | null;
  created_at: string;
}

interface PlatformStats {
  totalOrganizations: number;
  totalStaff: number;
  totalOffices: number;
  totalLicenses: number;
  activeLicenses: number;
  totalTicketsToday: number;
}

interface Props {
  organizations: OrgStats[];
  licenses: License[];
  platformStats: PlatformStats;
}

type Tab = 'overview' | 'organizations' | 'licenses';

export function PlatformDashboard({ organizations: initialOrgs, licenses: initialLicenses, platformStats }: Props) {
  const supabase = createClient();
  const [tab, setTab] = useState<Tab>('overview');
  const [organizations, setOrganizations] = useState(initialOrgs);
  const [licenses, setLicenses] = useState(initialLicenses);
  const [search, setSearch] = useState('');
  const [expandedOrg, setExpandedOrg] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState('');

  // License creation
  const [showCreateLicense, setShowCreateLicense] = useState(false);
  const [newLicenseOrg, setNewLicenseOrg] = useState('');
  const [newLicenseOrgId, setNewLicenseOrgId] = useState('');
  const [newLicenseNotes, setNewLicenseNotes] = useState('');
  const [newLicenseExpiry, setNewLicenseExpiry] = useState('');
  const [creating, setCreating] = useState(false);

  const refreshLicenses = useCallback(async () => {
    const { data } = await supabase
      .from('station_licenses')
      .select('*')
      .order('created_at', { ascending: false });
    if (data) setLicenses(data);
  }, [supabase]);

  const generateKey = () => {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase().match(/.{4}/g)!.join('-');
  };

  const createLicense = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError('');
    const key = generateKey();
    const { error } = await supabase.from('station_licenses').insert({
      license_key: key,
      organization_id: newLicenseOrgId || null,
      organization_name: newLicenseOrg || null,
      notes: newLicenseNotes || null,
      expires_at: newLicenseExpiry || null,
      status: 'active',
    });
    if (error) {
      setError(error.message);
    } else {
      setShowCreateLicense(false);
      setNewLicenseOrg('');
      setNewLicenseOrgId('');
      setNewLicenseNotes('');
      setNewLicenseExpiry('');
      refreshLicenses();
    }
    setCreating(false);
  };

  // Quick generate — instantly creates a license for the same org
  const quickGenerate = async (orgId: string | null, orgName: string | null) => {
    setError('');
    const key = generateKey();
    const { error } = await supabase.from('station_licenses').insert({
      license_key: key,
      organization_id: orgId || null,
      organization_name: orgName || null,
      status: 'active',
    } as any);
    if (error) {
      setError(error.message);
    } else {
      refreshLicenses();
    }
  };

  const toggleLicenseStatus = async (license: License) => {
    const newStatus = license.status === 'active' ? 'suspended' : 'active';
    await supabase.from('station_licenses').update({ status: newStatus }).eq('id', license.id);
    refreshLicenses();
  };

  const revokeLicense = async (id: string) => {
    if (!confirm('Revoke this license? The station will stop working.')) return;
    await supabase.from('station_licenses').update({ status: 'revoked' }).eq('id', id);
    refreshLicenses();
  };

  const unbindMachine = async (id: string) => {
    if (!confirm('Unbind from machine? It can be re-activated on a different PC.')) return;
    await supabase.from('station_licenses').update({ machine_id: null, machine_name: null, activated_at: null }).eq('id', id);
    refreshLicenses();
  };

  const deleteLicense = async (id: string) => {
    if (!confirm('Delete this license permanently?')) return;
    await supabase.from('station_licenses').delete().eq('id', id);
    refreshLicenses();
  };

  const copyKey = (key: string, id: string) => {
    navigator.clipboard.writeText(key);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredOrgs = organizations.filter(org =>
    org.name.toLowerCase().includes(search.toLowerCase()) ||
    org.slug?.toLowerCase().includes(search.toLowerCase())
  );

  const filteredLicenses = licenses.filter(l =>
    search === '' ||
    l.license_key.toLowerCase().includes(search.toLowerCase()) ||
    l.organization_name?.toLowerCase().includes(search.toLowerCase()) ||
    l.machine_name?.toLowerCase().includes(search.toLowerCase())
  );

  const statusBadge = (status: string) => {
    const styles: Record<string, string> = {
      active: 'bg-green-100 text-green-700',
      suspended: 'bg-amber-100 text-amber-700',
      revoked: 'bg-red-100 text-red-700',
      trialing: 'bg-blue-100 text-blue-700',
      past_due: 'bg-orange-100 text-orange-700',
      canceled: 'bg-gray-100 text-gray-500',
    };
    return (
      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles[status] ?? 'bg-gray-100 text-gray-600'}`}>
        {status}
      </span>
    );
  };

  const planBadge = (plan: string | null) => {
    const styles: Record<string, string> = {
      free: 'bg-gray-100 text-gray-600',
      starter: 'bg-blue-100 text-blue-700',
      growth: 'bg-purple-100 text-purple-700',
      pro: 'bg-indigo-100 text-indigo-700',
      enterprise: 'bg-amber-100 text-amber-800',
    };
    return (
      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles[plan ?? 'free'] ?? 'bg-gray-100 text-gray-600'}`}>
        {plan ?? 'free'}
      </span>
    );
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-primary to-primary/70 text-white">
              <Crown size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Platform Control Center</h1>
              <p className="text-sm text-muted-foreground">Manage all organizations, licenses, and platform settings</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-muted rounded-xl w-fit">
        {([
          { id: 'overview', label: 'Overview', icon: Globe },
          { id: 'organizations', label: 'Organizations', icon: Building2 },
          { id: 'licenses', label: 'Licenses & Devices', icon: Key },
        ] as const).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <t.icon size={16} />
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}

      {/* ─── OVERVIEW TAB ─── */}
      {tab === 'overview' && (
        <div className="space-y-6">
          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              { label: 'Organizations', value: platformStats.totalOrganizations, icon: Building2, color: 'text-blue-600 bg-blue-50' },
              { label: 'Total Staff', value: platformStats.totalStaff, icon: Users, color: 'text-purple-600 bg-purple-50' },
              { label: 'Offices', value: platformStats.totalOffices, icon: Globe, color: 'text-emerald-600 bg-emerald-50' },
              { label: 'Licenses', value: platformStats.totalLicenses, icon: Key, color: 'text-amber-600 bg-amber-50' },
              { label: 'Active Devices', value: platformStats.activeLicenses, icon: Monitor, color: 'text-cyan-600 bg-cyan-50' },
              { label: 'Tickets Today', value: platformStats.totalTicketsToday, icon: TicketCheck, color: 'text-rose-600 bg-rose-50' },
            ].map(stat => (
              <div key={stat.label} className="border border-border rounded-xl p-4 bg-background">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${stat.color}`}>
                  <stat.icon size={18} />
                </div>
                <p className="text-2xl font-bold text-foreground">{stat.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{stat.label}</p>
              </div>
            ))}
          </div>

          {/* Recent Organizations */}
          <div className="border border-border rounded-xl bg-background">
            <div className="px-5 py-4 border-b border-border">
              <h3 className="font-semibold text-foreground">All Organizations</h3>
            </div>
            <div className="divide-y divide-border">
              {organizations.slice(0, 10).map(org => (
                <div key={org.id} className="px-5 py-3 flex items-center justify-between hover:bg-muted/30 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <span className="text-sm font-bold text-primary">{org.name.charAt(0)}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{org.name}</p>
                      <p className="text-xs text-muted-foreground">{org.slug} &middot; {org.admins[0]?.email ?? 'no admin'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-sm shrink-0">
                    <span className="text-muted-foreground">{org.activeOffices} offices</span>
                    <span className="text-muted-foreground">{org.activeStaff} staff</span>
                    <span className="text-muted-foreground">{org.todayTickets} today</span>
                    {planBadge(org.plan_id)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Active Devices */}
          <div className="border border-border rounded-xl bg-background">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <h3 className="font-semibold text-foreground">Active Devices</h3>
              <span className="text-xs text-muted-foreground">{licenses.filter(l => l.machine_id).length} activated</span>
            </div>
            <div className="divide-y divide-border">
              {licenses.filter(l => l.machine_id).slice(0, 8).map(l => (
                <div key={l.id} className="px-5 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Monitor size={16} className="text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{l.machine_name ?? l.machine_id}</p>
                      <p className="text-xs text-muted-foreground">{l.organization_name ?? 'Unlinked'} &middot; {l.license_key}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {statusBadge(l.status)}
                    {l.activated_at && (
                      <span className="text-xs text-muted-foreground">since {new Date(l.activated_at).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>
              ))}
              {licenses.filter(l => l.machine_id).length === 0 && (
                <div className="px-5 py-8 text-center text-sm text-muted-foreground">No devices activated yet</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── ORGANIZATIONS TAB ─── */}
      {tab === 'organizations' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search organizations..."
                className="w-full pl-9 pr-4 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>

          <div className="space-y-3">
            {filteredOrgs.map(org => {
              const isExpanded = expandedOrg === org.id;
              const orgLicenses = licenses.filter(l => l.organization_id === org.id);
              const templateState = org.settings?.platform_template_state;
              const templateId = org.settings?.platform_template_id ?? org.settings?.platform_trial_template_id;

              return (
                <div key={org.id} className="border border-border rounded-xl bg-background overflow-hidden">
                  {/* Org Header */}
                  <button
                    onClick={() => setExpandedOrg(isExpanded ? null : org.id)}
                    className="w-full px-5 py-4 flex items-center justify-between hover:bg-muted/30 transition-colors text-left"
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center shrink-0">
                        <span className="text-base font-bold text-primary">{org.name.charAt(0)}</span>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-foreground truncate">{org.name}</h3>
                          {planBadge(org.plan_id)}
                          {org.subscription_status && statusBadge(org.subscription_status)}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {org.slug} &middot; Created {new Date(org.created_at).toLocaleDateString()}
                          {templateId && <> &middot; Template: {templateId}</>}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-6 shrink-0">
                      <div className="hidden md:flex gap-6 text-sm">
                        <div className="text-center">
                          <p className="font-semibold text-foreground">{org.activeOffices}</p>
                          <p className="text-xs text-muted-foreground">offices</p>
                        </div>
                        <div className="text-center">
                          <p className="font-semibold text-foreground">{org.activeStaff}</p>
                          <p className="text-xs text-muted-foreground">staff</p>
                        </div>
                        <div className="text-center">
                          <p className="font-semibold text-foreground">{org.activeLicenses}</p>
                          <p className="text-xs text-muted-foreground">devices</p>
                        </div>
                        <div className="text-center">
                          <p className="font-semibold text-foreground">{org.todayTickets}</p>
                          <p className="text-xs text-muted-foreground">today</p>
                        </div>
                      </div>
                      {isExpanded ? <ChevronDown size={18} className="text-muted-foreground" /> : <ChevronRight size={18} className="text-muted-foreground" />}
                    </div>
                  </button>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <div className="border-t border-border px-5 py-4 space-y-4 bg-muted/10">
                      {/* Admin contacts */}
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Administrators</h4>
                        <div className="flex flex-wrap gap-2">
                          {org.admins.length > 0 ? org.admins.map((a, i) => (
                            <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-background border border-border text-sm">
                              <Shield size={13} className="text-primary" />
                              <span className="font-medium">{a.name}</span>
                              <span className="text-muted-foreground">{a.email}</span>
                            </div>
                          )) : (
                            <span className="text-sm text-muted-foreground">No admin accounts found</span>
                          )}
                        </div>
                      </div>

                      {/* Stats row */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="rounded-lg bg-background border border-border p-3">
                          <p className="text-xs text-muted-foreground">Total Offices</p>
                          <p className="text-lg font-bold">{org.officeCount} <span className="text-sm font-normal text-green-600">({org.activeOffices} active)</span></p>
                        </div>
                        <div className="rounded-lg bg-background border border-border p-3">
                          <p className="text-xs text-muted-foreground">Total Staff</p>
                          <p className="text-lg font-bold">{org.staffCount} <span className="text-sm font-normal text-green-600">({org.activeStaff} active)</span></p>
                        </div>
                        <div className="rounded-lg bg-background border border-border p-3">
                          <p className="text-xs text-muted-foreground">Licenses</p>
                          <p className="text-lg font-bold">{org.licenseCount} <span className="text-sm font-normal text-green-600">({org.activeLicenses} active)</span></p>
                        </div>
                        <div className="rounded-lg bg-background border border-border p-3">
                          <p className="text-xs text-muted-foreground">Total Tickets</p>
                          <p className="text-lg font-bold">{org.totalTickets} <span className="text-sm font-normal text-blue-600">({org.todayTickets} today)</span></p>
                        </div>
                      </div>

                      {/* Subscription info */}
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Subscription</h4>
                        <div className="flex flex-wrap gap-4 text-sm">
                          <span>Plan: {planBadge(org.plan_id)}</span>
                          {org.subscription_status && <span>Status: {statusBadge(org.subscription_status)}</span>}
                          {org.trial_ends_at && <span>Trial ends: {new Date(org.trial_ends_at).toLocaleDateString()}</span>}
                          {org.current_period_end && <span>Period ends: {new Date(org.current_period_end).toLocaleDateString()}</span>}
                          {org.monthly_visit_count != null && <span>Monthly visits: {org.monthly_visit_count}</span>}
                        </div>
                      </div>

                      {/* Linked Licenses */}
                      {orgLicenses.length > 0 && (
                        <div>
                          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Station Licenses</h4>
                          <div className="space-y-2">
                            {orgLicenses.map(l => (
                              <div key={l.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-background border border-border">
                                <div className="flex items-center gap-3">
                                  <code className="font-mono text-sm font-bold tracking-wider">{l.license_key}</code>
                                  <button onClick={() => copyKey(l.license_key, l.id)} className="p-1 hover:bg-muted rounded transition-colors">
                                    {copiedId === l.id ? <CheckCircle size={13} className="text-green-500" /> : <Copy size={13} className="text-muted-foreground" />}
                                  </button>
                                  {statusBadge(l.status)}
                                  {l.machine_id && (
                                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                                      <Monitor size={12} /> {l.machine_name ?? l.machine_id}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1">
                                  <button onClick={() => toggleLicenseStatus(l)} className={`px-2 py-1 rounded text-xs font-medium ${l.status === 'active' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                                    {l.status === 'active' ? 'Suspend' : 'Activate'}
                                  </button>
                                  {l.machine_id && (
                                    <button onClick={() => unbindMachine(l.id)} className="px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-700">Unbind</button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── LICENSES TAB ─── */}
      {tab === 'licenses' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search licenses, machines, organizations..."
                className="w-full pl-9 pr-4 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={refreshLicenses} className="px-3 py-2 rounded-lg border border-border hover:bg-muted transition-colors" title="Refresh">
                <RefreshCw size={16} />
              </button>
              <button onClick={() => setShowCreateLicense(true)} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-2 font-medium text-sm">
                <Plus size={16} /> Generate License
              </button>
            </div>
          </div>

          {/* License stats */}
          <div className="grid grid-cols-4 gap-3">
            <div className="border border-border rounded-xl p-3 bg-background">
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-xl font-bold">{licenses.length}</p>
            </div>
            <div className="border border-border rounded-xl p-3 bg-background">
              <p className="text-xs text-muted-foreground">Active</p>
              <p className="text-xl font-bold text-green-600">{licenses.filter(l => l.status === 'active').length}</p>
            </div>
            <div className="border border-border rounded-xl p-3 bg-background">
              <p className="text-xs text-muted-foreground">Activated (bound)</p>
              <p className="text-xl font-bold text-blue-600">{licenses.filter(l => l.machine_id).length}</p>
            </div>
            <div className="border border-border rounded-xl p-3 bg-background">
              <p className="text-xs text-muted-foreground">Unactivated</p>
              <p className="text-xl font-bold text-amber-600">{licenses.filter(l => !l.machine_id).length}</p>
            </div>
          </div>

          {/* License list */}
          <div className="space-y-2">
            {filteredLicenses.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Key size={48} className="mx-auto mb-4 opacity-30" />
                <p className="font-medium">No licenses found</p>
              </div>
            ) : filteredLicenses.map(license => (
              <div key={license.id} className="border border-border rounded-xl p-4 hover:bg-muted/30 transition-colors bg-background">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-3">
                      {license.status === 'active' ? <CheckCircle size={16} className="text-green-500" /> :
                       license.status === 'suspended' ? <AlertCircle size={16} className="text-amber-500" /> :
                       <XCircle size={16} className="text-red-500" />}
                      <code className="font-mono text-lg font-bold tracking-wider text-foreground">{license.license_key}</code>
                      <button onClick={() => copyKey(license.license_key, license.id)} className="p-1 rounded hover:bg-muted transition-colors">
                        {copiedId === license.id ? <CheckCircle size={14} className="text-green-500" /> : <Copy size={14} className="text-muted-foreground" />}
                      </button>
                      {statusBadge(license.status)}
                    </div>
                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
                      {license.organization_name && <span className="font-medium text-foreground">{license.organization_name}</span>}
                      {license.machine_id ? (
                        <span className="flex items-center gap-1">
                          <Monitor size={13} />
                          {license.machine_name ?? license.machine_id}
                          {license.activated_at && <span> — activated {new Date(license.activated_at).toLocaleDateString()}</span>}
                        </span>
                      ) : (
                        <span className="text-amber-600">Not yet activated</span>
                      )}
                      {license.expires_at && (
                        <span className={new Date(license.expires_at) < new Date() ? 'text-red-500' : ''}>
                          Expires {new Date(license.expires_at).toLocaleDateString()}
                        </span>
                      )}
                      {license.notes && <span className="italic">{license.notes}</span>}
                      <span className="text-xs">Created {new Date(license.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => quickGenerate(license.organization_id, license.organization_name)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors flex items-center gap-1"
                      title={`Generate another license for ${license.organization_name ?? 'this org'}`}
                    >
                      <Plus size={13} /> Generate
                    </button>
                    <button onClick={() => toggleLicenseStatus(license)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${license.status === 'active' ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}>
                      {license.status === 'active' ? 'Suspend' : 'Activate'}
                    </button>
                    {license.machine_id && (
                      <button onClick={() => unbindMachine(license.id)} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors">Unbind</button>
                    )}
                    <button onClick={() => revokeLicense(license.id)} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-100 text-red-600 hover:bg-red-200 transition-colors">Revoke</button>
                    <button onClick={() => deleteLicense(license.id)} className="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── CREATE LICENSE MODAL ─── */}
      {showCreateLicense && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowCreateLicense(false)}>
          <div className="bg-background rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold">Generate New License</h2>
            <form onSubmit={createLicense} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Link to Organization</label>
                <select
                  value={newLicenseOrgId}
                  onChange={e => {
                    setNewLicenseOrgId(e.target.value);
                    const org = organizations.find(o => o.id === e.target.value);
                    if (org) setNewLicenseOrg(org.name);
                  }}
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="">-- No organization --</option>
                  {organizations.map(org => (
                    <option key={org.id} value={org.id}>{org.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Client Name (if unlinked)</label>
                <input
                  value={newLicenseOrg}
                  onChange={e => setNewLicenseOrg(e.target.value)}
                  placeholder="e.g. Dr. Smith Clinic"
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Expiry Date (optional)</label>
                <input
                  type="date"
                  value={newLicenseExpiry}
                  onChange={e => setNewLicenseExpiry(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <p className="text-xs text-muted-foreground mt-1">Leave empty for a permanent license</p>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Notes</label>
                <input
                  value={newLicenseNotes}
                  onChange={e => setNewLicenseNotes(e.target.value)}
                  placeholder="e.g. Reception desk PC"
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowCreateLicense(false)} className="flex-1 px-4 py-2.5 rounded-xl border border-border hover:bg-muted text-sm font-medium transition-colors">Cancel</button>
                <button type="submit" disabled={creating} className="flex-1 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-medium transition-colors disabled:opacity-50">
                  {creating ? 'Generating...' : 'Generate Key'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
