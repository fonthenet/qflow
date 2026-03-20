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
}

export function StatusBar({ session, syncStatus, onLogout }: Props) {
  const [showPanel, setShowPanel] = useState(false);
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);

  useEffect(() => {
    window.qf.org?.getBranding?.()
      .then((b: { orgName: string | null; logoUrl: string | null }) => {
        if (b?.logoUrl) setLogoUrl(b.logoUrl);
        if (b?.orgName) setOrgName(b.orgName);
      })
      .catch(() => {});
  }, []);

  const openPanel = async () => {
    if (showPanel) { setShowPanel(false); return; }
    setLoading(true);
    const items = await window.qf.sync.getPendingDetails();
    setPendingItems(items);
    setLoading(false);
    setShowPanel(true);
  };

  const retryItem = async (id: string) => {
    await window.qf.sync.retryItem(id);
    const items = await window.qf.sync.getPendingDetails();
    setPendingItems(items);
  };

  const discardItem = async (id: string) => {
    await window.qf.sync.discardItem(id);
    const items = await window.qf.sync.getPendingDetails();
    setPendingItems(items);
    if (items.length === 0) setShowPanel(false);
  };

  const discardAll = async () => {
    if (!confirm('Discard all pending sync items? This data will not be synced to the cloud.')) return;
    await window.qf.sync.discardAll();
    setPendingItems([]);
    setShowPanel(false);
  };

  const forceSync = async () => {
    await window.qf.sync.forceSync();
    const items = await window.qf.sync.getPendingDetails();
    setPendingItems(items);
    if (items.length === 0) setShowPanel(false);
  };

  return (
    <>
      <div className="status-bar" role="banner" aria-label="Status bar">
        <div className="status-bar-left">
          {logoUrl ? (
            <img src={logoUrl} alt="Logo" style={{ height: 28, width: 'auto', objectFit: 'contain', borderRadius: 4 }} />
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
          onKeyDown={(e) => { if (e.key === 'Escape') setShowPanel(false); }}
          tabIndex={-1}
          ref={(el) => el?.focus()}
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
              <button className="btn-sm btn-call" onClick={forceSync}>Retry All</button>
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
