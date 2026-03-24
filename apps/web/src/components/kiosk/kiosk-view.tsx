'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  ArrowLeft,
  CalendarClock,
  Check,
  ChevronRight,
  Clock3,
  Search,
  Stethoscope,
  Ticket,
  Users,
} from 'lucide-react';
import { useI18n } from '@/components/providers/locale-provider';
import { GroupTicketModal } from '@/components/kiosk/group-ticket-modal';
import { LanguageSwitcher } from '@/components/shared/language-switcher';
import { PriorityBadge } from '@/components/tickets/priority-badge';
import { checkInAppointment, findAppointment } from '@/lib/actions/appointment-actions';
import { createPublicTicket } from '@/lib/actions/public-ticket-actions';
import { buildBookingPath } from '@/lib/office-links';

interface PriorityCategory {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  weight: number | null;
}

interface KioskSettingsType {
  welcomeMessage: string;
  headerText: string;
  themeColor: string;
  logoUrl?: string | null;
  showLogo?: boolean;
  vertical?: 'public_service' | 'bank' | 'clinic' | 'restaurant' | 'barbershop';
  mode?: 'normal' | 'quick_book';
  showPriorities: boolean;
  showEstimatedTime: boolean;
  hiddenDepartments: string[];
  hiddenServices: string[];
  lockedDepartmentId: string | null;
  buttonLabel: string;
  idleTimeout: number;
}

interface KioskViewProps {
  office: any;
  organization: any;
  departments: any[];
  priorityCategories?: PriorityCategory[];
  kioskSettings?: KioskSettingsType;
  sandbox?: {
    enabled: boolean;
    bookingPath: string;
    queuePreviewBasePath: string;
    appointments?: Array<{
      id: string;
      customer_name: string;
      customer_phone?: string | null;
      department?: { name: string } | null;
      service?: { name: string } | null;
      scheduled_at: string;
      status: string;
    }>;
  };
}

type KioskStep = 'home' | 'department' | 'service' | 'priority' | 'appointment' | 'ticket';

export function KioskView({
  office,
  organization,
  departments,
  priorityCategories = [],
  kioskSettings,
  sandbox,
}: KioskViewProps) {
  const { t, formatDateTime, formatTime } = useI18n();
  const sandboxMode = Boolean(sandbox?.enabled);
  const ks = kioskSettings ?? {
    welcomeMessage: t('Welcome'),
    headerText: '',
    themeColor: '',
    logoUrl: null,
    showLogo: false,
    vertical: 'public_service',
    mode: 'normal',
    showPriorities: true,
    showEstimatedTime: true,
    hiddenDepartments: [],
    hiddenServices: [],
    lockedDepartmentId: null,
    buttonLabel: t('Get Ticket'),
    idleTimeout: 60,
  };

  const lockedDept = ks.lockedDepartmentId
    ? departments.find((department: any) => department.id === ks.lockedDepartmentId) ?? null
    : null;

  const activeDepartments = departments
    .map((department: any) => ({
      ...department,
      services: (department.services ?? [])
        .filter((service: any) => service.is_active)
        .sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0)),
    }))
    .filter((department: any) => department.services.length > 0);
  const defaultDept =
    lockedDept ?? (ks.mode === 'normal' && activeDepartments.length === 1 ? activeDepartments[0] : null);
  const defaultStep: KioskStep = defaultDept ? 'service' : 'home';
  const directServiceEntry = Boolean(defaultDept);
  const [step, setStep] = useState<KioskStep>(defaultStep);
  const [selectedDept, setSelectedDept] = useState<any>(defaultDept);
  const [selectedService, setSelectedService] = useState<any>(null);
  const [selectedPriority, setSelectedPriority] = useState<PriorityCategory | null>(null);
  const [ticket, setTicket] = useState<any>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [appointments, setAppointments] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [checkingIn, setCheckingIn] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  const themeColor = ks.themeColor || '#2563eb';
  const bookingPath = sandboxMode ? sandbox?.bookingPath ?? buildBookingPath(office) : buildBookingPath(office);
  const hasLogo = ks.showLogo && Boolean(ks.logoUrl?.trim());
  const kioskTitle = ks.headerText?.trim() || organization?.name || office.name || 'QueueFlow';
  const localizedWelcomeMessage = t(ks.welcomeMessage);
  const localizedButtonLabel = t(ks.buttonLabel);
  const bookingFirst = ks.mode === 'quick_book';
  const isClinicKiosk = ks.vertical === 'clinic';
  const showHeaderMessage = step === 'home' || step === 'department' || step === 'appointment';
  const primaryCardStyle = {
    borderColor: `${themeColor}22`,
    boxShadow: `0 10px 28px ${themeColor}10`,
  };

  function clearAppointmentSearch() {
    setSearchTerm('');
    setAppointments([]);
    setSearching(false);
    setSearched(false);
    setCheckingIn(null);
    setSearchError(null);
  }

  function resetSession() {
    setStep(defaultStep);
    setSelectedDept(defaultDept);
    setSelectedService(null);
    setSelectedPriority(null);
    setTicket(null);
    setQrDataUrl('');
    clearAppointmentSearch();
    setLoading(false);
    setShowGroupModal(false);
  }

  useEffect(() => {
    setSelectedDept(defaultDept);
  }, [defaultDept]);

  useEffect(() => {
    const timeoutMs = Math.max(ks.idleTimeout, 10) * 1000;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    function resetTimer() {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        resetSession();
      }, timeoutMs);
    }

    const events: Array<keyof WindowEventMap> = ['click', 'touchstart', 'keydown'];
    events.forEach((eventName) => window.addEventListener(eventName, resetTimer));
    resetTimer();

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      events.forEach((eventName) => window.removeEventListener(eventName, resetTimer));
    };
  }, [defaultDept, defaultStep, ks.idleTimeout]);

  function startWalkInFlow() {
    setSearchError(null);
    if (defaultDept) {
      setSelectedDept(defaultDept);
      setStep('service');
      return;
    }

    setSelectedDept(null);
    setStep('department');
  }

  function goBackFromService() {
    if (directServiceEntry) {
      setStep(defaultStep);
      setSelectedDept(defaultDept);
      return;
    }

    if (lockedDept) {
      setStep('home');
      return;
    }

    setStep('department');
  }

  function handleServiceSelected(service: any) {
    setSelectedService(service);

    if (priorityCategories.length > 0) {
      setStep('priority');
      return;
    }

    handleCreateTicket(service, null);
  }

  function handlePrioritySelected(priority: PriorityCategory | null) {
    setSelectedPriority(priority);
    handleCreateTicket(selectedService, priority);
  }

  async function buildQrDataUrl(qrToken: string, sandboxPath?: string) {
    const qrUrl = sandboxPath
      ? `${window.location.origin}${sandboxPath}`
      : `${window.location.origin}/q/${qrToken}`;
    return QRCode.toDataURL(qrUrl, {
      width: 220,
      margin: 2,
      color: { dark: '#0f172a', light: '#ffffff' },
    });
  }

  async function handleCreateTicket(service: any, priority: PriorityCategory | null) {
    if (!selectedDept) return;

    setLoading(true);
    if (sandboxMode) {
      const sandboxTicketId = `sandbox-kiosk-${Date.now()}`;
      const sandboxPath = `${sandbox?.queuePreviewBasePath ?? ''}?ticket=${encodeURIComponent('ticket-waiting-1')}&issued=${encodeURIComponent(sandboxTicketId)}`;
      const dataUrl = await buildQrDataUrl(sandboxTicketId, sandboxPath);
      setTicket({
        id: sandboxTicketId,
        qr_token: sandboxTicketId,
        ticket_number: `${selectedDept.code}-${String(21).padStart(3, '0')}`,
        service_name: service.name,
        department_name: selectedDept.name,
        priority_name: priority?.name ?? null,
        priority_icon: priority?.icon ?? null,
        priority_color: priority?.color ?? null,
        priority_category: priority
          ? {
              id: priority.id,
              name: priority.name,
              icon: priority.icon,
              color: priority.color,
            }
          : null,
        tracking_url: sandboxPath,
      });
      setQrDataUrl(dataUrl);
      setStep('ticket');
      setLoading(false);
      return;
    }

    const result = await createPublicTicket({
      officeId: office.id,
      departmentId: selectedDept.id,
      serviceId: service.id,
      checkedInAt: new Date().toISOString(),
      priority: priority?.weight ?? 0,
      priorityCategoryId: priority?.id ?? null,
    });

    if (result.error || !result.data) {
      alert(result.error ?? t('Error creating ticket. Please try again.'));
      setLoading(false);
      return;
    }

    const newTicket = result.data;
    const dataUrl = await buildQrDataUrl(newTicket.qr_token);

    setTicket({
      ...newTicket,
      service_name: service.name,
      department_name: selectedDept.name,
      priority_name: priority?.name ?? null,
      priority_icon: priority?.icon ?? null,
      priority_color: priority?.color ?? null,
      priority_category: priority
        ? {
            id: priority.id,
            name: priority.name,
            icon: priority.icon,
            color: priority.color,
          }
        : null,
    });
    setQrDataUrl(dataUrl);
    setStep('ticket');
    setLoading(false);
  }

  async function handleSearchAppointment() {
    if (!searchTerm.trim()) {
      setSearchError(t('Enter your name or phone number to find your appointment.'));
      return;
    }

    setSearching(true);
    setSearchError(null);
    setSearched(false);

    if (sandboxMode) {
      const normalizedTerm = searchTerm.trim().toLowerCase();
      const matches = (sandbox?.appointments ?? []).filter((appointment) => {
        const name = appointment.customer_name.toLowerCase();
        const phone = appointment.customer_phone?.toLowerCase() ?? '';
        return name.includes(normalizedTerm) || phone.includes(normalizedTerm);
      });
      setAppointments(matches);
      setSearched(true);
      setSearching(false);
      return;
    }

    const result = await findAppointment(office.id, searchTerm.trim());

    if (result.error) {
      setSearchError(result.error);
    } else {
      setAppointments(result.data ?? []);
      setSearched(true);
    }

    setSearching(false);
  }

  async function handleAppointmentCheckIn(appointmentId: string) {
    setCheckingIn(appointmentId);
    setSearchError(null);

    if (sandboxMode) {
      const matchingAppointment = appointments.find((appointment) => appointment.id === appointmentId);
      const sandboxTicketId = `sandbox-appointment-${Date.now()}`;
      const sandboxPath = `${sandbox?.queuePreviewBasePath ?? ''}?ticket=${encodeURIComponent('ticket-called-1')}&issued=${encodeURIComponent(sandboxTicketId)}`;
      const dataUrl = await buildQrDataUrl(sandboxTicketId, sandboxPath);
      setTicket({
        id: sandboxTicketId,
        qr_token: sandboxTicketId,
        ticket_number: `${selectedDept?.code ?? 'A'}-${String(22).padStart(3, '0')}`,
        service_name: matchingAppointment?.service?.name ?? '',
        department_name: matchingAppointment?.department?.name ?? '',
        tracking_url: sandboxPath,
      });
      setQrDataUrl(dataUrl);
      setStep('ticket');
      setCheckingIn(null);
      return;
    }

    const result = await checkInAppointment(appointmentId);

    if (result.error || !result.data?.ticket) {
      setSearchError(result.error ?? t('Unable to check in this appointment.'));
      setCheckingIn(null);
      return;
    }

    const checkedInTicket = result.data.ticket;
    const matchingAppointment = appointments.find((appointment) => appointment.id === appointmentId);
    const dataUrl = await buildQrDataUrl(checkedInTicket.qr_token);

    setTicket({
      ...checkedInTicket,
      service_name: matchingAppointment?.service?.name ?? '',
      department_name: matchingAppointment?.department?.name ?? '',
    });
    setQrDataUrl(dataUrl);
    setStep('ticket');
    setCheckingIn(null);
  }

  function formatAppointmentTime(dateStr: string) {
    return formatTime(dateStr, {
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  const walkInButton = (
    <button
      onClick={startWalkInFlow}
      className="group flex min-h-[120px] w-full items-center gap-5 rounded-[1.5rem] border border-slate-200 bg-white px-6 py-6 text-left transition-colors hover:border-slate-300 hover:bg-slate-50 sm:min-h-[136px] sm:px-8"
    >
      <div
        className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-white sm:h-20 sm:w-20"
        style={{ backgroundColor: themeColor }}
      >
        <Ticket className="h-8 w-8 sm:h-10 sm:w-10" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
          {localizedButtonLabel}
        </div>
      </div>
      <ChevronRight className="h-8 w-8 text-slate-300 sm:h-10 sm:w-10" />
    </button>
  );

  const appointmentsButton = (
    <button
      onClick={() => {
        clearAppointmentSearch();
        setStep('appointment');
      }}
      className="group flex min-h-[120px] w-full items-center gap-5 rounded-[1.5rem] border border-slate-200 bg-white px-6 py-6 text-left transition-colors hover:border-slate-300 hover:bg-slate-50 sm:min-h-[136px] sm:px-8"
    >
      <div
        className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-white sm:h-20 sm:w-20"
        style={{ backgroundColor: themeColor }}
      >
        <CalendarClock className="h-8 w-8 sm:h-10 sm:w-10" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
          {t('Appointments')}
        </div>
      </div>
      <ChevronRight className="h-8 w-8 text-slate-300 sm:h-10 sm:w-10" />
    </button>
  );

  const bookingButton = (
    <a
      href={bookingPath}
      className={`flex min-h-[120px] w-full items-center gap-5 rounded-[1.5rem] border px-6 py-6 text-left transition-colors sm:min-h-[136px] sm:px-8 ${
        bookingFirst
          ? 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
          : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white'
      }`}
    >
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white text-slate-700 sm:h-20 sm:w-20">
        <Clock3 className="h-8 w-8 sm:h-10 sm:w-10" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
          {t('Book')}
        </div>
      </div>
      <ChevronRight className="h-8 w-8 text-slate-300 sm:h-10 sm:w-10" />
    </a>
  );

  return (
    <div
      className="min-h-screen"
      style={{
        background: `linear-gradient(180deg, #f8fafc 0%, #ffffff 18%, ${themeColor}0a 100%)`,
      }}
    >
      <div className="fixed right-4 top-6 z-40 sm:right-6 sm:top-6">
        <LanguageSwitcher />
      </div>
      {sandboxMode ? (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm font-medium text-amber-900">
          {t(
            'Sandbox mode. This kiosk uses the real layout, but tickets, appointment check-ins, and QR scans stay in a safe preview environment.'
          )}
        </div>
      ) : null}
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-4xl px-4 pb-8 pt-16 text-center sm:px-6 sm:pt-8 lg:px-8">
          {hasLogo ? (
            <div className="mb-5 flex justify-center">
              <img
                src={ks.logoUrl!}
                alt={`${organization?.name || 'Business'} logo`}
                className="max-h-20 w-auto max-w-[220px] object-contain"
              />
            </div>
          ) : null}
          <h1 className="text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
            {kioskTitle}
          </h1>
          {office.name && office.name !== kioskTitle ? (
            <p className="mt-2 text-base text-slate-500">{office.name}</p>
          ) : null}
          {showHeaderMessage ? (
            <p className="mt-4 text-2xl text-slate-700 sm:text-3xl">{localizedWelcomeMessage}</p>
          ) : null}
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        {step === 'home' && (
          <section className="rounded-[1.75rem] border bg-white p-4 sm:p-6" style={primaryCardStyle}>
            <div className="grid gap-4">
              {bookingFirst ? bookingButton : walkInButton}
              {bookingFirst ? walkInButton : appointmentsButton}
              {bookingFirst ? appointmentsButton : bookingButton}
            </div>
          </section>
        )}

        {step !== 'home' && step !== 'ticket' && !(step === 'service' && directServiceEntry) && (
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <button
              onClick={() => {
                if (step === 'department' || step === 'appointment') {
                  setStep('home');
                  clearAppointmentSearch();
                  return;
                }

                if (step === 'service') {
                  goBackFromService();
                  return;
                }

                if (step === 'priority') {
                  setStep('service');
                }
              }}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
            >
              <ArrowLeft className="h-4 w-4" />
              {t('Back')}
            </button>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/80 px-4 py-2 text-sm text-slate-600 shadow-sm backdrop-blur">
              <span className={step === 'department' ? 'font-semibold text-slate-950' : ''}>{t('Department')}</span>
              <ChevronRight className="h-4 w-4 text-slate-300" />
              <span className={step === 'service' ? 'font-semibold text-slate-950' : ''}>{t('Service')}</span>
              {priorityCategories.length > 0 ? (
                <>
                  <ChevronRight className="h-4 w-4 text-slate-300" />
                  <span className={step === 'priority' ? 'font-semibold text-slate-950' : ''}>{t('Priority')}</span>
                </>
              ) : null}
            </div>
          </div>
        )}

        {step === 'department' && (
          <section className="rounded-[1.75rem] border bg-white p-5 sm:p-6" style={primaryCardStyle}>
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-semibold text-slate-950 sm:text-4xl">{t('Choose a department')}</h2>
            </div>

            <div className="mt-6 space-y-3">
              {activeDepartments.map((department) => (
                <button
                  key={department.id}
                  onClick={() => {
                    setSelectedDept(department);
                    setStep('service');
                  }}
                  className="group flex min-h-[104px] w-full items-center gap-5 rounded-[1.5rem] border border-slate-200 bg-white px-6 py-5 text-left transition-colors hover:border-slate-300 hover:bg-slate-50 sm:px-7"
                >
                  <div
                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-lg font-bold text-white"
                    style={{ backgroundColor: themeColor }}
                  >
                    {department.code || 'D'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-2xl font-semibold text-slate-950 sm:text-3xl">{t(department.name)}</div>
                  </div>
                  <ChevronRight className="h-7 w-7 text-slate-300" />
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 'service' && selectedDept && (
          <section className="rounded-[1.75rem] border bg-white p-5 sm:p-6" style={primaryCardStyle}>
              <div className="border-b border-slate-100 pb-5 text-center">
                <div className="mx-auto max-w-2xl">
                  <h2 className="text-3xl font-semibold text-slate-950 sm:text-4xl">
                    {t(selectedDept.name)}
                  </h2>
                </div>
              </div>

              <div className="mt-5 space-y-3">
                {selectedDept.services.map((service: any) => {
                  const showMedicalIcon =
                    isClinicKiosk ||
                    /medical|doctor|visit|check.?up|consult/i.test(service.name ?? '');

                  return (
                  <button
                    key={service.id}
                    onClick={() => handleServiceSelected(service)}
                    disabled={loading}
                    className="group relative flex min-h-[104px] w-full flex-col items-center justify-center gap-4 rounded-[1.5rem] border border-slate-200 bg-white px-6 py-5 text-center transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50 sm:px-7"
                  >
                    <div
                      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-lg font-bold text-white"
                      style={{ backgroundColor: themeColor }}
                    >
                      {showMedicalIcon ? <Stethoscope className="h-7 w-7" /> : service.code || 'S'}
                    </div>
                    <div className="min-w-0">
                      <div className="text-2xl font-semibold text-slate-950 sm:text-3xl">{t(service.name)}</div>
                      {ks.showEstimatedTime && service.estimated_service_time ? (
                        <div className="mt-2 text-base font-medium text-sky-700">
                          {t('{count} min', { count: service.estimated_service_time })}
                        </div>
                      ) : null}
                    </div>
                    <ChevronRight className="absolute right-6 top-1/2 h-7 w-7 -translate-y-1/2 text-slate-300" />
                  </button>
                  );
                })}
              </div>
              <button
                onClick={() => setShowGroupModal(true)}
                disabled={loading}
                className="mt-5 inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-base font-semibold text-slate-900 transition-colors hover:bg-slate-100 disabled:opacity-50"
              >
                <Users className="h-5 w-5" />
                {t('Group ticket')}
              </button>
          </section>
        )}

        {step === 'priority' && selectedService && (
          <section className="rounded-[1.75rem] border bg-white p-5 sm:p-6" style={primaryCardStyle}>
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">
                {t('Priority')}
              </p>
              <h2 className="mt-3 text-3xl font-bold text-slate-950 sm:text-4xl">
                {t('Select a priority level')}
              </h2>
              <p className="mt-2 text-base text-slate-600">
                {t('Choose a priority category only if it applies to your visit.')}
              </p>
            </div>

            <div className="mt-6 space-y-3">
              <button
                onClick={() => handlePrioritySelected(null)}
                disabled={loading}
                className="flex w-full items-center gap-4 rounded-[1.25rem] border border-slate-200 bg-white px-5 py-5 text-left transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-sm font-bold text-slate-700">
                  STD
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xl font-bold text-slate-950">Standard</div>
                  <div className="mt-1 text-sm text-slate-600">
                    {t('Continue with the normal queue order.')}
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-slate-400" />
              </button>

              {priorityCategories.map((category) => (
                <button
                  key={category.id}
                  onClick={() => handlePrioritySelected(category)}
                  disabled={loading}
                  className="flex w-full items-center gap-4 rounded-[1.25rem] border bg-white px-5 py-5 text-left transition-colors hover:bg-slate-50 disabled:opacity-50"
                  style={{ borderColor: category.color ?? '#94a3b8' }}
                >
                  <div
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-xl text-white"
                    style={{ backgroundColor: category.color ?? '#64748b' }}
                  >
                    {category.icon || 'P'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xl font-bold text-slate-950">{category.name}</div>
                    <div className="mt-1 text-sm text-slate-600">
                      {t('Served ahead of standard visits')}
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 text-slate-400" />
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 'appointment' && (
            <section className="rounded-[1.75rem] border bg-white p-5 sm:p-6" style={primaryCardStyle}>
              <div className="text-center">
                <div className="mx-auto max-w-2xl">
                  <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">
                    {t('Appointment check-in')}
                  </p>
                  <h2 className="mt-3 text-3xl font-bold text-slate-950 sm:text-4xl">
                    {t("Find today's reservation")}
                  </h2>
                  <p className="mt-2 max-w-2xl text-base text-slate-600">
                    {t('Search using your name or phone number, then confirm your arrival right here.')}
                  </p>
                </div>
              </div>

              {searchError ? (
                <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                  {searchError}
                </div>
              ) : null}

              <div className="mt-6 rounded-[1.75rem] border border-slate-200 bg-slate-50 p-5">
                <label className="block text-sm font-semibold text-slate-900">
                  {t('Name or phone number')}
                </label>
                <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      onKeyDown={(event) => event.key === 'Enter' && handleSearchAppointment()}
                      placeholder={t('Enter your name or phone number')}
                      className="w-full rounded-xl border border-slate-200 bg-white py-4 pl-12 pr-4 text-base text-slate-900 outline-none transition-shadow focus:ring-2 focus:ring-slate-300"
                    />
                  </div>
                  <button
                    onClick={handleSearchAppointment}
                    disabled={searching}
                    className="inline-flex items-center justify-center rounded-xl px-6 py-4 text-base font-semibold text-white transition-opacity disabled:opacity-60"
                    style={{ backgroundColor: themeColor }}
                  >
                    {searching ? t('Searching...') : t('Search')}
                  </button>
                </div>
              </div>

              {searched ? (
                <div className="mt-6 space-y-4">
                  {appointments.length === 0 ? (
                    <div className="rounded-[1.25rem] border border-slate-200 bg-white p-6 text-center">
                      <h3 className="text-xl font-bold text-slate-950">{t('No appointment found')}</h3>
                      <p className="mt-2 text-base text-slate-600">
                        {t("We couldn't find a reservation for today with that search.")}
                      </p>
                      <a
                        href={bookingPath}
                        className="mt-5 inline-flex items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-5 py-3 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-100"
                      >
                        {t('Book an appointment instead')}
                      </a>
                    </div>
                  ) : (
                    appointments.map((appointment) => (
                      <div
                        key={appointment.id}
                        className="rounded-[1.25rem] border border-slate-200 bg-white p-5"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div>
                            <p className="text-xl font-bold text-slate-950">{appointment.customer_name}</p>
                            <p className="mt-1 text-base text-slate-600">
                              {appointment.department?.name} · {appointment.service?.name}
                            </p>
                            <p className="mt-2 inline-flex rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
                              {t('Scheduled for {time}', { time: formatAppointmentTime(appointment.scheduled_at) })}
                            </p>
                          </div>
                          <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700">
                            {appointment.status}
                          </span>
                        </div>
                        <button
                          onClick={() => handleAppointmentCheckIn(appointment.id)}
                          disabled={checkingIn === appointment.id}
                          className="mt-5 inline-flex w-full items-center justify-center rounded-xl px-4 py-4 text-base font-semibold text-white transition-opacity disabled:opacity-60"
                          style={{ backgroundColor: themeColor }}
                        >
                          {checkingIn === appointment.id ? t('Checking in...') : t('Check in now')}
                        </button>
                      </div>
                    ))
                  )}
                </div>
              ) : null}
              <a
                href={bookingPath}
                className="mt-5 flex items-center justify-between rounded-[1.25rem] border border-slate-200 bg-slate-50 px-5 py-4 text-base font-semibold text-slate-900 transition-colors hover:bg-white"
              >
                <span>{t('Need to book instead?')}</span>
                <ChevronRight className="h-5 w-5 text-slate-400" />
              </a>
            </section>
        )}

        {step === 'ticket' && ticket && (
          <section
            ref={printRef}
            className="mx-auto max-w-3xl rounded-[1.75rem] border bg-white p-6 print:border print:border-black print:shadow-none sm:p-8"
            style={primaryCardStyle}
          >
            <div className="text-center">
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500 print:text-slate-700">
                {t('Check-in complete')}
              </p>
              <h2 className="mt-3 text-3xl font-bold text-slate-950 print:text-black sm:text-4xl">
                {t("You're in the queue")}
              </h2>
              <p className="mt-2 text-base text-slate-600 print:text-slate-700">
                {t('Keep this ticket and scan the QR code to follow your place in line.')}
              </p>
              <div className="mt-4 flex justify-center">
                <PriorityBadge priorityCategory={ticket.priority_category} />
              </div>
            </div>

            <div
              className="mt-8 rounded-[1.75rem] border border-slate-200 bg-slate-50 px-6 py-8 text-center text-slate-950 print:bg-white print:text-black"
            >
              <p className="text-sm uppercase tracking-[0.24em] text-slate-500 print:text-slate-500">
                {t('Ticket number')}
              </p>
              <p
                className="mt-3 text-7xl font-black tracking-tight print:text-black sm:text-8xl"
                style={{ color: themeColor }}
              >
                {ticket.ticket_number}
              </p>
              <div className="mt-5 space-y-1 text-sm text-slate-700 print:text-slate-700">
                <p>{organization?.name}</p>
                <p>{office.name}</p>
                <p>{ticket.department_name}</p>
                <p>{ticket.service_name}</p>
                {ticket.priority_name ? (
                  <div className="pt-2">
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold text-white print:text-black"
                      style={{ backgroundColor: ticket.priority_color ?? '#6b7280' }}
                    >
                      {ticket.priority_icon ? <span>{ticket.priority_icon}</span> : null}
                      {ticket.priority_name}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="mt-6 rounded-[1.75rem] border border-slate-200 bg-white p-6 text-center">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt={t('Scan to track your queue position')}
                  className="mx-auto h-56 w-56"
                />
              ) : null}
              <p className="mt-4 text-base font-semibold text-slate-800">
                {t('Scan to track your queue position')}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {formatDateTime(new Date(), {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </p>
            </div>

            {ticket.group_tickets && ticket.group_tickets.length > 1 ? (
              <div className="mt-6 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-5">
                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">
                  {t('Group tickets')}
                </p>
                <div className="mt-4 space-y-2 text-sm text-slate-700">
                  {ticket.group_tickets.map((groupTicket: any, index: number) => (
                    <div
                      key={groupTicket.id}
                      className="flex items-center justify-between rounded-xl bg-white px-4 py-3"
                    >
                      <span>{groupTicket.person_name || t('Person {count}', { count: index + 1 })}</span>
                      <span className="font-mono font-bold">{groupTicket.ticket_number}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-6 print:hidden">
              <button
                onClick={resetSession}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-base font-semibold text-slate-900 transition-colors hover:bg-slate-100"
              >
                <Check className="h-5 w-5" />
                {t('Done')}
              </button>
            </div>
          </section>
        )}
      </div>

      {showGroupModal && selectedDept ? (
        <GroupTicketModal
          office={office}
          organization={organization}
          department={selectedDept}
          priorityCategories={priorityCategories}
          onClose={() => setShowGroupModal(false)}
          onComplete={(groupTickets, groupQrDataUrl) => {
            setTicket({
              ...groupTickets[0],
              service_name: groupTickets[0].service_name,
              department_name: selectedDept.name,
              group_tickets: groupTickets,
            });
            setQrDataUrl(groupQrDataUrl);
            setShowGroupModal(false);
            setStep('ticket');
          }}
        />
      ) : null}
    </div>
  );
}
