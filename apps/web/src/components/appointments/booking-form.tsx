'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Calendar, CalendarPlus, Clock, MapPin, Check, User, Bell, Users } from 'lucide-react';
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
import { getEnabledIntakeFields, getFieldLabel, getFieldPlaceholder, type IntakeField, type PresetKey } from '@qflo/shared';
import { WILAYAS, formatWilaya } from '@/lib/wilayas';

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
  const { t, formatDate, formatTime, locale } = useI18n();
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
  const [detailedSlots, setDetailedSlots] = useState<{ time: string; remaining: number; total: number; available?: boolean; reason?: 'taken' | 'daily_limit' }[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [intakeData, setIntakeData] = useState<Record<string, string>>({});
  const [partySize, setPartySize] = useState<number>(2);
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
  // Lazy-import the full Supabase browser client (includes realtime) only when
  // first needed (post-paint interaction or subscription setup). This keeps the
  // realtime chunk off the critical-path JS for /book/[officeSlug].
  const supabaseRef = useRef<Awaited<ReturnType<typeof import('@/lib/supabase/client').createClient>> | null>(null);
  const getClient = useCallback(async () => {
    if (!supabaseRef.current) {
      const { createClient } = await import('@/lib/supabase/client');
      supabaseRef.current = createClient();
    }
    return supabaseRef.current;
  }, []);

  // Same-day RESERVE is not allowed — customers wanting to be seen today must
  // use the live JOIN flow. Compute "tomorrow" in the office timezone so the
  // earliest selectable date matches what getAvailableDates() returns.
  // Use org-level timezone as single source of truth
  const _officeTz =
    (organization as any)?.timezone ||
    (office as any)?.timezone ||
    'Africa/Algiers';
  const _todayParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: _officeTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const _y = _todayParts.find((p) => p.type === 'year')?.value ?? '1970';
  const _m = _todayParts.find((p) => p.type === 'month')?.value ?? '01';
  const _d = _todayParts.find((p) => p.type === 'day')?.value ?? '01';
  const _todayAnchor = new Date(`${_y}-${_m}-${_d}T12:00:00Z`);
  _todayAnchor.setUTCDate(_todayAnchor.getUTCDate() + 1);
  const tomorrow = _todayAnchor.toISOString().split('T')[0];
  const orgSettings = organization?.settings ?? {};
  const isReservationOrg =
    orgSettings.business_category === 'restaurant'
    || orgSettings.business_category === 'cafe'
    || orgSettings.business_category === 'bar';
  // Dynamic intake fields from org settings
  const intakeFields = getEnabledIntakeFields(orgSettings, undefined, 'booking');
  const intakeLocale = (locale === 'ar' || locale === 'fr') ? locale : 'en';

  function getIntakeValue(field: IntakeField): string {
    if (field.key === 'name') return customerName;
    if (field.key === 'phone') return customerPhone;
    if (field.key === 'email') return customerEmail;
    return intakeData[field.key] ?? '';
  }

  function setIntakeValue(field: IntakeField, value: string) {
    if (field.key === 'name') { setCustomerName(value); return; }
    if (field.key === 'phone') { setCustomerPhone(value); return; }
    if (field.key === 'email') { setCustomerEmail(value); return; }
    setIntakeData((prev) => ({ ...prev, [field.key]: value }));
  }

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

  // Fetch available slots
  const fetchSlots = useCallback(async () => {
    if (!selectedDate || !selectedService) return;
    if (sandboxMode) {
      setAvailableSlots(sandbox?.sampleSlots ?? ['09:00', '09:30', '10:00', '10:30', '11:00']);
      setDetailedSlots([]);
      setLoadingSlots(false);
      return;
    }
    const result = await getAvailableSlots(
      office.id,
      selectedService.id,
      selectedDate,
      selectedStaffId ?? undefined,
      isReservationOrg ? partySize : undefined,
    );
    if (result.error) {
      setError(result.error);
      setAvailableSlots([]);
      setDetailedSlots([]);
    } else {
      setAvailableSlots(result.data ?? []);
      setDetailedSlots(result.detailed ?? []);
    }
    setLoadingSlots(false);
  }, [sandboxMode, sandbox?.sampleSlots, selectedDate, selectedService, office.id, selectedStaffId, isReservationOrg, partySize]);

  // Fetch slots when date changes
  useEffect(() => {
    if (!selectedDate || !selectedService) return;
    setLoadingSlots(true);
    setSelectedTime('');
    fetchSlots();
  }, [selectedDate, selectedService, fetchSlots]);

  // Realtime: auto-refresh slots when appointments change for this office.
  // Channel type is opaque — use `any` to avoid importing the full client type at top level.
  const realtimeChannelRef = useRef<any | null>(null);

  useEffect(() => {
    if (!selectedDate || !selectedService || sandboxMode) return;

    let active = true;
    // Dynamically import the realtime-capable client — runs after paint,
    // keeping the realtime JS chunk off the initial critical path.
    getClient().then((client) => {
      if (!active) return;
      const channel = client
        .channel(`booking-slots-${office.id}-${selectedDate}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'appointments',
            filter: `office_id=eq.${office.id}`,
          },
          () => {
            // Re-fetch slots silently (no loading spinner)
            fetchSlots();
          }
        )
        .subscribe();
      realtimeChannelRef.current = channel;
    });

    return () => {
      active = false;
      if (realtimeChannelRef.current) {
        getClient().then((client) => {
          if (realtimeChannelRef.current) {
            client.removeChannel(realtimeChannelRef.current);
            realtimeChannelRef.current = null;
          }
        });
      }
    };
  }, [getClient, office.id, selectedDate, selectedService, sandboxMode, fetchSlots]);

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
    // Fetch staff who can perform this service. Two-pass:
    //   1. all active staff at the office
    //   2. all staff_services rows for the office's staff
    // Then filter: include a stylist if (a) they have NO rows at all
    //  ("can do everything" fallback for shops that haven't set the
    //  matrix yet) OR (b) they have a row for this specific service.
    // Stylists who have specialised (any rows exist) but DIDN'T tick
    // this service are excluded — that's the whole point of the matrix.
    setLoadingStaff(true);
    (async () => {
      try {
        const client = await getClient();
        const { data: allStaff } = await client.from('staff')
          .select('id, full_name')
          .eq('office_id', office.id)
          .eq('is_active', true)
          .order('full_name');
        const staffList = allStaff ?? [];
        const staffIds = staffList.map((s: any) => s.id);
        let filtered = staffList;
        if (staffIds.length > 0 && service?.id) {
          const { data: rows } = await client.from('staff_services')
            .select('staff_id, service_id, is_active')
            .in('staff_id', staffIds);
          const allRows = (rows ?? []).filter((r: any) => r.is_active !== false);
          const specialised = new Set(allRows.map((r: any) => r.staff_id));
          const canDoThis = new Set(
            allRows.filter((r: any) => r.service_id === service.id).map((r: any) => r.staff_id),
          );
          filtered = staffList.filter((s: any) =>
            !specialised.has(s.id) || canDoThis.has(s.id),
          );
        }
        setStaffMembers(filtered);
        setLoadingStaff(false);
        if (filtered.length > 0) setStep('provider');
        else setStep('date');
      } catch {
        // On any failure fall through with the un-filtered list rather
        // than blocking the customer's booking.
        setLoadingStaff(false);
        setStep('date');
      }
    })();
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
    // Validate required intake fields
    for (const field of intakeFields) {
      if (field.required && !getIntakeValue(field).trim()) {
        const label = getFieldLabel(field, intakeLocale);
        setError(t('Please fill in {field}', { field: label }));
        return;
      }
    }
    // Name is always required for booking even if not marked required in intake
    const nameField = intakeFields.find((f) => f.key === 'name');
    if (!nameField && !customerName.trim()) {
      setError(t('Please enter your name'));
      return;
    }
    if (nameField && !customerName.trim()) {
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

    // Build extra notes from dynamic intake fields (age, reason, custom).
    // Fields with dedicated columns (name/phone/email/wilaya/party_size) are
    // sent separately and skipped here to avoid duplicating in notes.
    const mappedKeys = new Set(['name', 'phone', 'email', 'wilaya', 'party_size']);
    const extraParts: string[] = [];
    for (const field of intakeFields) {
      if (mappedKeys.has(field.key)) continue;
      const val = (intakeData[field.key] ?? '').trim();
      if (val) {
        const label = getFieldLabel(field, intakeLocale);
        extraParts.push(`${label}: ${val}`);
      }
    }
    const notesFromIntake = extraParts.length > 0 ? extraParts.join(' | ') : undefined;

    // Party size resolution: restaurants already collect it on the date step
    // via the +/- widget (drives slot computation). For non-reservation orgs
    // that enabled the preset (e.g. clinic asking family size), read from
    // intakeData. Either source winds up in the appointment's `party_size`
    // column so downstream (table suggestions, receipts) sees one value.
    const intakePartySize = parseInt((intakeData['party_size'] ?? '').trim(), 10);
    const resolvedPartySize = isReservationOrg
      ? partySize
      : Number.isFinite(intakePartySize) && intakePartySize > 0
        ? intakePartySize
        : undefined;

    const baseData = {
      officeId: office.id,
      departmentId: selectedDept.id,
      serviceId: selectedService.id,
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim() || undefined,
      customerEmail: customerEmail.trim() || undefined,
      scheduledAt,
      locale,
      wilaya: (intakeData['wilaya'] ?? '').trim() || undefined,
      notes: notesFromIntake,
      ...(selectedStaffId ? { staffId: selectedStaffId } : {}),
      ...(resolvedPartySize !== undefined ? { partySize: resolvedPartySize } : {}),
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

    const client = await getClient();
    const { error: otpError } = await client.auth.signInWithOtp({
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

    const client = await getClient();
    const { error: verifyError } = await client.auth.verifyOtp({
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

    await (await getClient()).auth.signOut();

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
    setIntakeData({});
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
                min={tomorrow}
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full rounded-xl border border-border bg-muted px-4 py-3 text-lg text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              {selectedDate && (
                <p className="mt-3 text-center text-muted-foreground">
                  {formatSelectedDate(selectedDate)}
                </p>
              )}
              {isReservationOrg && (
                <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-border bg-muted px-4 py-3">
                  <label className="text-sm font-medium text-foreground">
                    {t('Party size')}
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPartySize((p) => Math.max(1, p - 1))}
                      className="h-9 w-9 rounded-md border border-border bg-card text-lg font-semibold text-foreground hover:bg-muted"
                      aria-label={t('Decrease')}
                    >
                      −
                    </button>
                    <span className="min-w-[2ch] text-center text-lg font-semibold text-foreground">
                      {partySize}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPartySize((p) => Math.min(20, p + 1))}
                      className="h-9 w-9 rounded-md border border-border bg-card text-lg font-semibold text-foreground hover:bg-muted"
                      aria-label={t('Increase')}
                    >
                      +
                    </button>
                  </div>
                </div>
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
            ) : (detailedSlots.length === 0 && availableSlots.length === 0) ? (
              <div className="rounded-xl border border-border bg-card p-6 text-center shadow-sm">
                <p className="text-lg text-muted-foreground">
                  {t('No available time slots for this date.')}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {t('Please choose a different date.')}
                </p>
              </div>
            ) : (
              // Render the full day's timeline when `detailedSlots` is
              // populated (includes taken slots, marked disabled). Fall
              // back to the legacy `availableSlots` string[] when the
              // server didn't provide the enriched list.
              <div className="grid grid-cols-3 gap-3">
                {(detailedSlots.length > 0
                  ? detailedSlots
                  : availableSlots.map(t => ({ time: t, remaining: 1, total: 1, available: true, reason: undefined as any }))
                ).map((detail) => {
                  const slot = detail.time;
                  const isTaken = detail.available === false;
                  const showCapacity = !isTaken && detail.total > 1;
                  const takenLabel = detail.reason === 'daily_limit' ? t('Full day') : t('Taken');
                  return (
                    <button
                      key={slot}
                      type="button"
                      disabled={isTaken}
                      aria-disabled={isTaken}
                      onClick={() => !isTaken && handleSelectTime(slot)}
                      className={`rounded-xl border p-3 text-center font-medium transition-all ${
                        isTaken
                          ? 'cursor-not-allowed border-border/50 bg-muted/40 text-muted-foreground/60 line-through opacity-60'
                          : selectedTime === slot
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-card text-foreground hover:border-primary hover:shadow-sm'
                      }`}
                    >
                      {formatSlotTime(slot)}
                      {isTaken && (
                        <span className="mt-1 block text-[10px] uppercase tracking-wide text-muted-foreground no-underline">
                          {takenLabel}
                        </span>
                      )}
                      {showCapacity && (
                        <span className={`mt-1 flex items-center justify-center gap-1 text-xs ${
                          selectedTime === slot ? 'text-primary-foreground/70' : 'text-muted-foreground'
                        }`}>
                          <Users className="h-3 w-3" />
                          {detail.remaining}/{detail.total}
                        </span>
                      )}
                    </button>
                  );
                })}
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

        {/* Step 5: Customer Info (dynamic intake fields) */}
        {step === 'info' && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-3xl font-bold text-foreground">{t('Your Information')}</h2>
              <p className="mt-2 text-lg text-muted-foreground">
                {t('Please provide your details for this {booking}', { booking: bookingLabelLower })}
              </p>
            </div>

            <div className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
              {/* Dynamic intake fields.
                  Restaurants collect party size on the date step via the +/-
                  widget (used to compute slot availability), so we hide the
                  intake field here to avoid asking twice — the value flows
                  through to the appointment via the dedicated partySize
                  column. Non-reservation orgs that enabled the party_size
                  preset (e.g. a clinic asking family size) still see it. */}
              {intakeFields.filter((field) => !(field.key === 'party_size' && isReservationOrg)).map((field) => {
                const label = getFieldLabel(field, intakeLocale);
                const placeholder = getFieldPlaceholder(field, intakeLocale);
                const value = getIntakeValue(field);
                const isRequired = field.required || field.key === 'name'; // name always required for booking
                const presetKey = field.type === 'preset' ? (field.key as PresetKey) : null;

                if (presetKey === 'wilaya') {
                  return (
                    <div key={field.key}>
                      <label className="mb-1.5 block text-sm font-medium text-foreground">
                        {t(label)}{' '}
                        {isRequired ? (
                          <span className="text-destructive">*</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">{t('(optional)')}</span>
                        )}
                      </label>
                      <select
                        value={value}
                        onChange={(e) => setIntakeValue(field, e.target.value)}
                        className="w-full rounded-xl border border-border bg-muted px-4 py-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                      >
                        <option value="">{t(placeholder) || t('Select wilaya')}</option>
                        {WILAYAS.map((w) => (
                          <option key={w.code} value={formatWilaya(w, intakeLocale === 'ar' ? 'ar' : 'fr')}>
                            {formatWilaya(w, intakeLocale === 'ar' ? 'ar' : 'fr')}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                }

                if (presetKey === 'email') {
                  const emailRequired = isRequired || bookingEmailOtpRequired;
                  return (
                    <div key={field.key}>
                      <label className="mb-1.5 block text-sm font-medium text-foreground">
                        {t(label)}{' '}
                        {emailRequired ? (
                          <span className="text-destructive">*</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">{t('(optional)')}</span>
                        )}
                      </label>
                      <input
                        type="email"
                        value={value}
                        onChange={(e) => setIntakeValue(field, e.target.value)}
                        placeholder={t(placeholder)}
                        autoComplete="email"
                        className="w-full rounded-xl border border-border bg-muted px-4 py-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                      />
                      {bookingEmailOtpRequired ? (
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          {t('This business requires email verification before a booking is confirmed.')}
                        </p>
                      ) : null}
                    </div>
                  );
                }

                if (presetKey === 'age' || presetKey === 'party_size') {
                  return (
                    <div key={field.key}>
                      <label className="mb-1.5 block text-sm font-medium text-foreground">
                        {t(label)}{' '}
                        {isRequired ? (
                          <span className="text-destructive">*</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">{t('(optional)')}</span>
                        )}
                      </label>
                      <input
                        type="number"
                        min={presetKey === 'party_size' ? '1' : '0'}
                        max={presetKey === 'party_size' ? '50' : '150'}
                        inputMode="numeric"
                        value={value}
                        onChange={(e) => setIntakeValue(field, e.target.value)}
                        placeholder={t(placeholder)}
                        className="w-full rounded-xl border border-border bg-muted px-4 py-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                      />
                    </div>
                  );
                }

                return (
                  <div key={field.key}>
                    <label className="mb-1.5 block text-sm font-medium text-foreground">
                      {t(label)}{' '}
                      {isRequired ? (
                        <span className="text-destructive">*</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">{t('(optional)')}</span>
                      )}
                    </label>
                    <input
                      type={presetKey === 'phone' ? 'tel' : 'text'}
                      value={value}
                      onChange={(e) => setIntakeValue(field, e.target.value)}
                      placeholder={t(placeholder)}
                      autoComplete={
                        presetKey === 'name' ? 'name' :
                        presetKey === 'phone' ? 'tel' : 'off'
                      }
                      className="w-full rounded-xl border border-border bg-muted px-4 py-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                );
              })}

              {/* If no intake fields configured, show fallback name field */}
              {intakeFields.length === 0 && (
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
              )}

              {/* Safety net: if the admin requires email OTP but disabled the
                  email preset in intake_fields, force-render it so bookings
                  aren't blocked by a misconfiguration. */}
              {bookingEmailOtpRequired && !intakeFields.some((f) => f.key === 'email') && (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">
                    Email <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="email"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    placeholder={t('Enter your email address')}
                    autoComplete="email"
                    className="w-full rounded-xl border border-border bg-muted px-4 py-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {t('This business requires email verification before a booking is confirmed.')}
                  </p>
                </div>
              )}
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
              {/* Dynamic intake field values */}
              {intakeFields.map((field) => {
                const val = getIntakeValue(field);
                if (!val.trim()) return null;
                return (
                  <div key={field.key} className="flex justify-between border-b border-border py-2">
                    <span className="text-muted-foreground">{t(getFieldLabel(field, intakeLocale))}</span>
                    <span className="font-medium text-foreground">{val}</span>
                  </div>
                );
              })}
              {/* Fallback name if no intake fields */}
              {intakeFields.length === 0 && customerName && (
                <div className="flex justify-between border-b border-border py-2">
                  <span className="text-muted-foreground">{t('Name')}</span>
                  <span className="font-medium text-foreground">{customerName}</span>
                </div>
              )}
              {customerEmail && !intakeFields.some((f) => f.key === 'email') && (
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
                {intakeFields.map((field) => {
                  const val = getIntakeValue(field);
                  if (!val.trim()) return null;
                  const icon = field.key === 'name' ? 'N' : field.key === 'phone' ? 'P' : field.key === 'email' ? '@' : field.key === 'wilaya' ? 'W' : field.key === 'age' ? 'A' : '•';
                  return (
                    <div key={field.key} className="flex items-center gap-3 text-sm text-foreground">
                      <span className="w-4 shrink-0 text-center text-muted-foreground">{icon}</span>
                      <span>{val}</span>
                    </div>
                  );
                })}
                {intakeFields.length === 0 && customerName && (
                  <div className="flex items-center gap-3 text-sm text-foreground">
                    <span className="w-4 shrink-0 text-center text-muted-foreground">N</span>
                    <span>{customerName}</span>
                  </div>
                )}
                {customerEmail && !intakeFields.some((f) => f.key === 'email') && (
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
