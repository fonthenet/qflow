'use client';

import { useState, useTransition } from 'react';
import { AlertTriangle, ArrowUpRight, Check, Clock, CreditCard, FileText } from 'lucide-react';
import { createBillingPortalSession, createCheckoutSession } from '@/lib/actions/billing-actions';
import { plans } from '@/lib/data/pricing';

interface Org {
  id: string;
  name: string;
  plan_id: string;
  subscription_status: string;
  billing_period: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  monthly_visit_count: number;
  stripe_customer_id: string | null;
}

interface Invoice {
  id: string;
  amount_cents: number;
  currency: string;
  status: string;
  invoice_url: string | null;
  period_start: string | null;
  period_end: string | null;
  created_at: string;
}

export function BillingClient({ org, invoices }: { org: Org; invoices: Invoice[] }) {
  const [period, setPeriod] = useState<'monthly' | 'yearly'>((org.billing_period as 'monthly' | 'yearly') || 'monthly');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState('');

  const currentPlan = plans.find((plan) => plan.id === org.plan_id) || plans[0];
  const visitLimit = currentPlan.limits.customersPerMonth;
  const visitPercent =
    visitLimit === -1 ? 0 : Math.min(100, (org.monthly_visit_count / visitLimit) * 100);
  const isTrialing = org.subscription_status === 'trialing';
  const isPastDue = org.subscription_status === 'past_due';

  function handleUpgrade(planId: string) {
    setError('');
    startTransition(async () => {
      try {
        await createCheckoutSession(planId, period);
      } catch (caughtError: any) {
        setError(caughtError.message || 'Failed to start checkout');
      }
    });
  }

  function handleManageBilling() {
    setError('');
    startTransition(async () => {
      try {
        await createBillingPortalSession();
      } catch (caughtError: any) {
        setError(caughtError.message || 'Failed to open billing portal');
      }
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
        <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-end">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Commercial controls</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Billing and plan</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-500">
              Track plan health, usage pressure, and upgrade paths without leaving the admin workspace.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard label="Current plan" value={currentPlan.name} helper={org.subscription_status.replace('_', ' ')} />
            <MetricCard label="Monthly visits" value={org.monthly_visit_count.toLocaleString()} helper={visitLimit === -1 ? 'Unlimited allowance' : `${visitLimit.toLocaleString()} included`} />
            <MetricCard label="Invoices" value={invoices.length.toString()} helper="Recent billing records" />
          </div>
        </div>
      </section>

      {error ? (
        <div className="flex items-center gap-2 rounded-[24px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : null}

      {isPastDue ? (
        <div className="flex items-center gap-3 rounded-[24px] border border-rose-200 bg-rose-50 px-4 py-4">
          <AlertTriangle className="h-4 w-4 text-rose-600" />
          <p className="text-sm text-rose-700">Your last payment failed. Update billing details to avoid service interruption.</p>
          <button type="button" onClick={handleManageBilling} className="ml-auto text-sm font-semibold text-rose-800">
            Update payment
          </button>
        </div>
      ) : null}

      {isTrialing && org.trial_ends_at ? (
        <div className="flex items-center gap-3 rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-4">
          <Clock className="h-4 w-4 text-amber-600" />
          <p className="text-sm text-amber-700">Your trial ends on {new Date(org.trial_ends_at).toLocaleDateString()}.</p>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Current plan</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-950">{currentPlan.name}</h2>
              {currentPlan.price > 0 ? (
                <p className="mt-1 text-sm text-slate-500">
                  ${org.billing_period === 'yearly' ? currentPlan.yearlyPrice : currentPlan.price}/month
                  {org.billing_period === 'yearly' ? ' billed yearly' : ''}
                </p>
              ) : (
                <p className="mt-1 text-sm text-slate-500">No paid subscription currently attached.</p>
              )}
            </div>

            {org.stripe_customer_id ? (
              <button
                type="button"
                onClick={handleManageBilling}
                disabled={isPending}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-[#fbfaf8] px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 disabled:opacity-50"
              >
                <CreditCard className="h-4 w-4" />
                Manage billing
                <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>

          <div className="mt-6 rounded-[24px] border border-slate-200 bg-[#fbfaf8] p-5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">Monthly visits</span>
              <span className="font-semibold text-slate-950">
                {org.monthly_visit_count.toLocaleString()}
                {visitLimit !== -1 ? ` / ${visitLimit.toLocaleString()}` : ' / unlimited'}
              </span>
            </div>
            {visitLimit !== -1 ? (
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full transition-all ${visitPercent > 90 ? 'bg-rose-500' : visitPercent > 75 ? 'bg-amber-500' : 'bg-[#10292f]'}`}
                  style={{ width: `${visitPercent}%` }}
                />
              </div>
            ) : null}
          </div>

          <div className="mt-5 grid grid-cols-3 gap-3">
            <SmallStat label="Locations" value={currentPlan.limits.locations === -1 ? '∞' : String(currentPlan.limits.locations)} />
            <SmallStat label="Staff" value={currentPlan.limits.staff === -1 ? '∞' : String(currentPlan.limits.staff)} />
            <SmallStat label="Visits/mo" value={currentPlan.limits.customersPerMonth === -1 ? '∞' : currentPlan.limits.customersPerMonth.toLocaleString()} />
          </div>
        </section>

        {org.plan_id !== 'enterprise' ? (
          <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Upgrade path</p>
                <h2 className="mt-2 text-xl font-semibold text-slate-950">Move to the right plan</h2>
              </div>
              <div className="inline-flex rounded-full border border-slate-200 bg-[#fbfaf8] p-1">
                <button
                  type="button"
                  onClick={() => setPeriod('monthly')}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${period === 'monthly' ? 'bg-[#10292f] text-white' : 'text-slate-500'}`}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  onClick={() => setPeriod('yearly')}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${period === 'yearly' ? 'bg-[#10292f] text-white' : 'text-slate-500'}`}
                >
                  Yearly
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {plans
                .filter((plan) => plan.id !== 'free')
                .map((plan) => {
                  const isCurrent = plan.id === org.plan_id;
                  const price = period === 'yearly' ? plan.yearlyPrice : plan.price;

                  return (
                    <article
                      key={plan.id}
                      className={`rounded-[24px] border px-4 py-4 ${isCurrent ? 'border-[#10292f] bg-[#f6f7f4]' : 'border-slate-200 bg-[#fbfaf8]'}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-950">{plan.name}</p>
                          <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">${price}<span className="text-sm font-medium text-slate-500">/mo</span></p>
                          <p className="mt-1 text-xs text-slate-500">{plan.description}</p>
                        </div>
                        {isCurrent ? (
                          <span className="rounded-full bg-slate-950 px-2.5 py-1 text-[11px] font-semibold text-white">Current</span>
                        ) : null}
                      </div>

                      <ul className="mt-4 space-y-2">
                        {plan.features.slice(0, 4).map((feature) => (
                          <li key={feature} className="flex items-start gap-2 text-sm text-slate-600">
                            <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                            {feature}
                          </li>
                        ))}
                      </ul>

                      <button
                        type="button"
                        onClick={() => !isCurrent && handleUpgrade(plan.id)}
                        disabled={isCurrent || isPending}
                        className={`mt-4 w-full rounded-full px-4 py-2.5 text-sm font-semibold transition ${
                          isCurrent ? 'bg-slate-200 text-slate-500' : 'bg-[#10292f] text-white hover:bg-[#173740] disabled:opacity-50'
                        }`}
                      >
                        {isCurrent ? 'Current plan' : plan.cta}
                      </button>
                    </article>
                  );
                })}
            </div>
          </section>
        ) : null}
      </div>

      {invoices.length > 0 ? (
        <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Invoices</p>
          <div className="mt-4 space-y-3">
            {invoices.map((invoice) => (
              <div key={invoice.id} className="flex flex-col gap-3 rounded-[22px] border border-slate-200 bg-[#fbfaf8] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <FileText className="h-4 w-4 text-slate-400" />
                  <div>
                    <p className="text-sm font-semibold text-slate-950">
                      ${(invoice.amount_cents / 100).toFixed(2)} {invoice.currency.toUpperCase()}
                    </p>
                    <p className="text-xs text-slate-500">{new Date(invoice.created_at).toLocaleDateString()}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${invoice.status === 'paid' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                    {invoice.status}
                  </span>
                  {invoice.invoice_url ? (
                    <a
                      href={invoice.invoice_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-semibold text-slate-700"
                    >
                      View
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
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

function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[22px] border border-slate-200 bg-white px-4 py-4 text-center">
      <p className="text-lg font-semibold text-slate-950">{value}</p>
      <p className="mt-1 text-xs uppercase tracking-[0.14em] text-slate-400">{label}</p>
    </div>
  );
}
