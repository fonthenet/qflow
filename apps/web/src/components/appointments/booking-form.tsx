'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Calendar, Clock, MapPin, Check } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  clearBookingEmailOtpVerification,
  createAppointment,
  getAvailableSlots,
  markBookingEmailOtpVerified,
  updateAppointmentContact,
} from '@/lib/actions/appointment-actions';

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

type Step = 'department' | 'service' | 'date' | 'time' | 'info' | 'confirm' | 'done';

export function BookingForm({
  office,
  organization,
  departments,
  initialDepartmentId,
  initialServiceId,
  platformContext,
  sandbox,
}: BookingFormProps) {
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
      ? 'Book an Appointment'
      : `Book a ${vocabulary.bookingLabel}`;
  const officeSlug = office.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

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
  const bookingMode = orgSettings.booking_mode ?? 'simple';
  const bookingHorizonDays = Number(orgSettings.booking_horizon_days ?? 7);
  const maxDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() + bookingHorizonDays);
    return d.toISOString().split('T')[0];
  })();
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
      setError('Please enter your name');
      return;
    }
    if (bookingEmailOtpRequired && !customerEmail.trim()) {
      setError('Please enter your email to verify this booking.');
      return;
    }
    setError(null);
    setStep('confirm');
  }

  async function handleConfirm() {
    if (bookingEmailOtpRequired && !emailOtpVerified) {
      setError('Please verify your email before confirming this booking.');
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

    const result = await createAppointment({
      officeId: office.id,
      departmentId: selectedDept.id,
      serviceId: selectedService.id,
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim() || undefined,
      customerEmail: customerEmail.trim() || undefined,
      scheduledAt,
    });

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
      setError('Please enter your email to receive a verification code.');
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
      case 'date':
        setStep('service');
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

  const stepNumber = {
    department: 1,
    service: 2,
    date: 3,
    time: 4,
    info: 5,
    confirm: 6,
    done: 7,
  }[step];

  function formatTime(time: string) {
    const [h, m] = time.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 || 12;
    return `${hour12}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  function formatDate(dateStr: string) {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  if (bookingMode === 'disabled') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-primary/10">
        <div className="mx-auto max-w-lg px-4 py-20 text-center">
          <Calendar className="mx-auto h-16 w-16 text-muted-foreground/50" />
          <h2 className="mt-6 text-2xl font-bold text-foreground">Online Booking Unavailable</h2>
          <p className="mt-3 text-muted-foreground">
            This business does not currently accept online bookings. Please visit in person or contact them directly.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-primary/10">
      {sandboxMode ? (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm font-medium text-amber-900">
          Sandbox mode. This booking flow looks and behaves like the live page, but it never creates a real reservation or sends alerts.
        </div>
      ) : null}
      {/* Header */}
      <div className="border-b border-border bg-card px-6 py-4 text-center">
        <div className="flex flex-col items-center justify-center gap-3">
          {organization?.logo_url ? (
            <img
              src={organization.logo_url}
              alt={`${organization?.name || 'Business'} logo`}
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
            {[1, 2, 3, 4, 5, 6].map((s) => (
              <div
                key={s}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  s <= stepNumber ? 'bg-primary' : 'bg-muted'
                }`}
              />
            ))}
          </div>
          <p className="text-center text-xs text-muted-foreground">
            Step {stepNumber} of 6
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
                {`Choose the ${departmentLabelLower} for your ${bookingLabelLower}`}
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
                {`Select ${hasSingleDepartment ? serviceLabelLower : `a ${serviceLabelLower}`}`}
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
                          <span>Est. {service.estimated_service_time} min</span>
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
              {`Back to ${vocabulary.departmentLabel}s`}
            </button>
          </div>
        )}

        {/* Step 3: Select Date */}
        {step === 'date' && (
          <div className="space-y-6">
            <div className="text-center">
              <Calendar className="mx-auto h-10 w-10 text-primary" />
              <h2 className="mt-3 text-3xl font-bold text-foreground">Choose a Date</h2>
              <p className="mt-2 text-lg text-muted-foreground">
                {`Select when you would like to visit for your ${bookingLabelLower}`}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
              <input
                type="date"
                min={today}
                max={maxDate}
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full rounded-xl border border-border bg-muted px-4 py-3 text-lg text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              {selectedDate && (
                <p className="mt-3 text-center text-muted-foreground">
                  {formatDate(selectedDate)}
                </p>
              )}
            </div>
            <button
              onClick={handleSelectDate}
              disabled={!selectedDate}
              className="w-full rounded-xl bg-primary px-4 py-4 text-lg font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Continue
            </button>
            <button
              onClick={handleBack}
              className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Back
            </button>
          </div>
        )}

        {/* Step 4: Select Time */}
        {step === 'time' && (
          <div className="space-y-6">
            <div className="text-center">
              <Clock className="mx-auto h-10 w-10 text-primary" />
              <h2 className="mt-3 text-3xl font-bold text-foreground">Choose a Time</h2>
              <p className="mt-2 text-lg text-muted-foreground">
                {formatDate(selectedDate)}
              </p>
            </div>

            {loadingSlots ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : availableSlots.length === 0 ? (
              <div className="rounded-xl border border-border bg-card p-6 text-center shadow-sm">
                <p className="text-lg text-muted-foreground">
                  No available time slots for this date.
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Please choose a different date.
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
                    {formatTime(slot)}
                  </button>
                ))}
              </div>
            )}

            <button
              onClick={handleBack}
              className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Back
            </button>
          </div>
        )}

        {/* Step 5: Customer Info */}
        {step === 'info' && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-3xl font-bold text-foreground">Your Information</h2>
              <p className="mt-2 text-lg text-muted-foreground">
                {`Please provide your details for this ${bookingLabelLower}`}
              </p>
            </div>

            <div className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  Full Name <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Enter your full name"
                  className="w-full rounded-xl border border-border bg-muted px-4 py-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  Phone Number <span className="text-xs text-muted-foreground">(optional)</span>
                </label>
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="Enter your phone number"
                  className="w-full rounded-xl border border-border bg-muted px-4 py-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  Email{' '}
                  {bookingEmailOtpRequired ? (
                    <span className="text-destructive">*</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">(optional)</span>
                  )}
                </label>
                <input
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder="Enter your email address"
                  className="w-full rounded-xl border border-border bg-muted px-4 py-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
                {bookingEmailOtpRequired ? (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    This business requires email verification before a booking is confirmed.
                  </p>
                ) : null}
              </div>
            </div>

            <button
              onClick={handleCustomerInfo}
              className="w-full rounded-xl bg-primary px-4 py-4 text-lg font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
            >
              {`Review ${vocabulary.bookingLabel}`}
            </button>
            <button
              onClick={handleBack}
              className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Back
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
                  Date
                </span>
                <span className="font-medium text-foreground">{formatDate(selectedDate)}</span>
              </div>
              <div className="flex items-center justify-between border-b border-border py-2">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  Time
                </span>
                <span className="font-medium text-foreground">{formatTime(selectedTime)}</span>
              </div>
              <div className="flex justify-between border-b border-border py-2">
                <span className="text-muted-foreground">Name</span>
                <span className="font-medium text-foreground">{customerName}</span>
              </div>
              {customerPhone && (
                <div className="flex justify-between border-b border-border py-2">
                  <span className="text-muted-foreground">Phone</span>
                  <span className="font-medium text-foreground">{customerPhone}</span>
                </div>
              )}
              {customerEmail && (
                <div className="flex justify-between py-2">
                  <span className="text-muted-foreground">Email</span>
                  <span className="font-medium text-foreground">{customerEmail}</span>
                </div>
              )}
            </div>

            {bookingEmailOtpRequired ? (
              <div className="space-y-4 rounded-xl border border-primary/20 bg-primary/5 p-6">
                <div>
                  <h3 className="text-base font-semibold text-foreground">Email verification</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {`We'll send a short code to ${customerEmail || 'your email'} before this ${bookingLabelLower} is created.`}
                  </p>
                </div>

                {emailOtpVerified ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                    {`Email verified. Your ${bookingLabelLower} is ready to confirm.`}
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
                          ? 'Sending code...'
                          : emailOtpSent
                            ? emailOtpResendRemainingSeconds > 0
                              ? `Resend in ${emailOtpResendRemainingSeconds}s`
                              : 'Resend code'
                            : 'Send verification code'}
                      </button>
                      <p className="self-center text-xs text-muted-foreground">
                        Resend available after about {bookingEmailOtpResendCooldownSeconds} seconds.
                      </p>
                    </div>

                    {emailOtpSent ? (
                      <div className="space-y-3">
                        <div>
                          <label className="mb-1.5 block text-sm font-medium text-foreground">
                            Verification code
                          </label>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={emailOtpCode}
                            onChange={(e) => setEmailOtpCode(e.target.value.replace(/\s+/g, ''))}
                            placeholder="Enter the code from your email"
                            className="w-full rounded-xl border border-border bg-card px-4 py-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={handleVerifyEmailOtp}
                          disabled={verifyingEmailOtp || !emailOtpCode.trim()}
                          className="w-full rounded-xl border border-primary bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
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

            <button
              onClick={handleConfirm}
              disabled={submitting || (bookingEmailOtpRequired && !emailOtpVerified)}
              className="w-full rounded-xl bg-primary px-4 py-4 text-lg font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                  {`${vocabulary.bookingLabel}...`}
                </span>
              ) : (
                `Confirm ${vocabulary.bookingLabel}`
              )}
            </button>
            <button
              onClick={handleBack}
              disabled={submitting}
              className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              Back
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
                {`${vocabulary.bookingLabel} Confirmed!`}
              </h2>
              <p className="mt-2 text-muted-foreground">
                {`Your ${bookingLabelLower} has been booked successfully.`}
              </p>

              <div className="mt-6 rounded-xl bg-muted p-4">
                <p className="text-sm font-medium text-muted-foreground">
                  Reference Number
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
                  <span>{formatDate(selectedDate)}</span>
                </div>
                <div className="flex items-center gap-3 text-sm text-foreground">
                  <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>{formatTime(selectedTime)}</span>
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
                    : 'Please arrive a few minutes early to check in.'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {vocabulary.bookingLabel === 'Reservation'
                    ? 'You can check in with the host stand or online when you arrive.'
                    : 'You can check in at the kiosk or online when you arrive.'}
                </p>
              </div>

              <div className="mt-6 rounded-xl border border-border bg-background p-4 text-left">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {vocabulary.bookingLabel === 'Reservation' ? 'Reservation details' : 'Visit details'}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {`Update the contact info on this ${bookingLabelLower} if you need to correct it.`}
                    </p>
                  </div>
                  {!editingBookedInfo ? (
                    <button
                      type="button"
                      onClick={() => setEditingBookedInfo(true)}
                      className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                    >
                      Edit info
                    </button>
                  ) : null}
                </div>

                {editingBookedInfo ? (
                  <div className="mt-4 space-y-3">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-foreground">
                        Full Name <span className="text-destructive">*</span>
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
                        Phone Number
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
                        Email
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
                        {savingBookedInfo ? 'Saving...' : 'Save changes'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingBookedInfo(false)}
                        disabled={savingBookedInfo}
                        className="flex-1 rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <Link
              href={sandboxMode ? sandbox?.trackPath ?? `/book/${officeSlug}/checkin` : `/book/${officeSlug}/checkin`}
              className="block w-full rounded-xl border border-border bg-card px-4 py-4 text-center text-lg font-medium text-foreground transition-colors hover:bg-muted"
            >
              {sandboxMode
                ? 'Open Queue Preview'
                : vocabulary.bookingLabel === 'Reservation'
                  ? 'Track or Check In Reservation'
                  : 'Track or Check In Appointment'}
            </Link>
            <button
              onClick={handleStartOver}
              className="w-full rounded-xl bg-primary px-4 py-4 text-lg font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
            >
              {vocabulary.bookingLabel === 'Reservation'
                ? 'Book Another Reservation'
                : 'Book Another Appointment'}
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
