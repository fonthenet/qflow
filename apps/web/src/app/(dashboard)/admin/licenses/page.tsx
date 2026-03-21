'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Key, Plus, Copy, Trash2, RefreshCw, Monitor, CheckCircle, XCircle, AlertCircle } from 'lucide-react';

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

export default function LicensesPage() {
  const supabase = createClient();
  const [licenses, setLicenses] = useState<License[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [newExpiry, setNewExpiry] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const fetchLicenses = useCallback(async () => {
    const { data, error } = await supabase
      .from('station_licenses')
      .select('*')
      .order('created_at', { ascending: false });
    if (data) setLicenses(data);
    if (error) setError(error.message);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { fetchLicenses(); }, [fetchLicenses]);

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
      organization_name: newOrgName || null,
      notes: newNotes || null,
      expires_at: newExpiry || null,
      status: 'active',
    });
    if (error) {
      setError(error.message);
    } else {
      setShowCreate(false);
      setNewOrgName('');
      setNewNotes('');
      setNewExpiry('');
      fetchLicenses();
    }
    setCreating(false);
  };

  const toggleStatus = async (license: License) => {
    const newStatus = license.status === 'active' ? 'suspended' : 'active';
    await supabase.from('station_licenses').update({ status: newStatus }).eq('id', license.id);
    fetchLicenses();
  };

  const revokeLicense = async (id: string) => {
    if (!confirm('Revoke this license? The station will stop working.')) return;
    await supabase.from('station_licenses').update({ status: 'revoked' }).eq('id', id);
    fetchLicenses();
  };

  const unbindMachine = async (id: string) => {
    if (!confirm('Unbind this license from its machine? It can be activated on a different PC.')) return;
    await supabase.from('station_licenses').update({ machine_id: null, machine_name: null, activated_at: null }).eq('id', id);
    fetchLicenses();
  };

  const deleteLicense = async (id: string) => {
    if (!confirm('Delete this license permanently?')) return;
    await supabase.from('station_licenses').delete().eq('id', id);
    fetchLicenses();
  };

  const copyKey = (key: string, id: string) => {
    navigator.clipboard.writeText(key);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case 'active': return <CheckCircle size={16} className="text-green-500" />;
      case 'suspended': return <AlertCircle size={16} className="text-amber-500" />;
      case 'revoked': return <XCircle size={16} className="text-red-500" />;
      default: return null;
    }
  };

  if (loading) return <div className="p-8 text-center text-muted-foreground">Loading licenses...</div>;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Key size={24} /> Station Licenses
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Generate and manage hardware-locked license keys for QFlo Station installations
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchLicenses} className="px-3 py-2 rounded-lg border border-border hover:bg-muted transition-colors" title="Refresh">
            <RefreshCw size={16} />
          </button>
          <button onClick={() => setShowCreate(true)} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-2 font-medium">
            <Plus size={16} /> Generate License
          </button>
        </div>
      </div>

      {error && <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowCreate(false)}>
          <div className="bg-background rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold">Generate New License</h2>
            <form onSubmit={createLicense} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Client / Organization</label>
                <input
                  value={newOrgName}
                  onChange={e => setNewOrgName(e.target.value)}
                  placeholder="e.g. Dr. Smith Clinic"
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Expiry Date (optional)</label>
                <input
                  type="date"
                  value={newExpiry}
                  onChange={e => setNewExpiry(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <p className="text-xs text-muted-foreground mt-1">Leave empty for a permanent license</p>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Notes (optional)</label>
                <input
                  value={newNotes}
                  onChange={e => setNewNotes(e.target.value)}
                  placeholder="e.g. Reception desk PC"
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowCreate(false)} className="flex-1 px-4 py-2.5 rounded-xl border border-border hover:bg-muted text-sm font-medium transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={creating} className="flex-1 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-medium transition-colors disabled:opacity-50">
                  {creating ? 'Generating...' : 'Generate Key'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Licenses table */}
      {licenses.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Key size={48} className="mx-auto mb-4 opacity-30" />
          <p className="font-medium">No licenses yet</p>
          <p className="text-sm mt-1">Generate a license key to activate QFlo Station on a client&apos;s PC</p>
        </div>
      ) : (
        <div className="space-y-3">
          {licenses.map(license => (
            <div key={license.id} className="border border-border rounded-xl p-4 hover:bg-muted/30 transition-colors">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0 space-y-2">
                  {/* Key + status */}
                  <div className="flex items-center gap-3">
                    {statusIcon(license.status)}
                    <code className="font-mono text-lg font-bold tracking-wider text-foreground">
                      {license.license_key}
                    </code>
                    <button
                      onClick={() => copyKey(license.license_key, license.id)}
                      className="p-1 rounded hover:bg-muted transition-colors"
                      title="Copy key"
                    >
                      {copiedId === license.id ? <CheckCircle size={14} className="text-green-500" /> : <Copy size={14} className="text-muted-foreground" />}
                    </button>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      license.status === 'active' ? 'bg-green-100 text-green-700' :
                      license.status === 'suspended' ? 'bg-amber-100 text-amber-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {license.status}
                    </span>
                  </div>

                  {/* Details */}
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
                    {license.organization_name && (
                      <span className="font-medium text-foreground">{license.organization_name}</span>
                    )}
                    {license.machine_id ? (
                      <span className="flex items-center gap-1">
                        <Monitor size={13} />
                        {license.machine_name || license.machine_id}
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
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => toggleStatus(license)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      license.status === 'active'
                        ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                        : 'bg-green-100 text-green-700 hover:bg-green-200'
                    }`}
                  >
                    {license.status === 'active' ? 'Suspend' : 'Activate'}
                  </button>
                  {license.machine_id && (
                    <button
                      onClick={() => unbindMachine(license.id)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors"
                      title="Unbind from machine — allows re-activation on a different PC"
                    >
                      Unbind
                    </button>
                  )}
                  <button
                    onClick={() => deleteLicense(license.id)}
                    className="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                    title="Delete license"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Instructions */}
      <div className="border border-border rounded-xl p-5 bg-muted/20 space-y-3">
        <h3 className="font-semibold text-sm">How it works</h3>
        <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
          <li><strong>Generate</strong> a license key above for the client</li>
          <li><strong>Send</strong> them the key along with the QFlo Station installer</li>
          <li>Client installs and opens the station — they&apos;ll see their <strong>Machine ID</strong></li>
          <li>Client enters the license key — station <strong>activates and locks</strong> to that PC</li>
          <li>If needed, <strong>Unbind</strong> a license to move it to a different machine</li>
        </ol>
      </div>
    </div>
  );
}
