'use client';

import { AlertTriangle, ExternalLink, Globe, Info, Settings2, Sparkles } from 'lucide-react';

interface Config {
  siteName: string;
  siteDescription: string;
  contactEmail: string;
  supportUrl: string;
  twitterHandle: string;
  linkedInUrl: string;
  signupsEnabled: boolean;
  defaultPlan: string;
  trialDays: number;
  maintenanceMode: boolean;
}

const configItems: { key: keyof Config; label: string; envVar: string; description: string; type: 'text' | 'boolean' | 'number' }[] = [
  { key: 'siteName', label: 'Site Name', envVar: 'NEXT_PUBLIC_SITE_NAME', description: 'Shown in browser tab and marketing pages', type: 'text' },
  { key: 'siteDescription', label: 'Site Description', envVar: 'NEXT_PUBLIC_SITE_DESCRIPTION', description: 'Meta description for SEO', type: 'text' },
  { key: 'contactEmail', label: 'Contact Email', envVar: 'NEXT_PUBLIC_CONTACT_EMAIL', description: 'Shown on contact page', type: 'text' },
  { key: 'supportUrl', label: 'Support URL', envVar: 'NEXT_PUBLIC_SUPPORT_URL', description: 'Link to support/help center', type: 'text' },
  { key: 'twitterHandle', label: 'Twitter Handle', envVar: 'NEXT_PUBLIC_TWITTER', description: 'e.g. @queueflow', type: 'text' },
  { key: 'linkedInUrl', label: 'LinkedIn URL', envVar: 'NEXT_PUBLIC_LINKEDIN', description: 'Company LinkedIn page', type: 'text' },
  { key: 'signupsEnabled', label: 'Signups Enabled', envVar: 'SIGNUPS_ENABLED', description: 'Allow new organizations to sign up', type: 'boolean' },
  { key: 'defaultPlan', label: 'Default Plan', envVar: 'DEFAULT_PLAN', description: 'Plan assigned to new organizations', type: 'text' },
  { key: 'trialDays', label: 'Trial Days', envVar: 'TRIAL_DAYS', description: 'Number of days for free trial on paid plans', type: 'number' },
  { key: 'maintenanceMode', label: 'Maintenance Mode', envVar: 'MAINTENANCE_MODE', description: 'Show maintenance page to all visitors', type: 'boolean' },
];

export function WebsiteConfigClient({ config }: { config: Config }) {
  const toggles = configItems.filter((item) => item.type === 'boolean');
  const details = configItems.filter((item) => item.type !== 'boolean');

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Owner console</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Website and growth controls</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-500">
              Control the public site story, signup posture, and launch defaults from one operational view.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard label="Site name" value={config.siteName} helper="Current brand heading" />
            <MetricCard label="Default plan" value={config.defaultPlan} helper="Assigned at signup" />
            <MetricCard label="Trial length" value={`${config.trialDays} days`} helper="Paid-plan evaluation window" />
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <section className="space-y-6 rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
          <div className="flex items-start gap-3 rounded-[24px] border border-sky-100 bg-sky-50 px-4 py-4">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" />
            <div>
              <p className="text-sm font-semibold text-slate-950">Config source</p>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                These values come from environment variables in <code className="rounded bg-white px-1.5 py-0.5 text-xs font-mono text-slate-700">.env.local</code> or your deployment settings. Restart locally or redeploy after changes.
              </p>
            </div>
          </div>

          {config.maintenanceMode ? (
            <div className="flex items-start gap-3 rounded-[24px] border border-rose-200 bg-rose-50 px-4 py-4">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
              <div>
                <p className="text-sm font-semibold text-rose-900">Maintenance mode is on</p>
                <p className="mt-1 text-sm text-rose-700">Visitors are blocked from the public site until this flag is turned off.</p>
              </div>
            </div>
          ) : null}

          <div className="rounded-[24px] border border-slate-200 bg-[#fbfaf8] p-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-slate-400" />
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Toggle posture</p>
            </div>
            <div className="mt-4 space-y-3">
              {toggles.map((item) => {
                const enabled = Boolean(config[item.key]);
                return (
                  <div key={item.key} className="flex items-start justify-between gap-3 rounded-[20px] border border-slate-200 bg-white px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{item.label}</p>
                      <p className="mt-1 text-sm text-slate-500">{item.description}</p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                      {enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-slate-400" />
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Environment-backed details</p>
          </div>

          <div className="mt-5 space-y-3">
            {details.map((item) => {
              const value = config[item.key];
              return (
                <div key={item.key} className="rounded-[22px] border border-slate-200 bg-[#fbfaf8] px-4 py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-950">{item.label}</p>
                      <p className="mt-1 text-sm text-slate-500">{item.description}</p>
                    </div>
                    <code className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-mono text-slate-500">
                      {item.envVar}
                    </code>
                  </div>
                  <p className="mt-4 break-words text-sm font-medium text-slate-900">
                    {String(value) || <span className="italic text-slate-400">Not set</span>}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-slate-400" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Code-managed pages</p>
            <p className="mt-1 text-sm text-slate-500">The marketing pages now carry the SaaS rebuild voice. Use these entry points for quick preview checks.</p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[
            { name: 'Homepage', url: '/' },
            { name: 'Pricing', url: '/pricing' },
            { name: 'How It Works', url: '/how-it-works' },
            { name: 'Solutions', url: '/solutions' },
            { name: 'Contact', url: '/contact' },
            { name: 'Privacy Policy', url: '/privacy' },
            { name: 'Terms of Service', url: '/terms' },
          ].map((page) => (
            <a
              key={page.name}
              href={page.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center justify-between rounded-[22px] border border-slate-200 bg-[#fbfaf8] px-4 py-4 transition hover:border-slate-300 hover:bg-white"
            >
              <div>
                <p className="text-sm font-semibold text-slate-900">{page.name}</p>
                <p className="mt-1 text-xs font-mono text-slate-400">{page.url}</p>
              </div>
              <ExternalLink className="h-4 w-4 text-slate-400 transition group-hover:text-slate-700" />
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}

function MetricCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-[22px] border border-slate-200 bg-[#fbfaf8] px-4 py-4">
      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-1 text-sm text-slate-500">{helper}</p>
    </div>
  );
}
