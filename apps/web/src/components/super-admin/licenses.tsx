'use client';

import { useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  Key,
  Monitor,
  Plus,
  Copy,
  Trash2,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertCircle,
  Search,
} from 'lucide-react';

interface Org { id: string; name: string }

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

interface PendingDevice {
  id: string;
  machine_id: string;
  machine_name: string | null;
  ip_address: string | null;
  requested_at: string;
}

interface Props {
  organizations: Org[];
  licenses: License[];
  pendingDevices: PendingDevice[];
}

export function LicensesManager({ organizations, licenses: init, pendingDevices: initPending }: Props) {
  const supabase = createClient();
  const [licenses, setLicenses] = useState(init);
  const [pending, setPending] = useState(initPending);
  const [search, setSearch] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [approveOrgId, setApproveOrgId] = useState<Record<string, string>>({});

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [newOrgId, setNewOrgId] = useState('');
  const [newOrgName, setNewOrgName] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [newExpiry, setNewExpiry] = useState('');
  const [creating, setCreating] = useState(false);

  const generateKey = () => {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase().match(/.{4}/g)!.join('-');
  };

  const refresh = useCallback(async () => {
    const [{ data: l }, { data: p }] = await Promise.all([
      supabase.from('station_licenses').select('*').order('created_at', { ascending: false }),
      supabase.from('pending_device_activations').select('*').eq('status', 'pending').order('requested_at', { ascending: false }),
    ]);
    if (l) setLicenses(l);
    if (p) setPending(p);
  }, [supabase]);

  const createLicense = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError('');
    const key = generateKey();
    const org = organizations.find(o => o.id === newOrgId);
    const { error } = await supabase.from('station_licenses').insert({
      license_key: key,
      organization_id: newOrgId || null,
      organization_name: org?.name || newOrgName || null,
      notes: newNotes || null,
      expires_at: newExpiry || null,
      status: 'active',
    } as any);
    if (error) { setError(error.message); }
    else {
      setShowCreate(false); setNewOrgId(''); setNewOrgName(''); setNewNotes(''); setNewExpiry('');
      refresh();
    }
    setCreating(false);
  };

  const approveDevice = async (device: PendingDevice) => {
    const orgId = approveOrgId[device.id] || '';
    const org = organizations.find(o => o.id === orgId);
    if (!orgId) { setError('Select an organization first'); return; }
    setError('');
    const key = generateKey();
    const { error: e } = await supabase.from('station_licenses').insert({
      license_key: key, organization_id: orgId, organization_name: org?.name || null,
      machine_id: device.machine_id, machine_name: device.machine_name,
      activated_at: new Date().toISOString(), status: 'active',
    } as any);
    if (e) { setError(e.message); return; }
    await supabase.from('pending_device_activations').update({ status: 'approved' } as any).eq('id', device.id);
    refresh();
  };

  const rejectDevice = async (device: PendingDevice) => {
    await supabase.from('pending_device_activations').update({ status: 'rejected' } as any).eq('id', device.id);
    refresh();
  };

  const toggleStatus = async (l: License) => {
    const s = l.status === 'active' ? 'suspended' : 'active';
    await supabase.from('station_licenses').update({ status: s }).eq('id', l.id);
    refresh();
  };
  const unbind = async (id: string) => {
    if (!confirm('Unbind from machine?')) return;
    await supabase.from('station_licenses').update({ machine_id: null, machine_name: null, activated_at: null }).eq('id', id);
    refresh();
  };
  const revoke = async (id: string) => {
    if (!confirm('Revoke this license?')) return;
    await supabase.from('station_licenses').update({ status: 'revoked' }).eq('id', id);
    refresh();
  };
  const deleteLicense = async (id: string) => {
    if (!confirm('Delete permanently?')) return;
    await supabase.from('station_licenses').delete().eq('id', id);
    refresh();
  };
  const copyKey = (key: string, id: string) => {
    navigator.clipboard.writeText(key);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filtered = licenses.filter(l =>
    !search || l.license_key.toLowerCase().includes(search.toLowerCase()) ||
    l.organization_name?.toLowerCase().includes(search.toLowerCase()) ||
    l.machine_name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Licenses & Devices</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage station licenses and device activations</p>
        </div>
        <div className="flex gap-2">
          <button onClick={refresh} className="px-3 py-2 rounded-lg border border-border hover:bg-muted transition-colors"><RefreshCw size={16} /></button>
          <button onClick={() => setShowCreate(true)} className="px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors flex items-center gap-2 font-medium text-sm">
            <Plus size={16} /> Generate License
          </button>
        </div>
      </div>

      {error && <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}

      {/* Pending Devices */}
      {pending.length > 0 && (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50/50 overflow-hidden">
          <div className="px-5 py-3 bg-amber-100/60 border-b border-amber-200 flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
            <h3 className="font-semibold text-amber-900 text-sm">
              {pending.length} Device{pending.length > 1 ? 's' : ''} Waiting for Approval
            </h3>
          </div>
          <div className="divide-y divide-amber-200">
            {pending.map(d => (
              <div key={d.id} className="px-5 py-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
                    <Monitor size={20} className="text-amber-700" />
                  </div>
                  <div>
                    <code className="font-mono text-base font-bold tracking-wider">{d.machine_id}</code>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {d.machine_name && <span>{d.machine_name} &middot; </span>}
                      {new Date(d.requested_at).toLocaleString()}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={approveOrgId[d.id] || ''}
                    onChange={e => setApproveOrgId(p => ({ ...p, [d.id]: e.target.value }))}
                    className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                  >
                    <option value="">Select org...</option>
                    {organizations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                  <button onClick={() => approveDevice(d)} disabled={!approveOrgId[d.id]}
                    className="px-4 py-1.5 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 flex items-center gap-1">
                    <CheckCircle size={14} /> Approve
                  </button>
                  <button onClick={() => rejectDevice(d)} className="px-3 py-1.5 rounded-lg text-sm font-medium bg-red-100 text-red-600 hover:bg-red-200">Reject</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search + Stats */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search licenses..."
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        <div className="flex gap-3 text-sm">
          <span className="px-3 py-1.5 rounded-lg bg-background border border-border"><strong>{licenses.length}</strong> total</span>
          <span className="px-3 py-1.5 rounded-lg bg-green-50 border border-green-200 text-green-700"><strong>{licenses.filter(l => l.status === 'active').length}</strong> active</span>
          <span className="px-3 py-1.5 rounded-lg bg-blue-50 border border-blue-200 text-blue-700"><strong>{licenses.filter(l => l.machine_id).length}</strong> bound</span>
          <span className="px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-700"><strong>{licenses.filter(l => !l.machine_id).length}</strong> unused</span>
        </div>
      </div>

      {/* License List */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Key size={48} className="mx-auto mb-4 opacity-30" />
            <p className="font-medium">No licenses found</p>
          </div>
        ) : filtered.map(l => (
          <div key={l.id} className="rounded-xl border border-border bg-background p-4 hover:bg-muted/30 transition-colors">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-center gap-3">
                  {l.status === 'active' ? <CheckCircle size={16} className="text-green-500" /> :
                   l.status === 'suspended' ? <AlertCircle size={16} className="text-amber-500" /> :
                   <XCircle size={16} className="text-red-500" />}
                  <code className="font-mono text-lg font-bold tracking-wider">{l.license_key}</code>
                  <button onClick={() => copyKey(l.license_key, l.id)} className="p-1 rounded hover:bg-muted">
                    {copiedId === l.id ? <CheckCircle size={14} className="text-green-500" /> : <Copy size={14} className="text-muted-foreground" />}
                  </button>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                    l.status === 'active' ? 'bg-green-100 text-green-700' :
                    l.status === 'suspended' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                  }`}>{l.status}</span>
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
                  {l.organization_name && <span className="font-medium text-foreground">{l.organization_name}</span>}
                  {l.machine_id ? (
                    <span className="flex items-center gap-1"><Monitor size={13} /> {l.machine_name ?? l.machine_id}
                      {l.activated_at && <> &middot; activated {new Date(l.activated_at).toLocaleDateString()}</>}
                    </span>
                  ) : <span className="text-amber-600">Not activated</span>}
                  {l.expires_at && <span className={new Date(l.expires_at) < new Date() ? 'text-red-500' : ''}>Expires {new Date(l.expires_at).toLocaleDateString()}</span>}
                  {l.notes && <span className="italic">{l.notes}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => toggleStatus(l)} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${l.status === 'active' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                  {l.status === 'active' ? 'Suspend' : 'Activate'}
                </button>
                {l.machine_id && <button onClick={() => unbind(l.id)} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-100 text-blue-700">Unbind</button>}
                <button onClick={() => revoke(l.id)} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-100 text-red-600">Revoke</button>
                <button onClick={() => deleteLicense(l.id)} className="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50"><Trash2 size={15} /></button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowCreate(false)}>
          <div className="bg-background rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold">Generate New License</h2>
            <form onSubmit={createLicense} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Organization</label>
                <select value={newOrgId} onChange={e => { setNewOrgId(e.target.value); const o = organizations.find(o => o.id === e.target.value); if (o) setNewOrgName(o.name); }}
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                  <option value="">-- Select --</option>
                  {organizations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Client Name (if unlinked)</label>
                <input value={newOrgName} onChange={e => setNewOrgName(e.target.value)} placeholder="e.g. Dr. Smith Clinic"
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Expiry (optional)</label>
                <input type="date" value={newExpiry} onChange={e => setNewExpiry(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Notes</label>
                <input value={newNotes} onChange={e => setNewNotes(e.target.value)} placeholder="e.g. Reception PC"
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowCreate(false)} className="flex-1 px-4 py-2.5 rounded-xl border border-border hover:bg-muted text-sm font-medium">Cancel</button>
                <button type="submit" disabled={creating} className="flex-1 px-4 py-2.5 rounded-xl bg-slate-900 text-white hover:bg-slate-800 text-sm font-medium disabled:opacity-50">
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
