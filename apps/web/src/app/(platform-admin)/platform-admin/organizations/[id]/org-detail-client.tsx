'use client';

import { useState, useTransition } from 'react';
import { ArrowLeft, Building2, Users, MapPin, Ticket, Save, Trash2, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { updateOrganization, deleteOrganization } from '@/lib/actions/platform-actions';

interface Org {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  plan_id: string | null;
  subscription_status: string | null;
  billing_period: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  monthly_visit_count: number | null;
  stripe_customer_id: string | null;
  settings: any;
  created_at: string;
  updated_at: string | null;
}

interface Staff {
  id: string;
  full_name: string;
  email: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
}

interface Office {
  id: string;
  name: string;
  address: string | null;
  is_active: boolean;
  timezone: string;
  created_at: string;
}

const PLANS = ['free', 'starter', 'growth', 'pro', 'enterprise'];
const STATUSES = ['active', 'trialing', 'past_due', 'canceled', 'unpaid'];

export function OrgDetailClient({
  org,
  staff,
  offices,
  stats,
}: {
  org: Org;
  staff: Staff[];
  offices: Office[];
  stats: { ticketCount: number; todayTickets: number; customerCount: number };
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [name, setName] = useState(org.name);
  const [slug, setSlug] = useState(org.slug);
  const [planId, setPlanId] = useState(org.plan_id || 'free');
  const [subStatus, setSubStatus] = useState(org.subscription_status || 'active');
  const [billingPeriod, setBillingPeriod] = useState(org.billing_period || 'monthly');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  function handleSave() {
    setError('');
    setSuccess('');
    startTransition(async () => {
      const result = await updateOrganization(org.id, {
        name,
        slug,
        plan_id: planId,
        subscription_status: subStatus,
        billing_period: billingPeriod,
      });
      if (result.error) {
        setError(result.error);
      } else {
        setSuccess('Organization updated successfully.');
        setTimeout(() => setSuccess(''), 3000);
      }
    });
  }

  function handleDelete() {
    setError('');
    startTransition(async () => {
      const result = await deleteOrganization(org.id);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push('/platform-admin/organizations');
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/platform-admin/organizations"
          className="rounded-full border border-slate-200 p-2 text-slate-400 transition hover:border-slate-300 hover:bg-white hover:text-slate-900"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Owner console</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">{org.name}</h1>
          <p className="text-sm text-slate-500">/{org.slug} · Created {new Date(org.created_at).toLocaleDateString()}</p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}
      {success && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{success}</div>
      )}

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-[24px] border border-slate-200 bg-white p-4 text-center shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
          <Users className="mx-auto h-5 w-5 text-slate-400" />
          <p className="mt-2 text-xl font-semibold text-slate-950">{staff.length}</p>
          <p className="text-xs text-slate-500">Staff</p>
        </div>
        <div className="rounded-[24px] border border-slate-200 bg-white p-4 text-center shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
          <MapPin className="mx-auto h-5 w-5 text-slate-400" />
          <p className="mt-2 text-xl font-semibold text-slate-950">{offices.length}</p>
          <p className="text-xs text-slate-500">Locations</p>
        </div>
        <div className="rounded-[24px] border border-slate-200 bg-white p-4 text-center shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
          <Ticket className="mx-auto h-5 w-5 text-slate-400" />
          <p className="mt-2 text-xl font-semibold text-slate-950">{stats.ticketCount.toLocaleString()}</p>
          <p className="text-xs text-slate-500">Total Tickets</p>
        </div>
        <div className="rounded-[24px] border border-slate-200 bg-white p-4 text-center shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
          <Building2 className="mx-auto h-5 w-5 text-slate-400" />
          <p className="mt-2 text-xl font-semibold text-slate-950">{stats.customerCount.toLocaleString()}</p>
          <p className="text-xs text-slate-500">Customers</p>
        </div>
      </div>

      {/* Edit Organization */}
      <div className="space-y-4 rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
        <h3 className="text-sm font-semibold text-slate-950">Organization details</h3>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-[18px] border border-slate-200 bg-[#fbfaf8] px-4 py-3 text-sm text-slate-900 outline-none focus:border-[#10292f]"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Slug</label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="w-full rounded-[18px] border border-slate-200 bg-[#fbfaf8] px-4 py-3 text-sm font-mono text-slate-900 outline-none focus:border-[#10292f]"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Plan</label>
            <select
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              className="w-full rounded-[18px] border border-slate-200 bg-[#fbfaf8] px-4 py-3 text-sm text-slate-900 outline-none focus:border-[#10292f]"
            >
              {PLANS.map(p => (
                <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Status</label>
            <select
              value={subStatus}
              onChange={(e) => setSubStatus(e.target.value)}
              className="w-full rounded-[18px] border border-slate-200 bg-[#fbfaf8] px-4 py-3 text-sm text-slate-900 outline-none focus:border-[#10292f]"
            >
              {STATUSES.map(s => (
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1).replace('_', ' ')}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Billing Period</label>
            <select
              value={billingPeriod}
              onChange={(e) => setBillingPeriod(e.target.value)}
              className="w-full rounded-[18px] border border-slate-200 bg-[#fbfaf8] px-4 py-3 text-sm text-slate-900 outline-none focus:border-[#10292f]"
            >
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Stripe Customer ID</label>
            <p className="rounded-[18px] border border-slate-200 bg-[#fbfaf8] px-4 py-3 text-sm font-mono text-slate-600">
              {org.stripe_customer_id || 'Not linked'}
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Monthly Visits</label>
            <p className="rounded-[18px] border border-slate-200 bg-[#fbfaf8] px-4 py-3 text-sm text-slate-600">
              {(org.monthly_visit_count || 0).toLocaleString()}
            </p>
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-full bg-[#10292f] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#173740] disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          Save Changes
        </button>
      </div>

      {/* Staff */}
      <div className="rounded-[30px] border border-slate-200 bg-white shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
        <div className="border-b border-slate-100 px-6 py-4">
          <h3 className="text-sm font-semibold text-slate-950">Staff members</h3>
        </div>
        {staff.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-400">No staff members</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {staff.map((s) => (
              <div key={s.id} className="flex items-center justify-between px-6 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">{s.full_name}</p>
                  <p className="text-xs text-slate-400">{s.email || 'No email'}</p>
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600 capitalize">
                  {s.role.replace('_', ' ')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Offices */}
      <div className="rounded-[30px] border border-slate-200 bg-white shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
        <div className="border-b border-slate-100 px-6 py-4">
          <h3 className="text-sm font-semibold text-slate-950">Locations</h3>
        </div>
        {offices.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-400">No locations</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {offices.map((o) => (
              <div key={o.id} className="flex items-center justify-between px-6 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">{o.name}</p>
                  <p className="text-xs text-slate-400">{o.address || 'No address'} &middot; {o.timezone}</p>
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                  o.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                }`}>
                  {o.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Danger Zone */}
      <div className="rounded-[30px] border border-red-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
        <h3 className="text-sm font-semibold text-red-900">Danger Zone</h3>
        <p className="mt-1 text-xs text-slate-500">
          Permanently delete this organization and all its data. This cannot be undone.
        </p>
        {!showDeleteConfirm ? (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="mt-4 inline-flex items-center gap-2 rounded-full border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" />
            Delete Organization
          </button>
        ) : (
          <div className="mt-4 flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4" />
              Are you sure? This deletes all data permanently.
            </div>
            <button
              onClick={handleDelete}
              disabled={isPending}
              className="rounded-full bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              Yes, Delete
            </button>
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="rounded-full border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
