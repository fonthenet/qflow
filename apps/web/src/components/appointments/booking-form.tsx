'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Calendar, CalendarPlus, Clock, MapPin, Check, User, Bell } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  clearBookingEmailOtpVerification,
  createAppointment,
  createRecurringAppointments,
  getAvailableSlots,
  joinSlotWaitlist,
  markBookingEmailOtpVerified,
  updateAppointmentContact,
} from '@/lib/actions/appointment-actions';
import { buildBookingCheckInPath } from '@/lib/office-links';
import { useI18n } from '@/components/providers/locale-provider';

interface BookingFormProps {
  office: any;
  organization: any;
  departments: any[];
  initialDepartmentId?: string;
  initialServiceId?: string;
  platformContext?: {
    vertical?: string;
    vocabulary?: {
      officeLabel?: string;
      departmentLabel?: string;
      serviceLabel?: string;
      deskLabel?: string;
      customerLabel?: string;
      bookingLabel?: string;
      queueLabel?: string;
    };
  };
  sandbox?: {
    enabled: boolean;
    trackPath: string;
    sampleSlots?: string[];
  };
}

type Step = 'department' | 'service' | 'provider' | 'date' | 'time' | 'info' | 'confirm' | 'done';

export function BookingForm({
  office,
  organization,
  departments,
  initialDepartmentId,
  initialServiceId,
  platformContext,
  sandbox,
}: BookingFormProps) {
  const { t, formatDate, formatTime } = useI18n();
  const sandboxMode = Boolean(sandbox?.enabled);
  const vocabulary = {
    officeLabel: platformContext?.vocabulary?.officeLabel ?? 'Location',
    departmentLabel: platformContext?.vocabulary?.departmentLabel ?? 'Department',
    serviceLabel: platformContext?.vocabulary?.serviceLabel ?? 'Service',
    bookingLabel: platformContext?.vocabulary?.bookingLabel ?? 'Appointment',
    customerLabel: platformContext?.vocabulary?.customerLabel ?? 'Customer',
  };
  const hasSingleDepartment = departments.length === 1;
  const bookingLabelLower = vocabulary.bookingLabel.toLowerCase();
  const departmentLabelLower = vocabulary.departmentLabel.toLowerCase();
  const serviceLabelLower = vocabulary.serviceLabel.toLowerCase();
  const bookingActionLabel =
    vocabulary.bookingLabel === 'Appointment'
      ? t('Book an Appointment')
      : t('Book a {label}', { label: vocabulary.bookingLabel });
  const resolvedInitialDepartment =
    departments.find((department) => department.id === initialDepartmentId) ??
    (hasSingleDepartment ? departments[0] : null) ??
    departments.find((department) =>
      department.services?.some((service: any) => service.id === initialServiceId)
    ) ??
    null;
  const resolvedInitialService =
    resolvedInitialDepartment?.services?.find((service: any) => service.id === initialServiceId) ??
    null;
  const initialStep: Step = resolvedInitialService
    ? 'date'
    : resolvedInitialDepartment
      ? 'service'
      : 'department';

  const [step, setStep] = useState<Step>(initialStep);
  const [selectedDept, setSelectedDept] = useState<any>(resolvedInitialDepartment);
  const [selectedService, setSelectedService] = useState<any>(resolvedInitialService);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appointment, setAppointment] = useState<any>(null);
  const [editingBookedInfo, setEditingBookedInfo] = useState(false);
  const [savingBookedInfo, setSavingBookedInfo] = useState(false);
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [staffMembers, setStaffMembers] = useState<any[]>([]);
  const [loadingStaff, setLoadingStaff] = useState(false);
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceRule, setRecurrenceRule] = useState<'weekly' | 'biweekly' | 'monthly'>('weekly');
  const [recurrenceCount, setRecurrenceCount] = useState(4);
  const [recurringAppointments, setRecurringAppointments] = useState<any[] | null>(null);
  const [waitlistSlot, setWaitlistSlot] = useState<string | null>(null);
  const [waitlistName, setWaitlistName] = useState('');
  const [waitlistPhone, setWaitlistPhone] = useState('');
  const [waitlistEmail, setWaitlistEmail] = useState('');
  const [waitlistSubmitting, setWaitlistSubmitting] = useState(false);
  const [waitlistSuccess, setWaitlistSuccess] = useState(false);
  const [sendingEmailOtp, setSendingEmailOtp] = useState(false);
  const [verifyingEmailOtp, setVerifyingEmailOtp] = useState(false);
  const [emailOtpCode, setEmailOtpCode] = useState('');
  const [emailOtpSent, setEmailOtpSent] = useState(false);
  const [emailOtpVerified, setEmailOtpVerified] = useState(false);
  const [emailOtpMessage, setEmailOtpMessage] = useState<string | null>(null);
  const [emailOtpResendRemainingSeconds, setEmailOtpResendRemainingSeconds] =
    useState(0);
  const [supabase] = useState(() => createClient());

  const today = new Date().toISOString().split('T')[0];
  const orgSettings = organization?.settings ?? {};
  const bookingEmailOtpEnabled = Boolean(orgSettings.email_otp_enabled);
  const bookingEmailOtpRequired = Boolean(
    orgSettings.email_otp_enabled && orgSettings.email_otp_required_for_booking
  );
  const bookingEmailOtpExpiryMinutes = Number(
    orgSettings.email_otp_code_expiry_minutes ?? 10
  );
  const bookingEmailOtpResendCooldownSeconds = Number(
    orgSettings.email_otp_resend_cooldown_seconds ?? 60
  );

  // Fetch available slots when date changes
  useEffect(() => {
    if (!selectedDate || !selectedService) return;
    if (sandboxMode) {
      setAvailableSlots(sandbox?.sampleSlots ?? ['09:00', '09:30', '10:00', '10:30', '11:00']);
      setLoadingSlots(false);
      return;
    }
    setLoadingSlots(true);
    setSelectedTime('');
    getAvailableSlots(office.id, selectedService.id, selectedDate).then((result) => {
      if (result.error) {
        setError(result.error);
        setAvailableSlots([]);
      } else {
        setAvailableSlots(result.data ?? []);
      }
      setLoadingSlots(false);
    });
  }, [sandboxMode, sandbox?.sampleSlots, selectedDate, selectedService, office.id]);

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

  function handleSelectDepartment(dept: any) {
    setSelectedDept(dept);
    setSelectedService(null);
    setSelectedDate('');
    setSelectedTime('');
    setStep('service');
  }

  function handleSelectService(service: any) {
    setSelectedService(service);
    setSelectedDate('');
    setSelectedTime('');
    setSelectedStaffId(null);
    // Fetch staff for the selected service's office
    setLoadingStaff(true);
    supabase.from('staff')
      .select('id, full_name')
      .eq('office_id', office.id)
      .eq('is_active', true)
      .order('full_name')
      .then(({ data }) => {
        const members = data ?? [];
        setStaffMembers(members);
        setLoadingStaff(false);
        if (members.length > 0) {
          setStep('provider');
        } else {
          setStep('date');
        }
      });
  }

  function handleSelectProvider(staffId: string | null) {
    setSelectedStaffId(staffId);
    setStep('date');
  }

  function handleSelectDate() {
    if (!selectedDate) return;
    setStep('time');
  }

  function handleSelectTime(time: string) {
    setSelectedTime(time);
    setStep('info');
  }

  function handleCustomerInfo() {
    if (!customerName.trim()) {
      setError(t('Please enter your name'));
      return;
    }
    if (bookingEmailOtpRequired && !customerEmail.trim()) {
      setError(t('Please enter your email to verify this booking.'));
      return;
    }
    setError(null);
    setStep('confirm');
  }

  async function handleConfirm() {
    if (bookingEmailOtpRequired && !emailOtpVerified) {
      setError(t('Please verify your email before confirming this booking.'));
      return;
    }

    setSubmitting(true);
    setError(null);

    const scheduledAt = `${selectedDate}T${selectedTime}:00`;

    if (sandboxMode) {
      setAppointment({
        id: crypto.randomUUID(),
        sandbox_reference: `SBX-${Math.floor(1000 + Math.random() * 8999)}`,
        customer_name: customerName.trim(),
        customer_phone: customerPhone.trim() || null,
        customer_email: customerEmail.trim() || null,
        scheduled_at: scheduledAt,
      });
      setStep('done');
      setSubmitting(false);
      return;
    }

    const baseData = {
      officeId: office.id,
      departmentId: selectedDept.id,
      serviceId: selectedService.id,
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim() || undefined,
      customerEmail: customerEmail.trim() || undefined,
      scheduledAt,
      ...(selectedStaffId ? { staffId: selectedStaffId } : {}),
    };

    if (isRecurring) {
      const result = await createRecurringAppointments({
        ...baseData,
        recurrenceRule,
        recurrenceCount,
      });

      if (result.error && !result.data) {
        setError(result.error);
        setSubmitting(false);
        return;
      }

      const allAppointments = result.data as any[];
      setRecurringAppointments(allAppointments);
      setAppointment(allAppointments[0]);
      setStep('done');
      setSubmitting(false);
      return;
    }

    const result = await createAppointment(baseData);

    if (result.error) {
      setError(result.error);
      setSubmitting(false);
      return;
    }

    setAppointment(result.data);
    setStep('done');
    setSubmitting(false);
  }

  async function handleSendEmailOtp() {
    const email = customerEmail.trim().toLowerCase();
    if (!email) {
      setError(t('Please enter your email to receive a verification code.'));
      return;
    }

    setSendingEmailOtp(true);
    setError(null);
    setEmailOtpMessage(null);

    if (sandboxMode) {
      setEmailOtpSent(true);
      setEmailOtpVerified(false);
      setEmailOtpResendRemainingSeconds(bookingEmailOtpResendCooldownSeconds);
      setEmailOtpMessage(
        `Sandbox code sent. Use 123456 to continue.`
      );
      setSendingEmailOtp(false);
      return;
    }

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
    setEmailOtpResendRemainingSeconds(bookingEmailOtpResendCooldownSeconds);
    setEmailOtpMessage(
      `Verification code sent. It stays valid for ${bookingEmailOtpExpiryMinutes} minutes.`
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

    if (sandboxMode) {
      if (emailOtpCode.trim() !== '123456') {
        setError('Sandbox code is 123456.');
        setVerifyingEmailOtp(false);
        return;
      }

      setEmailOtpVerified(true);
      setEmailOtpMessage('Email verified in sandbox mode.');
      setVerifyingEmailOtp(false);
      return;
    }

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
      officeId: office.id,
      expiresInMinutes: bookingEmailOtpExpiryMinutes,
    });

    await supabase.auth.signOut();

    setEmailOtpVerified(true);
    setEmailOtpMessage('Email verified. You can confirm the booking now.');
    setVerifyingEmailOtp(false);
  }

  function handleBack() {
    setError(null);
    switch (step) {
      case 'service':
        setStep('department');
        break;
      case 'provider':
        setStep('service');
        break;
      case 'date':
        setStep(staffMembers.length > 0 ? 'provider' : 'service');
        break;
      case 'time':
        setStep('date');
        break;
      case 'info':
        setStep('time');
        break;
      case 'confirm':
        setStep('info');
        break;
    }
  }

  function handleStartOver() {
    setStep(hasSingleDepartment ? 'service' : 'department');
    setSelectedDept(hasSingleDepartment ? departments[0] : null);
    setSelectedService(null);
    setSelectedDate('');
    setSelectedTime('');
    setCustomerName('');
    setCustomerPhone('');
    setCustomerEmail('');
    setAppointment(null);
    setSelectedStaffId(null);
    setStaffMembers([]);
    setIsRecurring(false);
    setRecurrenceRule('weekly');
    setRecurrenceCount(4);
    setRecurringAppointments(null);
    setEditingBookedInfo(false);
    setEmailOtpCode('');
    setEmailOtpSent(false);
    setEmailOtpVerified(false);
    setEmailOtpMessage(null);
    setEmailOtpResendRemainingSeconds(0);
    setError(null);
    if (!sandboxMode) {
      void clearBookingEmailOtpVerification();
    }
  }

  async function handleSaveBookedInfo() {
    if (!appointment?.id) return;
    if (!customerName.trim()) {
      setError('Please enter your name');
      return;
    }

    setSavingBookedInfo(true);
    setError(null);

    if (sandboxMode) {
      setAppointment((current: any) => ({
        ...current,
        customer_name: customerName.trim(),
        customer_phone: customerPhone.trim() || null,
        customer_email: customerEmail.trim() || null,
      }));
      setEditingBookedInfo(false);
      setSavingBookedInfo(false);
      return;
    }

    const result = await updateAppointmentContact({
      appointmentId: appointment.id,
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim() || undefined,
      customerEmail: customerEmail.trim() || undefined,
    });

    if (result.error) {
      setError(result.error);
      setSavingBookedInfo(false);
      return;
    }

    setAppointment(result.data);
    setEditingBookedInfo(false);
    setSavingBookedInfo(false);
  }

  const totalSteps = staffMembers.length > 0 ? 7 : 6;
  const stepNumber = staffMembers.length > 0
    ? { department: 1, service: 2, provider: 3, date: 4, time: 5, info: 6, confirm: 7, done: 8 }[step]
    : { department: 1, service: 2, provider: 3, date: 3, time: 4, info: 5, confirm: 6, done: 7 }[step];

  function formatSlotTime(time: string) {
    return formatTime(`2000-01-01T${time}:00`, {
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  function formatSelectedDate(dateStr: string) {
    return formatDate(`${dateStr}T12:00:00`, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-primary/10">
      {sandboxMode ? (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm font-medium text-amber-900">
          {t('Sandbox mode. This booking flow looks and behaves like the live page, but it never creates a real reservation or sends alerts.')}
        </div>
      ) : null}
      {/* Header */}
      <div className="border-b border-border bg-card px-6 py-4 text-center">
        <div className="flex flex-col items-center justify-center gap-3">
          {organization?.logo_url ? (
            <img
              src={organization.logo_url}
              alt={t('{name} logo', { name: organization?.name || t('Business') })}
              className="max-h-24 w-auto max-w-[280px] object-contain"
            />
          ) : null}
          <h1 className="text-2xl font-bold text-foreground">
            {organization?.name || 'Qflo'}
          </h1>
        </div>
        <div className="mt-1 flex items-center justify-center gap-1.5 text-muted-foreground">
          <MapPin className="h-4 w-4" />
          <span>{office.name}</span>
        </div>
        <p className="mt-1 text-sm font-medium text-primary">{bookingActionLabel}</p>
      </div>

      {/* Progress bar */}
      {step !== 'done' && (
        <div className="mx-auto max-w-2xl px-4 pt-6">
          <div className="mb-2 flex items-center gap-2">
            {Array.from({ length: totalSteps }, (_, i) => i + 1).map((s) => (
              <div
                key={s}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  s <= (stepNumber ?? 0) ? 'bg-primary' : 'bg-muted'
                }`}
              />
            ))}
          </div>
          <p className="text-center text-xs text-muted-foreground">
            {t('Step {step} of {total}', { step: stepNumber, total: totalSteps })}
          </p>
        </div>
      )}

      <div className="mx-auto max-w-2xl px-4 py-6">
        {error && (
          <div className="mb-4 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Step 1: Select Department */}
        {step === 'department' && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-3xl font-bold text-foreground">{`Select ${vocabulary.departmentLabel}`}</h2>
              <p className="mt-2 text-lg text-muted-foreground">
                {t('Choose the {department} for your {booking}', {
                  department: departmentLabelLower,
                  booking: bookingLabelLower,
                })}
              </p>
            </div>
            <div className="grid gap-4">
              {departments.map((dept) => (
                <button
                  key={dept.id}
                  onClick={() => handleSelectDepartment(dept)}
                  className="flex items-center justify-between rounded-xl border border-border bg-card p-6 text-left shadow-sm transition-all hover:border-primary hover:shadow-md"
                >
                  <div>
                    <h3 className="text-xl font-semibold text-foreground">{dept.name}</h3>
                    {dept.description && (
                      <p className="mt-1 text-muted-foreground">{dept.description}</p>
                    )}
                  </div>
                  <div className="text-2xl font-bold text-primary">{dept.code}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: Select Service */}
        {step === 'service' && selectedDept && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-3xl font-bold text-foreground">{selectedDept.name}</h2>
              <p className="mt-2 text-lg text-muted-foreground">
                {hasSingleDepartment
                  ? t('Select {service}', { service: serviceLabelLower })
                  : t('Select a {service}', { service: serviceLabelLower })}
              </p>
            </div>
            <div className="grid gap-4">
              {selectedDept.services
                ?.filter((s: any) => s.is_active)
                ?.sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
                .map((service: any) => (
                  <button
                    key={service.id}
                    onClick={() => handleSelectService(service)}
                    className="flex items-center justify-between rounded-xl border border-border bg-card p-6 text-left shadow-sm transition-all hover:border-primary hover:shadow-md"
                  >
                    <div>
                      <h3 className="text-xl font-semibold text-foreground">{service.name}</h3>
                      {service.description && (
                        <p className="mt-1 text-muted-foreground">{service.description}</p>
                      )}
                      {service.estimated_service_time && (
                        <div className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" />
                          <span>{t('Est. {minutes} min', { minutes: service.estimated_service_time })}</span>
                        </div>
                      )}
                    </div>
                    <div className="text-lg font-bold text-primary">{service.code}</div>
                  </button>
                ))}
            </div>
            <button
              onClick={handleBack}
              className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              {t('Back to {label}', { label: `${vocabulary.departmentLabel}s` })}
            </button>
          </div>
        )}

        {/* Step: Select Provider */}
        {step === 'provider' && (
          <div className="space-y-6">
            <div className="text-center">
              <User className="mx-auto h-10 w-10 text-primary" />
              <h2 className="mt-3 text-3xl font-bold text-foreground">{t('Choose Provider')}</h2>
              <p className="mt-2 text-lg text-muted-foreground">
                {t('Select who you would like to see')}
              </p>
            </div>

            {loadingStaff ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : (
              <div className="grid gap-4">
                <button
                  onClick={() => handleSelectProvider(null)}
                  className={`flex items-center gap-4 rounded-xl border border-border bg-card p-6 text-left shadow-sm transition-all hover:border-primary hover:shadow-md ${
                    selectedStaffId === null ? 'border-primary ring-2 ring-primary/20' : ''
                  }`}
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                    <Clock className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-foreground">{t('First Available')}</h3>
                    <p className="mt-0.5 text-sm text-muted-foreground">{t('Fastest option')}</p>
                  </div>
                </button>
                {staffMembers.map((member) => (
                  <button
                    key={member.id}
                    onClick={() => handleSelectProvider(member.id)}
                    className="flex items-center gap-4 rounded-xl border border-border bg-card p-6 text-left shadow-sm transition-all hover:border-primary hover:shadow-md"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                      <User className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <div>
                      <h3 className="text-xl font-semibold text-foreground">{member.full_name}</h3>
                    </div>
                  </button>
                ))}
              </div>
            )}

            <button
              onClick={handleBack}
              className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              {t('Back')}
            </button>
          </div>
        )}

        {/* Step 3: Select Date */}
        {step === 'date' && (
          <div className="space-y-6">
            <div className="text-center">
              <Calendar className="mx-auto h-10 w-10 text-primary" />
              <h2 className="mt-3 text-3xl font-bold text-foreground">{t('Choose a Date')}</h2>
              <p className="mt-2 text-lg text-muted-foreground">
                {t('Select when you would like to visit for your {booking}', {
                  booking: bookingLabelLower,
                })}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
              <input
                type="date"
                min={today}
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full rounded-xl border border-border bg-muted px-4 py-3 text-lg text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              {selectedDate && (
                <p className="mt-3 text-center text-muted-foreground">
                  {formatSelectedDate(selectedDate)}
                </p>
              )}
            </div>
            <button
              onClick={handleSelectDate}
              disabled={!selectedDate}
              className="w-full rounded-xl bg-primary px-4 py-4 text-lg font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('Continue')}
            </button>
            <button
              onClick={handleBack}
              className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              {t('Back')}
            </button>
          </div>
        )}

        {/* Step 4: Select Time */}
        {step === 'time' && (
          <div className="space-y-6">
            <div className="text-center">
              <Clock className="mx-auto h-10 w-10 text-primary" />
              <h2 className="mt-3 text-3xl font-bold text-foreground">{t('Choose a Time')}</h2>
              <p className="mt-2 text-lg text-muted-foreground">
                {formatSelectedDate(selectedDate)}
              </p>
            </div>

            {loadingSlots ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : availableSlots.length === 0 ? (
              <div className="rounded-xl border border-border bg-card p-6 text-center shadow-sm">
                <p className="text-lg text-muted-foreground">
                  {t('No available time slots for this date.')}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {t('Please choose a different date.')}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {availableSlots.map((slot) => (
                  <button
                    key={slot}
                    onClick={() => handleSelectTime(slot)}
                    className={`rounded-xl border p-3 text-center font-medium transition-all ${
                      selectedTime === slot
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-card text-foreground hover:border-primary hover:shadow-sm'
                    }`}
                  >
                    {formatSlotTime(slot)}
                  </button>
                ))}
              </div>
            )}

            {/* Waitlist for unavailable slots */}
            {!loadingSlots && availableSlots.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                <p className="text-sm font-medium text-muted-foreground">
                  {t('Preferred time not available?')}
                </p>
                {waitlistSlot === null && !waitlistSuccess && (
                  <button
                    type="button"
                    onClick={() => setWaitlistSlot('')}
                    className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                  >
                    <Bell className="h-3.5 w-3.5" />
                    {t('Join Waitlist')}
                  </button>
                )}
                {waitlistSlot !== null && !waitlistSuccess && (
                  <div className="mt-3 space-y-3">
                    <input
                      type="time"
                      value={waitlistSlot}
                      onChange={(e) => setWaitlistSlot(e.target.value)}
                      className="w-full rounded-xl border border-border bg-muted px-4 py-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    />
                    <input
                      type="text"
                      value={waitlistName}
                      onChange={(e) => setWaitlistName(e.target.value)}
                      placeholder={t('Name')}
                      className="w-full rounded-xl border border-border bg-muted px-4 py-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    />
                    <input
                      type="tel"
                      value={waitlistPhone}
                      onChange={(e) => setWaitlistPhone(e.target.value)}
                      placeholder={t('Phone') + ' (' + t('(optional)') + ')'}
                      className="w-full rounded-xl border border-border bg-muted px-4 py-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    />
                    <input
                      type="email"
                      value={waitlistEmail}
                      onChange={(e) => setWaitlistEmail(e.target.value)}
                      placeholder={t('Email') + ' (' + t('(optional)') + ')'}
                      className="w-full rounded-xl border border-border bg-muted px-4 py-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={waitlistSubmitting || !waitlistName.trim() || !waitlistSlot}
                        onClick={async () => {
                          setWaitlistSubmitting(true);
                          const time = waitlistSlot.length === 5 ? waitlistSlot : waitlistSlot.slice(0, 5);
                          const res = await joinSlotWaitlist({
                            officeId: office.id,
                            serviceId: selectedService.id,
                            date: selectedDate,
                            time,
                            customerName: waitlistName.trim(),
                            customerPhone: waitlistPhone.trim() || undefined,
                            customerEmail: waitlistEmail.trim() || undefined,
                          });
                          setWaitlistSubmitting(false);
                          if (!res.error) {
                            setWaitlistSuccess(true);
                          } else {
                            setError(res.error);
                          }
                        }}
                        className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                      >
                        {waitlistSubmitting ? t('Saving...') : t('Join Waitlist')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setWaitlistSlot(null);
                          setWaitlistName('');
                          setWaitlistPhone('');
                          setWaitlistEmail('');
                        }}
                        className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                      >
                        {t('Cancel')}
                      </button>
                    </div>
                  </div>
                )}
                {waitlistSuccess && (
                  <p className="mt-2 text-sm font-medium text-emerald-600">
                    {t('You will be notified when a spot opens')}
                  </p>
                )}
              </div>
            )}

            <button
              onClick={handleBack}
              className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              {t('Back')}
            </button>
          </div>
        )}

        {/* Step 5: Customer Info */}
        {step === 'info' && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-3xl font-bold text-foreground">{t('Your Information')}</h2>
              <p className="mt-2 text-lg text-muted-foreground">
                {t('Please provide your details for this {booking}', { booking: bookingLabelLower })}
              </p>
            </div>

            <div className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  {t('Full Name')} <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder={t('Enter your full name')}
                  className="w-full rounded-xl border border-border bg-muted px-4 py-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  {t('Phone Number')} <span className="text-xs text-muted-foreground">{t('(optional)')}</span>
                </label>
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder={t('Enter your phone number')}
                  className="w-full rounded-xl border border-border bg-muted px-4 py-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  Email{' '}
                  {bookingEmailOtpRequired ? (
                    <span className="text-destructive">*</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">{t('(optional)')}</span>
                  )}
                </label>
                <input
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder={t('Enter your email address')}
                  className="w-full rounded-xl border border-border bg-muted px-4 py-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
                {bookingEmailOtpRequired ? (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {t('This business requires email verification before a booking is confirmed.')}
                  </p>
                ) : null}
              </div>
            </div>

            <button
              onClick={handleCustomerInfo}
              className="w-full rounded-xl bg-primary px-4 py-4 text-lg font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
            >
              {t('Review {label}', { label: vocabulary.bookingLabel })}
            </button>
            <button
              onClick={handleBack}
              className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              {t('Back')}
            </button>
          </div>
        )}

        {/* Step 6: Confirmation */}
        {step === 'confirm' && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-3xl font-bold text-foreground">{`Confirm ${vocabulary.bookingLabel}`}</h2>
              <p className="mt-2 text-lg text-muted-foreground">
                {`Please review your ${bookingLabelLower} details`}
              </p>
            </div>

            <div className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
              <div className="flex justify-between border-b border-border py-2">
                <span className="text-muted-foreground">{vocabulary.departmentLabel}</span>
                <span className="font-medium text-foreground">{selectedDept?.name}</span>
              </div>
              <div className="flex justify-between border-b border-border py-2">
                <span className="text-muted-foreground">{vocabulary.serviceLabel}</span>
                <span className="font-medium text-foreground">{selectedService?.name}</span>
              </div>
              <div className="flex items-center justify-between border-b border-border py-2">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  {t('Date')}
                </span>
                <span className="font-medium text-foreground">{formatSelectedDate(selectedDate)}</span>
              </div>
              <div className="flex items-center justify-between border-b border-border py-2">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  {t('Time')}
                </span>
                <span className="font-medium text-foreground">{formatSlotTime(selectedTime)}</span>
              </div>
              <div className="flex justify-between border-b border-border py-2">
                <span className="text-muted-foreground">{t('Name')}</span>
                <span className="font-medium text-foreground">{customerName}</span>
              </div>
              {customerPhone && (
                <div className="flex justify-between border-b border-border py-2">
                  <span className="text-muted-foreground">{t('Phone')}</span>
                  <span className="font-medium text-foreground">{customerPhone}</span>
                </div>
              )}
              {customerEmail && (
                <div className="flex justify-between py-2">
                  <span className="text-muted-foreground">{t('Email')}</span>
                  <span className="font-medium text-foreground">{customerEmail}</span>
                </div>
              )}
              {selectedStaffId && staffMembers.length > 0 && (
                <div className="flex justify-between border-t border-border py-2">
                  <span className="text-muted-foreground">{t('Provider')}</span>
                  <span className="font-medium text-foreground">
                    {staffMembers.find((m) => m.id === selectedStaffId)?.full_name ?? t('First Available')}
                  </span>
                </div>
              )}
            </div>

            {/* Recurring option */}
            <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={isRecurring}
                  onChange={(e) => setIsRecurring(e.target.checked)}
                  className="h-5 w-5 rounded border-border text-primary focus:ring-primary/20"
                />
                <span className="text-sm font-medium text-foreground">{t('Make this recurring')}</span>
              </label>
              {isRecurring && (
                <div className="mt-4 space-y-3 border-t border-border pt-4">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-foreground">
                      {t('Frequency')}
                    </label>
                    <select
                      value={recurrenceRule}
                      onChange={(e) => setRecurrenceRule(e.target.value as 'weekly' | 'biweekly' | 'monthly')}
                      className="w-full rounded-xl border border-border bg-muted px-4 py-2.5 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    >
                      <option value="weekly">{t('Weekly')}</option>
                      <option value="biweekly">{t('Every 2 Weeks')}</option>
                      <option value="monthly">{t('Monthly')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-foreground">
                      {t('Repeat for')}
                    </label>
                    <div className="flex items-center gap-2">
                      <select
                        value={recurrenceCount}
                        onChange={(e) => setRecurrenceCount(Number(e.target.value))}
                        className="w-24 rounded-xl border border-border bg-muted px-4 py-2.5 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                      >
                        {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                      <span className="text-sm text-muted-foreground">{t('times')}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {bookingEmailOtpRequired ? (
              <div className="space-y-4 rounded-xl border border-primary/20 bg-primary/5 p-6">
                <div>
                  <h3 className="text-base font-semibold text-foreground">{t('Email verification')}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t('We\'ll send a short code to {email} before this {booking} is created.', {
                      email: customerEmail || t('your email'),
                      booking: bookingLabelLower,
                    })}
                  </p>
                </div>

                {emailOtpVerified ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                    {t('Email verified. Your {booking} is ready to confirm.', {
                      booking: bookingLabelLower,
                    })}
                  </div>
                ) : (
                  <>
                    <div className="flex flex-col gap-3 sm:flex-row">
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
                      <p className="self-center text-xs text-muted-foreground">
                        {t('Resend available after about {seconds} seconds.', {
                          seconds: bookingEmailOtpResendCooldownSeconds,
                        })}
                      </p>
                    </div>

                    {emailOtpSent ? (
                      <div className="space-y-3">
                        <div>
                          <label className="mb-1.5 block text-sm font-medium text-foreground">
                            {t('Verification code')}
                          </label>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={emailOtpCode}
                            onChange={(e) => setEmailOtpCode(e.target.value.replace(/\s+/g, ''))}
                            placeholder={t('Enter the code from your email')}
                            className="w-full rounded-xl border border-border bg-card px-4 py-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={handleVerifyEmailOtp}
                          disabled={verifyingEmailOtp || !emailOtpCode.trim()}
                          className="w-full rounded-xl border border-primary bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
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

            <button
              onClick={handleConfirm}
              disabled={submitting || (bookingEmailOtpRequired && !emailOtpVerified)}
              className="w-full rounded-xl bg-primary px-4 py-4 text-lg font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                  {t('{label}...', { label: vocabulary.bookingLabel })}
                </span>
              ) : (
                t('Confirm {label}', { label: vocabulary.bookingLabel })
              )}
            </button>
            <button
              onClick={handleBack}
              disabled={submitting}
              className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              {t('Back')}
            </button>
          </div>
        )}

        {/* Success State */}
        {step === 'done' && appointment && (
          <div className="space-y-6">
            <div className="rounded-xl border border-border bg-card p-8 text-center shadow-sm">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                <Check className="h-8 w-8 text-primary" />
              </div>

              <h2 className="text-2xl font-bold text-foreground">
                {recurringAppointments
                  ? t('{count} {label} booked', { count: recurringAppointments.length, label: bookingLabelLower + 's' })
                  : t('{label} Confirmed!', { label: vocabulary.bookingLabel })}
              </h2>
              <p className="mt-2 text-muted-foreground">
                {recurringAppointments
                  ? t('Your recurring {booking} series has been created.', { booking: bookingLabelLower })
                  : t('Your {booking} has been booked successfully.', { booking: bookingLabelLower })}
              </p>

              <div className="mt-6 rounded-xl bg-muted p-4">
                <p className="text-sm font-medium text-muted-foreground">
                  {t('Reference Number')}
                </p>
                <p className="text-2xl font-bold tracking-wider text-primary">
                  {appointment.id.slice(0, 8).toUpperCase()}
                </p>
              </div>

              <div className="mt-6 space-y-3 text-left">
                <div className="flex items-center gap-3 text-sm text-foreground">
                  <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>
                    <span className="font-medium">{selectedDept?.name}</span>
                    {' - '}
                    {selectedService?.name}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-sm text-foreground">
                  <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>{formatSelectedDate(selectedDate)}</span>
                </div>
                <div className="flex items-center gap-3 text-sm text-foreground">
                  <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>{formatSlotTime(selectedTime)}</span>
                </div>
                <div className="flex items-center gap-3 text-sm text-foreground">
                  <span className="w-4 shrink-0 text-center text-muted-foreground">N</span>
                  <span>{customerName}</span>
                </div>
                {customerPhone && (
                  <div className="flex items-center gap-3 text-sm text-foreground">
                    <span className="w-4 shrink-0 text-center text-muted-foreground">P</span>
                    <span>{customerPhone}</span>
                  </div>
                )}
                {customerEmail && (
                  <div className="flex items-center gap-3 text-sm text-foreground">
                    <span className="w-4 shrink-0 text-center text-muted-foreground">@</span>
                    <span>{customerEmail}</span>
                  </div>
                )}
              </div>

              <div className="mt-6 rounded-xl border border-primary/20 bg-primary/5 p-4">
                <p className="text-sm font-medium text-primary">
                  {vocabulary.bookingLabel === 'Reservation'
                    ? 'Please arrive a few minutes early so the host can seat your party smoothly.'
                    : t('Please arrive a few minutes early to check in.')}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {vocabulary.bookingLabel === 'Reservation'
                    ? t('You can check in with the host stand or online when you arrive.')
                    : t('You can check in at the kiosk or online when you arrive.')}
                </p>
              </div>

              <div className="mt-6 rounded-xl border border-border bg-background p-4 text-left">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {vocabulary.bookingLabel === 'Reservation' ? t('Reservation details') : t('Visit details')}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('Update the contact info on this {booking} if you need to correct it.', {
                        booking: bookingLabelLower,
                      })}
                    </p>
                  </div>
                  {!editingBookedInfo ? (
                    <button
                      type="button"
                      onClick={() => setEditingBookedInfo(true)}
                      className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                    >
                      {t('Edit info')}
                    </button>
                  ) : null}
                </div>

                {editingBookedInfo ? (
                  <div className="mt-4 space-y-3">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-foreground">
                        {t('Full Name')} <span className="text-destructive">*</span>
                      </label>
                      <input
                        type="text"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        className="w-full rounded-xl border border-border bg-muted px-4 py-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-foreground">
                        {t('Phone Number')}
                      </label>
                      <input
                        type="tel"
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                        className="w-full rounded-xl border border-border bg-muted px-4 py-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-foreground">
                        {t('Email')}
                      </label>
                      <input
                        type="email"
                        value={customerEmail}
                        onChange={(e) => setCustomerEmail(e.target.value)}
                        className="w-full rounded-xl border border-border bg-muted px-4 py-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                      />
                    </div>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={handleSaveBookedInfo}
                        disabled={savingBookedInfo}
                        className="flex-1 rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                      >
                        {savingBookedInfo ? t('Saving...') : t('Save changes')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingBookedInfo(false)}
                        disabled={savingBookedInfo}
                        className="flex-1 rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                      >
                        {t('Cancel')}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            {appointment?.calendar_token && !sandboxMode && (
              <a
                href={`/api/calendar/${appointment.calendar_token}`}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-4 py-4 text-lg font-medium text-primary transition-colors hover:bg-primary/10"
              >
                <CalendarPlus className="h-5 w-5" />
                {t('Add to Calendar')}
              </a>
            )}

            <Link
              href={sandboxMode ? sandbox?.trackPath ?? buildBookingCheckInPath(office) : buildBookingCheckInPath(office)}
              className="block w-full rounded-xl border border-border bg-card px-4 py-4 text-center text-lg font-medium text-foreground transition-colors hover:bg-muted"
            >
              {sandboxMode
                ? t('Open Queue Preview')
                : vocabulary.bookingLabel === 'Reservation'
                  ? t('Track or Check In Reservation')
                  : t('Track or Check In Appointment')}
            </Link>
            <button
              onClick={handleStartOver}
              className="w-full rounded-xl bg-primary px-4 py-4 text-lg font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
            >
              {vocabulary.bookingLabel === 'Reservation'
                ? t('Book Another Reservation')
                : t('Book Another Appointment')}
            </button>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 pb-6 text-center">
        <p className="text-xs text-muted-foreground">POWERED BY QFLO</p>
      </div>
    </div>
  );
}
