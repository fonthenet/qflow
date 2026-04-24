import { useEffect, useMemo, useState } from 'react';
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
  getCountry,
  resolveLocalized,
  type BusinessCategory,
  type CategoryLocale,
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

function CardShell({ title, subtitle, maxWidth, children }: { title: string; subtitle?: string; maxWidth?: number; children: React.ReactNode }) {
  return (
    <div className="login-container">
      <div className="login-card" style={{ maxWidth: maxWidth ?? 520 }}>
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
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [officeName, setOfficeName] = useState('');
  const [address, setAddress] = useState('');

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

  // Prefill office name from category default once a category is chosen.
  useEffect(() => {
    if (selectedCategory && !officeName) {
      setOfficeName(resolveLocalized(selectedCategory.defaultOfficeName, wizardLocale));
    }
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

          <div className="form-field">
            <label>Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as BusinessCategory)}
              style={{ colorScheme: 'light dark' }}
            >
              <option value="">—</option>
              {BUSINESS_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.emoji} {resolveLocalized(c.label, wizardLocale)}
                </option>
              ))}
            </select>
          </div>

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
      >
        <div className="login-form">
          {error && <div className="login-error">{error}</div>}

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

          <div className="form-field">
            <label>Address (optional)</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="12 rue Didouche, Alger"
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

          <div style={{ fontSize: 11, color: 'var(--text3, #64748b)', marginTop: -4 }}>
            Timezone: <code style={{ fontFamily: 'monospace' }}>{timezone}</code>
          </div>

          {loading && progress && (
            <div style={{ fontSize: 12, color: 'var(--text2, #94a3b8)', padding: '6px 0' }}>⏳ {progress}</div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
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
