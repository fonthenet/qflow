import { useCallback, useEffect, useState } from 'react';
import { useConfirmDialog } from './ConfirmDialog';

interface SheetFile { id: string; name: string; modifiedTime: string }
interface SheetInfo { id: string; name: string; url: string; lastPushedAt: string | null; rowCount: number; autoSync: boolean }
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

  const refresh = useCallback(async () => {
    try {
      const orgId = await resolveOrgId();
      const res = await fetch(`${API}/status?org=${encodeURIComponent(orgId)}`);
      if (res.ok) setStatus(await res.json());
    } catch (e: any) { setError(e?.message ?? String(e)); }
  }, [resolveOrgId]);

  useEffect(() => { if (open) { refresh(); setView('main'); setError(null); } }, [open, refresh]);

  async function connectGoogle() {
    try {
      setError(null);
      const orgId = await resolveOrgId();
      window.open(`https://qflo.net/api/google/oauth/start?org=${encodeURIComponent(orgId)}`, '_blank');
      // Poll for connection
      let tries = 0;
      const id = window.setInterval(async () => {
        tries++;
        await refresh();
        const s = await (await fetch(`${API}/status?org=${encodeURIComponent(orgId)}`)).json();
        if (s.connected || tries > 90) { window.clearInterval(id); setStatus(s); }
      }, 2000);
    } catch (e: any) { setError(e?.message ?? String(e)); }
  }

  async function disconnectGoogle() {
    if (!await styledConfirm(t('Disconnect Google account? Sync will stop.'), { variant: 'danger', confirmLabel: t('Disconnect') })) return;
    setBusy(true);
    try {
      const orgId = await resolveOrgId();
      await fetch(`${API}/disconnect`, {
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
      const res = await fetch(`${API}/list?org=${encodeURIComponent(orgId)}`);
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
      const res = await fetch(`${API}/link`, {
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
      const res = await fetch(`${API}/create`, {
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
      const res = await fetch(`${API}/push`, {
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
      await fetch(`${API}/unlink`, {
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
      await fetch(`${API}/auto-sync`, {
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
            <p style={{ color: 'var(--text2, #64748b)', fontSize: 14, lineHeight: 1.6 }}>
              {t('Connect a Google account to push your customer list to Google Sheets. The sheet stays in your Drive and updates automatically.')}
            </p>
            <button onClick={connectGoogle} style={{
              background: '#10b981', color: '#fff', border: 'none', padding: '12px 20px',
              borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', width: '100%',
            }}>📊 {t('Connect Google account')}</button>
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

                <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, cursor: 'pointer', fontSize: 14 }}>
                  <input type="checkbox" checked={status.sheet.autoSync} onChange={toggleAutoSync} disabled={busy} />
                  {t('Auto-sync every 5 minutes')}
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
const inputStyle: React.CSSProperties = {
  flex: 1, background: '#ffffff', border: '1px solid var(--border, #cbd5e1)',
  color: 'var(--text, #0f172a)', padding: '10px 12px', borderRadius: 6, fontSize: 13,
};
