'use client';

import { useState, useTransition } from 'react';
import { Webhook, Plus, Trash2, Copy, Check, AlertTriangle, ToggleLeft, ToggleRight } from 'lucide-react';
import { createWebhookEndpoint, updateWebhookEndpoint, deleteWebhookEndpoint } from '@/lib/actions/webhook-actions';

const ALL_EVENTS = [
  'ticket.created',
  'ticket.called',
  'ticket.serving',
  'ticket.served',
  'ticket.no_show',
  'ticket.cancelled',
  'ticket.transferred',
];

interface Endpoint {
  id: string;
  url: string;
  events: string[];
  is_active: boolean;
  failure_count: number;
  last_triggered_at: string | null;
  created_at: string;
}

export function WebhooksClient({ endpoints: initial }: { endpoints: Endpoint[] }) {
  const [endpoints, setEndpoints] = useState(initial);
  const [isPending, startTransition] = useTransition();
  const [showCreate, setShowCreate] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newEvents, setNewEvents] = useState<string[]>([]);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  function handleCreate() {
    if (!newUrl.trim()) return;
    setError('');

    startTransition(async () => {
      const result = await createWebhookEndpoint(newUrl.trim(), newEvents);
      if ('error' in result) {
        setError(result.error!);
        return;
      }
      setRevealedSecret(result.secret!);
      setNewUrl('');
      setNewEvents([]);
      setShowCreate(false);
    });
  }

  function handleToggle(id: string, currentActive: boolean) {
    startTransition(async () => {
      await updateWebhookEndpoint(id, { is_active: !currentActive });
      setEndpoints(endpoints.map(ep =>
        ep.id === id ? { ...ep, is_active: !currentActive } : ep
      ));
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteWebhookEndpoint(id);
      setEndpoints(endpoints.filter(ep => ep.id !== id));
    });
  }

  function handleCopy() {
    if (!revealedSecret) return;
    navigator.clipboard.writeText(revealedSecret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function toggleEvent(event: string) {
    setNewEvents(prev =>
      prev.includes(event) ? prev.filter(e => e !== event) : [...prev, event]
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Webhooks</h1>
          <p className="mt-1 text-sm text-gray-500">
            Receive real-time HTTP callbacks when events happen. Available on Growth plans and above.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          disabled={isPending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          Add Endpoint
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      )}

      {revealedSecret && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">
            Copy your signing secret now. It won&apos;t be shown again.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 rounded-lg bg-white px-3 py-2 text-sm font-mono text-gray-900 border border-amber-200 break-all">
              {revealedSecret}
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
            onClick={() => setRevealedSecret(null)}
            className="mt-2 text-xs text-amber-700 hover:text-amber-900"
          >
            Dismiss
          </button>
        </div>
      )}

      {showCreate && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-900">New Webhook Endpoint</h3>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Endpoint URL</label>
            <input
              type="url"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://your-server.com/webhook"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">
              Events (leave empty for all events)
            </label>
            <div className="flex flex-wrap gap-2">
              {ALL_EVENTS.map((event) => (
                <button
                  key={event}
                  onClick={() => toggleEvent(event)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    newEvents.includes(event)
                      ? 'bg-gray-900 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {event}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={isPending || !newUrl.trim()}
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

      <div className="rounded-xl border border-gray-200 bg-white">
        {endpoints.length === 0 ? (
          <div className="p-8 text-center">
            <Webhook className="mx-auto h-8 w-8 text-gray-300" />
            <p className="mt-2 text-sm text-gray-500">No webhook endpoints</p>
            <p className="text-xs text-gray-400">Add one to receive real-time event callbacks</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {endpoints.map((ep) => (
              <div key={ep.id} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      onClick={() => handleToggle(ep.id, ep.is_active)}
                      disabled={isPending}
                      title={ep.is_active ? 'Disable' : 'Enable'}
                    >
                      {ep.is_active ? (
                        <ToggleRight className="h-5 w-5 text-emerald-600" />
                      ) : (
                        <ToggleLeft className="h-5 w-5 text-gray-300" />
                      )}
                    </button>
                    <div className="min-w-0">
                      <p className={`text-sm font-mono truncate ${ep.is_active ? 'text-gray-900' : 'text-gray-400'}`}>
                        {ep.url}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {ep.events.length > 0 ? (
                          <span className="text-[10px] text-gray-400">
                            {ep.events.length} event{ep.events.length !== 1 ? 's' : ''}
                          </span>
                        ) : (
                          <span className="text-[10px] text-gray-400">All events</span>
                        )}
                        {ep.failure_count > 0 && (
                          <span className="text-[10px] text-amber-600">
                            {ep.failure_count} failure{ep.failure_count !== 1 ? 's' : ''}
                          </span>
                        )}
                        {ep.last_triggered_at && (
                          <span className="text-[10px] text-gray-400">
                            Last fired {new Date(ep.last_triggered_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(ep.id)}
                    disabled={isPending}
                    className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-red-600 disabled:opacity-50"
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
