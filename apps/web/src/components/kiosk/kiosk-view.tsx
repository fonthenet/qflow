'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  CalendarClock,
  ChevronRight,
  Clock3,
  Search,
  Stethoscope,
  Ticket,
} from 'lucide-react';
import { useI18n } from '@/components/providers/locale-provider';
import { LanguageSwitcher } from '@/components/shared/language-switcher';
import { PriorityBadge } from '@/components/tickets/priority-badge';
import { checkInAppointment, findAppointment } from '@/lib/actions/appointment-actions';
import { createPublicTicket, getAvailableStaffForService } from '@/lib/actions/public-ticket-actions';
import { buildBookingPath } from '@/lib/office-links';
import { getEnabledIntakeFields, getFieldLabel, getFieldPlaceholder, type IntakeField, type PresetKey } from '@qflo/shared';
import { WILAYAS, formatWilaya } from '@/lib/wilayas';

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
  vertical?: string;
  mode?: 'normal' | 'quick_book';
  showPriorities: boolean;
  showEstimatedTime: boolean;
  hiddenDepartments: string[];
  hiddenServices: string[];
  lockedDepartmentId: string | null;
  buttonLabel: string;
  idleTimeout: number;
  visitIntakeOverrideMode?: 'business_hours' | 'always_open' | 'always_closed';
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

type KioskStep = 'home' | 'department' | 'service' | 'provider' | 'priority' | 'appointment' | 'ticket';

export function KioskView({
  office,
  organization,
  departments,
  priorityCategories = [],
  kioskSettings,
  sandbox,
}: KioskViewProps) {
  const { t, formatDateTime, formatTime, dir, locale } = useI18n();
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
    visitIntakeOverrideMode: 'business_hours',
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
  // Stylist preference (salon-only) — captured during the 'provider'
  // step and stuffed into ticket.customer_data.preferred_staff_id so
  // the operator's Station can show "wait for X" on the card. We
  // skip this step entirely for non-salon orgs OR shops with ≤1
  // active staff (no choice to make).
  const [stylists, setStylists] = useState<Array<{ id: string; full_name: string }>>([]);
  const [selectedStylistId, setSelectedStylistId] = useState<string | null>(null);
  const [loadingStylists, setLoadingStylists] = useState(false);
  // "Salon-style" detection. business_category is the canonical signal;
  // settings.salon_chairs_enabled (stamped by the salon onboarding
  // template) is a redundant signal we honour for orgs that picked
  // the template but didn't set business_category. Either being true
  // is enough to show the "Choose your stylist" step.
  const orgCategoryRaw = String(organization?.settings?.business_category ?? '').toLowerCase();
  const salonStampedOn = Boolean(organization?.settings?.salon_stylist_choice_enabled);
  const isSalonKiosk = salonStampedOn
    || orgCategoryRaw === 'beauty'
    || orgCategoryRaw === 'salon'
    || orgCategoryRaw === 'barbershop'
    || orgCategoryRaw === 'spa';
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerReason, setCustomerReason] = useState('');
  const [intakeData, setIntakeData] = useState<Record<string, string>>({});
  const [customerInfoError, setCustomerInfoError] = useState<string | null>(null);
  const [ticket, setTicket] = useState<any>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [appointments, setAppointments] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [checkingIn, setCheckingIn] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [whatsappStatus, setWhatsappStatus] = useState<{ sent: boolean; error?: string } | null>(null);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [queueStats, setQueueStats] = useState<Record<string, { waiting: number; estimatedWaitMinutes: number }>>({});
  const printRef = useRef<HTMLDivElement>(null);

  const themeColor = ks.themeColor || '#5b8a72';

  // ── Business hours (timezone-safe using dateKey) ──
  const operatingHours = (office.operating_hours as Record<string, { open: string; close: string }> | null) ?? null;
  const officeTimezone = ((office.timezone ?? '') as string).trim().replace('Europe/Algiers', 'Africa/Algiers') || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const currentDayName = (() => {
    try {
      const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: officeTimezone }).format(new Date());
      const d = new Date(dateKey + 'T12:00:00Z');
      const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
      return DAYS[d.getUTCDay()];
    } catch {
      const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
      return DAYS[new Date().getDay()];
    }
  })();
  const todayHours = operatingHours?.[currentDayName] ?? null;
  const isTodayClosed = !todayHours || (todayHours.open === '00:00' && todayHours.close === '00:00');
  const isCurrentlyOpen = (() => {
    if (!operatingHours || isTodayClosed) return false;
    try {
      const now = new Date();
      const parts = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: officeTimezone }).formatToParts(now);
      const h = parts.find(p => p.type === 'hour')?.value ?? '00';
      const m = parts.find(p => p.type === 'minute')?.value ?? '00';
      const hhmm = `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
      return hhmm >= todayHours!.open && hhmm < todayHours!.close;
    } catch {
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      return hhmm >= todayHours!.open && hhmm < todayHours!.close;
    }
  })();
  const bookingPath = sandboxMode ? sandbox?.bookingPath ?? buildBookingPath(office) : buildBookingPath(office);
  const hasLogo = ks.showLogo && Boolean(ks.logoUrl?.trim());
  const kioskTitle = ks.headerText?.trim() || organization?.name || office.name || 'Qflo';
  const businessName = organization?.name?.trim() || office.name;
  const officeLine = office.name && office.name !== businessName ? office.name : null;
  const orgSettings = (organization?.settings as Record<string, any> | null) ?? {};
  // Dynamic intake fields from org settings
  const intakeFields = getEnabledIntakeFields(orgSettings, undefined, 'sameday');
  const intakeLocale = (locale === 'ar' || locale === 'fr') ? locale : 'en';

  function getIntakeValue(field: IntakeField): string {
    if (field.key === 'name') return customerName;
    if (field.key === 'phone') return customerPhone;
    if (field.key === 'reason') return customerReason;
    return intakeData[field.key] ?? '';
  }

  function setIntakeValue(field: IntakeField, value: string) {
    if (field.key === 'name') { setCustomerName(value); return; }
    if (field.key === 'phone') { setCustomerPhone(value); return; }
    if (field.key === 'reason') { setCustomerReason(value); return; }
    setIntakeData((prev) => ({ ...prev, [field.key]: value }));
  }

  const messengerPageId = orgSettings.messenger_enabled && orgSettings.messenger_page_id
    ? (orgSettings.messenger_page_id as string) : null;
  const whatsappEnabled = Boolean(orgSettings.whatsapp_enabled);
  const whatsappPhone = process.env.WHATSAPP_SHARED_PHONE_NUMBER ?? process.env.NEXT_PUBLIC_WHATSAPP_PHONE_NUMBER ?? '';
  const localizedWelcomeMessage = t(ks.welcomeMessage);
  const localizedButtonLabel = t(ks.buttonLabel);
  const bookingFirst = ks.mode === 'quick_book';
  const isClinicKiosk = ks.vertical === 'clinic';
  const primaryCardStyle = {
    borderColor: `${themeColor}22`,
    boxShadow: `0 10px 28px ${themeColor}10`,
  };
  const compactLabelClass = dir === 'rtl' ? 'tracking-normal normal-case' : 'uppercase tracking-[0.22em]';
  const compactTicketLabelClass = dir === 'rtl' ? 'tracking-normal normal-case' : 'uppercase tracking-[0.24em]';
  const hasRequiredCustomerInfo = (() => {
    // Check all required intake fields are filled
    for (const field of intakeFields) {
      if (field.required && !getIntakeValue(field).trim()) return false;
    }
    // Name and phone are always required for kiosk if present in intake fields
    const nameField = intakeFields.find((f) => f.key === 'name');
    const phoneField = intakeFields.find((f) => f.key === 'phone');
    if (nameField && !customerName.trim()) return false;
    if (phoneField && !customerPhone.trim()) return false;
    // If no intake fields at all, fall back to requiring name + phone
    if (intakeFields.length === 0) return customerName.trim().length > 0 && customerPhone.trim().length > 0;
    return true;
  })();
  const intakePaused = ks.visitIntakeOverrideMode === 'always_closed';

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
    setCustomerName('');
    setCustomerPhone('');
    setCustomerReason('');
    setIntakeData({});
    setCustomerInfoError(null);
    setTicket(null);
    setQrDataUrl('');
    setTicketError(null);
    setWhatsappStatus(null);
    clearAppointmentSearch();
    setLoading(false);
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

  // ── Fetch live queue stats for estimated wait per department ──
  useEffect(() => {
    if (!ks.showEstimatedTime || sandboxMode) return;
    // Extract slug from the current URL path (e.g. /kiosk/office-name or /kiosk/office-name--id)
    const pathParts = typeof window !== 'undefined' ? window.location.pathname.split('/') : [];
    const kioskIdx = pathParts.indexOf('kiosk');
    const officeSlug = kioskIdx >= 0 ? pathParts[kioskIdx + 1] : '';
    if (!officeSlug) return;

    async function fetchStats() {
      try {
        const res = await fetch(`/api/queue-status?slug=${encodeURIComponent(officeSlug)}`);
        if (!res.ok) return;
        const data = await res.json();
        const statsMap: Record<string, { waiting: number; estimatedWaitMinutes: number }> = {};
        for (const dept of data.departments ?? []) {
          statsMap[dept.id] = { waiting: dept.waiting, estimatedWaitMinutes: dept.estimatedWaitMinutes };
        }
        setQueueStats(statsMap);
      } catch { /* ignore fetch errors */ }
    }

    fetchStats();
    const interval = setInterval(fetchStats, 30_000);
    return () => clearInterval(interval);
  }, [ks.showEstimatedTime, sandboxMode, office]);

  // ── Success sound + animation trigger ──
  const playSuccessSound = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      [523.25, 659.25].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.15);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.15);
        osc.stop(ctx.currentTime + i * 0.15 + 0.5);
      });
    } catch { /* audio not available */ }
  }, []);

  useEffect(() => {
    if (step === 'ticket' && ticket) playSuccessSound();
  }, [step, ticket, playSuccessSound]);

  function startWalkInFlow() {
    setSearchError(null);
    if (!hasRequiredCustomerInfo) {
      setCustomerInfoError(t('Please enter your name and phone number.'));
      return;
    }
    setCustomerInfoError(null);
    if (defaultDept) {
      setSelectedDept(defaultDept);
      setStep('service');
      return;
    }

    setSelectedDept(null);
    setStep('department');
  }

  function handleServiceSelected(service: any) {
    if (!hasRequiredCustomerInfo) {
      setCustomerInfoError(t('Please enter your name and phone number.'));
      return;
    }
    setCustomerInfoError(null);
    setSelectedService(service);
    setSelectedStylistId(null);

    // Salon flow: between Service and Priority, ask "any stylist or
    // someone specific?". Only fires when the kiosk is a salon AND
    // the office has ≥2 stylists who can do this service. Stylist
    // pref ends up on ticket.customer_data.preferred_staff_id.
    if (isSalonKiosk) {
      setLoadingStylists(true);
      getAvailableStaffForService(office.id, service.id).then((res) => {
        const list = res?.data ?? [];
        setStylists(list);
        setLoadingStylists(false);
        if (list.length >= 2) {
          setStep('provider');
        } else {
          // ≤1 stylist eligible — skip the picker, let priority/ticket
          // flow take over. Lone stylist becomes implicit pref.
          if (list.length === 1) setSelectedStylistId(list[0].id);
          if (priorityCategories.length > 0) setStep('priority');
          else handleCreateTicket(service, null);
        }
      }).catch(() => {
        // Server-action failed — fall through to the normal flow.
        setLoadingStylists(false);
        if (priorityCategories.length > 0) setStep('priority');
        else handleCreateTicket(service, null);
      });
      return;
    }

    if (priorityCategories.length > 0) {
      setStep('priority');
      return;
    }

    handleCreateTicket(service, null);
  }

  function handleStylistSelected(stylistId: string | null) {
    setSelectedStylistId(stylistId);
    if (priorityCategories.length > 0) {
      setStep('priority');
      return;
    }
    handleCreateTicket(selectedService, null);
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
    // Build customer_data from all intake fields
    const customerData: Record<string, string> = {};
    for (const field of intakeFields) {
      const val = getIntakeValue(field).trim();
      if (val) customerData[field.key] = val;
    }
    // Fallback if no intake fields configured
    if (intakeFields.length === 0) {
      if (customerName.trim()) customerData.name = customerName.trim();
      if (customerPhone.trim()) customerData.phone = customerPhone.trim();
    }
    if (!customerData.name && !customerData.phone && intakeFields.length === 0) {
      setCustomerInfoError(t('Please enter your name and phone number.'));
      setLoading(false);
      return;
    }
    // Salon: if the customer picked a stylist, persist that in
    // customer_data. The Station reads customer_data.preferred_staff_id
    // and customer_data.preferred_staff_name to render a "wait for X"
    // badge on the queue card. Promoted to a real column in V2.
    if (selectedStylistId) {
      customerData.preferred_staff_id = selectedStylistId;
      const match = stylists.find((s) => s.id === selectedStylistId);
      if (match?.full_name) customerData.preferred_staff_name = match.full_name;
    }

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
        estimated_service_time: service.estimated_service_time ?? null,
        position_in_queue: 3,
        estimated_wait: service.estimated_service_time ? service.estimated_service_time * 2 : null,
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
        customer_data: customerData,
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
      customerData,
      priority: priority?.weight ?? 0,
      priorityCategoryId: priority?.id ?? null,
      source: 'kiosk',
      isRemote: true,
    });

    if (result.error || !result.data) {
      const msg = result.error ? t(result.error) : t('Error creating ticket. Please try again.');
      setTicketError(msg);
      setTimeout(() => setTicketError(null), 6000);
      setLoading(false);
      return;
    }
    setTicketError(null);

    const newTicket = result.data;
    const dataUrl = await buildQrDataUrl(newTicket.qr_token);
    setWhatsappStatus(result.whatsappStatus ?? null);

    setTicket({
      ...newTicket,
      service_name: service.name,
      department_name: selectedDept.name,
      estimated_service_time: service.estimated_service_time ?? null,
      position_in_queue: newTicket.position_in_queue ?? null,
      estimated_wait: newTicket.estimated_wait ?? null,
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
      setSearchError(t(result.error));
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
      setSearchError(result.error ? t(result.error) : t('Unable to check in this appointment.'));
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

  /* ── Card component matching local kiosk design ── */
  function KioskCard({ icon, label, meta, onClick, disabled, style: cardStyle }: {
    icon: React.ReactNode; label: string; meta?: string; onClick?: () => void;
    disabled?: boolean; style?: React.CSSProperties;
  }) {
    return (
      <button
        onClick={onClick}
        disabled={disabled}
        className="flex w-full items-center gap-4 rounded-[1.5rem] border border-slate-200 bg-white px-5 py-5 text-left transition-all hover:border-slate-300 hover:bg-[#f8fafc] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 sm:px-6"
        style={cardStyle}
      >
        <div
          className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[14px] text-[22px] font-extrabold text-white"
          style={{ backgroundColor: themeColor }}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[22px] font-bold text-slate-950">{label}</div>
          {meta && (
            <div className="mt-1 flex items-center gap-1.5 text-[13px] font-medium text-slate-400">
              {meta}
            </div>
          )}
        </div>
        <ChevronRight className="h-6 w-6 shrink-0 text-slate-200" />
      </button>
    );
  }

  /** Render a single intake field for the kiosk form */
  function renderKioskIntakeField(field: IntakeField, opts?: { gridItem?: boolean }) {
    const label = getFieldLabel(field, intakeLocale);
    const placeholder = getFieldPlaceholder(field, intakeLocale);
    const value = getIntakeValue(field);
    const presetKey = field.type === 'preset' ? (field.key as PresetKey) : null;
    const isRequired = field.required;

    if (presetKey === 'wilaya') {
      return (
        <div key={field.key} className="text-center">
          <label className="mb-2 block text-[13px] font-bold text-slate-950">
            {t(label)} {isRequired ? <span className="font-normal text-rose-500">*</span> : <span className="font-normal text-slate-400">{t('(optional)')}</span>}
          </label>
          <select
            value={value}
            onChange={(event) => {
              setIntakeValue(field, event.target.value);
              if (customerInfoError) setCustomerInfoError(null);
            }}
            className={`w-full rounded-2xl border border-slate-200 bg-white px-[18px] py-4 text-[17px] text-slate-950 outline-none transition-all focus:border-transparent focus:ring-2 sm:py-5 ${dir === 'rtl' ? 'text-right' : ''}`}
            style={{ boxShadow: 'none', '--tw-ring-color': `${themeColor}40` } as any}
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

    if (presetKey === 'age' || presetKey === 'party_size') {
      return (
        <div key={field.key} className="text-center">
          <label className="mb-2 block text-[13px] font-bold text-slate-950">
            {t(label)} {isRequired ? <span className="font-normal text-rose-500">*</span> : <span className="font-normal text-slate-400">{t('(optional)')}</span>}
          </label>
          <input
            type="number"
            min={presetKey === 'party_size' ? '1' : '0'}
            max={presetKey === 'party_size' ? '50' : '150'}
            inputMode="numeric"
            value={value}
            onChange={(event) => {
              setIntakeValue(field, event.target.value);
              if (customerInfoError) setCustomerInfoError(null);
            }}
            placeholder={t(placeholder)}
            autoComplete="off"
            className={`w-full rounded-2xl border border-slate-200 bg-white px-[18px] py-4 text-[17px] text-slate-950 outline-none transition-all focus:border-transparent focus:ring-2 sm:py-5 ${dir === 'rtl' ? 'text-right' : ''}`}
            style={{ boxShadow: 'none', '--tw-ring-color': `${themeColor}40` } as any}
          />
        </div>
      );
    }

    // Email gets a dedicated input with email keyboard and inline validation.
    // On kiosks this mostly affects mobile-kiosk tablets where the on-screen
    // keyboard respects inputMode="email".
    const inputType = presetKey === 'phone' ? 'tel' : presetKey === 'email' ? 'email' : 'text';
    const inputMode: 'tel' | 'email' | 'text' | undefined =
      presetKey === 'phone' ? 'tel' : presetKey === 'email' ? 'email' : undefined;
    const autoCompleteAttr =
      presetKey === 'name' ? 'name'
      : presetKey === 'phone' ? 'tel'
      : presetKey === 'email' ? 'email'
      : 'off';

    return (
      <div key={field.key} className="text-center">
        <label className="mb-2 block text-[13px] font-bold text-slate-950">
          {t(label)} {isRequired ? <span className="font-normal text-rose-500">*</span> : <span className="font-normal text-slate-400">{t('(optional)')}</span>}
        </label>
        <input
          type={inputType}
          inputMode={inputMode}
          value={value}
          onChange={(event) => {
            setIntakeValue(field, event.target.value);
            if (customerInfoError) setCustomerInfoError(null);
          }}
          placeholder={presetKey === 'phone' && whatsappEnabled ? t('For WhatsApp alerts') : t(placeholder)}
          autoComplete={autoCompleteAttr}
          className={`w-full rounded-2xl border border-slate-200 bg-white px-[18px] py-4 text-[17px] text-slate-950 outline-none transition-all focus:border-transparent focus:ring-2 sm:py-5 ${dir === 'rtl' ? 'text-right' : 'text-left'}`}
          style={{ boxShadow: 'none', '--tw-ring-color': `${themeColor}40` } as any}
        />
      </div>
    );
  }

  /** Render all intake fields for the kiosk, splitting into grid and full-width groups */
  function renderKioskIntakeFields() {
    if (intakeFields.length === 0) {
      // Fallback: hardcoded name + phone
      return (
        <>
          <div className="mt-5 grid gap-4 rounded-[1.25rem] border border-slate-200 bg-[#f8fafc] p-5 sm:grid-cols-2">
            <div className="text-center">
              <label className="mb-2 block text-[13px] font-bold text-slate-950">
                {t('Name')} <span className="font-normal text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={customerName}
                onChange={(event) => {
                  setCustomerName(event.target.value);
                  if (customerInfoError) setCustomerInfoError(null);
                }}
                placeholder={t('Enter your name')}
                autoComplete="name"
                className="w-full rounded-2xl border border-slate-200 bg-white px-[18px] py-4 text-[17px] text-slate-950 outline-none transition-all focus:border-transparent focus:ring-2 sm:py-5"
                style={{ boxShadow: 'none', '--tw-ring-color': `${themeColor}40` } as any}
              />
            </div>
            <div className="text-center">
              <label className="mb-2 block text-[13px] font-bold text-slate-950">
                {t('Phone Number')} <span className="font-normal text-rose-500">*</span>
              </label>
              <input
                type="tel"
                value={customerPhone}
                onChange={(event) => {
                  setCustomerPhone(event.target.value);
                  if (customerInfoError) setCustomerInfoError(null);
                }}
                placeholder={whatsappEnabled ? t('For WhatsApp alerts') : t('Enter your phone number')}
                autoComplete="tel"
                className={`w-full rounded-2xl border border-slate-200 bg-white px-[18px] py-4 text-[17px] text-slate-950 outline-none transition-all focus:border-transparent focus:ring-2 sm:py-5 ${dir === 'rtl' ? 'text-right' : 'text-left'}`}
                style={{ boxShadow: 'none', '--tw-ring-color': `${themeColor}40` } as any}
              />
            </div>
          </div>
        </>
      );
    }

    // Split fields: name+phone in a grid row, rest full-width
    const gridFields = intakeFields.filter((f) => f.key === 'name' || f.key === 'phone');
    const otherFields = intakeFields.filter((f) => f.key !== 'name' && f.key !== 'phone');

    return (
      <>
        {gridFields.length > 0 && (
          <div className={`mt-5 grid gap-4 rounded-[1.25rem] border border-slate-200 bg-[#f8fafc] p-5 ${gridFields.length > 1 ? 'sm:grid-cols-2' : ''}`}>
            {gridFields.map((f) => renderKioskIntakeField(f))}
          </div>
        )}
        {otherFields.map((f) => (
          <div key={f.key} className="mt-4 rounded-[1.25rem] border border-slate-200 bg-[#f8fafc] p-5">
            {renderKioskIntakeField(f)}
          </div>
        ))}
      </>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#f1f5f9]">
      {/* ── Header — clean white, matches local kiosk ── */}
      <div className="relative border-b border-slate-200 bg-white px-6 pb-5 pt-7 text-center sm:px-8">
        {/* Language switcher — top left */}
        <div className="absolute left-4 top-4 sm:left-6">
          <LanguageSwitcher variant="floating" />
        </div>

        {/* Business hours toggle — top right */}
        {operatingHours && (
          <div className="absolute right-4 top-4 sm:right-6">
            <button
              onClick={() => setHoursOpen(!hoursOpen)}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-500 transition-all hover:border-slate-300 hover:bg-[#f8fafc]"
            >
              <span className={`h-[7px] w-[7px] rounded-full ${isCurrentlyOpen ? 'bg-emerald-500' : 'bg-red-500'}`} />
              {isCurrentlyOpen ? (isTodayClosed ? t('Connected') : todayHours!.close) : t('Closed')}
              <span className="text-[10px] opacity-60">▼</span>
            </button>
          </div>
        )}

        {/* Logo badge — 52×52, brand bg, margin-bottom 12px */}
        {hasLogo ? (
          <div className="mx-auto mb-3 flex h-[52px] w-[52px] items-center justify-center overflow-hidden rounded-[16px]" style={{ backgroundColor: themeColor }}>
            <img
              src={ks.logoUrl!}
              alt={`${organization?.name || 'Business'} logo`}
              className="h-9 w-auto rounded-lg object-contain"
            />
          </div>
        ) : (
          <div
            className="mx-auto mb-3 flex h-[52px] w-[52px] items-center justify-center rounded-[16px] text-2xl font-black text-white"
            style={{ backgroundColor: themeColor }}
          >
            Q
          </div>
        )}

        {/* h1 = business name (matches local: 24px, 800 weight) */}
        <h1 className="text-2xl font-extrabold tracking-[-0.5px] text-slate-950">
          {businessName}
        </h1>
        {/* subtitle = office name or welcome (matches local: 14px, brand color, 500 weight) */}
        <div className="mt-0.5 text-sm font-medium" style={{ color: themeColor }}>
          {step === 'ticket'
            ? t('Your ticket is ready!')
            : officeLine
              ? officeLine
              : localizedWelcomeMessage}
        </div>
        {/* conn-dot (matches local: 11px, margin-top 8px) */}
        <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-400">
          <span className="h-[7px] w-[7px] rounded-full bg-emerald-500" />
          {t('Connected')}
        </div>
      </div>

      {/* ── Business hours panel (collapsible) ── */}
      {operatingHours && hoursOpen && (
        <div className="mx-auto max-w-[360px] rounded-2xl border border-slate-200 bg-white p-5 shadow-md"
          style={{ marginTop: 16, marginBottom: -8 }}>
          <div className="mb-3 text-center text-sm font-bold text-slate-950">{t('Business Hours')}</div>
          <table className="w-full border-collapse">
            {(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const).map((day) => {
              const h = operatingHours[day];
              const closed = !h || (h.open === '00:00' && h.close === '00:00');
              const isCurrent = day === currentDayName;
              return (
                <tr key={day} className="border-b border-slate-100 last:border-0">
                  <td className={`py-[7px] text-[13px] ${isCurrent ? 'font-bold' : 'font-semibold text-slate-500'}`}
                    style={isCurrent ? { color: themeColor } : undefined}>
                    {t(day.charAt(0).toUpperCase() + day.slice(1))}
                  </td>
                  <td className={`py-[7px] text-right text-[13px] ${isCurrent ? 'font-bold' : 'text-slate-500'}`}
                    style={isCurrent ? { color: themeColor } : undefined}>
                    {closed ? <span className="text-slate-400">{t('Closed')}</span> : `${h.open} – ${h.close}`}
                  </td>
                </tr>
              );
            })}
          </table>
        </div>
      )}

      {sandboxMode ? (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-center text-xs font-semibold text-amber-900">
          {t('Sandbox mode. This kiosk uses the real layout, but tickets, appointment check-ins, and QR scans stay in a safe preview environment.')}
        </div>
      ) : null}

      {/* ── Body ── */}
      <div className="flex flex-1 flex-col items-center px-5 pb-8 pt-5 sm:px-6">
        <div className="w-full max-w-[640px]">

          {/* ── Intake paused ── */}
          {intakePaused ? (
            <div className="rounded-[1.5rem] border border-slate-200 bg-white p-8 text-center shadow-sm">
              <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full" style={{ backgroundColor: `${themeColor}15` }}>
                <Clock3 className="h-10 w-10" style={{ color: themeColor }} />
              </div>
              <div className="text-[28px] font-extrabold text-slate-950">
                {t('Visit intake is currently closed')}
              </div>
              <p className="mx-auto mt-2 max-w-md text-base text-slate-500">
                {t('This business is not taking visits right now. Please check back later or contact the business directly.')}
              </p>
            </div>
          ) : null}

          {/* ── HOME step ── */}
          {!intakePaused && step === 'home' && (
            <>
              {/* Name/phone/intake form card */}
              <div className="rounded-[1.5rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
                <div className="border-b border-slate-100 pb-5 text-center">
                  <div className="text-[28px] font-bold text-slate-950">{t('Your Details')}</div>
                  <div className="mt-1 text-sm text-slate-400">{t('Fill in your details to get started')}</div>
                </div>
                {renderKioskIntakeFields()}
                {customerInfoError ? (
                  <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-center text-[13px] font-semibold text-rose-600">
                    {customerInfoError}
                  </div>
                ) : null}
                <button
                  onClick={startWalkInFlow}
                  disabled={!hasRequiredCustomerInfo}
                  className="mt-5 block w-full rounded-2xl px-4 py-[18px] text-[18px] font-bold text-white transition-all hover:brightness-105 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ backgroundColor: themeColor }}
                >
                  {localizedButtonLabel}
                </button>
              </div>

              {/* Action cards below form */}
              <div className="mt-4 flex flex-col gap-3">
                <KioskCard
                  icon={<CalendarClock className="h-6 w-6" />}
                  label={t('Appointments')}
                  meta={t('Check in for a reservation')}
                  onClick={() => { clearAppointmentSearch(); setStep('appointment'); }}
                />
                <KioskCard
                  icon={<Clock3 className="h-6 w-6" />}
                  label={t('Book')}
                  meta={t('Schedule for later')}
                  onClick={() => { window.location.href = bookingPath; }}
                />
              </div>
            </>
          )}

          {/* Back button removed — navigation is forward-only on kiosk */}

          {/* ── DEPARTMENT step ── */}
          {!intakePaused && step === 'department' && (
            <>
              <div className="mb-6 flex gap-3">
                <div className="flex-1 rounded-[14px] border border-slate-200 bg-white p-3.5 text-center">
                  <div className="text-2xl font-extrabold" style={{ color: themeColor }}>{activeDepartments.length}</div>
                  <div className="mt-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">{t('Departments')}</div>
                </div>
              </div>
              <div className="mb-1 text-center">
                <div className="text-[28px] font-bold tracking-tight text-slate-950">{t('Select Department')}</div>
                <div className="mt-1 text-[15px] text-slate-500">{t('Choose the service area you need')}</div>
              </div>
              <div className="mt-6 flex flex-col gap-3">
                {activeDepartments.map((department) => {
                  const stats = queueStats[department.id];
                  const waitMeta = ks.showEstimatedTime && stats
                    ? stats.waiting > 0
                      ? `${stats.waiting} ${t('waiting')} · ~${stats.estimatedWaitMinutes} ${t('min')}`
                      : t('No wait')
                    : undefined;
                  return (
                    <KioskCard
                      key={department.id}
                      icon={department.code || department.name?.charAt(0)?.toUpperCase() || 'D'}
                      label={t(department.name)}
                      meta={waitMeta}
                      onClick={() => { setSelectedDept(department); setStep('service'); }}
                    />
                  );
                })}
              </div>
            </>
          )}

          {/* ── SERVICE step ── */}
          {!intakePaused && step === 'service' && selectedDept && (
            <>
              {/* Service entry form (single dept path) */}
              {directServiceEntry && (
                <div className="mb-4 rounded-[1.5rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
                  <div className="border-b border-slate-100 pb-5 text-center">
                    <div className="text-xs font-bold uppercase tracking-wide" style={{ color: themeColor }}>
                      {t(selectedDept.name)}{selectedDept.services.length === 1 ? ` — ${t(selectedDept.services[0].name)}` : ''}
                    </div>
                    <div className="mt-1 text-[28px] font-bold text-slate-950">{t('Your Details')}</div>
                    <div className="mt-1 text-sm text-slate-400">{t('Fill in your details to get started')}</div>
                  </div>
                  {renderKioskIntakeFields()}
                  {customerInfoError ? (
                    <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-center text-[13px] font-semibold text-rose-600">
                      {customerInfoError}
                    </div>
                  ) : null}
                  {/* Single-service: show Get Ticket button directly */}
                  {selectedDept.services.length === 1 && (
                    <button
                      className="mt-5 w-full rounded-2xl py-4 text-[17px] font-bold text-white shadow-md transition-all active:scale-[.98] disabled:opacity-50"
                      style={{ background: themeColor }}
                      disabled={loading}
                      onClick={() => handleServiceSelected(selectedDept.services[0])}
                    >
                      {loading ? t('Please wait…') : t('Get Ticket')}
                    </button>
                  )}
                </div>
              )}

              {!directServiceEntry && customerInfoError && (
                <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-center text-[13px] font-semibold text-rose-600">
                  {customerInfoError}
                </div>
              )}

              {ticketError && (
                <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-center text-[13px] font-semibold text-rose-600">
                  {ticketError}
                </div>
              )}

              {/* Hide service list when single-dept + single-service (auto-select on form submit) */}
              {!(directServiceEntry && selectedDept.services.length === 1) && (
                <>
                  <div className="mb-1 text-center">
                    <div className="text-[28px] font-bold tracking-tight text-slate-950">{t('Select a service')}</div>
                    <div className="mt-1 text-[15px] text-slate-500">{t(selectedDept.name)}</div>
                  </div>

                  <div className="mt-4 flex flex-col gap-3">
                    {selectedDept.services.map((service: any) => {
                      const showMedicalIcon =
                        isClinicKiosk ||
                        /medical|doctor|visit|check.?up|consult/i.test(service.name ?? '');

                      return (
                        <KioskCard
                          key={service.id}
                          icon={showMedicalIcon ? <Stethoscope className="h-6 w-6" /> : (service.code || service.name?.charAt(0)?.toUpperCase() || 'S')}
                          label={t(service.name)}
                          meta={ks.showEstimatedTime && service.estimated_service_time
                            ? (() => {
                                const stats = queueStats[selectedDept.id];
                                const serviceTime = `~${service.estimated_service_time} ${t('min')}`;
                                return stats && stats.waiting > 0
                                  ? `${serviceTime} · ${stats.waiting} ${t('waiting')}`
                                  : serviceTime;
                              })()
                            : undefined}
                          onClick={() => handleServiceSelected(service)}
                          disabled={loading || !hasRequiredCustomerInfo}
                        />
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}

          {/* ── PROVIDER step (salons / barbers) ── */}
          {!intakePaused && step === 'provider' && selectedService && (
            <>
              <div className="mb-6 text-center">
                <h2 className="text-3xl font-bold text-foreground">
                  {t('Choose your stylist')}
                </h2>
                <p className="mt-2 text-base text-muted-foreground">
                  {t('Pick someone specific or take the first available')}
                </p>
              </div>
              {loadingStylists ? (
                <div className="flex items-center justify-center py-12">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              ) : (
                <div className="grid gap-3">
                  {/* Any-available card — biased first because most
                      walk-ins genuinely don't care, and "first available"
                      is the fastest path. */}
                  <button
                    onClick={() => handleStylistSelected(null)}
                    className="flex items-center gap-4 rounded-xl border border-border bg-card p-5 text-start shadow-sm transition-all hover:border-primary hover:shadow-md"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-2xl font-bold text-primary">
                      {/* Asterisk-as-glyph for "anyone" — locale-independent */}
                      <span aria-hidden="true">∗</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xl font-semibold text-foreground">
                        {t('Any available')}
                      </div>
                      <div className="text-sm text-muted-foreground mt-0.5">
                        {t('Fastest — first stylist who finishes')}
                      </div>
                    </div>
                  </button>
                  {stylists.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => handleStylistSelected(s.id)}
                      className="flex items-center gap-4 rounded-xl border border-border bg-card p-5 text-start shadow-sm transition-all hover:border-primary hover:shadow-md"
                    >
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-lg font-bold text-foreground">
                        {(s.full_name || '?').slice(0, 1).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xl font-semibold text-foreground truncate">
                          {s.full_name}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={() => setStep('service')}
                className="mt-4 w-full rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                {t('Back')}
              </button>
            </>
          )}

          {/* ── PRIORITY step ── */}
          {!intakePaused && step === 'priority' && selectedService && (
            <>
              <div className="mb-6 text-center">
                <div className="text-[28px] font-bold tracking-tight text-slate-950">{t('Select a priority level')}</div>
                <div className="mt-1 text-[15px] text-slate-500">{t('Choose a priority category only if it applies to your visit.')}</div>
              </div>

              {ticketError && (
                <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-center text-[13px] font-semibold text-rose-600">
                  {ticketError}
                </div>
              )}

              <div className="flex flex-col gap-3">
                <KioskCard
                  icon="STD"
                  label={t('Standard')}
                  meta={t('Continue with the normal queue order.')}
                  onClick={() => handlePrioritySelected(null)}
                  disabled={loading}
                  style={{ borderColor: undefined }}
                />
                {priorityCategories.map((category) => (
                  <button
                    key={category.id}
                    onClick={() => handlePrioritySelected(category)}
                    disabled={loading}
                    className="flex w-full items-center gap-4 rounded-[1.5rem] border bg-white px-5 py-5 text-left transition-all hover:bg-[#f8fafc] active:scale-[0.98] disabled:opacity-50 sm:px-6"
                    style={{ borderColor: category.color ?? '#e2e8f0' }}
                  >
                    <div
                      className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[14px] text-xl text-white"
                      style={{ backgroundColor: category.color ?? '#64748b' }}
                    >
                      {category.icon || 'P'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[22px] font-bold text-slate-950">{category.name}</div>
                      <div className="mt-1 text-[13px] font-medium text-slate-400">{t('Served ahead of standard visits')}</div>
                    </div>
                    <ChevronRight className="h-6 w-6 shrink-0 text-slate-200" />
                  </button>
                ))}
              </div>
            </>
          )}

          {/* ── APPOINTMENT step ── */}
          {!intakePaused && step === 'appointment' && (
            <>
              <div className="mb-6 text-center">
                <div className="text-[28px] font-bold tracking-tight text-slate-950">{t("Find today's reservation")}</div>
                <div className="mt-1 text-[15px] text-slate-500">{t('Search using your name or phone number, then confirm your arrival right here.')}</div>
              </div>

              {searchError ? (
                <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-center text-[13px] font-semibold text-rose-600">
                  {searchError}
                </div>
              ) : null}

              <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                <label className="block text-[13px] font-bold text-slate-950">{t('Name or phone number')}</label>
                <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      onKeyDown={(event) => event.key === 'Enter' && handleSearchAppointment()}
                      placeholder={t('Enter your name or phone number')}
                      className="w-full rounded-2xl border border-slate-200 bg-[#f8fafc] py-4 pl-12 pr-4 text-[17px] text-slate-950 outline-none transition-all focus:border-transparent focus:ring-2"
                      style={{ '--tw-ring-color': `${themeColor}40` } as any}
                    />
                  </div>
                  <button
                    onClick={handleSearchAppointment}
                    disabled={searching}
                    className="rounded-2xl px-6 py-4 text-[17px] font-bold text-white transition-opacity disabled:opacity-60"
                    style={{ backgroundColor: themeColor }}
                  >
                    {searching ? t('Searching...') : t('Search')}
                  </button>
                </div>
              </div>

              {searched ? (
                <div className="mt-4 flex flex-col gap-3">
                  {appointments.length === 0 ? (
                    <div className="rounded-[1.5rem] border border-slate-200 bg-white p-6 text-center">
                      <div className="text-xl font-bold text-slate-950">{t('No appointment found')}</div>
                      <p className="mt-2 text-[15px] text-slate-500">
                        {t("We couldn't find a reservation for today with that search.")}
                      </p>
                      <a
                        href={bookingPath}
                        className="mt-4 inline-flex items-center rounded-full border border-slate-200 bg-[#f8fafc] px-5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-white"
                      >
                        {t('Book an appointment instead')}
                      </a>
                    </div>
                  ) : (
                    appointments.map((appointment) => (
                      <div key={appointment.id} className="rounded-[1.5rem] border border-slate-200 bg-white p-5">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div>
                            <p className="text-xl font-bold text-slate-950">{appointment.customer_name}</p>
                            <p className="mt-1 text-[15px] text-slate-500">
                              {appointment.department?.name} · {appointment.service?.name}
                            </p>
                            <p className="mt-2 inline-flex rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600">
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
                          className="mt-4 w-full rounded-2xl px-4 py-4 text-[17px] font-bold text-white transition-opacity disabled:opacity-60"
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
                className="mt-4 flex items-center justify-between rounded-[1.5rem] border border-slate-200 bg-white px-5 py-4 text-[15px] font-semibold text-slate-700 transition-colors hover:bg-[#f8fafc]"
              >
                <span>{t('Need to book instead?')}</span>
                <ChevronRight className="h-5 w-5 text-slate-300" />
              </a>
            </>
          )}

          {/* ── TICKET (done) step ── */}
          {!intakePaused && step === 'ticket' && ticket && (
            <section
              ref={printRef}
              className="rounded-[1.5rem] border border-slate-200 bg-white p-6 text-center shadow-sm print:border print:border-black print:shadow-none sm:p-8"
            >
              {/* Animated check */}
              <div className="kiosk-success-circle mx-auto flex h-16 w-16 items-center justify-center rounded-full" style={{ backgroundColor: `${themeColor}15` }}>
                <svg className="kiosk-success-check" viewBox="0 0 24 24" width="32" height="32" fill="none" stroke={themeColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div className="mt-3 text-[28px] font-extrabold text-slate-950">{t('Your ticket is ready!')}</div>
              <div className="mt-1 flex justify-center">
                <PriorityBadge priorityCategory={ticket.priority_category} />
              </div>

              {/* Ticket number box */}
              <div className="mt-4 rounded-[1.25rem] border border-slate-200 bg-[#f8fafc] px-5 py-4 print:bg-white">
                <div className={`text-[10px] font-bold uppercase tracking-[2px] text-slate-400`}>
                  {t('YOUR TICKET NUMBER')}
                </div>
                <div className="mt-1 text-[64px] font-black leading-none tracking-tight sm:text-[80px]" style={{ color: themeColor, letterSpacing: dir === 'rtl' ? undefined : '-3px' }}>
                  {ticket.ticket_number}
                </div>
                <div className="mt-2 flex items-center justify-center gap-1.5 text-[15px] text-slate-500">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
                  {ticket.position_in_queue != null
                    ? t('#{position} in queue', { position: ticket.position_in_queue })
                    : `${ticket.department_name} · ${ticket.service_name}`}
                </div>
              </div>

              {/* Prominent estimated wait display */}
              {(ticket.estimated_wait ?? ticket.estimated_service_time) ? (
                <div className="mt-3 rounded-[1.25rem] border border-slate-200 bg-[#f8fafc] px-5 py-4 print:bg-white">
                  <div className="flex items-center justify-center gap-3">
                    <Clock3 className="h-6 w-6" style={{ color: themeColor }} />
                    <div>
                      <div className="text-[13px] font-semibold text-slate-400">{t('Estimated Wait Time')}</div>
                      <div className="text-[28px] font-extrabold" style={{ color: themeColor }}>
                        ~{ticket.estimated_wait ?? ticket.estimated_service_time} {t('min')}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Notification opt-in — customer taps to open WhatsApp/Messenger and initiate (free) */}
              {ticket.qr_token && (whatsappEnabled || messengerPageId) && (
                <div className="mt-5 print:hidden">
                  <div className="mb-1 text-[11px] font-bold uppercase tracking-[1.5px] text-slate-400">{t('Get Notified')}</div>
                  <div className="mb-3 text-[13px] text-slate-500">{t('Tap to receive live updates on your phone')}</div>
                  <div className="flex flex-col gap-2.5">
                    {whatsappEnabled && whatsappPhone && (
                      <a
                        href={`https://wa.me/${whatsappPhone.replace(/\D/g, '')}?text=${encodeURIComponent(`JOIN_${ticket.qr_token}`)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex w-full items-center justify-center gap-2.5 rounded-[14px] border-2 border-green-200 bg-green-50 px-4 py-4 text-[15px] font-bold text-green-700 transition-all hover:bg-green-100 active:scale-[0.98]"
                      >
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                        </svg>
                        {t('WhatsApp')}
                      </a>
                    )}
                    {messengerPageId && (
                      <button
                        type="button"
                        onClick={() => {
                          const mmeUrl = `https://m.me/${messengerPageId}?ref=JOIN_${ticket.qr_token}`;
                          // Try Messenger deep link first (auto-opens app), fall back to m.me
                          const w = window.open(mmeUrl, '_blank');
                          if (!w) window.location.href = mmeUrl;
                        }}
                        className="inline-flex w-full items-center justify-center gap-2.5 rounded-[14px] border-2 border-blue-200 bg-blue-50 px-4 py-4 text-[15px] font-bold text-blue-700 transition-all hover:bg-blue-100 active:scale-[0.98]"
                      >
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 0C5.373 0 0 4.975 0 11.111c0 3.497 1.745 6.616 4.472 8.652V24l4.086-2.242c1.09.301 2.246.464 3.442.464 6.627 0 12-4.974 12-11.111C24 4.975 18.627 0 12 0zm1.193 14.963l-3.056-3.259-5.963 3.259L10.733 8.1l3.13 3.259L19.752 8.1l-6.559 6.863z"/>
                        </svg>
                        {t('Messenger')}
                        <span className="text-[11px] font-normal text-blue-400">{t('Tap "Open" when prompted')}</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Divider */}
              <div className="my-5 h-px bg-slate-200" />

              {/* QR section — side by side like local kiosk */}
              <div className="flex items-center gap-5 rounded-[1.25rem] border border-slate-200 bg-white p-5 text-left">
                {qrDataUrl ? (
                  <div className="shrink-0 overflow-hidden rounded-[10px] border border-slate-200 bg-white p-1.5">
                    <img
                      src={qrDataUrl}
                      alt={t('Scan to track your queue position')}
                      className="h-[120px] w-[120px] sm:h-[140px] sm:w-[140px]"
                      style={{ imageRendering: 'pixelated' }}
                    />
                  </div>
                ) : null}
                <div>
                  <div className="text-[15px] font-bold text-slate-950">{t('Track Your Position')}</div>
                  <div className="mt-1 text-sm leading-relaxed text-slate-500">
                    {t('Scan this QR code to follow your place in the queue from your phone.')}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    {formatDateTime(new Date(), {
                      day: '2-digit', month: '2-digit', year: 'numeric',
                      hour: 'numeric', minute: '2-digit',
                    })}
                  </div>
                </div>
              </div>

              {/* Done button — matches local kiosk */}
              <button
                onClick={resetSession}
                className="mt-4 block w-full rounded-2xl border border-slate-200 bg-[#f8fafc] px-4 py-[18px] text-[17px] font-bold text-slate-950 transition-colors hover:bg-slate-100 print:hidden"
              >
                {t('Done')}
              </button>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
