'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  Accessibility,
  ArrowLeft,
  Baby,
  CalendarClock,
  ChevronRight,
  Clock3,
  ConciergeBell,
  Crown,
  Heart,
  Layers,
  Medal,
  Printer,
  Search,
  Shield,
  Star,
  Ticket,
  UserCheck,
  Users,
} from 'lucide-react';
import { GroupTicketModal } from '@/components/kiosk/group-ticket-modal';
import { SendTicketLink } from '@/components/kiosk/send-ticket-link';
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
  showPriorities: boolean;
  showEstimatedTime: boolean;
  hiddenDepartments: string[];
  hiddenServices: string[];
  lockedDepartmentId: string | null;
  buttonLabel: string;
  idleTimeout: number;
  showAppointmentCheckIn?: boolean;
  showGroupTickets?: boolean;
}

const PRIORITY_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  senior: Crown,
  elderly: Crown,
  accessible: Accessibility,
  accessibility: Accessibility,
  disabled: Accessibility,
  handicap: Accessibility,
  veteran: Medal,
  military: Medal,
  pregnant: Heart,
  pregnancy: Heart,
  vip: Star,
  priority: Shield,
  child: Baby,
  infant: Baby,
};

function getPriorityIcon(name: string) {
  const key = name.toLowerCase().trim();
  for (const [keyword, Icon] of Object.entries(PRIORITY_ICON_MAP)) {
    if (key.includes(keyword)) return Icon;
  }
  return UserCheck;
}

interface KioskViewProps {
  office: any;
  organization: any;
  departments: any[];
  priorityCategories?: PriorityCategory[];
  kioskSettings?: KioskSettingsType;
  vertical?: 'standard' | 'public_service' | 'bank' | 'clinic' | 'restaurant' | 'barbershop' | null;
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
  vertical,
  sandbox,
}: KioskViewProps) {
  const sandboxMode = Boolean(sandbox?.enabled);
  const ks = kioskSettings ?? {
    welcomeMessage: 'Welcome',
    headerText: '',
    themeColor: '',
    logoUrl: null,
    showLogo: false,
    showPriorities: true,
    showEstimatedTime: true,
    hiddenDepartments: [],
    hiddenServices: [],
    lockedDepartmentId: null,
    buttonLabel: 'Get Ticket',
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

  const [step, setStep] = useState<KioskStep>('home');
  const [selectedDept, setSelectedDept] = useState<any>(lockedDept);
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

  const verticalConfig = (() => {
    switch (vertical) {
      case 'restaurant':
        return {
          homeIcon: '🍽️',
          homeSubtitle: 'Join the waitlist or check in for your reservation',
          departmentLabel: 'Dining Area',
          serviceLabel: 'Party Size',
          appointmentLabel: 'Reservation',
          ticketLabel: 'Waitlist Number',
          queueMessage: 'Your table will be ready soon',
          accentGradient: 'from-amber-50 to-orange-50',
        };
      case 'bank':
        return {
          homeIcon: '🏦',
          homeSubtitle: 'Take a number for banking services',
          departmentLabel: 'Service Counter',
          serviceLabel: 'Transaction Type',
          appointmentLabel: 'Scheduled Appointment',
          ticketLabel: 'Queue Number',
          queueMessage: 'Please wait for your number to be called',
          accentGradient: 'from-blue-50 to-indigo-50',
        };
      case 'clinic':
        return {
          homeIcon: '🏥',
          homeSubtitle: 'Check in for your visit or join the waiting list',
          departmentLabel: 'Department',
          serviceLabel: 'Visit Type',
          appointmentLabel: 'Scheduled Appointment',
          ticketLabel: 'Patient Number',
          queueMessage: 'You will be called when the doctor is ready',
          accentGradient: 'from-teal-50 to-cyan-50',
        };
      case 'barbershop':
        return {
          homeIcon: '💈',
          homeSubtitle: 'Walk in or check in for your appointment',
          departmentLabel: 'Service',
          serviceLabel: 'Style',
          appointmentLabel: 'Booked Appointment',
          ticketLabel: 'Your Number',
          queueMessage: 'Have a seat, we will call you when your stylist is ready',
          accentGradient: 'from-violet-50 to-purple-50',
        };
      default: // public_service
        return {
          homeIcon: '🏛️',
          homeSubtitle: 'Get a ticket and wait for your turn',
          departmentLabel: 'Department',
          serviceLabel: 'Service',
          appointmentLabel: 'Appointment',
          ticketLabel: 'Ticket Number',
          queueMessage: 'Wait for your number to be displayed',
          accentGradient: 'from-slate-50 to-gray-50',
        };
    }
  })();

  const themeColor = ks.themeColor && /^#[0-9a-fA-F]{6}$/.test(ks.themeColor) ? ks.themeColor : '#18181b';
  const bookingPath = sandboxMode ? sandbox?.bookingPath ?? buildBookingPath(office) : buildBookingPath(office);
  const visibleServiceCount = activeDepartments.reduce(
    (count: number, department: any) => count + department.services.length,
    0
  );
  const primaryCardStyle = {
    borderColor: '#e4e4e7',
    boxShadow: '0 18px 40px rgba(0,0,0,0.06)',
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
    setStep('home');
    setSelectedDept(lockedDept);
    setSelectedService(null);
    setSelectedPriority(null);
    setTicket(null);
    setQrDataUrl('');
    clearAppointmentSearch();
    setLoading(false);
    setShowGroupModal(false);
  }

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
  }, [ks.idleTimeout, lockedDept]);

  function startWalkInFlow() {
    setSearchError(null);
    if (lockedDept) {
      setSelectedDept(lockedDept);
      setStep('service');
      return;
    }

    setSelectedDept(null);
    setStep('department');
  }

  function goBackFromService() {
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
      alert(result.error ?? 'Error creating ticket. Please try again.');
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
      setSearchError('Enter your name or phone number to find your appointment.');
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
      setSearchError(result.error ?? 'Unable to check in this appointment.');
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

  function handlePrint() {
    window.print();
  }

  function formatTime(dateStr: string) {
    return new Date(dateStr).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  return (
    <div
      className="min-h-screen"
      style={{
        background: '#f8fafc',
      }}
    >
      {sandboxMode ? (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm font-medium text-amber-900">
          Sandbox mode. This kiosk uses the real layout, but tickets, appointment check-ins, and QR scans stay in a safe preview environment.
        </div>
      ) : null}
      <div className="relative overflow-hidden border-b border-slate-200/70 bg-white/80">
        <div
          className="pointer-events-none absolute inset-x-0 -top-16 h-56 blur-3xl"
          style={{
            background: 'linear-gradient(90deg, rgba(0,0,0,0.03) 0%, rgba(255,255,255,0) 75%)',
          }}
        />
        <div className="relative mx-auto max-w-4xl px-4 py-8 text-center sm:px-6 lg:px-8">
          <div className="inline-flex items-center rounded-full border border-white/90 bg-white/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.34em] text-slate-700 shadow-sm backdrop-blur">
            {organization?.name || ks.headerText || 'Business'}
          </div>
          {ks.showLogo && ks.logoUrl ? (
            <div className="mt-6 flex justify-center">
              <img
                src={ks.logoUrl}
                alt={`${organization?.name || 'Business'} logo`}
                className="max-h-44 w-auto max-w-[520px] object-contain"
              />
            </div>
          ) : null}
          <h1 className="mt-6 text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">
            {ks.headerText || organization?.name || 'QueueFlow'}
          </h1>
          <p className="mt-3 text-lg text-slate-600 sm:text-xl">{ks.welcomeMessage}</p>
          <p className="mt-2 text-base text-slate-500">{office.name}</p>
          <p className="mt-4 text-sm text-slate-500">
            {activeDepartments.length} departments · {visibleServiceCount} services
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        {step === 'home' && (
          <section className="rounded-[2rem] border bg-white/90 p-6 backdrop-blur sm:p-8" style={primaryCardStyle}>
            <div className="mx-auto max-w-2xl text-center">
              {ks.showLogo && ks.logoUrl ? (
                <img
                  src={ks.logoUrl}
                  alt=""
                  className="mx-auto mb-6 h-20 w-auto object-contain"
                />
              ) : (
                <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-[1.5rem] bg-slate-100 text-4xl">
                  {verticalConfig.homeIcon}
                </div>
              )}
              <h1 className="text-4xl font-black text-slate-950 sm:text-5xl">
                {ks.welcomeMessage || organization?.name || 'Welcome'}
              </h1>
              {ks.headerText ? (
                <p className="mt-3 text-lg text-slate-600">{ks.headerText}</p>
              ) : (
                <p className="mt-3 text-lg text-slate-600">{verticalConfig.homeSubtitle}</p>
              )}
            </div>

            <div className="mx-auto mt-8 flex max-w-lg flex-col gap-4">
              <button
                onClick={startWalkInFlow}
                disabled={loading}
                className="group relative flex w-full items-center gap-5 rounded-[1.5rem] border-2 px-6 py-6 text-left shadow-lg transition-all hover:shadow-xl hover:-translate-y-0.5 disabled:opacity-50"
                style={{
                  borderColor: themeColor,
                  backgroundColor: `${themeColor}08`,
                }}
              >
                <div
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-white shadow-md"
                  style={{ backgroundColor: themeColor }}
                >
                  <Ticket className="h-7 w-7" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xl font-bold text-slate-950">
                    {ks.buttonLabel || (vertical === 'restaurant' ? 'Join Waitlist' : vertical === 'barbershop' ? 'Walk In' : 'Get Ticket')}
                  </div>
                  <div className="mt-1 text-sm text-slate-600">
                    {vertical === 'restaurant'
                      ? 'Add your party to the waitlist now'
                      : vertical === 'clinic'
                        ? 'Walk in without a prior appointment'
                        : vertical === 'barbershop'
                          ? 'No appointment? No problem'
                          : vertical === 'bank'
                            ? 'Take a number for counter service'
                            : 'Join the queue and get your ticket number'}
                  </div>
                </div>
                <ChevronRight className="h-6 w-6 text-slate-400 transition-transform group-hover:translate-x-1" />
              </button>

              {ks.showAppointmentCheckIn !== false ? (
                <button
                  onClick={() => {
                    clearAppointmentSearch();
                    setStep('appointment');
                  }}
                  className="group flex w-full items-center gap-5 rounded-[1.5rem] border border-slate-200 bg-white px-6 py-6 text-left shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50 hover:-translate-y-0.5"
                >
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                    <CalendarClock className="h-7 w-7" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xl font-bold text-slate-950">
                      {verticalConfig.appointmentLabel} Check-in
                    </div>
                    <div className="mt-1 text-sm text-slate-600">
                      {vertical === 'restaurant'
                        ? 'Already have a reservation? Check in here'
                        : vertical === 'clinic'
                          ? 'Have a scheduled appointment? Check in here'
                          : vertical === 'barbershop'
                            ? 'Booked ahead? Let us know you are here'
                            : 'Already booked? Find and confirm your appointment'}
                    </div>
                  </div>
                  <ChevronRight className="h-6 w-6 text-slate-400 transition-transform group-hover:translate-x-1" />
                </button>
              ) : null}
            </div>
          </section>
        )}

        {step !== 'home' && step !== 'ticket' && (
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
              Back
            </button>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/80 px-4 py-2 text-sm text-slate-600 shadow-sm backdrop-blur">
              <span className={step === 'department' ? 'font-semibold text-slate-950' : ''}>Department</span>
              <ChevronRight className="h-4 w-4 text-slate-300" />
              <span className={step === 'service' ? 'font-semibold text-slate-950' : ''}>Service</span>
              {priorityCategories.length > 0 ? (
                <>
                  <ChevronRight className="h-4 w-4 text-slate-300" />
                  <span className={step === 'priority' ? 'font-semibold text-slate-950' : ''}>Priority</span>
                </>
              ) : null}
            </div>
          </div>
        )}

        {step === 'department' && (
          <section className="rounded-[2rem] border bg-white/90 p-5 backdrop-blur sm:p-6" style={primaryCardStyle}>
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">
                Walk-in check-in
              </p>
              <h2 className="mt-3 text-3xl font-bold text-slate-950 sm:text-4xl">
                {verticalConfig.departmentLabel === 'Dining Area' ? 'Choose your dining area' : `Choose a ${verticalConfig.departmentLabel.toLowerCase()}`}
              </h2>
              <p className="mt-2 text-base text-slate-600">
                Pick the area that best matches the help you need today.
              </p>
            </div>

            <div className="mt-6 space-y-3">
              {activeDepartments.map((department) => (
                <button
                  key={department.id}
                  onClick={() => {
                    setSelectedDept(department);
                    setStep('service');
                  }}
                  className="group flex w-full items-center gap-4 rounded-[1.5rem] border border-slate-200 bg-white px-5 py-5 text-left shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50"
                >
                  <div
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white"
                    style={{ backgroundColor: themeColor }}
                  >
                    <Layers className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xl font-bold text-slate-950">{department.name}</div>
                    <div className="mt-1 text-sm text-slate-600">
                      {department.description || `${department.services.length} service${department.services.length === 1 ? '' : 's'} available`}
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 text-slate-400" />
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 'service' && selectedDept && (
          <section className="rounded-[2rem] border bg-white/90 p-5 backdrop-blur sm:p-6" style={primaryCardStyle}>
              <div className="border-b border-slate-100 pb-5 text-center">
                <div className="mx-auto max-w-2xl">
                  <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">
                    {selectedDept.code || 'Department'}
                  </p>
                  <h2 className="mt-3 text-3xl font-bold text-slate-950 sm:text-4xl">
                    {selectedDept.name}
                  </h2>
                  <p className="mt-2 text-base text-slate-600">
                    {vertical === 'restaurant' ? 'How many guests?' : vertical === 'barbershop' ? 'Choose your style' : `Select a ${verticalConfig.serviceLabel.toLowerCase()}`}
                  </p>
                </div>
                <div className="mx-auto mt-4 inline-flex rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  {selectedDept.services.length} service{selectedDept.services.length === 1 ? '' : 's'} available
                </div>
              </div>

              <div className="mt-5 space-y-3">
                {selectedDept.services.map((service: any) => (
                  <button
                    key={service.id}
                    onClick={() => handleServiceSelected(service)}
                    disabled={loading}
                    className="group flex w-full items-center gap-4 rounded-[1.5rem] border border-slate-200 bg-white px-5 py-5 text-left shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <div
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white"
                      style={{ backgroundColor: themeColor }}
                    >
                      <ConciergeBell className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xl font-bold text-slate-950">{service.name}</div>
                      <div className="mt-1 text-sm text-slate-600">
                        {service.description || 'Select this service to continue'}
                      </div>
                      {ks.showEstimatedTime && service.estimated_service_time ? (
                        <div className="mt-2 text-sm font-medium text-sky-700">
                          Est. {service.estimated_service_time} min
                        </div>
                      ) : null}
                    </div>
                    <ChevronRight className="h-5 w-5 text-slate-400" />
                  </button>
                ))}
              </div>
              {ks.showGroupTickets !== false ? (
                <button
                  onClick={() => setShowGroupModal(true)}
                  disabled={loading}
                  className="mt-5 inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-base font-semibold text-slate-900 transition-colors hover:bg-slate-100 disabled:opacity-50"
                >
                  <Users className="h-5 w-5" />
                  Group ticket
                </button>
              ) : null}
          </section>
        )}

        {step === 'priority' && selectedService && (
          <section className="rounded-[2rem] border bg-white/90 p-5 backdrop-blur sm:p-6" style={primaryCardStyle}>
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">
                Priority
              </p>
              <h2 className="mt-3 text-3xl font-bold text-slate-950 sm:text-4xl">
                Select a priority level
              </h2>
              <p className="mt-2 text-base text-slate-600">
                Choose a priority category only if it applies to your visit.
              </p>
            </div>

            <div className="mt-6 space-y-3">
              <button
                onClick={() => handlePrioritySelected(null)}
                disabled={loading}
                className="flex w-full items-center gap-4 rounded-[1.5rem] border border-slate-200 bg-white px-5 py-5 text-left shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
                  <Users className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xl font-bold text-slate-950">Standard</div>
                  <div className="mt-1 text-sm text-slate-600">
                    Continue with the normal queue order.
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-slate-400" />
              </button>

              {priorityCategories.map((category) => (
                <button
                  key={category.id}
                  onClick={() => handlePrioritySelected(category)}
                  disabled={loading}
                  className="flex w-full items-center gap-4 rounded-[1.5rem] border border-slate-200 bg-white px-5 py-5 text-left shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
                >
                  {(() => { const Icon = getPriorityIcon(category.name); return (
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
                    <Icon className="h-5 w-5" />
                  </div>
                  ); })()}
                  <div className="min-w-0 flex-1">
                    <div className="text-xl font-bold text-slate-950">{category.name}</div>
                    <div className="mt-1 text-sm text-slate-600">
                      Served ahead of standard visits
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 text-slate-400" />
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 'appointment' && (
            <section className="rounded-[2rem] border bg-white/90 p-5 backdrop-blur sm:p-6" style={primaryCardStyle}>
              <div className="text-center">
                <div className="mx-auto max-w-2xl">
                  <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Appointment check-in
                  </p>
                  <h2 className="mt-3 text-3xl font-bold text-slate-950 sm:text-4xl">
                    Find today&apos;s reservation
                  </h2>
                  <p className="mt-2 max-w-2xl text-base text-slate-600">
                    Search using your name or phone number, then confirm your arrival right here.
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
                  Name or phone number
                </label>
                <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      onKeyDown={(event) => event.key === 'Enter' && handleSearchAppointment()}
                      placeholder="Enter your name or phone number"
                      className="w-full rounded-2xl border border-slate-200 bg-white py-4 pl-12 pr-4 text-base text-slate-900 outline-none transition-shadow focus:ring-2 focus:ring-slate-300"
                    />
                  </div>
                  <button
                    onClick={handleSearchAppointment}
                    disabled={searching}
                    className="inline-flex items-center justify-center rounded-2xl px-6 py-4 text-base font-semibold text-white shadow-lg transition-opacity disabled:opacity-60"
                    style={{ backgroundColor: themeColor }}
                  >
                    {searching ? 'Searching...' : 'Search'}
                  </button>
                </div>
              </div>

              {searched ? (
                <div className="mt-6 space-y-4">
                  {appointments.length === 0 ? (
                    <div className="rounded-[1.5rem] border border-slate-200 bg-white p-6 text-center shadow-sm">
                      <h3 className="text-xl font-bold text-slate-950">No appointment found</h3>
                      <p className="mt-2 text-base text-slate-600">
                        We couldn&apos;t find a reservation for today with that search.
                      </p>
                      <a
                        href={bookingPath}
                        className="mt-5 inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 px-5 py-3 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-100"
                      >
                        Book an appointment instead
                      </a>
                    </div>
                  ) : (
                    appointments.map((appointment) => (
                      <div
                        key={appointment.id}
                        className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div>
                            <p className="text-xl font-bold text-slate-950">{appointment.customer_name}</p>
                            <p className="mt-1 text-base text-slate-600">
                              {appointment.department?.name} · {appointment.service?.name}
                            </p>
                            <p className="mt-2 inline-flex rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
                              Scheduled for {formatTime(appointment.scheduled_at)}
                            </p>
                          </div>
                          <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700">
                            {appointment.status}
                          </span>
                        </div>
                        <button
                          onClick={() => handleAppointmentCheckIn(appointment.id)}
                          disabled={checkingIn === appointment.id}
                          className="mt-5 inline-flex w-full items-center justify-center rounded-2xl px-4 py-4 text-base font-semibold text-white shadow-lg transition-opacity disabled:opacity-60"
                          style={{ backgroundColor: themeColor }}
                        >
                          {checkingIn === appointment.id ? 'Checking in...' : 'Check in now'}
                        </button>
                      </div>
                    ))
                  )}
                </div>
              ) : null}
              <a
                href={bookingPath}
                className="mt-5 flex items-center justify-between rounded-[1.5rem] border border-slate-200 bg-slate-50 px-5 py-4 text-base font-semibold text-slate-900 transition-colors hover:bg-white"
              >
                <span>Need to book instead?</span>
                <ChevronRight className="h-5 w-5 text-slate-400" />
              </a>
            </section>
        )}

        {step === 'ticket' && ticket && (
          <section
            ref={printRef}
            className="mx-auto max-w-3xl rounded-[2rem] border bg-white/92 p-6 shadow-[0_22px_60px_rgba(15,23,42,0.09)] backdrop-blur print:border print:border-black print:shadow-none sm:p-8"
            style={primaryCardStyle}
          >
            <div className="text-center">
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500 print:text-slate-700">
                Check-in complete
              </p>
              <h2 className="mt-3 text-3xl font-bold text-slate-950 print:text-black sm:text-4xl">
                You&apos;re in the queue
              </h2>
              <p className="mt-2 text-base text-slate-600 print:text-slate-700">
                {verticalConfig.queueMessage}
              </p>
              <div className="mt-4 flex justify-center">
                <PriorityBadge priorityCategory={ticket.priority_category} />
              </div>
            </div>

            <div className="mt-8 rounded-[1.75rem] bg-slate-950 px-6 py-8 text-center text-white print:bg-white print:text-black">
              <p className="text-sm uppercase tracking-[0.24em] text-white/65 print:text-slate-500">
                {verticalConfig.ticketLabel}
              </p>
              <p
                className="mt-3 text-7xl font-black tracking-tight text-white print:text-black sm:text-8xl"
              >
                {ticket.ticket_number}
              </p>
              <div className="mt-5 space-y-1 text-sm text-slate-300 print:text-slate-700">
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
                  alt="Scan to track your queue position"
                  className="mx-auto h-56 w-56"
                />
              ) : null}
              <p className="mt-4 text-base font-semibold text-slate-800">
                Scan to track your queue position
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {new Date().toLocaleString()}
              </p>
            </div>

            {ticket.group_tickets && ticket.group_tickets.length > 1 ? (
              <div className="mt-6 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-5">
                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">
                  Group tickets
                </p>
                <div className="mt-4 space-y-2 text-sm text-slate-700">
                  {ticket.group_tickets.map((groupTicket: any, index: number) => (
                    <div
                      key={groupTicket.id}
                      className="flex items-center justify-between rounded-xl bg-white px-4 py-3"
                    >
                      <span>{groupTicket.person_name || `Person ${index + 1}`}</span>
                      <span className="font-mono font-bold">{groupTicket.ticket_number}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-6 print:hidden">
              <SendTicketLink
                ticketUrl={ticket.tracking_url ? `${window.location.origin}${ticket.tracking_url}` : `${window.location.origin}/q/${ticket.qr_token}`}
                ticketNumber={ticket.ticket_number}
                officeName={office.name}
              />
            </div>

            <div className="mt-6 grid gap-3 print:hidden sm:grid-cols-2">
              <button
                onClick={handlePrint}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-4 text-base font-semibold text-white shadow-lg transition-opacity"
                style={{ backgroundColor: themeColor }}
              >
                <Printer className="h-5 w-5" />
                Print ticket
              </button>
              <button
                onClick={resetSession}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-base font-semibold text-slate-900 transition-colors hover:bg-slate-100"
              >
                <ArrowLeft className="h-5 w-5" />
                Back to start
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
