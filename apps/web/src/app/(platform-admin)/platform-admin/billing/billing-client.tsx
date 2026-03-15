'use client';

import { useState, useTransition } from 'react';
import { Building2, CheckCircle2, DollarSign, TrendingUp, XCircle } from 'lucide-react';
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
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  const paidOrgs = organizations.filter(
    (org) => org.plan_id && org.plan_id !== 'free' && org.subscription_status === 'active'
  ).length;
  const trialingOrgs = organizations.filter((org) => org.subscription_status === 'trialing').length;

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
      setOrganizations((prev) =>
        prev.map((org) =>
          org.id === orgId
            ? { ...org, plan_id: planId, subscription_status: status, billing_period: period }
            : org
        )
      );
    });
  }

  function handleResetVisits(orgId: string) {
    setError('');
    startTransition(async () => {
      const result = await resetOrgVisitCount(orgId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setOrganizations((prev) =>
        prev.map((org) => (org.id === orgId ? { ...org, monthly_visit_count: 0 } : org))
      );
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Owner console</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Billing and Stripe</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-500">
              Review revenue posture, confirm Stripe readiness, and override subscription states without leaving the owner console.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <MetricCard label="MRR" value={`$${totalMRR}`} helper="Monthly recurring revenue" />
            <MetricCard label="Paying orgs" value={paidOrgs.toString()} helper="Active paid subscriptions" />
            <MetricCard label="Trialing" value={trialingOrgs.toString()} helper="Still evaluating the product" />
            <MetricCard label="Total orgs" value={organizations.length.toString()} helper="All subscription states" />
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-[24px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
          <h2 className="text-lg font-semibold text-slate-950">Stripe readiness</h2>
          <p className="mt-1 text-sm text-slate-500">Environment and price wiring needed for production billing.</p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <ConfigRow label="STRIPE_SECRET_KEY" isSet={stripeConfig.secretKey} />
            <ConfigRow label="STRIPE_WEBHOOK_SECRET" isSet={stripeConfig.webhookSecret} />
          </div>

          <div className="mt-6 rounded-[24px] border border-slate-200 bg-[#fbfaf8] p-4">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Plan mix</p>
            <div className="mt-4 space-y-3">
              {Object.entries(planCounts).map(([plan, count]) => (
                <div key={plan}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium capitalize text-slate-700">{plan}</span>
                    <span className="text-slate-500">{count}</span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-slate-950" style={{ width: `${Math.max(8, Math.round((count / Math.max(organizations.length, 1)) * 100))}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 rounded-[24px] border border-slate-200 bg-white p-4">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Price IDs</p>
            <div className="mt-4 space-y-3">
              {Object.entries(stripeConfig.prices).map(([plan, prices]) => (
                <div key={plan} className="rounded-[20px] border border-slate-200 bg-[#fbfaf8] px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold capitalize text-slate-900">{plan}</span>
                    <span className="text-xs text-slate-500">
                      {prices.monthly ? 'Monthly set' : 'Monthly missing'} · {prices.yearly ? 'Yearly set' : 'Yearly missing'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Organization subscriptions</h2>
              <p className="mt-1 text-sm text-slate-500">Override plan, status, and billing cadence when support or operations needs to intervene.</p>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            {organizations.map((org) => (
              <article key={org.id} className="rounded-[24px] border border-slate-200 bg-[#fbfaf8] p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-lg font-semibold text-slate-950">{org.name}</p>
                    <p className="mt-1 text-sm text-slate-500">/{org.slug}</p>
                    <p className="mt-2 text-sm text-slate-500">
                      {(org.monthly_visit_count || 0).toLocaleString()} visits this month
                      {org.stripe_customer_id ? ' · Stripe linked' : ' · No Stripe customer'}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <select
                      value={org.plan_id || 'free'}
                      onChange={(event) => handleOverride(org.id, event.target.value, org.subscription_status || 'active', org.billing_period || 'monthly')}
                      disabled={isPending}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none disabled:opacity-50"
                    >
                      {PLANS.map((plan) => <option key={plan} value={plan}>{plan}</option>)}
                    </select>
                    <select
                      value={org.subscription_status || 'active'}
                      onChange={(event) => handleOverride(org.id, org.plan_id || 'free', event.target.value, org.billing_period || 'monthly')}
                      disabled={isPending}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none disabled:opacity-50"
                    >
                      {STATUSES.map((status) => <option key={status} value={status}>{status.replace('_', ' ')}</option>)}
                    </select>
                    <select
                      value={org.billing_period || 'monthly'}
                      onChange={(event) => handleOverride(org.id, org.plan_id || 'free', org.subscription_status || 'active', event.target.value)}
                      disabled={isPending}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none disabled:opacity-50"
                    >
                      <option value="monthly">monthly</option>
                      <option value="yearly">yearly</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => handleResetVisits(org.id)}
                      disabled={isPending}
                      className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:opacity-50"
                    >
                      Reset visits
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
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

function ConfigRow({ label, isSet }: { label: string; isSet: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-[20px] border border-slate-200 bg-[#fbfaf8] px-4 py-3">
      <code className="text-xs text-slate-600">{label}</code>
      <div className="flex items-center gap-1.5">
        {isSet ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-rose-500" />}
        <span className={`text-xs font-semibold ${isSet ? 'text-emerald-700' : 'text-rose-700'}`}>
          {isSet ? 'Configured' : 'Missing'}
        </span>
      </div>
    </div>
  );
}
