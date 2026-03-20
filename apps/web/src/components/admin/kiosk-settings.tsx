'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CalendarDays,
  Clock3,
  ExternalLink,
  Eye,
  EyeOff,
  ImageIcon,
  Link2,
  Lock,
  Palette,
  RotateCcw,
  Save,
  Tablet,
} from 'lucide-react';
import { updateKioskSettings } from '@/lib/actions/admin-actions';
import { buildBookingCheckInPath, buildBookingPath, buildKioskPath } from '@/lib/office-links';
import { PublicLinkActions } from './public-link-actions';
import { KioskView } from '@/components/kiosk/kiosk-view';
import { isOfficeOpen, formatOperatingHours, capitalizeDay, type OperatingHours } from '@queueflow/shared';

interface Office {
  id: string;
  name: string;
  is_active: boolean;
  settings?: Record<string, unknown> | null;
  operating_hours?: Record<string, { open: string; close: string }> | null;
  timezone?: string | null;
}

interface Service {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
  sort_order: number | null;
}

interface Department {
  id: string;
  name: string;
  code: string;
  office_id: string;
  is_active: boolean;
  sort_order: number | null;
  services: Service[];
}

interface KioskSettingsProps {
  organization: {
    id: string;
    name: string;
    logo_url?: string | null;
    settings?: Record<string, any> | null;
  };
  offices: Office[];
  departments: Department[];
  templateDefaults: {
    welcomeMessage: string;
    headerText: string;
    themeColor: string;
    buttonLabel: string;
    showPriorities: boolean;
    showEstimatedTime: boolean;
    idleTimeoutSeconds: number;
  };
  priorityMode: string;
}

function normalizeThemeColor(value: string, fallback: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim() : fallback;
}

function Switch({
  checked,
  onChange,
  disabled = false,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
        checked ? 'bg-primary' : 'bg-muted-foreground/25'
      } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
    >
      <span
        className={`ml-0.5 block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

function InlineToggle({
  title,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  title: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} label={title} />
    </div>
  );
}

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function KioskSettings({
  organization,
  offices,
  departments,
  templateDefaults,
  priorityMode,
}: KioskSettingsProps) {
  const [isPending, startTransition] = useTransition();
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(true);

  const settings = organization.settings ?? {};
  const activeOffices = offices.filter((office) => office.is_active);
  const activeDepartments = useMemo(
    () =>
      departments
        .filter((department) => department.is_active)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [departments]
  );

  const [welcomeMessage, setWelcomeMessage] = useState<string>(
    settings.kiosk_welcome_message ?? templateDefaults.welcomeMessage
  );
  const [headerText, setHeaderText] = useState<string>(
    settings.kiosk_header_text ?? templateDefaults.headerText
  );
  const [themeColor, setThemeColor] = useState<string>(
    normalizeThemeColor(
      settings.kiosk_theme_color ?? templateDefaults.themeColor,
      templateDefaults.themeColor
    )
  );
  const [showPriorities, setShowPriorities] = useState<boolean>(
    settings.kiosk_show_priorities ?? (priorityMode !== 'none' && templateDefaults.showPriorities)
  );
  const [showLogo, setShowLogo] = useState<boolean>(
    settings.kiosk_show_logo ?? Boolean(settings.kiosk_logo_url ?? organization.logo_url)
  );
  const [logoUrl, setLogoUrl] = useState<string>(settings.kiosk_logo_url ?? organization.logo_url ?? '');
  const [showEstimatedTime, setShowEstimatedTime] = useState<boolean>(
    settings.kiosk_show_estimated_time ?? templateDefaults.showEstimatedTime
  );
  const [hiddenDepartments, setHiddenDepartments] = useState<string[]>(
    settings.kiosk_hidden_departments ?? []
  );
  const [hiddenServices, setHiddenServices] = useState<string[]>(
    settings.kiosk_hidden_services ?? []
  );
  const [lockedDepartmentId, setLockedDepartmentId] = useState<string>(
    settings.kiosk_locked_department_id ?? ''
  );
  const [buttonLabel, setButtonLabel] = useState<string>(
    settings.kiosk_button_label ?? templateDefaults.buttonLabel
  );
  const [idleTimeout, setIdleTimeout] = useState<number>(
    settings.kiosk_idle_timeout ?? templateDefaults.idleTimeoutSeconds
  );
  const [showAppointmentCheckIn, setShowAppointmentCheckIn] = useState<boolean>(
    settings.kiosk_show_appointment_checkin ?? true
  );
  const [showGroupTickets, setShowGroupTickets] = useState<boolean>(
    settings.kiosk_show_group_tickets ?? true
  );

  const [expandedOffice, setExpandedOffice] = useState<string | null>(activeOffices[0]?.id ?? null);

  const availablePriorityFlow = priorityMode !== 'none';

  function setDepartmentVisibility(departmentId: string, visible: boolean) {
    setHiddenDepartments((current) =>
      visible ? current.filter((entry) => entry !== departmentId) : [...current, departmentId]
    );
    if (!visible && lockedDepartmentId === departmentId) {
      setLockedDepartmentId('');
    }
  }

  function setServiceVisibility(serviceId: string, visible: boolean) {
    setHiddenServices((current) =>
      visible ? current.filter((entry) => entry !== serviceId) : [...current, serviceId]
    );
  }

  function resetToDefaults() {
    setWelcomeMessage(templateDefaults.welcomeMessage);
    setHeaderText(templateDefaults.headerText);
    setThemeColor(templateDefaults.themeColor);
    setShowPriorities(availablePriorityFlow && templateDefaults.showPriorities);
    setShowLogo(Boolean(organization.logo_url));
    setLogoUrl(organization.logo_url ?? '');
    setShowEstimatedTime(templateDefaults.showEstimatedTime);
    setShowAppointmentCheckIn(true);
    setShowGroupTickets(true);
    setHiddenDepartments([]);
    setHiddenServices([]);
    setLockedDepartmentId('');
    setButtonLabel(templateDefaults.buttonLabel);
    setIdleTimeout(templateDefaults.idleTimeoutSeconds);
    setSuccessMessage(null);
    setErrorMessage(null);
  }

  function handleSave() {
    setSuccessMessage(null);
    setErrorMessage(null);

    const normalizedTheme = normalizeThemeColor(themeColor, templateDefaults.themeColor);
    const nextHiddenDepartments = hiddenDepartments.filter(
      (departmentId) => departmentId !== lockedDepartmentId
    );

    startTransition(async () => {
      const result = await updateKioskSettings({
        kiosk_welcome_message: welcomeMessage.trim() || templateDefaults.welcomeMessage,
        kiosk_header_text: headerText.trim() || templateDefaults.headerText,
        kiosk_theme_color: normalizedTheme,
        kiosk_show_priorities: availablePriorityFlow ? showPriorities : false,
        kiosk_show_logo: showLogo,
        kiosk_logo_url: logoUrl.trim() || null,
        kiosk_show_estimated_time: showEstimatedTime,
        kiosk_hidden_departments: nextHiddenDepartments,
        kiosk_hidden_services: hiddenServices,
        kiosk_locked_department_id: lockedDepartmentId || null,
        kiosk_button_label: buttonLabel.trim() || templateDefaults.buttonLabel,
        kiosk_idle_timeout: Math.min(Math.max(idleTimeout || 10, 10), 300),
        kiosk_show_appointment_checkin: showAppointmentCheckIn,
        kiosk_show_group_tickets: showGroupTickets,
      });

      if (result?.error) {
        setErrorMessage(result.error);
        return;
      }

      setThemeColor(normalizedTheme);
      setHiddenDepartments(nextHiddenDepartments);
      setSuccessMessage('Kiosk settings saved.');
      setTimeout(() => setSuccessMessage(null), 4000);
    });
  }

  const inputClass =
    'w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none transition focus:ring-2 focus:ring-primary/30 focus:border-primary/50';

  // ─── Build live preview props ────────────────────────────────────────
  const previewOffice = {
    id: activeOffices[0]?.id ?? 'preview',
    name: activeOffices[0]?.name ?? 'Main Office',
    timezone: 'UTC',
    settings: {},
  };

  const previewOrg = {
    id: organization.id,
    name: organization.name,
    logo_url: logoUrl.trim() || organization.logo_url || null,
    settings: {},
  };

  const previewDepartments = activeDepartments
    .filter((d) => !hiddenDepartments.includes(d.id))
    .map((d) => ({
      ...d,
      services: (d.services ?? [])
        .filter((s) => s.is_active && !hiddenServices.includes(s.id))
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    }));

  const previewKioskSettings = {
    welcomeMessage: welcomeMessage || templateDefaults.welcomeMessage,
    headerText: headerText || templateDefaults.headerText,
    themeColor: normalizeThemeColor(themeColor, templateDefaults.themeColor),
    logoUrl: logoUrl.trim() || organization.logo_url || null,
    showLogo,
    showPriorities: availablePriorityFlow ? showPriorities : false,
    showEstimatedTime,
    hiddenDepartments: [],
    hiddenServices: [],
    lockedDepartmentId: lockedDepartmentId || null,
    buttonLabel: buttonLabel || templateDefaults.buttonLabel,
    idleTimeout: 9999, // Don't auto-reset in preview
    showAppointmentCheckIn,
    showGroupTickets,
  };

  // ─── Render ──────────────────────────────────────────────────────────

  return (
    <div className="flex h-[calc(100vh-64px)]">
      {/* ─── Left: Settings Panel ──────────────────────────── */}
      <div className={`${showPreview ? 'w-[480px]' : 'flex-1 max-w-3xl mx-auto'} shrink-0 overflow-y-auto border-r border-border bg-background`}>
        <div className="space-y-6 px-4 py-8 sm:px-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">Lobby Kiosk</h1>
              <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                Configure the self-service screen customers use to join the queue.
              </p>
            </div>
            <div className="flex items-center gap-2.5">
              {successMessage && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {successMessage}
                </span>
              )}
              {errorMessage && <span className="text-sm text-destructive">{errorMessage}</span>}
              <button
                type="button"
                onClick={() => setShowPreview(!showPreview)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3.5 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
              >
                {showPreview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {showPreview ? 'Hide Preview' : 'Show Preview'}
              </button>
              <button
                type="button"
                onClick={resetToDefaults}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3.5 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm shadow-primary/20 hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                {isPending ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </div>

          {/* ── Messaging ──────────────────────────────────── */}
          <SectionCard icon={Tablet} title="Messaging" description="Text displayed on the kiosk screen.">
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldRow label="Welcome message" hint="Shown above the first customer choice.">
                <input type="text" value={welcomeMessage} onChange={(e) => setWelcomeMessage(e.target.value)} className={inputClass} />
              </FieldRow>
              <FieldRow label="Header text">
                <input type="text" value={headerText} onChange={(e) => setHeaderText(e.target.value)} className={inputClass} />
              </FieldRow>
              <FieldRow label="Primary button label">
                <input type="text" value={buttonLabel} onChange={(e) => setButtonLabel(e.target.value)} className={inputClass} />
              </FieldRow>
            </div>
          </SectionCard>

          {/* ── Appearance ─────────────────────────────────── */}
          <SectionCard icon={Palette} title="Appearance" description="Color and branding for the kiosk.">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={normalizeThemeColor(themeColor, templateDefaults.themeColor)}
                  onChange={(e) => setThemeColor(e.target.value)}
                  className="h-10 w-14 cursor-pointer rounded-lg border border-border bg-background"
                />
                <div className="flex-1">
                  <FieldRow label="Theme color">
                    <input type="text" value={themeColor} onChange={(e) => setThemeColor(e.target.value)} className={`${inputClass} font-mono`} />
                  </FieldRow>
                </div>
              </div>

              <div className="divide-y divide-border rounded-xl border border-border px-4">
                <InlineToggle title="Show business logo" description="Display logo in the kiosk header." checked={showLogo} onChange={setShowLogo} />
              </div>

              {showLogo && (
                <FieldRow label="Logo image URL" hint={organization.logo_url ? `Falls back to organization logo.` : 'Paste a direct image URL.'}>
                  <div className="relative">
                    <ImageIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input type="url" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://example.com/logo.png" className={`${inputClass} pl-9`} />
                  </div>
                </FieldRow>
              )}
            </div>
          </SectionCard>

          {/* ── Flow ───────────────────────────────────────── */}
          <SectionCard icon={Lock} title="Flow" description="Control how the kiosk behaves for customers.">
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FieldRow label="Starting department" hint="Skip department selection by locking to one.">
                  <select value={lockedDepartmentId} onChange={(e) => setLockedDepartmentId(e.target.value)} className={inputClass}>
                    <option value="">Let customers choose</option>
                    {activeDepartments.map((dept) => (
                      <option key={dept.id} value={dept.id}>{dept.name} ({dept.code})</option>
                    ))}
                  </select>
                </FieldRow>
                <FieldRow label="Idle reset" hint="Seconds before the kiosk resets to start.">
                  <div className="relative">
                    <Clock3 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input type="number" min={10} max={300} value={idleTimeout} onChange={(e) => setIdleTimeout(Number(e.target.value))} className={`${inputClass} pl-9`} />
                  </div>
                </FieldRow>
              </div>

              <div className="divide-y divide-border rounded-xl border border-border px-4">
                <InlineToggle title="Show estimated wait times" description="Display timing on service buttons." checked={showEstimatedTime} onChange={setShowEstimatedTime} />
                <InlineToggle
                  title="Show priority selection"
                  description={availablePriorityFlow ? 'Let customers choose a priority category.' : 'Disabled — queue policy does not support priorities.'}
                  checked={availablePriorityFlow && showPriorities}
                  onChange={setShowPriorities}
                  disabled={!availablePriorityFlow}
                />
                <InlineToggle title="Appointment check-in" description="Let customers search and check in for booked appointments." checked={showAppointmentCheckIn} onChange={setShowAppointmentCheckIn} />
                <InlineToggle title="Group tickets" description="Allow multiple tickets for a group in one transaction." checked={showGroupTickets} onChange={setShowGroupTickets} />
              </div>
            </div>
          </SectionCard>

          {/* ── Visibility ─────────────────────────────────── */}
          <SectionCard icon={Eye} title="Visibility" description="Choose which departments and services appear on the kiosk.">
            {activeDepartments.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No active departments. Add departments in the setup section.
              </p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-border">
                <div className="grid grid-cols-[minmax(0,1fr)_80px] bg-muted/40 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <span>Department / Service</span>
                  <span className="text-right">Visible</span>
                </div>

                <div className="divide-y divide-border">
                  {activeDepartments.map((department) => {
                    const departmentVisible = !hiddenDepartments.includes(department.id);
                    const activeServices = (department.services ?? [])
                      .filter((service) => service.is_active)
                      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

                    return (
                      <div key={department.id} className="bg-card">
                        <div className="grid grid-cols-[minmax(0,1fr)_80px] items-center gap-4 px-4 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium text-foreground">{department.name}</p>
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{department.code}</span>
                            {lockedDepartmentId === department.id && (
                              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">Start here</span>
                            )}
                          </div>
                          <div className="flex justify-end">
                            <Switch checked={departmentVisible} onChange={(checked) => setDepartmentVisibility(department.id, checked)} label={`${department.name} visibility`} />
                          </div>
                        </div>

                        {activeServices.length > 0 && (
                          <div className="border-t border-border bg-muted/20">
                            {activeServices.map((service) => {
                              const serviceVisible = departmentVisible && !hiddenServices.includes(service.id);
                              return (
                                <div key={service.id} className="grid grid-cols-[minmax(0,1fr)_80px] items-center gap-4 px-4 py-2.5">
                                  <div className="flex items-center gap-2 pl-5">
                                    {serviceVisible ? <Eye className="h-3.5 w-3.5 text-muted-foreground/60" /> : <EyeOff className="h-3.5 w-3.5 text-muted-foreground/40" />}
                                    <p className={`text-sm ${serviceVisible ? 'text-foreground' : 'text-muted-foreground'}`}>{service.name}</p>
                                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{service.code}</span>
                                  </div>
                                  <div className="flex justify-end">
                                    <Switch checked={serviceVisible} onChange={(checked) => setServiceVisibility(service.id, checked)} disabled={!departmentVisible} label={`${service.name} visibility`} />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </SectionCard>

          {/* ── Public Links ──────────────────────────────── */}
          {activeOffices.length > 0 && (
            <SectionCard icon={Link2} title="Public Links" description="Share the kiosk, booking, and check-in pages with customers.">
              <div className="space-y-2">
                {activeOffices.map((office) => {
                  const isExpanded = expandedOffice === office.id;
                  return (
                    <div key={office.id} className="rounded-xl border border-border overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setExpandedOffice(isExpanded ? null : office.id)}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
                      >
                        <div className="flex items-center gap-2.5">
                          {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                          <span className="text-sm font-medium text-foreground">{office.name}</span>
                        </div>
                        <a href={buildKioskPath(office)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                          Open kiosk <ExternalLink className="h-3 w-3" />
                        </a>
                      </button>

                      {isExpanded && (
                        <div className="border-t border-border bg-muted/10 px-4 py-4 space-y-4">
                          <div>
                            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Kiosk page</p>
                            <PublicLinkActions path={buildKioskPath(office)} qrTitle={`${office.name} kiosk`} qrDescription="Scan to open the self-service kiosk." downloadName={`${office.name.toLowerCase().replace(/\s+/g, '-')}-kiosk.png`} />
                          </div>
                          <div>
                            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Booking page</p>
                            <PublicLinkActions path={buildBookingPath(office)} qrTitle={`${office.name} booking`} qrDescription="Scan to open the booking page." downloadName={`${office.name.toLowerCase().replace(/\s+/g, '-')}-booking.png`} />
                          </div>
                          <div>
                            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Arrival check-in</p>
                            <PublicLinkActions path={buildBookingCheckInPath(office)} qrTitle={`${office.name} arrival check-in`} qrDescription="Scan to look up and check in an appointment." downloadName={`${office.name.toLowerCase().replace(/\s+/g, '-')}-checkin.png`} />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          )}

          {/* ── Business Hours ──────────────────────────────── */}
          {activeOffices.length > 0 && (
            <SectionCard icon={CalendarDays} title="Business Hours" description="Operating schedule shown on the kiosk when the office is closed.">
              <div className="space-y-3">
                {activeOffices.map((office) => {
                  const oh = office.operating_hours as OperatingHours | null;
                  const tz = office.timezone || 'UTC';
                  const status = isOfficeOpen(oh, tz);
                  const schedule = formatOperatingHours(oh);
                  return (
                    <div key={office.id} className="rounded-xl border border-border overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-3 bg-card">
                        <div className="flex items-center gap-2.5">
                          <span className={`h-2.5 w-2.5 rounded-full ${status.isOpen ? 'bg-emerald-500' : 'bg-red-400'}`} />
                          <span className="text-sm font-medium text-foreground">{office.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-medium ${status.isOpen ? 'text-emerald-600' : 'text-red-500'}`}>
                            {status.isOpen ? `Open until ${status.todayHours?.close ?? '--:--'}` : 'Closed'}
                          </span>
                          <a
                            href="/admin/offices"
                            className="text-xs text-primary hover:underline"
                          >
                            Edit
                          </a>
                        </div>
                      </div>
                      <div className="border-t border-border bg-muted/10 px-4 py-3">
                        <div className="grid grid-cols-2 gap-1.5 text-xs">
                          {schedule.map((row) => (
                            <div key={row.day} className="flex justify-between gap-2 py-0.5">
                              <span className="text-muted-foreground">{capitalizeDay(row.day)}</span>
                              <span className="font-medium text-foreground">{row.hours}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <p className="text-xs text-muted-foreground">
                  Edit hours and holidays in{' '}
                  <a href="/admin/offices" className="text-primary hover:underline font-medium">Office settings</a>.
                </p>
              </div>
            </SectionCard>
          )}
        </div>
      </div>

      {/* ─── Right: Live Preview ────────────────────────────── */}
      {showPreview && (
        <div className="flex-1 overflow-hidden bg-muted/20 p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Kiosk Preview
            </p>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live
            </span>
          </div>
          <div
            className="relative w-full overflow-hidden rounded-2xl border border-border bg-white shadow-2xl"
            style={{ height: 'calc(100vh - 130px)' }}
          >
            <div
              style={{
                transform: 'scale(0.55)',
                transformOrigin: 'top left',
                width: `${100 / 0.55}%`,
                height: `${100 / 0.55}%`,
                position: 'absolute',
                top: 0,
                left: 0,
                pointerEvents: 'none',
              }}
            >
              <KioskView
                office={previewOffice}
                organization={previewOrg}
                departments={previewDepartments}
                kioskSettings={previewKioskSettings}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Section Card wrapper ──────────────────────────────────────────────

function SectionCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof Tablet;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-start gap-3 mb-5">
        <div className="rounded-xl bg-primary/10 p-2 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
