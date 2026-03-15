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
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/platform-admin/organizations"
          className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-900"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{org.name}</h1>
          <p className="text-sm text-gray-500">/{org.slug} &middot; Created {new Date(org.created_at).toLocaleDateString()}</p>
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
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-center">
          <Users className="mx-auto h-5 w-5 text-gray-400" />
          <p className="mt-2 text-xl font-bold text-gray-900">{staff.length}</p>
          <p className="text-xs text-gray-500">Staff</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-center">
          <MapPin className="mx-auto h-5 w-5 text-gray-400" />
          <p className="mt-2 text-xl font-bold text-gray-900">{offices.length}</p>
          <p className="text-xs text-gray-500">Locations</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-center">
          <Ticket className="mx-auto h-5 w-5 text-gray-400" />
          <p className="mt-2 text-xl font-bold text-gray-900">{stats.ticketCount.toLocaleString()}</p>
          <p className="text-xs text-gray-500">Total Tickets</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-center">
          <Building2 className="mx-auto h-5 w-5 text-gray-400" />
          <p className="mt-2 text-xl font-bold text-gray-900">{stats.customerCount.toLocaleString()}</p>
          <p className="text-xs text-gray-500">Customers</p>
        </div>
      </div>

      {/* Edit Organization */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-4">
        <h3 className="text-sm font-semibold text-gray-900">Organization Details</h3>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Slug</label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 font-mono focus:outline-none focus:ring-2 focus:ring-gray-900/10"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Plan</label>
            <select
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
            >
              {PLANS.map(p => (
                <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Status</label>
            <select
              value={subStatus}
              onChange={(e) => setSubStatus(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
            >
              {STATUSES.map(s => (
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1).replace('_', ' ')}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Billing Period</label>
            <select
              value={billingPeriod}
              onChange={(e) => setBillingPeriod(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
            >
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Stripe Customer ID</label>
            <p className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm font-mono text-gray-600">
              {org.stripe_customer_id || 'Not linked'}
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Monthly Visits</label>
            <p className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-gray-600">
              {(org.monthly_visit_count || 0).toLocaleString()}
            </p>
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          Save Changes
        </button>
      </div>

      {/* Staff */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-6 py-4">
          <h3 className="text-sm font-semibold text-gray-900">Staff Members</h3>
        </div>
        {staff.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-400">No staff members</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {staff.map((s) => (
              <div key={s.id} className="flex items-center justify-between px-6 py-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">{s.full_name}</p>
                  <p className="text-xs text-gray-400">{s.email || 'No email'}</p>
                </div>
                <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-medium text-gray-600 capitalize">
                  {s.role.replace('_', ' ')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Offices */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-6 py-4">
          <h3 className="text-sm font-semibold text-gray-900">Locations</h3>
        </div>
        {offices.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-400">No locations</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {offices.map((o) => (
              <div key={o.id} className="flex items-center justify-between px-6 py-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">{o.name}</p>
                  <p className="text-xs text-gray-400">{o.address || 'No address'} &middot; {o.timezone}</p>
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                  o.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'
                }`}>
                  {o.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Danger Zone */}
      <div className="rounded-xl border border-red-200 bg-white p-6">
        <h3 className="text-sm font-semibold text-red-900">Danger Zone</h3>
        <p className="mt-1 text-xs text-gray-500">
          Permanently delete this organization and all its data. This cannot be undone.
        </p>
        {!showDeleteConfirm ? (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="mt-4 inline-flex items-center gap-2 rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
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
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              Yes, Delete
            </button>
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
