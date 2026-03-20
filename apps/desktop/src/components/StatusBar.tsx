import { useState, useEffect } from 'react';
import type { StaffSession, SyncStatus } from '../lib/types';

declare global {
  interface Window { qf: any; }
}

interface PendingItem {
  id: string;
  operation: string;
  table_name: string;
  record_id: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
}

interface Props {
  session: StaffSession | null;
  syncStatus: SyncStatus;
  onLogout: () => void;
  staffStatus?: 'available' | 'on_break' | 'away';
  queuePaused?: boolean;
}

export function StatusBar({ session, syncStatus, onLogout, staffStatus, queuePaused }: Props) {
  const [showPanel, setShowPanel] = useState(false);
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);

  useEffect(() => {
    window.qf.org?.getBranding?.()
      .then((b: { orgName: string | null; logoUrl: string | null; brandColor: string | null }) => {
        if (b?.logoUrl) setLogoUrl(b.logoUrl);
        if (b?.orgName) setOrgName(b.orgName);
        // Apply org brand color as CSS variable for white-label
        if (b?.brandColor) {
          document.documentElement.style.setProperty('--primary', b.brandColor);
          document.documentElement.style.setProperty('--called', b.brandColor);
        }
      })
      .catch(() => {});
  }, []);

  const [retrying, setRetrying] = useState(false);

  const fetchPending = async () => {
    try {
      const items = await window.qf.sync.getPendingDetails();
      setPendingItems(items);
      return items;
    } catch {
      setPendingItems([]);
      return [];
    }
  };

  const openPanel = async () => {
    if (showPanel) { setShowPanel(false); return; }
    setLoading(true);
    await fetchPending();
    setLoading(false);
    setShowPanel(true);
  };

  const retryItem = async (id: string) => {
    try {
      await window.qf.sync.retryItem(id);
      await fetchPending();
    } catch { /* retry failed silently */ }
  };

  const discardItem = async (id: string) => {
    try {
      await window.qf.sync.discardItem(id);
      const items = await fetchPending();
      if (items.length === 0) setShowPanel(false);
    } catch { /* discard failed */ }
  };

  const discardAll = async () => {
    if (!confirm('Discard all pending sync items? This data will not be synced to the cloud.')) return;
    try {
      await window.qf.sync.discardAll();
      setPendingItems([]);
      setShowPanel(false);
    } catch { /* discard failed */ }
  };

  const forceSync = async () => {
    setRetrying(true);
    try {
      await window.qf.sync.forceSync();
      const items = await fetchPending();
      if (items.length === 0) setShowPanel(false);
    } catch { /* sync failed */ }
    setRetrying(false);
  };

  // Focus trap: keep Tab within the panel when open
  useEffect(() => {
    if (!showPanel) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowPanel(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [showPanel]);

  return (
    <>
      <div className="status-bar" role="banner" aria-label="Status bar">
        <div className="status-bar-left">
          {logoUrl ? (
            <img src={logoUrl} alt="Logo" style={{ height: 28, width: 'auto', objectFit: 'contain', borderRadius: 4 }} onError={() => setLogoUrl(null)} />
          ) : (
            <span className="app-logo">Q</span>
          )}
          <span className="app-name">{orgName ?? session?.office_name ?? 'Qflo Station'}</span>
          {orgName && session?.office_name && orgName !== session.office_name && (
            <span className="operator-role" style={{ marginLeft: 0 }}>{session.office_name}</span>
          )}
        </div>

        <div className="status-bar-center">
          <div className={`connection-badge ${syncStatus.isOnline ? 'online' : 'offline'}`} role="status" aria-live="polite" aria-label={syncStatus.isOnline ? 'Connected to cloud' : 'Offline mode'}>
            <span className="connection-dot" aria-hidden="true" />
            <span>{syncStatus.isOnline ? 'Connected' : 'Offline Mode'}</span>
          </div>
          {!syncStatus.isOnline && (
            <span style={{
              padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
              background: 'rgba(245,158,11,0.15)', color: '#f59e0b',
              animation: 'pulse 2s infinite',
            }}>
              No internet — running locally
            </span>
          )}
          {syncStatus.pendingCount > 0 && (
            <span
              className="pending-badge"
              onClick={openPanel}
              style={{ cursor: 'pointer', textDecoration: 'underline' }}
              title="Click to see details"
            >
              {syncStatus.pendingCount} pending sync
            </span>
          )}
        </div>

        <div className="status-bar-right">
          {session && (
            <>
              {staffStatus && staffStatus !== 'available' && (
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                  background: staffStatus === 'on_break' ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)',
                  color: staffStatus === 'on_break' ? '#f59e0b' : '#ef4444',
                }}>
                  {staffStatus === 'on_break' ? '☕ Break' : '🚫 Away'}
                </span>
              )}
              {queuePaused && staffStatus === 'available' && (
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                  background: 'rgba(100,116,139,0.15)', color: '#94a3b8',
                }}>
                  ⏸ Paused
                </span>
              )}
              <span className="operator-name">{session.full_name}</span>
              <span className="operator-role">{session.role}</span>
              {session.desk_name && (
                <span className="desk-badge">{session.desk_name}</span>
              )}
              <button className="btn-logout" onClick={onLogout} aria-label="Sign out of Qflo Station">Sign Out</button>
            </>
          )}
        </div>
      </div>

      {/* Sync details panel */}
      {showPanel && (
        <div
          role="dialog"
          aria-label="Pending sync items"
          aria-modal="true"
          style={{
            position: 'absolute', top: 48, left: '50%', transform: 'translateX(-50%)',
            width: 520, maxHeight: 400, background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.2)', zIndex: 1000,
            display: 'flex', flexDirection: 'column', overflow: 'hidden', outline: 'none',
          }}>
          {/* Header */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Pending Sync Items</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-sm btn-call" onClick={forceSync} disabled={retrying}>
                {retrying ? 'Syncing...' : 'Retry All'}
              </button>
              {pendingItems.length > 0 && (
                <button className="btn-sm" style={{ background: '#ef4444', color: 'white', border: 'none', padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }} onClick={discardAll}>
                  Discard All
                </button>
              )}
              <button className="btn-sm" style={{ background: 'var(--surface2)', color: 'var(--text2)', border: 'none', padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }} onClick={() => setShowPanel(false)}>
                Close
              </button>
            </div>
          </div>

          {/* Items */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 24, color: 'var(--text3)' }}>Loading...</div>
            ) : pendingItems.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 24, color: 'var(--text3)' }}>All synced!</div>
            ) : (
              pendingItems.map((item) => (
                <div key={item.id} style={{
                  padding: '10px 12px', borderRadius: 8, marginBottom: 4,
                  background: item.attempts >= 3 ? 'rgba(239,68,68,0.08)' : 'var(--surface2)',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      {item.operation} → {item.table_name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      ID: {item.record_id.substring(0, 12)}... · Attempts: {item.attempts}
                      {item.last_error && <span style={{ color: '#ef4444' }}> · {item.last_error}</span>}
                    </div>
                  </div>
                  <button
                    className="btn-sm"
                    style={{ background: 'var(--primary)', color: 'white', border: 'none', padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, cursor: 'pointer' }}
                    onClick={() => retryItem(item.id)}
                  >
                    Retry
                  </button>
                  <button
                    className="btn-sm"
                    style={{ background: 'transparent', color: '#ef4444', border: '1px solid #ef4444', padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, cursor: 'pointer' }}
                    onClick={() => discardItem(item.id)}
                  >
                    Discard
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}
