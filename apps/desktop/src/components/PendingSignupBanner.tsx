/**
 * PendingSignupBanner — shown in the Station header area when there are
 * signup rows in the local pending_signups queue that haven't synced yet.
 *
 * Click → opens a small modal with details + "Retry now" button.
 * Polling is every 15s; it also refreshes after retry.
 */
import { useEffect, useRef, useState } from 'react';
import { t as translate, type DesktopLocale } from '../lib/i18n';

declare global {
  interface Window { qf: any; }
}

interface PendingSignup {
  id: string;
  payload: string;
  created_at: string;
  last_attempted_at: string | null;
  attempt_count: number;
  status: 'queued' | 'syncing' | 'synced' | 'failed';
  error_message: string | null;
  synced_org_id: string | null;
}

interface Props {
  locale: DesktopLocale;
}

export function PendingSignupBanner({ locale }: Props) {
  const t = (key: string) => translate(locale, key);

  const [pendingCount, setPendingCount] = useState(0);
  const [rows, setRows] = useState<PendingSignup[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = async () => {
    try {
      const count: number = await window.qf?.signup?.getPendingCount?.() ?? 0;
      setPendingCount(count);
    } catch {
      setPendingCount(0);
    }
  };

  const openModal = async () => {
    try {
      const r: PendingSignup[] = await window.qf?.signup?.getPending?.() ?? [];
      setRows(r);
    } catch {
      setRows([]);
    }
    setShowModal(true);
  };

  const retryNow = async () => {
    setRetrying(true);
    try {
      await window.qf?.signup?.retryNow?.();
      // Refresh after retry
      const r: PendingSignup[] = await window.qf?.signup?.getPending?.() ?? [];
      setRows(r);
      await refresh();
    } catch { /* non-fatal */ }
    setRetrying(false);
  };

  // Poll every 15 seconds
  useEffect(() => {
    void refresh();
    intervalRef.current = setInterval(() => { void refresh(); }, 15_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  if (pendingCount === 0) return null;

  const failedCount = rows.filter((r) => r.status === 'failed').length;

  return (
    <>
      {/* Inline badge — sits in the status-bar-center area (parent renders it in the right place) */}
      <span
        onClick={openModal}
        title={t('Offline setup pending sync — click for details')}
        style={{
          padding: '3px 10px',
          borderRadius: 6,
          fontSize: 11,
          fontWeight: 700,
          background: failedCount > 0
            ? 'rgba(239,68,68,0.15)'
            : 'rgba(245,158,11,0.15)',
          color: failedCount > 0 ? 'var(--danger)' : 'var(--warning)',
          cursor: 'pointer',
          animation: 'pulse 2s infinite',
        }}
      >
        {failedCount > 0
          ? `⚠ ${t('Setup sync failed')}`
          : `↻ ${t('Offline setup syncing...')}`}
      </span>

      {/* Modal overlay */}
      {showModal && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 9000,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('Pending signup sync')}
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: 24,
              width: 480,
              maxWidth: '90vw',
              maxHeight: '80vh',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
                {t('Pending sync — business setup')}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                style={{
                  background: 'none', border: 'none', color: 'var(--text)',
                  cursor: 'pointer', fontSize: 18, opacity: 0.6, lineHeight: 1,
                }}
                aria-label={t('Close')}
              >
                ×
              </button>
            </div>

            <p style={{ margin: 0, fontSize: 13, color: 'var(--text)', opacity: 0.8, lineHeight: 1.5 }}>
              {t('The following business setups are waiting for internet connectivity to complete registration in Qflo.')}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {rows.map((row) => {
                let parsedName = '';
                try { parsedName = (JSON.parse(row.payload) as any)?.businessName ?? ''; } catch {}

                return (
                  <div
                    key={row.id}
                    style={{
                      background: 'var(--surface2)',
                      borderRadius: 8,
                      padding: 12,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      border: `1px solid ${row.status === 'failed' ? 'rgba(239,68,68,0.4)' : 'var(--border)'}`,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                        {parsedName || row.id.slice(0, 8) + '…'}
                      </span>
                      <span
                        style={{
                          fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                          background: row.status === 'failed'
                            ? 'rgba(239,68,68,0.2)'
                            : row.status === 'syncing'
                              ? 'rgba(59,130,246,0.2)'
                              : 'rgba(245,158,11,0.2)',
                          color: row.status === 'failed'
                            ? 'var(--danger)'
                            : row.status === 'syncing'
                              ? 'var(--primary)'
                              : 'var(--warning)',
                        }}
                      >
                        {row.status === 'failed'
                          ? t('Failed')
                          : row.status === 'syncing'
                            ? t('Syncing...')
                            : t('Queued')}
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--text)', opacity: 0.6 }}>
                      <span>{t('Attempts')}: {row.attempt_count}</span>
                      {row.last_attempted_at && (
                        <span>{t('Last try')}: {new Date(row.last_attempted_at).toLocaleTimeString()}</span>
                      )}
                    </div>

                    {row.error_message && (
                      <div
                        style={{
                          fontSize: 11,
                          color: 'var(--danger)',
                          background: 'rgba(239,68,68,0.08)',
                          borderRadius: 4,
                          padding: '4px 8px',
                          fontFamily: 'monospace',
                        }}
                      >
                        {row.error_message}
                      </div>
                    )}
                  </div>
                );
              })}
              {rows.length === 0 && (
                <div style={{ fontSize: 13, color: 'var(--text)', opacity: 0.6, textAlign: 'center', padding: 12 }}>
                  {t('No pending items')}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button
                onClick={() => setShowModal(false)}
                style={{
                  padding: '8px 16px', borderRadius: 8,
                  border: '1px solid var(--border)', background: 'transparent',
                  color: 'var(--text)', cursor: 'pointer', fontSize: 13,
                }}
              >
                {t('Close')}
              </button>
              <button
                onClick={retryNow}
                disabled={retrying}
                style={{
                  padding: '8px 16px', borderRadius: 8, border: 'none',
                  background: 'var(--primary)', color: '#fff', cursor: 'pointer',
                  fontSize: 13, fontWeight: 700, opacity: retrying ? 0.7 : 1,
                }}
              >
                {retrying ? `${t('Retrying')}…` : t('Retry now')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
