'use client';

import { useState, useTransition } from 'react';
import { Key, Plus, Trash2, Copy, Check, AlertTriangle } from 'lucide-react';
import { createApiKey, revokeApiKey, deleteApiKey } from '@/lib/actions/api-key-actions';

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
      // Refresh will happen on next navigation
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
      setKeys(keys.map(k => k.id === keyId ? { ...k, is_active: false } : k));
    });
  }

  function handleDelete(keyId: string) {
    startTransition(async () => {
      await deleteApiKey(keyId);
      setKeys(keys.filter(k => k.id !== keyId));
    });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">API Keys</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage API keys for REST API access. Available on Growth plans and above.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          disabled={isPending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          Create Key
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      )}

      {/* Revealed key banner */}
      {revealedKey && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">
            Copy your API key now. It won&apos;t be shown again.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 rounded-lg bg-white px-3 py-2 text-sm font-mono text-gray-900 border border-amber-200">
              {revealedKey}
            </code>
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <button
            onClick={() => setRevealedKey(null)}
            className="mt-2 text-xs text-amber-700 hover:text-amber-900"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-gray-900">New API Key</h3>
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="Key name (e.g. Production, Staging)"
              className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
            <button
              onClick={handleCreate}
              disabled={isPending || !newKeyName.trim()}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              Create
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Keys list */}
      <div className="rounded-xl border border-gray-200 bg-white">
        {keys.length === 0 ? (
          <div className="p-8 text-center">
            <Key className="mx-auto h-8 w-8 text-gray-300" />
            <p className="mt-2 text-sm text-gray-500">No API keys yet</p>
            <p className="text-xs text-gray-400">Create one to start using the REST API</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {keys.map((key) => (
              <div key={key.id} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <Key className={`h-4 w-4 ${key.is_active ? 'text-gray-600' : 'text-gray-300'}`} />
                  <div>
                    <div className="flex items-center gap-2">
                      <p className={`text-sm font-medium ${key.is_active ? 'text-gray-900' : 'text-gray-400 line-through'}`}>
                        {key.name}
                      </p>
                      {!key.is_active && (
                        <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-600">
                          Revoked
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400">
                      {key.key_prefix}... &middot; Created {new Date(key.created_at).toLocaleDateString()}
                      {key.last_used_at && ` &middot; Last used ${new Date(key.last_used_at).toLocaleDateString()}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {key.is_active && (
                    <button
                      onClick={() => handleRevoke(key.id)}
                      disabled={isPending}
                      className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-amber-600 disabled:opacity-50"
                      title="Revoke"
                    >
                      <AlertTriangle className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(key.id)}
                    disabled={isPending}
                    className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-red-600 disabled:opacity-50"
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
