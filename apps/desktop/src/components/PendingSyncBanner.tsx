/**
 * PendingSyncBanner — shown when there are post-signup offline operations
 * queued in pending_sync_ops that have not yet been pushed to the cloud.
 *
 * Displays a compact badge in the status bar. Clicking opens a detail
 * modal with per-entity breakdown and a "Retry now" button.
 *
 * Polls every 20s. Also refreshes immediately after "Retry now".
 */
import { useEffect, useRef, useState } from 'react';
import { t as translate, type DesktopLocale } from '../lib/i18n';

declare global {
  interface Window { qf: any; }
}

type EntityType = 'ticket' | 'appointment' | 'customer' | 'order' | 'payment';

interface Breakdown {
  ticket: number;
  appointment: number;
  customer: number;
  order: number;
  payment: number;
}

interface PendingOp {
  id: string;
  entity_type: EntityType;
  operation: string;
  local_id: string | null;
  remote_id: string | null;
  created_at: number;
  attempts: number;
  last_error: string | null;
  next_retry_at: number | null;
}

interface Props {
  locale: DesktopLocale;
}

const ENTITY_LABELS: Record<EntityType, string> = {
  ticket:      'Tickets',
  appointment: 'Appointments',
  customer:    'Customers',
  order:       'Orders',
  payment:     'Payments',
};

export function PendingSyncBanner({ locale }: Props) {
  const t = (key: string) => translate(locale, key);

  const [pendingCount, setPendingCount] = useState(0);
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const [rows, setRows] = useState<PendingOp[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = async () => {
    try {
      const count: number = await window.qf?.syncOps?.getPendingCount?.() ?? 0;
      setPendingCount(count);
      if (count > 0) {
        const bd = await window.qf?.syncOps?.getBreakdown?.();
        if (bd) setBreakdown(bd);
      }
    } catch {
      setPendingCount(0);
    }
  };

  const openModal = async () => {
    try {
      const r: PendingOp[] = await window.qf?.syncOps?.getPendingRows?.() ?? [];
      setRows(r);
    } catch {
      setRows([]);
    }
    setShowModal(true);
  };

  const retryNow = async () => {
    setRetrying(true);
    try {
      await window.qf?.syncOps?.retryNow?.();
      const r: PendingOp[] = await window.qf?.syncOps?.getPendingRows?.() ?? [];
      setRows(r);
      await refresh();
    } catch { /* non-fatal */ }
    setRetrying(false);
  };

  useEffect(() => {
    void refresh();
    intervalRef.current = setInterval(() => { void refresh(); }, 20_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  if (pendingCount === 0) return null;

  const failedCount = rows.filter((r) => r.last_error !== null && r.next_retry_at === null).length;

  return (
    <>
      <span
        onClick={openModal}
        title={t('Offline — operations queued for sync — click for details')}
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
          userSelect: 'none',
        }}
      >
        {failedCount > 0
          ? `${t('Sync failed')} (${pendingCount})`
          : `${t('Offline')} — ${pendingCount} ${t('pending')}`}
      </span>

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
            aria-label={t('Pending sync operations')}
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: 24,
              width: 520,
              maxWidth: '92vw',
              maxHeight: '82vh',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              colorScheme: 'light dark',
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
                {t('Offline — pending sync')} ({pendingCount})
              </h2>
              <button
                onClick={() => setShowModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', fontSize: 18, opacity: 0.6, lineHeight: 1 }}
                aria-label={t('Close')}
              >
                ×
              </button>
            </div>

            <p style={{ margin: 0, fontSize: 13, color: 'var(--text)', opacity: 0.8, lineHeight: 1.5 }}>
              {t('These operations were performed while offline and will be synced when connectivity is restored. Data is safely stored locally.')}
            </p>

            {/* Per-entity breakdown */}
            {breakdown && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(Object.entries(breakdown) as [EntityType, number][])
                  .filter(([, n]) => n > 0)
                  .map(([entity, n]) => (
                    <span
                      key={entity}
                      style={{
                        padding: '4px 10px',
                        borderRadius: 20,
                        fontSize: 12,
                        fontWeight: 600,
                        background: 'var(--surface2)',
                        color: 'var(--text)',
                        border: '1px solid var(--border)',
                      }}
                    >
                      {t(ENTITY_LABELS[entity])}: {n}
                    </span>
                  ))}
              </div>
            )}

            {/* Row list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '40vh', overflowY: 'auto' }}>
              {rows.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--text)', opacity: 0.6, textAlign: 'center', padding: 16 }}>
                  {t('No pending items')}
                </div>
              ) : rows.map((row) => {
                const isFailed = row.last_error !== null && row.next_retry_at === null;
                const isRetrying = row.next_retry_at !== null;
                return (
                  <div
                    key={row.id}
                    style={{
                      background: 'var(--surface2)',
                      borderRadius: 8,
                      padding: '10px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      border: `1px solid ${isFailed ? 'rgba(239,68,68,0.4)' : 'var(--border)'}`,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
                        {t(ENTITY_LABELS[row.entity_type])} — {row.operation}
                      </span>
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                        background: isFailed ? 'rgba(239,68,68,0.2)' : isRetrying ? 'rgba(245,158,11,0.2)' : 'rgba(59,130,246,0.2)',
                        color: isFailed ? 'var(--danger)' : isRetrying ? 'var(--warning)' : 'var(--primary)',
                      }}>
                        {isFailed ? t('Failed') : isRetrying ? t('Queued') : t('Pending')}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text)', opacity: 0.6 }}>
                      <span>{t('Attempts')}: {row.attempts}</span>
                      <span>{t('ID')}: {(row.local_id ?? row.id).slice(0, 8)}…</span>
                    </div>
                    {row.last_error && (
                      <div style={{
                        fontSize: 11, color: 'var(--danger)',
                        background: 'rgba(239,68,68,0.08)',
                        borderRadius: 4, padding: '4px 8px', fontFamily: 'monospace',
                      }}>
                        {row.last_error}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button
                onClick={() => setShowModal(false)}
                style={{
                  padding: '8px 16px', borderRadius: 8,
                  border: '1px solid var(--border)', background: 'transparent',
                  color: 'var(--text)', cursor: 'pointer', fontSize: 13,
                  colorScheme: 'light dark',
                }}
              >
                {t('Close')}
              </button>
              <button
                onClick={retryNow}
                disabled={retrying}
                style={{
                  padding: '8px 16px', borderRadius: 8, border: 'none',
                  background: 'var(--primary)', color: '#fff',
                  cursor: retrying ? 'default' : 'pointer',
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
