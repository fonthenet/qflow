import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSupabase, ensureAuth } from '../lib/supabase';
import { cloudFetch } from '../lib/cloud-fetch';
import { t as translate, type DesktopLocale } from '../lib/i18n';
import { STAFF_ROLES, STAFF_ROLE_LABELS } from '@qflo/shared';

const CLOUD_URL = 'https://qflo.net';

type StaffRole = typeof STAFF_ROLES[keyof typeof STAFF_ROLES];

interface StaffMember {
  id: string;
  auth_user_id: string | null;
  email: string;
  full_name: string;
  role: string;
  office_id: string | null;
  department_id: string | null;
  organization_id: string;
  is_active: boolean | null;
  created_at: string | null;
}

interface Office { id: string; name: string; }
interface Department { id: string; name: string; office_id: string | null; }

interface Props {
  organizationId: string;
  callerUserId: string;
  callerRole: string;
  locale: DesktopLocale;
  onClose: () => void;
  /** When true, render inline (no overlay/panel/header) — for embedding inside Settings. */
  embedded?: boolean;
}

const ROLE_ORDER: StaffRole[] = [
  STAFF_ROLES.ADMIN,
  STAFF_ROLES.MANAGER,
  STAFF_ROLES.BRANCH_ADMIN,
  STAFF_ROLES.RECEPTIONIST,
  STAFF_ROLES.DESK_OPERATOR,
  STAFF_ROLES.FLOOR_MANAGER,
  STAFF_ROLES.ANALYST,
  STAFF_ROLES.AGENT,
];

function canManage(role: string): boolean {
  return ['admin', 'manager', 'branch_admin'].includes(role);
}

export function TeamModal({ organizationId, callerUserId, callerRole, locale, onClose, embedded = false }: Props) {
  const t = useCallback((k: string, vars?: Record<string, any>) => translate(locale, k, vars), [locale]);
  const [loading, setLoading] = useState(true);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetBusy, setResetBusy] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState<string | null>(null);

  // Form state
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sendSetupEmail, setSendSetupEmail] = useState(true);
  const [role, setRole] = useState<string>(STAFF_ROLES.DESK_OPERATOR);
  const [officeId, setOfficeId] = useState<string>('');
  const [departmentId, setDepartmentId] = useState<string>('');
  const [isActive, setIsActive] = useState(true);

  type EmailCheck = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';
  const [emailCheck, setEmailCheck] = useState<EmailCheck>('idle');
  const emailCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isAllowed = canManage(callerRole);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await ensureAuth();
      const sb = await getSupabase();
      const [staffRes, officesRes, deptRes] = await Promise.all([
        sb.from('staff')
          .select('id, auth_user_id, email, full_name, role, office_id, department_id, organization_id, is_active, created_at')
          .eq('organization_id', organizationId)
          .order('full_name', { ascending: true }),
        sb.from('offices').select('id, name').eq('organization_id', organizationId).eq('is_active', true).order('name'),
        sb.from('departments').select('id, name, office_id').eq('organization_id', organizationId).order('name'),
      ]);
      if (staffRes.error) throw staffRes.error;
      setStaff((staffRes.data ?? []) as StaffMember[]);
      setOffices((officesRes.data ?? []) as Office[]);
      setDepartments((deptRes.data ?? []) as Department[]);
    } catch (e: any) {
      setError(e?.message ?? t('Failed to load team'));
    } finally {
      setLoading(false);
    }
  }, [organizationId, t]);

  useEffect(() => {
    if (!isAllowed) { setLoading(false); return; }
    reload();
  }, [isAllowed, reload]);

  // Real-time email availability check (create flow only)
  useEffect(() => {
    if (editing) { setEmailCheck('idle'); return; }
    if (emailCheckTimer.current) clearTimeout(emailCheckTimer.current);
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) { setEmailCheck('idle'); return; }
    // Basic email shape check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) { setEmailCheck('invalid'); return; }
    setEmailCheck('checking');
    emailCheckTimer.current = setTimeout(async () => {
      try {
        await ensureAuth();
        const sb = await getSupabase();
        const { data, error: qErr } = await sb
          .from('staff')
          .select('id')
          .eq('organization_id', organizationId)
          .ilike('email', trimmed)
          .limit(1);
        if (qErr) { setEmailCheck('idle'); return; }
        setEmailCheck((data && data.length > 0) ? 'taken' : 'available');
      } catch {
        setEmailCheck('idle');
      }
    }, 500);
    return () => { if (emailCheckTimer.current) clearTimeout(emailCheckTimer.current); };
  }, [email, editing, organizationId]);

  const availableDepartments = useMemo(() => {
    if (!officeId) return departments;
    return departments.filter(d => d.office_id === officeId);
  }, [departments, officeId]);

  function openCreate() {
    setEditing(null);
    setFullName('');
    setEmail('');
    setPassword('');
    setSendSetupEmail(true);
    setRole(STAFF_ROLES.DESK_OPERATOR);
    setOfficeId('');
    setDepartmentId('');
    setIsActive(true);
    setError(null);
    setSuccess(null);
    setShowModal(true);
  }

  function openEdit(m: StaffMember) {
    setEditing(m);
    setFullName(m.full_name || '');
    setEmail(m.email || '');
    setPassword('');
    setSendSetupEmail(false);
    setRole(m.role);
    setOfficeId(m.office_id ?? '');
    setDepartmentId(m.department_id ?? '');
    setIsActive(m.is_active !== false);
    setError(null);
    setSuccess(null);
    setShowModal(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!editing && emailCheck === 'taken') {
      setError(t('Email already in use in this business.'));
      return;
    }
    if (!editing && emailCheck === 'invalid') {
      setError(t('Please enter a valid email address.'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        // Update via direct Supabase (RLS allows admin role)
        await ensureAuth();
        const sb = await getSupabase();
        const { error: upErr } = await sb.from('staff').update({
          full_name: fullName.trim(),
          role,
          office_id: officeId || null,
          department_id: departmentId || null,
          is_active: isActive,
        }).eq('id', editing.id);
        if (upErr) throw upErr;
        setSuccess(t('Team member updated.'));
      } else {
        // Create via REST — server validates caller and uses service role for auth user creation
        if (!password || password.length < 6) {
          throw new Error(t('Password is required and must be at least 6 characters'));
        }
        const res = await cloudFetch(`${CLOUD_URL}/api/create-staff`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email.trim(),
            password,
            full_name: fullName.trim(),
            role,
            organization_id: organizationId,
            office_id: officeId || undefined,
            department_id: departmentId || undefined,
            caller_user_id: callerUserId,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({} as any));
          throw new Error(body?.error || `Request failed (${res.status})`);
        }

        // Optionally send password setup email so they can change it
        if (sendSetupEmail) {
          try {
            const sb = await getSupabase();
            await sb.auth.resetPasswordForEmail(email.trim(), {
              redirectTo: `${CLOUD_URL}/auth/update-password`,
            });
          } catch {}
        }
        setSuccess(t('Team member added and login account created.'));
      }
      setShowModal(false);
      setEditing(null);
      await reload();
    } catch (e: any) {
      setError(e?.message ?? t('Save failed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleSendReset(m: StaffMember) {
    setResetBusy(m.id);
    setError(null);
    setSuccess(null);
    try {
      await ensureAuth();
      const sb = await getSupabase();
      const { error: rErr } = await sb.auth.resetPasswordForEmail(m.email, {
        redirectTo: `${CLOUD_URL}/auth/update-password`,
      });
      if (rErr) throw rErr;
      setSuccess(t('Password setup email sent to {email}.', { email: m.email }));
    } catch (e: any) {
      setError(e?.message ?? t('Failed to send reset email'));
    } finally {
      setResetBusy(null);
    }
  }

  // ── Styles ─────────────────────────────────────────────────────
  const overlayStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(4px)',
    zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
  };
  const panelStyle: React.CSSProperties = {
    background: 'var(--surface, #1e293b)', borderRadius: 'var(--radius, 12px)',
    width: 960, maxWidth: '96vw', height: '86vh',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    border: '1px solid var(--border, #475569)', boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
  };
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', borderRadius: 8,
    border: '1px solid var(--border)', background: 'var(--bg)',
    color: 'var(--text)', fontSize: 14, outline: 'none',
    colorScheme: 'light dark',
  };
  const labelStyle: React.CSSProperties = {
    display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--text2)', fontWeight: 500,
  };
  const btnPrimary: React.CSSProperties = {
    background: 'var(--primary, #3b82f6)', color: '#fff', border: 'none',
    padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  };
  const btnGhost: React.CSSProperties = {
    background: 'transparent', color: 'var(--text)', border: '1px solid var(--border)',
    padding: '6px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
  };
  const btnDanger: React.CSSProperties = {
    background: 'rgba(239,68,68,0.15)', color: '#b91c1c',
    border: '1px solid rgba(239,68,68,0.35)',
    padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer',
  };

  // Readable pill style matching preset-badge pattern
  const rolePillStyle = (r: string): React.CSSProperties => {
    const palette: Record<string, { bg: string; border: string; text: string }> = {
      admin:          { bg: 'rgba(147,51,234,0.15)', border: 'rgba(147,51,234,0.35)', text: '#6b21a8' },
      manager:        { bg: 'rgba(37,99,235,0.15)',  border: 'rgba(37,99,235,0.35)',  text: '#1e40af' },
      branch_admin:   { bg: 'rgba(79,70,229,0.15)',  border: 'rgba(79,70,229,0.35)',  text: '#3730a3' },
      receptionist:   { bg: 'rgba(219,39,119,0.15)', border: 'rgba(219,39,119,0.35)', text: '#9d174d' },
      desk_operator:  { bg: 'rgba(8,145,178,0.15)',  border: 'rgba(8,145,178,0.35)',  text: '#155e75' },
      floor_manager:  { bg: 'rgba(13,148,136,0.15)', border: 'rgba(13,148,136,0.35)', text: '#115e59' },
      analyst:        { bg: 'rgba(217,119,6,0.15)',  border: 'rgba(217,119,6,0.35)',  text: '#92400e' },
      agent:          { bg: 'rgba(100,116,139,0.18)',border: 'rgba(100,116,139,0.40)',text: '#334155' },
    };
    const p = palette[r] ?? palette.agent;
    return {
      padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700,
      background: p.bg, color: p.text, border: `1px solid ${p.border}`,
      display: 'inline-block',
    };
  };
  const statusPillStyle = (active: boolean): React.CSSProperties => ({
    padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700,
    background: active ? 'rgba(16,185,129,0.15)' : 'rgba(100,116,139,0.18)',
    color: active ? '#047857' : '#334155',
    border: `1px solid ${active ? 'rgba(16,185,129,0.35)' : 'rgba(100,116,139,0.40)'}`,
    display: 'inline-block',
  });

  async function handleDelete(m: StaffMember) {
    if (m.id === callerUserId) {
      setError(t('You cannot delete your own account.'));
      return;
    }
    const ok = typeof window !== 'undefined'
      ? window.confirm(t('Remove {name} from the team? They will no longer be able to sign in.', { name: m.full_name || m.email }))
      : true;
    if (!ok) return;
    setDeleteBusy(m.id);
    setError(null);
    setSuccess(null);
    try {
      const res = await cloudFetch(`${CLOUD_URL}/api/admin/staff/${m.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caller_user_id: callerUserId,
          organization_id: organizationId,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as any));
        throw new Error(body?.error || `Request failed (${res.status})`);
      }
      setSuccess(t('Team member removed.'));
      await reload();
    } catch (e: any) {
      setError(e?.message ?? t('Failed to remove team member'));
    } finally {
      setDeleteBusy(null);
    }
  }

  const inner = (
    <>
        {!embedded && (
          <div style={{
            padding: '18px 22px', borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: 12,
            background: 'linear-gradient(180deg, rgba(100,116,139,0.10), transparent)',
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 style={{ margin: 0, fontSize: 18, color: 'var(--text)', fontWeight: 700 }}>
                👥 {t('Team Access')}
              </h2>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text3)' }}>
                {t('Add business users, choose what they can access, and keep each person tied to the right role.')}
              </p>
            </div>
            {isAllowed && (
              <button onClick={openCreate} style={btnPrimary}>{t('Add Team Member')}</button>
            )}
            <button onClick={onClose} style={{
              background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)',
              width: 32, height: 32, borderRadius: 8, fontSize: 18, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>×</button>
          </div>
        )}
        {embedded && isAllowed && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 22px 0' }}>
            <button onClick={openCreate} style={btnPrimary}>{t('Add Team Member')}</button>
          </div>
        )}

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: 22 }}>
          {!isAllowed ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text2, #94a3b8)' }}>
              {t('Only admins can manage team access.')}
            </div>
          ) : error ? (
            <div style={{
              padding: '10px 14px', borderRadius: 8, marginBottom: 12,
              background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.35)',
              color: '#b91c1c', fontWeight: 600, fontSize: 13,
            }}>{error}</div>
          ) : null}

          {isAllowed && success && (
            <div style={{
              padding: '10px 14px', borderRadius: 8, marginBottom: 12,
              background: 'rgba(16,185,129,0.10)', border: '1px solid rgba(16,185,129,0.35)',
              color: '#047857', fontWeight: 600, fontSize: 13,
            }}>{success}</div>
          )}

          {isAllowed && loading ? (
            <p style={{ textAlign: 'center', color: 'var(--text2, #94a3b8)', padding: 40 }}>{t('Loading...')}</p>
          ) : isAllowed ? (
            <div style={{
              border: '1px solid var(--border, #475569)', borderRadius: 10, overflow: 'hidden',
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead style={{ background: 'rgba(100,116,139,0.12)' }}>
                  <tr>
                    <th style={thStyle}>{t('Team member')}</th>
                    <th style={thStyle}>{t('Role')}</th>
                    <th style={thStyle}>{t('Location')}</th>
                    <th style={thStyle}>{t('Login')}</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>{t('Actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {staff.length === 0 ? (
                    <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: 'var(--text2, #94a3b8)' }}>
                      {t('No team members yet.')}
                    </td></tr>
                  ) : null}
                  {staff.map(m => {
                    const office = offices.find(o => o.id === m.office_id);
                    return (
                      <tr key={m.id} style={{ borderTop: '1px solid var(--border, #475569)' }}>
                        <td style={tdStyle}>
                          <div style={{ fontWeight: 600, color: 'var(--text, #f1f5f9)' }}>{m.full_name}</div>
                          <div style={{ color: 'var(--text3, #64748b)', fontSize: 12 }}>{m.email}</div>
                        </td>
                        <td style={tdStyle}>
                          <span style={rolePillStyle(m.role)}>
                            {STAFF_ROLE_LABELS[m.role as StaffRole] ?? m.role}
                          </span>
                        </td>
                        <td style={tdStyle}>{office?.name ?? t('All locations')}</td>
                        <td style={tdStyle}>
                          <span style={statusPillStyle(!!m.is_active)}>
                            {m.is_active ? t('Can sign in') : t('Inactive')}
                          </span>
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          <button
                            onClick={() => handleSendReset(m)}
                            disabled={resetBusy === m.id}
                            style={{ ...btnGhost, marginInlineEnd: 6, opacity: resetBusy === m.id ? 0.5 : 1 }}
                          >
                            {resetBusy === m.id ? t('Sending...') : t('Send setup email')}
                          </button>
                          <button onClick={() => openEdit(m)} style={{ ...btnGhost, marginInlineEnd: 6 }}>{t('Edit')}</button>
                          <button
                            onClick={() => handleDelete(m)}
                            disabled={deleteBusy === m.id || m.id === callerUserId}
                            style={{ ...btnDanger, opacity: (deleteBusy === m.id || m.id === callerUserId) ? 0.5 : 1 }}
                            title={m.id === callerUserId ? t('You cannot delete your own account.') : t('Remove')}
                          >
                            {deleteBusy === m.id ? t('Removing...') : t('Remove')}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div
          style={{ ...overlayStyle, zIndex: 1100 }}
          onClick={() => !saving && setShowModal(false)}
        >
          <form
            onSubmit={handleSubmit}
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--surface)', borderRadius: 12,
              width: 560, maxWidth: '96vw', maxHeight: '90vh', overflow: 'auto',
              border: '1px solid var(--border)', padding: 22,
              display: 'flex', flexDirection: 'column', gap: 14,
            }}
          >
            <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text)', fontWeight: 700 }}>
              {editing ? t('Edit team member') : t('Add team member')}
            </h3>
            {error && (
              <div style={{
                padding: '10px 14px', borderRadius: 8,
                background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.35)',
                color: '#fca5a5', fontSize: 13,
              }}>{error}</div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>{t('Full name')}</label>
                <input required value={fullName} onChange={e => setFullName(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>{t('Email')}</label>
                <input
                  required type="email"
                  value={email}
                  disabled={!!editing}
                  onChange={e => setEmail(e.target.value)}
                  style={{
                    ...inputStyle,
                    opacity: editing ? 0.6 : 1,
                    borderColor:
                      emailCheck === 'taken' || emailCheck === 'invalid' ? '#ef4444'
                      : emailCheck === 'available' ? '#22c55e'
                      : (inputStyle.borderColor as string) ?? 'var(--border, #475569)',
                  }}
                />
                {!editing && emailCheck !== 'idle' && (
                  <div style={{
                    marginTop: 4, fontSize: 11, fontWeight: 600,
                    color:
                      emailCheck === 'available' ? '#4ade80'
                      : emailCheck === 'taken' || emailCheck === 'invalid' ? '#fca5a5'
                      : 'var(--text3, #94a3b8)',
                  }}>
                    {emailCheck === 'checking' ? t('Checking availability…')
                      : emailCheck === 'available' ? '✓ ' + t('Email available')
                      : emailCheck === 'taken' ? '✗ ' + t('Email already in use in this business.')
                      : emailCheck === 'invalid' ? '✗ ' + t('Please enter a valid email address.')
                      : ''}
                  </div>
                )}
              </div>
            </div>

            {!editing && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelStyle}>{t('Temporary password')}</label>
                  <input
                    required minLength={6} type="password"
                    value={password} onChange={e => setPassword(e.target.value)} style={inputStyle}
                  />
                  <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text3, #64748b)' }}>
                    {t('They can use this right away, then change it later.')}
                  </div>
                </div>
                <div style={{
                  border: '1px solid var(--border, #475569)', borderRadius: 8, padding: 10,
                  background: 'rgba(100,116,139,0.08)',
                }}>
                  <label style={{ display: 'flex', gap: 8, fontSize: 13, color: 'var(--text, #f1f5f9)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={sendSetupEmail} onChange={e => setSendSetupEmail(e.target.checked)} />
                    <span>
                      <strong>{t('Send setup email')}</strong>
                      <div style={{ marginTop: 2, fontSize: 11, color: 'var(--text3, #64748b)' }}>
                        {t('Sends a password setup email so they can sign in without you sharing the password.')}
                      </div>
                    </span>
                  </label>
                </div>
              </div>
            )}

            <div>
              <label style={labelStyle}>{t('Role')}</label>
              <select
                value={role}
                onChange={e => setRole(e.target.value)}
                style={inputStyle as any}
              >
                {ROLE_ORDER.map(r => (
                  <option key={r} value={r}>{STAFF_ROLE_LABELS[r]}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>{t('Location')}</label>
                <select
                  value={officeId}
                  onChange={e => { setOfficeId(e.target.value); setDepartmentId(''); }}
                  style={inputStyle as any}
                >
                  <option value="">{t('All locations')}</option>
                  {offices.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>{t('Department')}</label>
                <select
                  value={departmentId}
                  onChange={e => setDepartmentId(e.target.value)}
                  style={inputStyle as any}
                >
                  <option value="">{t('No department limit')}</option>
                  {availableDepartments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            </div>

            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text, #f1f5f9)', cursor: 'pointer' }}>
              <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} />
              {t('This person can sign in now')}
            </label>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button type="button" onClick={() => setShowModal(false)} disabled={saving} style={btnGhost}>
                {t('Cancel')}
              </button>
              <button type="submit" disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>
                {saving ? t('Saving...') : editing ? t('Save changes') : t('Create login')}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );

  if (embedded) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        {inner}
      </div>
    );
  }
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={panelStyle} onClick={e => e.stopPropagation()}>
        {inner}
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '10px 14px', textAlign: 'left', fontSize: 12,
  color: 'var(--text2, #94a3b8)', fontWeight: 600,
};
const tdStyle: React.CSSProperties = {
  padding: '10px 14px', color: 'var(--text, #f1f5f9)', verticalAlign: 'top',
};
