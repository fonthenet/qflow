'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Save, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { updateOrganizationSettings, checkWhatsAppCodeAvailability } from '@/lib/actions/settings-actions';
import { useI18n } from '@/components/providers/locale-provider';
import { BUSINESS_CATEGORIES } from '@/lib/business-categories';

interface Organization {
  id: string;
  name: string;
  slug: string;
  logo_url?: string | null;
  settings?: Record<string, any> | null;
}

interface MessengerPageInfo {
  connected: boolean;
  page?: { id: string; name: string; pictureUrl: string | null };
  reason?: string;
}

interface VirtualQueueCode {
  id: string;
  label: string;
}

interface SettingsClientProps {
  organization: Organization;
  smsProviderReady: boolean;
  whatsappProviderReady: boolean;
  messengerPageInfo?: MessengerPageInfo;
  virtualQueueCodes?: VirtualQueueCode[];
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

function formatEnumLabel(value: string, t: (key: string) => string) {
  return t(
    value
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase())
  );
}

function formatBranchTypeLabel(value: string, t: (key: string) => string) {
  switch (value) {
    case 'general_office':
      return t('General Office');
    case 'service_center':
      return t('Service Center');
    case 'branch_office':
      return t('Branch Office');
    case 'community_clinic':
      return t('Community Clinic');
    case 'restaurant_floor':
      return t('Restaurant Floor');
    case 'salon_shop':
      return t('Salon Shop');
    default:
      return formatEnumLabel(value, t);
  }
}

function formatOperatingModelLabel(value: string, t: (key: string) => string) {
  switch (value) {
    case 'department_first':
      return t('Department First');
    case 'service_routing':
      return t('Service Routing');
    case 'appointments_first':
      return t('Appointments First');
    case 'waitlist':
      return t('Waitlist');
    default:
      return formatEnumLabel(value, t);
  }
}

function formatDashboardModeLabel(value: string, t: (key: string) => string) {
  return formatEnumLabel(value, t);
}

function formatModuleLabel(value: string, t: (key: string) => string) {
  return formatEnumLabel(value, t);
}

function ConnectedPageCard({ pageInfo, t }: { pageInfo?: MessengerPageInfo; t: (key: string) => string }) {
  if (!pageInfo || !pageInfo.connected) {
    return null;
  }

  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-emerald-700 mb-2">
        {t('Connected Facebook Page')}
      </p>
      <div className="flex items-center gap-3">
        {pageInfo.page?.pictureUrl ? (
          <img
            src={pageInfo.page.pictureUrl}
            alt=""
            className="h-10 w-10 rounded-full border border-emerald-200"
          />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 text-sm font-bold">
            {pageInfo.page?.name?.charAt(0) ?? '?'}
          </div>
        )}
        <div>
          <p className="text-sm font-semibold text-emerald-900">{pageInfo.page?.name}</p>
          <p className="text-xs text-emerald-700 font-mono">{t('Page ID')}: {pageInfo.page?.id}</p>
        </div>
      </div>
    </div>
  );
}

export function SettingsClient({
  organization,
  smsProviderReady,
  whatsappProviderReady,
  messengerPageInfo,
  virtualQueueCodes = [],
  templateSummary,
  templateConfigured,
}: SettingsClientProps) {
  const { t } = useI18n();
  const [isPending, startTransition] = useTransition();
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const settings = organization.settings ?? {};

  // Organization Settings
  const [orgName, setOrgName] = useState(organization.name);
  const [orgSlug, setOrgSlug] = useState(organization.slug);
  const [logoUrl, setLogoUrl] = useState(organization.logo_url ?? '');

  // Business Directory
  const [businessCategory, setBusinessCategory] = useState<string>(
    settings.business_category ?? 'other'
  );
  const [listedInDirectory, setListedInDirectory] = useState<boolean>(
    settings.listed_in_directory ?? false
  );

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
  const [visitIntakeOverrideMode, setVisitIntakeOverrideMode] = useState<string>(
    settings.visit_intake_override_mode ?? 'business_hours'
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
    settings.priority_alerts_phone_label ?? t('Mobile number')
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
  const [whatsappEnabled, setWhatsappEnabled] = useState<boolean>(
    settings.whatsapp_enabled ?? false
  );
  const [whatsappCode, setWhatsappCode] = useState<string>(
    settings.whatsapp_code ?? ''
  );
  const savedWhatsappCode = settings.whatsapp_code ?? '';
  const [arabicCode, setArabicCode] = useState<string>(
    settings.arabic_code ?? ''
  );
  const [codeAvailability, setCodeAvailability] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const codeCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const normalized = whatsappCode.toUpperCase().trim();
    if (!normalized || normalized.length < 2 || normalized === savedWhatsappCode.toUpperCase().trim()) {
      setCodeAvailability('idle');
      return;
    }
    setCodeAvailability('checking');
    if (codeCheckTimer.current) clearTimeout(codeCheckTimer.current);
    codeCheckTimer.current = setTimeout(async () => {
      const result = await checkWhatsAppCodeAvailability(normalized);
      setCodeAvailability(result.available ? 'available' : 'taken');
    }, 500);
    return () => { if (codeCheckTimer.current) clearTimeout(codeCheckTimer.current); };
  }, [whatsappCode, savedWhatsappCode]);

  const [whatsappBusinessPhone, setWhatsappBusinessPhone] = useState<string>(
    settings.whatsapp_business_phone ?? ''
  );
  const [whatsappDefaultVirtualCodeId, setWhatsappDefaultVirtualCodeId] = useState<string>(
    settings.whatsapp_default_virtual_code_id ?? ''
  );
  const [messengerEnabled, setMessengerEnabled] = useState<boolean>(
    settings.messenger_enabled ?? false
  );
  const [messengerPageId, setMessengerPageId] = useState<string>(
    settings.messenger_page_id ?? ''
  );

  // Booking Settings
  const [bookingEnabled, setBookingEnabled] = useState<boolean>(
    (settings.booking_mode ?? 'disabled') !== 'disabled'
  );
  const [slotDurationMinutes, setSlotDurationMinutes] = useState<number>(
    settings.slot_duration_minutes ?? 30
  );
  const [bookingHorizonDays, setBookingHorizonDays] = useState<number>(
    settings.booking_horizon_days ?? 7
  );
  const [slotsPerInterval, setSlotsPerInterval] = useState<number>(
    settings.slots_per_interval ?? 1
  );
  const [dailyTicketLimit, setDailyTicketLimit] = useState<number>(
    settings.daily_ticket_limit ?? 0
  );
  const [minBookingLeadHours, setMinBookingLeadHours] = useState<number>(
    settings.min_booking_lead_hours ?? 1
  );
  const [allowCancellation, setAllowCancellation] = useState<boolean>(
    settings.allow_cancellation ?? true
  );
  // Approval gates: when on, the customer's request stays in the holding bay
  // (tickets → pending_approval, appointments → pending) until a staff member
  // approves or declines it from the Station / admin tools. The slot or seat
  // remains reserved while pending so capacity isn't double-booked.
  const [requireTicketApproval, setRequireTicketApproval] = useState<boolean>(
    settings.require_ticket_approval ?? false
  );
  const [requireAppointmentApproval, setRequireAppointmentApproval] = useState<boolean>(
    settings.require_appointment_approval ?? true
  );

  const languageOptions = [
    { code: 'en', label: t('English') },
    { code: 'fr', label: t('French') },
    { code: 'ar', label: t('Arabic') },
    { code: 'es', label: t('Spanish') },
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
          visit_intake_override_mode: visitIntakeOverrideMode,
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
          whatsapp_enabled: whatsappEnabled,
          whatsapp_code: whatsappCode.toUpperCase().trim(),
          arabic_code: arabicCode.trim(),
          whatsapp_business_phone: whatsappBusinessPhone,
          whatsapp_default_virtual_code_id: whatsappDefaultVirtualCodeId,
          messenger_default_virtual_code_id: whatsappDefaultVirtualCodeId,
          messenger_enabled: messengerEnabled,
          messenger_page_id: messengerPageId.trim(),
          business_category: businessCategory,
          listed_in_directory: listedInDirectory,
          // Booking
          booking_mode: bookingEnabled ? 'simple' : 'disabled',
          slot_duration_minutes: slotDurationMinutes,
          booking_horizon_days: bookingHorizonDays,
          slots_per_interval: slotsPerInterval,
          daily_ticket_limit: dailyTicketLimit,
          min_booking_lead_hours: minBookingLeadHours,
          allow_cancellation: allowCancellation,
          require_ticket_approval: requireTicketApproval,
          require_appointment_approval: requireAppointmentApproval,
        },
      });

      if (result?.error) {
        setErrorMessage(result.error);
      } else {
        setSuccessMessage(t('Settings saved successfully.'));
        setTimeout(() => setSuccessMessage(null), 4000);
      }
    });
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('Business Settings')}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t('Manage the important defaults for your business, customer communication, and public screens.')}
        </p>
      </div>

      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{t('Business Setup')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('Your current business setup controls labels, navigation, starter structure, and customer-facing defaults.')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/template-governance"
              className="inline-flex items-center rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              {t('Template Updates')}
            </Link>
            <Link
              href="/admin/onboarding"
              className="inline-flex items-center rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              {t('Open Setup')}
            </Link>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg bg-muted/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('Template')}</p>
            <p className="mt-1 text-sm font-medium text-foreground">{templateSummary.title}</p>
            <p className="text-xs text-muted-foreground">
              {formatEnumLabel(templateSummary.vertical, t)} · v{templateSummary.version}
            </p>
          </div>
          <div className="rounded-lg bg-muted/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('Mode')}</p>
            <p className="mt-1 text-sm font-medium text-foreground">
              {formatDashboardModeLabel(templateSummary.dashboardMode, t)}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatOperatingModelLabel(templateSummary.operatingModel, t)}
            </p>
          </div>
          <div className="rounded-lg bg-muted/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('Status')}</p>
            <p className="mt-1 text-sm font-medium text-foreground">
              {templateConfigured ? t('Applied') : t('Using defaults')}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('Branch type: {value}', { value: formatBranchTypeLabel(templateSummary.branchType, t) })}
            </p>
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('Enabled Modules')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {templateSummary.enabledModules.map((module) => (
              <span
                key={module}
                className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground"
              >
                {formatModuleLabel(module, t)}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Organization Settings ──────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold text-foreground">
          {t('Business Details')}
        </h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              {t('Business Name')}
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
              {t('Slug')}
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
              {t('Logo URL')}
            </label>
            <input
              type="url"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder={t('https://example.com/logo.png')}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              {t('Business Category')}
            </label>
            <select
              value={businessCategory}
              onChange={(e) => setBusinessCategory(e.target.value)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              {BUSINESS_CATEGORIES.map((cat) => (
                <option key={cat.value} value={cat.value}>
                  {cat.emoji} {t(cat.label.en)}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('Helps customers find your business in the WhatsApp/Messenger directory.')}
            </p>
          </div>

          <div className="flex items-start">
            <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-border p-4 w-full">
              <input
                type="checkbox"
                checked={listedInDirectory}
                onChange={(e) => setListedInDirectory(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary/50"
              />
              <div>
                <span className="text-sm font-medium text-foreground">
                  {t('List in public directory')}
                </span>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('Allow customers to discover your business by sending LIST on WhatsApp or Messenger. Only businesses with an active queue code will appear.')}
                </p>
              </div>
            </label>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            {t('Booking Email Verification')}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('Let admins decide when customers must confirm their email before a booking is accepted or changed.')}
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
              {t('Require email code for bookings')}
            </span>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('Send a short code by email before confirming sensitive booking actions.')}
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
              <span className="text-sm font-medium text-foreground">{t('Verify before new bookings')}</span>
              <p className="text-xs text-muted-foreground">
                {t('Ask customers to verify their email before a booking is created.')}
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
              <span className="text-sm font-medium text-foreground">{t('Verify before changes or cancellations')}</span>
              <p className="text-xs text-muted-foreground">
                {t('Verify email before customers update or cancel an existing visit.')}
              </p>
            </div>
          </label>
        </div>

        <div className={`grid gap-4 sm:grid-cols-2 ${emailOtpEnabled ? '' : 'opacity-60'}`}>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              {t('Code Expiry (minutes)')}
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
              {t('How long a verification code stays valid after it is sent.')}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              {t('Resend Cooldown (seconds)')}
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
              {t('How long customers must wait before requesting another code.')}
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
            {t('Priority Alert Backup')}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('Keep free push notifications as the primary path, and add SMS as an optional backup for customers who choose to enter a phone number.')}
          </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              smsProviderReady
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-amber-100 text-amber-700'
            }`}
          >
            {smsProviderReady ? t('Provider Ready') : t('Provider Not Configured')}
          </span>
        </div>

        {!smsProviderReady && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {t('SMS is not configured in environment variables yet. You can save these settings now, but text alerts will not send until the provider credentials are added.')}
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
              {t('Enable SMS backup alerts')}
            </span>
            <p className="text-xs text-muted-foreground mt-1">
              {t('Customers can add a mobile number on their queue page to receive a text backup for urgent queue events.')}
            </p>
          </div>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              {t('Phone Field Label')}
            </label>
            <input
              type="text"
              value={priorityAlertsPhoneLabel}
              onChange={(e) => setPriorityAlertsPhoneLabel(e.target.value)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder={t('Mobile number')}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {t('Shown on the customer queue page when they add a text-alert number.')}
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
              <span className="text-sm font-medium text-foreground">{t('On Call')}</span>
              <p className="text-xs text-muted-foreground">{t('Send when the ticket is first called.')}</p>
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
              <span className="text-sm font-medium text-foreground">{t('On Recall')}</span>
              <p className="text-xs text-muted-foreground">{t('Send reminder texts on recall.')}</p>
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
              <span className="text-sm font-medium text-foreground">{t('On Buzz')}</span>
              <p className="text-xs text-muted-foreground">{t('Send a stronger “staff is trying to reach you” text.')}</p>
            </div>
          </label>
        </div>
      </section>

      {/* ── WhatsApp Queue Integration (read-only) ─────────────────────── */}
      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            {t('WhatsApp Queue')}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('Customers join your queue by sending a message via WhatsApp. Managed by Qflo.')}
          </p>
        </div>

        <div className="flex items-center justify-between gap-4">
          <label className="flex items-center gap-3 rounded-lg border border-border p-4 cursor-pointer flex-1">
            <input
              type="checkbox"
              checked={whatsappEnabled}
              onChange={(e) => setWhatsappEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary/50"
            />
            <span className="text-sm font-medium text-foreground">
              {whatsappEnabled ? t('WhatsApp Queue Join is enabled') : t('WhatsApp Queue Join is disabled')}
            </span>
          </label>
          <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
            whatsappProviderReady
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            <div className={`h-2 w-2 rounded-full ${whatsappProviderReady ? 'bg-emerald-500' : 'bg-red-500'}`} />
            {whatsappProviderReady ? t('Connected') : t('Not connected')}
          </div>
        </div>

        {whatsappEnabled && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">
                {t('Business Code')}
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={whatsappCode}
                  onChange={(e) => setWhatsappCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  placeholder={t('e.g. CLINIC1')}
                  maxLength={20}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground uppercase tracking-wider font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                {codeAvailability === 'checking' && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{t('Checking…')}</span>
                )}
                {codeAvailability === 'available' && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-emerald-600 font-medium">✓ {t('Available')}</span>
                )}
                {codeAvailability === 'taken' && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-red-600 font-medium">✗ {t('Already taken')}</span>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('Unique code customers use to join your queue via WhatsApp.')}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">
                {t('Arabic Code')} <span className="text-xs text-muted-foreground font-normal">({t('optional')})</span>
              </label>
              <input
                type="text"
                value={arabicCode}
                onChange={(e) => setArabicCode(e.target.value)}
                placeholder={t('e.g. حدابي')}
                maxLength={30}
                dir="rtl"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground tracking-wider font-semibold focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {t('Arabic alternative for your business code. Customers can type')} <code className="font-mono font-bold" dir="rtl">انضم {arabicCode || 'حدابي'}</code>
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">
                {t('Default Queue')}
              </label>
              {virtualQueueCodes.length > 0 ? (
                <select
                  value={whatsappDefaultVirtualCodeId}
                  onChange={(e) => setWhatsappDefaultVirtualCodeId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="">{t('Select a queue...')}</option>
                  {virtualQueueCodes.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              ) : (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                  <p className="text-sm text-amber-800">
                    {t('No virtual queue codes found.')}{' '}
                    <Link href="/admin/virtual-codes" className="font-medium text-primary hover:underline">
                      {t('Create one')}
                    </Link>{' '}
                    {t('to enable WhatsApp/Messenger queue joining.')}
                  </p>
                </div>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {t('The queue customers join when they send your business code via WhatsApp or Messenger.')}
              </p>
            </div>

            {whatsappCode && (
              <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
                <p className="font-medium">{t('How customers join')}</p>
                <p className="mt-1 text-sm">
                  {t('Customers send')} <code className="font-mono font-bold">JOIN {whatsappCode.toUpperCase()}</code> {t('to the Qflo WhatsApp number, or scan the QR code on your join page.')}
                </p>
                {arabicCode && (
                  <p className="mt-1 text-sm" dir="rtl">
                    {t('Or in Arabic:')} <code className="font-semibold">انضم {arabicCode}</code>
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Messenger Notifications (read-only) ────────────────────────── */}
      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            {t('Messenger Notifications')}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('Customers receive queue notifications via Facebook Messenger. Managed by Qflo.')}
          </p>
        </div>

        <div className="flex items-center justify-between gap-4">
          <label className="flex items-center gap-3 rounded-lg border border-border p-4 cursor-pointer flex-1">
            <input
              type="checkbox"
              checked={messengerEnabled}
              onChange={(e) => setMessengerEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary/50"
            />
            <span className="text-sm font-medium text-foreground">
              {messengerEnabled ? t('Messenger Notifications are enabled') : t('Messenger Notifications are disabled')}
            </span>
          </label>
          <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
            messengerPageInfo?.connected
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            <div className={`h-2 w-2 rounded-full ${messengerPageInfo?.connected ? 'bg-emerald-500' : 'bg-red-500'}`} />
            {messengerPageInfo?.connected ? t('Connected') : t('Not connected')}
          </div>
        </div>

        {messengerEnabled && (
          <div className="space-y-4">
            <ConnectedPageCard pageInfo={messengerPageInfo} t={t} />

            <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
              <p className="font-medium">{t('How it works')}</p>
              <p className="mt-1 text-sm">
                {t('Customers can join your queue directly through Messenger or tap "Get Messenger notifications" after booking to receive live updates about their ticket.')}
              </p>
            </div>

            {whatsappCode && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                <p className="font-medium">{t('How customers join via Messenger')}</p>
                <p className="mt-1 text-sm">
                  {t('Customers send')} <code className="font-mono font-bold">JOIN {whatsappCode.toUpperCase()}</code> {t('to the Qflo Messenger bot to join the queue.')}
                </p>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Ticket Settings ────────────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold text-foreground">
          {t('Queue Defaults')}
        </h2>

        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-2">
            {t('Visit Intake Availability')}
          </label>
          <p className="mb-3 text-xs text-muted-foreground">
            {t('Choose whether customer-facing queue intake follows your business hours, stays open all the time, or stays closed until you reopen it.')}
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              {
                value: 'business_hours',
                title: t('Use business hours'),
                description: t('Follow each location schedule for kiosk and public queue intake.'),
              },
              {
                value: 'always_open',
                title: t('Always open'),
                description: t('Keep taking walk-in and remote queue visits even outside scheduled hours.'),
              },
              {
                value: 'always_closed',
                title: t('Always closed'),
                description: t('Pause all customer visit intake until you switch it back on.'),
              },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setVisitIntakeOverrideMode(option.value)}
                className={`rounded-xl border p-4 text-left transition-colors ${
                  visitIntakeOverrideMode === option.value
                    ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                    : 'border-border hover:bg-muted'
                }`}
              >
                <div className="text-sm font-semibold text-foreground">{option.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">{option.description}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              {t('Check-in mode')}
            </label>
            <select
              value={checkInMode}
              onChange={(e) => setCheckInMode(e.target.value)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="self_service">{t('Self Service')}</option>
              <option value="manual">{t('Manual')}</option>
              <option value="hybrid">{t('Hybrid')}</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              {t('Ticket Number Prefix')}
            </label>
            <input
              type="text"
              value={ticketPrefix}
              onChange={(e) => setTicketPrefix(e.target.value)}
              placeholder={t('e.g. TK-')}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              {t('Auto No-Show Timeout (minutes)')}
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
              {t("Mark ticket as no-show if customer doesn't arrive within this time after being called.")}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              {t('Max Queue Size per Department')}
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
              {t('Stop accepting tickets when department queue reaches this limit.')}
            </p>
          </div>
        </div>
      </section>

      {/* ── Display Settings ───────────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold text-foreground">
          {t('Public Display')}
        </h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              {t('Default screen layout')}
            </label>
            <select
              value={displayLayout}
              onChange={(e) => setDisplayLayout(e.target.value)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="list">{t('List')}</option>
              <option value="grid">{t('Grid')}</option>
              <option value="department_split">{t('Department Split')}</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              {t('Display Refresh Interval (seconds)')}
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
                  {t('Announcement Sound')}
                </span>
                <p className="text-xs text-muted-foreground">
                  {t('Play a sound when a ticket number is called on the display screen.')}
                </p>
              </div>
            </label>
          </div>
        </div>
      </section>

      {/* ── Language Settings ──────────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold text-foreground">
          {t('Language')}
        </h2>

        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-2">
            {t('Languages customers can use')}
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
            {t('Default language')}
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

      {/* ── Booking Settings ──────────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t('Booking Settings')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('Configure how customers book future appointments — time slots, capacity, and limits.')}
          </p>
        </div>

        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            id="booking-enabled"
            checked={bookingEnabled}
            onChange={(e) => setBookingEnabled(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-border"
          />
          <div>
            <label htmlFor="booking-enabled" className="text-sm font-medium">
              {t('Online Booking')}
            </label>
            <p className="text-xs text-muted-foreground">
              {t('Allow customers to book appointments via WhatsApp, Messenger, and web')}
            </p>
          </div>
        </div>

        <div className={bookingEnabled ? '' : 'opacity-60 pointer-events-none'}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Slot Duration */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t('Slot Duration')}
              </label>
              <select
                value={slotDurationMinutes}
                onChange={(e) => setSlotDurationMinutes(Number(e.target.value))}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:ring-2 focus:ring-primary/50"
              >
                <option value={10}>10 {t('minutes')}</option>
                <option value={15}>15 {t('minutes')}</option>
                <option value={20}>20 {t('minutes')}</option>
                <option value={30}>30 {t('minutes')}</option>
                <option value={45}>45 {t('minutes')}</option>
                <option value={60}>60 {t('minutes')}</option>
                <option value={90}>90 {t('minutes')}</option>
              </select>
              <p className="mt-1 text-xs text-muted-foreground">{t('Duration of each appointment slot')}</p>
            </div>

            {/* Booking Horizon */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t('Booking Horizon')}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={bookingHorizonDays}
                  onChange={(e) => setBookingHorizonDays(Number(e.target.value))}
                  className="w-20 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:ring-2 focus:ring-primary/50"
                />
                <span className="text-sm text-muted-foreground">{t('days ahead')}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{t('How far in advance customers can book')}</p>
            </div>

            {/* Slots Per Interval */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t('Capacity Per Slot')}
              </label>
              <input
                type="number"
                min={1}
                max={50}
                value={slotsPerInterval}
                onChange={(e) => setSlotsPerInterval(Number(e.target.value))}
                className="w-20 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:ring-2 focus:ring-primary/50"
              />
              <p className="mt-1 text-xs text-muted-foreground">{t('Max concurrent bookings per time slot')}</p>
            </div>

            {/* Daily Ticket Limit */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t('Daily Booking Limit')}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={500}
                  value={dailyTicketLimit}
                  onChange={(e) => setDailyTicketLimit(Number(e.target.value))}
                  className="w-20 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:ring-2 focus:ring-primary/50"
                />
                <span className="text-sm text-muted-foreground">{t('per day')}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{t('0 = no limit. Max bookings allowed per day per office.')}</p>
            </div>

            {/* Min Lead Time */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t('Minimum Lead Time')}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={48}
                  value={minBookingLeadHours}
                  onChange={(e) => setMinBookingLeadHours(Number(e.target.value))}
                  className="w-20 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:ring-2 focus:ring-primary/50"
                />
                <span className="text-sm text-muted-foreground">{t('hours before')}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{t('Minimum hours before appointment to allow booking')}</p>
            </div>

            {/* Allow Cancellation */}
            <div className="flex items-center gap-3 pt-6">
              <input
                type="checkbox"
                id="allow-cancellation"
                checked={allowCancellation}
                onChange={(e) => setAllowCancellation(e.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              <label htmlFor="allow-cancellation" className="text-sm font-medium">
                {t('Allow Customer Cancellation')}
              </label>
            </div>

            {/* Require Approval — Same-Day Tickets */}
            <div className="md:col-span-2 flex items-start gap-3 pt-2">
              <input
                type="checkbox"
                id="require-ticket-approval"
                checked={requireTicketApproval}
                onChange={(e) => setRequireTicketApproval(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border"
              />
              <label htmlFor="require-ticket-approval" className="text-sm">
                <div className="font-medium">{t('Require approval for same-day tickets')}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {t('When on, every JOIN ticket waits for staff approval before entering the queue.')}
                </div>
              </label>
            </div>

            {/* Require Approval — Future Appointments */}
            <div className="md:col-span-2 flex items-start gap-3">
              <input
                type="checkbox"
                id="require-appointment-approval"
                checked={requireAppointmentApproval}
                onChange={(e) => setRequireAppointmentApproval(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border"
              />
              <label htmlFor="require-appointment-approval" className="text-sm">
                <div className="font-medium">{t('Require approval for future appointments')}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {t('When on, every RESERVE booking waits for staff approval. The slot stays reserved until you approve or decline. Turn off to auto-confirm bookings.')}
                </div>
              </label>
            </div>
          </div>
        </div>
      </section>

      {/* ── Save Button ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={isPending || codeAvailability === 'taken'}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          <Save className="h-4 w-4" />
          {isPending ? t('Saving...') : t('Save Settings')}
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
