import { useState, useEffect } from 'react';
import { getSupabase } from '../lib/supabase';
import type { StaffSession } from '../lib/types';

interface Props {
  onLogin: (session: StaffSession) => void;
}

export function Login({ onLogin }: Props) {
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
        setLicenseError(result.error || 'Activation failed');
      }
    } catch (err: any) {
      setLicenseError(err?.message || 'Activation failed');
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
      if (!auth.user) throw new Error('Login failed');

      // Get staff record
      const { data: staff, error: staffErr } = await supabase
        .from('staff')
        .select('id, full_name, role, office_id, department_id, organization_id')
        .eq('auth_user_id', auth.user.id)
        .single();

      if (staffErr || !staff) throw new Error('No staff account found for this email');

      // Get all offices for the org
      const orgId = staff.organization_id;
      let officeIds: string[] = [];
      let officeName = 'Office';

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

      // Get desk assignment
      const { data: desk } = await supabase
        .from('desks')
        .select('id, name')
        .eq('current_staff_id', staff.id)
        .eq('is_active', true)
        .single();

      const session: StaffSession = {
        user_id: auth.user.id,
        staff_id: staff.id,
        email: auth.user.email ?? email,
        full_name: staff.full_name ?? 'Operator',
        role: staff.role,
        office_id: effectiveOfficeId,
        office_name: officeName,
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
      setError(err.message ?? 'Login failed');
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
            <h1>Qflo Station</h1>
            <p>Checking license...</p>
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
            <h1>Activate Station</h1>
            <p>Enter your license key to activate this station</p>
          </div>

          <form onSubmit={handleActivate} className="login-form">
            {licenseError && <div className="login-error">{licenseError}</div>}

            <div className="form-field">
              <label>Machine ID</label>
              <div style={{
                fontFamily: 'monospace',
                fontSize: 18,
                fontWeight: 700,
                letterSpacing: 2,
                textAlign: 'center',
                padding: '12px 16px',
                background: '#f1f5f9',
                borderRadius: 12,
                color: '#334155',
                userSelect: 'all',
                cursor: 'pointer',
              }}
                title="Click to copy"
                onClick={() => navigator.clipboard?.writeText(machineId)}
              >
                {machineId}
              </div>
              <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 4, textAlign: 'center' }}>
                Click to copy — provide this to your administrator
              </p>
            </div>

            <div className="form-field">
              <label>License Key</label>
              <input
                type="text"
                value={licenseKey}
                onChange={(e) => setLicenseKey(e.target.value.toUpperCase())}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                style={{ fontFamily: 'monospace', fontSize: 16, letterSpacing: 2, textAlign: 'center' }}
                autoFocus
              />
            </div>

            <button type="submit" className="btn-primary btn-full" disabled={activating || !licenseKey.trim()}>
              {activating ? 'Activating...' : 'Activate License'}
            </button>
          </form>

          <p className="login-footer">
            Contact your system administrator to get a license key for this machine.
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
          <h1>Qflo Station</h1>
          <p>Sign in to your operator account</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {error && <div className="login-error">{error}</div>}

          <div className="form-field">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="operator@clinic.com"
              autoFocus
            />
          </div>

          <div className="form-field">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
            />
          </div>

          <button type="submit" className="btn-primary btn-full" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="login-footer">
          This station works offline. Your queue data is stored locally and synced automatically.
        </p>
      </div>
    </div>
  );
}
