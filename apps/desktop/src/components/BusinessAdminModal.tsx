import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase, ensureAuth } from '../lib/supabase';
import { cloudFetch } from '../lib/cloud-fetch';
import { t as translate, type DesktopLocale } from '../lib/i18n';
import { TablesPanel } from './TablesPanel';
import { RidersPanel } from './RidersPanel';

const CLOUD_URL = 'https://qflo.net';

interface Office { id: string; name: string; is_active: boolean | null; }
interface Department {
  id: string;
  name: string;
  code: string;
  description: string | null;
  office_id: string;
  is_active: boolean | null;
  sort_order: number | null;
}
interface Service {
  id: string;
  name: string;
  code: string;
  description: string | null;
  department_id: string;
  estimated_service_time: number | null;
  priority: number | null;
  is_active: boolean | null;
  sort_order: number | null;
}
interface Desk {
  id: string;
  name: string;
  display_name: string | null;
  office_id: string;
  department_id: string;
  current_staff_id: string | null;
  status: string | null;
  is_active: boolean | null;
}
interface StaffRow {
  id: string;
  full_name: string;
  email: string;
  role: string;
  office_id: string | null;
  department_id: string | null;
  is_active: boolean | null;
  // Operational on-floor status — distinct from is_active. Optional
  // because non-salon orgs ignore the column; the "On floor" /
  // "On break" / "Off" pill in the Team table only renders for
  // salon-style categories.
  availability_status?: 'available' | 'on_break' | 'off' | null;
  availability_until?: string | null;
}

type Tab = 'departments' | 'services' | 'desks' | 'tables' | 'team' | 'riders';

interface Props {
  organizationId: string;
  /**
   * The office the Station operator is currently signed in to. Used to
   * default new departments/desks and to scope the Tables panel so the
   * data matches what the FloorMap on the same session reads. If omitted,
   * we fall back to the first office the user has access to.
   */
  activeOfficeId?: string | null;
  callerUserId: string;
  callerRole: string;
  locale: DesktopLocale;
  onClose: () => void;
  /** When true, render inline (no overlay/panel/header) — for embedding inside Settings. */
  embedded?: boolean;
}

function canManage(role: string): boolean {
  return ['admin', 'manager', 'branch_admin'].includes(role);
}

function roleLabel(role: string, t: (k: string) => string): string {
  const map: Record<string, string> = {
    admin: t('Admin'),
    manager: t('Manager'),
    branch_admin: t('Branch Admin'),
    floor_manager: t('Floor Manager'),
    receptionist: t('Receptionist'),
    desk_operator: t('Desk Operator'),
    analyst: t('Analyst'),
    agent: t('Agent'),
    stylist: t('Stylist'),
    barber: t('Barber'),
    therapist: t('Therapist'),
  };
  return map[role] ?? role;
}

export function BusinessAdminModal({ organizationId, activeOfficeId, callerUserId, callerRole, locale, onClose, embedded = false }: Props) {
  // Default to the Station's active office; fall back to the first office
  // the admin has access to if the session didn't provide one. This keeps
  // the Tables panel aligned with the FloorMap so tables created here
  // actually show up on the queue screen.
  const resolveDefaultOfficeId = (list: { id: string }[]): string | null => {
    if (activeOfficeId && list.some((o) => o.id === activeOfficeId)) return activeOfficeId;
    return list[0]?.id ?? null;
  };
  const t = useCallback((k: string, vars?: Record<string, any>) => translate(locale, k, vars), [locale]);
  const isAllowed = canManage(callerRole);

  const [tab, setTab] = useState<Tab>('departments');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [offices, setOffices] = useState<Office[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [desks, setDesks] = useState<Desk[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [businessCategory, setBusinessCategory] = useState<string>('');

  const authBody = useMemo(
    () => ({ caller_user_id: callerUserId, organization_id: organizationId }),
    [callerUserId, organizationId]
  );

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Ask the Electron sync engine to pull the freshest config from Supabase
    // so Station UI (and kiosk/display clients) reflect admin edits immediately.
    try { await (window as any).qf?.sync?.refreshConfig?.(); } catch { /* non-fatal */ }
    try {
      await ensureAuth();
      const sb = await getSupabase();

      // 0) Org-level business_category — drives the Tables tab visibility.
      const orgRes = await sb
        .from('organizations')
        .select('settings')
        .eq('id', organizationId)
        .single();
      const cat = ((orgRes.data?.settings as any)?.business_category ?? '') as string;
      setBusinessCategory(cat);

      // 1) Offices are directly scoped by organization_id
      const offRes = await sb
        .from('offices')
        .select('id, name, is_active')
        .eq('organization_id', organizationId)
        .order('name');
      if (offRes.error) throw offRes.error;
      const officesData = (offRes.data ?? []) as Office[];
      const officeIds = officesData.map((o) => o.id);
      setOffices(officesData);

      if (officeIds.length === 0) {
        setDepartments([]); setServices([]); setDesks([]);
      } else {
        // 2) Departments + Desks scoped via office_id ∈ org offices
        const [deptRes, deskRes] = await Promise.all([
          sb.from('departments')
            .select('id, name, code, description, office_id, is_active, sort_order')
            .in('office_id', officeIds).order('name'),
          sb.from('desks')
            .select('id, name, display_name, office_id, department_id, current_staff_id, status, is_active')
            .in('office_id', officeIds).order('name'),
        ]);
        if (deptRes.error) throw deptRes.error;
        if (deskRes.error) throw deskRes.error;
        const deptsData = (deptRes.data ?? []) as Department[];
        setDepartments(deptsData);
        setDesks((deskRes.data ?? []) as Desk[]);

        // 3) Services scoped via department_id ∈ org departments
        const deptIds = deptsData.map((d) => d.id);
        if (deptIds.length === 0) {
          setServices([]);
        } else {
          const svcRes = await sb
            .from('services')
            .select('id, name, code, description, department_id, estimated_service_time, priority, is_active, sort_order')
            .in('department_id', deptIds).order('name');
          if (svcRes.error) throw svcRes.error;
          setServices((svcRes.data ?? []) as Service[]);
        }
      }

      // 4) Staff is directly scoped by organization_id
      const staffRes = await sb
        .from('staff')
        .select('id, full_name, email, role, office_id, department_id, is_active, availability_status, availability_until')
        .eq('organization_id', organizationId).order('full_name');
      if (staffRes.error) throw staffRes.error;
      setStaff((staffRes.data ?? []) as StaffRow[]);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => { if (isAllowed) reload(); else setLoading(false); }, [isAllowed, reload]);

  async function api(
    method: 'POST' | 'PATCH' | 'DELETE',
    path: string,
    extraBody: Record<string, unknown> = {}
  ): Promise<{ success?: boolean; data?: any; error?: string; [k: string]: any }> {
    const res = await cloudFetch(`${CLOUD_URL}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...authBody, ...extraBody }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = body?.error || `Request failed (${res.status})`;
      const extended: any = new Error(err);
      extended.details = body;
      extended.status = res.status;
      throw extended;
    }
    return body;
  }

  // ── Styles ─────────────────────────────────────────────────────
  const overlayStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(4px)',
    zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
  };
  const panelStyle: React.CSSProperties = {
    background: 'var(--surface, #1e293b)', borderRadius: 'var(--radius, 12px)',
    width: 1060, maxWidth: '96vw', height: '90vh',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    border: '1px solid var(--border, #475569)', boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
  };
  const tabBtn = (active: boolean): React.CSSProperties => ({
    background: active ? 'rgba(59,130,246,0.15)' : 'transparent',
    color: active ? 'var(--primary, #3b82f6)' : 'var(--text, #f1f5f9)',
    border: 'none', borderBottom: active ? '2px solid var(--primary, #3b82f6)' : '2px solid transparent',
    padding: '10px 14px', fontSize: 13, fontWeight: active ? 700 : 500, cursor: 'pointer',
  });
  const btnPrimary: React.CSSProperties = {
    background: 'var(--primary, #3b82f6)', color: '#fff', border: 'none',
    padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  };
  const btnGhost: React.CSSProperties = {
    background: 'transparent', color: 'var(--text, #f1f5f9)', border: '1px solid var(--border, #475569)',
    padding: '6px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
  };
  const btnDanger: React.CSSProperties = {
    background: 'rgba(239,68,68,0.15)', color: '#b91c1c', border: '1px solid rgba(239,68,68,0.35)',
    padding: '6px 12px', borderRadius: 999, fontSize: 11, fontWeight: 700, cursor: 'pointer',
  };
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', borderRadius: 8,
    border: '1px solid var(--border)', background: 'var(--bg)',
    color: 'var(--text)', fontSize: 14, outline: 'none',
    colorScheme: 'light dark' as any,
  };
  const labelStyle: React.CSSProperties = {
    display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--text2, #94a3b8)', fontWeight: 500,
  };
  const thStyle: React.CSSProperties = {
    padding: '10px 14px', textAlign: 'left', fontSize: 12,
    color: 'var(--text2, #94a3b8)', fontWeight: 600,
  };
  const tdStyle: React.CSSProperties = {
    padding: '10px 14px', color: 'var(--text, #f1f5f9)', verticalAlign: 'top', fontSize: 13,
  };
  const pill = (ok: boolean): React.CSSProperties => ({
    display: 'inline-block',
    padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700,
    background: ok ? 'rgba(16,185,129,0.15)' : 'rgba(100,116,139,0.15)',
    color: ok ? '#047857' : '#475569',
    border: ok ? '1px solid rgba(16,185,129,0.35)' : '1px solid rgba(100,116,139,0.35)',
  });

  async function flash(msg: string) {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 2500);
  }

  // ── Departments ────────────────────────────────────────────────
  const [deptForm, setDeptForm] = useState<Partial<Department> | null>(null);
  const [deptSaving, setDeptSaving] = useState(false);

  async function saveDept(e: React.FormEvent) {
    e.preventDefault();
    if (!deptForm || deptSaving) return;
    setDeptSaving(true);
    setError(null);
    try {
      const payload = {
        name: deptForm.name,
        code: deptForm.code,
        description: deptForm.description ?? null,
        office_id: deptForm.office_id,
        is_active: deptForm.is_active !== false,
        sort_order: deptForm.sort_order ?? null,
      };
      if (deptForm.id) {
        await api('PATCH', `/api/admin/departments/${deptForm.id}`, payload);
        await flash(t('Department updated.'));
      } else {
        await api('POST', `/api/admin/departments`, payload);
        await flash(t('Department created.'));
      }
      setDeptForm(null);
      await reload();
    } catch (e: any) {
      setError(e?.message ?? 'Save failed');
    } finally {
      setDeptSaving(false);
    }
  }

  async function deleteDept(d: Department) {
    if (!confirm(t('Delete department "{name}"? This cannot be undone.', { name: d.name }))) return;
    setError(null);
    try {
      await api('DELETE', `/api/admin/departments/${d.id}`);
      await flash(t('Department deleted.'));
      await reload();
    } catch (e: any) {
      setError(e?.message ?? 'Delete failed');
    }
  }

  // ── Services ───────────────────────────────────────────────────
  const [svcForm, setSvcForm] = useState<Partial<Service> | null>(null);
  const [svcSaving, setSvcSaving] = useState(false);

  async function saveSvc(e: React.FormEvent) {
    e.preventDefault();
    if (!svcForm || svcSaving) return;
    setSvcSaving(true);
    setError(null);
    try {
      const payload = {
        name: svcForm.name,
        code: svcForm.code,
        description: svcForm.description ?? null,
        department_id: svcForm.department_id,
        estimated_service_time: svcForm.estimated_service_time ?? null,
        priority: svcForm.priority ?? null,
        is_active: svcForm.is_active !== false,
        sort_order: svcForm.sort_order ?? null,
      };
      if (svcForm.id) {
        await api('PATCH', `/api/admin/services/${svcForm.id}`, payload);
        await flash(t('Service updated.'));
      } else {
        await api('POST', `/api/admin/services`, payload);
        await flash(t('Service created.'));
      }
      setSvcForm(null);
      await reload();
    } catch (e: any) {
      setError(e?.message ?? 'Save failed');
    } finally {
      setSvcSaving(false);
    }
  }

  async function deleteSvc(s: Service) {
    if (!confirm(t('Delete service "{name}"? This cannot be undone.', { name: s.name }))) return;
    setError(null);
    try {
      await api('DELETE', `/api/admin/services/${s.id}`);
      await flash(t('Service deleted.'));
      await reload();
    } catch (e: any) {
      setError(e?.message ?? 'Delete failed');
    }
  }

  // ── Desks ──────────────────────────────────────────────────────
  const [deskForm, setDeskForm] = useState<Partial<Desk> | null>(null);
  const [deskSaving, setDeskSaving] = useState(false);
  const [deskAssignFor, setDeskAssignFor] = useState<Desk | null>(null);
  const [deskAssignStaffId, setDeskAssignStaffId] = useState<string>('');
  const [deskAssignBusy, setDeskAssignBusy] = useState(false);

  async function saveDesk(e: React.FormEvent) {
    e.preventDefault();
    if (!deskForm || deskSaving) return;
    setDeskSaving(true);
    setError(null);
    try {
      const payload = {
        name: deskForm.name,
        display_name: deskForm.display_name ?? null,
        office_id: deskForm.office_id,
        department_id: deskForm.department_id,
        current_staff_id: deskForm.current_staff_id ?? null,
        status: deskForm.status ?? 'closed',
        is_active: deskForm.is_active !== false,
      };
      if (deskForm.id) {
        await api('PATCH', `/api/admin/desks/${deskForm.id}`, payload);
        await flash(t('Desk updated.'));
      } else {
        await api('POST', `/api/admin/desks`, payload);
        await flash(t('Desk created.'));
      }
      setDeskForm(null);
      await reload();
    } catch (e: any) {
      setError(e?.message ?? 'Save failed');
    } finally {
      setDeskSaving(false);
    }
  }

  async function deleteDesk(d: Desk) {
    if (!confirm(t('Delete desk "{name}"? This cannot be undone.', { name: d.name }))) return;
    setError(null);
    try {
      await api('DELETE', `/api/admin/desks/${d.id}`);
      await flash(t('Desk deleted.'));
      await reload();
    } catch (e: any) {
      setError(e?.message ?? 'Delete failed');
    }
  }

  async function doAssignDesk(allowOfficeChange: boolean) {
    if (!deskAssignFor) return;
    setDeskAssignBusy(true);
    setError(null);
    try {
      const staffId = deskAssignStaffId || null;
      try {
        await api('POST', `/api/admin/desks/${deskAssignFor.id}/assign`, {
          staff_id: staffId,
          allow_office_change: allowOfficeChange,
        });
      } catch (e: any) {
        if (e?.status === 409 && e?.details?.crossOffice) {
          const ok = confirm(t('This team member belongs to another office. Move them here?'));
          if (!ok) { setDeskAssignBusy(false); return; }
          await api('POST', `/api/admin/desks/${deskAssignFor.id}/assign`, {
            staff_id: staffId,
            allow_office_change: true,
          });
        } else {
          throw e;
        }
      }
      await flash(t('Desk assignment saved.'));
      setDeskAssignFor(null);
      setDeskAssignStaffId('');
      await reload();
    } catch (e: any) {
      setError(e?.message ?? 'Assign failed');
    } finally {
      setDeskAssignBusy(false);
    }
  }

  // ── Team (staff) ────────────────────────────────────────────────
  // Both add + edit live on the same staffForm. When `id` is present
  // we PATCH /api/admin/staff/:id; when absent we POST /api/create-staff
  // (server creates the auth user + staff row in one shot, same path
  // the legacy Team Access modal uses).
  const [staffForm, setStaffForm] = useState<Partial<StaffRow> | null>(null);
  const [staffSaving, setStaffSaving] = useState(false);
  // Add-only fields — collected when staffForm.id is undefined.
  const [staffNewEmail, setStaffNewEmail] = useState('');
  const [staffNewPassword, setStaffNewPassword] = useState('');
  // Service ↔ stylist matrix. Empty array = "can do every service"
  // fallback. Loaded on edit-open via GET /api/admin/staff/:id/services
  // and saved via POST after the staff PATCH succeeds. Surfaced only
  // for salon-style verticals — restaurants and clinics don't model
  // services per staff member.
  const [staffServiceIds, setStaffServiceIds] = useState<string[]>([]);
  // "Salon-style" detection. business_category is the canonical signal,
  // but many orgs were created before that field existed (or onboarding
  // skipped the category step). Fall through to detecting whether any
  // existing staff member already carries a salon-style role — if Marie
  // is tagged Stylist, this org IS a salon for the purposes of the
  // matrix UI / on-floor pill regardless of what settings says.
  const SALON_ROLES = new Set(['stylist', 'barber', 'therapist']);
  const isSalonOrgCategory = businessCategory === 'beauty'
    || businessCategory === 'salon'
    || businessCategory === 'barbershop'
    || businessCategory === 'spa'
    || staff.some((m) => SALON_ROLES.has((m.role ?? '').toLowerCase()));

  // Reset & hydrate the matrix whenever the form opens for a different
  // staff row. New staff (no id) start with empty selection; edits
  // fetch the current set from the API. The api() helper is mutation-
  // only, so we use cloudFetch directly here.
  useEffect(() => {
    setStaffServiceIds([]);
    if (!staffForm?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await cloudFetch(
          `${CLOUD_URL}/api/admin/staff/${staffForm.id}/services`,
          { method: 'GET' },
        );
        const data = await r.json().catch(() => ({}));
        if (!cancelled && r.ok && Array.isArray(data?.service_ids)) {
          setStaffServiceIds(data.service_ids);
        }
      } catch { /* keep empty default */ }
    })();
    return () => { cancelled = true; };
  }, [staffForm?.id]);

  async function saveStaff(e: React.FormEvent) {
    e.preventDefault();
    if (!staffForm || staffSaving) return;
    setStaffSaving(true);
    setError(null);
    try {
      let targetStaffId = staffForm.id;
      if (staffForm.id) {
        // Edit path — PATCH same endpoint we used before.
        const payload = {
          full_name: staffForm.full_name,
          role: staffForm.role,
          office_id: staffForm.office_id ?? null,
          department_id: staffForm.department_id ?? null,
          is_active: staffForm.is_active !== false,
        };
        await api('PATCH', `/api/admin/staff/${staffForm.id}`, payload);
        await flash(t('Team member updated.'));
      } else {
        // Add path — server creates auth user + staff row.
        const fullName = (staffForm.full_name ?? '').trim();
        const email = staffNewEmail.trim();
        if (!fullName) throw new Error(t('Full name is required'));
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          throw new Error(t('Please enter a valid email address.'));
        }
        if (!staffNewPassword || staffNewPassword.length < 6) {
          throw new Error(t('Password is required and must be at least 6 characters'));
        }
        const res = await cloudFetch(`${CLOUD_URL}/api/create-staff`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            password: staffNewPassword,
            full_name: fullName,
            role: staffForm.role ?? 'desk_operator',
            organization_id: organizationId,
            office_id: staffForm.office_id ?? undefined,
            department_id: staffForm.department_id ?? undefined,
            caller_user_id: callerUserId,
          }),
        });
        const body = await res.json().catch(() => ({} as any));
        if (!res.ok) {
          throw new Error(body?.error || `Request failed (${res.status})`);
        }
        // Capture the newly-created staff id so we can save the
        // service matrix in the same operator click. /api/create-staff
        // now returns staff_id; older deploys returned only success.
        if (typeof body?.staff_id === 'string') targetStaffId = body.staff_id;
        await flash(t('Team member added.'));
        setStaffNewEmail('');
        setStaffNewPassword('');
      }

      // Salon-only: persist the service ↔ stylist matrix. Skipped for
      // restaurants / clinics where this concept doesn't apply, AND
      // skipped on add when /api/create-staff didn't return a staff_id
      // (older deploy — operator can re-open the row to set it).
      if (isSalonOrgCategory && targetStaffId) {
        try {
          const r = await cloudFetch(
            `${CLOUD_URL}/api/admin/staff/${targetStaffId}/services`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ service_ids: staffServiceIds }),
            },
          );
          if (!r.ok) {
            const eb = await r.json().catch(() => ({}));
            console.warn('[business-admin] save matrix failed', eb?.error);
          }
        } catch (e: any) {
          console.warn('[business-admin] save matrix threw', e?.message);
        }
      }

      setStaffForm(null);
      await reload();
    } catch (e: any) {
      setError(e?.message ?? 'Save failed');
    } finally {
      setStaffSaving(false);
    }
  }

  // Quick on-floor toggle (salon flow). Cycles available → on_break →
  // off → available. The endpoint accepts an optional `until` ISO
  // timestamp for soft-expiry breaks; for V1 we don't ask the operator
  // for a duration — the next time they tap the pill it cycles forward.
  async function cycleAvailability(m: StaffRow) {
    const current = (m.availability_status ?? 'available') as 'available' | 'on_break' | 'off';
    const next: 'available' | 'on_break' | 'off' =
      current === 'available' ? 'on_break'
      : current === 'on_break' ? 'off'
      : 'available';
    setError(null);
    try {
      const r = await cloudFetch(`${CLOUD_URL}/api/admin/staff/${m.id}/availability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error || `Request failed (${r.status})`);
      await reload();
    } catch (e: any) {
      setError(e?.message ?? 'Update failed');
    }
  }

  async function deactivateStaff(m: StaffRow) {
    if (!confirm(t('Deactivate "{name}"? They will no longer be able to sign in.', { name: m.full_name }))) return;
    setError(null);
    try {
      await api('DELETE', `/api/admin/staff/${m.id}`);
      await flash(t('Team member deactivated.'));
      await reload();
    } catch (e: any) {
      setError(e?.message ?? 'Delete failed');
    }
  }

  // ── Render helpers ─────────────────────────────────────────────
  const officeName = (id: string | null | undefined) =>
    offices.find(o => o.id === id)?.name ?? '—';
  const deptName = (id: string | null | undefined) =>
    departments.find(d => d.id === id)?.name ?? '—';
  const staffName = (id: string | null | undefined) =>
    staff.find(s => s.id === id)?.full_name ?? '—';

  const deptsInOffice = (officeId: string | null | undefined) =>
    officeId ? departments.filter(d => d.office_id === officeId) : [];
  const staffInOffice = (officeId: string | null | undefined) =>
    officeId ? staff.filter(s => s.is_active !== false && (!s.office_id || s.office_id === officeId)) : staff.filter(s => s.is_active !== false);

  const inner = (
    <>
        {!embedded && (
          <div style={{
            padding: '18px 22px', borderBottom: '1px solid var(--border, #475569)',
            display: 'flex', alignItems: 'center', gap: 12,
            background: 'linear-gradient(180deg, rgba(100,116,139,0.10), transparent)',
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 style={{ margin: 0, fontSize: 18, color: 'var(--text)', fontWeight: 700 }}>
                🏢 {t('Business administration')}
              </h2>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text3)' }}>
                {t('Manage departments, services, desks, and the team for this business.')}
              </p>
            </div>
            <button onClick={onClose} style={{
              background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)',
              width: 32, height: 32, borderRadius: 8, fontSize: 18, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>×</button>
          </div>
        )}

        {!isAllowed ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text2, #94a3b8)' }}>
            {t('Only admins can manage business settings.')}
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border, #475569)', padding: '0 12px' }}>
              <button style={tabBtn(tab === 'departments')} onClick={() => setTab('departments')}>
                {t('Departments')} <span style={{ opacity: 0.6 }}>({departments.length})</span>
              </button>
              <button style={tabBtn(tab === 'services')} onClick={() => setTab('services')}>
                {t('Services')} <span style={{ opacity: 0.6 }}>({services.length})</span>
              </button>
              <button style={tabBtn(tab === 'desks')} onClick={() => setTab('desks')}>
                {t('Desks')} <span style={{ opacity: 0.6 }}>({desks.length})</span>
              </button>
              {(businessCategory === 'restaurant' || businessCategory === 'cafe') && (
                <button style={tabBtn(tab === 'tables')} onClick={() => setTab('tables')}>
                  🍽️ {t('Tables')}
                </button>
              )}
              <button style={tabBtn(tab === 'team')} onClick={() => setTab('team')}>
                {t('Team')} <span style={{ opacity: 0.6 }}>({staff.length})</span>
              </button>
              {/* Riders tab — only meaningful for businesses that
                  deliver. We surface it for restaurant + cafe (the
                  business types that have a delivery service today).
                  Same gating logic as the Tables tab. */}
              {(businessCategory === 'restaurant' || businessCategory === 'cafe') && (
                <button style={tabBtn(tab === 'riders')} onClick={() => setTab('riders')}>
                  🛵 {t('Drivers')}
                </button>
              )}
            </div>

            {/* Banner */}
            {error && (
              <div style={{
                margin: '12px 22px 0', padding: '10px 14px', borderRadius: 8,
                background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.35)',
                color: '#fca5a5', fontSize: 13,
              }}>{error}</div>
            )}
            {success && (
              <div style={{
                margin: '12px 22px 0', padding: '10px 14px', borderRadius: 8,
                background: 'rgba(16,185,129,0.10)', border: '1px solid rgba(16,185,129,0.35)',
                color: '#86efac', fontSize: 13,
              }}>{success}</div>
            )}

            {/* Body */}
            <div style={{ flex: 1, overflow: 'auto', padding: 22 }}>
              {loading ? (
                <p style={{ textAlign: 'center', color: 'var(--text2, #94a3b8)', padding: 40 }}>{t('Loading...')}</p>
              ) : (
                <>
                  {/* ── Departments ───────────────────────── */}
                  {tab === 'departments' && (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                        <button style={btnPrimary} onClick={() => setDeptForm({
                          name: '', code: '', description: '', office_id: resolveDefaultOfficeId(offices) ?? undefined, is_active: true, sort_order: null,
                        })}>
                          + {t('New department')}
                        </button>
                      </div>
                      <div style={{ border: '1px solid var(--border, #475569)', borderRadius: 10, overflow: 'hidden' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead style={{ background: 'rgba(100,116,139,0.12)' }}>
                            <tr>
                              <th style={thStyle}>{t('Name')}</th>
                              <th style={thStyle}>{t('Code')}</th>
                              <th style={thStyle}>{t('Location')}</th>
                              <th style={thStyle}>{t('Status')}</th>
                              <th style={{ ...thStyle, textAlign: 'right' }}>{t('Actions')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {departments.length === 0 && (
                              <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: 'var(--text2, #94a3b8)' }}>{t('No departments yet.')}</td></tr>
                            )}
                            {departments.map(d => (
                              <tr key={d.id} style={{ borderTop: '1px solid var(--border, #475569)' }}>
                                <td style={tdStyle}>
                                  <div style={{ fontWeight: 600 }}>{d.name}</div>
                                  {d.description && <div style={{ color: 'var(--text3, #64748b)', fontSize: 12 }}>{d.description}</div>}
                                </td>
                                <td style={tdStyle}>{d.code}</td>
                                <td style={tdStyle}>{officeName(d.office_id)}</td>
                                <td style={tdStyle}><span style={pill(d.is_active !== false)}>{d.is_active !== false ? t('Active') : t('Inactive')}</span></td>
                                <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                  <button style={{ ...btnGhost, marginInlineEnd: 6 }} onClick={() => setDeptForm(d)}>{t('Edit')}</button>
                                  <button style={btnDanger} onClick={() => deleteDept(d)}>{t('Delete')}</button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}

                  {/* ── Services ──────────────────────────── */}
                  {tab === 'services' && (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                        <button style={btnPrimary} onClick={() => setSvcForm({
                          name: '', code: '', description: '', department_id: departments[0]?.id,
                          estimated_service_time: null, priority: null, is_active: true, sort_order: null,
                        })}>
                          + {t('New service')}
                        </button>
                      </div>
                      <div style={{ border: '1px solid var(--border, #475569)', borderRadius: 10, overflow: 'hidden' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead style={{ background: 'rgba(100,116,139,0.12)' }}>
                            <tr>
                              <th style={thStyle}>{t('Name')}</th>
                              <th style={thStyle}>{t('Code')}</th>
                              <th style={thStyle}>{t('Department')}</th>
                              <th style={thStyle}>{t('Duration')}</th>
                              <th style={thStyle}>{t('Status')}</th>
                              <th style={{ ...thStyle, textAlign: 'right' }}>{t('Actions')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {services.length === 0 && (
                              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--text2, #94a3b8)' }}>{t('No services yet.')}</td></tr>
                            )}
                            {services.map(s => (
                              <tr key={s.id} style={{ borderTop: '1px solid var(--border, #475569)' }}>
                                <td style={tdStyle}>
                                  <div style={{ fontWeight: 600 }}>{s.name}</div>
                                  {s.description && <div style={{ color: 'var(--text3, #64748b)', fontSize: 12 }}>{s.description}</div>}
                                </td>
                                <td style={tdStyle}>{s.code}</td>
                                <td style={tdStyle}>{deptName(s.department_id)}</td>
                                <td style={tdStyle}>{s.estimated_service_time ? `${s.estimated_service_time} min` : '—'}</td>
                                <td style={tdStyle}><span style={pill(s.is_active !== false)}>{s.is_active !== false ? t('Active') : t('Inactive')}</span></td>
                                <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                  <button style={{ ...btnGhost, marginInlineEnd: 6 }} onClick={() => setSvcForm(s)}>{t('Edit')}</button>
                                  <button style={btnDanger} onClick={() => deleteSvc(s)}>{t('Delete')}</button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}

                  {/* ── Desks ─────────────────────────────── */}
                  {tab === 'desks' && (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                        <button style={btnPrimary} onClick={() => setDeskForm({
                          name: '', display_name: '',
                          office_id: resolveDefaultOfficeId(offices) ?? undefined,
                          department_id: undefined,
                          current_staff_id: null, status: 'closed', is_active: true,
                        })}>
                          + {t('New desk')}
                        </button>
                      </div>
                      <div style={{ border: '1px solid var(--border, #475569)', borderRadius: 10, overflow: 'hidden' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead style={{ background: 'rgba(100,116,139,0.12)' }}>
                            <tr>
                              <th style={thStyle}>{t('Name')}</th>
                              <th style={thStyle}>{t('Location')}</th>
                              <th style={thStyle}>{t('Department')}</th>
                              <th style={thStyle}>{t('Staff')}</th>
                              <th style={thStyle}>{t('Status')}</th>
                              <th style={{ ...thStyle, textAlign: 'right' }}>{t('Actions')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {desks.length === 0 && (
                              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--text2, #94a3b8)' }}>{t('No desks yet.')}</td></tr>
                            )}
                            {desks.map(d => (
                              <tr key={d.id} style={{ borderTop: '1px solid var(--border, #475569)' }}>
                                <td style={tdStyle}>
                                  <div style={{ fontWeight: 600 }}>{d.display_name || d.name}</div>
                                  {d.display_name && <div style={{ color: 'var(--text3, #64748b)', fontSize: 12 }}>{d.name}</div>}
                                </td>
                                <td style={tdStyle}>{officeName(d.office_id)}</td>
                                <td style={tdStyle}>{deptName(d.department_id)}</td>
                                <td style={tdStyle}>{d.current_staff_id ? staffName(d.current_staff_id) : '—'}</td>
                                <td style={tdStyle}><span style={pill(d.is_active !== false)}>{d.is_active !== false ? (d.status ?? t('Active')) : t('Inactive')}</span></td>
                                <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                  <button style={{ ...btnGhost, marginInlineEnd: 6 }}
                                    onClick={() => { setDeskAssignFor(d); setDeskAssignStaffId(d.current_staff_id ?? ''); }}>
                                    {t('Assign staff')}
                                  </button>
                                  <button style={{ ...btnGhost, marginInlineEnd: 6 }} onClick={() => setDeskForm(d)}>{t('Edit')}</button>
                                  <button style={btnDanger} onClick={() => deleteDesk(d)}>{t('Delete')}</button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}

                  {/* ── Tables (restaurants only) ─────────── */}
                  {tab === 'tables' && (
                    <TablesPanel
                      officeId={resolveDefaultOfficeId(offices)}
                      organizationId={organizationId}
                      locale={locale}
                      canManage={isAllowed}
                    />
                  )}

                  {/* ── Team ──────────────────────────────── */}
                  {tab === 'team' && (
                    <>
                      <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        gap: 12, marginBottom: 10,
                      }}>
                        <div style={{ fontSize: 12, color: 'var(--text3, #64748b)' }}>
                          {isSalonOrgCategory
                            ? t('Add stylists, receptionists, and admins here. Each new person gets a login automatically — and stylists show up in the booking + kiosk pickers.')
                            : t('Add, edit, or deactivate team members. New members get a login created automatically.')}
                        </div>
                        {isAllowed && (
                          <button
                            style={btnPrimary}
                            onClick={() => {
                              setStaffNewEmail('');
                              setStaffNewPassword('');
                              setStaffForm({
                                full_name: '',
                                role: 'desk_operator',
                                office_id: resolveDefaultOfficeId(offices) ?? null,
                                department_id: null,
                                is_active: true,
                              });
                            }}
                          >
                            + {t('New team member')}
                          </button>
                        )}
                      </div>
                      <div style={{ border: '1px solid var(--border, #475569)', borderRadius: 10, overflow: 'hidden' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead style={{ background: 'rgba(100,116,139,0.12)' }}>
                            <tr>
                              <th style={thStyle}>{t('Team member')}</th>
                              <th style={thStyle}>{t('Role')}</th>
                              <th style={thStyle}>{t('Location')}</th>
                              <th style={thStyle}>{t('Department')}</th>
                              <th style={thStyle}>{t('Status')}</th>
                              <th style={{ ...thStyle, textAlign: 'right' }}>{t('Actions')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {staff.length === 0 && (
                              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--text2, #94a3b8)' }}>{t('No team members yet.')}</td></tr>
                            )}
                            {staff.map(m => (
                              <tr key={m.id} style={{ borderTop: '1px solid var(--border, #475569)' }}>
                                <td style={tdStyle}>
                                  <div style={{ fontWeight: 600 }}>{m.full_name}</div>
                                  <div style={{ color: 'var(--text3, #64748b)', fontSize: 12 }}>{m.email}</div>
                                </td>
                                <td style={tdStyle}>{roleLabel(m.role, t)}</td>
                                <td style={tdStyle}>{m.office_id ? officeName(m.office_id) : t('All locations')}</td>
                                <td style={tdStyle}>{m.department_id ? deptName(m.department_id) : '—'}</td>
                                <td style={tdStyle}>
                                  {/* Two-pill stack: HR-level Active / Inactive on top, then
                                      the operational on-floor pill below for salon orgs.
                                      Click the on-floor pill to cycle available → on break →
                                      off → available. */}
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                                    <span style={pill(m.is_active !== false)}>
                                      {m.is_active !== false ? t('Active') : t('Inactive')}
                                    </span>
                                    {isSalonOrgCategory && m.is_active !== false && (() => {
                                      // Honour the soft expiry — a break that's past
                                      // due treats them as available.
                                      const stored = (m.availability_status ?? 'available') as
                                        'available' | 'on_break' | 'off';
                                      const expired = m.availability_until
                                        && Date.parse(m.availability_until) < Date.now();
                                      const effective: 'available' | 'on_break' | 'off' =
                                        stored !== 'available' && expired ? 'available' : stored;
                                      const label = effective === 'available' ? t('On floor')
                                        : effective === 'on_break' ? t('On break')
                                        : t('Off');
                                      const tint = effective === 'available' ? '#22c55e'
                                        : effective === 'on_break' ? '#f59e0b'
                                        : '#94a3b8';
                                      return (
                                        <button
                                          type="button"
                                          onClick={() => cycleAvailability(m)}
                                          title={t('Click to cycle: On floor → On break → Off')}
                                          style={{
                                            padding: '2px 8px', borderRadius: 999,
                                            fontSize: 10, fontWeight: 700, letterSpacing: 0.2,
                                            background: `${tint}1f`, color: tint,
                                            border: `1px solid ${tint}55`,
                                            cursor: 'pointer',
                                          }}
                                        >
                                          {label}
                                        </button>
                                      );
                                    })()}
                                  </div>
                                </td>
                                <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                  <button style={{ ...btnGhost, marginInlineEnd: 6 }} onClick={() => setStaffForm(m)}>{t('Edit')}</button>
                                  <button
                                    style={btnDanger}
                                    disabled={m.is_active === false || m.id === callerUserId}
                                    onClick={() => deactivateStaff(m)}
                                  >
                                    {t('Deactivate')}
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}

                  {/* ── Riders ─────────────────────────────── */}
                  {tab === 'riders' && (
                    <RidersPanel
                      organizationId={organizationId}
                      tl={t}
                      onError={setError}
                      onSuccess={setSuccess}
                    />
                  )}
                </>
              )}
            </div>
          </>
        )}

      {/* Department form modal */}
      {deptForm && (
        <div style={{ ...overlayStyle, zIndex: 1100 }} onClick={() => !deptSaving && setDeptForm(null)}>
          <form onSubmit={saveDept} onClick={e => e.stopPropagation()} style={{
            background: 'var(--surface, #1e293b)', borderRadius: 12,
            width: 520, maxWidth: '96vw', border: '1px solid var(--border, #475569)',
            padding: 22, display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
              {deptForm.id ? t('Edit department') : t('New department')}
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>{t('Name')}</label>
                <input required value={deptForm.name ?? ''} onChange={e => setDeptForm({ ...deptForm, name: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>{t('Code')}</label>
                <input required value={deptForm.code ?? ''} onChange={e => setDeptForm({ ...deptForm, code: e.target.value })} style={inputStyle} />
              </div>
            </div>
            <div>
              <label style={labelStyle}>{t('Description')}</label>
              <input value={deptForm.description ?? ''} onChange={e => setDeptForm({ ...deptForm, description: e.target.value })} style={inputStyle} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>{t('Location')}</label>
                <select required value={deptForm.office_id ?? ''} onChange={e => setDeptForm({ ...deptForm, office_id: e.target.value })} style={inputStyle as any}>
                  <option value="" disabled>{t('Select…')}</option>
                  {offices.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>{t('Sort order')}</label>
                <input type="number" value={deptForm.sort_order ?? ''} onChange={e => setDeptForm({ ...deptForm, sort_order: e.target.value ? Number(e.target.value) : null })} style={inputStyle} />
              </div>
            </div>
            <label style={{ display: 'inline-flex', gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={deptForm.is_active !== false} onChange={e => setDeptForm({ ...deptForm, is_active: e.target.checked })} />
              {t('Active')}
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" style={btnGhost} onClick={() => setDeptForm(null)} disabled={deptSaving}>{t('Cancel')}</button>
              <button type="submit" style={{ ...btnPrimary, opacity: deptSaving ? 0.6 : 1 }} disabled={deptSaving}>
                {deptSaving ? t('Saving...') : t('Save')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Service form modal */}
      {svcForm && (
        <div style={{ ...overlayStyle, zIndex: 1100 }} onClick={() => !svcSaving && setSvcForm(null)}>
          <form onSubmit={saveSvc} onClick={e => e.stopPropagation()} style={{
            background: 'var(--surface, #1e293b)', borderRadius: 12,
            width: 560, maxWidth: '96vw', border: '1px solid var(--border, #475569)',
            padding: 22, display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
              {svcForm.id ? t('Edit service') : t('New service')}
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>{t('Name')}</label>
                <input required value={svcForm.name ?? ''} onChange={e => setSvcForm({ ...svcForm, name: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>{t('Code')}</label>
                <input required value={svcForm.code ?? ''} onChange={e => setSvcForm({ ...svcForm, code: e.target.value })} style={inputStyle} />
              </div>
            </div>
            <div>
              <label style={labelStyle}>{t('Description')}</label>
              <input value={svcForm.description ?? ''} onChange={e => setSvcForm({ ...svcForm, description: e.target.value })} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>{t('Department')}</label>
              <select required value={svcForm.department_id ?? ''} onChange={e => setSvcForm({ ...svcForm, department_id: e.target.value })} style={inputStyle as any}>
                <option value="" disabled>{t('Select…')}</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name} — {officeName(d.office_id)}</option>)}
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>{t('Duration (min)')}</label>
                <input type="number" value={svcForm.estimated_service_time ?? ''} onChange={e => setSvcForm({ ...svcForm, estimated_service_time: e.target.value ? Number(e.target.value) : null })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>{t('Priority')}</label>
                <input type="number" value={svcForm.priority ?? ''} onChange={e => setSvcForm({ ...svcForm, priority: e.target.value ? Number(e.target.value) : null })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>{t('Sort order')}</label>
                <input type="number" value={svcForm.sort_order ?? ''} onChange={e => setSvcForm({ ...svcForm, sort_order: e.target.value ? Number(e.target.value) : null })} style={inputStyle} />
              </div>
            </div>
            <label style={{ display: 'inline-flex', gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={svcForm.is_active !== false} onChange={e => setSvcForm({ ...svcForm, is_active: e.target.checked })} />
              {t('Active')}
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" style={btnGhost} onClick={() => setSvcForm(null)} disabled={svcSaving}>{t('Cancel')}</button>
              <button type="submit" style={{ ...btnPrimary, opacity: svcSaving ? 0.6 : 1 }} disabled={svcSaving}>
                {svcSaving ? t('Saving...') : t('Save')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Desk form modal */}
      {deskForm && (
        <div style={{ ...overlayStyle, zIndex: 1100 }} onClick={() => !deskSaving && setDeskForm(null)}>
          <form onSubmit={saveDesk} onClick={e => e.stopPropagation()} style={{
            background: 'var(--surface, #1e293b)', borderRadius: 12,
            width: 560, maxWidth: '96vw', border: '1px solid var(--border, #475569)',
            padding: 22, display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
              {deskForm.id ? t('Edit desk') : t('New desk')}
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>{t('Name')}</label>
                <input required value={deskForm.name ?? ''} onChange={e => setDeskForm({ ...deskForm, name: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>{t('Display name')}</label>
                <input value={deskForm.display_name ?? ''} onChange={e => setDeskForm({ ...deskForm, display_name: e.target.value })} style={inputStyle} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>{t('Location')}</label>
                <select required value={deskForm.office_id ?? ''}
                  onChange={e => setDeskForm({ ...deskForm, office_id: e.target.value, department_id: undefined, current_staff_id: null })}
                  style={inputStyle as any}>
                  <option value="" disabled>{t('Select…')}</option>
                  {offices.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>{t('Department')}</label>
                <select required value={deskForm.department_id ?? ''} onChange={e => setDeskForm({ ...deskForm, department_id: e.target.value })} style={inputStyle as any}>
                  <option value="" disabled>{t('Select…')}</option>
                  {deptsInOffice(deskForm.office_id).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>{t('Assigned staff')}</label>
                <select value={deskForm.current_staff_id ?? ''} onChange={e => setDeskForm({ ...deskForm, current_staff_id: e.target.value || null })} style={inputStyle as any}>
                  <option value="">{t('None')}</option>
                  {staffInOffice(deskForm.office_id).map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>{t('Status')}</label>
                <select value={deskForm.status ?? 'closed'} onChange={e => setDeskForm({ ...deskForm, status: e.target.value })} style={inputStyle as any}>
                  <option value="closed">{t('Closed')}</option>
                  <option value="open">{t('Open')}</option>
                  <option value="paused">{t('Paused')}</option>
                </select>
              </div>
            </div>
            <label style={{ display: 'inline-flex', gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={deskForm.is_active !== false} onChange={e => setDeskForm({ ...deskForm, is_active: e.target.checked })} />
              {t('Active')}
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" style={btnGhost} onClick={() => setDeskForm(null)} disabled={deskSaving}>{t('Cancel')}</button>
              <button type="submit" style={{ ...btnPrimary, opacity: deskSaving ? 0.6 : 1 }} disabled={deskSaving}>
                {deskSaving ? t('Saving...') : t('Save')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Desk assign modal */}
      {deskAssignFor && (
        <div style={{ ...overlayStyle, zIndex: 1100 }} onClick={() => !deskAssignBusy && setDeskAssignFor(null)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'var(--surface, #1e293b)', borderRadius: 12,
            width: 460, maxWidth: '96vw', border: '1px solid var(--border, #475569)',
            padding: 22, display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
              {t('Assign staff to {name}', { name: deskAssignFor.display_name || deskAssignFor.name })}
            </h3>
            <div>
              <label style={labelStyle}>{t('Team member')}</label>
              <select value={deskAssignStaffId} onChange={e => setDeskAssignStaffId(e.target.value)} style={inputStyle as any}>
                <option value="">{t('Unassign (no one)')}</option>
                {staff.filter(s => s.is_active !== false).map(s => (
                  <option key={s.id} value={s.id}>
                    {s.full_name} {s.office_id && s.office_id !== deskAssignFor.office_id ? `(${officeName(s.office_id)})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" style={btnGhost} onClick={() => setDeskAssignFor(null)} disabled={deskAssignBusy}>{t('Cancel')}</button>
              <button type="button" style={{ ...btnPrimary, opacity: deskAssignBusy ? 0.6 : 1 }} disabled={deskAssignBusy} onClick={() => doAssignDesk(false)}>
                {deskAssignBusy ? t('Saving...') : t('Save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Staff edit modal */}
      {staffForm && (
        <div style={{ ...overlayStyle, zIndex: 1100 }} onClick={() => !staffSaving && setStaffForm(null)}>
          <form onSubmit={saveStaff} onClick={e => e.stopPropagation()} style={{
            background: 'var(--surface, #1e293b)', borderRadius: 12,
            width: 520, maxWidth: '96vw', border: '1px solid var(--border, #475569)',
            padding: 22, display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
              {staffForm.id ? t('Edit team member') : t('Add team member')}
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>{t('Full name')}</label>
                <input required value={staffForm.full_name ?? ''} onChange={e => setStaffForm({ ...staffForm, full_name: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>{t('Role')}</label>
                <select value={staffForm.role ?? ''} onChange={e => setStaffForm({ ...staffForm, role: e.target.value })} style={inputStyle as any}>
                  {(() => {
                    // Always-available roles. Stylist / Barber / Therapist
                    // are kept first so they show up regardless of the
                    // org's stored category — many existing orgs were
                    // created before business_category was set, and a
                    // salon owner shouldn't have to fix their settings
                    // before they can pick "Stylist" for a teammate.
                    const allRoles = [
                      'stylist', 'barber', 'therapist',
                      'admin', 'manager', 'branch_admin',
                      'receptionist', 'desk_operator',
                      'floor_manager', 'analyst', 'agent',
                    ];
                    return allRoles.map(r => (
                      <option key={r} value={r}>{roleLabel(r, t)}</option>
                    ));
                  })()}
                </select>
              </div>
            </div>
            {/* Email + password — only collected when creating. After
                creation the member can change them via /auth/update-
                password from the email reset link they get. */}
            {!staffForm.id && (
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelStyle}>{t('Email')}</label>
                  <input
                    type="email"
                    required
                    autoComplete="off"
                    value={staffNewEmail}
                    onChange={e => setStaffNewEmail(e.target.value)}
                    placeholder="name@business.com"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>{t('Password')}</label>
                  <input
                    type="password"
                    required
                    autoComplete="new-password"
                    value={staffNewPassword}
                    onChange={e => setStaffNewPassword(e.target.value)}
                    placeholder={t('Min 6 chars')}
                    minLength={6}
                    style={inputStyle}
                  />
                </div>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>{t('Location')}</label>
                <select value={staffForm.office_id ?? ''} onChange={e => setStaffForm({ ...staffForm, office_id: e.target.value || null, department_id: null })} style={inputStyle as any}>
                  <option value="">{t('All locations')}</option>
                  {offices.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>{t('Department')}</label>
                <select value={staffForm.department_id ?? ''} onChange={e => setStaffForm({ ...staffForm, department_id: e.target.value || null })} style={inputStyle as any}>
                  <option value="">{t('No department limit')}</option>
                  {(staffForm.office_id ? deptsInOffice(staffForm.office_id) : departments).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            </div>
            {/* Salon: services this stylist can perform. Empty list =
                "can do every service" fallback (matches the server-side
                semantic in /api/admin/staff/:id/services). Only shown for
                beauty / barber / spa categories — restaurants and
                clinics don't model services per staff. */}
            {isSalonOrgCategory && services.length > 0 && (
              <div>
                <label style={labelStyle}>{t('Services this person can do')}</label>
                <div style={{
                  display: 'flex', flexWrap: 'wrap', gap: 6,
                  padding: 8, borderRadius: 8,
                  background: 'var(--surface2, #0f172a)',
                  border: '1px solid var(--border, #475569)',
                }}>
                  {services.map((s) => {
                    const checked = staffServiceIds.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setStaffServiceIds((prev) => checked
                            ? prev.filter((x) => x !== s.id)
                            : [...prev, s.id]);
                        }}
                        style={{
                          padding: '4px 10px', borderRadius: 999,
                          fontSize: 12, fontWeight: 600,
                          border: `1px solid ${checked ? '#22c55e' : 'var(--border, #475569)'}`,
                          background: checked ? 'rgba(34,197,94,0.15)' : 'transparent',
                          color: checked ? '#86efac' : 'var(--text2, #94a3b8)',
                          cursor: 'pointer',
                        }}
                      >
                        {checked ? '✓ ' : ''}{s.name}
                      </button>
                    );
                  })}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text3, #64748b)', marginTop: 4 }}>
                  {staffServiceIds.length === 0
                    ? t('No selection — they can do every service.')
                    : t('Only the selected services will be offered when customers book this person.')}
                </div>
              </div>
            )}

            {staffForm.id && (
              <label style={{ display: 'inline-flex', gap: 8, fontSize: 13 }}>
                <input type="checkbox" checked={staffForm.is_active !== false} onChange={e => setStaffForm({ ...staffForm, is_active: e.target.checked })} />
                {t('Can sign in')}
              </label>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" style={btnGhost} onClick={() => setStaffForm(null)} disabled={staffSaving}>{t('Cancel')}</button>
              <button type="submit" style={{ ...btnPrimary, opacity: staffSaving ? 0.6 : 1 }} disabled={staffSaving}>
                {staffSaving ? t('Saving...') : t('Save')}
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
