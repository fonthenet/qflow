import { useState, useEffect } from 'react';
import { getSupabase } from '../lib/supabase';
import type { StaffSession } from '../lib/types';
import { t as translate, type DesktopLocale } from '../lib/i18n';

interface Props {
  onLogin: (session: StaffSession) => void;
  locale: DesktopLocale;
}

export function Login({ onLogin, locale }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // License state
  const [licenseChecked, setLicenseChecked] = useState(false);
  const [licensed, setLicensed] = useState(false);
  const [machineId, setMachineId] = useState('');
  const [licenseKey, setLicenseKey] = useState('');
  const [licenseError, setLicenseError] = useState('');
  const [activating, setActivating] = useState(false);
  const t = (key: string, values?: Record<string, string | number | null | undefined>) => translate(locale, key, values);

  // Check license on mount
  useEffect(() => {
    (window as any).qf?.license?.getStatus().then((status: any) => {
      setMachineId(status.machineId || '');
      if (status.licensed) {
        setLicensed(true);
      }
      setLicenseChecked(true);
    }).catch(() => setLicenseChecked(true));
  }, []);

  // Poll for remote approval every 5 seconds when not licensed
  useEffect(() => {
    if (licensed || !licenseChecked) return;
    const interval = setInterval(async () => {
      try {
        const result = await (window as any).qf?.license?.checkApproval();
        if (result?.approved) {
          setLicensed(true);
          clearInterval(interval);
        }
      } catch {}
    }, 5000);
    return () => clearInterval(interval);
  }, [licensed, licenseChecked]);

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!licenseKey.trim()) return;
    setLicenseError('');
    setActivating(true);
    try {
      const result = await (window as any).qf.license.activate(licenseKey);
      if (result.success) {
        setLicensed(true);
      } else {
        setLicenseError(result.error || t('Activation failed'));
      }
    } catch (err: any) {
      setLicenseError(err?.message || t('Activation failed'));
    } finally {
      setActivating(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    setError('');
    setLoading(true);

    try {
      const supabase = await getSupabase();

      // Sign in
      const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({ email, password });
      if (authErr) throw authErr;
      if (!auth.user) throw new Error(t('Login failed'));

      // Get staff record
      const { data: staff, error: staffErr } = await supabase
        .from('staff')
        .select('id, full_name, role, office_id, department_id, organization_id')
        .eq('auth_user_id', auth.user.id)
        .single();

      if (staffErr || !staff) throw new Error(t('No staff account found for this email'));

      // Get all offices for the org
      const orgId = staff.organization_id;
      let officeIds: string[] = [];
      let officeName = t('Office');

      if (orgId) {
        const { data: offices } = await supabase
          .from('offices')
          .select('id, name')
          .eq('organization_id', orgId)
          .eq('is_active', true);
        if (offices) {
          officeIds = offices.map((o: any) => o.id);
          // Use staff's assigned office or first office
          const myOffice = offices.find((o: any) => o.id === staff.office_id) ?? offices[0];
          if (myOffice) officeName = myOffice.name;
        }
      }

      const effectiveOfficeId = staff.office_id ?? officeIds[0] ?? '';

      // Get desk assignment — first try by current_staff_id, then auto-reclaim if lost
      let { data: desk } = await supabase
        .from('desks')
        .select('id, name')
        .eq('current_staff_id', staff.id)
        .eq('is_active', true)
        .single();

      // If no desk found (e.g. another device signed out and cleared it), try to reclaim
      if (!desk && effectiveOfficeId) {
        // Look for an unassigned desk in the same office, prefer matching department
        let query = supabase
          .from('desks')
          .select('id, name, department_id')
          .eq('office_id', effectiveOfficeId)
          .eq('is_active', true)
          .is('current_staff_id', null);
        if (staff.department_id) {
          query = query.eq('department_id', staff.department_id);
        }
        const { data: freeDeskList } = await query.limit(1);
        const freeDesk = freeDeskList?.[0];
        if (freeDesk) {
          // Claim the desk
          await supabase
            .from('desks')
            .update({ current_staff_id: staff.id, status: 'open' })
            .eq('id', freeDesk.id);
          desk = { id: freeDesk.id, name: freeDesk.name };
        }
      }

      const session: StaffSession = {
        user_id: auth.user.id,
        staff_id: staff.id,
        email: auth.user.email ?? email,
        full_name: staff.full_name ?? t('Operator'),
        role: staff.role,
        office_id: effectiveOfficeId,
        office_name: officeName,
        organization_id: orgId ?? '',
        department_id: staff.department_id ?? undefined,
        desk_id: desk?.id ?? undefined,
        desk_name: desk?.name ?? undefined,
        office_ids: officeIds,
        access_token: auth.session?.access_token,
        refresh_token: auth.session?.refresh_token,
        _pwd: password, // passed to main process for encrypted storage (silent re-auth)
      };

      onLogin(session);
    } catch (err: any) {
      setError(err.message ?? t('Login failed'));
    } finally {
      setLoading(false);
    }
  };

  // ── Loading state ──
  if (!licenseChecked) {
    return (
      <div className="login-container">
        <div className="login-card">
          <div className="login-header">
            <div className="login-logo">Q</div>
            <h1>{t('Qflo Station')}</h1>
            <p>{t('Checking license...')}</p>
          </div>
        </div>
      </div>
    );
  }

  // ── License activation screen ──
  if (!licensed) {
    return (
      <div className="login-container">
        <div className="login-card">
          <div className="login-header">
            <div className="login-logo" style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}>🔑</div>
            <h1>{t('Activate Station')}</h1>
            <p>{t('Waiting for administrator approval')}</p>
          </div>

          <div className="login-form">
            {licenseError && <div className="login-error">{licenseError}</div>}

            <div className="form-field">
              <label>{t('Machine ID')}</label>
              <div style={{
                fontFamily: 'monospace',
                fontSize: 20,
                fontWeight: 700,
                letterSpacing: 3,
                textAlign: 'center',
                padding: '14px 16px',
                background: '#f1f5f9',
                borderRadius: 12,
                color: '#334155',
                userSelect: 'all',
                cursor: 'pointer',
              }}
                title={t('Click to copy')}
                onClick={() => navigator.clipboard?.writeText(machineId)}
              >
                {machineId}
              </div>
            </div>

            {/* Waiting indicator */}
            <div style={{
              textAlign: 'center',
              padding: '16px 0',
              color: '#64748b',
              fontSize: 14,
            }}>
              <div style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: '#f59e0b',
                marginRight: 8,
                animation: 'pulse 1.5s ease-in-out infinite',
              }} />
              {t('This device has been registered. Your administrator will approve it remotely.')}
            </div>

            {/* Divider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '8px 0' }}>
              <div style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
              <span style={{ fontSize: 12, color: '#94a3b8' }}>{t('or enter key manually')}</span>
              <div style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
            </div>

            <form onSubmit={handleActivate}>
              <div className="form-field">
                <input
                  type="text"
                  value={licenseKey}
                  onChange={(e) => setLicenseKey(e.target.value.toUpperCase())}
                  placeholder="XXXX-XXXX-XXXX-XXXX"
                  style={{ fontFamily: 'monospace', fontSize: 16, letterSpacing: 2, textAlign: 'center' }}
                />
              </div>
              <button type="submit" className="btn-primary btn-full" disabled={activating || !licenseKey.trim()}>
                {activating ? t('Activating...') : t('Activate Manually')}
              </button>
            </form>
          </div>

          <style>{`
            @keyframes pulse {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.3; }
            }
          `}</style>

          <p className="login-footer">
            {t('This station will activate automatically once approved by your administrator.')}
          </p>
        </div>
      </div>
    );
  }

  // ── Login screen (after license verified) ──
  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <div className="login-logo">Q</div>
          <h1>{t('Qflo Station')}</h1>
          <p>{t('Sign in to your operator account')}</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {error && <div className="login-error">{error}</div>}

          <div className="form-field">
            <label>{t('Email')}</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="operator@clinic.com"
              autoFocus
            />
          </div>

          <div className="form-field">
            <label>{t('Password')}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('Enter password')}
            />
          </div>

          <button type="submit" className="btn-primary btn-full" disabled={loading}>
            {loading ? t('Signing in...') : t('Sign In')}
          </button>
        </form>

        <p className="login-footer">
          {t('This station works offline. Your queue data is stored locally and synced automatically.')}
        </p>
      </div>
    </div>
  );
}
