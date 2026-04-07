import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSupabase, ensureAuth } from '../lib/supabase';
import { t as translate, type DesktopLocale } from '../lib/i18n';

interface Customer {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  visit_count: number;
  last_visit_at: string | null;
}

interface Props {
  organizationId: string;
  locale: DesktopLocale;
  storedAuth?: { access_token?: string; refresh_token?: string; email?: string; password?: string };
  onClose: () => void;
}

function initials(name: string | null, phone: string | null) {
  const src = (name && name.trim()) || (phone && phone.trim()) || '?';
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function avatarColor(seed: string) {
  const palette = ['#3b82f6', '#22c55e', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#ef4444', '#14b8a6'];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

/** Display Algerian numbers in local format (0XXXXXXXXX), keep others as-is */
function formatPhoneDisplay(phone: string | null): string {
  if (!phone) return '';
  const digits = phone.replace(/[^\d+]/g, '');
  // +213XXXXXXXXX or 213XXXXXXXXX → 0XXXXXXXXX
  if (digits.startsWith('+213')) return '0' + digits.slice(4);
  if (digits.startsWith('213') && digits.length >= 12) return '0' + digits.slice(3);
  return phone;
}

/** Normalize Algerian local input (0XXXXXXXXX) to international (+213XXXXXXXXX) for storage/sending */
function normalizePhoneForStorage(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  // Already international
  if (trimmed.startsWith('+')) return trimmed.replace(/\s+/g, '');
  const digits = trimmed.replace(/\D/g, '');
  // Algerian local format: 0XXXXXXXXX (10 digits starting with 0)
  if (digits.length === 10 && digits.startsWith('0')) return '+213' + digits.slice(1);
  // Algerian without leading 0: 9 digits (5/6/7XXXXXXXX)
  if (digits.length === 9 && /^[567]/.test(digits)) return '+213' + digits;
  // Already 213 prefix
  if (digits.startsWith('213')) return '+' + digits;
  // Fallback: prepend +
  return '+' + digits;
}

function timeAgo(iso: string | null, t: (k: string, v?: any) => string) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const day = 86400000;
  if (diff < day) return t('Today');
  const days = Math.floor(diff / day);
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

export function CustomersModal({ organizationId, locale, storedAuth, onClose }: Props) {
  const t = (k: string, v?: Record<string, any>) => translate(locale, k, v);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showCompose, setShowCompose] = useState(false);
  const [composeText, setComposeText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ sent: number; failed: number } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const orgIdRef = useRef<string>('');

  // Add customer form
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState('');
  const [addPhone, setAddPhone] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const resolveOrgId = useCallback(async (): Promise<string> => {
    if (orgIdRef.current) return orgIdRef.current;
    await ensureAuth(storedAuth);
    const sb = await getSupabase();
    let orgId = organizationId;
    if (!orgId || orgId === 'undefined') {
      const { data: userData } = await sb.auth.getUser();
      const authUserId = userData?.user?.id;
      if (!authUserId) throw new Error('Not authenticated');
      const { data: staffRow, error: staffErr } = await sb
        .from('staff')
        .select('organization_id')
        .eq('auth_user_id', authUserId)
        .single();
      if (staffErr) throw staffErr;
      orgId = (staffRow as any)?.organization_id ?? '';
      if (!orgId) throw new Error('Could not resolve organization');
    }
    orgIdRef.current = orgId;
    return orgId;
  }, [organizationId, storedAuth]);

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const orgId = await resolveOrgId();
      const sb = await getSupabase();
      const { data, error } = await sb
        .from('customers')
        .select('id, name, phone, email, visit_count, last_visit_at')
        .eq('organization_id', orgId)
        .order('last_visit_at', { ascending: false, nullsFirst: false })
        .limit(1000);
      if (error) setError(error.message);
      else setCustomers((data ?? []) as Customer[]);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [resolveOrgId]);

  async function handleAddCustomer() {
    setAddError(null);
    if (!addName.trim() || !addPhone.trim()) {
      setAddError(t('Name and phone are required'));
      return;
    }
    setAddBusy(true);
    try {
      const orgId = await resolveOrgId();
      const sb = await getSupabase();
      const { data: inserted, error: insErr } = await sb
        .from('customers')
        .insert({
          organization_id: orgId,
          name: addName.trim(),
          phone: normalizePhoneForStorage(addPhone),
          email: addEmail.trim() || null,
          visit_count: 0,
          source: 'station',
        } as any)
        .select('id, name, phone, email, visit_count, last_visit_at')
        .single();
      if (insErr) {
        if ((insErr as any).code === '23505') {
          setAddError(t('A customer with this phone already exists.'));
        } else {
          setAddError(insErr.message);
        }
        return;
      }
      // Optimistic prepend so it shows immediately, also reload to be safe
      if (inserted) setCustomers((prev) => [inserted as Customer, ...prev]);
      setAddName(''); setAddPhone(''); setAddEmail('');
      setShowAdd(false);
    } catch (e: any) {
      setAddError(e?.message ?? String(e));
    } finally {
      setAddBusy(false);
    }
  }

  const toggleOne = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAllVisible = (visibleIds: string[], allOn: boolean) => setSelected((prev) => {
    const next = new Set(prev);
    if (allOn) visibleIds.forEach((id) => next.delete(id));
    else visibleIds.forEach((id) => next.add(id));
    return next;
  });

  async function handleSend() {
    setSending(true);
    setSendError(null);
    setSendResult(null);
    try {
      const accessToken = await ensureAuth(storedAuth);
      if (!accessToken) throw new Error('Not authenticated');

      const res = await fetch('https://qflo.net/api/customer-broadcast', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          customerIds: Array.from(selected),
          message: composeText,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
      setSendResult({ sent: json.sent ?? 0, failed: json.failed ?? 0 });
    } catch (e: any) {
      setSendError(e?.message ?? String(e));
    } finally {
      setSending(false);
    }
  }

  useEffect(() => { loadCustomers(); }, [loadCustomers]);

  const filtered = useMemo(() => customers.filter((c) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (c.name?.toLowerCase().includes(q) ?? false) ||
      (c.phone?.includes(q) ?? false) ||
      (formatPhoneDisplay(c.phone).includes(q)) ||
      (c.email?.toLowerCase().includes(q) ?? false)
    );
  }), [customers, search]);

  const stats = useMemo(() => {
    const total = customers.length;
    const totalVisits = customers.reduce((acc, c) => acc + (c.visit_count || 0), 0);
    const since = Date.now() - 30 * 86400000;
    const active30 = customers.filter((c) => c.last_visit_at && new Date(c.last_visit_at).getTime() >= since).length;
    const repeat = customers.filter((c) => (c.visit_count || 0) >= 2).length;
    return { total, totalVisits, active30, repeat };
  }, [customers]);

  const card: React.CSSProperties = {
    flex: 1, background: 'var(--bg, #0f172a)', border: '1px solid var(--border, #475569)', borderRadius: 10,
    padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4,
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(4px)',
        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface, #1e293b)', borderRadius: 'var(--radius, 12px)', width: '100%', maxWidth: 920,
          maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
          border: '1px solid var(--border, #475569)', boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '18px 22px', borderBottom: '1px solid var(--border, #475569)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'linear-gradient(180deg, rgba(59,130,246,0.08), transparent)',
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, color: 'var(--text, #f1f5f9)', fontWeight: 700 }}>{t('Customers')}</h2>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text3, #64748b)' }}>
              {t('Showing {filtered} of {total} customers', { filtered: filtered.length, total: customers.length })}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: '1px solid var(--border, #475569)', color: 'var(--text2, #94a3b8)',
              width: 32, height: 32, borderRadius: 8, fontSize: 18, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >×</button>
        </div>

        {/* Stat cards */}
        <div style={{ padding: '14px 22px 0', display: 'flex', gap: 10 }}>
          <div style={card}>
            <span style={{ fontSize: 11, color: 'var(--text3, #64748b)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('Total')}</span>
            <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--text, #f1f5f9)' }}>{stats.total}</span>
          </div>
          <div style={card}>
            <span style={{ fontSize: 11, color: 'var(--text3, #64748b)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('Active (30d)')}</span>
            <span style={{ fontSize: 22, fontWeight: 700, color: '#22c55e' }}>{stats.active30}</span>
          </div>
          <div style={card}>
            <span style={{ fontSize: 11, color: 'var(--text3, #64748b)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('Repeat')}</span>
            <span style={{ fontSize: 22, fontWeight: 700, color: '#3b82f6' }}>{stats.repeat}</span>
          </div>
          <div style={card}>
            <span style={{ fontSize: 11, color: 'var(--text3, #64748b)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('Visits')}</span>
            <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--text, #f1f5f9)' }}>{stats.totalVisits}</span>
          </div>
        </div>

        {/* Toolbar: select-all + send */}
        <div style={{ padding: '12px 22px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
          {(() => {
            const visibleIds = filtered.map((c) => c.id);
            const allOn = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
            return (
              <button
                onClick={() => toggleAllVisible(visibleIds, allOn)}
                style={{
                  background: 'transparent', border: '1px solid var(--border, #475569)', color: 'var(--text2, #94a3b8)',
                  padding: '6px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                }}
              >{allOn ? t('Clear selection') : t('Select all visible')}</button>
            );
          })()}
          <span style={{ fontSize: 12, color: 'var(--text3, #64748b)' }}>
            {selected.size > 0 ? t('{n} selected', { n: selected.size }) : t('None selected — sends to all visible')}
          </span>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => { setShowAdd(true); setAddError(null); }}
            style={{
              background: 'var(--primary, #3b82f6)', color: '#fff', border: 'none',
              padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >+ {t('Add Customer')}</button>
          <button
            onClick={() => { setShowCompose(true); setSendResult(null); setSendError(null); }}
            disabled={filtered.length === 0}
            style={{
              background: 'var(--success, #22c55e)', color: '#fff', border: 'none',
              padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              cursor: filtered.length === 0 ? 'not-allowed' : 'pointer',
              opacity: filtered.length === 0 ? 0.5 : 1,
            }}
          >📨 {t('Send WhatsApp')}</button>
        </div>

        {/* Search */}
        <div style={{ padding: '14px 22px 10px' }}>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text3, #64748b)', fontSize: 14 }}>⌕</span>
            <input
              type="text"
              placeholder={t('Search by name, phone, or email...')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: '100%', padding: '10px 12px 10px 34px', borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border, #475569)', background: 'var(--bg, #0f172a)',
                color: 'var(--text, #f1f5f9)', fontSize: 14, outline: 'none',
              }}
            />
          </div>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 22px 16px' }}>
          {loading ? (
            <p style={{ textAlign: 'center', color: 'var(--text2, #94a3b8)', padding: 40 }}>{t('Loading...')}</p>
          ) : error ? (
            <p style={{ textAlign: 'center', color: 'var(--danger, #ef4444)', padding: 40 }}>{error}</p>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 48, color: 'var(--text3, #64748b)' }}>
              <div style={{ fontSize: 36, marginBottom: 8, opacity: 0.4 }}>👥</div>
              <p style={{ margin: 0 }}>{search ? t('No matches') : t('No customers found')}</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {filtered.map((c) => {
                const seed = c.id || c.phone || c.name || 'x';
                return (
                  <div
                    key={c.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '12px 14px', borderRadius: 10,
                      background: 'var(--bg, #0f172a)', border: '1px solid var(--border, #475569)',
                      transition: 'border-color 0.15s, transform 0.15s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--primary, #3b82f6)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border, #475569)'; }}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggleOne(c.id)}
                      style={{ width: 16, height: 16, accentColor: 'var(--primary, #3b82f6)', cursor: 'pointer' }}
                    />
                    <div style={{
                      width: 40, height: 40, borderRadius: 20, flexShrink: 0,
                      background: avatarColor(seed), color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, fontSize: 13,
                    }}>{initials(c.name, c.phone)}</div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text, #f1f5f9)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.name || t('Unknown')}
                        </span>
                        {(c.visit_count || 0) >= 2 && (
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 10,
                            background: 'rgba(59,130,246,0.15)', color: '#3b82f6', textTransform: 'uppercase',
                          }}>{t('Repeat')}</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 12, marginTop: 2, fontSize: 12, color: 'var(--text3, #64748b)' }}>
                        {c.phone && <span style={{ direction: 'ltr' }}>📱 {formatPhoneDisplay(c.phone)}</span>}
                        {c.email && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>✉ {c.email}</span>}
                      </div>
                    </div>

                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text, #f1f5f9)' }}>{c.visit_count || 0}</div>
                      <div style={{ fontSize: 10, color: 'var(--text3, #64748b)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('Visits')}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 48 }}>
                      <div style={{ fontSize: 12, color: 'var(--text2, #94a3b8)' }}>{timeAgo(c.last_visit_at, t)}</div>
                      <div style={{ fontSize: 10, color: 'var(--text3, #64748b)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('Last Visit')}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Add Customer modal */}
      {showAdd && (
        <div
          onClick={(e) => { e.stopPropagation(); if (!addBusy) setShowAdd(false); }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(4px)',
            zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--surface, #1e293b)', borderRadius: 'var(--radius, 12px)', width: '100%', maxWidth: 460,
              border: '1px solid var(--border, #475569)', boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}
          >
            <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border, #475569)' }}>
              <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text, #f1f5f9)', fontWeight: 700 }}>{t('Add Customer')}</h3>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text3, #64748b)' }}>
                {t('Saved to your organization and synced everywhere.')}
              </p>
            </div>
            <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { label: t('Name'), value: addName, set: setAddName, placeholder: 'John Doe', required: true },
                { label: t('Phone'), value: addPhone, set: setAddPhone, placeholder: '0551234567', required: true, ltr: true },
                { label: t('Email'), value: addEmail, set: setAddEmail, placeholder: 'john@example.com', required: false, ltr: true },
              ].map((f) => (
                <div key={f.label}>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text2, #94a3b8)', marginBottom: 4, fontWeight: 600 }}>
                    {f.label}{f.required ? ' *' : ''}
                  </label>
                  <input
                    type="text"
                    value={f.value}
                    onChange={(e) => f.set(e.target.value)}
                    placeholder={f.placeholder}
                    disabled={addBusy}
                    style={{
                      width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border, #475569)', background: 'var(--bg, #0f172a)',
                      color: 'var(--text, #f1f5f9)', fontSize: 14, outline: 'none',
                      direction: f.ltr ? 'ltr' : undefined,
                    }}
                  />
                </div>
              ))}
              {addError && (
                <div style={{
                  padding: 10, borderRadius: 8,
                  background: 'rgba(239,68,68,0.12)', color: 'var(--danger, #ef4444)', fontSize: 13,
                }}>{addError}</div>
              )}
            </div>
            <div style={{
              padding: '14px 22px', borderTop: '1px solid var(--border, #475569)',
              display: 'flex', gap: 10, justifyContent: 'flex-end',
            }}>
              <button
                onClick={() => { if (!addBusy) setShowAdd(false); }}
                disabled={addBusy}
                style={{
                  background: 'transparent', border: '1px solid var(--border, #475569)', color: 'var(--text2, #94a3b8)',
                  padding: '8px 16px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                }}
              >{t('Cancel')}</button>
              <button
                onClick={handleAddCustomer}
                disabled={addBusy || !addName.trim() || !addPhone.trim()}
                style={{
                  background: 'var(--primary, #3b82f6)', color: '#fff', border: 'none',
                  padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                  cursor: addBusy ? 'wait' : 'pointer',
                  opacity: addBusy || !addName.trim() || !addPhone.trim() ? 0.6 : 1,
                }}
              >{addBusy ? t('Saving...') : t('Save')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Compose modal */}
      {showCompose && (
        <div
          onClick={(e) => { e.stopPropagation(); if (!sending) setShowCompose(false); }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(4px)',
            zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--surface, #1e293b)', borderRadius: 'var(--radius, 12px)', width: '100%', maxWidth: 520,
              border: '1px solid var(--border, #475569)', boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}
          >
            <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border, #475569)' }}>
              <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text, #f1f5f9)', fontWeight: 700 }}>{t('Send WhatsApp')}</h3>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text3, #64748b)' }}>
                {selected.size > 0
                  ? t('Will send to {n} selected customers', { n: selected.size })
                  : t('Will send to {n} visible customers', { n: filtered.length })}
              </p>
            </div>
            <div style={{ padding: 22 }}>
              <textarea
                value={composeText}
                onChange={(e) => setComposeText(e.target.value)}
                placeholder={t('Hi {name}, ...')}
                rows={6}
                style={{
                  width: '100%', padding: 12, borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border, #475569)', background: 'var(--bg, #0f172a)',
                  color: 'var(--text, #f1f5f9)', fontSize: 14, fontFamily: 'inherit', resize: 'vertical', outline: 'none',
                }}
              />
              <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--text3, #64748b)' }}>
                {t('Use {name} to personalize with each customer\'s name.')}
              </p>
              {sendResult && (
                <div style={{
                  marginTop: 14, padding: 12, borderRadius: 8,
                  background: 'rgba(34,197,94,0.12)', color: '#22c55e', fontSize: 13,
                }}>
                  ✓ {t('Sent {sent}, failed {failed}', { sent: sendResult.sent, failed: sendResult.failed })}
                </div>
              )}
              {sendError && (
                <div style={{
                  marginTop: 14, padding: 12, borderRadius: 8,
                  background: 'rgba(239,68,68,0.12)', color: 'var(--danger, #ef4444)', fontSize: 13,
                }}>{sendError}</div>
              )}
            </div>
            <div style={{
              padding: '14px 22px', borderTop: '1px solid var(--border, #475569)',
              display: 'flex', gap: 10, justifyContent: 'flex-end',
            }}>
              <button
                onClick={() => { if (!sending) setShowCompose(false); }}
                disabled={sending}
                style={{
                  background: 'transparent', border: '1px solid var(--border, #475569)', color: 'var(--text2, #94a3b8)',
                  padding: '8px 16px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                }}
              >{sendResult ? t('Close') : t('Cancel')}</button>
              {!sendResult && (
                <button
                  onClick={() => {
                    if (!composeText.trim()) return;
                    if (selected.size === 0) {
                      // Auto-select all visible
                      setSelected(new Set(filtered.map((c) => c.id)));
                    }
                    handleSend();
                  }}
                  disabled={sending || !composeText.trim()}
                  style={{
                    background: 'var(--success, #22c55e)', color: '#fff', border: 'none',
                    padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                    cursor: sending ? 'wait' : 'pointer', opacity: sending || !composeText.trim() ? 0.6 : 1,
                  }}
                >{sending ? t('Sending...') : t('Send')}</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
