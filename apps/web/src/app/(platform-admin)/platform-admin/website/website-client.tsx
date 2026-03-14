'use client';

import { Globe, AlertTriangle, Info } from 'lucide-react';

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
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Website Configuration</h1>
        <p className="mt-1 text-sm text-gray-500">
          Control your marketing site, signup behavior, and platform defaults.
        </p>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
        <div>
          <p className="text-sm font-medium text-blue-900">How to configure</p>
          <p className="mt-0.5 text-xs text-blue-700">
            These settings are controlled via environment variables in your{' '}
            <code className="rounded bg-blue-100 px-1 py-0.5 text-[10px] font-mono">.env.local</code>{' '}
            file (for local dev) or your Vercel project settings (for production).
            After changing env vars, restart the dev server or redeploy.
          </p>
        </div>
      </div>

      {config.maintenanceMode && (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
          <AlertTriangle className="h-4 w-4 text-red-600" />
          <p className="text-sm font-medium text-red-900">
            Maintenance mode is ON. Your site is not accessible to visitors.
          </p>
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="divide-y divide-gray-100">
          {configItems.map((item) => {
            const value = config[item.key];
            return (
              <div key={item.key} className="px-6 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-900">{item.label}</p>
                      {item.type === 'boolean' && (
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          value ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                        }`}>
                          {value ? 'ON' : 'OFF'}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500">{item.description}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <code className="rounded bg-gray-100 px-2 py-1 text-[10px] font-mono text-gray-600">
                      {item.envVar}
                    </code>
                    {item.type !== 'boolean' && (
                      <p className="mt-1 text-sm font-medium text-gray-900">
                        {String(value) || <span className="text-gray-300 italic">not set</span>}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Marketing Pages */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h3 className="text-sm font-semibold text-gray-900">Marketing Pages</h3>
        <p className="mt-1 text-xs text-gray-500">
          These pages are code-managed. Edit the source files to change content.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {[
            { name: 'Homepage', path: 'apps/web/src/app/(marketing)/page.tsx', url: '/' },
            { name: 'Pricing', path: 'apps/web/src/app/(marketing)/pricing/page.tsx', url: '/pricing' },
            { name: 'How It Works', path: 'apps/web/src/app/(marketing)/how-it-works/page.tsx', url: '/how-it-works' },
            { name: 'Solutions', path: 'apps/web/src/app/(marketing)/solutions/page.tsx', url: '/solutions' },
            { name: 'Contact', path: 'apps/web/src/app/(marketing)/contact/page.tsx', url: '/contact' },
            { name: 'Privacy Policy', path: 'apps/web/src/app/(marketing)/privacy/page.tsx', url: '/privacy' },
            { name: 'Terms of Service', path: 'apps/web/src/app/(marketing)/terms/page.tsx', url: '/terms' },
          ].map((page) => (
            <div key={page.name} className="flex items-center justify-between rounded-lg border border-gray-100 px-4 py-2.5">
              <div>
                <p className="text-xs font-medium text-gray-700">{page.name}</p>
                <p className="text-[10px] text-gray-400 font-mono">{page.url}</p>
              </div>
              <a
                href={page.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-gray-500 hover:text-gray-900"
              >
                View
              </a>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
