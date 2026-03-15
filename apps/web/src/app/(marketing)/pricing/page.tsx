'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, Check, Minus, Sparkles, Workflow } from 'lucide-react';
import { Sora } from 'next/font/google';
import { plans, featureComparison } from '@/lib/data/pricing';

const display = Sora({
  subsets: ['latin'],
});

const faq = [
  {
    q: 'Can we start with one location and expand later?',
    a: 'Yes. Every plan is designed to let you launch one workspace first, then add more locations, staff, and channels as the operation grows.',
  },
  {
    q: 'Do appointments and walk-ins live in the same workflow?',
    a: 'Growth and above support scheduled bookings alongside live arrivals so teams do not have to operate separate systems.',
  },
  {
    q: 'Is there a free plan for testing the setup?',
    a: 'Yes. The free plan is built for proving the workflow, running one location, and getting the customer journey right before upgrading.',
  },
  {
    q: 'What happens when we outgrow the monthly visit limit?',
    a: 'You can upgrade at any time. The higher tiers expand visit volume, locations, staff seats, and the platform controls available to owners.',
  },
  {
    q: 'Do you support branded customer updates?',
    a: 'Yes. Paid plans add email delivery, branded pages, and deeper customer-facing customization as you move up the stack.',
  },
  {
    q: 'Can larger organizations get rollout help?',
    a: 'Yes. Enterprise includes onboarding support, custom integrations, procurement-friendly terms, and a dedicated point of contact.',
  },
];

export default function PricingPage() {
  const [yearly, setYearly] = useState(false);

  return (
    <div className="bg-[#f6f1ea] text-slate-900">
      <section className="border-b border-black/5 bg-[radial-gradient(circle_at_top_left,_rgba(255,241,226,0.95),_rgba(246,241,234,0)_38%),radial-gradient(circle_at_right,_rgba(199,232,223,0.7),_rgba(246,241,234,0)_36%),linear-gradient(180deg,_#f8f4ee_0%,_#f6f1ea_100%)]">
        <div className="mx-auto max-w-7xl px-6 py-18 md:py-24">
          <div className="mx-auto max-w-4xl text-center">
            <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-slate-400">Pricing</p>
            <h1 className={`${display.className} mt-4 text-[clamp(2.4rem,5vw,4.8rem)] leading-[0.98] tracking-[-0.055em] text-[#101717]`}>
              Pricing for the full customer-flow stack, from first location to multi-site rollout.
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-[16px] leading-7 text-slate-600">
              Start with one workspace, one command center, and the intake paths you need now. Expand into bookings,
              branded journeys, automation, and platform controls when the business is ready.
            </p>
          </div>

          <div className="mx-auto mt-10 inline-flex w-full items-center justify-center">
            <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/85 p-1 shadow-[0_16px_30px_rgba(20,27,26,0.06)]">
              <button
                type="button"
                onClick={() => setYearly(false)}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                  !yearly ? 'bg-[#10292f] text-white' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                Monthly
              </button>
              <button
                type="button"
                onClick={() => setYearly(true)}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                  yearly ? 'bg-[#10292f] text-white' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                Yearly
              </button>
              <span className="rounded-full bg-[#f0f6f5] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#10292f]">
                Save 20%
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-6 py-18 md:py-22">
          <div className="grid gap-4 xl:grid-cols-5">
            {plans.map((plan) => (
              <div
                key={plan.id}
                className={`flex h-full flex-col rounded-[30px] border p-6 shadow-[0_14px_30px_rgba(20,27,26,0.04)] ${
                  plan.highlight
                    ? 'border-[#10292f] bg-[#10292f] text-white'
                    : 'border-slate-200 bg-[#fbfaf8]'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold">{plan.name}</p>
                    <p className={`mt-2 text-sm leading-6 ${plan.highlight ? 'text-white/75' : 'text-slate-600'}`}>
                      {plan.description}
                    </p>
                  </div>
                  {plan.highlight && (
                    <span className="rounded-full bg-white/12 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white">
                      Most used
                    </span>
                  )}
                </div>

                <div className="mt-6">
                  <div className="flex items-end gap-2">
                    <span className={`${display.className} text-5xl leading-none tracking-[-0.06em]`}>
                      ${yearly ? plan.yearlyPrice : plan.price}
                    </span>
                    <span className={`pb-1 text-sm ${plan.highlight ? 'text-white/60' : 'text-slate-500'}`}>/month</span>
                  </div>
                  {yearly && plan.price > 0 && (
                    <p className={`mt-2 text-xs ${plan.highlight ? 'text-white/55' : 'text-slate-400'}`}>
                      Billed yearly. Monthly equivalent shown here.
                    </p>
                  )}
                </div>

                <div className="mt-6 grid grid-cols-3 gap-2 text-center">
                  {[
                    {
                      label: 'Visits',
                      value: plan.limits.customersPerMonth === -1 ? 'Unlimited' : `${plan.limits.customersPerMonth}`,
                    },
                    {
                      label: 'Locations',
                      value: plan.limits.locations === -1 ? 'Unlimited' : `${plan.limits.locations}`,
                    },
                    {
                      label: 'Staff',
                      value: plan.limits.staff === -1 ? 'Unlimited' : `${plan.limits.staff}`,
                    },
                  ].map((limit) => (
                    <div
                      key={limit.label}
                      className={`rounded-[22px] px-3 py-3 ${
                        plan.highlight ? 'bg-white/8' : 'bg-white'
                      }`}
                    >
                      <p className="text-sm font-semibold">{limit.value}</p>
                      <p className={`mt-1 text-[11px] uppercase tracking-[0.16em] ${plan.highlight ? 'text-white/45' : 'text-slate-400'}`}>
                        {limit.label}
                      </p>
                    </div>
                  ))}
                </div>

                <Link
                  href={plan.id === 'enterprise' ? '/contact' : '/register'}
                  className={`mt-6 inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition ${
                    plan.highlight
                      ? 'bg-white text-[#10292f] hover:bg-white/90'
                      : 'bg-[#10292f] text-white hover:bg-[#18383f]'
                  }`}
                >
                  {plan.cta}
                  <ArrowRight className="h-4 w-4" />
                </Link>

                <div className="mt-6 h-px bg-black/6" />

                <ul className="mt-6 space-y-3">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-3 text-sm">
                      {feature.startsWith('Everything in') ? (
                        <>
                          <Sparkles className={`mt-0.5 h-4 w-4 shrink-0 ${plan.highlight ? 'text-white/75' : 'text-[#10292f]'}`} />
                          <span className={`${plan.highlight ? 'text-white/75' : 'text-slate-600'} italic`}>{feature}</span>
                        </>
                      ) : (
                        <>
                          <Check className={`mt-0.5 h-4 w-4 shrink-0 ${plan.highlight ? 'text-[#cfe8e2]' : 'text-emerald-600'}`} />
                          <span className={plan.highlight ? 'text-white/82' : 'text-slate-600'}>{feature}</span>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-black/5 bg-[#10292f] text-white">
        <div className="mx-auto max-w-6xl px-6 py-18 md:py-22">
          <div className="grid gap-4 md:grid-cols-3">
            {[
              {
                title: 'Shared operating model',
                description: 'Every plan keeps the same customer-flow foundation so upgrades feel additive, not disruptive.',
                icon: Workflow,
              },
              {
                title: 'Customer journey first',
                description: 'From QR join to updates and handoff, the public-facing experience stays consistent as you scale.',
                icon: Sparkles,
              },
              {
                title: 'Owner controls later',
                description: 'Advanced plans unlock multi-site visibility, custom branding, integrations, and rollout governance.',
                icon: Check,
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="rounded-[28px] border border-white/10 bg-white/5 p-6">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-[#10292f]">
                    <Icon className="h-5 w-5" />
                  </div>
                  <p className="mt-4 text-lg font-semibold text-white">{item.title}</p>
                  <p className="mt-2 text-sm leading-7 text-white/78">{item.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-6 py-18 md:py-22">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-slate-400">Comparison</p>
            <h2 className={`${display.className} mt-4 text-[clamp(2rem,4vw,3.6rem)] leading-[0.98] tracking-[-0.05em] text-[#111716]`}>
              One matrix for the whole platform.
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-[16px] leading-7 text-slate-600">
              Move up the stack when you need more capacity, more rollout control, or more channels in the customer journey.
            </p>
          </div>

          <div className="mt-10 overflow-x-auto rounded-[32px] border border-slate-200 bg-[#fbfaf8] p-4 shadow-[0_14px_30px_rgba(20,27,26,0.04)] md:p-6">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="pb-4 text-left font-semibold text-slate-500">Capability</th>
                  <th className="pb-4 text-center font-medium text-slate-500">Free</th>
                  <th className="pb-4 text-center font-medium text-slate-500">Starter</th>
                  <th className="pb-4 text-center font-semibold text-[#10292f]">Growth</th>
                  <th className="pb-4 text-center font-medium text-slate-500">Pro</th>
                  <th className="pb-4 text-center font-medium text-slate-500">Enterprise</th>
                </tr>
              </thead>
              <tbody>
                {featureComparison.map((feature) => (
                  <tr key={feature.name} className="border-b border-slate-100 last:border-b-0">
                    <td className="py-4 font-medium text-slate-700">{feature.name}</td>
                    {(['free', 'starter', 'growth', 'pro', 'enterprise'] as const).map((plan) => (
                      <td key={plan} className="py-4 text-center">
                        {feature[plan] === true ? (
                          <Check className="mx-auto h-4 w-4 text-emerald-600" />
                        ) : feature[plan] === false ? (
                          <Minus className="mx-auto h-4 w-4 text-slate-300" />
                        ) : (
                          <span className={plan === 'growth' ? 'font-semibold text-[#10292f]' : 'text-slate-500'}>
                            {feature[plan]}
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="bg-[linear-gradient(180deg,_#f6f1ea_0%,_#fff7ee_100%)]">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-18 md:grid-cols-[1.1fr_0.9fr] md:items-start md:py-22">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-slate-400">FAQ</p>
            <h2 className={`${display.className} mt-4 text-[clamp(2rem,4vw,3.4rem)] leading-[0.98] tracking-[-0.05em] text-[#111716]`}>
              Questions teams ask before they rebuild the workflow.
            </h2>
          </div>

          <div className="space-y-3">
            {faq.map((item) => (
              <details key={item.q} className="group rounded-[24px] border border-slate-200 bg-white p-6 shadow-[0_12px_24px_rgba(20,27,26,0.04)]">
                <summary className="flex cursor-pointer items-center justify-between gap-4 text-left text-base font-semibold text-slate-900">
                  {item.q}
                  <span className="text-slate-300 transition group-open:rotate-45">+</span>
                </summary>
                <p className="mt-4 text-sm leading-7 text-slate-600">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center md:py-24">
          <h2 className={`${display.className} text-[clamp(2rem,4vw,3.6rem)] leading-[0.98] tracking-[-0.05em] text-[#111716]`}>
            Launch the first workspace now. Add the rest when the team is ready.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-[16px] leading-7 text-slate-600">
            Start with one location, prove the flow, then step into automation, branded experiences, and owner-level control.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-full bg-[#10292f] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#18383f]"
            >
              Create your workspace
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
            >
              Talk to sales
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
