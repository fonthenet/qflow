'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BUSINESS_CATEGORIES,
  COUNTRIES,
  DEFAULT_SETUP_WIZARD_SPEC,
  DEFAULT_TIMEZONE,
  detectDefaultCountry,
  getCountry,
  resolveLocalized,
  type BusinessCategory,
  type CategoryLocale,
} from '@qflo/shared';

// ── Portal setup wizard (post-register) ───────────────────────────
// Renders from the shared spec in @qflo/shared/setup-wizard so the
// Station signup flow asks the same questions. Posts to
// `/api/setup-wizard/seed` which seeds the first office/department/
// service/desk/virtual-queue-code and marks the wizard complete.

const LOCALE: CategoryLocale = 'fr';

interface Props {
  organizationName: string;
  initialCategory: BusinessCategory | null;
}

export function SetupWizardClient({ organizationName, initialCategory }: Props) {
  const router = useRouter();
  const spec = DEFAULT_SETUP_WIZARD_SPEC;

  const [stepIdx, setStepIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [businessName] = useState(organizationName); // locked in post-register
  const [category, setCategory] = useState<BusinessCategory | ''>(initialCategory ?? '');
  const [officeName, setOfficeName] = useState('');
  const [address, setAddress] = useState('');

  // Editable seed — prefilled from the category defaults, but the operator
  // owns every name/duration/row count before we commit to the database.
  const [deptName, setDeptName] = useState('');
  const [services, setServices] = useState<Array<{ name: string; minutes: number }>>([]);
  const [desks, setDesks] = useState<string[]>([]);

  // Country + city drive the timezone (no raw IANA string for the operator).
  const detected = useMemo(() => detectDefaultCountry(), []);
  const [countryCode, setCountryCode] = useState<string>(detected?.code ?? 'DZ');
  const [cityName, setCityName] = useState<string>('');

  const selectedCountry = useMemo(() => getCountry(countryCode), [countryCode]);
  const selectedCity = useMemo(
    () => selectedCountry?.cities.find((c) => resolveLocalized(c.name, LOCALE) === cityName) ?? null,
    [selectedCountry, cityName],
  );
  const timezone = selectedCity?.timezone ?? selectedCountry?.defaultTimezone ?? DEFAULT_TIMEZONE;

  const selectedCategory = useMemo(
    () => BUSINESS_CATEGORIES.find((c) => c.value === category) ?? null,
    [category],
  );

  // Prefill office name + editable seed from the category defaults.
  // Only fills empty fields so the operator's edits survive a category change.
  useEffect(() => {
    if (!selectedCategory) return;
    if (!officeName) {
      setOfficeName(resolveLocalized(selectedCategory.defaultOfficeName, LOCALE));
    }
    if (!deptName) {
      setDeptName(resolveLocalized(selectedCategory.defaultDepartment.name, LOCALE));
    }
    if (services.length === 0) {
      setServices([{
        name: resolveLocalized(selectedCategory.defaultService.name, LOCALE),
        minutes: selectedCategory.defaultService.estimatedMinutes,
      }]);
    }
    if (desks.length === 0) {
      setDesks([resolveLocalized(selectedCategory.defaultDesk.name, LOCALE)]);
    }
  }, [selectedCategory]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset the city whenever the country changes.
  useEffect(() => { setCityName(''); }, [countryCode]);

  const step = spec.steps[stepIdx];
  const total = spec.steps.length;

  function validateCurrent(): string | null {
    if (step.id === 'business') {
      if (!category) return 'Please pick a category.';
    }
    if (step.id === 'location') {
      if (officeName.trim().length < 2) return 'Office name is required.';
      if (!countryCode) return 'Please pick a country.';
      if (deptName.trim().length < 2) return 'Department name is required.';
      if (services.length === 0) return 'Add at least one service.';
      if (services.some((s) => s.name.trim().length < 2)) return 'All services need a name.';
      if (services.some((s) => !Number.isFinite(s.minutes) || s.minutes < 1)) return 'Service durations must be at least 1 minute.';
      if (desks.length === 0) return 'Add at least one counter.';
      if (desks.some((d) => d.trim().length < 2)) return 'All counters need a name.';
    }
    return null;
  }

  async function submit() {
    if (!category) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/setup-wizard/seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          officeName: officeName.trim(),
          address: address.trim() || undefined,
          country: countryCode,
          city: cityName || undefined,
          timezone,
          locale: LOCALE,
          departmentName: deptName.trim(),
          services: services.map((s) => ({ name: s.name.trim(), estimatedMinutes: s.minutes })),
          desks: desks.map((d) => d.trim()),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? 'Setup failed');
      setStepIdx(total - 1);
    } catch (err: any) {
      setError(err?.message ?? 'Setup failed');
    } finally {
      setBusy(false);
    }
  }

  function next() {
    const v = validateCurrent();
    if (v) { setError(v); return; }
    setError(null);
    if (step.id === 'location') { void submit(); return; }
    setStepIdx((i) => Math.min(i + 1, total - 1));
  }
  function back() { setError(null); setStepIdx((i) => Math.max(i - 1, 0)); }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
      <div style={{ marginBottom: 16, color: 'var(--text-muted)', fontSize: 13 }}>
        Step {stepIdx + 1} of {total}
      </div>

      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: 24,
          color: 'var(--text)',
        }}
      >
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>
          {resolveLocalized(step.title, LOCALE)}
        </h1>
        <p style={{ margin: '8px 0 20px', color: 'var(--text-muted)' }}>
          {resolveLocalized(step.subtitle, LOCALE)}
        </p>

        {step.id === 'business' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Field label="Business name">
              <input type="text" value={businessName} readOnly style={inputStyle} />
            </Field>
            <Field label="Category">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as BusinessCategory)}
                style={{ ...inputStyle, colorScheme: 'light dark' }}
              >
                <option value="">—</option>
                {BUSINESS_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.emoji} {resolveLocalized(c.label, LOCALE)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}

        {step.id === 'location' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Field label="Office name">
              <input
                type="text"
                value={officeName}
                onChange={(e) => setOfficeName(e.target.value)}
                placeholder="Agence Principale"
                style={inputStyle}
              />
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Country">
                <select
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value)}
                  style={{ ...inputStyle, colorScheme: 'light dark' }}
                >
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.flag} {resolveLocalized(c.name, LOCALE)}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="City">
                <select
                  value={cityName}
                  onChange={(e) => setCityName(e.target.value)}
                  style={{ ...inputStyle, colorScheme: 'light dark' }}
                >
                  <option value="">—</option>
                  {(selectedCountry?.cities ?? []).map((c) => {
                    const name = resolveLocalized(c.name, LOCALE);
                    return <option key={name} value={name}>{name}</option>;
                  })}
                </select>
              </Field>
            </div>

            <Field label="Address (optional)">
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="12 rue Didouche"
                style={inputStyle}
              />
            </Field>

            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Timezone: <code style={{ fontFamily: 'monospace' }}>{timezone}</code>
            </div>

            {selectedCategory && (
              <div
                style={{
                  marginTop: 8,
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  background: 'var(--bg)',
                  padding: 16,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
                  <strong style={{ fontSize: 14, color: 'var(--text)' }}>
                    What we&apos;ll set up for {businessName}
                  </strong>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Edit anything — you can add more later
                  </span>
                </div>

                {/* Summary line — read-only */}
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.6 }}>
                  {selectedCategory.emoji} {resolveLocalized(selectedCategory.label, LOCALE)}
                  {selectedCountry ? ` · ${selectedCountry.flag} ${cityName || resolveLocalized(selectedCountry.name, LOCALE)}` : ''}
                  {' · '}Mon–Sat 9:00–18:00
                </div>

                {/* Department */}
                <Field label="Department">
                  <input
                    type="text"
                    value={deptName}
                    onChange={(e) => setDeptName(e.target.value)}
                    style={inputStyle}
                  />
                </Field>

                {/* Services */}
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 6 }}>
                    Services
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {services.map((s, i) => (
                      <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 110px auto', gap: 8 }}>
                        <input
                          type="text"
                          value={s.name}
                          onChange={(e) => setServices((arr) => arr.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))}
                          placeholder="Service name"
                          style={inputStyle}
                        />
                        <input
                          type="number"
                          min={1}
                          max={480}
                          value={s.minutes}
                          onChange={(e) => setServices((arr) => arr.map((x, idx) => idx === i ? { ...x, minutes: Math.max(1, Number(e.target.value) || 1) } : x))}
                          style={{ ...inputStyle, textAlign: 'center' }}
                          title="Estimated duration (minutes)"
                        />
                        <button
                          type="button"
                          onClick={() => setServices((arr) => arr.filter((_, idx) => idx !== i))}
                          disabled={services.length <= 1}
                          style={{ ...secondaryBtn, padding: '0 12px', opacity: services.length <= 1 ? 0.4 : 1 }}
                          title="Remove service"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setServices((arr) => [...arr, { name: '', minutes: 15 }])}
                    style={{ ...secondaryBtn, marginTop: 8, height: 32, fontSize: 13 }}
                  >
                    + Add service
                  </button>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                    Minutes on the right = estimated service time (drives wait-time forecasts).
                  </div>
                </div>

                {/* Desks / counters */}
                <div style={{ marginTop: 18 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 6 }}>
                    Counters / Desks
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {desks.map((d, i) => (
                      <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
                        <input
                          type="text"
                          value={d}
                          onChange={(e) => setDesks((arr) => arr.map((x, idx) => idx === i ? e.target.value : x))}
                          placeholder="Counter name"
                          style={inputStyle}
                        />
                        <button
                          type="button"
                          onClick={() => setDesks((arr) => arr.filter((_, idx) => idx !== i))}
                          disabled={desks.length <= 1}
                          style={{ ...secondaryBtn, padding: '0 12px', opacity: desks.length <= 1 ? 0.4 : 1 }}
                          title="Remove counter"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setDesks((arr) => [...arr, `Counter ${arr.length + 1}`])}
                    style={{ ...secondaryBtn, marginTop: 8, height: 32, fontSize: 13 }}
                  >
                    + Add counter
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {step.id === 'ready' && (
          <div style={{ color: 'var(--text)' }}>
            <ul style={{ marginTop: 0, paddingLeft: 18, lineHeight: 1.8 }}>
              <li>Office {officeName ? `"${officeName}"` : ''} created</li>
              <li>Starter department, service and counter ready</li>
              <li>WhatsApp + Messenger channels pre-enabled</li>
              <li>You can rename or add more from Business Structure</li>
            </ul>
          </div>
        )}

        {error && (
          <div
            role="alert"
            style={{
              marginTop: 16,
              padding: 10,
              borderRadius: 8,
              background: 'rgba(220, 38, 38, 0.08)',
              color: '#dc2626',
              fontSize: 14,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
          {stepIdx > 0 && step.id !== 'ready' ? (
            <button onClick={back} disabled={busy} style={secondaryBtn}>Back</button>
          ) : (
            <span />
          )}
          {step.id === 'ready' ? (
            <button onClick={() => router.push('/admin/overview')} style={primaryBtn}>
              {resolveLocalized(step.cta, LOCALE)}
            </button>
          ) : (
            <button onClick={next} disabled={busy} style={primaryBtn}>
              {busy ? '…' : resolveLocalized(step.cta, LOCALE)}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  height: 40,
  padding: '0 12px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 14,
  colorScheme: 'light dark',
};

const primaryBtn: React.CSSProperties = {
  height: 40,
  padding: '0 18px',
  borderRadius: 8,
  border: 'none',
  background: 'var(--accent, #2563eb)',
  color: '#fff',
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
};

const secondaryBtn: React.CSSProperties = {
  height: 40,
  padding: '0 18px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
  fontSize: 14,
  cursor: 'pointer',
};
