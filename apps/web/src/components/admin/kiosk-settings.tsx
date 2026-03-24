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
import { useI18n } from '@/components/providers/locale-provider';
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
    mode: 'normal' | 'quick_book';
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

function translateDefaultValue(
  value: string,
  t: (key: string, params?: Record<string, string | number | null | undefined>) => string
) {
  const translated = t(value);
  return translated === value ? value : translated;
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
  const { t } = useI18n();
  const [isPending, startTransition] = useTransition();
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const settings = organization.settings ?? {};
  const organizationLogoUrl = organization.logo_url?.trim() ?? '';
  const activeOffices = offices.filter((office) => office.is_active);
  const activeDepartments = useMemo(
    () =>
      departments
        .filter((department) => department.is_active)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [departments]
  );

  const [welcomeMessage, setWelcomeMessage] = useState<string>(
    translateDefaultValue(settings.kiosk_welcome_message ?? templateDefaults.welcomeMessage, t)
  );
  const [headerText, setHeaderText] = useState<string>(
    translateDefaultValue(settings.kiosk_header_text ?? templateDefaults.headerText, t)
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
  const [kioskMode, setKioskMode] = useState<'normal' | 'quick_book'>(
    settings.kiosk_mode ?? templateDefaults.mode
  );
  const [logoUrl, setLogoUrl] = useState<string>(settings.kiosk_logo_url ?? organizationLogoUrl);
  const resolvedLogoUrl = logoUrl.trim() || organizationLogoUrl;
  const [showLogo, setShowLogo] = useState<boolean>(
    Boolean(settings.kiosk_show_logo ?? resolvedLogoUrl)
  );
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
    translateDefaultValue(settings.kiosk_button_label ?? templateDefaults.buttonLabel, t)
  );
  const [idleTimeout, setIdleTimeout] = useState<number>(
    settings.kiosk_idle_timeout ?? templateDefaults.idleTimeoutSeconds
  );

  const availablePriorityFlow = priorityMode !== 'none';
  const lockedDepartment = activeDepartments.find((department) => department.id === lockedDepartmentId);
  const visibleDepartmentCount = activeDepartments.filter(
    (department) => !hiddenDepartments.includes(department.id)
  ).length;
  const startsOnServices = kioskMode === 'normal' && (Boolean(lockedDepartment) || visibleDepartmentCount === 1);
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
    setWelcomeMessage(translateDefaultValue(templateDefaults.welcomeMessage, t));
    setHeaderText(translateDefaultValue(templateDefaults.headerText, t));
    setThemeColor(templateDefaults.themeColor);
    setShowPriorities(availablePriorityFlow && templateDefaults.showPriorities);
    setKioskMode(templateDefaults.mode);
    setLogoUrl(organizationLogoUrl);
    setShowLogo(Boolean(organizationLogoUrl));
    setShowEstimatedTime(templateDefaults.showEstimatedTime);
    setHiddenDepartments([]);
    setHiddenServices([]);
    setLockedDepartmentId('');
    setButtonLabel(translateDefaultValue(templateDefaults.buttonLabel, t));
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
        kiosk_mode: kioskMode,
        kiosk_show_logo: Boolean(showLogo && (logoUrl.trim() || organizationLogoUrl)),
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
      setSuccessMessage(t('Kiosk settings saved.'));
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
              {t('Kiosk')}
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">{t('Kiosk Settings')}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {t('Clean up the customer-facing screen and control which services appear.')}
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
              {t('Reset')}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isPending}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {isPending ? t('Saving...') : t('Save changes')}
            </button>
          </div>
        </div>

        <div className="grid gap-4 px-6 py-5 md:grid-cols-3">
          <div className="rounded-xl border border-border bg-background px-4 py-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Tablet className="h-3.5 w-3.5" />
              {t('Active offices')}
            </div>
            <p className="mt-2 text-2xl font-semibold text-foreground">{activeOffices.length}</p>
          </div>
          <div className="rounded-xl border border-border bg-background px-4 py-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Layers3 className="h-3.5 w-3.5" />
              {t('Visible departments')}
            </div>
            <p className="mt-2 text-2xl font-semibold text-foreground">{visibleDepartmentCount}</p>
          </div>
          <div className="rounded-xl border border-border bg-background px-4 py-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Ticket className="h-3.5 w-3.5" />
              {t('Visible services')}
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
              title={t('Customer Screen')}
              description={t('Core copy, color, and kiosk options.')}
            />

            <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="space-y-5">
                <FieldBlock
                  label={t('Welcome message')}
                  hint={t('This appears above the first customer choice.')}
                >
                  <input
                    type="text"
                    value={welcomeMessage}
                    onChange={(event) => setWelcomeMessage(event.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:ring-2 focus:ring-primary/30"
                  />
                </FieldBlock>

                <FieldBlock label={t('Header text')}>
                  <input
                    type="text"
                    value={headerText}
                    onChange={(event) => setHeaderText(event.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:ring-2 focus:ring-primary/30"
                  />
                </FieldBlock>

                <FieldBlock label={t('Primary button label')}>
                  <input
                    type="text"
                    value={buttonLabel}
                    onChange={(event) => setButtonLabel(event.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:ring-2 focus:ring-primary/30"
                  />
                </FieldBlock>

                <FieldBlock
                  label={t('Kiosk mode')}
                  hint={t('Quick book puts booking first on the opening screen.')}
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setKioskMode('normal')}
                      className={`rounded-xl border px-4 py-4 text-left transition-colors ${
                        kioskMode === 'normal'
                          ? 'border-primary bg-primary/5'
                          : 'border-border bg-background hover:bg-muted/60'
                      }`}
                    >
                      <p className="text-sm font-semibold text-foreground">{t('Normal')}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{t('Queue button first.')}</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setKioskMode('quick_book')}
                      className={`rounded-xl border px-4 py-4 text-left transition-colors ${
                        kioskMode === 'quick_book'
                          ? 'border-primary bg-primary/5'
                          : 'border-border bg-background hover:bg-muted/60'
                      }`}
                    >
                      <p className="text-sm font-semibold text-foreground">{t('Quick book')}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{t('Booking button first.')}</p>
                    </button>
                  </div>
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
                      <p className="font-medium text-foreground">{t('Theme color')}</p>
                      <p className="text-sm text-muted-foreground">{t('Used for kiosk emphasis.')}</p>
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
                  title={t('Show business logo')}
                  description={
                    resolvedLogoUrl
                      ? t('Display the uploaded business logo in the kiosk header.')
                      : t('Upload or paste a logo URL first to show a logo in the kiosk header.')
                  }
                  checked={showLogo}
                  onChange={setShowLogo}
                  disabled={!resolvedLogoUrl}
                />

                <FieldBlock
                  label={t('Logo image URL')}
                  hint={
                    organizationLogoUrl
                      ? t('Organization logo available: {url}', { url: organizationLogoUrl })
                      : t('Paste a direct uploaded image URL, or add an organization logo in Settings.')
                  }
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
                  title={t('Show estimated wait times')}
                  description={t('Expose service timing on kiosk buttons.')}
                  checked={showEstimatedTime}
                  onChange={setShowEstimatedTime}
                />

                <InlineSwitchRow
                  title={t('Show priority selection')}
                  description={
                    availablePriorityFlow
                      ? t('Let customers choose a priority category.')
                      : t('Disabled because the active queue policy does not support priorities.')
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
              title={t('Flow Behavior')}
              description={t('Where the kiosk starts and when it resets.')}
            />

            <div className="mt-6 grid gap-5 lg:grid-cols-2">
              <FieldBlock
                label={t('Starting department')}
                hint={t('Choose a department to skip the department selection screen.')}
              >
                <select
                  value={lockedDepartmentId}
                  onChange={(event) => setLockedDepartmentId(event.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:ring-2 focus:ring-primary/30"
                >
                  <option value="">{t('Let customers choose a department')}</option>
                  {activeDepartments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name} ({department.code})
                    </option>
                  ))}
                </select>
              </FieldBlock>

              <FieldBlock
                label={t('Idle reset time')}
                hint={t('Number of seconds before the kiosk resets back to the start.')}
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
              <span className="font-medium text-foreground">{t('Current setup:')}</span>{' '}
              {kioskMode === 'quick_book'
                ? t('Starts with booking')
                : startsOnServices
                  ? t('Starts with services{department}', {
                      department: lockedDepartment ? ` ${t('in')} ${lockedDepartment.name}` : '',
                    })
                  : t('Starts with department selection')}
              {' · '}
              {kioskMode === 'quick_book' ? t('booking first') : t('queue first')}
              {' · '}
              {availablePriorityFlow && showPriorities ? t('priority step on') : t('priority step off')}
              {' · '}
              {showEstimatedTime ? t('wait times shown') : t('wait times hidden')}
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <SectionHeader
              icon={Eye}
              title={t('Visibility')}
              description={t('Control exactly which departments and services appear on the kiosk.')}
            />

            <div className="mt-6 overflow-hidden rounded-xl border border-border">
              <div className="grid grid-cols-[minmax(0,1fr)_120px] bg-muted/40 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <span>{t('Department / Service')}</span>
                <span className="text-right">{t('Visible')}</span>
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
                                {t('Start here')}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {departmentVisible
                              ? t('Department visible on kiosk')
                              : t('Department hidden from kiosk')}
                          </p>
                        </div>
                        <div className="flex justify-end">
                          <Switch
                            checked={departmentVisible}
                            onChange={(checked) => setDepartmentVisibility(department.id, checked)}
                            label={t('{name} visibility', { name: department.name })}
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
                                    label={t('{name} visibility', { name: service.name })}
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
              title={t('Public Links')}
              description={t('Open or share the live kiosk and booking pages.')}
            />

            <div className="mt-6 space-y-4">
              {activeOffices.map((office) => (
                <div key={office.id} className="rounded-xl border border-border bg-background p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{office.name}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{t('Active office')}</p>
                    </div>
                    <a
                      href={buildKioskPath(office)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                    >
                      {t('Open')}
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </div>

                  <div className="mt-4 space-y-4">
                    <div>
                      <p className="mb-2 text-sm font-medium text-foreground">{t('Kiosk page')}</p>
                      <PublicLinkActions
                        path={buildKioskPath(office)}
                        qrTitle={t('{office} kiosk', { office: office.name })}
                        qrDescription={t('Scan to open the self-service kiosk.')}
                        downloadName={`${office.name.toLowerCase().replace(/\s+/g, '-')}-kiosk.png`}
                      />
                    </div>
                    <div>
                      <p className="mb-2 text-sm font-medium text-foreground">{t('Booking page')}</p>
                      <PublicLinkActions
                        path={buildBookingPath(office)}
                        qrTitle={t('{office} booking', { office: office.name })}
                        qrDescription={t('Scan to open the booking page.')}
                        downloadName={`${office.name.toLowerCase().replace(/\s+/g, '-')}-booking.png`}
                      />
                    </div>
                    <div>
                      <p className="mb-2 text-sm font-medium text-foreground">{t('Arrival check-in')}</p>
                      <PublicLinkActions
                        path={buildBookingCheckInPath(office)}
                        qrTitle={t('{office} arrival check-in', { office: office.name })}
                        qrDescription={t('Scan to look up and check in an appointment.')}
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
              title={t('Snapshot')}
              description={t('Quick read of the kiosk behavior right now.')}
            />

            <div className="mt-6 space-y-3 rounded-xl border border-border bg-background p-4 text-sm text-muted-foreground">
              <p>
                <span className="font-medium text-foreground">{t('Start screen:')}</span>{' '}
                {kioskMode === 'quick_book'
                  ? t('Booking first')
                  : startsOnServices
                    ? lockedDepartment
                      ? t('{department} services', { department: lockedDepartment.name })
                      : t('Service list')
                    : t('Department selection')}
              </p>
              <p>
                <span className="font-medium text-foreground">{t('Mode:')}</span>{' '}
                {kioskMode === 'quick_book' ? t('Quick book') : t('Normal')}
              </p>
              <p>
                <span className="font-medium text-foreground">{t('Priority step:')}</span>{' '}
                {availablePriorityFlow && showPriorities ? t('Shown') : t('Hidden')}
              </p>
              <p>
                <span className="font-medium text-foreground">{t('Logo:')}</span>{' '}
                {showLogo && resolvedLogoUrl
                  ? t('Shown')
                  : resolvedLogoUrl
                    ? t('Available but hidden')
                    : t('No logo uploaded')}
              </p>
              <p>
                <span className="font-medium text-foreground">{t('Wait times:')}</span>{' '}
                {showEstimatedTime ? t('Shown') : t('Hidden')}
              </p>
              <p>
                <span className="font-medium text-foreground">{t('Idle reset:')}</span> {idleTimeout}s
              </p>
              <p>
                <span className="font-medium text-foreground">{t('Theme:')}</span> {themeColor}
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
