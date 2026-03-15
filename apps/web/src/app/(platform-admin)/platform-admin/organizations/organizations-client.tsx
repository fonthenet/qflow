'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Building2, Search, Users, MapPin, ExternalLink, ChevronRight } from 'lucide-react';
import { updateOrgPlan } from '@/lib/actions/platform-actions';

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
  created_at: string;
  staff_count: number;
  office_count: number;
}

const planColors: Record<string, string> = {
  free: 'bg-gray-100 text-gray-600',
  starter: 'bg-blue-50 text-blue-700',
  growth: 'bg-emerald-50 text-emerald-700',
  pro: 'bg-purple-50 text-purple-700',
  enterprise: 'bg-amber-50 text-amber-700',
};

const PLANS = ['free', 'starter', 'growth', 'pro', 'enterprise'];

export function OrganizationsClient({ organizations: initial }: { organizations: Org[] }) {
  const [organizations, setOrganizations] = useState(initial);
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('all');
  const [isPending, startTransition] = useTransition();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = organizations.filter((org) => {
    const matchesSearch =
      !search ||
      org.name.toLowerCase().includes(search.toLowerCase()) ||
      org.slug.toLowerCase().includes(search.toLowerCase());
    const matchesPlan = planFilter === 'all' || (org.plan_id || 'free') === planFilter;
    return matchesSearch && matchesPlan;
  });

  function handlePlanChange(orgId: string, newPlan: string) {
    startTransition(async () => {
      await updateOrgPlan(orgId, newPlan);
      setOrganizations((prev) =>
        prev.map((o) => (o.id === orgId ? { ...o, plan_id: newPlan } : o))
      );
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Organizations</h1>
        <p className="mt-1 text-sm text-gray-500">
          View and manage all organizations on the platform.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search organizations..."
            className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
          />
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-0.5">
          {['all', ...PLANS].map((plan) => (
            <button
              key={plan}
              onClick={() => setPlanFilter(plan)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition ${
                planFilter === plan
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {plan}
            </button>
          ))}
        </div>
      </div>

      {/* Stats */}
      <p className="text-sm text-gray-500">
        {filtered.length} organization{filtered.length !== 1 ? 's' : ''}
        {search || planFilter !== 'all' ? ' matching filters' : ' total'}
      </p>

      {/* List */}
      <div className="rounded-xl border border-gray-200 bg-white">
        {filtered.length === 0 ? (
          <div className="p-8 text-center">
            <Building2 className="mx-auto h-8 w-8 text-gray-300" />
            <p className="mt-2 text-sm text-gray-500">No organizations found</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filtered.map((org) => (
              <div key={org.id}>
                <button
                  onClick={() => setExpandedId(expandedId === org.id ? null : org.id)}
                  className="w-full px-5 py-4 text-left hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-sm font-bold text-gray-600">
                        {org.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{org.name}</p>
                        <p className="text-xs text-gray-400">/{org.slug}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <div className="flex items-center gap-1 text-xs text-gray-500">
                        <Users className="h-3.5 w-3.5" />
                        {org.staff_count}
                      </div>
                      <div className="flex items-center gap-1 text-xs text-gray-500">
                        <MapPin className="h-3.5 w-3.5" />
                        {org.office_count}
                      </div>
                      <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize ${planColors[org.plan_id || 'free'] || planColors.free}`}>
                        {org.plan_id || 'free'}
                      </span>
                      <span className="text-xs text-gray-400 tabular-nums w-20 text-right">
                        {(org.monthly_visit_count || 0).toLocaleString()} visits
                      </span>
                    </div>
                  </div>
                </button>

                {expandedId === org.id && (
                  <div className="border-t border-gray-100 bg-gray-50/50 px-5 py-4">
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <p className="text-xs font-medium text-gray-400">Created</p>
                        <p className="mt-0.5 text-sm text-gray-900">
                          {new Date(org.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-gray-400">Subscription Status</p>
                        <p className="mt-0.5 text-sm text-gray-900 capitalize">
                          {org.subscription_status || 'none'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-gray-400">Billing Period</p>
                        <p className="mt-0.5 text-sm text-gray-900 capitalize">
                          {org.billing_period || 'n/a'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-gray-400">Stripe Customer</p>
                        <p className="mt-0.5 text-sm text-gray-900 font-mono truncate">
                          {org.stripe_customer_id || 'none'}
                        </p>
                      </div>
                    </div>

                    {/* Plan Override */}
                    <div className="mt-4 flex items-center gap-3">
                      <label className="text-xs font-medium text-gray-500">Override Plan:</label>
                      <select
                        value={org.plan_id || 'free'}
                        onChange={(e) => handlePlanChange(org.id, e.target.value)}
                        disabled={isPending}
                        className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10 disabled:opacity-50"
                      >
                        {PLANS.map((plan) => (
                          <option key={plan} value={plan}>
                            {plan.charAt(0).toUpperCase() + plan.slice(1)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="mt-4 flex items-center gap-3">
                      <Link
                        href={`/platform-admin/organizations/${org.id}`}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-xs font-medium text-white hover:bg-gray-800"
                      >
                        Full Details
                        <ChevronRight className="h-3 w-3" />
                      </Link>
                      {org.trial_ends_at && (
                        <span className="text-xs text-amber-600">
                          Trial ends: {new Date(org.trial_ends_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
