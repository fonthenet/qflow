import React, { useEffect, useState } from 'react';
import { cloudFetch } from '../lib/cloud-fetch';

const CLOUD_URL = 'https://qflo.net';

/**
 * RidersPanel — in-house delivery roster management.
 *
 * Lightweight CRUD UI for the riders table:
 *   - Add: name + WA phone
 *   - List with active/inactive status + WhatsApp 24-hour window
 *     indicator ("Open · 5 min ago" / "Closed · 28 hr ago")
 *   - Toggle active (soft-delete preserves historical assignments)
 *
 * Auth: pulls the staff JWT from the Electron preload bridge and
 * sends it as Authorization: Bearer to /api/riders. Same pattern
 * the rest of Station uses for cloud calls.
 */
export function RidersPanel({
  organizationId,
  tl,
  onError,
  onSuccess,
}: {
  organizationId: string;
  tl: (key: string) => string;
  onError: (msg: string | null) => void;
  onSuccess: (msg: string | null) => void;
}) {
  const [riders, setRiders] = useState<Array<{
    id: string; name: string; phone: string;
    is_active: boolean; last_seen_at: string | null;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftPhone, setDraftPhone] = useState('');

  const getJwt = async (): Promise<string> => {
    try {
      const result = await (window as any).qf?.auth?.getToken?.();
      if (result?.ok && typeof result.token === 'string') return result.token;
      if (typeof result === 'string') return result;
    } catch { /* ignore */ }
    return '';
  };

  const load = async () => {
    setLoading(true);
    try {
      const token = await getJwt();
      const res = await cloudFetch(
        `${CLOUD_URL}/api/riders?organization_id=${organizationId}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onError(data?.error ?? `Failed to load riders (${res.status})`);
        setRiders([]);
        return;
      }
      setRiders(data.riders ?? []);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [organizationId]);

  const addRider = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftName.trim() || !draftPhone.trim()) return;
    setSaving(true);
    onError(null);
    try {
      const token = await getJwt();
      const res = await cloudFetch(`${CLOUD_URL}/api/riders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: draftName.trim(),
          phone: draftPhone.trim(),
          organization_id: organizationId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        onError(data?.error ?? `Failed to add rider (${res.status})`);
        return;
      }
      onSuccess(tl('Rider added'));
      setDraftName(''); setDraftPhone('');
      await load();
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (id: string, isActive: boolean) => {
    onError(null);
    const token = await getJwt();
    const res = await cloudFetch(`${CLOUD_URL}/api/riders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ is_active: !isActive }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      onError(data?.error ?? `Failed to update rider (${res.status})`);
      return;
    }
    onSuccess(tl(isActive ? 'Rider deactivated' : 'Rider activated'));
    await load();
  };

  const formatRelativeTime = (iso: string | null): string => {
    if (!iso) return tl('Never');
    const ms = Date.now() - new Date(iso).getTime();
    const min = Math.round(ms / 60000);
    if (min < 1) return tl('just now');
    if (min < 60) return `${min} min ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr} hr ago`;
    return `${Math.round(hr / 24)} d ago`;
  };
  const isWindowOpen = (iso: string | null): boolean => {
    if (!iso) return false;
    return Date.now() - new Date(iso).getTime() < 24 * 60 * 60 * 1000;
  };

  const microKickerStyle: React.CSSProperties = {
    fontSize: 11, color: 'var(--text3, #64748b)',
    marginBottom: 4, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase',
  };
  const inputCssStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', borderRadius: 8,
    background: 'var(--surface, #1e293b)', color: 'var(--text)',
    border: '1px solid var(--border, #475569)',
    fontSize: 14, colorScheme: 'light dark' as any,
  };
  const thStyle: React.CSSProperties = {
    padding: '10px 12px', textAlign: 'start',
    fontSize: 11, fontWeight: 700, color: 'var(--text2, #94a3b8)',
    letterSpacing: 0.4, textTransform: 'uppercase',
  };

  return (
    <div>
      <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--text3, #64748b)', lineHeight: 1.5 }}>
        {tl('Add your in-house delivery riders. They will be notified via WhatsApp when you assign an order.')}
        {' '}
        {tl('The 24-hour WhatsApp window must be open — riders should message the bot at least once per shift (e.g. "CHECK Fix") for free notifications.')}
      </div>

      {/* Add form */}
      <form onSubmit={addRider} style={{
        display: 'flex', gap: 8, alignItems: 'flex-end',
        padding: 12, marginBottom: 16,
        background: 'rgba(100,116,139,0.08)', borderRadius: 10,
        border: '1px solid var(--border, #475569)',
      }}>
        <div style={{ flex: 1 }}>
          <div style={microKickerStyle}>{tl('Name')}</div>
          <input
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
            placeholder={tl('e.g. Mehdi')}
            required
            style={inputCssStyle}
          />
        </div>
        <div style={{ flex: 1 }}>
          <div style={microKickerStyle}>{tl('WhatsApp phone')}</div>
          <input
            value={draftPhone}
            onChange={e => setDraftPhone(e.target.value)}
            placeholder="0555 123 456"
            required
            style={{ ...inputCssStyle, fontFamily: 'ui-monospace, monospace', direction: 'ltr' }}
          />
          <div style={{ fontSize: 10, color: 'var(--text3, #64748b)', marginTop: 3 }}>
            {tl('Local number — country is taken from your business settings.')}
          </div>
        </div>
        <button
          type="submit"
          disabled={saving || !draftName.trim() || !draftPhone.trim()}
          style={{
            padding: '10px 18px', borderRadius: 8, border: 'none',
            background: 'var(--primary, #3b82f6)', color: '#fff',
            fontWeight: 700, fontSize: 14, cursor: 'pointer',
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? tl('Adding…') : `+ ${tl('Add rider')}`}
        </button>
      </form>

      {/* List */}
      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text2, #94a3b8)' }}>{tl('Loading…')}</div>
      ) : riders.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text2, #94a3b8)' }}>{tl('No riders yet — add one above.')}</div>
      ) : (
        <div style={{ border: '1px solid var(--border, #475569)', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ background: 'rgba(100,116,139,0.12)' }}>
              <tr>
                <th style={thStyle}>{tl('Name')}</th>
                <th style={thStyle}>{tl('Phone')}</th>
                <th style={thStyle}>{tl('WhatsApp window')}</th>
                <th style={thStyle}>{tl('Status')}</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>{tl('Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {riders.map(r => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--border, #475569)', opacity: r.is_active ? 1 : 0.55 }}>
                  <td style={{ padding: '10px 12px', fontSize: 14, color: 'var(--text)' }}>{r.name}</td>
                  <td style={{ padding: '10px 12px', fontSize: 13, color: 'var(--text2, #94a3b8)', fontFamily: 'ui-monospace, monospace', direction: 'ltr' }}>{r.phone}</td>
                  <td style={{ padding: '10px 12px', fontSize: 12 }}>
                    {r.last_seen_at ? (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600,
                        background: isWindowOpen(r.last_seen_at) ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.15)',
                        color: isWindowOpen(r.last_seen_at) ? '#22c55e' : '#f59e0b',
                        border: `1px solid ${isWindowOpen(r.last_seen_at) ? 'rgba(34,197,94,0.4)' : 'rgba(245,158,11,0.4)'}`,
                      }}>
                        {isWindowOpen(r.last_seen_at) ? tl('Open') : tl('Closed')} · {formatRelativeTime(r.last_seen_at)}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text3, #64748b)' }}>{tl('Never messaged')}</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 12 }}>
                    {r.is_active ? (
                      <span style={{ color: '#22c55e', fontWeight: 600 }}>● {tl('Active')}</span>
                    ) : (
                      <span style={{ color: 'var(--text3, #64748b)', fontWeight: 600 }}>○ {tl('Inactive')}</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    <button
                      onClick={() => toggleActive(r.id, r.is_active)}
                      style={{
                        padding: '5px 12px', borderRadius: 6,
                        background: 'transparent', color: r.is_active ? '#ef4444' : '#22c55e',
                        border: `1px solid ${r.is_active ? 'rgba(239,68,68,0.4)' : 'rgba(34,197,94,0.4)'}`,
                        fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      }}
                    >
                      {r.is_active ? tl('Deactivate') : tl('Activate')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
