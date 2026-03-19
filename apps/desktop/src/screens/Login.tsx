import { useState } from 'react';
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
      };

      onLogin(session);
    } catch (err: any) {
      setError(err.message ?? 'Login failed');
    } finally {
      setLoading(false);
    }
  };

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
