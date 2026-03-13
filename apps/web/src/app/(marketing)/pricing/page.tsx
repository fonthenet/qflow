'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Check, ArrowRight, Minus } from 'lucide-react';
import { plans, featureComparison } from '@/lib/data/pricing';

export default function PricingPage() {
  const [yearly, setYearly] = useState(false);

  return (
    <>
      {/* Hero */}
      <section className="bg-gradient-to-br from-primary/5 via-background to-primary/10 py-20">
        <div className="mx-auto max-w-7xl px-6 text-center">
          <h1 className="text-4xl font-extrabold tracking-tight md:text-5xl">
            Simple, Transparent Pricing
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Start free. Upgrade as you grow. All plans include{' '}
            <span className="font-semibold text-primary">unlimited push notifications</span> — no per-message fees.
          </p>

          {/* Toggle */}
          <div className="mt-8 inline-flex items-center gap-3 rounded-full border border-border bg-card p-1.5">
            <button
              onClick={() => setYearly(false)}
              className={`rounded-full px-5 py-2 text-sm font-medium transition-all ${
                !yearly ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setYearly(true)}
              className={`rounded-full px-5 py-2 text-sm font-medium transition-all ${
                yearly ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Yearly
              <span className="ml-1.5 rounded-full bg-success/20 px-2 py-0.5 text-xs font-semibold text-success">
                Save 20%
              </span>
            </button>
          </div>
        </div>
      </section>

      {/* Pricing Cards */}
      <section className="py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid gap-6 lg:grid-cols-5 md:grid-cols-3">
            {plans.map((plan) => (
              <div
                key={plan.id}
                className={`relative rounded-2xl border p-6 transition-all ${
                  plan.highlight
                    ? 'border-primary bg-primary/5 shadow-xl scale-[1.02] ring-2 ring-primary/20'
                    : 'border-border bg-card hover:shadow-lg'
                }`}
              >
                {plan.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-4 py-1 text-xs font-bold text-primary-foreground">
                    Most Popular
                  </div>
                )}

                <h3 className="text-lg font-semibold">{plan.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{plan.description}</p>

                <div className="mt-4">
                  <span className="text-4xl font-extrabold">
                    ${yearly ? plan.yearlyPrice : plan.price}
                  </span>
                  <span className="text-sm text-muted-foreground">/mo</span>
                  {yearly && plan.price > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      <span className="line-through">${plan.price}/mo</span> billed yearly
                    </p>
                  )}
                </div>

                <Link
                  href={plan.id === 'enterprise' ? '/contact' : '/register'}
                  className={`mt-6 block w-full rounded-lg py-2.5 text-center text-sm font-semibold transition-all ${
                    plan.highlight
                      ? 'bg-primary text-primary-foreground shadow hover:bg-primary/90'
                      : 'border border-border bg-background hover:bg-muted'
                  }`}
                >
                  {plan.cta}
                </Link>

                <ul className="mt-6 space-y-2.5">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm">
                      {feature.startsWith('Everything in') ? (
                        <>
                          <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="text-muted-foreground italic">{feature}</span>
                        </>
                      ) : (
                        <>
                          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                          <span>{feature}</span>
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

      {/* Feature Comparison Table */}
      <section className="border-t border-border bg-muted/20 py-24">
        <div className="mx-auto max-w-7xl px-6">
          <h2 className="text-center text-3xl font-bold">Full Feature Comparison</h2>
          <p className="mt-4 text-center text-muted-foreground">
            Every feature, every plan. See exactly what you get.
          </p>

          <div className="mt-12 overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead>
                <tr className="border-b-2 border-border">
                  <th className="pb-4 text-left font-semibold">Feature</th>
                  <th className="pb-4 text-center font-semibold">Free</th>
                  <th className="pb-4 text-center font-semibold">Starter</th>
                  <th className="pb-4 text-center font-semibold text-primary">Growth</th>
                  <th className="pb-4 text-center font-semibold">Pro</th>
                  <th className="pb-4 text-center font-semibold">Enterprise</th>
                </tr>
              </thead>
              <tbody>
                {featureComparison.map((feature) => (
                  <tr key={feature.name} className="border-b border-border">
                    <td className="py-3 font-medium">{feature.name}</td>
                    {(['free', 'starter', 'growth', 'pro', 'enterprise'] as const).map((plan) => (
                      <td key={plan} className="py-3 text-center">
                        {feature[plan] === true ? (
                          <Check className="mx-auto h-4 w-4 text-success" />
                        ) : feature[plan] === false ? (
                          <Minus className="mx-auto h-4 w-4 text-muted-foreground/40" />
                        ) : (
                          <span className={plan === 'growth' ? 'font-semibold text-primary' : ''}>
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
      <section className="py-24">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-center text-3xl font-bold">Frequently Asked Questions</h2>
          <div className="mt-12 space-y-6">
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
                a: 'We use Web Push technology — the same system used by Gmail, YouTube, and other major platforms. Customers receive instant notifications on their phone browser without downloading an app. Works on Android, iOS, and desktop.',
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
              <details key={faq.q} className="group rounded-2xl border border-border bg-card">
                <summary className="flex cursor-pointer items-center justify-between p-6 text-left font-semibold">
                  {faq.q}
                  <span className="ml-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180">
                    &#9660;
                  </span>
                </summary>
                <div className="px-6 pb-6 text-sm text-muted-foreground leading-relaxed">
                  {faq.a}
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border bg-primary py-16">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-3xl font-bold text-primary-foreground">
            Start Managing Queues Today
          </h2>
          <p className="mt-3 text-primary-foreground/80">
            Free forever for up to 50 customers/month. No credit card required.
          </p>
          <Link
            href="/register"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white px-8 py-4 text-base font-semibold text-primary shadow-lg hover:shadow-xl"
          >
            Get Started Free
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </>
  );
}
