import { useEffect, useMemo, useRef, useState } from 'react';
import { restoreSession } from '../lib/supabase';
import type { StaffSession } from '../lib/types';
import { type DesktopLocale } from '../lib/i18n';
import { QLogo } from '../components/QLogo';
import {
  BUSINESS_CATEGORIES,
  COUNTRIES,
  DEFAULT_SETUP_WIZARD_SPEC,
  DEFAULT_TIMEZONE,
  detectDefaultCountry,
  getActiveCategoryParents,
  getBusinessCategory,
  getCategoriesForParent,
  getCountry,
  resolveLocalized,
  type BusinessCategory,
  type CategoryLocale,
  type CategoryParent,
} from '@qflo/shared';

// ── Station Signup (new-signup) ───────────────────────────────────
// Renders from the shared wizard spec (@qflo/shared/setup-wizard) so
// the Portal's /admin/setup-wizard asks the same questions. Posts to
// `/api/onboarding/create-business` on the web app, which creates the
// auth user + org + first office/department/service/desk + channel
// defaults atomically.

interface Props {
  onSignedUp: (session: StaffSession) => void;
  onCancel: () => void;
  locale: DesktopLocale;
}

function CardShell({ title, subtitle, wide, children }: { title: string; subtitle?: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className="login-container">
      <div className={wide ? 'login-card login-card-wide' : 'login-card'}>
        <div className="login-header">
          <QLogo size={72} style={{ margin: '0 auto 16px' }} />
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      style={{
        width: 14, height: 14, border: '2px solid rgba(255,255,255,0.35)',
        borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite',
        display: 'inline-block', marginRight: 8,
      }}
    />
  );
}

export function Signup({ onSignedUp, onCancel, locale }: Props) {
  const wizardLocale: CategoryLocale = locale === 'ar' ? 'ar' : locale === 'en' ? 'en' : 'fr';
  const spec = DEFAULT_SETUP_WIZARD_SPEC;

  const [stepIdx, setStepIdx] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [cloudUrl, setCloudUrl] = useState('');

  const [businessName, setBusinessName] = useState('');
  const [category, setCategory] = useState<BusinessCategory | ''>('');
  // Two-step picker state. When a parent has a single child we
  // auto-select it; when it has multiple children we show a sub-
  // picker. Operator can tap "Change" on the chosen pill to reset
  // back to the parent grid.
  const [parentSlug, setParentSlug] = useState<CategoryParent | null>(null);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [officeName, setOfficeName] = useState('');
  const [address, setAddress] = useState('');

  // Editable seed — prefilled from the category defaults so the operator
  // sees (and can override) exactly what we'll create on first run.
  const [deptName, setDeptName] = useState('');
  const [services, setServices] = useState<Array<{ name: string; minutes: number }>>([]);
  const [desks, setDesks] = useState<string[]>([]);

  // Country + city drive the timezone — operators never see a raw IANA string.
  const detected = useMemo(() => detectDefaultCountry(), []);
  const [countryCode, setCountryCode] = useState<string>(detected?.code ?? 'DZ');
  const [cityName, setCityName] = useState<string>('');
  const selectedCountry = useMemo(() => getCountry(countryCode), [countryCode]);

  useEffect(() => {
    (window as any).qf?.getConfig?.().then((cfg: any) => {
      if (cfg?.cloudUrl) setCloudUrl(cfg.cloudUrl);
    }).catch(() => {});
  }, []);

  const selectedCategory = useMemo(
    () => BUSINESS_CATEGORIES.find((c) => c.value === category) ?? null,
    [category],
  );

  const selectedCity = useMemo(
    () => selectedCountry?.cities.find((c) => resolveLocalized(c.name, wizardLocale) === cityName) ?? null,
    [selectedCountry, cityName, wizardLocale],
  );
  const timezone = selectedCity?.timezone ?? selectedCountry?.defaultTimezone ?? DEFAULT_TIMEZONE;

  // Prefill office name + editable seed from the category defaults.
  // Replaces the earlier "only fill if empty" logic that left clinic
  // defaults visible after the operator switched to a different
  // category (the user-reported "Restaurants → Main Clinic" bug).
  //
  // Strategy:
  //   - On the FIRST category pick, fill all four fields from defaults.
  //   - On every subsequent category change, overwrite ONLY the fields
  //     that still match the previous category's defaults (i.e. the
  //     operator hasn't manually edited them). Operator-edited values
  //     are preserved — switching category by mistake doesn't wipe a
  //     custom service name they typed.
  const lastPrefillRef = useRef<{
    category: BusinessCategory | null;
    office: string;
    dept: string;
    service: { name: string; minutes: number } | null;
    desk: string;
  }>({ category: null, office: '', dept: '', service: null, desk: '' });

  useEffect(() => {
    if (!selectedCategory) return;
    const prev = lastPrefillRef.current;
    if (prev.category === selectedCategory.value) return; // same category — nothing to do

    const nextOffice = resolveLocalized(selectedCategory.defaultOfficeName, wizardLocale);
    const nextDept = resolveLocalized(selectedCategory.defaultDepartment.name, wizardLocale);
    const nextServiceName = resolveLocalized(selectedCategory.defaultService.name, wizardLocale);
    const nextServiceMinutes = selectedCategory.defaultService.estimatedMinutes;
    const nextDesk = resolveLocalized(selectedCategory.defaultDesk.name, wizardLocale);

    // Office — overwrite if empty OR still equal to the previous prefill.
    if (!officeName || officeName === prev.office) setOfficeName(nextOffice);
    if (!deptName || deptName === prev.dept) setDeptName(nextDept);

    if (services.length === 0
      || (services.length === 1 && prev.service
          && services[0].name === prev.service.name
          && services[0].minutes === prev.service.minutes)) {
      setServices([{ name: nextServiceName, minutes: nextServiceMinutes }]);
    }

    if (desks.length === 0
      || (desks.length === 1 && desks[0] === prev.desk)) {
      setDesks([nextDesk]);
    }

    lastPrefillRef.current = {
      category: selectedCategory.value,
      office: nextOffice,
      dept: nextDept,
      service: { name: nextServiceName, minutes: nextServiceMinutes },
      desk: nextDesk,
    };
  }, [selectedCategory]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset the city whenever the country changes.
  useEffect(() => { setCityName(''); }, [countryCode]);

  const step = spec.steps[stepIdx];
  const total = spec.steps.length;

  function validateCurrent(): string {
    if (step.id === 'business') {
      if (businessName.trim().length < 2) return 'Business name is required.';
      if (!category) return 'Please pick a category.';
      if (fullName.trim().length < 2) return 'Full name is required.';
      if (!email.trim()) return 'Email is required.';
      if (password.length < 6) return 'Password must be at least 6 characters.';
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
    return '';
  }

  async function submit() {
    if (!cloudUrl) {
      setError('Cloud URL not configured.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      setProgress('Creating your business…');
      const res = await fetch(`${cloudUrl}/api/onboarding/create-business`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password,
          fullName: fullName.trim(),
          businessName: businessName.trim(),
          category,
          officeName: officeName.trim(),
          address: address.trim() || undefined,
          country: countryCode,
          city: cityName || undefined,
          timezone,
          locale: wizardLocale,
          departmentName: deptName.trim(),
          services: services.map((s) => ({ name: s.name.trim(), estimatedMinutes: s.minutes })),
          desks: desks.map((d) => d.trim()),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? 'Sign-up failed');

      if (body.session?.access_token && body.session?.refresh_token) {
        try { await restoreSession(body.session.access_token, body.session.refresh_token); } catch {}
      }

      const session: StaffSession = {
        user_id: body.user_id ?? '',
        staff_id: body.staff_id ?? '',
        email,
        full_name: fullName,
        role: body.role ?? 'admin',
        office_id: body.office_id ?? '',
        office_name: body.office_name ?? '',
        organization_id: body.organization_id ?? '',
        department_id: body.department_id ?? undefined,
        desk_id: body.desk_id ?? undefined,
        desk_name: body.desk_name ?? undefined,
        office_ids: body.office_id ? [body.office_id] : [],
        access_token: body.session?.access_token ?? undefined,
        refresh_token: body.session?.refresh_token ?? undefined,
      };

      try { localStorage.setItem('qflo_saved_email', email); } catch {}

      // Portal marks wizard completed server-side, so no extra step here.
      setStepIdx(total - 1);
      // Hand off the session to the shell (it will close this screen).
      onSignedUp(session);
    } catch (err: any) {
      setError(err?.message ?? 'Sign-up failed');
    } finally {
      setLoading(false);
      setProgress('');
    }
  }

  function next() {
    const v = validateCurrent();
    if (v) { setError(v); return; }
    setError('');
    if (step.id === 'location') { void submit(); return; }
    setStepIdx((i) => Math.min(i + 1, total - 1));
  }
  function back() {
    setError('');
    setStepIdx((i) => Math.max(i - 1, 0));
  }

  // ── Render ────────────────────────────────────────────────────────
  if (step.id === 'business') {
    return (
      <CardShell
        title={resolveLocalized(step.title, wizardLocale)}
        subtitle={resolveLocalized(step.subtitle, wizardLocale)}
      >
        <div className="login-form">
          {error && <div className="login-error">{error}</div>}

          <div className="form-field">
            <label>Business name</label>
            <input
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="Clinique Saphir, Banque du Centre…"
              autoFocus
            />
          </div>

          <CategoryPicker
            wizardLocale={wizardLocale}
            category={category}
            parentSlug={parentSlug}
            onPick={(p, c) => { setParentSlug(p); setCategory(c); }}
            onClear={() => { setParentSlug(null); setCategory(''); }}
          />

          <div className="form-field">
            <label>Your full name</label>
            <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Ahmed Benali" />
          </div>

          <div className="form-field">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@business.com" />
          </div>

          <div className="form-field">
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Minimum 6 characters" />
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button type="button" onClick={onCancel} style={secondaryBtn}>← Back to sign in</button>
            <button type="button" onClick={next} style={primaryBtn}>
              {resolveLocalized(step.cta, wizardLocale)} →
            </button>
          </div>
        </div>
      </CardShell>
    );
  }

  if (step.id === 'location') {
    return (
      <CardShell
        title={resolveLocalized(step.title, wizardLocale)}
        subtitle={resolveLocalized(step.subtitle, wizardLocale)}
        wide
      >
        <div className="login-form">
          {error && <div className="login-error">{error}</div>}

          <div className="wizard-grid">
            {/* ── Left column: location ─────────────────────────── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <h2 className="wizard-section-title">Location</h2>

              <div className="form-field">
                <label>Office name</label>
                <input
                  type="text"
                  value={officeName}
                  onChange={(e) => setOfficeName(e.target.value)}
                  placeholder="Agence Principale"
                  autoFocus
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="form-field">
                  <label>Country</label>
                  <select
                    value={countryCode}
                    onChange={(e) => setCountryCode(e.target.value)}
                    style={{ colorScheme: 'light dark' }}
                  >
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.flag} {resolveLocalized(c.name, wizardLocale)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-field">
                  <label>City</label>
                  <select
                    value={cityName}
                    onChange={(e) => setCityName(e.target.value)}
                    style={{ colorScheme: 'light dark' }}
                  >
                    <option value="">—</option>
                    {(selectedCountry?.cities ?? []).map((c) => {
                      const name = resolveLocalized(c.name, wizardLocale);
                      return <option key={name} value={name}>{name}</option>;
                    })}
                  </select>
                </div>
              </div>

              <div className="form-field">
                <label>Address (optional)</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="12 rue Didouche, Alger"
                />
              </div>

              <div style={{ fontSize: 11, color: 'var(--text3, #64748b)', marginTop: -4 }}>
                Timezone: <code style={{ fontFamily: 'monospace' }}>{timezone}</code>
              </div>
            </div>

            {/* ── Right column: live preview ────────────────────── */}
            {selectedCategory && (
              <div
                className="wizard-preview"
                style={{
                  padding: 18,
                  border: '1px solid var(--border, #475569)',
                  borderRadius: 12,
                  background: 'var(--surface2, rgba(255,255,255,0.04))',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                }}
              >
                <div>
                  <h2 className="wizard-section-title" style={{ margin: 0 }}>
                    What we&apos;ll set up
                  </h2>
                  <div style={{ fontSize: 12, color: 'var(--text2, #94a3b8)', marginTop: 6, lineHeight: 1.5 }}>
                    <span style={{ marginRight: 6 }}>{selectedCategory.emoji}</span>
                    {resolveLocalized(selectedCategory.label, wizardLocale)}
                    {' · '}Mon–Sat 9:00–18:00
                    <br />
                    <span style={{ color: 'var(--text3, #64748b)' }}>Edit any field before finishing.</span>
                  </div>
                </div>

                {/* Department */}
                <div className="form-field">
                  <label>Department</label>
                  <input type="text" value={deptName} onChange={(e) => setDeptName(e.target.value)} />
                </div>

                {/* Services */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text, #f1f5f9)' }}>Services</div>
                    <div style={{ fontSize: 10, color: 'var(--text3, #64748b)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Name · Minutes
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {services.map((s, i) => (
                      <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 72px 30px', gap: 6 }}>
                        <input
                          type="text"
                          value={s.name}
                          onChange={(e) => setServices((arr) => arr.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))}
                          placeholder="Service"
                        />
                        <input
                          type="number"
                          min={1}
                          max={480}
                          value={s.minutes}
                          onChange={(e) => setServices((arr) => arr.map((x, idx) => idx === i ? { ...x, minutes: Math.max(1, Number(e.target.value) || 1) } : x))}
                          title="Estimated minutes"
                          style={{ textAlign: 'center' }}
                        />
                        <button
                          type="button"
                          onClick={() => setServices((arr) => arr.filter((_, idx) => idx !== i))}
                          disabled={services.length <= 1}
                          style={{ ...iconBtn, opacity: services.length <= 1 ? 0.3 : 1 }}
                          title="Remove"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setServices((arr) => [...arr, { name: '', minutes: 15 }])}
                    style={ghostBtn}
                  >
                    + Add service
                  </button>
                </div>

                {/* Desks */}
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text, #f1f5f9)', marginBottom: 6 }}>
                    Counters / Desks
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {desks.map((d, i) => (
                      <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 30px', gap: 6 }}>
                        <input
                          type="text"
                          value={d}
                          onChange={(e) => setDesks((arr) => arr.map((x, idx) => idx === i ? e.target.value : x))}
                          placeholder="Counter name"
                        />
                        <button
                          type="button"
                          onClick={() => setDesks((arr) => arr.filter((_, idx) => idx !== i))}
                          disabled={desks.length <= 1}
                          style={{ ...iconBtn, opacity: desks.length <= 1 ? 0.3 : 1 }}
                          title="Remove"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setDesks((arr) => [...arr, `Counter ${arr.length + 1}`])}
                    style={ghostBtn}
                  >
                    + Add counter
                  </button>
                </div>
              </div>
            )}
          </div>

          {loading && progress && (
            <div style={{ fontSize: 12, color: 'var(--text2, #94a3b8)', padding: '6px 0' }}>⏳ {progress}</div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" onClick={back} disabled={loading} style={secondaryBtn}>← Back</button>
            <button
              type="button"
              onClick={next}
              disabled={loading}
              className="btn-primary"
              style={{ flex: 2, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            >
              {loading && <Spinner />}
              {loading ? 'Creating…' : resolveLocalized(step.cta, wizardLocale)}
            </button>
          </div>
        </div>
      </CardShell>
    );
  }

  // step.id === 'ready'
  return (
    <CardShell
      title={resolveLocalized(step.title, wizardLocale)}
      subtitle={resolveLocalized(step.subtitle, wizardLocale)}
    >
      <div style={{ color: 'var(--text, #f1f5f9)', lineHeight: 1.7, fontSize: 14 }}>
        <ul style={{ paddingLeft: 18, margin: 0 }}>
          <li>Office {officeName ? `"${officeName}"` : ''} created</li>
          <li>Starter department, service and counter ready</li>
          <li>WhatsApp + Messenger channels pre-enabled</li>
        </ul>
      </div>
    </CardShell>
  );
}

const primaryBtn: React.CSSProperties = {
  flex: 1,
  padding: '10px',
  borderRadius: 8,
  background: 'var(--primary, #3b82f6)',
  color: '#fff',
  border: 'none',
  cursor: 'pointer',
  fontWeight: 700,
};

const secondaryBtn: React.CSSProperties = {
  flex: 1,
  padding: '10px',
  borderRadius: 8,
  border: '1px solid var(--border, #475569)',
  background: 'transparent',
  color: 'var(--text, #f1f5f9)',
  cursor: 'pointer',
};

// Inline ± row controls for the preview panel — smaller than the main
// action buttons so the grid doesn't visually compete with the CTA.
const ghostBtn: React.CSSProperties = {
  marginTop: 8,
  padding: '6px 12px',
  borderRadius: 8,
  border: '1px dashed var(--border, #475569)',
  background: 'transparent',
  color: 'var(--text2, #94a3b8)',
  fontSize: 12,
  cursor: 'pointer',
  alignSelf: 'flex-start',
};

const iconBtn: React.CSSProperties = {
  padding: 0,
  width: 30,
  height: 30,
  borderRadius: 6,
  border: '1px solid var(--border, #475569)',
  background: 'transparent',
  color: 'var(--text2, #94a3b8)',
  cursor: 'pointer',
  fontSize: 12,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

// ── CategoryPicker ──────────────────────────────────────────────
// Two-step picker for the signup screen. Operator first picks a
// parent group (Food, Beauty, Healthcare …); if that parent has
// multiple children we show the child sub-picker. Single-child
// parents auto-select on click.
//
// State lives in the parent <Signup> so coming back via "Change"
// resets cleanly. The component is render-only — no side effects
// beyond the onPick / onClear callbacks.
function CategoryPicker({
  wizardLocale,
  category,
  parentSlug,
  onPick,
  onClear,
}: {
  wizardLocale: CategoryLocale;
  category: BusinessCategory | '';
  parentSlug: CategoryParent | null;
  onPick: (parent: CategoryParent, category: BusinessCategory) => void;
  onClear: () => void;
}) {
  const parents = useMemo(() => getActiveCategoryParents(), []);
  const selectedCategory = category ? getBusinessCategory(category) : undefined;
  const childrenOfParent = parentSlug ? getCategoriesForParent(parentSlug) : [];

  // Phase A — category already chosen → show a confirmation pill
  // with a "Change" button. Keeps the form short once the operator
  // has picked.
  if (selectedCategory) {
    return (
      <div className="form-field">
        <label>Category</label>
        <div style={pickerChosen}>
          <span style={{ fontSize: 22 }}>{selectedCategory.emoji}</span>
          <span style={{ flex: 1, fontWeight: 600 }}>
            {resolveLocalized(selectedCategory.label, wizardLocale)}
          </span>
          <button type="button" onClick={onClear} style={pickerChangeBtn}>
            Change
          </button>
        </div>
      </div>
    );
  }

  // Phase B — parent picked, multiple children → child grid.
  if (parentSlug && childrenOfParent.length > 0) {
    return (
      <div className="form-field">
        <label>Category</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <button type="button" onClick={onClear} style={pickerBackBtn}>
            ← All categories
          </button>
        </div>
        <div style={pickerGrid}>
          {childrenOfParent.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => onPick(parentSlug, c.value)}
              style={pickerCard}
            >
              <span style={{ fontSize: 26 }}>{c.emoji}</span>
              <span style={pickerCardLabel}>
                {resolveLocalized(c.label, wizardLocale)}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Phase C — initial parent grid.
  return (
    <div className="form-field">
      <label>Category</label>
      <div style={pickerGrid}>
        {parents.map((p) => {
          const children = getCategoriesForParent(p.slug);
          const onClick = () => {
            // Single-child parents (Healthcare, Banking, Education,
            // Government) auto-select the only child instead of
            // forcing an unnecessary second tap.
            if (children.length === 1) {
              onPick(p.slug, children[0].value);
            } else {
              // Open the sub-picker — onPick is what actually persists,
              // so for the parent step we just nudge state via onClear-
              // adjacent logic. Use a tiny dispatcher: call onPick with
              // the FIRST child only when there's a single one (above);
              // otherwise call the consumer with no category to mean
              // "open sub-picker". The consumer (parent <Signup>) sets
              // parentSlug from a separate setter — but to keep this
              // component self-contained, we just forward via a fake
              // pick on the first child and let consumer ignore. To
              // avoid that hack, the parent passes a setParentSlug-only
              // callback; here we expose it via the same onPick by
              // calling with empty string — see consumer.
              // Simpler: use a separate prop. (We do — see below.)
              setParentOnly(p.slug);
            }
          };
          return (
            <button
              key={p.slug}
              type="button"
              onClick={onClick}
              style={pickerCard}
            >
              <span style={{ fontSize: 28 }}>{p.emoji}</span>
              <span style={pickerCardLabel}>
                {resolveLocalized(p.label, wizardLocale)}
              </span>
              <span style={pickerCardHint}>
                {resolveLocalized(p.hint, wizardLocale)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );

  // Closure-scoped helper — keeps the parent-only navigation inside
  // the component without polluting Signup's surface.
  function setParentOnly(slug: CategoryParent) {
    // Simulate "open sub-picker" by calling onPick with an empty
    // category and the parent slug — the consumer (Signup) reads
    // parentSlug from this and shows the sub-picker on next render.
    onPick(slug, '' as BusinessCategory);
  }
}

const pickerGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
  gap: 8,
};

const pickerCard: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 6,
  padding: '14px 12px',
  borderRadius: 10,
  border: '1px solid var(--border, #334155)',
  background: 'var(--surface, #1e293b)',
  color: 'var(--text, #e2e8f0)',
  cursor: 'pointer',
  textAlign: 'left',
  minHeight: 92,
};

const pickerCardLabel: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  lineHeight: 1.2,
};

const pickerCardHint: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text2, #94a3b8)',
  lineHeight: 1.3,
};

const pickerChosen: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '12px 14px',
  borderRadius: 10,
  border: '1.5px solid var(--primary, #3b82f6)',
  background: 'var(--surface, #1e293b)',
  color: 'var(--text, #e2e8f0)',
};

const pickerChangeBtn: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 6,
  border: '1px solid var(--border, #475569)',
  background: 'transparent',
  color: 'var(--primary, #3b82f6)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

const pickerBackBtn: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid transparent',
  background: 'transparent',
  color: 'var(--text2, #94a3b8)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

