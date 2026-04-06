import { useEffect, useMemo, useState } from 'react';
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
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
          orgId = staffRow?.organization_id ?? '';
          if (!orgId) throw new Error('Could not resolve organization');
        }
        const { data, error } = await sb
          .from('customers')
          .select('id, name, phone, email, visit_count, last_visit_at')
          .eq('organization_id', orgId)
          .order('last_visit_at', { ascending: false, nullsFirst: false })
          .limit(1000);
        if (cancelled) return;
        if (error) setError(error.message);
        else setCustomers((data ?? []) as Customer[]);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [organizationId, storedAuth]);

  const filtered = useMemo(() => customers.filter((c) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (c.name?.toLowerCase().includes(q) ?? false) ||
      (c.phone?.includes(q) ?? false) ||
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
    flex: 1, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10,
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
          background: 'var(--surface)', borderRadius: 'var(--radius)', width: '100%', maxWidth: 920,
          maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
          border: '1px solid var(--border)', boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '18px 22px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'linear-gradient(180deg, rgba(59,130,246,0.08), transparent)',
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, color: 'var(--text)', fontWeight: 700 }}>{t('Customers')}</h2>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text3)' }}>
              {t('Showing {filtered} of {total} customers', { filtered: filtered.length, total: customers.length })}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)',
              width: 32, height: 32, borderRadius: 8, fontSize: 18, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >×</button>
        </div>

        {/* Stat cards */}
        <div style={{ padding: '14px 22px 0', display: 'flex', gap: 10 }}>
          <div style={card}>
            <span style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('Total')}</span>
            <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>{stats.total}</span>
          </div>
          <div style={card}>
            <span style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('Active (30d)')}</span>
            <span style={{ fontSize: 22, fontWeight: 700, color: '#22c55e' }}>{stats.active30}</span>
          </div>
          <div style={card}>
            <span style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('Repeat')}</span>
            <span style={{ fontSize: 22, fontWeight: 700, color: '#3b82f6' }}>{stats.repeat}</span>
          </div>
          <div style={card}>
            <span style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('Visits')}</span>
            <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>{stats.totalVisits}</span>
          </div>
        </div>

        {/* Search */}
        <div style={{ padding: '14px 22px 10px' }}>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text3)', fontSize: 14 }}>⌕</span>
            <input
              type="text"
              placeholder={t('Search by name, phone, or email...')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: '100%', padding: '10px 12px 10px 34px', borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)', background: 'var(--bg)',
                color: 'var(--text)', fontSize: 14, outline: 'none',
              }}
            />
          </div>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 22px 16px' }}>
          {loading ? (
            <p style={{ textAlign: 'center', color: 'var(--text2)', padding: 40 }}>{t('Loading...')}</p>
          ) : error ? (
            <p style={{ textAlign: 'center', color: 'var(--danger)', padding: 40 }}>{error}</p>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 48, color: 'var(--text3)' }}>
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
                      background: 'var(--bg)', border: '1px solid var(--border)',
                      transition: 'border-color 0.15s, transform 0.15s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--primary)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
                  >
                    <div style={{
                      width: 40, height: 40, borderRadius: 20, flexShrink: 0,
                      background: avatarColor(seed), color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, fontSize: 13,
                    }}>{initials(c.name, c.phone)}</div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.name || t('Unknown')}
                        </span>
                        {(c.visit_count || 0) >= 2 && (
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 10,
                            background: 'rgba(59,130,246,0.15)', color: '#3b82f6', textTransform: 'uppercase',
                          }}>{t('Repeat')}</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 12, marginTop: 2, fontSize: 12, color: 'var(--text3)' }}>
                        {c.phone && <span style={{ direction: 'ltr' }}>📱 {c.phone}</span>}
                        {c.email && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>✉ {c.email}</span>}
                      </div>
                    </div>

                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{c.visit_count || 0}</div>
                      <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('Visits')}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 48 }}>
                      <div style={{ fontSize: 12, color: 'var(--text2)' }}>{timeAgo(c.last_visit_at, t)}</div>
                      <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('Last Visit')}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
