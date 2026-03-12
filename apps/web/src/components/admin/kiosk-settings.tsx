'use client';

import { useState, useTransition } from 'react';
import { Save, CheckCircle2, ExternalLink, Eye, EyeOff } from 'lucide-react';
import { updateKioskSettings } from '@/lib/actions/admin-actions';

interface Office {
  id: string;
  name: string;
  is_active: boolean;
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
    settings?: Record<string, any> | null;
  };
  offices: Office[];
  departments: Department[];
}

export function KioskSettings({ organization, offices, departments }: KioskSettingsProps) {
  const [isPending, startTransition] = useTransition();
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const settings = organization.settings ?? {};

  // Appearance
  const [welcomeMessage, setWelcomeMessage] = useState<string>(
    settings.kiosk_welcome_message ?? 'Welcome'
  );
  const [headerText, setHeaderText] = useState<string>(
    settings.kiosk_header_text ?? ''
  );
  const [themeColor, setThemeColor] = useState<string>(
    settings.kiosk_theme_color ?? '#2563eb'
  );

  // Content
  const [showPriorities, setShowPriorities] = useState<boolean>(
    settings.kiosk_show_priorities ?? true
  );
  const [showEstimatedTime, setShowEstimatedTime] = useState<boolean>(
    settings.kiosk_show_estimated_time ?? true
  );
  const [hiddenDepartments, setHiddenDepartments] = useState<string[]>(
    settings.kiosk_hidden_departments ?? []
  );
  const [hiddenServices, setHiddenServices] = useState<string[]>(
    settings.kiosk_hidden_services ?? []
  );

  // Behavior
  const [lockedDepartmentId, setLockedDepartmentId] = useState<string>(
    settings.kiosk_locked_department_id ?? ''
  );
  const [buttonLabel, setButtonLabel] = useState<string>(
    settings.kiosk_button_label ?? 'Get Ticket'
  );
  const [idleTimeout, setIdleTimeout] = useState<number>(
    settings.kiosk_idle_timeout ?? 60
  );

  function toggleHiddenDept(deptId: string) {
    setHiddenDepartments((prev) =>
      prev.includes(deptId) ? prev.filter((d) => d !== deptId) : [...prev, deptId]
    );
  }

  function toggleHiddenService(serviceId: string) {
    setHiddenServices((prev) =>
      prev.includes(serviceId) ? prev.filter((s) => s !== serviceId) : [...prev, serviceId]
    );
  }

  function getOfficeSlug(name: string) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function handleSave() {
    setSuccessMessage(null);
    setErrorMessage(null);

    startTransition(async () => {
      const result = await updateKioskSettings({
        kiosk_welcome_message: welcomeMessage,
        kiosk_header_text: headerText,
        kiosk_theme_color: themeColor,
        kiosk_show_priorities: showPriorities,
        kiosk_show_estimated_time: showEstimatedTime,
        kiosk_hidden_departments: hiddenDepartments,
        kiosk_hidden_services: hiddenServices,
        kiosk_locked_department_id: lockedDepartmentId || null,
        kiosk_button_label: buttonLabel,
        kiosk_idle_timeout: idleTimeout,
      });

      if (result?.error) {
        setErrorMessage(result.error);
      } else {
        setSuccessMessage('Kiosk settings saved successfully.');
        setTimeout(() => setSuccessMessage(null), 4000);
      }
    });
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Kiosk Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Customize the self-service kiosk experience for your customers.
          </p>
        </div>
      </div>

      {/* Preview links */}
      <section className="rounded-xl border border-border bg-card p-6 space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Preview Kiosk</h2>
        <p className="text-sm text-muted-foreground">
          Open the kiosk page for each office to see how it looks.
        </p>
        <div className="flex flex-wrap gap-3">
          {offices
            .filter((o) => o.is_active)
            .map((office) => (
              <a
                key={office.id}
                href={`/kiosk/${getOfficeSlug(office.name)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
              >
                <ExternalLink className="h-4 w-4" />
                {office.name}
              </a>
            ))}
        </div>
      </section>

      {/* Appearance */}
      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Appearance</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Welcome Message
            </label>
            <input
              type="text"
              value={welcomeMessage}
              onChange={(e) => setWelcomeMessage(e.target.value)}
              placeholder="Welcome"
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Shown on the department selection screen.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Header Text
            </label>
            <input
              type="text"
              value={headerText}
              onChange={(e) => setHeaderText(e.target.value)}
              placeholder="Organization name used by default"
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Theme Color
            </label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={themeColor}
                onChange={(e) => setThemeColor(e.target.value)}
                className="h-10 w-14 cursor-pointer rounded border border-border"
              />
              <input
                type="text"
                value={themeColor}
                onChange={(e) => setThemeColor(e.target.value)}
                className="w-32 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Content Visibility */}
      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Content</h2>

        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={showPriorities}
              onChange={(e) => setShowPriorities(e.target.checked)}
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary/50"
            />
            <div>
              <span className="text-sm font-medium text-foreground">Show Priority Selection</span>
              <p className="text-xs text-muted-foreground">Allow customers to choose priority level (VIP, elderly, etc.)</p>
            </div>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={showEstimatedTime}
              onChange={(e) => setShowEstimatedTime(e.target.checked)}
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary/50"
            />
            <div>
              <span className="text-sm font-medium text-foreground">Show Estimated Wait Time</span>
              <p className="text-xs text-muted-foreground">Display estimated service time on service buttons</p>
            </div>
          </label>
        </div>

        {/* Department visibility */}
        <div className="mt-4 border-t border-border pt-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Department & Service Visibility</h3>
          <p className="text-xs text-muted-foreground mb-3">
            Hide departments or services from the kiosk. Hidden items won&apos;t appear for customers.
          </p>
          <div className="space-y-3">
            {departments.map((dept) => (
              <div key={dept.id} className="rounded-lg border border-border p-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!hiddenDepartments.includes(dept.id)}
                    onChange={() => toggleHiddenDept(dept.id)}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary/50"
                  />
                  <div className="flex items-center gap-2 flex-1">
                    {hiddenDepartments.includes(dept.id) ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-primary" />
                    )}
                    <span className="text-sm font-medium text-foreground">{dept.name}</span>
                    <span className="text-xs text-muted-foreground">({dept.code})</span>
                  </div>
                </label>

                {/* Services under this department */}
                {!hiddenDepartments.includes(dept.id) && dept.services?.length > 0 && (
                  <div className="ml-8 mt-2 space-y-1.5">
                    {dept.services
                      .filter((s) => s.is_active)
                      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                      .map((service) => (
                        <label key={service.id} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!hiddenServices.includes(service.id)}
                            onChange={() => toggleHiddenService(service.id)}
                            className="h-3.5 w-3.5 rounded border-border text-primary focus:ring-primary/50"
                          />
                          <span className="text-xs text-foreground">{service.name}</span>
                          <span className="text-xs text-muted-foreground">({service.code})</span>
                        </label>
                      ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Behavior */}
      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Behavior</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Lock to Single Department
            </label>
            <select
              value={lockedDepartmentId}
              onChange={(e) => setLockedDepartmentId(e.target.value)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="">None (show all departments)</option>
              {departments
                .filter((d) => d.is_active)
                .map((dept) => (
                  <option key={dept.id} value={dept.id}>
                    {dept.name} ({dept.code})
                  </option>
                ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Skip department selection and go straight to services.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Button Label
            </label>
            <input
              type="text"
              value={buttonLabel}
              onChange={(e) => setButtonLabel(e.target.value)}
              placeholder="Get Ticket"
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Idle Timeout (seconds)
            </label>
            <input
              type="number"
              min={10}
              max={300}
              value={idleTimeout}
              onChange={(e) => setIdleTimeout(Number(e.target.value))}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Auto-reset to the welcome screen after this many seconds of inactivity.
            </p>
          </div>
        </div>
      </section>

      {/* Save Button */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          <Save className="h-4 w-4" />
          {isPending ? 'Saving...' : 'Save Kiosk Settings'}
        </button>

        {successMessage && (
          <span className="inline-flex items-center gap-1 text-sm text-green-600">
            <CheckCircle2 className="h-4 w-4" />
            {successMessage}
          </span>
        )}

        {errorMessage && (
          <span className="text-sm text-red-600">{errorMessage}</span>
        )}
      </div>
    </div>
  );
}
