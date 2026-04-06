import { useEffect, useState } from 'react';
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
        const { data, error } = await sb
          .from('customers')
          .select('id, name, phone, email, visit_count, last_visit_at')
          .eq('organization_id', organizationId)
          .order('last_visit_at', { ascending: false, nullsFirst: false })
          .limit(500);
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

  const filtered = customers.filter((c) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (c.name?.toLowerCase().includes(q) ?? false) ||
      (c.phone?.includes(q) ?? false) ||
      (c.email?.toLowerCase().includes(q) ?? false)
    );
  });

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg2, #1a1d29)', borderRadius: 12, width: '100%', maxWidth: 800,
          maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
          border: '1px solid var(--border, #2a2e3d)',
        }}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border, #2a2e3d)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{t('Customers')}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text2, #aaa)', fontSize: 24, cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border, #2a2e3d)' }}>
          <input
            type="text"
            placeholder={t('Search by name, phone, or email...')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%', padding: '8px 12px', borderRadius: 6,
              border: '1px solid var(--border, #2a2e3d)', background: 'var(--bg, #14161f)',
              color: 'var(--text, #fff)', fontSize: 14,
            }}
          />
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px' }}>
          {loading ? (
            <p style={{ textAlign: 'center', color: 'var(--text2, #aaa)', padding: 32 }}>{t('Loading...')}</p>
          ) : error ? (
            <p style={{ textAlign: 'center', color: '#f87171', padding: 32 }}>{error}</p>
          ) : filtered.length === 0 ? (
            <p style={{ textAlign: 'center', color: 'var(--text2, #aaa)', padding: 32 }}>
              {search ? t('No matches') : t('No customers found')}
            </p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ position: 'sticky', top: 0, background: 'var(--bg2, #1a1d29)' }}>
                  <th style={{ textAlign: 'left', padding: '10px 8px', color: 'var(--text2, #aaa)', fontWeight: 500, fontSize: 11, textTransform: 'uppercase' }}>{t('Name')}</th>
                  <th style={{ textAlign: 'left', padding: '10px 8px', color: 'var(--text2, #aaa)', fontWeight: 500, fontSize: 11, textTransform: 'uppercase' }}>{t('Phone')}</th>
                  <th style={{ textAlign: 'left', padding: '10px 8px', color: 'var(--text2, #aaa)', fontWeight: 500, fontSize: 11, textTransform: 'uppercase' }}>{t('Email')}</th>
                  <th style={{ textAlign: 'center', padding: '10px 8px', color: 'var(--text2, #aaa)', fontWeight: 500, fontSize: 11, textTransform: 'uppercase' }}>{t('Visits')}</th>
                  <th style={{ textAlign: 'right', padding: '10px 8px', color: 'var(--text2, #aaa)', fontWeight: 500, fontSize: 11, textTransform: 'uppercase' }}>{t('Last Visit')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} style={{ borderTop: '1px solid var(--border, #2a2e3d)' }}>
                    <td style={{ padding: '8px' }}>{c.name || '—'}</td>
                    <td style={{ padding: '8px', direction: 'ltr' }}>{c.phone || '—'}</td>
                    <td style={{ padding: '8px' }}>{c.email || '—'}</td>
                    <td style={{ padding: '8px', textAlign: 'center' }}>{c.visit_count}</td>
                    <td style={{ padding: '8px', textAlign: 'right', color: 'var(--text2, #aaa)' }}>
                      {c.last_visit_at ? new Date(c.last_visit_at).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border, #2a2e3d)', fontSize: 12, color: 'var(--text2, #aaa)' }}>
          {t('Showing {filtered} of {total} customers', { filtered: filtered.length, total: customers.length })}
        </div>
      </div>
    </div>
  );
}
