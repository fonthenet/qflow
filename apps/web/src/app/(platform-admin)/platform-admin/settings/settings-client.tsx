'use client';

import { CheckCircle2, XCircle } from 'lucide-react';

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

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Platform Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Environment configuration status. Edit your <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-mono">.env.local</code> file to update.
        </p>
      </div>

      {/* Overall Status */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900">Configuration Status</p>
            <p className="mt-0.5 text-xs text-gray-500">
              {totalSet} of {total} environment variables configured
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-gray-900">
              {Math.round((totalSet / total) * 100)}%
            </p>
          </div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100">
          <div
            className={`h-full rounded-full transition-all ${
              totalSet === total ? 'bg-emerald-500' : totalSet > total / 2 ? 'bg-amber-500' : 'bg-red-500'
            }`}
            style={{ width: `${(totalSet / total) * 100}%` }}
          />
        </div>
      </div>

      {/* Sections */}
      {sections.map((section) => {
        const sectionSet = section.keys.filter((k) => envVars[k] === 'Set').length;
        const allSet = sectionSet === section.keys.length;

        return (
          <div key={section.title} className="rounded-xl border border-gray-200 bg-white">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">{section.title}</h3>
                <p className="mt-0.5 text-xs text-gray-500">{section.description}</p>
              </div>
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                allSet ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
              }`}>
                {sectionSet}/{section.keys.length} set
              </span>
            </div>
            <div className="divide-y divide-gray-50">
              {section.keys.map((key) => {
                const isSet = envVars[key] === 'Set';
                return (
                  <div key={key} className="flex items-center justify-between px-6 py-3">
                    <code className="text-xs font-mono text-gray-700">{key}</code>
                    <div className="flex items-center gap-1.5">
                      {isSet ? (
                        <>
                          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          <span className="text-xs font-medium text-emerald-700">Configured</span>
                        </>
                      ) : (
                        <>
                          <XCircle className="h-4 w-4 text-red-400" />
                          <span className="text-xs font-medium text-red-600">Missing</span>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
