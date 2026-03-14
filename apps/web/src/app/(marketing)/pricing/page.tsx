'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Check, ArrowRight, Minus } from 'lucide-react';
import { plans, featureComparison } from '@/lib/data/pricing';

export default function PricingPage() {
  const [yearly, setYearly] = useState(false);

  return (
    <div className="bg-white">
      {/* Hero */}
      <section className="pb-16 pt-20 md:pt-28">
        <div className="mx-auto max-w-6xl px-6 text-center">
          <p className="text-[13px] font-semibold uppercase tracking-widest text-gray-400">Pricing</p>
          <h1 className="mt-3 text-4xl font-bold tracking-[-0.03em] text-gray-900 md:text-5xl">
            Simple, transparent pricing
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-7 text-gray-500">
            Start free. Upgrade as you grow. All plans include unlimited push notifications.
          </p>

          {/* Toggle */}
          <div className="mt-8 inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1">
            <button
              onClick={() => setYearly(false)}
              className={`rounded-md px-4 py-2 text-[13px] font-medium transition-all ${
                !yearly ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setYearly(true)}
              className={`rounded-md px-4 py-2 text-[13px] font-medium transition-all ${
                yearly ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              Yearly
              <span className="ml-1.5 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600">
                -20%
              </span>
            </button>
          </div>
        </div>
      </section>

      {/* Pricing Cards */}
      <section className="pb-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
            {plans.map((plan) => (
              <div
                key={plan.id}
                className={`relative rounded-2xl border p-6 transition-all ${
                  plan.highlight
                    ? 'border-gray-900 bg-white shadow-[0_4px_30px_rgba(0,0,0,0.06)] ring-1 ring-gray-900/10'
                    : 'border-gray-100 bg-white hover:border-gray-200'
                }`}
              >
                {plan.highlight && (
                  <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-gray-900 px-3 py-0.5 text-[10px] font-semibold text-white">
                    Popular
                  </div>
                )}

                <h3 className="text-sm font-semibold text-gray-900">{plan.name}</h3>
                <p className="mt-1 text-[12px] leading-5 text-gray-500">{plan.description}</p>

                <div className="mt-5">
                  <span className="text-3xl font-semibold text-gray-900">
                    ${yearly ? plan.yearlyPrice : plan.price}
                  </span>
                  <span className="text-[13px] text-gray-400">/mo</span>
                  {yearly && plan.price > 0 && (
                    <p className="mt-0.5 text-[11px] text-gray-400">
                      <span className="line-through">${plan.price}/mo</span> billed yearly
                    </p>
                  )}
                </div>

                <Link
                  href={plan.id === 'enterprise' ? '/contact' : '/register'}
                  className={`mt-5 block w-full rounded-lg py-2.5 text-center text-[13px] font-medium transition-all ${
                    plan.highlight
                      ? 'bg-gray-900 text-white hover:bg-gray-800'
                      : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {plan.cta}
                </Link>

                <ul className="mt-5 space-y-2.5">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-[12px]">
                      {feature.startsWith('Everything in') ? (
                        <>
                          <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-gray-400" />
                          <span className="italic text-gray-400">{feature}</span>
                        </>
                      ) : (
                        <>
                          <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                          <span className="text-gray-600">{feature}</span>
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

      {/* Feature Comparison */}
      <section className="border-y border-gray-100 bg-white py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-2xl font-semibold text-gray-900">Full feature comparison</h2>
          <p className="mt-2 text-center text-[13px] text-gray-500">Every feature, every plan.</p>

          <div className="mt-10 overflow-x-auto">
            <table className="w-full min-w-[700px] text-[13px]">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="pb-3 text-left font-medium text-gray-500">Feature</th>
                  <th className="pb-3 text-center font-medium text-gray-500">Free</th>
                  <th className="pb-3 text-center font-medium text-gray-500">Starter</th>
                  <th className="pb-3 text-center font-semibold text-gray-900">Growth</th>
                  <th className="pb-3 text-center font-medium text-gray-500">Pro</th>
                  <th className="pb-3 text-center font-medium text-gray-500">Enterprise</th>
                </tr>
              </thead>
              <tbody>
                {featureComparison.map((feature) => (
                  <tr key={feature.name} className="border-b border-gray-100">
                    <td className="py-3 font-medium text-gray-700">{feature.name}</td>
                    {(['free', 'starter', 'growth', 'pro', 'enterprise'] as const).map((plan) => (
                      <td key={plan} className="py-3 text-center">
                        {feature[plan] === true ? (
                          <Check className="mx-auto h-4 w-4 text-emerald-500" />
                        ) : feature[plan] === false ? (
                          <Minus className="mx-auto h-4 w-4 text-gray-200" />
                        ) : (
                          <span className={plan === 'growth' ? 'font-medium text-gray-900' : 'text-gray-500'}>
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

      {/* FAQ */}
      <section className="py-20">
        <div className="mx-auto max-w-2xl px-6">
          <h2 className="text-center text-2xl font-semibold text-gray-900">Frequently asked questions</h2>
          <div className="mt-10 space-y-3">
            {[
              {
                q: 'Is the free plan really free forever?',
                a: 'Yes. The free plan includes up to 50 customers per month, 1 location, and unlimited push notifications. No credit card required, no time limit.',
              },
              {
                q: 'What counts as a "customer"?',
                a: 'Each ticket created counts as one customer. If a customer visits twice in a month, that counts as 2 customers toward your plan limit.',
              },
              {
                q: 'How do push notifications work without SMS?',
                a: 'We use Web Push technology \u2014 the same system used by Gmail, YouTube, and other major platforms. Customers receive instant notifications on their phone browser without downloading an app.',
              },
              {
                q: 'Can I change plans anytime?',
                a: 'Yes. Upgrade or downgrade anytime. Changes take effect immediately. If you downgrade, you keep your current plan until the end of the billing period.',
              },
              {
                q: 'Do you offer discounts for nonprofits or education?',
                a: 'Yes! Contact us for special pricing for nonprofits, educational institutions, and government organizations.',
              },
              {
                q: 'What payment methods do you accept?',
                a: 'We accept all major credit cards (Visa, Mastercard, American Express) via Stripe. Enterprise customers can pay by invoice.',
              },
            ].map((faq) => (
              <details key={faq.q} className="group rounded-xl border border-gray-100 bg-white">
                <summary className="flex cursor-pointer items-center justify-between p-5 text-left text-[14px] font-medium text-gray-900">
                  {faq.q}
                  <span className="ml-4 shrink-0 text-gray-300 transition-transform group-open:rotate-180">
                    &#9660;
                  </span>
                </summary>
                <div className="px-5 pb-5 text-[13px] leading-6 text-gray-500">
                  {faq.a}
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-gray-100 bg-white py-16">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-2xl font-semibold text-gray-900">Start managing queues today</h2>
          <p className="mt-3 text-[15px] text-gray-500">
            Free forever for up to 50 customers/month. No credit card required.
          </p>
          <Link
            href="/register"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-gray-900 px-5 py-2.5 text-[14px] font-medium text-white transition hover:bg-gray-800"
          >
            Get started free
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
