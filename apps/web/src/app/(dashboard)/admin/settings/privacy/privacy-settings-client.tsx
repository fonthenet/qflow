'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { updateDpoContact } from '@/lib/actions/privacy-actions';
import { useI18n } from '@/components/providers/locale-provider';

const SUB_PROCESSORS = [
  {
    name: 'Supabase (AWS)',
    purpose: 'Database hosting, authentication, real-time subscriptions',
    location: 'EU (eu-central-1) / US (us-east-1)',
    dpa: 'https://supabase.com/privacy',
  },
  {
    name: 'Vercel',
    purpose: 'Web application hosting, edge functions',
    location: 'Global edge network',
    dpa: 'https://vercel.com/legal/privacy-policy',
  },
  {
    name: 'Meta Platforms',
    purpose: 'WhatsApp Business API, Facebook Messenger',
    location: 'Ireland (EU) / US',
    dpa: 'https://www.facebook.com/legal/terms/dataprocessing',
  },
  {
    name: 'Stripe',
    purpose: 'Payment processing (where applicable)',
    location: 'US / EU',
    dpa: 'https://stripe.com/privacy',
  },
];

interface PrivacySettingsClientProps {
  orgId: string;
  orgCountry: string | null;
  dpoEmail: string;
}

export function PrivacySettingsClient({ orgId, orgCountry, dpoEmail }: PrivacySettingsClientProps) {
  const { t } = useI18n();
  const [email, setEmail] = useState(dpoEmail);
  const [savedEmail, setSavedEmail] = useState(dpoEmail);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState('');
  const [isPending, startTransition] = useTransition();

  // Toast state for export stub
  const [exportToast, setExportToast] = useState(false);

  function handleSaveDpo() {
    setSaveStatus('idle');
    setSaveError('');
    startTransition(async () => {
      const result = await updateDpoContact(orgId, email);
      if (result.error) {
        setSaveStatus('error');
        setSaveError(result.error);
      } else {
        setSavedEmail(email);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 3000);
      }
    });
  }

  function handleExportData() {
    // TODO: Implement data export when the export pipeline is built.
    setExportToast(true);
    setTimeout(() => setExportToast(false), 3000);
  }

  const policyUrl = orgCountry
    ? `/privacy?country=${orgCountry.toLowerCase()}`
    : '/privacy';

  return (
    <div className="space-y-8 max-w-2xl">

      {/* ── Privacy Policy ── */}
      <div className="rounded-lg border border-border bg-background p-6">
        <h2 className="text-base font-semibold text-foreground">Privacy Policy</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The effective privacy policy for your organization
          {orgCountry ? ` (${orgCountry})` : ''}.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <a
            href={policyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
          >
            View Privacy Policy
          </a>
          <a
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary underline self-center"
          >
            View global policy
          </a>
        </div>
        <p className="mt-3 text-xs text-muted-foreground italic">
          Country-specific rights sections are rendered dynamically based on visitor IP.
          As an admin, you see the global version above.
        </p>
      </div>

      {/* ── DPO Contact ── */}
      <div className="rounded-lg border border-border bg-background p-6">
        <h2 className="text-base font-semibold text-foreground">Data Protection Officer (DPO) Contact</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure the DPO email shown to data subjects making privacy requests for your organization.
          If blank, requests are routed to the Qflo platform default (<code>privacy@qflo.app</code>).
        </p>
        <div className="mt-4 space-y-3">
          <div>
            <label htmlFor="dpo-email" className="block text-sm font-medium text-foreground">
              DPO email address
            </label>
            <input
              id="dpo-email"
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setSaveStatus('idle'); }}
              placeholder="dpo@yourcompany.com"
              className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              style={{ colorScheme: 'light dark' }}
              disabled={isPending}
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSaveDpo}
              disabled={isPending || email === savedEmail}
              className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
            >
              {isPending ? 'Saving...' : 'Save'}
            </button>
            {saveStatus === 'saved' && (
              <span className="text-sm text-green-600 dark:text-green-400">Saved</span>
            )}
            {saveStatus === 'error' && (
              <span className="text-sm text-destructive">{saveError}</span>
            )}
          </div>
        </div>
      </div>

      {/* ── DPA Download ── */}
      <div className="rounded-lg border border-border bg-background p-6">
        <h2 className="text-base font-semibold text-foreground">Data Processing Agreement (DPA)</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Download Qflo&apos;s standard DPA template (GDPR Art. 28 compliant) to execute with your legal team.
          The template includes sub-processor list, SCCs reference, and security measures.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <a
            href="/api/compliance/dpa"
            download="qflo-data-processing-agreement.md"
            className="inline-flex items-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
          >
            Download DPA (Markdown)
          </a>
        </div>
        <p className="mt-3 text-xs text-muted-foreground italic">
          Lawyer review required before signing. Fill in [CUSTOMER NAME], [CUSTOMER COUNTRY],
          [EFFECTIVE DATE], and [DPO CONTACT] placeholders.
        </p>
      </div>

      {/* ── Sub-processors ── */}
      <div className="rounded-lg border border-border bg-background p-6">
        <h2 className="text-base font-semibold text-foreground">Active Sub-processors</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Third-party services that process personal data on Qflo&apos;s behalf.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-foreground">
                <th className="pb-2 pr-4 font-semibold">Provider</th>
                <th className="pb-2 pr-4 font-semibold">Purpose</th>
                <th className="pb-2 pr-4 font-semibold">Location</th>
                <th className="pb-2 font-semibold">Privacy</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {SUB_PROCESSORS.map((sp) => (
                <tr key={sp.name}>
                  <td className="py-2 pr-4 align-top font-medium text-foreground">{sp.name}</td>
                  <td className="py-2 pr-4 align-top text-muted-foreground">{sp.purpose}</td>
                  <td className="py-2 pr-4 align-top text-muted-foreground">{sp.location}</td>
                  <td className="py-2 align-top">
                    <a
                      href={sp.dpa}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline"
                    >
                      Policy
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground italic">
          Qflo will notify you at least 30 days before adding or replacing sub-processors,
          per the DPA terms.
        </p>
      </div>

      {/* ── Data Export ── */}
      <div className="rounded-lg border border-border bg-background p-6">
        <h2 className="text-base font-semibold text-foreground">Data Export</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Export all personal data associated with your organization in a machine-readable format
          (JSON / CSV). Use this to fulfil data portability requests or subject access requests.
        </p>
        <div className="mt-4 relative">
          <button
            type="button"
            onClick={handleExportData}
            className="inline-flex items-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 opacity-60 cursor-not-allowed"
            title="Coming soon"
          >
            Export organization data
          </button>
          {exportToast && (
            <div className="absolute left-0 top-12 z-10 rounded-md border border-border bg-background px-4 py-2 text-sm shadow-lg">
              Coming soon — data export pipeline is in progress.
            </div>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground italic">
          {/* TODO: implement data export endpoint — see compliance register for ticket */}
          This feature is scaffolded. The export pipeline will be built in a future sprint.
        </p>
      </div>

      {/* ── Country Addendums ── */}
      <div className="rounded-lg border border-border bg-background p-6">
        <h2 className="text-base font-semibold text-foreground">Regulatory Addendums</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Country-specific data protection obligations. Intended for your legal and compliance team.
        </p>
        <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
          {[
            { code: 'DZ', label: 'Algeria — Loi 18-07' },
            { code: 'MA', label: 'Morocco — Loi 09-08' },
            { code: 'TN', label: 'Tunisia — Loi 2004-63' },
            { code: 'FR', label: 'France — GDPR + CNIL' },
            { code: 'EG', label: 'Egypt — Law 151/2020' },
            { code: 'AE', label: 'UAE — PDPL 2021' },
            { code: 'SA', label: 'Saudi Arabia — PDPL' },
            { code: 'IN', label: 'India — DPDP Act 2023' },
            { code: 'SN', label: 'Senegal — Loi 2008-12' },
            { code: 'CI', label: "Côte d'Ivoire — Loi 2013-450" },
            { code: 'NG', label: 'Nigeria — NDPA 2023' },
            { code: 'KE', label: 'Kenya — DPA 2019' },
            { code: 'US', label: 'United States — CCPA/CPRA' },
          ].map((c) => (
            <li key={c.code} className={orgCountry?.toUpperCase() === c.code ? 'font-semibold text-foreground' : ''}>
              {c.label}
              {orgCountry?.toUpperCase() === c.code && (
                <span className="ml-2 inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  Your country
                </span>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground italic">
          Full addendum documents are available in the Qflo repository at{' '}
          <code>docs/legal/addendums/</code>.
        </p>
      </div>

      {/* ── Cookie Preferences ── */}
      <div className="rounded-lg border border-border bg-background p-6">
        <h2 className="text-base font-semibold text-foreground">Cookie Preferences</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The cookie banner is shown to visitors on the public marketing site.
          The admin dashboard only uses strictly necessary cookies (Supabase auth session).
          No analytics cookies are set in authenticated-only contexts.
        </p>
        <Link
          href="/privacy#cookies"
          className="mt-3 inline-block text-sm text-primary underline"
        >
          Cookie policy details
        </Link>
      </div>

    </div>
  );
}
