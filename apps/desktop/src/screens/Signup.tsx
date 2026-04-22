import { useEffect, useMemo, useState } from 'react';
import { restoreSession } from '../lib/supabase';
import type { StaffSession } from '../lib/types';
import { t as translate, type DesktopLocale } from '../lib/i18n';
import { QLogo } from '../components/QLogo';
import {
  STARTER_TEMPLATES,
  getStarterTemplate,
  getStarterSubtype,
  getDefaultOptions,
} from '@qflo/shared';

interface Props {
  onSignedUp: (session: StaffSession) => void;
  onCancel: () => void;
  locale: DesktopLocale;
}

type Step = 'category' | 'subtype' | 'customize' | 'details' | 'review';

// ── Shared small components (module-scope so React doesn't remount
// them on every parent render — that was stealing input focus)
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

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function Signup({ onSignedUp, onCancel, locale }: Props) {
  const t = (key: string, values?: Record<string, string | number | null | undefined>) =>
    translate(locale, key, values);

  const [step, setStep] = useState<Step>('category');
  const [templateId, setTemplateId] = useState<string>(STARTER_TEMPLATES[0]?.id ?? 'restaurant');
  const [subtypeId, setSubtypeId] = useState<string>(STARTER_TEMPLATES[0]?.subtypes[0]?.id ?? '');
  const [options, setOptions] = useState<Record<string, number>>({});
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [cloudUrl, setCloudUrl] = useState('');

  useEffect(() => {
    (window as any).qf?.getConfig?.().then((cfg: any) => {
      if (cfg?.cloudUrl) setCloudUrl(cfg.cloudUrl);
    }).catch(() => {});
  }, []);

  const template = getStarterTemplate(templateId) ?? STARTER_TEMPLATES[0];
  const subtype = useMemo(
    () => getStarterSubtype(templateId, subtypeId) ?? template.subtypes[0],
    [templateId, subtypeId, template],
  );

  // Reset options whenever the subtype changes so defaults apply.
  useEffect(() => {
    setOptions(getDefaultOptions(subtype));
  }, [subtype]);

  const canSubmit =
    fullName.trim() && email.trim() && password.length >= 6 && businessName.trim() && cloudUrl;

  const pickCategory = (id: string) => {
    setTemplateId(id);
    const firstSub = getStarterTemplate(id)?.subtypes[0];
    if (firstSub) setSubtypeId(firstSub.id);
    setStep('subtype');
  };

  const pickSubtype = (id: string) => {
    setSubtypeId(id);
    const s = getStarterSubtype(templateId, id);
    if (s?.options?.length) setStep('customize');
    else setStep('details');
  };

  const handleSubmit = async () => {
    if (!canSubmit || loading) return;
    setError('');
    setLoading(true);
    try {
      setProgress(t('Creating your business...'));
      const res = await fetch(`${cloudUrl}/api/onboarding/create-business`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password,
          fullName: fullName.trim(),
          businessName: businessName.trim(),
          templateId,
          subtypeId,
          options,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? t('Sign-up failed'));

      if (body.session?.access_token && body.session?.refresh_token) {
        try { await restoreSession(body.session.access_token, body.session.refresh_token); } catch {}
      }

      setProgress(t('Finishing up...'));
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
      onSignedUp(session);
    } catch (err: any) {
      setError(err?.message ?? t('Sign-up failed'));
    } finally {
      setLoading(false);
      setProgress('');
    }
  };

  // ── Step: category ──────────────────────────────────────────────
  if (step === 'category') {
    return (
      <CardShell title={t('Pick your category')} subtitle={t('We will set up departments, services and desks to match — you can edit anything later.')}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {STARTER_TEMPLATES.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => pickCategory(tpl.id)}
              style={{
                textAlign: 'left', padding: 14, borderRadius: 10,
                border: '1px solid var(--border, #475569)',
                background: 'var(--surface, #1e293b)',
                color: 'var(--text, #f1f5f9)',
                cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4,
              }}
            >
              <span style={{ fontSize: 26 }}>{tpl.icon}</span>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{t(tpl.titleKey)}</span>
              <span style={{ fontSize: 11, color: 'var(--text3, #64748b)' }}>
                {tpl.subtypes.length} {tpl.subtypes.length === 1 ? t('option') : t('options')}
              </span>
            </button>
          ))}
        </div>
        <div style={{ textAlign: 'center', marginTop: 18 }}>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', color: 'var(--primary, #3b82f6)', cursor: 'pointer', fontSize: 13 }}>
            ← {t('Back to sign in')}
          </button>
        </div>
      </CardShell>
    );
  }

  // ── Step: subtype ───────────────────────────────────────────────
  if (step === 'subtype') {
    return (
      <CardShell title={`${template.icon} ${t(template.titleKey)}`} subtitle={t('Pick the shape that fits best.')} maxWidth={560}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {template.subtypes.map((s) => {
            const selected = subtypeId === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => { setSubtypeId(s.id); }}
                onDoubleClick={() => pickSubtype(s.id)}
                style={{
                  textAlign: 'left', padding: 14, borderRadius: 10,
                  border: selected ? '2px solid var(--primary, #3b82f6)' : '1px solid var(--border, #475569)',
                  background: selected ? 'var(--surface2, #334155)' : 'var(--surface, #1e293b)',
                  color: 'var(--text, #f1f5f9)',
                  cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'flex-start',
                }}
              >
                <span style={{ fontSize: 24 }}>{s.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{t(s.titleKey)}</div>
                  <div style={{ fontSize: 12, color: 'var(--text3, #64748b)', marginBottom: 4 }}>{t(s.descKey)}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3, #64748b)' }}>
                    {s.departments.length} {t('dept(s)')} · {s.departments.reduce((n, d) => n + d.services.length, 0)} {t('services')} · {s.desks.length}+ {t('desk(s)')}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button onClick={() => setStep('category')} style={secondaryBtn}>← {t('Back')}</button>
          <button onClick={() => pickSubtype(subtypeId)} style={primaryBtn}>{t('Continue')} →</button>
        </div>
      </CardShell>
    );
  }

  // ── Step: customize ─────────────────────────────────────────────
  if (step === 'customize') {
    return (
      <CardShell title={t('Customize')} subtitle={`${subtype.icon} ${t(subtype.titleKey)}`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {(subtype.options ?? []).map((opt) => (
            <div key={opt.key} className="form-field">
              <label>{t(opt.labelKey)}</label>
              <input
                type="number"
                min={opt.min ?? 0}
                max={opt.max ?? 100}
                value={options[opt.key] ?? opt.default}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  setOptions((p) => ({ ...p, [opt.key]: Number.isFinite(n) ? n : opt.default }));
                }}
              />
              {opt.helpKey && (
                <div style={{ fontSize: 11, color: 'var(--text3, #64748b)', marginTop: 4 }}>{t(opt.helpKey)}</div>
              )}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button onClick={() => setStep('subtype')} style={secondaryBtn}>← {t('Back')}</button>
          <button onClick={() => setStep('details')} style={primaryBtn}>{t('Continue')} →</button>
        </div>
      </CardShell>
    );
  }

  // ── Step: details ───────────────────────────────────────────────
  if (step === 'details') {
    return (
      <CardShell title={t('Create your business')} subtitle={`${subtype.icon} ${t(subtype.titleKey)}`}>
        <form onSubmit={(e) => { e.preventDefault(); if (canSubmit) setStep('review'); }} className="login-form">
          {error && <div className="login-error">{error}</div>}

          <div className="form-field">
            <label>{t('Your full name')}</label>
            <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder={t('e.g. Ahmed Benali')} autoFocus />
          </div>

          <div className="form-field">
            <label>{t('Business name')}</label>
            <input type="text" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder={t('e.g. Clinique Benali')} />
            {businessName.trim() && (
              <div style={{ fontSize: 11, color: 'var(--text3, #64748b)', marginTop: 4 }}>
                qflo.app/{slugify(businessName) || 'your-business'}
              </div>
            )}
          </div>

          <div className="form-field">
            <label>{t('Email')}</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@business.com" />
          </div>

          <div className="form-field">
            <label>{t('Password')}</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('Minimum 6 characters')} />
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => setStep(subtype.options?.length ? 'customize' : 'subtype')} style={secondaryBtn}>← {t('Back')}</button>
            <button type="submit" className="btn-primary" disabled={!canSubmit} style={{ flex: 2 }}>{t('Review')} →</button>
          </div>
        </form>

        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', color: 'var(--primary, #3b82f6)', cursor: 'pointer', fontSize: 13 }}>
            {t('Back to sign in')}
          </button>
        </div>
      </CardShell>
    );
  }

  // ── Step: review ────────────────────────────────────────────────
  const totalDesks = Object.entries(options).reduce((n, [k, v]) => {
    if (['cashiers', 'tellers', 'advisors', 'chairs', 'counters', 'doctors'].includes(k)) return n + (v || 0);
    return n;
  }, 0);
  const serviceCount = subtype.departments.reduce((n, d) => n + d.services.length, 0);

  return (
    <CardShell title={t('Review & create')} subtitle={t('Double-check before we set everything up.')} maxWidth={560}>
      {error && <div className="login-error" style={{ marginBottom: 12 }}>{error}</div>}

      <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Row label={t('Category')} value={`${subtype.icon} ${t(subtype.titleKey)}`} />
        <Row label={t('Business name')} value={businessName} mono={`qflo.app/${slugify(businessName) || 'your-business'}`} />
        <Row label={t('Admin')} value={fullName} mono={email} />
        <Row label={t('Office')} value={t(subtype.officeName)} mono={`${t('Mon–Sat 9:00–18:00')} · Africa/Algiers`} />
        <Row
          label={t('Departments')}
          value={subtype.departments.map((d) => t(d.name)).join(', ')}
          mono={`${serviceCount} ${t('services')}`}
        />
        <Row
          label={t('Services')}
          value={subtype.departments.flatMap((d) => d.services.map((s) => t(s.name))).join(', ')}
        />
        <Row label={t('Desks')} value={`${totalDesks || subtype.desks.length}`} />
        {num(options, 'tables', 0) > 0 && (
          <Row label={t('Tables')} value={`${options.tables}`} mono={`T1 … T${options.tables}`} />
        )}
        <Row label={t('Channels')} value="WhatsApp + Messenger + Web + Kiosk" />
        <Row label={t('Booking')} value={t('Enabled · 90 days ahead · 30 min slots')} />
      </div>

      {loading && progress && (
        <div style={{ fontSize: 12, color: 'var(--text2, #94a3b8)', padding: '10px 0' }}>⏳ {progress}</div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button onClick={() => setStep('details')} disabled={loading} style={secondaryBtn}>← {t('Edit')}</button>
        <button
          onClick={handleSubmit}
          disabled={loading || !canSubmit}
          className="btn-primary"
          style={{ flex: 2, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
        >
          {loading && <Spinner />}
          {loading ? t('Creating business...') : t('Confirm & create')}
        </button>
      </div>
    </CardShell>
  );
}

// ── helpers ───────────────────────────────────────────────────────
function num(opts: Record<string, number>, key: string, fallback: number) {
  const v = opts[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
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

function Row({ label, value, mono }: { label: string; value: string; mono?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
      <div style={{ fontSize: 11, color: 'var(--text3, #64748b)', flexShrink: 0, width: 110 }}>{label}</div>
      <div style={{ flex: 1, textAlign: 'right' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text, #f1f5f9)' }}>{value || '—'}</div>
        {mono && <div style={{ fontSize: 11, color: 'var(--text3, #64748b)', fontFamily: 'monospace', marginTop: 2 }}>{mono}</div>}
      </div>
    </div>
  );
}
