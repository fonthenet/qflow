'use client';

import { useState, useTransition } from 'react';
import { Save, CheckCircle2, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { updateOrganizationSettings } from '@/lib/actions/settings-actions';
import { resetBusinessSetup } from '@/lib/actions/platform-actions';

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
  templateSummary: {
    id: string;
    title: string;
    vertical: string;
    version: string;
    dashboardMode: string;
    operatingModel: string;
    branchType: string;
    enabledModules: string[];
    recommendedRoles: string[];
  };
  templateConfigured: boolean;
}

export function SettingsClient({
  organization,
  smsProviderReady,
  templateSummary,
  templateConfigured,
}: SettingsClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

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
  const [emailOtpEnabled, setEmailOtpEnabled] = useState<boolean>(
    settings.email_otp_enabled ?? false
  );
  const [emailOtpRequiredForBooking, setEmailOtpRequiredForBooking] = useState<boolean>(
    settings.email_otp_required_for_booking ?? false
  );
  const [emailOtpRequiredForBookingChanges, setEmailOtpRequiredForBookingChanges] =
    useState<boolean>(settings.email_otp_required_for_booking_changes ?? false);
  const [emailOtpCodeExpiryMinutes, setEmailOtpCodeExpiryMinutes] = useState<number>(
    settings.email_otp_code_expiry_minutes ?? 10
  );
  const [emailOtpResendCooldownSeconds, setEmailOtpResendCooldownSeconds] =
    useState<number>(settings.email_otp_resend_cooldown_seconds ?? 60);

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
          email_otp_enabled: emailOtpEnabled,
          email_otp_required_for_booking: emailOtpRequiredForBooking,
          email_otp_required_for_booking_changes: emailOtpRequiredForBookingChanges,
          email_otp_code_expiry_minutes: emailOtpCodeExpiryMinutes,
          email_otp_resend_cooldown_seconds: emailOtpResendCooldownSeconds,
          priority_alerts_sms_enabled: priorityAlertsEnabled,
          priority_alerts_sms_on_call: priorityAlertsOnCall,
          priority_alerts_sms_on_recall: priorityAlertsOnRecall,
          priority_alerts_sms_on_buzz: priorityAlertsOnBuzz,
          priority_alerts_phone_label: priorityAlertsPhoneLabel,
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
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Business Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage the important defaults for your business, customer communication, and public screens.
        </p>
      </div>

      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Business Setup</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Your current business setup controls labels, navigation, starter structure, and customer-facing defaults.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/template-governance"
              className="inline-flex items-center rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              Template Updates
            </Link>
            <Link
              href="/admin/onboarding"
              className="inline-flex items-center rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              Open Setup
            </Link>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg bg-muted/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Template</p>
            <p className="mt-1 text-sm font-medium text-foreground">{templateSummary.title}</p>
            <p className="text-xs text-muted-foreground">
              {templateSummary.vertical.replace(/_/g, ' ')} · v{templateSummary.version}
            </p>
          </div>
          <div className="rounded-lg bg-muted/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Mode</p>
            <p className="mt-1 text-sm font-medium text-foreground">
              {templateSummary.dashboardMode.replace(/_/g, ' ')}
            </p>
            <p className="text-xs text-muted-foreground">
              {templateSummary.operatingModel.replace(/_/g, ' ')}
            </p>
          </div>
          <div className="rounded-lg bg-muted/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</p>
            <p className="mt-1 text-sm font-medium text-foreground">
              {templateConfigured ? 'Applied' : 'Using defaults'}
            </p>
            <p className="text-xs text-muted-foreground">
              Branch type: {templateSummary.branchType.replace(/_/g, ' ')}
            </p>
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Enabled Modules</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {templateSummary.enabledModules.map((module) => (
              <span
                key={module}
                className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground"
              >
                {module.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Organization Settings ──────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold text-foreground">
          Business Details
        </h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Business Name
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

      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            Booking Email Verification
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Let admins decide when customers must confirm their email before a booking is accepted or changed.
          </p>
        </div>

        <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-border p-4">
          <input
            type="checkbox"
            checked={emailOtpEnabled}
            onChange={(e) => setEmailOtpEnabled(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary/50"
          />
          <div>
            <span className="text-sm font-medium text-foreground">
              Require email code for bookings
            </span>
            <p className="mt-1 text-xs text-muted-foreground">
              Send a short code by email before confirming sensitive booking actions.
            </p>
          </div>
        </label>

        <div className={`grid gap-3 sm:grid-cols-2 ${emailOtpEnabled ? '' : 'opacity-60'}`}>
          <label className="flex items-center gap-3 rounded-lg border border-border p-4 cursor-pointer">
            <input
              type="checkbox"
              checked={emailOtpRequiredForBooking}
              onChange={(e) => setEmailOtpRequiredForBooking(e.target.checked)}
              disabled={!emailOtpEnabled}
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary/50 disabled:cursor-not-allowed"
            />
            <div>
              <span className="text-sm font-medium text-foreground">Verify before new bookings</span>
              <p className="text-xs text-muted-foreground">
                Ask customers to verify their email before a booking is created.
              </p>
            </div>
          </label>

          <label className="flex items-center gap-3 rounded-lg border border-border p-4 cursor-pointer">
            <input
              type="checkbox"
              checked={emailOtpRequiredForBookingChanges}
              onChange={(e) => setEmailOtpRequiredForBookingChanges(e.target.checked)}
              disabled={!emailOtpEnabled}
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary/50 disabled:cursor-not-allowed"
            />
            <div>
              <span className="text-sm font-medium text-foreground">Verify before changes or cancellations</span>
              <p className="text-xs text-muted-foreground">
                Verify email before customers update or cancel an existing visit.
              </p>
            </div>
          </label>
        </div>

        <div className={`grid gap-4 sm:grid-cols-2 ${emailOtpEnabled ? '' : 'opacity-60'}`}>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Code Expiry (minutes)
            </label>
            <input
              type="number"
              min={1}
              max={30}
              value={emailOtpCodeExpiryMinutes}
              onChange={(e) => setEmailOtpCodeExpiryMinutes(Number(e.target.value))}
              disabled={!emailOtpEnabled}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:cursor-not-allowed"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              How long a verification code stays valid after it is sent.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Resend Cooldown (seconds)
            </label>
            <input
              type="number"
              min={15}
              max={300}
              value={emailOtpResendCooldownSeconds}
              onChange={(e) => setEmailOtpResendCooldownSeconds(Number(e.target.value))}
              disabled={!emailOtpEnabled}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:cursor-not-allowed"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              How long customers must wait before requesting another code.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              Priority Alert Backup
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
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
      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold text-foreground">
          Queue Defaults
        </h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Check-in mode
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
      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold text-foreground">
          Public Display
        </h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Default screen layout
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

      {/* ── Language Settings ──────────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold text-foreground">
          Language
        </h2>

        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-2">
            Languages customers can use
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
            Default language
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
      <div className="flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
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

      {/* ── Danger Zone ──────────────────────────────────────────────── */}
      {templateConfigured && (
        <section className="rounded-xl border border-red-200 bg-red-50/50 p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-red-700">Danger Zone</h2>
            <p className="mt-1 text-sm text-red-600/80">
              Irreversible actions that affect your entire business setup.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-red-200 bg-white p-4">
            <div>
              <p className="text-sm font-medium text-foreground">Reset Business Setup</p>
              <p className="text-xs text-muted-foreground mt-1">
                Delete all offices, departments, services, desks, tickets, and display screens.
                You will be taken back to the template selection screen to start fresh.
              </p>
            </div>
            <button
              onClick={() => setShowResetConfirm(true)}
              className="shrink-0 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
            >
              Reset Setup
            </button>
          </div>

          {showResetConfirm && (
            <div className="rounded-lg border border-red-300 bg-white p-5 space-y-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Are you absolutely sure?
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    This will permanently delete <strong>all offices</strong> and their data including
                    departments, services, desks, tickets, display screens, and priority categories.
                    Your organization name and user accounts will be preserved.
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-sm text-muted-foreground mb-1.5">
                  Type <strong className="text-foreground">RESET</strong> to confirm
                </label>
                <input
                  type="text"
                  value={resetConfirmText}
                  onChange={(e) => setResetConfirmText(e.target.value)}
                  placeholder="RESET"
                  className="w-full sm:w-64 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-red-500/50"
                />
              </div>

              {resetError && (
                <p className="text-sm text-red-600">{resetError}</p>
              )}

              <div className="flex items-center gap-3">
                <button
                  onClick={async () => {
                    setResetError(null);
                    setIsResetting(true);
                    const result = await resetBusinessSetup();
                    setIsResetting(false);
                    if (result?.error) {
                      setResetError(result.error);
                    } else {
                      router.push('/admin/onboarding');
                    }
                  }}
                  disabled={resetConfirmText !== 'RESET' || isResetting}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isResetting ? 'Resetting...' : 'Permanently Reset'}
                </button>
                <button
                  onClick={() => {
                    setShowResetConfirm(false);
                    setResetConfirmText('');
                    setResetError(null);
                  }}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
