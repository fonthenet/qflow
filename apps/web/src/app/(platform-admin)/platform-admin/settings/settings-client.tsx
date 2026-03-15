'use client';

import { CheckCircle2, Gauge, ShieldCheck, Sparkles, XCircle } from 'lucide-react';

interface Props {
  envVars: Record<string, string>;
}

const sections: { title: string; description: string; keys: string[] }[] = [
  {
    title: 'Supabase',
    description: 'Database and authentication',
    keys: ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
  },
  {
    title: 'Stripe (Billing)',
    description: 'Payment processing and subscriptions',
    keys: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
  },
  {
    title: 'Stripe Price IDs',
    description: 'Create products in Stripe Dashboard, then add price IDs to .env',
    keys: [
      'STRIPE_PRICE_STARTER_MONTHLY',
      'STRIPE_PRICE_STARTER_YEARLY',
      'STRIPE_PRICE_GROWTH_MONTHLY',
      'STRIPE_PRICE_GROWTH_YEARLY',
      'STRIPE_PRICE_PRO_MONTHLY',
      'STRIPE_PRICE_PRO_YEARLY',
      'STRIPE_PRICE_ENTERPRISE_MONTHLY',
      'STRIPE_PRICE_ENTERPRISE_YEARLY',
    ],
  },
  {
    title: 'Email (Resend)',
    description: 'Transactional email delivery',
    keys: ['RESEND_API_KEY'],
  },
  {
    title: 'SMS (Twilio)',
    description: 'SMS notifications',
    keys: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER'],
  },
  {
    title: 'Platform',
    description: 'Platform-level configuration',
    keys: ['PLATFORM_ADMIN_EMAILS'],
  },
];

export function PlatformSettingsClient({ envVars }: Props) {
  const totalSet = Object.values(envVars).filter((v) => v === 'Set').length;
  const total = Object.values(envVars).length;
  const completion = Math.round((totalSet / total) * 100);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Owner console</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Platform readiness</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-500">
              Track configuration health across auth, billing, messaging, and platform controls before you scale traffic or enable more automation.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard label="Coverage" value={`${completion}%`} helper={`${totalSet} of ${total} vars configured`} />
            <MetricCard label="Ready sections" value={sections.filter((section) => section.keys.every((key) => envVars[key] === 'Set')).length.toString()} helper="All required values present" />
            <MetricCard label="Missing values" value={(total - totalSet).toString()} helper="Need setup before full launch" />
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <div className="space-y-6">
          <div className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
            <div className="flex items-center gap-2">
              <Gauge className="h-4 w-4 text-slate-400" />
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Readiness score</p>
            </div>
            <div className="mt-5 rounded-[24px] border border-slate-200 bg-[#fbfaf8] p-5">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-4xl font-semibold tracking-tight text-slate-950">{completion}%</p>
                  <p className="mt-2 text-sm text-slate-500">Environment coverage across the platform runtime.</p>
                </div>
                <div className={`rounded-full px-3 py-1 text-xs font-semibold ${totalSet === total ? 'bg-emerald-50 text-emerald-700' : completion > 60 ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>
                  {totalSet === total ? 'Launch ready' : 'Needs follow-up'}
                </div>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full transition-all ${totalSet === total ? 'bg-emerald-500' : completion > 60 ? 'bg-amber-500' : 'bg-rose-500'}`}
                  style={{ width: `${completion}%` }}
                />
              </div>
            </div>
          </div>

          <div className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-slate-400" />
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Operator note</p>
            </div>
            <div className="mt-4 rounded-[24px] border border-sky-100 bg-sky-50 px-4 py-4">
              <p className="text-sm font-semibold text-slate-950">Environment values are still the control plane.</p>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Update <code className="rounded bg-white px-1.5 py-0.5 text-xs font-mono text-slate-700">.env.local</code> for local development or your deployment secrets for production, then restart the app to refresh this status board.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {sections.map((section) => {
            const sectionSet = section.keys.filter((key) => envVars[key] === 'Set').length;
            const allSet = sectionSet === section.keys.length;

            return (
              <section key={section.title} className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <ShieldCheck className={`h-4 w-4 ${allSet ? 'text-emerald-600' : 'text-amber-600'}`} />
                      <h2 className="text-lg font-semibold text-slate-950">{section.title}</h2>
                    </div>
                    <p className="mt-2 text-sm text-slate-500">{section.description}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${allSet ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                    {sectionSet}/{section.keys.length} configured
                  </span>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  {section.keys.map((key) => {
                    const isSet = envVars[key] === 'Set';

                    return (
                      <div key={key} className="flex items-center justify-between gap-3 rounded-[22px] border border-slate-200 bg-[#fbfaf8] px-4 py-3">
                        <code className="min-w-0 text-xs font-mono text-slate-700">{key}</code>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {isSet ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-rose-500" />}
                          <span className={`text-xs font-semibold ${isSet ? 'text-emerald-700' : 'text-rose-700'}`}>
                            {isSet ? 'Configured' : 'Missing'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
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
