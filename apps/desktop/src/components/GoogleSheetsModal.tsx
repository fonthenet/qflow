import { useCallback, useEffect, useState } from 'react';
import { useConfirmDialog } from './ConfirmDialog';
import { cloudFetch } from '../lib/cloud-fetch';

interface SheetFile { id: string; name: string; modifiedTime: string }
interface SheetInfo {
  id: string; name: string; url: string;
  lastPushedAt: string | null; rowCount: number; autoSync: boolean;
  lastError?: string | null; lastErrorAt?: string | null; lastSuccessAt?: string | null;
}
interface GStatus { connected: boolean; email: string | null; sheet: SheetInfo | null }

interface Props {
  open: boolean;
  onClose: () => void;
  resolveOrgId: () => Promise<string>;
  t: (key: string, values?: Record<string, any>) => string;
}

const API = 'https://qflo.net/api/google/sheets';

export function GoogleSheetsModal({ open, onClose, resolveOrgId, t }: Props) {
  const { confirm: styledConfirm } = useConfirmDialog();
  const [status, setStatus] = useState<GStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'main' | 'picker'>('main');
  const [files, setFiles] = useState<SheetFile[]>([]);
  const [pasteUrl, setPasteUrl] = useState('');
  const [newTitle, setNewTitle] = useState('Qflo Customers');
  const [pickerLoading, setPickerLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const orgId = await resolveOrgId();
      const res = await cloudFetch(`${API}/status?org=${encodeURIComponent(orgId)}`);
      if (res.ok) setStatus(await res.json());
    } catch (e: any) { setError(e?.message ?? String(e)); }
  }, [resolveOrgId]);

  useEffect(() => { if (open) { refresh(); setView('main'); setError(null); } }, [open, refresh]);

  async function connectGoogle() {
    try {
      setError(null);
      setConnecting(true);
      const orgId = await resolveOrgId();
      window.open(`https://qflo.net/api/google/oauth/start?org=${encodeURIComponent(orgId)}`, '_blank');
      // Poll for connection up to ~3 min
      let tries = 0;
      const id = window.setInterval(async () => {
        tries++;
        try {
          const s = await (await cloudFetch(`${API}/status?org=${encodeURIComponent(orgId)}`)).json();
          if (s.connected) {
            window.clearInterval(id);
            setStatus(s);
            setConnecting(false);
            return;
          }
        } catch { /* ignore transient errors */ }
        if (tries > 90) {
          window.clearInterval(id);
          setConnecting(false);
          setError(t('Connection timed out. Please try again.'));
        }
      }, 2000);
    } catch (e: any) { setError(e?.message ?? String(e)); setConnecting(false); }
  }

  async function disconnectGoogle() {
    if (!await styledConfirm(t('Disconnect Google account? Sync will stop.'), { variant: 'danger', confirmLabel: t('Disconnect') })) return;
    setBusy(true);
    try {
      const orgId = await resolveOrgId();
      await cloudFetch(`${API}/disconnect`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgId }),
      });
      await refresh();
    } finally { setBusy(false); }
  }

  async function loadFiles() {
    setPickerLoading(true);
    try {
      const orgId = await resolveOrgId();
      const res = await cloudFetch(`${API}/list?org=${encodeURIComponent(orgId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'List failed');
      setFiles(data.files || []);
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setPickerLoading(false); }
  }

  async function linkSheet(sheetIdOrUrl: string) {
    setBusy(true); setError(null);
    try {
      const orgId = await resolveOrgId();
      const res = await cloudFetch(`${API}/link`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgId, sheetIdOrUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Link failed');
      await refresh();
      setView('main');
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBusy(false); }
  }

  async function createNew() {
    setBusy(true); setError(null);
    try {
      const orgId = await resolveOrgId();
      const res = await cloudFetch(`${API}/create`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgId, title: newTitle || 'Qflo Customers' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Create failed');
      await refresh();
      setView('main');
      // Auto-push the first time
      await pushNow();
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBusy(false); }
  }

  async function pushNow() {
    setBusy(true); setError(null);
    try {
      const orgId = await resolveOrgId();
      const res = await cloudFetch(`${API}/push`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Push failed');
      await refresh();
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBusy(false); }
  }

  async function unlinkSheet() {
    if (!await styledConfirm(t('Unlink this sheet? Auto-sync will stop. Your Google account stays connected.'), { variant: 'danger', confirmLabel: t('Unlink') })) return;
    setBusy(true);
    try {
      const orgId = await resolveOrgId();
      await cloudFetch(`${API}/unlink`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgId }),
      });
      await refresh();
    } finally { setBusy(false); }
  }

  async function toggleAutoSync() {
    if (!status?.sheet) return;
    setBusy(true);
    try {
      const orgId = await resolveOrgId();
      const enabled = !status.sheet.autoSync;
      await cloudFetch(`${API}/auto-sync`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgId, enabled }),
      });
      await refresh();
    } finally { setBusy(false); }
  }

  if (!open) return null;

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 10000,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--bg, #ffffff)', borderRadius: 12, padding: 24, width: 560, maxWidth: '90vw',
        maxHeight: '85vh', overflow: 'auto', color: 'var(--text, #0f172a)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>📊 {t('Google Sheets sync')}</h2>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text2, #64748b)', fontSize: 24, cursor: 'pointer' }}>✕</button>
        </div>

        {error && (
          <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', color: '#fca5a5', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* Not connected */}
        {!status?.connected && (
          <div>
            <p style={{ color: 'var(--text2, #64748b)', fontSize: 14, lineHeight: 1.6, marginTop: 0 }}>
              {t('Connect a Google account to push your customer list to Google Sheets. The sheet stays in your Drive and updates automatically every 15 minutes.')}
            </p>
            <button
              onClick={connectGoogle}
              disabled={connecting}
              style={{
                background: connecting ? '#64748b' : '#fff',
                color: connecting ? '#fff' : '#3c4043',
                border: '1px solid ' + (connecting ? '#64748b' : '#dadce0'),
                padding: '12px 20px', borderRadius: 8, fontSize: 14, fontWeight: 600,
                cursor: connecting ? 'wait' : 'pointer', width: '100%',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                boxShadow: '0 1px 2px rgba(60,64,67,0.08)',
              }}
            >
              {connecting ? (
                <>
                  <span style={{ display: 'inline-block', width: 16, height: 16, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'qflo-spin 0.8s linear infinite' }} />
                  {t('Waiting for Google authorization…')}
                </>
              ) : (
                <>
                  <GoogleGlyph />
                  {t('Sign in with Google')}
                </>
              )}
            </button>
            {connecting && (
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text2, #64748b)', textAlign: 'center' }}>
                {t('A browser window should have opened. Complete the sign-in there.')}
              </div>
            )}
            <style>{`@keyframes qflo-spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* Connected, main view */}
        {status?.connected && view === 'main' && (
          <div>
            <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid #10b981', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13 }}>
              ✓ {t('Connected as')} <strong>{status.email}</strong>
              <button onClick={disconnectGoogle} disabled={busy} style={{
                background: 'transparent', border: 'none', color: '#94a3b8', fontSize: 12,
                cursor: 'pointer', float: 'right', textDecoration: 'underline',
              }}>{t('Disconnect account')}</button>
            </div>

            {!status.sheet ? (
              <div>
                <h3 style={{ fontSize: 14, marginBottom: 12 }}>{t('No sheet linked yet')}</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button onClick={() => { setView('picker'); loadFiles(); }} style={btnPrimary}>📋 {t('Pick from my Google Drive')}</button>
                  <button onClick={() => { setView('picker'); }} style={btnSecondary}>🆕 {t('Create new sheet')}</button>
                </div>
              </div>
            ) : (
              <div>
                <div style={{ background: 'var(--bg2, #f8fafc)', borderRadius: 8, padding: 14, marginBottom: 16 }}>
                  <div style={{ fontSize: 12, color: 'var(--text2, #64748b)', marginBottom: 4 }}>{t('Linked sheet')}</div>
                  <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{status.sheet.name}</div>
                  <a href={status.sheet.url} target="_blank" rel="noreferrer" style={{ color: '#3b82f6', fontSize: 12, textDecoration: 'none' }}>
                    {t('Open in Google Sheets')} ↗
                  </a>
                  <div style={{ fontSize: 12, color: 'var(--text2, #64748b)', marginTop: 10 }}>
                    {status.sheet.lastPushedAt
                      ? `${t('Last sync')}: ${new Date(status.sheet.lastPushedAt).toLocaleString()} · ${status.sheet.rowCount} ${t('rows')}`
                      : t('Never synced')}
                  </div>
                </div>

                {status.sheet.lastError && (
                  <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid #ef4444', color: '#b91c1c', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 12 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>⚠ {t('Last sync failed')}</div>
                    <div style={{ opacity: 0.8, marginBottom: 8, wordBreak: 'break-word' }}>{status.sheet.lastError}</div>
                    <button onClick={pushNow} disabled={busy} style={{
                      background: '#ef4444', color: '#fff', border: 'none',
                      padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    }}>{t('Retry now')}</button>
                  </div>
                )}

                <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, cursor: 'pointer', fontSize: 14 }}>
                  <input type="checkbox" checked={status.sheet.autoSync} onChange={toggleAutoSync} disabled={busy} />
                  {t('Auto-sync every 15 minutes')}
                </label>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={pushNow} disabled={busy} style={{ ...btnPrimary, flex: 1 }}>
                    {busy ? t('Syncing…') : `🔄 ${t('Sync now')}`}
                  </button>
                  <button onClick={() => { setView('picker'); loadFiles(); }} disabled={busy} style={btnSecondary}>
                    {t('Change sheet')}
                  </button>
                  <button onClick={unlinkSheet} disabled={busy} style={btnDanger}>
                    {t('Unlink')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Picker view */}
        {status?.connected && view === 'picker' && (
          <div>
            <button onClick={() => setView('main')} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 13, marginBottom: 12 }}>
              ← {t('Back')}
            </button>

            <h3 style={{ fontSize: 14, marginBottom: 8 }}>{t('Create a new sheet')}</h3>
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder={t('Sheet name')} style={inputStyle} />
              <button onClick={createNew} disabled={busy || !newTitle.trim()} style={btnPrimary}>{t('Create')}</button>
            </div>

            <h3 style={{ fontSize: 14, marginBottom: 8 }}>{t('Or paste a Google Sheets URL')}</h3>
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              <input value={pasteUrl} onChange={(e) => setPasteUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." style={inputStyle} />
              <button onClick={() => linkSheet(pasteUrl)} disabled={busy || !pasteUrl.trim()} style={btnPrimary}>{t('Link')}</button>
            </div>

            <h3 style={{ fontSize: 14, marginBottom: 8 }}>{t('Or pick from your recent sheets')}</h3>
            {pickerLoading && <div style={{ color: '#94a3b8', fontSize: 13 }}>{t('Loading…')}</div>}
            {!pickerLoading && files.length === 0 && <div style={{ color: '#94a3b8', fontSize: 13 }}>{t('No sheets found in your Drive')}</div>}
            <div style={{ maxHeight: 240, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {files.map((f) => (
                <button key={f.id} onClick={() => linkSheet(f.id)} disabled={busy} style={{
                  background: 'var(--bg2, #f8fafc)', border: '1px solid var(--border, #cbd5e1)',
                  color: 'var(--text, #0f172a)', padding: '10px 12px', borderRadius: 6,
                  textAlign: 'left', cursor: 'pointer', fontSize: 13,
                }}>
                  <div style={{ fontWeight: 600 }}>{f.name}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>{new Date(f.modifiedTime).toLocaleDateString()}</div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const btnPrimary: React.CSSProperties = {
  background: '#3b82f6', color: '#fff', border: 'none', padding: '10px 16px',
  borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
const btnSecondary: React.CSSProperties = {
  background: 'transparent', color: 'var(--text, #0f172a)', border: '1px solid var(--border, #cbd5e1)',
  padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
const btnDanger: React.CSSProperties = {
  background: 'transparent', color: '#ef4444', border: '1px solid #ef4444',
  padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
function GoogleGlyph() {
  // Google "G" logo, inline SVG (official brand colors).
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}

const inputStyle: React.CSSProperties = {
  flex: 1, background: '#ffffff', border: '1px solid var(--border, #cbd5e1)',
  color: 'var(--text, #0f172a)', padding: '10px 12px', borderRadius: 6, fontSize: 13,
};
