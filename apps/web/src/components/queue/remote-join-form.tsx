'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import type { PublicJoinProfile, TemplateVocabulary } from '@queueflow/shared';
import { isOfficeOpen, formatOperatingHours, capitalizeDay, type OperatingHours } from '@queueflow/shared';
import { createClient } from '@/lib/supabase/client';
import { SendTicketLink } from '@/components/kiosk/send-ticket-link';
import {
  clearBookingEmailOtpVerification,
  markBookingEmailOtpVerified,
} from '@/lib/actions/appointment-actions';
import { createPublicTicket, estimatePublicWaitTime } from '@/lib/actions/public-ticket-actions';

interface RemoteJoinFormProps {
  virtualCode: any;
  office: any;
  organization?: any;
  department: any;
  offices?: any[];
  departments?: any[];
  services?: any[];
  waitingTickets?: Array<{
    id: string;
    office_id: string;
    department_id: string;
    service_id: string;
  }>;
  hasSpecificService?: boolean;
  estimatedWait?: number | null;
  service?: any;
  publicJoinProfile?: PublicJoinProfile;
  vocabulary?: TemplateVocabulary;
}

export function RemoteJoinForm({
  virtualCode,
  office,
  organization,
  department,
  offices = [],
  departments = [],
  services = [],
  waitingTickets = [],
  hasSpecificService = false,
  estimatedWait = null,
  service,
  publicJoinProfile,
  vocabulary,
}: RemoteJoinFormProps) {
  const router = useRouter();
  // If a single service prop is passed (from simplified page), use it
  const resolvedServices = service ? [service] : services;
  const resolvedHasSpecific = service ? true : hasSpecificService;

  const [selectedOfficeId, setSelectedOfficeId] = useState<string>(
    virtualCode.office_id ?? office?.id ?? ''
  );
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string>(
    virtualCode.department_id ?? department?.id ?? ''
  );
  const [selectedServiceId, setSelectedServiceId] = useState<string>(
    resolvedHasSpecific && resolvedServices.length === 1 ? resolvedServices[0].id : ''
  );
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentWait, setCurrentWait] = useState<number | null>(estimatedWait);
  const [ticket, setTicket] = useState<{ ticket_number: string; qr_token: string } | null>(null);
  const [sendingEmailOtp, setSendingEmailOtp] = useState(false);
  const [verifyingEmailOtp, setVerifyingEmailOtp] = useState(false);
  const [emailOtpCode, setEmailOtpCode] = useState('');
  const [emailOtpSent, setEmailOtpSent] = useState(false);
  const [emailOtpVerified, setEmailOtpVerified] = useState(false);
  const [emailOtpMessage, setEmailOtpMessage] = useState<string | null>(null);
  const [emailOtpResendRemainingSeconds, setEmailOtpResendRemainingSeconds] =
    useState(0);
  const [supabase] = useState(() => createClient());

  // Check localStorage for an existing active ticket from this browser
  const [existingTicket, setExistingTicket] = useState<{
    qr_token: string;
    ticket_number: string;
  } | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('qf_active_ticket');
      if (!saved) return;
      const parsed = JSON.parse(saved);
      // Only show if created within the last 12 hours
      const createdAt = new Date(parsed.created_at).getTime();
      const twelveHoursAgo = Date.now() - 12 * 60 * 60 * 1000;
      if (createdAt > twelveHoursAgo && parsed.qr_token) {
        setExistingTicket({ qr_token: parsed.qr_token, ticket_number: parsed.ticket_number });
      } else {
        localStorage.removeItem('qf_active_ticket');
      }
    } catch {
      localStorage.removeItem('qf_active_ticket');
    }
  }, []);

  const officeLocked = !!virtualCode.office_id;
  const departmentLocked = !!virtualCode.department_id;
  const serviceLocked = !!virtualCode.service_id;
  const emailOtpRequired = Boolean(
    organization?.settings?.email_otp_enabled &&
      organization?.settings?.email_otp_required_for_booking
  );
  const emailOtpExpiryMinutes = Number(
    organization?.settings?.email_otp_code_expiry_minutes ?? 10
  );
  const emailOtpResendCooldownSeconds = Number(
    organization?.settings?.email_otp_resend_cooldown_seconds ?? 60
  );

  const availableOffices = officeLocked
    ? offices.filter((item: any) => item.id === selectedOfficeId)
    : offices;
  const availableDepartments = selectedOfficeId
    ? departments.filter((item: any) => item.office_id === selectedOfficeId)
    : [];
  const availableServices = selectedDepartmentId
    ? resolvedServices.filter((item: any) => item.department_id === selectedDepartmentId)
    : resolvedServices;

  useEffect(() => {
    if (!officeLocked && availableOffices.length === 1 && !selectedOfficeId) {
      setSelectedOfficeId(availableOffices[0].id);
    }
  }, [availableOffices, officeLocked, selectedOfficeId]);

  useEffect(() => {
    if (!selectedOfficeId) return;
    if (!departmentLocked && availableDepartments.length === 1 && !selectedDepartmentId) {
      setSelectedDepartmentId(availableDepartments[0].id);
    }
  }, [availableDepartments, departmentLocked, selectedDepartmentId, selectedOfficeId]);

  useEffect(() => {
    if (!selectedDepartmentId || serviceLocked) return;
    if (availableServices.length === 1 && !selectedServiceId) {
      const onlyServiceId = availableServices[0].id;
      setSelectedServiceId(onlyServiceId);
      handleServiceChange(onlyServiceId, selectedDepartmentId);
    }
  }, [availableServices, selectedDepartmentId, selectedServiceId, serviceLocked]);

  useEffect(() => {
    setEmailOtpSent(false);
    setEmailOtpVerified(false);
    setEmailOtpCode('');
    setEmailOtpMessage(null);
    setEmailOtpResendRemainingSeconds(0);
  }, [customerEmail]);

  useEffect(() => {
    if (emailOtpResendRemainingSeconds <= 0) return;

    const timer = window.setInterval(() => {
      setEmailOtpResendRemainingSeconds((current) =>
        current <= 1 ? 0 : current - 1
      );
    }, 1000);

    return () => window.clearInterval(timer);
  }, [emailOtpResendRemainingSeconds]);

  // Update wait estimate when service changes
  async function handleServiceChange(serviceId: string, departmentId = selectedDepartmentId) {
    setSelectedServiceId(serviceId);
    if (serviceId && departmentId) {
      const result = await estimatePublicWaitTime(departmentId, serviceId);
      setCurrentWait(result.data ?? null);
    } else {
      setCurrentWait(null);
    }
  }

  async function handleJoinQueue(e: React.FormEvent) {
    e.preventDefault();

    const officeToUse = selectedOfficeId || virtualCode.office_id;
    const departmentToUse = selectedDepartmentId || virtualCode.department_id;
    const serviceToUse = selectedServiceId || virtualCode.service_id;
    if (!officeToUse) {
      setError('Please select a location');
      return;
    }
    if (!departmentToUse) {
      setError('Please select a department');
      return;
    }
    if (!serviceToUse) {
      setError('Please select a service');
      return;
    }
    if (resolvedPublicJoin.requireCustomerName && !customerName.trim()) {
      setError(`Please enter ${resolvedPublicJoin.namedPartyLabel.toLowerCase()}.`);
      return;
    }
    if (emailOtpRequired && !customerEmail.trim()) {
      setError('Please enter your email to verify before joining the queue.');
      return;
    }
    if (emailOtpRequired && !emailOtpVerified) {
      setError('Please verify your email before joining the queue.');
      return;
    }

    setJoining(true);
    setError(null);

    try {
      // Build customer data
      const customerData: Record<string, string> = {};
      if (customerName.trim()) customerData.name = customerName.trim();
      if (customerPhone.trim()) customerData.phone = customerPhone.trim();
      if (customerEmail.trim()) customerData.email = customerEmail.trim().toLowerCase();

      const result = await createPublicTicket({
        officeId: officeToUse,
        departmentId: departmentToUse,
        serviceId: serviceToUse,
        checkedInAt: new Date().toISOString(),
        customerData: Object.keys(customerData).length > 0 ? customerData : null,
        estimatedWaitMinutes: currentWait,
        isRemote: true,
      });

      if ('stationOnline' in result && result.stationOnline) {
        throw new Error('This office is managed by a local station. Please join the queue at the office kiosk.');
      }

      if (result.error || !result.data) {
        throw new Error(result.error ?? 'Failed to join queue. Please try again.');
      }

      setTicket({
        ticket_number: result.data.ticket_number,
        qr_token: result.data.qr_token,
      });
    } catch (err: any) {
      setError(err?.message ?? 'Failed to join queue. Please try again.');
    } finally {
      setJoining(false);
    }
  }

  async function handleSendEmailOtp() {
    const email = customerEmail.trim().toLowerCase();
    if (!email) {
      setError('Please enter your email to receive a verification code.');
      return;
    }

    setSendingEmailOtp(true);
    setError(null);
    setEmailOtpMessage(null);

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
      },
    });

    if (otpError) {
      setError(otpError.message);
      setSendingEmailOtp(false);
      return;
    }

    setEmailOtpSent(true);
    setEmailOtpVerified(false);
    setEmailOtpResendRemainingSeconds(emailOtpResendCooldownSeconds);
    setEmailOtpMessage(
      `Verification code sent. It stays valid for ${emailOtpExpiryMinutes} minutes.`
    );
    setSendingEmailOtp(false);
  }

  async function handleVerifyEmailOtp() {
    const email = customerEmail.trim().toLowerCase();
    if (!email) {
      setError('Please enter your email first.');
      return;
    }

    if (!emailOtpCode.trim()) {
      setError('Enter the verification code from your email.');
      return;
    }

    setVerifyingEmailOtp(true);
    setError(null);
    setEmailOtpMessage(null);

    const { error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: emailOtpCode.trim(),
      type: 'email',
    });

    if (verifyError) {
      setError(verifyError.message);
      setVerifyingEmailOtp(false);
      return;
    }

    await markBookingEmailOtpVerified({
      email,
      officeId: selectedOfficeId || virtualCode.office_id,
      expiresInMinutes: emailOtpExpiryMinutes,
    });

    await supabase.auth.signOut();

    setEmailOtpVerified(true);
    setEmailOtpMessage('Email verified. You can join the queue now.');
    setVerifyingEmailOtp(false);
  }

  const orgName = organization?.name || 'Qflo';
  const resolvedVocabulary: TemplateVocabulary = vocabulary ?? {
    officeLabel: 'Location',
    departmentLabel: 'Department',
    serviceLabel: 'Service',
    deskLabel: 'Desk',
    customerLabel: 'Customer',
    bookingLabel: 'Booking',
    queueLabel: 'Queue',
  };
  const resolvedPublicJoin = publicJoinProfile ?? {
    headline: 'Join the Queue',
    subheadline: 'Choose your location and service to get a live queue ticket.',
    requireCustomerName: false,
    namedPartyLabel: 'Name',
  };
  const smsBackupEnabled = organization?.settings?.priority_alerts_sms_enabled === true;
  const displayService = serviceLocked && resolvedServices.length === 1 ? resolvedServices[0] : null;
  const displayOffice =
    availableOffices.find((item: any) => item.id === selectedOfficeId) ?? office;
  const displayDepartment =
    availableDepartments.find((item: any) => item.id === selectedDepartmentId) ?? department;
  const waitingCount = waitingTickets.filter((item) => {
    const matchesOffice = selectedOfficeId ? item.office_id === selectedOfficeId : true;
    const matchesDepartment = selectedDepartmentId ? item.department_id === selectedDepartmentId : true;
    const matchesService = selectedServiceId ? item.service_id === selectedServiceId : true;
    return matchesOffice && matchesDepartment && matchesService;
  }).length;
  const selectionCardClass =
    'w-full rounded-[1.35rem] border p-4 text-left transition-all sm:p-5';
  const selectionActiveClass = 'border-primary bg-primary/5 ring-2 ring-primary/20 shadow-[0_16px_40px_rgba(37,99,235,0.12)]';
  const selectionIdleClass = 'border-border bg-card hover:border-primary/50 hover:shadow-sm';

  // When ticket is created: save to localStorage and update URL
  useEffect(() => {
    if (!ticket) return;

    // 1. Save active ticket to localStorage so the customer can always recover it
    try {
      localStorage.setItem(
        'qf_active_ticket',
        JSON.stringify({
          qr_token: ticket.qr_token,
          ticket_number: ticket.ticket_number,
          created_at: new Date().toISOString(),
        })
      );
    } catch {}

    // 2. Replace browser URL to the tracking page — so bookmark/refresh = tracking page
    const trackingPath = `/q/${ticket.qr_token}`;
    window.history.replaceState({}, '', trackingPath);
  }, [ticket]);

  // Generate QR code when ticket is created
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const trackingUrl = ticket
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/q/${ticket.qr_token}`
    : '';

  useEffect(() => {
    if (!ticket) return;
    const url = `${window.location.origin}/q/${ticket.qr_token}`;
    QRCode.toDataURL(url, {
      width: 200,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    })
      .then((dataUrl: string) => setQrDataUrl(dataUrl))
      .catch(() => {});
  }, [ticket]);

  // ── Business hours check ──────────────────────────────────────
  // NOTE: hooks must be called before any conditional early return
  const selectedOffice = offices.find((o: any) => o.id === selectedOfficeId);
  const officeHours = selectedOffice?.operating_hours as OperatingHours | null;
  const officeTimezone = selectedOffice?.timezone || 'UTC';
  const [businessStatus, setBusinessStatus] = useState(() =>
    officeHours ? isOfficeOpen(officeHours, officeTimezone) : null
  );

  useEffect(() => {
    if (!officeHours) { setBusinessStatus(null); return; }
    setBusinessStatus(isOfficeOpen(officeHours, officeTimezone));
    const timer = setInterval(() => {
      setBusinessStatus(isOfficeOpen(officeHours, officeTimezone));
    }, 60000);
    return () => clearInterval(timer);
  }, [selectedOfficeId, officeHours, officeTimezone]);

  const isOfficeClosed = businessStatus !== null && !businessStatus.isOpen;

  // Success state - show ticket QR code, tracking link, and share options
  if (ticket) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/5 via-background to-primary/10 p-4">
        <div className="w-full max-w-sm text-center">
          <div className="rounded-xl border border-border bg-card p-8 shadow-lg">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
              <svg
                className="h-8 w-8 text-emerald-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h1 className="mb-1 text-2xl font-bold text-foreground">
              You&apos;re in the Queue!
            </h1>
            <p className="mb-5 text-sm text-muted-foreground">
              Save your QR code or tap below to track your ticket
            </p>

            {/* Ticket number */}
            <div className="mb-5 rounded-lg bg-muted p-4">
              <p className="text-sm font-medium text-muted-foreground">
                Your Ticket Number
              </p>
              <p className="text-4xl font-bold text-primary">
                {ticket.ticket_number}
              </p>
            </div>

            {/* QR Code */}
            {qrDataUrl && (
              <div className="mb-5">
                <div className="mx-auto inline-block rounded-xl border-2 border-dashed border-primary/20 bg-white p-3">
                  <img
                    src={qrDataUrl}
                    alt={`QR code for ticket ${ticket.ticket_number}`}
                    width={200}
                    height={200}
                    className="rounded-lg"
                  />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Scan or screenshot this QR to track from any device
                </p>
              </div>
            )}

            {/* Office / Department / Service info */}
            <div className="mb-5 space-y-2 rounded-lg bg-muted/50 p-4 text-left text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Office</span>
                <span className="font-medium text-foreground">{displayOffice?.name}</span>
              </div>
              {displayDepartment && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Department</span>
                  <span className="font-medium text-foreground">{displayDepartment.name}</span>
                </div>
              )}
              {displayService && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Service</span>
                  <span className="font-medium text-foreground">{displayService.name}</span>
                </div>
              )}
            </div>

            {/* Track button — skip the countdown */}
            <a
              href={`/q/${ticket.qr_token}`}
              className="inline-flex w-full items-center justify-center rounded-xl bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground shadow-lg transition-all hover:bg-primary/90 active:scale-[0.98]"
            >
              <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              Track My Ticket Live
            </a>
          </div>

          {/* Share / Send ticket link */}
          <div className="mt-4">
            <SendTicketLink
              ticketUrl={trackingUrl}
              ticketNumber={ticket.ticket_number}
              officeName={displayOffice?.name ?? ''}
            />
          </div>

          <p className="mt-4 text-xs text-muted-foreground">POWERED BY QFLO</p>
        </div>
      </div>
    );
  }

  // Join form
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#dbeafe_0%,#eff6ff_24%,#ffffff_70%)]">
      {/* Office closed banner */}
      {isOfficeClosed && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-4">
          <div className="mx-auto max-w-5xl text-center">
            <div className="flex items-center justify-center gap-2 text-sm font-semibold text-red-700">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" strokeWidth={2} />
                <path strokeLinecap="round" strokeWidth={2} d="M12 8v4M12 16h.01" />
              </svg>
              <span>
                {businessStatus?.reason === 'holiday' && businessStatus?.holidayName
                  ? `Closed for ${businessStatus.holidayName}`
                  : businessStatus?.reason === 'before_hours' && businessStatus?.todayHours
                  ? `Not open yet — opens at ${businessStatus.todayHours.open}`
                  : businessStatus?.reason === 'after_hours'
                  ? 'Closed for the day'
                  : 'This location is currently closed'}
              </span>
            </div>
            {businessStatus?.nextOpen && (
              <p className="mt-1 text-xs text-red-600">
                Opens {capitalizeDay(businessStatus.nextOpen.day)} at {businessStatus.nextOpen.time}
              </p>
            )}
            {officeHours && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-medium text-red-600 hover:text-red-700">
                  View business hours
                </summary>
                <div className="mt-2 inline-block rounded-lg bg-white/60 px-4 py-2 text-xs text-foreground">
                  {formatOperatingHours(officeHours).map(({ day, hours }) => (
                    <div key={day} className="flex justify-between gap-4">
                      <span className="font-medium">{capitalizeDay(day).slice(0, 3)}</span>
                      <span className={hours === 'Closed' ? 'text-muted-foreground' : ''}>{hours}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        </div>
      )}

      {/* Active ticket recovery banner */}
      {existingTicket && (
        <div className="border-b border-primary/20 bg-primary/5 px-4 py-3">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-foreground">
              <svg className="h-5 w-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
              </svg>
              <span>
                You already have ticket <strong>{existingTicket.ticket_number}</strong>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={`/q/${existingTicket.qr_token}`}
                className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90"
              >
                Track Ticket
              </a>
              <button
                type="button"
                onClick={() => {
                  localStorage.removeItem('qf_active_ticket');
                  setExistingTicket(null);
                }}
                className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted transition"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="border-b border-border/70 bg-white/90 px-4 pb-8 pt-6 backdrop-blur sm:px-6">
        <div className="mx-auto max-w-5xl">
          <div className="flex flex-col items-center gap-4 text-center">
            {organization?.logo_url ? (
              <div className="flex h-20 w-20 items-center justify-center rounded-[1.75rem] border border-border bg-white shadow-sm sm:h-24 sm:w-24">
                <img
                  src={organization.logo_url}
                  alt={`${orgName} logo`}
                  className="max-h-14 w-auto max-w-[56px] object-contain sm:max-h-16 sm:max-w-[64px]"
                />
              </div>
            ) : null}
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary/80">
                {orgName}
              </p>
              <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-5xl">
                {resolvedPublicJoin.headline}
              </h1>
              <p className="mt-2 text-base text-slate-600 sm:text-lg">
                {displayOffice?.name ?? resolvedPublicJoin.subheadline}
              </p>
            </div>
          </div>

          <div className="mx-auto mt-4 max-w-2xl space-y-1 rounded-[1.25rem] border border-primary/10 bg-primary/5 px-4 py-4 text-sm text-slate-700 shadow-sm">
          {displayDepartment && (
            <div className="flex items-center gap-2">
              <svg className="h-4 w-4 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              <span>{displayDepartment.name}</span>
            </div>
          )}
          {displayService && (
            <div className="flex items-center gap-2">
              <svg className="h-4 w-4 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <span>{displayService.name}</span>
            </div>
          )}
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-6">
        {/* Estimated wait */}
        {(currentWait !== null || waitingCount > 0) && (
          <div className="rounded-[1.5rem] border border-border bg-white p-5 shadow-sm">
            <div className="grid gap-4 text-center sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Estimated Wait Time</p>
                <p className="mt-1 text-3xl font-black text-primary sm:text-4xl">
                  {currentWait ?? '--'}
                  <span className="text-sm font-normal text-muted-foreground"> min</span>
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">People Waiting</p>
                <p className="mt-1 text-3xl font-black text-slate-950 sm:text-4xl">
                  {waitingCount}
                </p>
              </div>
            </div>
          </div>
        )}

        {!officeLocked && availableOffices.length > 1 && (
          <div className="rounded-[1.5rem] border border-border bg-white p-5 shadow-sm">
            <label className="mb-3 block text-base font-semibold text-foreground">
              Select a {resolvedVocabulary.officeLabel} <span className="text-destructive">*</span>
            </label>
            <div className="space-y-2">
              {availableOffices.map((item: any) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setSelectedOfficeId(item.id);
                    setSelectedDepartmentId('');
                    setSelectedServiceId('');
                    setCurrentWait(null);
                  }}
                  className={`${selectionCardClass} ${
                    selectedOfficeId === item.id
                      ? selectionActiveClass
                      : selectionIdleClass
                  }`}
                >
                  <p className="text-lg font-semibold text-foreground">{item.name}</p>
                  {item.address && (
                    <p className="mt-1 text-sm text-muted-foreground">{item.address}</p>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {!departmentLocked && availableDepartments.length > 0 && (
          <div className="rounded-[1.5rem] border border-border bg-white p-5 shadow-sm">
            <label className="mb-3 block text-base font-semibold text-foreground">
              Select a {resolvedVocabulary.departmentLabel} <span className="text-destructive">*</span>
            </label>
            <div className="space-y-2">
              {availableDepartments.map((item: any) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setSelectedDepartmentId(item.id);
                    setSelectedServiceId('');
                    setCurrentWait(null);
                  }}
                  className={`${selectionCardClass} ${
                    selectedDepartmentId === item.id
                      ? selectionActiveClass
                      : selectionIdleClass
                  }`}
                >
                  <p className="text-lg font-semibold text-foreground">{item.name}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {!departmentLocked && selectedOfficeId && availableDepartments.length === 0 && (
            <div className="mb-6 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
            No active {resolvedVocabulary.departmentLabel.toLowerCase()}s are available for this {resolvedVocabulary.officeLabel.toLowerCase()} yet.
          </div>
        )}

        {/* Service selection (if not specific) */}
        {!resolvedHasSpecific && availableServices.length > 0 && (
          <div className="rounded-[1.5rem] border border-border bg-white p-5 shadow-sm">
            <label className="mb-3 block text-base font-semibold text-foreground">
              Select a {resolvedVocabulary.serviceLabel} <span className="text-destructive">*</span>
            </label>
            <div className="space-y-2">
              {availableServices.map((svc: any) => (
                <button
                  key={svc.id}
                  type="button"
                  onClick={() => handleServiceChange(svc.id, selectedDepartmentId)}
                  className={`${selectionCardClass} ${
                    selectedServiceId === svc.id
                      ? selectionActiveClass
                      : selectionIdleClass
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-lg font-semibold text-foreground">{svc.name}</p>
                  {svc.description && (
                        <p className="mt-1 text-sm text-muted-foreground">{svc.description}</p>
                  )}
                  {svc.estimated_service_time && (
                        <p className="mt-2 text-sm font-medium text-primary/80">
                      Est. {svc.estimated_service_time} min
                    </p>
                  )}
                    </div>
                    <div className="rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">
                      Select
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {!serviceLocked && selectedDepartmentId && availableServices.length === 0 && (
          <div className="mb-6 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
            No active {resolvedVocabulary.serviceLabel.toLowerCase()}s are available for this {resolvedVocabulary.departmentLabel.toLowerCase()} yet.
          </div>
        )}

        <div className="rounded-[1.5rem] border border-border bg-white p-5 shadow-sm">
        <h2 className="mb-1 text-xl font-semibold text-foreground">Your Details</h2>
        <p className="mb-6 text-sm text-muted-foreground">
          Enter your information to join the {resolvedVocabulary.queueLabel.toLowerCase()}.
        </p>

        <form onSubmit={handleJoinQueue} className="space-y-5">
          <div>
            <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-foreground">
              {resolvedPublicJoin.namedPartyLabel}{' '}
              <span className="text-muted-foreground font-normal">
                {resolvedPublicJoin.requireCustomerName ? '(required)' : '(optional)'}
              </span>
            </label>
            <input
              id="name"
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder={`Enter ${resolvedPublicJoin.namedPartyLabel.toLowerCase()}`}
              autoComplete="name"
              required={resolvedPublicJoin.requireCustomerName}
              className="w-full rounded-xl border border-input bg-background px-4 py-3 text-base text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <div>
            <label htmlFor="phone" className="mb-1.5 block text-sm font-medium text-foreground">
              Phone <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <input
              id="phone"
              type="tel"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="Enter your phone number"
              autoComplete="tel"
              className="w-full rounded-xl border border-input bg-background px-4 py-3 text-base text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            {smsBackupEnabled && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                Add a mobile number if you want guaranteed text backup alerts for urgent queue updates.
              </p>
            )}
          </div>

          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-foreground">
              Email{' '}
              {emailOtpRequired ? (
                <span className="text-destructive">*</span>
              ) : (
                <span className="text-muted-foreground font-normal">(optional)</span>
              )}
            </label>
            <input
              id="email"
              type="email"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              placeholder="Enter your email address"
              autoComplete="email"
              className="w-full rounded-xl border border-input bg-background px-4 py-3 text-base text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            {emailOtpRequired ? (
              <p className="mt-1.5 text-xs text-muted-foreground">
                This business requires email verification before customers can join the queue.
              </p>
            ) : null}
          </div>

          {emailOtpRequired ? (
            <div className="space-y-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
              <div>
                <p className="text-sm font-semibold text-foreground">Email verification</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Send a short code to your email, then enter it here to continue.
                </p>
              </div>

              {emailOtpVerified ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  Email verified. You can join the queue now.
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <button
                      type="button"
                      onClick={handleSendEmailOtp}
                      disabled={
                        sendingEmailOtp ||
                        !customerEmail.trim() ||
                        emailOtpResendRemainingSeconds > 0
                      }
                      className="rounded-xl border border-primary/20 bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {sendingEmailOtp
                        ? 'Sending code...'
                        : emailOtpSent
                          ? emailOtpResendRemainingSeconds > 0
                            ? `Resend in ${emailOtpResendRemainingSeconds}s`
                            : 'Resend code'
                          : 'Send verification code'}
                    </button>
                    <p className="text-xs text-muted-foreground">
                      Resend available after about {emailOtpResendCooldownSeconds} seconds.
                    </p>
                  </div>

                  {emailOtpSent ? (
                    <div className="space-y-3">
                      <div>
                        <label
                          htmlFor="email-otp"
                          className="mb-1.5 block text-sm font-medium text-foreground"
                        >
                          Verification code
                        </label>
                        <input
                          id="email-otp"
                          type="text"
                          inputMode="numeric"
                          value={emailOtpCode}
                          onChange={(e) => setEmailOtpCode(e.target.value.replace(/\s+/g, ''))}
                          placeholder="Enter the code from your email"
                          className="w-full rounded-xl border border-input bg-background px-4 py-3 text-base text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleVerifyEmailOtp}
                        disabled={verifyingEmailOtp || !emailOtpCode.trim()}
                        className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {verifyingEmailOtp ? 'Verifying...' : 'Verify email'}
                      </button>
                    </div>
                  ) : null}
                </>
              )}

              {emailOtpMessage ? (
                <p className="text-sm text-muted-foreground">{emailOtpMessage}</p>
              ) : null}
            </div>
          ) : null}

          {error && (
            <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={joining || isOfficeClosed || (emailOtpRequired && !emailOtpVerified)}
            className="w-full rounded-[1.1rem] bg-primary px-6 py-4 text-base font-semibold text-primary-foreground shadow-[0_18px_40px_rgba(37,99,235,0.22)] transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isOfficeClosed ? (
              'Office Closed'
            ) : joining ? (
              <span className="flex items-center justify-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                Joining Queue...
              </span>
            ) : (
              `Join ${resolvedVocabulary.queueLabel}`
            )}
          </button>
        </form>
        </div>

          </div>

          <aside className="space-y-6">
            <div className="rounded-[1.5rem] border border-border bg-white p-5 shadow-sm">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
                How it works
              </p>
              <div className="mt-4 space-y-4 text-sm text-slate-600">
                <div>
                  <p className="font-semibold text-slate-950">1. Choose your queue</p>
                  <p className="mt-1">
                    Pick the right {resolvedVocabulary.officeLabel.toLowerCase()},
                    {' '}{resolvedVocabulary.departmentLabel.toLowerCase()}, and {resolvedVocabulary.serviceLabel.toLowerCase()} for your visit.
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-slate-950">2. Join remotely</p>
                  <p className="mt-1">Get a live ticket without standing in line on site.</p>
                </div>
                <div>
                  <p className="font-semibold text-slate-950">3. Track your turn</p>
                  <p className="mt-1">Follow your ticket and come forward when you are called.</p>
                </div>
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-border bg-white p-5 shadow-sm">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
                Before you join
              </p>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Use your normal phone number if you want alert backups. You can wait anywhere after joining and track your place live.
              </p>
            </div>
          </aside>
        </div>

        <div className="mt-6 rounded-[1.25rem] border border-border/70 bg-white/70 p-4 shadow-sm">
          <p className="text-center text-xs text-muted-foreground">
            After joining, you&apos;ll receive a ticket to track your position.
            You can wait anywhere and come when it&apos;s almost your turn.
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 pb-6 pt-2 text-center">
        <p className="text-xs text-muted-foreground">POWERED BY QFLO</p>
      </div>
    </div>
  );
}
