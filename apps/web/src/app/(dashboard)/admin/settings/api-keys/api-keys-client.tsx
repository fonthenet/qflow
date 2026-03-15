'use client';

import { useState, useTransition } from 'react';
import { AlertTriangle, Check, Copy, Key, Plus, Trash2 } from 'lucide-react';
import { createApiKey, deleteApiKey, revokeApiKey } from '@/lib/actions/api-key-actions';

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
}

export function ApiKeysClient({ keys: initialKeys }: { keys: ApiKey[] }) {
  const [keys, setKeys] = useState(initialKeys);
  const [isPending, startTransition] = useTransition();
  const [newKeyName, setNewKeyName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  function handleCreate() {
    if (!newKeyName.trim()) return;
    setError('');

    startTransition(async () => {
      const result = await createApiKey(newKeyName.trim());
      if ('error' in result) {
        setError(result.error!);
        return;
      }
      setRevealedKey(result.key!);
      setNewKeyName('');
      setShowCreate(false);
    });
  }

  function handleCopy() {
    if (!revealedKey) return;
    navigator.clipboard.writeText(revealedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleRevoke(keyId: string) {
    startTransition(async () => {
      await revokeApiKey(keyId);
      setKeys((prev) => prev.map((key) => (key.id === keyId ? { ...key, is_active: false } : key)));
    });
  }

  function handleDelete(keyId: string) {
    startTransition(async () => {
      await deleteApiKey(keyId);
      setKeys((prev) => prev.filter((key) => key.id !== keyId));
    });
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
        <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-end">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Developer access</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">API keys</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-500">
              Manage server-to-server access for partner systems, warehouse jobs, or custom automations.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard label="Keys" value={keys.length.toString()} helper="Saved credentials" />
            <MetricCard label="Active" value={keys.filter((key) => key.is_active).length.toString()} helper="Currently usable" />
            <MetricCard label="Revoked" value={keys.filter((key) => !key.is_active).length.toString()} helper="Blocked from use" />
          </div>
        </div>
      </section>

      {error ? (
        <div className="flex items-center gap-2 rounded-[24px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      ) : null}

      {revealedKey ? (
        <section className="rounded-[30px] border border-amber-200 bg-amber-50 p-5">
          <p className="text-sm font-semibold text-amber-900">Copy this key now. It will not be shown again.</p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <code className="flex-1 rounded-[20px] border border-amber-200 bg-white px-4 py-3 text-sm font-mono text-slate-900 break-all">
              {revealedKey}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-[#10292f] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#173740]"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </section>
      ) : null}

      <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-950">Create a new key</p>
            <p className="mt-1 text-sm text-slate-500">Name keys by environment, integration, or partner.</p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreate((current) => !current)}
            disabled={isPending}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-[#fbfaf8] px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {showCreate ? 'Hide form' : 'Create key'}
          </button>
        </div>

        {showCreate ? (
          <div className="mt-5 flex flex-col gap-3 md:flex-row">
            <input
              type="text"
              value={newKeyName}
              onChange={(event) => setNewKeyName(event.target.value)}
              placeholder="Key name (e.g. Production, Staging)"
              className="flex-1 rounded-[20px] border border-slate-200 bg-[#fbfaf8] px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#10292f]"
              onKeyDown={(event) => event.key === 'Enter' && handleCreate()}
            />
            <button
              type="button"
              onClick={handleCreate}
              disabled={isPending || !newKeyName.trim()}
              className="rounded-full bg-[#10292f] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#173740] disabled:opacity-50"
            >
              Create
            </button>
          </div>
        ) : null}
      </section>

      <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
        {keys.length === 0 ? (
          <div className="py-12 text-center">
            <Key className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-slate-900">No API keys yet.</p>
            <p className="mt-1 text-sm text-slate-500">Create one to unlock REST API access for external systems.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {keys.map((key) => (
              <article key={key.id} className="flex flex-col gap-4 rounded-[24px] border border-slate-200 bg-[#fbfaf8] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-slate-500">
                    <Key className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={`text-sm font-semibold ${key.is_active ? 'text-slate-950' : 'text-slate-400 line-through'}`}>
                        {key.name}
                      </p>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${key.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                        {key.is_active ? 'Active' : 'Revoked'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {key.key_prefix}... · Created {new Date(key.created_at).toLocaleDateString()}
                      {key.last_used_at ? ` · Last used ${new Date(key.last_used_at).toLocaleDateString()}` : ''}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {key.is_active ? (
                    <button
                      type="button"
                      onClick={() => handleRevoke(key.id)}
                      disabled={isPending}
                      className="rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 transition hover:bg-amber-100 disabled:opacity-50"
                    >
                      Revoke
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => handleDelete(key.id)}
                    disabled={isPending}
                    className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function MetricCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-[22px] border border-slate-200 bg-[#fbfaf8] px-4 py-4">
      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-1 text-sm text-slate-500">{helper}</p>
    </div>
  );
}
