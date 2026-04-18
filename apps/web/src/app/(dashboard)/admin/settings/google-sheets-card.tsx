'use client';

import { useCallback, useEffect, useState } from 'react';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';

interface SheetFile { id: string; name: string; modifiedTime: string }
interface SheetInfo {
  id: string; name: string; url: string;
  lastPushedAt: string | null; rowCount: number; autoSync: boolean;
  lastError?: string | null; lastErrorAt?: string | null; lastSuccessAt?: string | null;
}
interface GStatus { connected: boolean; email: string | null; sheet: SheetInfo | null }

const API = '/api/google/sheets';

export function GoogleSheetsCard({ organizationId }: { organizationId: string }) {
  const { confirm: styledConfirm } = useConfirmDialog();
  const [status, setStatus] = useState<GStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [files, setFiles] = useState<SheetFile[]>([]);
  const [pasteUrl, setPasteUrl] = useState('');
  const [newTitle, setNewTitle] = useState('Qflo Customers');
  const [pickerLoading, setPickerLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API}/status?org=${encodeURIComponent(organizationId)}`);
      if (res.ok) setStatus(await res.json());
    } catch (e: any) { setError(e?.message ?? String(e)); }
  }, [organizationId]);

  useEffect(() => { refresh(); }, [refresh]);

  function connect() {
    setError(null);
    setConnecting(true);
    const win = window.open(`/api/google/oauth/start?org=${encodeURIComponent(organizationId)}`, '_blank', 'width=600,height=700');
    let tries = 0;
    const id = window.setInterval(async () => {
      tries++;
      try {
        const res = await fetch(`${API}/status?org=${encodeURIComponent(organizationId)}`);
        if (res.ok) {
          const s = await res.json();
          setStatus(s);
          if (s.connected) {
            window.clearInterval(id);
            setConnecting(false);
            return;
          }
        }
      } catch { /* ignore */ }
      if (tries > 90 || win?.closed) {
        window.clearInterval(id);
        setConnecting(false);
        if (tries > 90) setError('Connection timed out. Please try again.');
      }
    }, 2000);
  }

  async function disconnect() {
    if (!await styledConfirm('Disconnect Google account? Sync will stop.', { variant: 'danger', confirmLabel: 'Disconnect' })) return;
    setBusy(true);
    try {
      await fetch(`${API}/disconnect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId }) });
      await refresh();
    } finally { setBusy(false); }
  }

  async function loadFiles() {
    setPickerLoading(true);
    try {
      const res = await fetch(`${API}/list?org=${encodeURIComponent(organizationId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed');
      setFiles(data.files || []);
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setPickerLoading(false); }
  }

  async function linkSheet(sheetIdOrUrl: string) {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`${API}/link`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId, sheetIdOrUrl }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Link failed');
      await refresh();
      setShowPicker(false);
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBusy(false); }
  }

  async function createNew() {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`${API}/create`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId, title: newTitle || 'Qflo Customers' }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Create failed');
      await refresh();
      setShowPicker(false);
      await pushNow();
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBusy(false); }
  }

  async function pushNow() {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`${API}/push`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Push failed');
      await refresh();
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBusy(false); }
  }

  async function unlinkSheet() {
    if (!await styledConfirm('Unlink this sheet? Auto-sync will stop.', { variant: 'danger', confirmLabel: 'Unlink' })) return;
    setBusy(true);
    try {
      await fetch(`${API}/unlink`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId }) });
      await refresh();
    } finally { setBusy(false); }
  }

  async function toggleAutoSync() {
    if (!status?.sheet) return;
    setBusy(true);
    try {
      await fetch(`${API}/auto-sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId, enabled: !status.sheet.autoSync }) });
      await refresh();
    } finally { setBusy(false); }
  }

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-6">
      <h3 className="mb-4 text-lg font-semibold text-white flex items-center gap-2">
        📊 Google Sheets Sync
      </h3>

      {error && <div className="mb-4 rounded border border-red-500 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}

      {!status?.connected && (
        <div>
          <p className="mb-4 text-sm text-slate-400">
            Connect a Google account to push your customer list to Google Sheets. The sheet stays in your Drive and auto-syncs every 15 minutes.
          </p>
          <button
            onClick={connect}
            disabled={connecting}
            className="inline-flex w-full items-center justify-center gap-3 rounded-md border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-wait disabled:opacity-70"
          >
            {connecting ? (
              <>
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
                Waiting for Google authorization…
              </>
            ) : (
              <>
                <GoogleGlyph />
                Sign in with Google
              </>
            )}
          </button>
          {connecting && (
            <p className="mt-2 text-center text-xs text-slate-400">
              A popup should have opened. Complete the sign-in there.
            </p>
          )}
        </div>
      )}

      {status?.connected && (
        <div>
          <div className="mb-4 flex items-center justify-between rounded border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
            <span>✓ Connected as <strong>{status.email}</strong></span>
            <button onClick={disconnect} disabled={busy} className="text-xs text-slate-400 underline hover:text-slate-200">Disconnect</button>
          </div>

          {!status.sheet && !showPicker && (
            <div className="space-y-2">
              <p className="text-sm text-slate-400">No sheet linked yet.</p>
              <button onClick={() => { setShowPicker(true); loadFiles(); }} className="w-full rounded bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600">
                Pick or create a sheet
              </button>
            </div>
          )}

          {status.sheet && !showPicker && (
            <div>
              <div className="mb-4 rounded bg-slate-800 p-4">
                <div className="text-xs text-slate-400">Linked sheet</div>
                <div className="mt-1 text-base font-semibold text-white">{status.sheet.name}</div>
                <a href={status.sheet.url} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:underline">Open in Google Sheets ↗</a>
                <div className="mt-2 text-xs text-slate-400">
                  {status.sheet.lastPushedAt
                    ? `Last sync: ${new Date(status.sheet.lastPushedAt).toLocaleString()} · ${status.sheet.rowCount} rows`
                    : 'Never synced'}
                </div>
              </div>

              {status.sheet.lastError && (
                <div className="mb-4 rounded border border-red-500 bg-red-500/10 p-3 text-xs text-red-300">
                  <div className="mb-1 font-semibold">⚠ Last sync failed</div>
                  <div className="mb-2 break-words opacity-80">{status.sheet.lastError}</div>
                  <button onClick={pushNow} disabled={busy} className="rounded bg-red-500 px-3 py-1 text-xs font-semibold text-white hover:bg-red-600 disabled:opacity-50">
                    Retry now
                  </button>
                </div>
              )}

              <label className="mb-4 flex items-center gap-2 text-sm text-slate-200">
                <input type="checkbox" checked={status.sheet.autoSync} onChange={toggleAutoSync} disabled={busy} />
                Auto-sync every 15 minutes
              </label>

              <div className="flex flex-wrap gap-2">
                <button onClick={pushNow} disabled={busy} className="flex-1 rounded bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-50">
                  {busy ? 'Syncing…' : '🔄 Sync now'}
                </button>
                <button onClick={() => { setShowPicker(true); loadFiles(); }} disabled={busy} className="rounded border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800">Change sheet</button>
                <button onClick={unlinkSheet} disabled={busy} className="rounded border border-red-500 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10">Unlink</button>
              </div>
            </div>
          )}

          {showPicker && (
            <div>
              <button onClick={() => setShowPicker(false)} className="mb-3 text-xs text-slate-400 hover:underline">← Back</button>

              <div className="mb-5">
                <h4 className="mb-2 text-sm font-semibold text-white">Create a new sheet</h4>
                <div className="flex gap-2">
                  <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} className="flex-1 rounded border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white" placeholder="Sheet name" />
                  <button onClick={createNew} disabled={busy || !newTitle.trim()} className="rounded bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-50">Create</button>
                </div>
              </div>

              <div className="mb-5">
                <h4 className="mb-2 text-sm font-semibold text-white">Or paste a Google Sheets URL</h4>
                <div className="flex gap-2">
                  <input value={pasteUrl} onChange={(e) => setPasteUrl(e.target.value)} className="flex-1 rounded border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white" placeholder="https://docs.google.com/spreadsheets/d/..." />
                  <button onClick={() => linkSheet(pasteUrl)} disabled={busy || !pasteUrl.trim()} className="rounded bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-50">Link</button>
                </div>
              </div>

              <div>
                <h4 className="mb-2 text-sm font-semibold text-white">Or pick from your recent sheets</h4>
                {pickerLoading && <div className="text-xs text-slate-400">Loading…</div>}
                {!pickerLoading && files.length === 0 && <div className="text-xs text-slate-400">No sheets found in your Drive</div>}
                <div className="max-h-60 space-y-2 overflow-auto">
                  {files.map((f) => (
                    <button key={f.id} onClick={() => linkSheet(f.id)} disabled={busy} className="block w-full rounded border border-slate-700 bg-slate-800 p-3 text-left text-sm hover:border-blue-500">
                      <div className="font-semibold text-white">{f.name}</div>
                      <div className="text-xs text-slate-400">{new Date(f.modifiedTime).toLocaleDateString()}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}
