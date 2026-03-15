'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { Building2, ChevronRight, MapPin, Search, Users } from 'lucide-react';
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

const PLANS = ['free', 'starter', 'growth', 'pro', 'enterprise'];
const planColors: Record<string, string> = {
  free: 'bg-slate-100 text-slate-600',
  starter: 'bg-sky-50 text-sky-700',
  growth: 'bg-emerald-50 text-emerald-700',
  pro: 'bg-amber-50 text-amber-700',
  enterprise: 'bg-rose-50 text-rose-700',
};

export function OrganizationsClient({ organizations: initial }: { organizations: Org[] }) {
  const [organizations, setOrganizations] = useState(initial);
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filtered = useMemo(
    () =>
      organizations.filter((org) => {
        const matchesSearch =
          !search ||
          org.name.toLowerCase().includes(search.toLowerCase()) ||
          org.slug.toLowerCase().includes(search.toLowerCase());
        const matchesPlan = planFilter === 'all' || (org.plan_id || 'free') === planFilter;
        return matchesSearch && matchesPlan;
      }),
    [organizations, planFilter, search]
  );

  const activeCount = organizations.filter((org) =>
    ['active', 'trialing'].includes(org.subscription_status || '')
  ).length;
  const riskCount = organizations.length - activeCount;

  function handlePlanChange(orgId: string, newPlan: string) {
    startTransition(async () => {
      await updateOrgPlan(orgId, newPlan);
      setOrganizations((prev) =>
        prev.map((org) => (org.id === orgId ? { ...org, plan_id: newPlan } : org))
      );
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Owner console</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Organizations</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-500">
              Review plan mix, subscription risk, and account footprint across every organization on the platform.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard label="Total orgs" value={organizations.length.toString()} helper="All active and inactive accounts" />
            <MetricCard label="Healthy billing" value={activeCount.toString()} helper="Active or trialing subscriptions" />
            <MetricCard label="Needs review" value={riskCount.toString()} helper="Statuses outside active or trialing" />
          </div>
        </div>
      </section>

      <section className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="relative min-w-[260px] flex-1 xl:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search organizations or slugs"
              className="w-full rounded-full border border-slate-200 bg-[#fbfaf8] py-2.5 pl-10 pr-4 text-sm text-slate-900 outline-none focus:border-slate-950/30"
            />
          </div>

          <div className="inline-flex rounded-full border border-slate-200 bg-[#fbfaf8] p-1">
            {['all', ...PLANS].map((plan) => (
              <button
                key={plan}
                type="button"
                onClick={() => setPlanFilter(plan)}
                className={`rounded-full px-4 py-2 text-sm font-semibold capitalize transition ${
                  planFilter === plan ? 'bg-slate-950 text-white' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {plan}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-4">
        {filtered.length === 0 ? (
          <div className="rounded-[30px] border border-slate-200 bg-white px-6 py-16 text-center shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
            <Building2 className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-4 text-base font-semibold text-slate-900">No organizations match this view.</p>
            <p className="mt-2 text-sm text-slate-500">Try a different search or plan filter.</p>
          </div>
        ) : (
          filtered.map((org) => (
            <article key={org.id} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
              <button
                type="button"
                onClick={() => setExpandedId(expandedId === org.id ? null : org.id)}
                className="w-full text-left"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex min-w-0 items-center gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#f6f7f4] text-base font-semibold text-slate-700">
                      {org.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-lg font-semibold text-slate-950">{org.name}</p>
                      <p className="mt-1 text-sm text-slate-500">/{org.slug}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${planColors[org.plan_id || 'free'] || planColors.free}`}>
                      {org.plan_id || 'free'}
                    </span>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      ['active', 'trialing'].includes(org.subscription_status || '')
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-amber-50 text-amber-700'
                    }`}>
                      {org.subscription_status || 'none'}
                    </span>
                    <div className="inline-flex items-center gap-1.5 text-sm text-slate-500">
                      <Users className="h-4 w-4" />
                      {org.staff_count}
                    </div>
                    <div className="inline-flex items-center gap-1.5 text-sm text-slate-500">
                      <MapPin className="h-4 w-4" />
                      {org.office_count}
                    </div>
                    <span className="text-sm font-semibold text-slate-900">
                      {(org.monthly_visit_count || 0).toLocaleString()} visits
                    </span>
                  </div>
                </div>
              </button>

              {expandedId === org.id ? (
                <div className="mt-5 grid gap-5 border-t border-slate-100 pt-5 lg:grid-cols-[1fr_auto]">
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <InfoCard label="Created" value={new Date(org.created_at).toLocaleDateString()} />
                    <InfoCard label="Billing period" value={org.billing_period || 'n/a'} />
                    <InfoCard label="Trial ends" value={org.trial_ends_at ? new Date(org.trial_ends_at).toLocaleDateString() : '—'} />
                    <InfoCard label="Stripe customer" value={org.stripe_customer_id || 'Not linked'} mono />
                  </div>

                  <div className="flex flex-col gap-3 lg:min-w-[240px]">
                    <select
                      value={org.plan_id || 'free'}
                      onChange={(event) => handlePlanChange(org.id, event.target.value)}
                      disabled={isPending}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none disabled:opacity-50"
                    >
                      {PLANS.map((plan) => (
                        <option key={plan} value={plan}>
                          {plan}
                        </option>
                      ))}
                    </select>

                    <Link
                      href={`/platform-admin/organizations/${org.id}`}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
                    >
                      Full details
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </div>
                </div>
              ) : null}
            </article>
          ))
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

function InfoCard({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-[20px] border border-slate-200 bg-[#fbfaf8] px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className={`mt-2 text-sm text-slate-900 ${mono ? 'font-mono' : 'font-medium'}`}>{value}</p>
    </div>
  );
}
