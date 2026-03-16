'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  CheckCircle2,
  Clock3,
  ExternalLink,
  Eye,
  ImageIcon,
  Layers3,
  Link2,
  Lock,
  Palette,
  RotateCcw,
  Save,
  Tablet,
  Ticket,
} from 'lucide-react';
import { updateKioskSettings } from '@/lib/actions/admin-actions';
import { buildBookingCheckInPath, buildBookingPath, buildKioskPath } from '@/lib/office-links';
import { PublicLinkActions } from './public-link-actions';

interface Office {
  id: string;
  name: string;
  is_active: boolean;
  settings?: Record<string, unknown> | null;
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

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
}

function normalizeThemeColor(value: string, fallback: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim() : fallback;
}

function Switch({ checked, onChange, disabled = false, label }: SwitchProps) {
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

function SectionHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Tablet;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="rounded-xl bg-primary/10 p-2 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function FieldBlock({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-foreground">{label}</label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function InlineSwitchRow({
  title,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-background px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} label={title} />
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

  const availablePriorityFlow = priorityMode !== 'none';
  const lockedDepartment = activeDepartments.find((department) => department.id === lockedDepartmentId);
  const visibleDepartmentCount = activeDepartments.filter(
    (department) => !hiddenDepartments.includes(department.id)
  ).length;
  const visibleServiceCount = activeDepartments.reduce((count, department) => {
    if (hiddenDepartments.includes(department.id)) {
      return count;
    }

    return (
      count +
      (department.services ?? []).filter(
        (service) => service.is_active && !hiddenServices.includes(service.id)
      ).length
    );
  }, 0);

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

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <section className="rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-5 border-b border-border px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              <Tablet className="h-3.5 w-3.5" />
              Kiosk
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Kiosk Settings</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Clean up the customer-facing screen and control which services appear.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {successMessage ? (
              <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                {successMessage}
              </span>
            ) : null}
            {errorMessage ? <span className="text-sm text-destructive">{errorMessage}</span> : null}
            <button
              type="button"
              onClick={resetToDefaults}
              disabled={isPending}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" />
              Reset
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isPending}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {isPending ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        </div>

        <div className="grid gap-4 px-6 py-5 md:grid-cols-3">
          <div className="rounded-xl border border-border bg-background px-4 py-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Tablet className="h-3.5 w-3.5" />
              Active offices
            </div>
            <p className="mt-2 text-2xl font-semibold text-foreground">{activeOffices.length}</p>
          </div>
          <div className="rounded-xl border border-border bg-background px-4 py-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Layers3 className="h-3.5 w-3.5" />
              Visible departments
            </div>
            <p className="mt-2 text-2xl font-semibold text-foreground">{visibleDepartmentCount}</p>
          </div>
          <div className="rounded-xl border border-border bg-background px-4 py-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Ticket className="h-3.5 w-3.5" />
              Visible services
            </div>
            <p className="mt-2 text-2xl font-semibold text-foreground">{visibleServiceCount}</p>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.9fr)]">
        <div className="space-y-6">
          <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <SectionHeader
              icon={Palette}
              title="Customer Screen"
              description="Core copy, color, and kiosk options."
            />

            <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="space-y-5">
                <FieldBlock
                  label="Welcome message"
                  hint="This appears above the first customer choice."
                >
                  <input
                    type="text"
                    value={welcomeMessage}
                    onChange={(event) => setWelcomeMessage(event.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:ring-2 focus:ring-primary/30"
                  />
                </FieldBlock>

                <FieldBlock label="Header text">
                  <input
                    type="text"
                    value={headerText}
                    onChange={(event) => setHeaderText(event.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:ring-2 focus:ring-primary/30"
                  />
                </FieldBlock>

                <FieldBlock label="Primary button label">
                  <input
                    type="text"
                    value={buttonLabel}
                    onChange={(event) => setButtonLabel(event.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:ring-2 focus:ring-primary/30"
                  />
                </FieldBlock>
              </div>

              <div className="space-y-4 rounded-xl border border-border bg-background p-4">
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="h-12 w-12 rounded-xl border"
                      style={{
                        backgroundColor: themeColor,
                        borderColor: `${themeColor}55`,
                      }}
                    />
                    <div>
                      <p className="font-medium text-foreground">Theme color</p>
                      <p className="text-sm text-muted-foreground">Used for kiosk emphasis.</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <input
                      type="color"
                      value={normalizeThemeColor(themeColor, templateDefaults.themeColor)}
                      onChange={(event) => setThemeColor(event.target.value)}
                      className="h-11 w-16 cursor-pointer rounded-xl border border-border bg-background"
                    />
                    <input
                      type="text"
                      value={themeColor}
                      onChange={(event) => setThemeColor(event.target.value)}
                      className="w-full rounded-xl border border-border bg-background px-4 py-3 font-mono text-sm text-foreground outline-none transition focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                </div>

                <InlineSwitchRow
                  title="Show business logo"
                  description="Display the business logo in the kiosk header."
                  checked={showLogo}
                  onChange={setShowLogo}
                />

                <FieldBlock
                  label="Logo image URL"
                  hint={organization.logo_url ? `Organization logo available: ${organization.logo_url}` : 'Paste a direct image URL, or leave blank to use the organization logo if available.'}
                >
                  <div className="relative">
                    <ImageIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="url"
                      value={logoUrl}
                      onChange={(event) => setLogoUrl(event.target.value)}
                      placeholder="https://example.com/logo.png"
                      className="w-full rounded-xl border border-border bg-background px-10 py-3 text-sm text-foreground outline-none transition focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                </FieldBlock>

                <InlineSwitchRow
                  title="Show estimated wait times"
                  description="Expose service timing on kiosk buttons."
                  checked={showEstimatedTime}
                  onChange={setShowEstimatedTime}
                />

                <InlineSwitchRow
                  title="Show priority selection"
                  description={
                    availablePriorityFlow
                      ? 'Let customers choose a priority category.'
                      : 'Disabled because the active queue policy does not support priorities.'
                  }
                  checked={availablePriorityFlow && showPriorities}
                  onChange={setShowPriorities}
                  disabled={!availablePriorityFlow}
                />
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <SectionHeader
              icon={Lock}
              title="Flow Behavior"
              description="Where the kiosk starts and when it resets."
            />

            <div className="mt-6 grid gap-5 lg:grid-cols-2">
              <FieldBlock
                label="Starting department"
                hint="Choose a department to skip the department selection screen."
              >
                <select
                  value={lockedDepartmentId}
                  onChange={(event) => setLockedDepartmentId(event.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:ring-2 focus:ring-primary/30"
                >
                  <option value="">Let customers choose a department</option>
                  {activeDepartments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name} ({department.code})
                    </option>
                  ))}
                </select>
              </FieldBlock>

              <FieldBlock
                label="Idle reset time"
                hint="Number of seconds before the kiosk resets back to the start."
              >
                <div className="relative">
                  <Clock3 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="number"
                    min={10}
                    max={300}
                    value={idleTimeout}
                    onChange={(event) => setIdleTimeout(Number(event.target.value))}
                    className="w-full rounded-xl border border-border bg-background px-10 py-3 text-sm text-foreground outline-none transition focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              </FieldBlock>
            </div>

            <div className="mt-5 rounded-xl border border-border bg-background px-4 py-3 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Current setup:</span>{' '}
              {lockedDepartment ? `Starts in ${lockedDepartment.name}` : 'Starts with department selection'}
              {' · '}
              {availablePriorityFlow && showPriorities ? 'priority step on' : 'priority step off'}
              {' · '}
              {showEstimatedTime ? 'wait times shown' : 'wait times hidden'}
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <SectionHeader
              icon={Eye}
              title="Visibility"
              description="Control exactly which departments and services appear on the kiosk."
            />

            <div className="mt-6 overflow-hidden rounded-xl border border-border">
              <div className="grid grid-cols-[minmax(0,1fr)_120px] bg-muted/40 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
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
                      <div className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-4 px-4 py-4">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium text-foreground">{department.name}</p>
                            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                              {department.code}
                            </span>
                            {lockedDepartmentId === department.id ? (
                              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                                Start here
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {departmentVisible ? 'Department visible on kiosk' : 'Department hidden from kiosk'}
                          </p>
                        </div>
                        <div className="flex justify-end">
                          <Switch
                            checked={departmentVisible}
                            onChange={(checked) => setDepartmentVisibility(department.id, checked)}
                            label={`${department.name} visibility`}
                          />
                        </div>
                      </div>

                      {activeServices.length > 0 ? (
                        <div className="border-t border-border bg-background/70">
                          {activeServices.map((service) => {
                            const serviceVisible =
                              departmentVisible && !hiddenServices.includes(service.id);

                            return (
                              <div
                                key={service.id}
                                className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-4 px-4 py-3"
                              >
                                <div className="pl-4">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-sm font-medium text-foreground">{service.name}</p>
                                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                                      {service.code}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex justify-end">
                                  <Switch
                                    checked={serviceVisible}
                                    onChange={(checked) => setServiceVisibility(service.id, checked)}
                                    disabled={!departmentVisible}
                                    label={`${service.name} visibility`}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        </div>

        <div className="space-y-6">
          <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <SectionHeader
              icon={Link2}
              title="Public Links"
              description="Open or share the live kiosk and booking pages."
            />

            <div className="mt-6 space-y-4">
              {activeOffices.map((office) => (
                <div key={office.id} className="rounded-xl border border-border bg-background p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{office.name}</p>
                      <p className="mt-1 text-sm text-muted-foreground">Active office</p>
                    </div>
                    <a
                      href={buildKioskPath(office)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                    >
                      Open
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </div>

                  <div className="mt-4 space-y-4">
                    <div>
                      <p className="mb-2 text-sm font-medium text-foreground">Kiosk page</p>
                      <PublicLinkActions
                        path={buildKioskPath(office)}
                        qrTitle={`${office.name} kiosk`}
                        qrDescription="Scan to open the self-service kiosk."
                        downloadName={`${office.name.toLowerCase().replace(/\s+/g, '-')}-kiosk.png`}
                      />
                    </div>
                    <div>
                      <p className="mb-2 text-sm font-medium text-foreground">Booking page</p>
                      <PublicLinkActions
                        path={buildBookingPath(office)}
                        qrTitle={`${office.name} booking`}
                        qrDescription="Scan to open the booking page."
                        downloadName={`${office.name.toLowerCase().replace(/\s+/g, '-')}-booking.png`}
                      />
                    </div>
                    <div>
                      <p className="mb-2 text-sm font-medium text-foreground">Arrival check-in</p>
                      <PublicLinkActions
                        path={buildBookingCheckInPath(office)}
                        qrTitle={`${office.name} arrival check-in`}
                        qrDescription="Scan to look up and check in an appointment."
                        downloadName={`${office.name.toLowerCase().replace(/\s+/g, '-')}-checkin.png`}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <SectionHeader
              icon={Tablet}
              title="Snapshot"
              description="Quick read of the kiosk behavior right now."
            />

            <div className="mt-6 space-y-3 rounded-xl border border-border bg-background p-4 text-sm text-muted-foreground">
              <p>
                <span className="font-medium text-foreground">Start screen:</span>{' '}
                {lockedDepartment ? lockedDepartment.name : 'Department selection'}
              </p>
              <p>
                <span className="font-medium text-foreground">Priority step:</span>{' '}
                {availablePriorityFlow && showPriorities ? 'Shown' : 'Hidden'}
              </p>
              <p>
                <span className="font-medium text-foreground">Logo:</span>{' '}
                {showLogo ? (logoUrl.trim() || organization.logo_url ? 'Shown' : 'Enabled without image') : 'Hidden'}
              </p>
              <p>
                <span className="font-medium text-foreground">Wait times:</span>{' '}
                {showEstimatedTime ? 'Shown' : 'Hidden'}
              </p>
              <p>
                <span className="font-medium text-foreground">Idle reset:</span> {idleTimeout}s
              </p>
              <p>
                <span className="font-medium text-foreground">Theme:</span> {themeColor}
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
