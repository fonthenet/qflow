'use client';

import { useState, useTransition } from 'react';
import { DollarSign, CheckCircle2, XCircle, TrendingUp, Building2 } from 'lucide-react';
import { overrideSubscription, resetOrgVisitCount } from '@/lib/actions/platform-actions';

interface Org {
  id: string;
  name: string;
  slug: string;
  plan_id: string | null;
  subscription_status: string | null;
  billing_period: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  monthly_visit_count: number | null;
  stripe_customer_id: string | null;
  created_at: string;
}

interface StripeConfig {
  secretKey: boolean;
  webhookSecret: boolean;
  prices: Record<string, { monthly: string; yearly: string }>;
}

const planColors: Record<string, string> = {
  free: 'bg-gray-100 text-gray-600',
  starter: 'bg-blue-50 text-blue-700',
  growth: 'bg-emerald-50 text-emerald-700',
  pro: 'bg-purple-50 text-purple-700',
  enterprise: 'bg-amber-50 text-amber-700',
};

const PLANS = ['free', 'starter', 'growth', 'pro', 'enterprise'];
const STATUSES = ['active', 'trialing', 'past_due', 'canceled', 'unpaid'];

export function BillingOverviewClient({
  organizations: initial,
  planCounts,
  totalMRR,
  stripeConfig,
}: {
  organizations: Org[];
  planCounts: Record<string, number>;
  totalMRR: number;
  stripeConfig: StripeConfig;
}) {
  const [organizations, setOrganizations] = useState(initial);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState('');

  const paidOrgs = organizations.filter(o => o.plan_id && o.plan_id !== 'free' && o.subscription_status === 'active').length;
  const trialingOrgs = organizations.filter(o => o.subscription_status === 'trialing').length;

  function handleOverride(orgId: string, planId: string, status: string, period: string) {
    setError('');
    startTransition(async () => {
      const result = await overrideSubscription(orgId, {
        plan_id: planId,
        subscription_status: status,
        billing_period: period,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setOrganizations(prev => prev.map(o =>
        o.id === orgId ? { ...o, plan_id: planId, subscription_status: status, billing_period: period } : o
      ));
    });
  }

  function handleResetVisits(orgId: string) {
    startTransition(async () => {
      const result = await resetOrgVisitCount(orgId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setOrganizations(prev => prev.map(o =>
        o.id === orgId ? { ...o, monthly_visit_count: 0 } : o
      ));
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Billing & Stripe</h1>
        <p className="mt-1 text-sm text-gray-500">
          Global billing overview, Stripe configuration, and subscription management.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      {/* Revenue Stats */}
      <div className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <DollarSign className="h-5 w-5 text-gray-400" />
          <p className="mt-3 text-2xl font-bold text-gray-900">${totalMRR}</p>
          <p className="mt-0.5 text-xs text-gray-500">Monthly Revenue</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <Building2 className="h-5 w-5 text-gray-400" />
          <p className="mt-3 text-2xl font-bold text-gray-900">{paidOrgs}</p>
          <p className="mt-0.5 text-xs text-gray-500">Paying Customers</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <TrendingUp className="h-5 w-5 text-gray-400" />
          <p className="mt-3 text-2xl font-bold text-gray-900">{trialingOrgs}</p>
          <p className="mt-0.5 text-xs text-gray-500">On Trial</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <Building2 className="h-5 w-5 text-gray-400" />
          <p className="mt-3 text-2xl font-bold text-gray-900">{organizations.length}</p>
          <p className="mt-0.5 text-xs text-gray-500">Total Organizations</p>
        </div>
      </div>

      {/* Stripe Configuration */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h3 className="text-sm font-semibold text-gray-900">Stripe Configuration</h3>
        <p className="mt-1 text-xs text-gray-500">
          Set these in your <code className="rounded bg-gray-100 px-1 py-0.5 text-[10px] font-mono">.env.local</code> file. Create products and prices in your Stripe Dashboard first.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="flex items-center justify-between rounded-lg border border-gray-100 px-4 py-2.5">
            <code className="text-xs font-mono text-gray-600">STRIPE_SECRET_KEY</code>
            {stripeConfig.secretKey ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            ) : (
              <XCircle className="h-4 w-4 text-red-400" />
            )}
          </div>
          <div className="flex items-center justify-between rounded-lg border border-gray-100 px-4 py-2.5">
            <code className="text-xs font-mono text-gray-600">STRIPE_WEBHOOK_SECRET</code>
            {stripeConfig.webhookSecret ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            ) : (
              <XCircle className="h-4 w-4 text-red-400" />
            )}
          </div>
        </div>

        <h4 className="mt-5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Price IDs</h4>
        <div className="mt-2 rounded-lg border border-gray-100 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50/50">
                <th className="px-4 py-2 text-left text-[10px] font-medium text-gray-400 uppercase">Plan</th>
                <th className="px-4 py-2 text-left text-[10px] font-medium text-gray-400 uppercase">Monthly Price ID</th>
                <th className="px-4 py-2 text-left text-[10px] font-medium text-gray-400 uppercase">Yearly Price ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {Object.entries(stripeConfig.prices).map(([plan, prices]) => (
                <tr key={plan}>
                  <td className="px-4 py-2 text-xs font-medium capitalize text-gray-700">{plan}</td>
                  <td className="px-4 py-2">
                    {prices.monthly ? (
                      <code className="text-[10px] font-mono text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">{prices.monthly}</code>
                    ) : (
                      <span className="text-[10px] text-red-500">Not set</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {prices.yearly ? (
                      <code className="text-[10px] font-mono text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">{prices.yearly}</code>
                    ) : (
                      <span className="text-[10px] text-red-500">Not set</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-org Billing */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-6 py-4">
          <h3 className="text-sm font-semibold text-gray-900">Organization Subscriptions</h3>
          <p className="mt-0.5 text-xs text-gray-500">Override plan, status, and billing period for any organization.</p>
        </div>
        <div className="divide-y divide-gray-50">
          {organizations.map((org) => (
            <div key={org.id} className="px-6 py-4">
              <div className="flex flex-wrap items-center gap-4">
                <div className="min-w-[180px]">
                  <p className="text-sm font-medium text-gray-900">{org.name}</p>
                  <p className="text-xs text-gray-400">
                    {(org.monthly_visit_count || 0).toLocaleString()} visits this month
                    {org.stripe_customer_id && (
                      <span className="ml-2 text-emerald-600">Stripe linked</span>
                    )}
                  </p>
                </div>

                <select
                  value={org.plan_id || 'free'}
                  onChange={(e) => handleOverride(org.id, e.target.value, org.subscription_status || 'active', org.billing_period || 'monthly')}
                  disabled={isPending}
                  className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900/10 disabled:opacity-50"
                >
                  {PLANS.map(p => (
                    <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                  ))}
                </select>

                <select
                  value={org.subscription_status || 'active'}
                  onChange={(e) => handleOverride(org.id, org.plan_id || 'free', e.target.value, org.billing_period || 'monthly')}
                  disabled={isPending}
                  className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900/10 disabled:opacity-50"
                >
                  {STATUSES.map(s => (
                    <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1).replace('_', ' ')}</option>
                  ))}
                </select>

                <select
                  value={org.billing_period || 'monthly'}
                  onChange={(e) => handleOverride(org.id, org.plan_id || 'free', org.subscription_status || 'active', e.target.value)}
                  disabled={isPending}
                  className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900/10 disabled:opacity-50"
                >
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>

                <button
                  onClick={() => handleResetVisits(org.id)}
                  disabled={isPending}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                >
                  Reset visits
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
