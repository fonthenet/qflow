'use client';

import { useState, useTransition } from 'react';
import {
  AlertTriangle,
  Bell,
  CalendarDays,
  CheckCircle2,
  Globe,
  Layers,
  Mail,
  Monitor,
  Save,
  Settings,
  Ticket,
} from 'lucide-react';
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

function SectionCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-border/60 bg-card shadow-sm ${className}`}>
      {children}
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ElementType;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </label>
  );
}

function FieldHint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-xs text-muted-foreground">{children}</p>;
}

const inputClass =
  'w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 disabled:cursor-not-allowed disabled:opacity-60 transition-all';
const selectClass = inputClass;
const checkboxCardClass =
  'flex items-start gap-3 cursor-pointer rounded-xl border border-border p-4 hover:border-border/80 transition-colors';

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
  const [checkInMode, setCheckInMode] = useState<string>(settings.default_check_in_mode ?? 'manual');
  const [ticketPrefix, setTicketPrefix] = useState<string>(settings.ticket_number_prefix ?? '');
  const [autoNoShowTimeout, setAutoNoShowTimeout] = useState<number>(settings.auto_no_show_timeout ?? 10);
  const [maxQueueSize, setMaxQueueSize] = useState<number>(settings.max_queue_size ?? 50);

  // Display Settings
  const [displayLayout, setDisplayLayout] = useState<string>(settings.default_display_layout ?? 'list');
  const [announcementSound, setAnnouncementSound] = useState<boolean>(settings.announcement_sound_enabled ?? true);
  const [refreshInterval, setRefreshInterval] = useState<number>(settings.display_refresh_interval ?? 5);

  // Language Settings
  const [supportedLanguages, setSupportedLanguages] = useState<string[]>(settings.supported_languages ?? ['en']);
  const [defaultLanguage, setDefaultLanguage] = useState<string>(settings.default_language ?? 'en');

  // SMS
  const [priorityAlertsEnabled, setPriorityAlertsEnabled] = useState<boolean>(settings.priority_alerts_sms_enabled ?? false);
  const [priorityAlertsOnCall, setPriorityAlertsOnCall] = useState<boolean>(settings.priority_alerts_sms_on_call ?? true);
  const [priorityAlertsOnRecall, setPriorityAlertsOnRecall] = useState<boolean>(settings.priority_alerts_sms_on_recall ?? true);
  const [priorityAlertsOnBuzz, setPriorityAlertsOnBuzz] = useState<boolean>(settings.priority_alerts_sms_on_buzz ?? true);
  const [priorityAlertsPhoneLabel, setPriorityAlertsPhoneLabel] = useState<string>(settings.priority_alerts_phone_label ?? 'Mobile number');

  // Booking & Scheduling
  const [bookingMode, setBookingMode] = useState<string>(settings.booking_mode ?? 'simple');
  const [bookingHorizonDays, setBookingHorizonDays] = useState<number>(settings.booking_horizon_days ?? 7);
  const [slotDurationMinutes, setSlotDurationMinutes] = useState<number>(settings.slot_duration_minutes ?? 30);
  const [slotsPerInterval, setSlotsPerInterval] = useState<number>(settings.slots_per_interval ?? 1);
  const [allowCancellation, setAllowCancellation] = useState<boolean>(settings.allow_cancellation ?? false);

  // Email OTP
  const [emailOtpEnabled, setEmailOtpEnabled] = useState<boolean>(settings.email_otp_enabled ?? false);
  const [emailOtpRequiredForBooking, setEmailOtpRequiredForBooking] = useState<boolean>(settings.email_otp_required_for_booking ?? false);
  const [emailOtpRequiredForBookingChanges, setEmailOtpRequiredForBookingChanges] = useState<boolean>(settings.email_otp_required_for_booking_changes ?? false);
  const [emailOtpCodeExpiryMinutes, setEmailOtpCodeExpiryMinutes] = useState<number>(settings.email_otp_code_expiry_minutes ?? 10);
  const [emailOtpResendCooldownSeconds, setEmailOtpResendCooldownSeconds] = useState<number>(settings.email_otp_resend_cooldown_seconds ?? 60);

  const languageOptions = [
    { code: 'en', label: 'English' },
    { code: 'fr', label: 'French' },
    { code: 'ar', label: 'Arabic' },
    { code: 'es', label: 'Spanish' },
  ];

  function toggleLanguage(code: string) {
    setSupportedLanguages((prev) =>
      prev.includes(code) ? prev.filter((l) => l !== code) : [...prev, code]
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
          booking_mode: bookingMode,
          booking_horizon_days: bookingHorizonDays,
          slot_duration_minutes: slotDurationMinutes,
          slots_per_interval: slotsPerInterval,
          allow_cancellation: allowCancellation,
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
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Business Settings</h1>
        <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
          Manage defaults for your business, customer communication, and public screens.
        </p>
      </div>

      <div className="space-y-6">
        {/* ── Business Setup Summary ─────────────────────────────────── */}
        <SectionCard>
          <SectionHeader
            icon={Layers}
            title="Business Setup"
            description="Your current template controls labels, navigation, and customer-facing defaults."
            action={
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/admin/template-governance"
                  className="inline-flex items-center rounded-xl border border-border px-3.5 py-2 text-xs font-medium hover:bg-muted transition-colors"
                >
                  Template Updates
                </Link>
                <Link
                  href="/admin/onboarding"
                  className="inline-flex items-center rounded-xl border border-border px-3.5 py-2 text-xs font-medium hover:bg-muted transition-colors"
                >
                  Open Setup
                </Link>
              </div>
            }
          />
          <div className="px-6 pb-6">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-muted/30 p-3.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Template</p>
                <p className="mt-1 text-sm font-medium text-foreground">{templateSummary.title}</p>
                <p className="text-xs text-muted-foreground">{templateSummary.vertical.replace(/_/g, ' ')} &middot; v{templateSummary.version}</p>
              </div>
              <div className="rounded-xl bg-muted/30 p-3.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Mode</p>
                <p className="mt-1 text-sm font-medium text-foreground">{templateSummary.dashboardMode.replace(/_/g, ' ')}</p>
                <p className="text-xs text-muted-foreground">{templateSummary.operatingModel.replace(/_/g, ' ')}</p>
              </div>
              <div className="rounded-xl bg-muted/30 p-3.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Status</p>
                <p className="mt-1 text-sm font-medium text-foreground">{templateConfigured ? 'Applied' : 'Using defaults'}</p>
                <p className="text-xs text-muted-foreground">Branch: {templateSummary.branchType.replace(/_/g, ' ')}</p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {templateSummary.enabledModules.map((module) => (
                <span
                  key={module}
                  className="rounded-lg bg-primary/5 border border-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
                >
                  {module.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          </div>
        </SectionCard>

        {/* ── Business Details ───────────────────────────────────────── */}
        <SectionCard>
          <SectionHeader
            icon={Settings}
            title="Business Details"
            description="Your organization name, slug, and branding."
          />
          <div className="px-6 pb-6">
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <FieldLabel>Business Name</FieldLabel>
                <input type="text" value={orgName} onChange={(e) => setOrgName(e.target.value)} className={inputClass} />
              </div>
              <div>
                <FieldLabel>Slug</FieldLabel>
                <input type="text" value={orgSlug} onChange={(e) => setOrgSlug(e.target.value)} className={inputClass} />
              </div>
              <div className="sm:col-span-2">
                <FieldLabel>Logo URL</FieldLabel>
                <input
                  type="url"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="https://example.com/logo.png"
                  className={inputClass}
                />
              </div>
            </div>
          </div>
        </SectionCard>

        {/* ── Queue Defaults ────────────────────────────────────────── */}
        <SectionCard>
          <SectionHeader
            icon={Ticket}
            title="Queue Defaults"
            description="How tickets are created and managed across your locations."
          />
          <div className="px-6 pb-6">
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <FieldLabel>Check-in mode</FieldLabel>
                <select value={checkInMode} onChange={(e) => setCheckInMode(e.target.value)} className={selectClass}>
                  <option value="self_service">Self Service</option>
                  <option value="manual">Manual</option>
                  <option value="hybrid">Hybrid</option>
                </select>
              </div>
              <div>
                <FieldLabel>Ticket Number Prefix</FieldLabel>
                <input type="text" value={ticketPrefix} onChange={(e) => setTicketPrefix(e.target.value)} placeholder="e.g. TK-" className={inputClass} />
              </div>
              <div>
                <FieldLabel>Auto No-Show Timeout (min)</FieldLabel>
                <input type="number" min={1} max={60} value={autoNoShowTimeout} onChange={(e) => setAutoNoShowTimeout(Number(e.target.value))} className={inputClass} />
                <FieldHint>Mark ticket as no-show if customer doesn&apos;t arrive within this time after being called.</FieldHint>
              </div>
              <div>
                <FieldLabel>Max Queue Size per Dept</FieldLabel>
                <input type="number" min={1} max={500} value={maxQueueSize} onChange={(e) => setMaxQueueSize(Number(e.target.value))} className={inputClass} />
                <FieldHint>Stop accepting tickets when department queue reaches this limit.</FieldHint>
              </div>
            </div>
          </div>
        </SectionCard>

        {/* ── Booking & Scheduling ─────────────────────────────────── */}
        <SectionCard>
          <SectionHeader
            icon={CalendarDays}
            title="Booking & Scheduling"
            description="Control how customers book appointments online."
          />
          <div className="px-6 pb-6">
            <div className="space-y-5">
              {/* Booking Mode Toggle */}
              <div>
                <FieldLabel>Booking Mode</FieldLabel>
                <div className="flex gap-2 mt-1">
                  {[
                    { value: 'disabled', label: 'Disabled' },
                    { value: 'simple', label: 'Simple' },
                    { value: 'advanced', label: 'Advanced' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setBookingMode(opt.value)}
                      className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                        bookingMode === opt.value
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'border border-border bg-background text-foreground hover:bg-muted'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {bookingMode === 'disabled' && (
                  <FieldHint>Online booking is turned off. Customers cannot book appointments.</FieldHint>
                )}
                {bookingMode === 'simple' && (
                  <FieldHint>Customers can book up to 7 days ahead with 30-minute slots, 1 booking per slot.</FieldHint>
                )}
                {bookingMode === 'advanced' && (
                  <FieldHint>Full scheduling with configurable horizon, slot duration, and capacity.</FieldHint>
                )}
              </div>

              {/* Advanced mode fields */}
              {bookingMode === 'advanced' && (
                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <FieldLabel>Booking Horizon (days)</FieldLabel>
                    <input
                      type="number"
                      min={7}
                      max={90}
                      value={bookingHorizonDays}
                      onChange={(e) => setBookingHorizonDays(Number(e.target.value))}
                      className={inputClass}
                    />
                    <FieldHint>How far ahead customers can book (7-90 days).</FieldHint>
                  </div>
                  <div>
                    <FieldLabel>Slot Duration (minutes)</FieldLabel>
                    <select
                      value={slotDurationMinutes}
                      onChange={(e) => setSlotDurationMinutes(Number(e.target.value))}
                      className={selectClass}
                    >
                      <option value={15}>15 minutes</option>
                      <option value={20}>20 minutes</option>
                      <option value={30}>30 minutes</option>
                      <option value={45}>45 minutes</option>
                      <option value={60}>60 minutes</option>
                    </select>
                    <FieldHint>Duration of each bookable time slot.</FieldHint>
                  </div>
                  <div>
                    <FieldLabel>Bookings per Slot</FieldLabel>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={slotsPerInterval}
                      onChange={(e) => setSlotsPerInterval(Number(e.target.value))}
                      className={inputClass}
                    />
                    <FieldHint>Max concurrent appointments per time slot (based on desks/rooms).</FieldHint>
                  </div>
                  <div className="flex items-start">
                    <label className={checkboxCardClass}>
                      <input
                        type="checkbox"
                        checked={allowCancellation}
                        onChange={(e) => setAllowCancellation(e.target.checked)}
                        className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary/30"
                      />
                      <div>
                        <span className="text-sm font-medium text-foreground">Allow Cancellation</span>
                        <p className="mt-0.5 text-xs text-muted-foreground">Let customers cancel their bookings.</p>
                      </div>
                    </label>
                  </div>
                </div>
              )}
            </div>
          </div>
        </SectionCard>

        {/* ── Public Display ────────────────────────────────────────── */}
        <SectionCard>
          <SectionHeader
            icon={Monitor}
            title="Public Display"
            description="Configure how queue information appears on public screens."
          />
          <div className="px-6 pb-6">
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <FieldLabel>Default screen layout</FieldLabel>
                <select value={displayLayout} onChange={(e) => setDisplayLayout(e.target.value)} className={selectClass}>
                  <option value="list">List</option>
                  <option value="grid">Grid</option>
                  <option value="department_split">Department Split</option>
                </select>
              </div>
              <div>
                <FieldLabel>Refresh Interval (seconds)</FieldLabel>
                <input type="number" min={1} max={60} value={refreshInterval} onChange={(e) => setRefreshInterval(Number(e.target.value))} className={inputClass} />
              </div>
              <div className="sm:col-span-2">
                <label className={checkboxCardClass}>
                  <input
                    type="checkbox"
                    checked={announcementSound}
                    onChange={(e) => setAnnouncementSound(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary/50"
                  />
                  <div>
                    <span className="text-sm font-medium text-foreground">Announcement Sound</span>
                    <p className="mt-0.5 text-xs text-muted-foreground">Play a sound when a ticket number is called on the display screen.</p>
                  </div>
                </label>
              </div>
            </div>
          </div>
        </SectionCard>

        {/* ── Email Verification ─────────────────────────────────────── */}
        <SectionCard>
          <SectionHeader
            icon={Mail}
            title="Booking Email Verification"
            description="Require email confirmation before booking actions."
          />
          <div className="px-6 pb-6 space-y-4">
            <label className={checkboxCardClass}>
              <input
                type="checkbox"
                checked={emailOtpEnabled}
                onChange={(e) => setEmailOtpEnabled(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary/50"
              />
              <div>
                <span className="text-sm font-medium text-foreground">Require email code for bookings</span>
                <p className="mt-0.5 text-xs text-muted-foreground">Send a short code by email before confirming sensitive booking actions.</p>
              </div>
            </label>

            <div className={`grid gap-3 sm:grid-cols-2 ${emailOtpEnabled ? '' : 'opacity-50 pointer-events-none'}`}>
              <label className={checkboxCardClass}>
                <input
                  type="checkbox"
                  checked={emailOtpRequiredForBooking}
                  onChange={(e) => setEmailOtpRequiredForBooking(e.target.checked)}
                  disabled={!emailOtpEnabled}
                  className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary/50 disabled:cursor-not-allowed"
                />
                <div>
                  <span className="text-sm font-medium text-foreground">Verify before new bookings</span>
                  <p className="mt-0.5 text-xs text-muted-foreground">Ask customers to verify their email before a booking is created.</p>
                </div>
              </label>
              <label className={checkboxCardClass}>
                <input
                  type="checkbox"
                  checked={emailOtpRequiredForBookingChanges}
                  onChange={(e) => setEmailOtpRequiredForBookingChanges(e.target.checked)}
                  disabled={!emailOtpEnabled}
                  className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary/50 disabled:cursor-not-allowed"
                />
                <div>
                  <span className="text-sm font-medium text-foreground">Verify before changes</span>
                  <p className="mt-0.5 text-xs text-muted-foreground">Verify email before customers update or cancel an existing visit.</p>
                </div>
              </label>
            </div>

            <div className={`grid gap-5 sm:grid-cols-2 ${emailOtpEnabled ? '' : 'opacity-50 pointer-events-none'}`}>
              <div>
                <FieldLabel>Code Expiry (minutes)</FieldLabel>
                <input type="number" min={1} max={30} value={emailOtpCodeExpiryMinutes} onChange={(e) => setEmailOtpCodeExpiryMinutes(Number(e.target.value))} disabled={!emailOtpEnabled} className={inputClass} />
                <FieldHint>How long a verification code stays valid after it is sent.</FieldHint>
              </div>
              <div>
                <FieldLabel>Resend Cooldown (seconds)</FieldLabel>
                <input type="number" min={15} max={300} value={emailOtpResendCooldownSeconds} onChange={(e) => setEmailOtpResendCooldownSeconds(Number(e.target.value))} disabled={!emailOtpEnabled} className={inputClass} />
                <FieldHint>How long customers must wait before requesting another code.</FieldHint>
              </div>
            </div>
          </div>
        </SectionCard>

        {/* ── SMS Backup Alerts ──────────────────────────────────────── */}
        <SectionCard>
          <SectionHeader
            icon={Bell}
            title="Priority Alert Backup"
            description="Add SMS as an optional backup for customers who enter a phone number."
            action={
              <span className={`rounded-full px-3 py-1.5 text-[10px] font-bold ${
                smsProviderReady ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
              }`}>
                {smsProviderReady ? 'Provider Ready' : 'Not Configured'}
              </span>
            }
          />
          <div className="px-6 pb-6 space-y-4">
            {!smsProviderReady && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                SMS is not configured yet. You can save these settings now, but text alerts won&apos;t send until provider credentials are added.
              </div>
            )}

            <label className={checkboxCardClass}>
              <input
                type="checkbox"
                checked={priorityAlertsEnabled}
                onChange={(e) => setPriorityAlertsEnabled(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary/50"
              />
              <div>
                <span className="text-sm font-medium text-foreground">Enable SMS backup alerts</span>
                <p className="mt-0.5 text-xs text-muted-foreground">Customers can add a mobile number to receive text backup for urgent queue events.</p>
              </div>
            </label>

            <div>
              <FieldLabel>Phone Field Label</FieldLabel>
              <input type="text" value={priorityAlertsPhoneLabel} onChange={(e) => setPriorityAlertsPhoneLabel(e.target.value)} placeholder="Mobile number" className={`sm:w-72 ${inputClass}`} />
              <FieldHint>Shown on the customer queue page when they add a text-alert number.</FieldHint>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { label: 'On Call', checked: priorityAlertsOnCall, set: setPriorityAlertsOnCall, hint: 'Send when ticket is first called.' },
                { label: 'On Recall', checked: priorityAlertsOnRecall, set: setPriorityAlertsOnRecall, hint: 'Send reminder on recall.' },
                { label: 'On Buzz', checked: priorityAlertsOnBuzz, set: setPriorityAlertsOnBuzz, hint: 'Send "staff is trying to reach you" text.' },
              ].map((item) => (
                <label key={item.label} className={checkboxCardClass}>
                  <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={(e) => item.set(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary/50"
                  />
                  <div>
                    <span className="text-sm font-medium text-foreground">{item.label}</span>
                    <p className="mt-0.5 text-xs text-muted-foreground">{item.hint}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </SectionCard>

        {/* ── Language ────────────────────────────────────────────────── */}
        <SectionCard>
          <SectionHeader
            icon={Globe}
            title="Language"
            description="Configure languages customers can use."
          />
          <div className="px-6 pb-6 space-y-4">
            <div>
              <FieldLabel>Supported Languages</FieldLabel>
              <div className="flex flex-wrap gap-2 mt-1">
                {languageOptions.map((lang) => {
                  const active = supportedLanguages.includes(lang.code);
                  return (
                    <button
                      key={lang.code}
                      type="button"
                      onClick={() => toggleLanguage(lang.code)}
                      className={`rounded-xl border px-4 py-2 text-sm font-medium transition-all ${
                        active
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-border text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      {lang.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <FieldLabel>Default language</FieldLabel>
              <select value={defaultLanguage} onChange={(e) => setDefaultLanguage(e.target.value)} className={`sm:w-64 ${selectClass}`}>
                {languageOptions
                  .filter((l) => supportedLanguages.includes(l.code))
                  .map((lang) => (
                    <option key={lang.code} value={lang.code}>{lang.label}</option>
                  ))}
              </select>
            </div>
          </div>
        </SectionCard>

        {/* ── Save Button ────────────────────────────────────────────── */}
        <div className="flex items-center gap-4 pt-2">
          <button
            onClick={handleSave}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground shadow-sm shadow-primary/20 hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            <Save className="h-4 w-4" />
            {isPending ? 'Saving...' : 'Save Settings'}
          </button>

          {successMessage && (
            <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />
              {successMessage}
            </span>
          )}
          {errorMessage && (
            <span className="text-sm text-red-600">{errorMessage}</span>
          )}
        </div>

        {/* ── Danger Zone ──────────────────────────────────────────── */}
        {templateConfigured && (
          <div className="rounded-2xl border border-red-200 bg-red-50/30 shadow-sm">
            <div className="px-6 pt-6 pb-4">
              <h3 className="text-base font-semibold text-red-700">Danger Zone</h3>
              <p className="mt-0.5 text-sm text-red-600/70">Irreversible actions that affect your entire business setup.</p>
            </div>
            <div className="px-6 pb-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-red-200 bg-white p-4">
                <div>
                  <p className="text-sm font-medium text-foreground">Reset Business Setup</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Delete all offices, departments, services, desks, tickets, and screens. You&apos;ll restart from template selection.
                  </p>
                </div>
                <button
                  onClick={() => setShowResetConfirm(true)}
                  className="shrink-0 rounded-xl border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
                >
                  Reset Setup
                </button>
              </div>

              {showResetConfirm && (
                <div className="mt-4 rounded-xl border border-red-300 bg-white p-5 space-y-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-foreground">Are you absolutely sure?</p>
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
                      className={`sm:w-64 ${inputClass} focus:ring-red-500/50`}
                    />
                  </div>

                  {resetError && <p className="text-sm text-red-600">{resetError}</p>}

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
                      className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {isResetting ? 'Resetting...' : 'Permanently Reset'}
                    </button>
                    <button
                      onClick={() => {
                        setShowResetConfirm(false);
                        setResetConfirmText('');
                        setResetError(null);
                      }}
                      className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
