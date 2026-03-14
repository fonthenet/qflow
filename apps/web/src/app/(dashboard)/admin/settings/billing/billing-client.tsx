'use client';

import { useState, useTransition } from 'react';
import { CreditCard, ArrowUpRight, Check, AlertTriangle, Clock, FileText } from 'lucide-react';
import { createCheckoutSession, createBillingPortalSession } from '@/lib/actions/billing-actions';
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
  const [period, setPeriod] = useState<'monthly' | 'yearly'>(
    (org.billing_period as 'monthly' | 'yearly') || 'monthly'
  );
  const [isPending, startTransition] = useTransition();

  const currentPlan = plans.find((p) => p.id === org.plan_id) || plans[0];
  const visitLimit = currentPlan.limits.customersPerMonth;
  const visitPercent = visitLimit === -1
    ? 0
    : Math.min(100, (org.monthly_visit_count / visitLimit) * 100);

  const isTrialing = org.subscription_status === 'trialing';
  const isPastDue = org.subscription_status === 'past_due';

  const [error, setError] = useState('');

  function handleUpgrade(planId: string) {
    setError('');
    startTransition(async () => {
      try {
        await createCheckoutSession(planId, period);
      } catch (e: any) {
        setError(e.message || 'Failed to start checkout');
      }
    });
  }

  function handleManageBilling() {
    setError('');
    startTransition(async () => {
      try {
        await createBillingPortalSession();
      } catch (e: any) {
        setError(e.message || 'Failed to open billing portal');
      }
    });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Billing & Plan</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage your subscription, view usage, and download invoices.
        </p>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Status Banners */}
      {isPastDue && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-red-600" />
          <p className="text-sm text-red-800">
            Your last payment failed. Please update your payment method to avoid service interruption.
          </p>
          <button
            onClick={handleManageBilling}
            className="ml-auto text-sm font-medium text-red-700 hover:text-red-900"
          >
            Update payment
          </button>
        </div>
      )}

      {isTrialing && org.trial_ends_at && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <Clock className="h-4 w-4 text-amber-600" />
          <p className="text-sm text-amber-800">
            Your trial ends on {new Date(org.trial_ends_at).toLocaleDateString()}.
          </p>
        </div>
      )}

      {/* Current Plan */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Current Plan</p>
            <h2 className="mt-1 text-2xl font-bold text-gray-900">{currentPlan.name}</h2>
            {currentPlan.price > 0 && (
              <p className="mt-0.5 text-sm text-gray-500">
                ${org.billing_period === 'yearly' ? currentPlan.yearlyPrice : currentPlan.price}/month
                {org.billing_period === 'yearly' && ' (billed yearly)'}
              </p>
            )}
          </div>
          {org.stripe_customer_id && (
            <button
              onClick={handleManageBilling}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
            >
              <CreditCard className="h-4 w-4" />
              Manage billing
              <ArrowUpRight className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Usage */}
        <div className="mt-6 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">Monthly visits</span>
            <span className="font-medium text-gray-900">
              {org.monthly_visit_count.toLocaleString()}
              {visitLimit !== -1 && ` / ${visitLimit.toLocaleString()}`}
              {visitLimit === -1 && ' (unlimited)'}
            </span>
          </div>
          {visitLimit !== -1 && (
            <div className="h-2 overflow-hidden rounded-full bg-gray-100">
              <div
                className={`h-full rounded-full transition-all ${
                  visitPercent > 90 ? 'bg-red-500' : visitPercent > 75 ? 'bg-amber-500' : 'bg-gray-900'
                }`}
                style={{ width: `${visitPercent}%` }}
              />
            </div>
          )}
        </div>

        {/* Plan limits summary */}
        <div className="mt-4 grid grid-cols-3 gap-4">
          <div className="rounded-lg bg-gray-50 p-3 text-center">
            <p className="text-lg font-semibold text-gray-900">
              {currentPlan.limits.locations === -1 ? '∞' : currentPlan.limits.locations}
            </p>
            <p className="text-xs text-gray-500">Locations</p>
          </div>
          <div className="rounded-lg bg-gray-50 p-3 text-center">
            <p className="text-lg font-semibold text-gray-900">
              {currentPlan.limits.staff === -1 ? '∞' : currentPlan.limits.staff}
            </p>
            <p className="text-xs text-gray-500">Staff</p>
          </div>
          <div className="rounded-lg bg-gray-50 p-3 text-center">
            <p className="text-lg font-semibold text-gray-900">
              {currentPlan.limits.customersPerMonth === -1 ? '∞' : currentPlan.limits.customersPerMonth.toLocaleString()}
            </p>
            <p className="text-xs text-gray-500">Visits/month</p>
          </div>
        </div>
      </div>

      {/* Upgrade Plans */}
      {org.plan_id !== 'enterprise' && (
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-gray-900">Upgrade your plan</h3>
            <div className="flex items-center gap-2 rounded-lg bg-gray-100 p-0.5">
              <button
                onClick={() => setPeriod('monthly')}
                className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                  period === 'monthly' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
                }`}
              >
                Monthly
              </button>
              <button
                onClick={() => setPeriod('yearly')}
                className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                  period === 'yearly' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
                }`}
              >
                Yearly <span className="text-emerald-600">-20%</span>
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {plans.filter(p => p.id !== 'free').map((plan) => {
              const isCurrent = plan.id === org.plan_id;
              const price = period === 'yearly' ? plan.yearlyPrice : plan.price;

              return (
                <div
                  key={plan.id}
                  className={`rounded-xl border p-4 ${
                    isCurrent ? 'border-gray-900 bg-gray-50' : 'border-gray-200'
                  }`}
                >
                  <h4 className="text-sm font-semibold text-gray-900">{plan.name}</h4>
                  <p className="mt-1">
                    <span className="text-2xl font-bold text-gray-900">${price}</span>
                    <span className="text-xs text-gray-500">/mo</span>
                  </p>
                  <p className="mt-1 text-[11px] text-gray-400">{plan.description}</p>

                  <ul className="mt-3 space-y-1">
                    {plan.features.slice(0, 4).map((f) => (
                      <li key={f} className="flex items-start gap-1.5 text-[11px] text-gray-600">
                        <Check className="mt-0.5 h-3 w-3 shrink-0 text-gray-400" />
                        {f}
                      </li>
                    ))}
                  </ul>

                  <button
                    onClick={() => !isCurrent && handleUpgrade(plan.id)}
                    disabled={isCurrent || isPending}
                    className={`mt-4 w-full rounded-lg px-3 py-2 text-xs font-medium transition ${
                      isCurrent
                        ? 'bg-gray-100 text-gray-400 cursor-default'
                        : 'bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50'
                    }`}
                  >
                    {isCurrent ? 'Current plan' : plan.cta}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Invoices */}
      {invoices.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h3 className="text-base font-semibold text-gray-900">Invoices</h3>
          <div className="mt-4 divide-y divide-gray-100">
            {invoices.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <FileText className="h-4 w-4 text-gray-400" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      ${(inv.amount_cents / 100).toFixed(2)} {inv.currency.toUpperCase()}
                    </p>
                    <p className="text-xs text-gray-500">
                      {new Date(inv.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    inv.status === 'paid'
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-amber-50 text-amber-700'
                  }`}>
                    {inv.status}
                  </span>
                  {inv.invoice_url && (
                    <a
                      href={inv.invoice_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-gray-600 hover:text-gray-900"
                    >
                      View
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
