import { useState, useEffect } from 'react';
import type { StaffSession, SyncStatus, UpdateStatus } from '../lib/types';
import { t as translate, type DesktopLocale } from '../lib/i18n';

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
  updateStatus: UpdateStatus;
  stationVersion: string | null;
  onLogout: () => void;
  staffStatus?: 'available' | 'on_break' | 'away';
  queuePaused?: boolean;
  locale: DesktopLocale;
}

export function StatusBar({ session, syncStatus, updateStatus, stationVersion, onLogout, staffStatus, queuePaused, locale }: Props) {
  const [showPanel, setShowPanel] = useState(false);
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [liveDeskName, setLiveDeskName] = useState<string | null>(null);
  const t = (key: string, values?: Record<string, string | number | null | undefined>) => translate(locale, key, values);

  useEffect(() => {
    if (!session) {
      setLogoUrl(null);
      setOrgName(null);
      setLiveDeskName(null);
      document.documentElement.style.removeProperty('--primary');
      document.documentElement.style.removeProperty('--called');
      return;
    }

    window.qf.org?.getBranding?.()
      .then((b: { orgName: string | null; logoUrl: string | null; brandColor: string | null }) => {
        setLogoUrl(b?.logoUrl ?? null);
        setOrgName(b?.orgName ?? null);
        // Apply org brand color as CSS variable for white-label
        if (b?.brandColor) {
          document.documentElement.style.setProperty('--primary', b.brandColor);
          document.documentElement.style.setProperty('--called', b.brandColor);
        } else {
          document.documentElement.style.removeProperty('--primary');
          document.documentElement.style.removeProperty('--called');
        }
      })
      .catch(() => {
        setLogoUrl(null);
        setOrgName(null);
        document.documentElement.style.removeProperty('--primary');
        document.documentElement.style.removeProperty('--called');
      });
  }, [session]);

  useEffect(() => {
    let cancelled = false;

    if (!session?.desk_id) {
      setLiveDeskName(null);
      return;
    }

    window.qf.db?.query?.('desks', session.office_ids ?? [session.office_id])
      .then((desks: Array<{ id?: string; name?: string }> | null | undefined) => {
        if (cancelled) return;
        const match = (desks ?? []).find((desk) => desk?.id === session.desk_id);
        setLiveDeskName(match?.name?.trim() || null);
      })
      .catch(() => {
        if (!cancelled) setLiveDeskName(null);
      });

    return () => {
      cancelled = true;
    };
  }, [session?.desk_id, session?.office_id, session?.office_ids]);

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
    if (!confirm(t('Discard all pending sync items? This data will not be synced to the cloud.'))) return;
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

  const handleCheckForUpdates = async () => {
    try {
      await window.qf.updater?.checkForUpdates?.();
    } catch {
      // handled by update status events
    }
  };

  const handleInstallUpdate = async () => {
    try {
      await window.qf.updater?.installUpdate?.();
    } catch {
      // handled by update status events
    }
  };

  const renderUpdateBadge = () => {
    if (!session) return null;

    if (updateStatus.status === 'idle') {
      return (
        <button className="update-badge neutral" onClick={handleCheckForUpdates}>
          {t('Check for Updates')}
        </button>
      );
    }

    if (updateStatus.status === 'downloaded') {
      return (
        <button className="update-badge ready" onClick={handleInstallUpdate} title={updateStatus.message ?? undefined}>
          {t('Restart to update')}
        </button>
      );
    }

    if (updateStatus.status === 'checking') {
      return (
        <span className="update-badge info" title={updateStatus.message ?? undefined}>
          {t('Checking for updates...')}
        </span>
      );
    }

    if (updateStatus.status === 'no_update') {
      return (
        <button className="update-badge neutral" onClick={handleCheckForUpdates} title={updateStatus.message ?? undefined}>
          {t('No updates available')}
        </button>
      );
    }

    if (updateStatus.status === 'available' || updateStatus.status === 'downloading') {
      return (
        <span className="update-badge info" title={updateStatus.message ?? undefined}>
          {updateStatus.progress !== null && updateStatus.progress > 0
            ? t('Downloading update ({progress}%)', { progress: updateStatus.progress })
            : t('A new version is downloading...')}
        </span>
      );
    }

    if (updateStatus.status === 'error') {
      return (
        <button className="update-badge error" onClick={handleCheckForUpdates} title={updateStatus.message ?? undefined}>
          {t('Update check failed')}
        </button>
      );
    }

    return null;
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
      <div className="status-bar" role="banner" aria-label={t('Status bar')}>
        <div className="status-bar-left">
          {logoUrl ? (
            <img src={logoUrl} alt="Logo" style={{ height: 28, width: 'auto', objectFit: 'contain', borderRadius: 4 }} onError={() => setLogoUrl(null)} />
          ) : (
            <span className="app-logo">Q</span>
          )}
          <span className="app-name">{orgName ?? session?.office_name ?? t('Qflo Station')}</span>
          {orgName && session?.office_name && orgName !== session.office_name && (
            <span className="operator-role" style={{ marginLeft: 0 }}>{session.office_name}</span>
          )}
        </div>

        <div className="status-bar-center">
          <div className={`connection-badge ${syncStatus.isOnline ? 'online' : 'offline'}`} role="status" aria-live="polite" aria-label={syncStatus.isOnline ? t('Connected to cloud') : t('Offline mode')}>
            <span className="connection-dot" aria-hidden="true" />
            <span>{syncStatus.isOnline ? t('Connected') : t('Offline Mode')}</span>
          </div>
          {syncStatus.connectionQuality === 'flaky' && (
            <span style={{
              padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
              background: 'rgba(239,68,68,0.15)', color: '#ef4444',
              animation: 'pulse 2s infinite',
            }}>
              {t('Slow connection')}
            </span>
          )}
          {stationVersion && (
            <span className="update-badge neutral" title={t('Station version')}>
              {t('Version')} {stationVersion}
            </span>
          )}
          {renderUpdateBadge()}
          {!syncStatus.isOnline && (
            <span style={{
              padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
              background: 'rgba(245,158,11,0.15)', color: '#f59e0b',
              animation: 'pulse 2s infinite',
            }}>
              {t('No internet - running locally')}
            </span>
          )}
          {syncStatus.pendingCount > 0 && (
            <span
              className="pending-badge"
              onClick={openPanel}
              style={{ cursor: 'pointer', textDecoration: 'underline' }}
              title={t('Click to copy')}
            >
              {t('{count} pending sync', { count: syncStatus.pendingCount })}
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
                  {staffStatus === 'on_break' ? `☕ ${t('Break')}` : `🚫 ${t('Away')}`}
                </span>
              )}
              {queuePaused && staffStatus === 'available' && (
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                  background: 'rgba(100,116,139,0.15)', color: '#94a3b8',
                }}>
                  ⏸ {t('Paused')}
                </span>
              )}
              <span className="operator-name">{session.full_name}</span>
              <span className="operator-role">{session.role}</span>
              {(liveDeskName ?? session.desk_name) && (
                <span className="desk-badge">{liveDeskName ?? session.desk_name}</span>
              )}
              <button className="btn-logout" onClick={onLogout} aria-label={t('Sign out of Qflo Station')}>{t('Sign Out')}</button>
            </>
          )}
        </div>
      </div>

      {/* Sync details panel */}
      {showPanel && (
        <div
          role="dialog"
          aria-label={t('Pending Sync Items')}
          aria-modal="true"
          style={{
            position: 'absolute', top: 48, left: '50%', transform: 'translateX(-50%)',
            width: 520, maxHeight: 400, background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.2)', zIndex: 1000,
            display: 'flex', flexDirection: 'column', overflow: 'hidden', outline: 'none',
          }}>
          {/* Header */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{t('Pending Sync Items')}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-sm btn-call" onClick={forceSync} disabled={retrying}>
                {retrying ? t('Syncing...') : t('Retry All')}
              </button>
              {pendingItems.length > 0 && (
                <button className="btn-sm" style={{ background: '#ef4444', color: 'white', border: 'none', padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }} onClick={discardAll}>
                  {t('Discard All')}
                </button>
              )}
              <button className="btn-sm" style={{ background: 'var(--surface2)', color: 'var(--text2)', border: 'none', padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }} onClick={() => setShowPanel(false)}>
                {t('Close')}
              </button>
            </div>
          </div>

          {/* Items */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 24, color: 'var(--text3)' }}>{t('Loading...')}</div>
            ) : pendingItems.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 24, color: 'var(--text3)' }}>{t('All synced!')}</div>
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
                      {t('ID: {id}... - Attempts: {attempts}', { id: item.record_id.substring(0, 12), attempts: item.attempts })}
                      {item.last_error && <span style={{ color: '#ef4444' }}> · {item.last_error}</span>}
                    </div>
                  </div>
                  <button
                    className="btn-sm"
                    style={{ background: 'var(--primary)', color: 'white', border: 'none', padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, cursor: 'pointer' }}
                    onClick={() => retryItem(item.id)}
                  >
                    {t('Retry')}
                  </button>
                  <button
                    className="btn-sm"
                    style={{ background: 'transparent', color: '#ef4444', border: '1px solid #ef4444', padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, cursor: 'pointer' }}
                    onClick={() => discardItem(item.id)}
                  >
                    {t('Discard')}
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
