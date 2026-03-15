'use client';

import { useState, useTransition } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Plus,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Webhook,
} from 'lucide-react';
import { createWebhookEndpoint, deleteWebhookEndpoint, updateWebhookEndpoint } from '@/lib/actions/webhook-actions';

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
      setEndpoints((prev) => prev.map((endpoint) => (endpoint.id === id ? { ...endpoint, is_active: !currentActive } : endpoint)));
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteWebhookEndpoint(id);
      setEndpoints((prev) => prev.filter((endpoint) => endpoint.id !== id));
    });
  }

  function handleCopy() {
    if (!revealedSecret) return;
    navigator.clipboard.writeText(revealedSecret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function toggleEvent(event: string) {
    setNewEvents((prev) => (prev.includes(event) ? prev.filter((entry) => entry !== event) : [...prev, event]));
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
        <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-end">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Outbound automation</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Webhooks</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-500">
              Push live ticket events into CRMs, warehouse jobs, automation tools, or partner systems as the command center changes state.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard label="Endpoints" value={endpoints.length.toString()} helper="Saved destinations" />
            <MetricCard label="Active" value={endpoints.filter((endpoint) => endpoint.is_active).length.toString()} helper="Ready to fire" />
            <MetricCard label="Failures" value={endpoints.reduce((sum, endpoint) => sum + endpoint.failure_count, 0).toString()} helper="Recorded delivery issues" />
          </div>
        </div>
      </section>

      {error ? (
        <div className="flex items-center gap-2 rounded-[24px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      ) : null}

      {revealedSecret ? (
        <section className="rounded-[30px] border border-amber-200 bg-amber-50 p-5">
          <p className="text-sm font-semibold text-amber-900">Copy this signing secret now. It will not be shown again.</p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <code className="flex-1 rounded-[20px] border border-amber-200 bg-white px-4 py-3 text-sm font-mono text-slate-900 break-all">
              {revealedSecret}
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
            <p className="text-sm font-semibold text-slate-950">Create an endpoint</p>
            <p className="mt-1 text-sm text-slate-500">Choose the destination URL and limit events if you do not need the full live stream.</p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreate((current) => !current)}
            disabled={isPending}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-[#fbfaf8] px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {showCreate ? 'Hide form' : 'Add endpoint'}
          </button>
        </div>

        {showCreate ? (
          <div className="mt-5 space-y-4">
            <input
              type="url"
              value={newUrl}
              onChange={(event) => setNewUrl(event.target.value)}
              placeholder="https://your-server.com/webhook"
              className="w-full rounded-[20px] border border-slate-200 bg-[#fbfaf8] px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#10292f]"
            />
            <div className="flex flex-wrap gap-2">
              {ALL_EVENTS.map((event) => (
                <button
                  key={event}
                  type="button"
                  onClick={() => toggleEvent(event)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    newEvents.includes(event)
                      ? 'bg-[#10292f] text-white'
                      : 'border border-slate-200 bg-[#fbfaf8] text-slate-600 hover:border-slate-300'
                  }`}
                >
                  {event}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleCreate}
              disabled={isPending || !newUrl.trim()}
              className="rounded-full bg-[#10292f] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#173740] disabled:opacity-50"
            >
              Create webhook
            </button>
          </div>
        ) : null}
      </section>

      <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
        {endpoints.length === 0 ? (
          <div className="py-12 text-center">
            <Webhook className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-slate-900">No webhook endpoints yet.</p>
            <p className="mt-1 text-sm text-slate-500">Add one to receive ticket lifecycle events in real time.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {endpoints.map((endpoint) => (
              <article key={endpoint.id} className="rounded-[24px] border border-slate-200 bg-[#fbfaf8] px-4 py-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex items-start gap-3 min-w-0">
                    <button
                      type="button"
                      onClick={() => handleToggle(endpoint.id, endpoint.is_active)}
                      disabled={isPending}
                      title={endpoint.is_active ? 'Disable' : 'Enable'}
                    >
                      {endpoint.is_active ? (
                        <ToggleRight className="h-6 w-6 text-emerald-600" />
                      ) : (
                        <ToggleLeft className="h-6 w-6 text-slate-300" />
                      )}
                    </button>
                    <div className="min-w-0">
                      <p className={`truncate font-mono text-sm ${endpoint.is_active ? 'text-slate-900' : 'text-slate-400'}`}>{endpoint.url}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {endpoint.events.length > 0 ? `${endpoint.events.length} selected events` : 'All events'}
                        {endpoint.last_triggered_at ? ` · Last fired ${new Date(endpoint.last_triggered_at).toLocaleDateString()}` : ''}
                        {endpoint.failure_count > 0 ? ` · ${endpoint.failure_count} failures` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${endpoint.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                      {endpoint.is_active ? 'Active' : 'Disabled'}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDelete(endpoint.id)}
                      disabled={isPending}
                      className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </button>
                  </div>
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
