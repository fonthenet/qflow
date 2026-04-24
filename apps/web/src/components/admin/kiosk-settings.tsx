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
import { updateKioskSettings, updateOfficeKioskOverrides } from '@/lib/actions/admin-actions';
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
    <div className="mx-auto max-w-3xl space-y-8 p-6">
      {/* ── Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('Kiosk Settings')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('Configure the customer-facing kiosk screen.')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {successMessage ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />
              {successMessage}
            </span>
          ) : null}
          {errorMessage ? <span className="text-sm text-destructive">{errorMessage}</span> : null}
          <button
            type="button"
            onClick={resetToDefaults}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3.5 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
          >
            <RotateCcw className="h-4 w-4" />
            {t('Reset')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {isPending ? t('Saving...') : t('Save changes')}
          </button>
        </div>
      </div>

      {/* The same settings power both the remote web kiosk (`/k/...`) and
          the local kiosk served by Qflo Station. A short reminder replaces
          the old Remote/Local tab switcher, which implied two separate
          configs when there's actually just one. Per-office overrides live
          in the Visibility section below. */}
      <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        <Tablet className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          <span className="font-medium">{t('These settings power both kiosks.')}</span>{' '}
          {t('The web kiosk (remote link) and the local kiosk served by Qflo Station share the same configuration. Open the live URLs in the Access section at the bottom.')}
        </p>
      </div>

      {/* ── 1. Text & Copy ── */}
      <section className="rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-sm font-semibold text-foreground">{t('Text & Copy')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('What customers see on the kiosk screen.')}</p>
        </div>
        <div className="space-y-5 px-6 py-5">
          <FieldBlock label={t('Welcome message')} hint={t('This appears above the first customer choice.')}>
            <input
              type="text"
              value={welcomeMessage}
              onChange={(event) => setWelcomeMessage(event.target.value)}
              className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm text-foreground outline-none transition focus:ring-2 focus:ring-primary/30"
            />
          </FieldBlock>
          <div className="grid gap-5 sm:grid-cols-2">
            <FieldBlock label={t('Header text')}>
              <input
                type="text"
                value={headerText}
                onChange={(event) => setHeaderText(event.target.value)}
                className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm text-foreground outline-none transition focus:ring-2 focus:ring-primary/30"
              />
            </FieldBlock>
            <FieldBlock label={t('Primary button label')}>
              <input
                type="text"
                value={buttonLabel}
                onChange={(event) => setButtonLabel(event.target.value)}
                className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm text-foreground outline-none transition focus:ring-2 focus:ring-primary/30"
              />
            </FieldBlock>
          </div>
        </div>
      </section>

      {/* ── 2. Logo ── */}
      <section className="rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-sm font-semibold text-foreground">{t('Logo')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('Branding shown in the kiosk header.')}</p>
        </div>
        <div className="space-y-5 px-6 py-5">
          <div className="space-y-0 divide-y divide-border rounded-lg border border-border">
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">{t('Show business logo')}</p>
                <p className="text-xs text-muted-foreground">
                  {resolvedLogoUrl
                    ? t('Display logo in the kiosk header.')
                    : t('Add a logo in Settings → Business to enable this.')}
                </p>
              </div>
              <Switch checked={showLogo} onChange={setShowLogo} disabled={!resolvedLogoUrl} label={t('Show business logo')} />
            </div>
          </div>

          {showLogo ? (
            <FieldBlock
              label={t('Logo image URL')}
              hint={
                organizationLogoUrl
                  ? t('Falls back to organization logo if empty.')
                  : t('Paste a direct image URL, or add a logo in Business Settings.')
              }
            >
              <div className="relative">
                <ImageIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="url"
                  value={logoUrl}
                  onChange={(event) => setLogoUrl(event.target.value)}
                  placeholder="https://example.com/logo.png"
                  className="w-full rounded-lg border border-border bg-background px-10 py-2.5 text-sm text-foreground outline-none transition focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </FieldBlock>
          ) : null}
        </div>
      </section>

      {/* ── 3. Behavior ── */}
      <section className="rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-sm font-semibold text-foreground">{t('Behavior')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('How the kiosk flows and resets.')}</p>
        </div>
        <div className="space-y-5 px-6 py-5">
          <FieldBlock label={t('Kiosk mode')} hint={t('Quick book puts booking first on the opening screen.')}>
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setKioskMode('normal')}
                className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                  kioskMode === 'normal'
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-background hover:bg-muted/60'
                }`}
              >
                <p className="text-sm font-semibold text-foreground">{t('Normal')}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{t('Queue button first.')}</p>
              </button>
              <button
                type="button"
                onClick={() => setKioskMode('quick_book')}
                className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                  kioskMode === 'quick_book'
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-background hover:bg-muted/60'
                }`}
              >
                <p className="text-sm font-semibold text-foreground">{t('Quick book')}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{t('Booking button first.')}</p>
              </button>
            </div>
          </FieldBlock>

          <div className="grid gap-5 sm:grid-cols-2">
            <FieldBlock label={t('Starting department')} hint={t('Skip the department picker.')}>
              <select
                value={lockedDepartmentId}
                onChange={(event) => setLockedDepartmentId(event.target.value)}
                className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm text-foreground outline-none transition focus:ring-2 focus:ring-primary/30"
              >
                <option value="">{t('Let customers choose')}</option>
                {activeDepartments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name} ({department.code})
                  </option>
                ))}
              </select>
            </FieldBlock>
            <FieldBlock label={t('Idle reset time')} hint={t('Seconds before the kiosk resets.')}>
              <div className="relative">
                <Clock3 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="number"
                  min={10}
                  max={300}
                  value={idleTimeout}
                  onChange={(event) => setIdleTimeout(Number(event.target.value))}
                  className="w-full rounded-lg border border-border bg-background px-10 py-2.5 text-sm text-foreground outline-none transition focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </FieldBlock>
          </div>

          <div className="space-y-0 divide-y divide-border rounded-lg border border-border">
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">{t('Show estimated wait times')}</p>
                <p className="text-xs text-muted-foreground">{t('Display service timing on buttons.')}</p>
              </div>
              <Switch checked={showEstimatedTime} onChange={setShowEstimatedTime} label={t('Show estimated wait times')} />
            </div>
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">{t('Show priority selection')}</p>
                <p className="text-xs text-muted-foreground">
                  {availablePriorityFlow
                    ? t('Let customers choose a priority on the kiosk.')
                    : t('Enable priorities in Queue Settings to use this.')}
                </p>
              </div>
              <Switch
                checked={availablePriorityFlow && showPriorities}
                onChange={setShowPriorities}
                disabled={!availablePriorityFlow}
                label={t('Show priority selection')}
              />
            </div>
          </div>

          {/* Current setup summary */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{t('Current setup:')}</span>
            <span>{kioskMode === 'quick_book'
              ? t('Starts with booking')
              : startsOnServices
                ? t('Starts with services{department}', {
                    department: lockedDepartment ? ` ${t('in')} ${lockedDepartment.name}` : '',
                  })
                : t('Starts with department selection')}</span>
            <span className="text-border">|</span>
            <span>{showEstimatedTime ? t('wait times shown') : t('wait times hidden')}</span>
            <span className="text-border">|</span>
            <span>{availablePriorityFlow && showPriorities ? t('priority on') : t('priority off')}</span>
          </div>
        </div>
      </section>

      {/* ── 4. Visibility ── */}
      <section className="rounded-xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{t('Visibility')}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('Which departments and services appear on the kiosk.')}</p>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span><span className="font-semibold text-foreground">{visibleDepartmentCount}</span> {t('depts')}</span>
            <span><span className="font-semibold text-foreground">{visibleServiceCount}</span> {t('services')}</span>
          </div>
        </div>

        <div className="divide-y divide-border">
          {activeDepartments.map((department) => {
            const departmentVisible = !hiddenDepartments.includes(department.id);
            const activeServices = (department.services ?? [])
              .filter((service) => service.is_active)
              .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

            return (
              <div key={department.id}>
                <div className="flex items-center justify-between gap-4 px-6 py-3.5">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{department.name}</p>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {department.code}
                    </span>
                    {lockedDepartmentId === department.id ? (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                        {t('Start here')}
                      </span>
                    ) : null}
                  </div>
                  <Switch
                    checked={departmentVisible}
                    onChange={(checked) => setDepartmentVisibility(department.id, checked)}
                    label={t('{name} visibility', { name: department.name })}
                  />
                </div>

                {departmentVisible && activeServices.length > 0 ? (
                  <div className="border-t border-border/50 bg-muted/20">
                    {activeServices.map((service) => {
                      const serviceVisible = !hiddenServices.includes(service.id);
                      return (
                        <div key={service.id} className="flex items-center justify-between gap-4 px-6 py-2.5 pl-10">
                          <div className="flex items-center gap-2">
                            <p className="text-sm text-foreground">{service.name}</p>
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                              {service.code}
                            </span>
                          </div>
                          <Switch
                            checked={serviceVisible}
                            onChange={(checked) => setServiceVisibility(service.id, checked)}
                            label={t('{name} visibility', { name: service.name })}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── 5. Per-office visibility overrides ── */}
      {activeOffices.length > 1 ? (
        <PerOfficeOverrides
          offices={activeOffices}
          departments={activeDepartments}
          orgHiddenDepartments={hiddenDepartments}
          orgHiddenServices={hiddenServices}
          orgLockedDepartmentId={lockedDepartmentId || null}
        />
      ) : null}

      {/* ── 6. Access (public links + local network) ── */}
      <section className="rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-sm font-semibold text-foreground">{t('Access')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('Open or share the remote kiosk, and connect local devices on your network.')}
          </p>
        </div>

        {/* Remote web kiosk — per office */}
        <div className="divide-y divide-border">
          {activeOffices.map((office) => (
            <div key={office.id} className="px-6 py-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ExternalLink className="h-4 w-4 text-primary" />
                  <p className="text-sm font-medium text-foreground">
                    {office.name} <span className="text-xs font-normal text-muted-foreground">· {t('Remote (web)')}</span>
                  </p>
                </div>
                <a
                  href={buildKioskPath(office)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  {t('Open kiosk')}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">{t('Kiosk page')}</p>
                  <PublicLinkActions
                    path={buildKioskPath(office)}
                    qrTitle={t('{office} kiosk', { office: office.name })}
                    qrDescription={t('Scan to open the self-service kiosk.')}
                    downloadName={`${office.name.toLowerCase().replace(/\s+/g, '-')}-kiosk.png`}
                  />
                </div>
                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">{t('Booking page')}</p>
                  <PublicLinkActions
                    path={buildBookingPath(office)}
                    qrTitle={t('{office} booking', { office: office.name })}
                    qrDescription={t('Scan to open the booking page.')}
                    downloadName={`${office.name.toLowerCase().replace(/\s+/g, '-')}-booking.png`}
                  />
                </div>
                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">{t('Arrival check-in')}</p>
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

        {/* Local kiosk info */}
        <div className="space-y-4 border-t border-border bg-muted/20 px-6 py-5">
          <div className="flex items-center gap-2">
            <Tablet className="h-4 w-4 text-primary" />
            <p className="text-sm font-medium text-foreground">{t('Local network (Qflo Station)')}</p>
          </div>
          <p className="text-sm text-muted-foreground">
            {t('Qflo Station serves a local kiosk on your network. Any device on the same WiFi can open it using the Station\'s IP.')}
          </p>
          <div className="space-y-2">
            <div className="flex items-start gap-3 rounded-lg border border-border bg-background px-4 py-3">
              <Tablet className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{t('Kiosk (tablet)')}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {t('Touch-screen ticket pickup. Open from Station → Kiosk link.')}
                </p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">http://&lt;station-ip&gt;:3847/kiosk</p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg border border-border bg-background px-4 py-3">
              <Layers3 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{t('Display (waiting room TV)')}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {t('Now-serving + queue board. Open from Station → Display link.')}
                </p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">http://&lt;station-ip&gt;:3847/display</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Per-office visibility overrides                                   *
 * ------------------------------------------------------------------ *
 * Opt-in: by default the org-wide visibility settings apply to every
 * branch. Flipping the toggle on a single office unlocks its own
 * hidden-departments / hidden-services / locked-department picks,
 * persisted into `offices.settings.kiosk_*`. Fallback order in the
 * public kiosk is: office override → org default → template profile. */

interface PerOfficeOverridesProps {
  offices: Office[];
  departments: Department[];
  orgHiddenDepartments: string[];
  orgHiddenServices: string[];
  orgLockedDepartmentId: string | null;
}

function PerOfficeOverrides({
  offices,
  departments,
  orgHiddenDepartments,
  orgHiddenServices,
  orgLockedDepartmentId,
}: PerOfficeOverridesProps) {
  const { t } = useI18n();
  return (
    <section className="rounded-xl border border-border bg-card shadow-sm">
      <div className="border-b border-border px-6 py-4">
        <h2 className="text-sm font-semibold text-foreground">{t('Per-office overrides')}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t('By default every branch uses the org-wide visibility above. Toggle an override to hide different departments or services at a single branch.')}
        </p>
      </div>
      <div className="divide-y divide-border">
        {offices.map((office) => (
          <OfficeOverrideRow
            key={office.id}
            office={office}
            departments={departments.filter((d) => d.office_id === office.id)}
            orgHiddenDepartments={orgHiddenDepartments}
            orgHiddenServices={orgHiddenServices}
            orgLockedDepartmentId={orgLockedDepartmentId}
          />
        ))}
      </div>
    </section>
  );
}

function OfficeOverrideRow({
  office,
  departments,
  orgHiddenDepartments,
  orgHiddenServices,
  orgLockedDepartmentId,
}: {
  office: Office;
  departments: Department[];
  orgHiddenDepartments: string[];
  orgHiddenServices: string[];
  orgLockedDepartmentId: string | null;
}) {
  const { t } = useI18n();
  const initialSettings = (office.settings as Record<string, any> | null) ?? {};
  const [override, setOverride] = useState<boolean>(Boolean(initialSettings.kiosk_override_visibility));
  const [hiddenDepartments, setHiddenDepartments] = useState<string[]>(
    initialSettings.kiosk_hidden_departments ?? orgHiddenDepartments
  );
  const [hiddenServices, setHiddenServices] = useState<string[]>(
    initialSettings.kiosk_hidden_services ?? orgHiddenServices
  );
  const [lockedDepartmentId, setLockedDepartmentId] = useState<string>(
    initialSettings.kiosk_locked_department_id ?? orgLockedDepartmentId ?? ''
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save(nextOverride: boolean) {
    setSaving(true);
    setMessage(null);
    const result = await updateOfficeKioskOverrides(office.id, {
      override: nextOverride,
      hidden_departments: hiddenDepartments.filter((id) => id !== lockedDepartmentId),
      hidden_services: hiddenServices,
      locked_department_id: lockedDepartmentId || null,
    });
    setSaving(false);
    if (result?.error) {
      setMessage(result.error);
    } else {
      setMessage(t('Saved.'));
      setTimeout(() => setMessage(null), 2500);
    }
  }

  function toggleDepartment(id: string) {
    setHiddenDepartments((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    );
  }
  function toggleService(id: string) {
    setHiddenServices((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    );
  }

  return (
    <div className="px-6 py-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{office.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {override
              ? t('This branch uses its own visibility settings below.')
              : t('Using org-wide visibility.')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {message ? <span className="text-xs text-muted-foreground">{message}</span> : null}
          <Switch
            checked={override}
            onChange={(next) => {
              setOverride(next);
              void save(next);
            }}
            disabled={saving}
            label={t('Override for {office}', { office: office.name })}
          />
        </div>
      </div>
      {override ? (
        <div className="space-y-3 rounded-lg border border-border bg-background p-4">
          <FieldBlock label={t('Starting department')} hint={t('Skip the department picker at this branch.')}>
            <select
              value={lockedDepartmentId}
              onChange={(event) => setLockedDepartmentId(event.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="">{t('Let customers choose')}</option>
              {departments.map((dept) => (
                <option key={dept.id} value={dept.id}>
                  {dept.name} ({dept.code})
                </option>
              ))}
            </select>
          </FieldBlock>
          <div className="divide-y divide-border rounded-lg border border-border">
            {departments.map((dept) => {
              const deptVisible = !hiddenDepartments.includes(dept.id);
              return (
                <div key={dept.id}>
                  <div className="flex items-center justify-between gap-4 px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground">{dept.name}</p>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {dept.code}
                      </span>
                    </div>
                    <Switch
                      checked={deptVisible}
                      onChange={() => toggleDepartment(dept.id)}
                      label={t('{name} visibility', { name: dept.name })}
                    />
                  </div>
                  {deptVisible && dept.services.length > 0 ? (
                    <div className="border-t border-border/50 bg-muted/20">
                      {dept.services.filter((s) => s.is_active).map((svc) => {
                        const svcVisible = !hiddenServices.includes(svc.id);
                        return (
                          <div key={svc.id} className="flex items-center justify-between gap-4 px-4 py-2 pl-8">
                            <div className="flex items-center gap-2">
                              <p className="text-sm text-foreground">{svc.name}</p>
                              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                {svc.code}
                              </span>
                            </div>
                            <Switch
                              checked={svcVisible}
                              onChange={() => toggleService(svc.id)}
                              label={t('{name} visibility', { name: svc.name })}
                            />
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => save(true)}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? t('Saving...') : t('Save overrides')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
