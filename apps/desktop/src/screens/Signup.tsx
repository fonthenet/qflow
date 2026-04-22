import { useEffect, useState } from 'react';
import { restoreSession } from '../lib/supabase';
import type { StaffSession } from '../lib/types';
import { t as translate, type DesktopLocale } from '../lib/i18n';
import { STARTER_TEMPLATES, getStarterTemplate } from '@qflo/shared';

interface Props {
  onSignedUp: (session: StaffSession) => void;
  onCancel: () => void;
  locale: DesktopLocale;
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
  const [step, setStep] = useState<'template' | 'details'>('template');
  const [templateId, setTemplateId] = useState<string>(STARTER_TEMPLATES[0]?.id ?? 'restaurant');
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
  const canSubmit = fullName.trim() && email.trim() && password.length >= 6 && businessName.trim() && cloudUrl;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || loading) return;
    setError('');
    setLoading(true);
    try {
      setProgress(t('Creating your business...'));

      // Single unified call — same endpoint the web signup + future
      // mobile onboarding use. The server handles auth.signUp, org
      // creation, template seeding, VQC, and org settings in one
      // atomic-ish pass (with auth rollback on failure).
      const res = await fetch(`${cloudUrl}/api/onboarding/create-business`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password,
          fullName: fullName.trim(),
          businessName: businessName.trim(),
          templateId,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? t('Sign-up failed'));

      // If the API returned a session, restore it in the renderer's
      // Supabase client so Station is immediately authenticated.
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

  if (step === 'template') {
    return (
      <div className="login-container">
        <div className="login-card" style={{ maxWidth: 520 }}>
          <div className="login-header">
            <div className="login-logo">Q</div>
            <h1>{t('Pick your category')}</h1>
            <p>{t('We will set up departments, services and desks to match — you can edit anything later.')}</p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
            {STARTER_TEMPLATES.map((tpl) => {
              const selected = templateId === tpl.id;
              return (
                <button
                  key={tpl.id}
                  onClick={() => setTemplateId(tpl.id)}
                  type="button"
                  style={{
                    textAlign: 'left',
                    padding: 14,
                    borderRadius: 10,
                    border: selected ? '2px solid var(--primary, #3b82f6)' : '1px solid var(--border, #475569)',
                    background: selected ? 'var(--surface2, #334155)' : 'var(--surface, #1e293b)',
                    color: 'var(--text, #f1f5f9)',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <span style={{ fontSize: 24 }}>{tpl.icon}</span>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{t(tpl.titleKey)}</span>
                  <span style={{ fontSize: 11, color: 'var(--text3, #64748b)' }}>
                    {tpl.departments.length} {t('dept(s)')} ·{' '}
                    {tpl.departments.reduce((n, d) => n + d.services.length, 0)} {t('services')} ·{' '}
                    {tpl.desks.length} {t('desk(s)')}
                  </span>
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
            <button
              onClick={onCancel}
              className="btn-secondary"
              style={{ flex: 1, padding: '10px', borderRadius: 8, border: '1px solid var(--border, #475569)', background: 'transparent', color: 'var(--text, #f1f5f9)', cursor: 'pointer' }}
            >
              {t('Back to sign in')}
            </button>
            <button
              onClick={() => setStep('details')}
              className="btn-primary"
              style={{ flex: 1, padding: '10px', borderRadius: 8, background: 'var(--primary, #3b82f6)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 700 }}
            >
              {t('Continue')} →
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <div className="login-logo">Q</div>
          <h1>{t('Create your business')}</h1>
          <p>
            {template.icon} {t(template.titleKey)} · {t('Start your Qflo queue in under a minute.')}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {error && <div className="login-error">{error}</div>}
          {loading && progress && (
            <div style={{ fontSize: 12, color: 'var(--text2, #94a3b8)', padding: '4px 0' }}>⏳ {progress}</div>
          )}

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
            <button
              type="button"
              onClick={() => setStep('template')}
              disabled={loading}
              className="btn-secondary"
              style={{ flex: 1, padding: '10px', borderRadius: 8, border: '1px solid var(--border, #475569)', background: 'transparent', color: 'var(--text, #f1f5f9)', cursor: 'pointer' }}
            >
              ← {t('Change category')}
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={loading || !canSubmit}
              style={{ flex: 2, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              {loading && (
                <span
                  aria-hidden
                  style={{
                    width: 14,
                    height: 14,
                    border: '2px solid rgba(255,255,255,0.35)',
                    borderTopColor: '#fff',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                    display: 'inline-block',
                  }}
                />
              )}
              {loading ? t('Creating business...') : t('Create business')}
            </button>
          </div>
        </form>

        <div style={{ textAlign: 'center', marginTop: 14 }}>
          <button
            onClick={onCancel}
            style={{ background: 'none', border: 'none', color: 'var(--primary, #3b82f6)', cursor: 'pointer', fontSize: 13 }}
          >
            {t('Back to sign in')}
          </button>
        </div>
      </div>
    </div>
  );
}
