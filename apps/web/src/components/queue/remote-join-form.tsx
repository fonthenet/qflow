'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PublicJoinProfile, TemplateVocabulary } from '@queueflow/shared';
import { createClient } from '@/lib/supabase/client';
import { useI18n } from '@/components/providers/locale-provider';
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
  whatsappEnabled?: boolean;
  whatsappBusinessPhone?: string;
  whatsappCode?: string;
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
  whatsappEnabled = false,
  whatsappBusinessPhone = '',
  whatsappCode = '',
}: RemoteJoinFormProps) {
  const router = useRouter();
  const { t } = useI18n();
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
        source: 'qr_code',
      });

      if (result.error || !result.data) {
        throw new Error(result.error ? t(result.error) : t('Failed to join queue. Please try again.'));
      }

      setTicket({
        ticket_number: result.data.ticket_number,
        qr_token: result.data.qr_token,
      });
    } catch (err: any) {
      setError(err?.message ?? t('Failed to join queue. Please try again.'));
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
  const publicJoinHeading = t('Join the Queue');
  const publicJoinSubheadline = t(resolvedPublicJoin.subheadline);
  const namedPartyLabel = t(resolvedPublicJoin.namedPartyLabel);
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

  // Success state - show ticket and link to tracking
  if (ticket) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/5 via-background to-primary/10 p-4">
        <div className="w-full max-w-sm text-center">
          <div className="rounded-xl border border-border bg-card p-8 shadow-lg">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <svg
                className="h-8 w-8 text-primary"
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
            <h1 className="mb-2 text-2xl font-bold text-foreground">
              You&apos;re in the Queue!
            </h1>
            <p className="mb-6 text-sm text-muted-foreground">
              You have successfully joined the queue remotely.
            </p>

            <div className="mb-6 rounded-lg bg-muted p-4">
              <p className="text-sm font-medium text-muted-foreground">
                Your Ticket Number
              </p>
              <p className="text-4xl font-bold text-primary">
                {ticket.ticket_number}
              </p>
            </div>

            <div className="space-y-2 rounded-lg bg-muted/50 p-4 text-left text-sm">
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

            <a
              href={`/q/${ticket.qr_token}`}
              className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-lg transition-all hover:bg-primary/90 active:scale-[0.98]"
            >
              Track Your Position
            </a>
          </div>

          <p className="mt-4 text-xs text-muted-foreground">POWERED BY QFLO</p>
        </div>
      </div>
    );
  }

  // Join form
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#dbeafe_0%,#eff6ff_24%,#ffffff_70%)]">
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
                {publicJoinHeading}
              </h1>
              <p className="mt-2 text-base text-slate-600 sm:text-lg">
                {displayOffice?.name ?? publicJoinSubheadline}
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
        <div className="mx-auto max-w-4xl space-y-6">
        {/* Estimated wait */}
        {(currentWait !== null || waitingCount > 0) && (
          <div className="rounded-[1.5rem] border border-border bg-white p-5 shadow-sm">
            <div className="grid gap-4 text-center sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground">{t('Estimated Wait Time')}</p>
                <p className="mt-1 text-3xl font-black text-primary sm:text-4xl">
                  {currentWait ?? '--'}
                  <span className="text-sm font-normal text-muted-foreground"> min</span>
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">{t('People Waiting')}</p>
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
                      {t('Approximate timing')}: {t('{count} min', { count: svc.estimated_service_time })}
                    </p>
                  )}
                    </div>
                    <div className="rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">
                      {t('Select')}
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
        <h2 className="mb-1 text-xl font-semibold text-foreground">{t('Your Details')}</h2>
        <p className="mb-6 text-sm text-muted-foreground">
          {t('Enter your information to join the {queueLabel}.', {
            queueLabel: resolvedVocabulary.queueLabel.toLowerCase(),
          })}
        </p>

        <form onSubmit={handleJoinQueue} className="space-y-5">
          <div>
            <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-foreground">
              {namedPartyLabel}{' '}
              <span className="text-muted-foreground font-normal">
                {resolvedPublicJoin.requireCustomerName ? t('(required)') : t('(optional)')}
              </span>
            </label>
            <input
              id="name"
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder={t('Enter {label}', { label: namedPartyLabel.toLowerCase() })}
              autoComplete="name"
              required={resolvedPublicJoin.requireCustomerName}
              className="w-full rounded-xl border border-input bg-background px-4 py-3 text-base text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <div>
            <label htmlFor="phone" className="mb-1.5 block text-sm font-medium text-foreground">
              {t('Phone')} <span className="text-muted-foreground font-normal">{t('(optional)')}</span>
            </label>
            <input
              id="phone"
              type="tel"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder={t('Enter your phone number')}
              autoComplete="tel"
              className="w-full rounded-xl border border-input bg-background px-4 py-3 text-base text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            {smsBackupEnabled && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                {t('Add a mobile number if you want guaranteed text backup alerts for urgent queue updates.')}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-foreground">
              {t('Email')}{' '}
              {emailOtpRequired ? (
                <span className="text-destructive">*</span>
              ) : (
                <span className="text-muted-foreground font-normal">{t('(optional)')}</span>
              )}
            </label>
            <input
              id="email"
              type="email"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              placeholder={t('Enter your email address')}
              autoComplete="email"
              className="w-full rounded-xl border border-input bg-background px-4 py-3 text-base text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            {emailOtpRequired ? (
              <p className="mt-1.5 text-xs text-muted-foreground">
                {t('This business requires email verification before customers can join the queue.')}
              </p>
            ) : null}
          </div>

          {emailOtpRequired ? (
            <div className="space-y-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
              <div>
                <p className="text-sm font-semibold text-foreground">{t('Email verification')}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('Send a short code to your email, then enter it here to continue.')}
                </p>
              </div>

              {emailOtpVerified ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  {t('Email verified. You can join the queue now.')}
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
                        ? t('Sending code...')
                        : emailOtpSent
                          ? emailOtpResendRemainingSeconds > 0
                            ? t('Resend in {seconds}s', { seconds: emailOtpResendRemainingSeconds })
                            : t('Resend code')
                          : t('Send verification code')}
                    </button>
                    <p className="text-xs text-muted-foreground">
                      {t('Resend available after about {seconds} seconds.', {
                        seconds: emailOtpResendCooldownSeconds,
                      })}
                    </p>
                  </div>

                  {emailOtpSent ? (
                    <div className="space-y-3">
                      <div>
                        <label
                          htmlFor="email-otp"
                          className="mb-1.5 block text-sm font-medium text-foreground"
                        >
                          {t('Verification code')}
                        </label>
                        <input
                          id="email-otp"
                          type="text"
                          inputMode="numeric"
                          value={emailOtpCode}
                          onChange={(e) => setEmailOtpCode(e.target.value.replace(/\s+/g, ''))}
                          placeholder={t('Enter the code from your email')}
                          className="w-full rounded-xl border border-input bg-background px-4 py-3 text-base text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleVerifyEmailOtp}
                        disabled={verifyingEmailOtp || !emailOtpCode.trim()}
                        className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {verifyingEmailOtp ? t('Verifying...') : t('Verify email')}
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
            disabled={joining || (emailOtpRequired && !emailOtpVerified)}
            className="w-full rounded-[1.1rem] bg-primary px-6 py-4 text-base font-semibold text-primary-foreground shadow-[0_18px_40px_rgba(37,99,235,0.22)] transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {joining ? (
              <span className="flex items-center justify-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                {t('Joining Queue...')}
              </span>
            ) : (
              t('Join {queueLabel}', { queueLabel: resolvedVocabulary.queueLabel })
            )}
          </button>

          {/* WhatsApp join option */}
          {whatsappEnabled && whatsappBusinessPhone && whatsappCode && (
            <>
              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-white px-3 text-muted-foreground">{t('or')}</span>
                </div>
              </div>
              <a
                href={`https://wa.me/${whatsappBusinessPhone.replace(/\D/g, '')}?text=${encodeURIComponent(`JOIN ${whatsappCode}`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center justify-center gap-2 rounded-[1.1rem] px-6 py-4 text-base font-semibold text-white shadow-lg transition-all hover:opacity-90 active:scale-[0.98]"
                style={{ backgroundColor: '#25D366' }}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                </svg>
                {t('Join via WhatsApp')}
              </a>
            </>
          )}
        </form>
        </div>

        </div>

        <div className="mt-6 rounded-[1.25rem] border border-border/70 bg-white/70 p-4 shadow-sm">
          <p className="text-center text-xs text-muted-foreground">
            {t("After joining, you'll receive a ticket to track your position. You can wait anywhere and come when it's almost your turn.")}
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
