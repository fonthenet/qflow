'use client';

import { useState, useTransition } from 'react';
import { Save, CheckCircle2 } from 'lucide-react';
import { updateOrganizationSettings } from '@/lib/actions/settings-actions';

interface Organization {
  id: string;
  name: string;
  slug: string;
  logo_url?: string | null;
  settings?: Record<string, any> | null;
}

interface SettingsClientProps {
  organization: Organization;
  smsProviderReady: boolean;
}

export function SettingsClient({ organization, smsProviderReady }: SettingsClientProps) {
  const [isPending, startTransition] = useTransition();
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const settings = organization.settings ?? {};

  // Organization Settings
  const [orgName, setOrgName] = useState(organization.name);
  const [orgSlug, setOrgSlug] = useState(organization.slug);
  const [logoUrl, setLogoUrl] = useState(organization.logo_url ?? '');

  // Ticket Settings
  const [checkInMode, setCheckInMode] = useState<string>(
    settings.default_check_in_mode ?? 'manual'
  );
  const [ticketPrefix, setTicketPrefix] = useState<string>(
    settings.ticket_number_prefix ?? ''
  );
  const [autoNoShowTimeout, setAutoNoShowTimeout] = useState<number>(
    settings.auto_no_show_timeout ?? 10
  );
  const [maxQueueSize, setMaxQueueSize] = useState<number>(
    settings.max_queue_size ?? 50
  );

  // Display Settings
  const [displayLayout, setDisplayLayout] = useState<string>(
    settings.default_display_layout ?? 'list'
  );
  const [announcementSound, setAnnouncementSound] = useState<boolean>(
    settings.announcement_sound_enabled ?? true
  );
  const [refreshInterval, setRefreshInterval] = useState<number>(
    settings.display_refresh_interval ?? 5
  );

  // Language Settings
  const [supportedLanguages, setSupportedLanguages] = useState<string[]>(
    settings.supported_languages ?? ['en']
  );
  const [defaultLanguage, setDefaultLanguage] = useState<string>(
    settings.default_language ?? 'en'
  );
  const [priorityAlertsEnabled, setPriorityAlertsEnabled] = useState<boolean>(
    settings.priority_alerts_sms_enabled ?? false
  );
  const [priorityAlertsOnCall, setPriorityAlertsOnCall] = useState<boolean>(
    settings.priority_alerts_sms_on_call ?? true
  );
  const [priorityAlertsOnRecall, setPriorityAlertsOnRecall] = useState<boolean>(
    settings.priority_alerts_sms_on_recall ?? true
  );
  const [priorityAlertsOnBuzz, setPriorityAlertsOnBuzz] = useState<boolean>(
    settings.priority_alerts_sms_on_buzz ?? true
  );
  const [priorityAlertsPhoneLabel, setPriorityAlertsPhoneLabel] = useState<string>(
    settings.priority_alerts_phone_label ?? 'Mobile number'
  );

  // White-label Branding (Pro+ plans)
  const [brandPrimaryColor, setBrandPrimaryColor] = useState<string>(
    settings.brand_primary_color ?? '#111827'
  );
  const [brandAccentColor, setBrandAccentColor] = useState<string>(
    settings.brand_accent_color ?? '#22c55e'
  );
  const [brandFont, setBrandFont] = useState<string>(
    settings.brand_font ?? 'Inter'
  );
  const [brandHideQueueflow, setBrandHideQueueflow] = useState<boolean>(
    settings.brand_hide_queueflow ?? false
  );
  const [brandCustomCss, setBrandCustomCss] = useState<string>(
    settings.brand_custom_css ?? ''
  );

  const languageOptions = [
    { code: 'en', label: 'English' },
    { code: 'fr', label: 'French' },
    { code: 'ar', label: 'Arabic' },
    { code: 'es', label: 'Spanish' },
  ];

  function toggleLanguage(code: string) {
    setSupportedLanguages((prev) =>
      prev.includes(code)
        ? prev.filter((l) => l !== code)
        : [...prev, code]
    );
  }

  function handleSave() {
    setSuccessMessage(null);
    setErrorMessage(null);

    startTransition(async () => {
      const result = await updateOrganizationSettings({
        orgId: organization.id,
        name: orgName,
        slug: orgSlug,
        logo_url: logoUrl || null,
        settings: {
          default_check_in_mode: checkInMode,
          ticket_number_prefix: ticketPrefix,
          auto_no_show_timeout: autoNoShowTimeout,
          max_queue_size: maxQueueSize,
          default_display_layout: displayLayout,
          announcement_sound_enabled: announcementSound,
          display_refresh_interval: refreshInterval,
          supported_languages: supportedLanguages,
          default_language: defaultLanguage,
          priority_alerts_sms_enabled: priorityAlertsEnabled,
          priority_alerts_sms_on_call: priorityAlertsOnCall,
          priority_alerts_sms_on_recall: priorityAlertsOnRecall,
          priority_alerts_sms_on_buzz: priorityAlertsOnBuzz,
          priority_alerts_phone_label: priorityAlertsPhoneLabel,
          brand_primary_color: brandPrimaryColor,
          brand_accent_color: brandAccentColor,
          brand_font: brandFont,
          brand_hide_queueflow: brandHideQueueflow,
          brand_custom_css: brandCustomCss,
        },
      });

      if (result?.error) {
        setErrorMessage(result.error);
      } else {
        setSuccessMessage('Settings saved successfully.');
        setTimeout(() => setSuccessMessage(null), 4000);
      }
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
        <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-end">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Workspace controls</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Business settings</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-500">
              Shape how arrivals are created, how the public experience looks, and how staff get alerted across every service flow.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard label="Check-in mode" value={checkInMode.replace('_', ' ')} helper="Default arrival behavior" />
            <MetricCard label="Display layout" value={displayLayout.replace('_', ' ')} helper="Public board default" />
            <MetricCard label="Languages" value={supportedLanguages.length.toString()} helper="Enabled customer languages" />
          </div>
        </div>
      </section>

      {/* ── Organization Settings ──────────────────────────────────────── */}
      <section className="space-y-4 rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
        <h2 className="text-lg font-semibold text-slate-950">
          Organization Settings
        </h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Organization Name
            </label>
            <input
              type="text"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Slug
            </label>
            <input
              type="text"
              value={orgSlug}
              onChange={(e) => setOrgSlug(e.target.value)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Logo URL
            </label>
            <input
              type="url"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://example.com/logo.png"
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
        </div>
      </section>

      <section className="space-y-4 rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              Priority Alerts
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Keep free push notifications as the primary path, and add SMS as an optional backup for customers who choose to enter a phone number.
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              smsProviderReady
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-amber-100 text-amber-700'
            }`}
          >
            {smsProviderReady ? 'Provider Ready' : 'Provider Not Configured'}
          </span>
        </div>

        {!smsProviderReady && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            SMS is not configured in environment variables yet. You can save these settings now, but text alerts will not send until the provider credentials are added.
          </div>
        )}

        <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-border p-4">
          <input
            type="checkbox"
            checked={priorityAlertsEnabled}
            onChange={(e) => setPriorityAlertsEnabled(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary/50"
          />
          <div>
            <span className="text-sm font-medium text-foreground">
              Enable SMS backup alerts
            </span>
            <p className="text-xs text-muted-foreground mt-1">
              Customers can add a mobile number on their queue page to receive a text backup for urgent queue events.
            </p>
          </div>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Phone Field Label
            </label>
            <input
              type="text"
              value={priorityAlertsPhoneLabel}
              onChange={(e) => setPriorityAlertsPhoneLabel(e.target.value)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="Mobile number"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Shown on the customer queue page when they add a text-alert number.
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex items-center gap-3 rounded-lg border border-border p-4 cursor-pointer">
            <input
              type="checkbox"
              checked={priorityAlertsOnCall}
              onChange={(e) => setPriorityAlertsOnCall(e.target.checked)}
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary/50"
            />
            <div>
              <span className="text-sm font-medium text-foreground">On Call</span>
              <p className="text-xs text-muted-foreground">Send when the ticket is first called.</p>
            </div>
          </label>

          <label className="flex items-center gap-3 rounded-lg border border-border p-4 cursor-pointer">
            <input
              type="checkbox"
              checked={priorityAlertsOnRecall}
              onChange={(e) => setPriorityAlertsOnRecall(e.target.checked)}
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary/50"
            />
            <div>
              <span className="text-sm font-medium text-foreground">On Recall</span>
              <p className="text-xs text-muted-foreground">Send reminder texts on recall.</p>
            </div>
          </label>

          <label className="flex items-center gap-3 rounded-lg border border-border p-4 cursor-pointer">
            <input
              type="checkbox"
              checked={priorityAlertsOnBuzz}
              onChange={(e) => setPriorityAlertsOnBuzz(e.target.checked)}
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary/50"
            />
            <div>
              <span className="text-sm font-medium text-foreground">On Buzz</span>
              <p className="text-xs text-muted-foreground">Send a stronger “staff is trying to reach you” text.</p>
            </div>
          </label>
        </div>
      </section>

      {/* ── Ticket Settings ────────────────────────────────────────────── */}
      <section className="space-y-4 rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
        <h2 className="text-lg font-semibold text-slate-950">
          Ticket Settings
        </h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Default Check-in Mode
            </label>
            <select
              value={checkInMode}
              onChange={(e) => setCheckInMode(e.target.value)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="self_service">Self Service</option>
              <option value="manual">Manual</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Ticket Number Prefix
            </label>
            <input
              type="text"
              value={ticketPrefix}
              onChange={(e) => setTicketPrefix(e.target.value)}
              placeholder="e.g. TK-"
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Auto No-Show Timeout (minutes)
            </label>
            <input
              type="number"
              min={1}
              max={60}
              value={autoNoShowTimeout}
              onChange={(e) => setAutoNoShowTimeout(Number(e.target.value))}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Mark ticket as no-show if customer doesn&apos;t arrive within this time after being called.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Max Queue Size per Department
            </label>
            <input
              type="number"
              min={1}
              max={500}
              value={maxQueueSize}
              onChange={(e) => setMaxQueueSize(Number(e.target.value))}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Stop accepting tickets when department queue reaches this limit.
            </p>
          </div>
        </div>
      </section>

      {/* ── Display Settings ───────────────────────────────────────────── */}
      <section className="space-y-4 rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
        <h2 className="text-lg font-semibold text-slate-950">
          Display Settings
        </h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Default Display Layout
            </label>
            <select
              value={displayLayout}
              onChange={(e) => setDisplayLayout(e.target.value)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="list">List</option>
              <option value="grid">Grid</option>
              <option value="department_split">Department Split</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Display Refresh Interval (seconds)
            </label>
            <input
              type="number"
              min={1}
              max={60}
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(Number(e.target.value))}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={announcementSound}
                onChange={(e) => setAnnouncementSound(e.target.checked)}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary/50"
              />
              <div>
                <span className="text-sm font-medium text-foreground">
                  Announcement Sound
                </span>
                <p className="text-xs text-muted-foreground">
                  Play a sound when a ticket number is called on the display
                  screen.
                </p>
              </div>
            </label>
          </div>
        </div>
      </section>

      {/* ── White-label Branding ─────────────────────────────────────── */}
      <section className="space-y-4 rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">
            Branding
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Customize the look of public-facing pages (queue status, kiosk, display screens). Available on Pro plans and above.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Primary Color
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={brandPrimaryColor}
                onChange={(e) => setBrandPrimaryColor(e.target.value)}
                className="h-9 w-9 cursor-pointer rounded border border-border"
              />
              <input
                type="text"
                value={brandPrimaryColor}
                onChange={(e) => setBrandPrimaryColor(e.target.value)}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Accent Color
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={brandAccentColor}
                onChange={(e) => setBrandAccentColor(e.target.value)}
                className="h-9 w-9 cursor-pointer rounded border border-border"
              />
              <input
                type="text"
                value={brandAccentColor}
                onChange={(e) => setBrandAccentColor(e.target.value)}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Font Family
            </label>
            <select
              value={brandFont}
              onChange={(e) => setBrandFont(e.target.value)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="Inter">Inter (Default)</option>
              <option value="system-ui">System UI</option>
              <option value="Georgia">Georgia (Serif)</option>
              <option value="Roboto">Roboto</option>
              <option value="Poppins">Poppins</option>
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={brandHideQueueflow}
                onChange={(e) => setBrandHideQueueflow(e.target.checked)}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary/50"
              />
              <div>
                <span className="text-sm font-medium text-foreground">
                  Hide &quot;Powered by QueueFlow&quot;
                </span>
                <p className="text-xs text-muted-foreground">
                  Remove QueueFlow branding from public pages.
                </p>
              </div>
            </label>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">
            Custom CSS (advanced)
          </label>
          <textarea
            value={brandCustomCss}
            onChange={(e) => setBrandCustomCss(e.target.value)}
            rows={4}
            placeholder={".queue-page { background: #f0f0f0; }"}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Applied to queue status, kiosk, and display screen pages.
          </p>
        </div>
      </section>

      {/* ── Language Settings ──────────────────────────────────────────── */}
      <section className="space-y-4 rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
        <h2 className="text-lg font-semibold text-slate-950">
          Language Settings
        </h2>

        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-2">
            Supported Languages
          </label>
          <div className="flex flex-wrap gap-3">
            {languageOptions.map((lang) => (
              <label
                key={lang.code}
                className="flex items-center gap-2 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={supportedLanguages.includes(lang.code)}
                  onChange={() => toggleLanguage(lang.code)}
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary/50"
                />
                <span className="text-sm text-foreground">{lang.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">
            Default Language
          </label>
          <select
            value={defaultLanguage}
            onChange={(e) => setDefaultLanguage(e.target.value)}
            className="w-full sm:w-64 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            {languageOptions
              .filter((l) => supportedLanguages.includes(l.code))
              .map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
          </select>
        </div>
      </section>

      {/* ── Save Button ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-4 rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
        <button
          onClick={handleSave}
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-full bg-[#10292f] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#173740] disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {isPending ? 'Saving...' : 'Save Settings'}
        </button>

        {successMessage && (
          <span className="inline-flex items-center gap-1 text-sm text-green-600">
            <CheckCircle2 className="h-4 w-4" />
            {successMessage}
          </span>
        )}

        {errorMessage && (
          <span className="text-sm text-red-600">{errorMessage}</span>
        )}
      </div>
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
