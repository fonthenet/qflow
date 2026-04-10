import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase, ensureAuth } from '../lib/supabase';
import { t as translate, type DesktopLocale } from '../lib/i18n';

interface Appointment {
  id: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  scheduled_at: string;
  status: string;
  notes: string | null;
  wilaya: string | null;
  department_id: string | null;
  service_id: string | null;
  staff_id: string | null;
}

interface Props {
  organizationId: string;
  officeId: string;
  locale: DesktopLocale;
  storedAuth?: { access_token?: string; refresh_token?: string; email?: string; password?: string };
  departments?: Record<string, string>;
  services?: Record<string, string>;
  /** IANA timezone of the office (e.g. "Africa/Algiers"). All day grouping,
   *  range filtering, and time formatting must be done in this zone so the
   *  Station shows the same calendar day to the operator and the customer,
   *  regardless of where the Station machine itself is located. */
  officeTimezone?: string;
  onClose: () => void;
  onCheckIn?: (appt: { id: string; department_id: string | null; service_id: string | null; customer_name: string | null; customer_phone: string | null; scheduled_at: string }) => Promise<boolean>;
}

function formatPhoneDisplay(phone: string | null): string {
  if (!phone) return '';
  const digits = phone.replace(/[^\d+]/g, '');
  if (digits.startsWith('+213')) return '0' + digits.slice(4);
  if (digits.startsWith('213') && digits.length >= 12) return '0' + digits.slice(3);
  return phone;
}

// Returns "YYYY-MM-DD" for the given Date as observed in `tz`. Used as a
// stable, sortable group key so two appointments scheduled on the same
// calendar day in the office's timezone always group together.
function dayKeyInTz(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const y = parts.find(p => p.type === 'year')?.value ?? '0000';
  const m = parts.find(p => p.type === 'month')?.value ?? '01';
  const day = parts.find(p => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${day}`;
}

function formatDayLabel(iso: string, t: (k: string, v?: any) => string, tz: string, locale: DesktopLocale) {
  const now = new Date();
  const todayKey = dayKeyInTz(now, tz);
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowKey = dayKeyInTz(tomorrow, tz);
  const dKey = dayKeyInTz(new Date(iso), tz);
  if (dKey === todayKey) return t('Today');
  if (dKey === tomorrowKey) return t('Tomorrow');
  const tag = locale === 'ar' ? 'ar' : locale === 'en' ? 'en-US' : 'fr-FR';
  return new Intl.DateTimeFormat(tag, {
    weekday: 'short', day: '2-digit', month: 'short', timeZone: tz,
  }).format(new Date(iso));
}

function formatTime(iso: string, tz: string) {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz,
  }).format(new Date(iso));
}

// Returns the UTC instant corresponding to the given calendar date at 00:00
// in `tz`. Used to compute the start/end of "today" and "today + 7 days"
// windows in the office's local time, so the Station shows exactly the
// appointments the customer would see for "today" in their own timezone.
function startOfDayInTz(d: Date, tz: string): Date {
  const key = dayKeyInTz(d, tz); // "YYYY-MM-DD" in office tz
  // We need the UTC instant for "key 00:00 in tz". Use a probe and the
  // observed offset at that instant — DST-safe enough for one-day windows.
  const probe = new Date(`${key}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(probe);
  const get = (k: string) => Number(parts.find(p => p.type === k)?.value ?? '0');
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  const offsetMs = asUtc - probe.getTime();
  return new Date(probe.getTime() - offsetMs);
}

const STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b',
  confirmed: '#3b82f6',
  checked_in: '#8b5cf6',
  serving: '#06b6d4',
  completed: '#22c55e',
  cancelled: '#ef4444',
  no_show: '#64748b',
};

export function AppointmentsModal({ organizationId: _organizationId, officeId, locale, storedAuth, departments, services, officeTimezone, onClose, onCheckIn }: Props) {
  const tz = (officeTimezone && officeTimezone.trim()) || 'UTC';
  const t = (k: string, v?: Record<string, any>) => translate(locale, k, v);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<'today' | '7days'>('today');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  // Pending → confirmed/cancelled goes through the moderate-appointment route
  // so the customer is notified through their original chat channel and the
  // org-level approval rules are applied consistently. Other transitions
  // (checked_in, completed, staff cancel of an already-confirmed booking)
  // remain direct Supabase updates.
  const moderateAppointment = useCallback(async (id: string, action: 'approve' | 'decline') => {
    setBusyId(id);
    try {
      const token = await ensureAuth(storedAuth);
      const res = await fetch('https://qflo.net/api/moderate-appointment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ appointmentId: id, action }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      const nextStatus: string = json.status; // 'confirmed' | 'cancelled'
      setAppointments((prev) =>
        nextStatus === 'cancelled'
          ? prev.filter((a) => a.id !== id)
          : prev.map((a) => (a.id === id ? { ...a, status: nextStatus } : a))
      );
      // Surface notification status to the operator.
      if (json.notified) {
        setError(null);
      } else if (json.channel) {
        setError(action === 'approve'
          ? t('Appointment approved — customer not reachable on chat')
          : t('Appointment declined — customer not reachable on chat'));
      }
    } catch (e: any) {
      setError(e?.message || 'Moderation failed');
    } finally {
      setBusyId(null);
    }
  }, [t, storedAuth]);

  const updateStatus = useCallback(async (id: string, nextStatus: string) => {
    setBusyId(id);
    try {
      // On check-in: also create a waiting ticket in the local queue
      if (nextStatus === 'checked_in' && onCheckIn) {
        const appt = appointments.find((a) => a.id === id);
        if (appt) {
          const ok = await onCheckIn({
            id: appt.id,
            department_id: appt.department_id,
            service_id: appt.service_id,
            customer_name: appt.customer_name,
            customer_phone: appt.customer_phone,
            scheduled_at: appt.scheduled_at,
          });
          if (!ok) throw new Error('Check-in failed');
        }
      }

      // Cancel goes through the lifecycle API (handles ticket sync + notifications)
      if (nextStatus === 'cancelled') {
        const token = await ensureAuth(storedAuth);
        const res = await fetch('https://qflo.net/api/moderate-appointment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ appointmentId: id, action: 'cancel' }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
      } else {
        await ensureAuth(storedAuth);
        const sb = await getSupabase();
        const { error: uErr } = await sb.from('appointments').update({ status: nextStatus }).eq('id', id);
        if (uErr) throw uErr;
      }

      setAppointments((prev) =>
        nextStatus === 'cancelled'
          ? prev.filter((a) => a.id !== id)
          : prev.map((a) => (a.id === id ? { ...a, status: nextStatus } : a))
      );
    } catch (e: any) {
      setError(e?.message || 'Update failed');
    } finally {
      setBusyId(null);
    }
  }, [storedAuth, appointments, onCheckIn]);

  const deleteAppointment = useCallback(async (id: string) => {
    if (!confirm(t('Delete this appointment?'))) return;
    setBusyId(id);
    try {
      await ensureAuth(storedAuth);
      const sb = await getSupabase();
      const { error: dErr } = await sb.from('appointments').delete().eq('id', id);
      if (dErr) throw dErr;
      setAppointments((prev) => prev.filter((a) => a.id !== id));
    } catch (e: any) {
      setError(e?.message || 'Delete failed');
    } finally {
      setBusyId(null);
    }
  }, [storedAuth, t]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await ensureAuth(storedAuth);
      const sb = await getSupabase();

      // Anchor "today" to the OFFICE's local day, not the Station machine's
      // local day. Otherwise an operator running the Station from a different
      // timezone (e.g. dev in USA, business in Algeria) sees a different set
      // of appointments than what the customer sees on their phone.
      const start = startOfDayInTz(new Date(), tz);
      const end = new Date(start.getTime() + (range === 'today' ? 1 : 7) * 24 * 60 * 60 * 1000);

      const { data, error: qErr } = await sb
        .from('appointments')
        .select('id, customer_name, customer_phone, customer_email, scheduled_at, status, notes, wilaya, department_id, service_id, staff_id')
        .eq('office_id', officeId)
        .gte('scheduled_at', start.toISOString())
        .lt('scheduled_at', end.toISOString())
        .neq('status', 'cancelled')
        .order('scheduled_at', { ascending: true })
        .limit(500);

      if (qErr) throw qErr;
      setAppointments((data as Appointment[]) || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load appointments');
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  }, [officeId, range, storedAuth, tz]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return appointments;
    const digits = q.replace(/\D/g, '');
    return appointments.filter(a => {
      const name = (a.customer_name || '').toLowerCase();
      const phone = (a.customer_phone || '').replace(/\D/g, '');
      if (name.includes(q)) return true;
      if (digits && phone.includes(digits)) return true;
      return false;
    });
  }, [appointments, query]);

  // Detect overbooked slots: 2+ active appointments share the same scheduled_at.
  // After the partial unique index `uniq_appointments_active_slot` (DB migration
  // slot_integrity_unique_and_race_safe_capacity) this should not happen for new
  // bookings, but legacy duplicates may still exist.
  const overbookedIds = useMemo(() => {
    const counts = new Map<string, string[]>();
    for (const a of appointments) {
      if (a.status === 'cancelled' || a.status === 'no_show' || a.status === 'completed') continue;
      const key = a.scheduled_at;
      if (!counts.has(key)) counts.set(key, []);
      counts.get(key)!.push(a.id);
    }
    const flagged = new Set<string>();
    for (const [slot, ids] of counts.entries()) {
      if (ids.length > 1) {
        console.warn('[AppointmentsModal] overbooked slot detected', { scheduled_at: slot, appointment_ids: ids });
        ids.forEach((id) => flagged.add(id));
      }
    }
    return flagged;
  }, [appointments]);

  // Group by day in the OFFICE's timezone (not the Station machine's local
  // timezone) so the operator and the customer always see appointments under
  // the same day header.
  const grouped = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const a of filtered) {
      const key = dayKeyInTz(new Date(a.scheduled_at), tz);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, items]) => ({ key, sampleIso: items[0].scheduled_at, items }));
  }, [filtered, tz]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface, #1e293b)',
          border: '1px solid var(--border, #334155)',
          borderRadius: 16,
          width: '100%', maxWidth: 900, height: '85vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '18px 24px', borderBottom: '1px solid var(--border, #334155)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 24 }}>📅</span>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, color: 'var(--text, #f1f5f9)' }}>{t('Appointments')}</h2>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text3, #94a3b8)' }}>
                {loading ? t('Loading...') : t('{count} appointments', { count: filtered.length })}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none', color: 'var(--text3, #94a3b8)',
              fontSize: 22, cursor: 'pointer', padding: 4,
            }}
            aria-label={t('Close')}
          >
            ✕
          </button>
        </div>

        {/* Filters */}
        <div style={{
          padding: '14px 24px', borderBottom: '1px solid var(--border, #334155)',
          display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', gap: 4, background: 'var(--bg, #0f172a)', padding: 4, borderRadius: 10 }}>
            <button
              onClick={() => setRange('today')}
              style={{
                padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: range === 'today' ? '#3b82f6' : 'transparent',
                color: range === 'today' ? '#fff' : 'var(--text3, #94a3b8)',
                fontSize: 12, fontWeight: 600,
              }}
            >
              {t('Today')}
            </button>
            <button
              onClick={() => setRange('7days')}
              style={{
                padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: range === '7days' ? '#3b82f6' : 'transparent',
                color: range === '7days' ? '#fff' : 'var(--text3, #94a3b8)',
                fontSize: 12, fontWeight: 600,
              }}
            >
              {t('Next 7 days')}
            </button>
          </div>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Search name or phone')}
            style={{
              flex: 1, minWidth: 200, padding: '8px 12px', borderRadius: 8,
              border: '1px solid var(--border, #334155)',
              background: 'var(--bg, #0f172a)', color: 'var(--text, #f1f5f9)',
              fontSize: 13,
            }}
          />
          <button
            onClick={load}
            disabled={loading}
            style={{
              padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border, #334155)',
              background: 'var(--bg, #0f172a)', color: 'var(--text, #f1f5f9)',
              cursor: loading ? 'wait' : 'pointer', fontSize: 12, fontWeight: 600,
              display: 'inline-flex', alignItems: 'center', gap: 6,
              opacity: loading ? 0.75 : 1,
            }}
          >
            <span
              style={{
                display: 'inline-block',
                animation: loading ? 'qf-spin 0.8s linear infinite' : 'none',
              }}
            >⟳</span>
            {t('Refresh')}
            <style>{`@keyframes qf-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 24px 24px' }}>
          {error && (
            <div style={{ padding: 14, color: '#ef4444', fontSize: 13 }}>✗ {error}</div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3, #94a3b8)' }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>📭</div>
              <div>{t('No appointments')}</div>
            </div>
          )}
          {grouped.map((g) => (
            <div key={g.key} style={{ marginTop: 16 }}>
              <div style={{
                fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                color: 'var(--text3, #94a3b8)', letterSpacing: 0.6,
                padding: '6px 0', borderBottom: '1px solid var(--border, #334155)',
                marginBottom: 8,
              }}>
                {formatDayLabel(g.sampleIso, t, tz, locale)} · {g.items.length}
              </div>
              {g.items.map((a) => {
                const color = STATUS_COLORS[a.status] || '#64748b';
                const deptName = (a.department_id && departments?.[a.department_id]) || '';
                const svcName = (a.service_id && services?.[a.service_id]) || '';
                const busy = busyId === a.id;
                const isPending = a.status === 'pending';
                // Pending bookings need explicit approval/decline (and notify
                // the customer through the moderation route). Once confirmed,
                // the operator uses Check-in / Complete / Cancel as before.
                const canCheckIn = a.status === 'confirmed';
                const canComplete = a.status === 'checked_in' || a.status === 'serving' || a.status === 'confirmed';
                const canCancel = !isPending && a.status !== 'cancelled' && a.status !== 'completed';
                const isExpanded = expandedId === a.id;
                return (
                  <div
                    key={a.id}
                    onClick={() => setExpandedId(isExpanded ? null : a.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '12px 14px', marginBottom: 6,
                      background: 'var(--bg, #0f172a)',
                      border: '1px solid var(--border, #334155)',
                      borderLeft: `3px solid ${color}`,
                      borderRadius: 10,
                      opacity: busy ? 0.5 : 1,
                      transition: 'opacity 150ms',
                      cursor: 'pointer',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{
                      minWidth: 56, fontSize: 16, fontWeight: 700,
                      color: 'var(--text, #f1f5f9)', fontVariantNumeric: 'tabular-nums',
                    }}>
                      {formatTime(a.scheduled_at, tz)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text, #f1f5f9)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {a.customer_name || t('(no name)')}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text3, #94a3b8)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {a.customer_phone && <span>{formatPhoneDisplay(a.customer_phone)}</span>}
                        {a.wilaya && <span>· <span dir="auto" style={{ unicodeBidi: 'isolate' }}>📍 {a.wilaya}</span></span>}
                        {svcName && <span>· {svcName}</span>}
                        {deptName && <span>· {deptName}</span>}
                      </div>
                      {a.notes && (
                        <div style={{ fontSize: 11, color: 'var(--text3, #94a3b8)', marginTop: 2, fontStyle: 'italic' }}>
                          {a.notes}
                        </div>
                      )}
                    </div>
                    <span style={{
                      padding: '3px 10px', borderRadius: 12, fontSize: 10, fontWeight: 700,
                      textTransform: 'uppercase', letterSpacing: 0.4,
                      background: `${color}22`, color,
                      whiteSpace: 'nowrap',
                    }}>
                      {t(a.status)}
                    </span>
                    {overbookedIds.has(a.id) && (
                      <span
                        title={t('Multiple appointments share this time slot')}
                        style={{
                          padding: '3px 10px', borderRadius: 12, fontSize: 10, fontWeight: 700,
                          textTransform: 'uppercase', letterSpacing: 0.4,
                          background: '#ef444422', color: '#ef4444',
                          border: '1px solid #ef444466',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        ⚠ {t('Overbooked')}
                      </span>
                    )}
                    <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      {isPending && (
                        <>
                          <button
                            disabled={busy}
                            onClick={() => moderateAppointment(a.id, 'approve')}
                            title={t('Approve')}
                            style={{
                              padding: '6px 10px', borderRadius: 6, border: '1px solid #22c55e40',
                              background: '#22c55e22', color: '#22c55e', cursor: busy ? 'wait' : 'pointer',
                              fontSize: 11, fontWeight: 600,
                            }}
                          >
                            ✓ {t('Approve')}
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => {
                              if (!window.confirm(t('Decline this appointment? The customer will be notified.'))) return;
                              moderateAppointment(a.id, 'decline');
                            }}
                            title={t('Decline')}
                            style={{
                              padding: '6px 10px', borderRadius: 6, border: '1px solid #ef444440',
                              background: '#ef444422', color: '#ef4444', cursor: busy ? 'wait' : 'pointer',
                              fontSize: 11, fontWeight: 600,
                            }}
                          >
                            ✕ {t('Decline')}
                          </button>
                        </>
                      )}
                      {canCheckIn && (
                        <button
                          disabled={busy}
                          onClick={() => updateStatus(a.id, 'checked_in')}
                          title={t('Check in')}
                          style={{
                            padding: '6px 10px', borderRadius: 6, border: '1px solid #8b5cf640',
                            background: '#8b5cf622', color: '#8b5cf6', cursor: busy ? 'wait' : 'pointer',
                            fontSize: 11, fontWeight: 600,
                          }}
                        >
                          → {t('Check in')}
                        </button>
                      )}
                      {canComplete && (
                        <button
                          disabled={busy}
                          onClick={() => updateStatus(a.id, 'completed')}
                          title={t('Complete')}
                          style={{
                            padding: '6px 10px', borderRadius: 6, border: '1px solid #22c55e40',
                            background: '#22c55e22', color: '#22c55e', cursor: busy ? 'wait' : 'pointer',
                            fontSize: 11, fontWeight: 600,
                          }}
                        >
                          ✓ {t('Complete')}
                        </button>
                      )}
                      {canCancel && (
                        <button
                          disabled={busy}
                          onClick={() => updateStatus(a.id, 'cancelled')}
                          title={t('Cancel')}
                          style={{
                            padding: '6px 10px', borderRadius: 6, border: '1px solid #ef444440',
                            background: '#ef444422', color: '#ef4444', cursor: busy ? 'wait' : 'pointer',
                            fontSize: 11, fontWeight: 600,
                          }}
                        >
                          ✕
                        </button>
                      )}
                      <button
                        disabled={busy}
                        onClick={() => deleteAppointment(a.id)}
                        title={t('Delete')}
                        style={{
                          padding: '6px 10px', borderRadius: 6, border: '1px solid #64748b40',
                          background: 'transparent', color: '#64748b', cursor: busy ? 'wait' : 'pointer',
                          fontSize: 11, fontWeight: 600,
                        }}
                      >
                        🗑
                      </button>
                    </div>
                    {isExpanded && (
                      <div style={{
                        flexBasis: '100%', marginTop: 10, paddingTop: 10,
                        borderTop: '1px dashed var(--border, #334155)',
                        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px',
                        fontSize: 12, color: 'var(--text, #f1f5f9)',
                      }}>
                        <div><span style={{ color: 'var(--text3, #94a3b8)' }}>{t('Name')}: </span>{a.customer_name || '—'}</div>
                        <div><span style={{ color: 'var(--text3, #94a3b8)' }}>{t('Phone')}: </span>{formatPhoneDisplay(a.customer_phone) || '—'}</div>
                        {a.customer_email && <div><span style={{ color: 'var(--text3, #94a3b8)' }}>Email: </span>{a.customer_email}</div>}
                        <div><span style={{ color: 'var(--text3, #94a3b8)' }}>{t('Wilaya:')} </span><span dir="auto" style={{ unicodeBidi: 'isolate' }}>{a.wilaya || '—'}</span></div>
                        <div><span style={{ color: 'var(--text3, #94a3b8)' }}>{t('Service')}: </span>{svcName || '—'}</div>
                        <div><span style={{ color: 'var(--text3, #94a3b8)' }}>{t('Department')}: </span>{deptName || '—'}</div>
                        <div><span style={{ color: 'var(--text3, #94a3b8)' }}>{t('Status')}: </span>{t(a.status)}</div>
                        <div><span style={{ color: 'var(--text3, #94a3b8)' }}>{t('Scheduled')}: </span>{new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : locale === 'en' ? 'en-US' : 'fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: tz }).format(new Date(a.scheduled_at))}</div>
                        {a.notes && <div style={{ gridColumn: '1 / -1' }}><span style={{ color: 'var(--text3, #94a3b8)' }}>{t('Reason')}: </span>{a.notes}</div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
