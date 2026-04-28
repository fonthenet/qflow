import { useEffect, useState, useCallback } from 'react';

interface PendingItem {
  id: string;
  operation: string;
  table_name: string;
  record_id: string;
  ticket_number: string | null;
  attempts: number;
  last_error: string | null;
  created_at: string;
  organization_id: string | null;
}

interface PendingBreakdown {
  activeOrgId: string | null;
  active: number;
  foreign: number;
  unresolved: number;
  foreignByOrg: Array<{ organization_id: string; count: number }>;
}

interface SyncHealth {
  isOnline: boolean;
  pendingCount: number;
  lastSyncAt: string | null;
  connectionQuality?: 'good' | 'slow' | 'flaky' | 'offline';
  circuitOpen?: boolean;
  authExpired?: boolean;
  oldestPendingAgeMs?: number | null;
}

function formatAge(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

/**
 * Diagnostics panel — operator-facing view of the Station's sync engine state.
 * Shows: online status, circuit breaker state, pending count + oldest age,
 * auth-expired flag, and the full pending queue with retry/discard controls.
 * Polls every 3s while visible. No auto-actions — operators trigger retries
 * explicitly so they stay in control of what the cloud sees.
 */
export function DiagnosticsPanel({ t }: { t: (k: string, v?: Record<string, any>) => string }) {
  const [health, setHealth] = useState<SyncHealth | null>(null);
  const [items, setItems] = useState<PendingItem[]>([]);
  const [breakdown, setBreakdown] = useState<PendingBreakdown | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [h, p, b] = await Promise.all([
        (window as any).qf.sync.getStatus(),
        (window as any).qf.sync.getPendingDetails(),
        (window as any).qf.sync.getPendingBreakdown?.() ?? Promise.resolve(null),
      ]);
      setHealth(h);
      setItems(p ?? []);
      setBreakdown(b ?? null);
    } catch { /* transient IPC hiccup */ }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [refresh]);

  const runForceSync = async () => {
    setBusy(true);
    setLastAction(t('Forcing sync...'));
    try {
      await (window as any).qf.sync.forceSync();
      setLastAction(t('Sync triggered.'));
    } catch (e: any) {
      setLastAction(`${t('Error')}: ${e?.message ?? 'unknown'}`);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const runResetAll = async () => {
    if (!confirm(t('Reset attempt counters and retry all pending items?'))) return;
    setBusy(true);
    setLastAction(t('Resetting...'));
    try {
      for (const it of items) {
        await (window as any).qf.sync.retryItem(it.id);
      }
      await (window as any).qf.sync.forceSync();
      setLastAction(t('All items queued for retry.'));
    } catch (e: any) {
      setLastAction(`${t('Error')}: ${e?.message ?? 'unknown'}`);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  // Split pending items into active (current business) vs. foreign.
  // The foreign ones surface in the yellow banner above; the Pending
  // queue list below shows only what the current session is actively
  // trying to sync, so operators aren't confused by rows they can't
  // action under this login.
  const activeOrgId = breakdown?.activeOrgId ?? null;
  const activeItems = items.filter(
    (it) => it.organization_id == null || it.organization_id === activeOrgId,
  );

  const retry = async (id: string) => {
    await (window as any).qf.sync.retryItem(id);
    refresh();
  };
  const discard = async (id: string) => {
    if (!confirm(t('Discard this pending item? It will not reach the cloud.'))) return;
    await (window as any).qf.sync.discardItem(id);
    refresh();
  };
  const discardForeign = async () => {
    if (!confirm(t('Discard items from other businesses? They belong to a business you are no longer signed into.'))) return;
    setBusy(true);
    try {
      const res = await (window as any).qf.sync.discardForeign?.();
      setLastAction(t('Discarded items from other businesses', { count: res?.discarded ?? 0 }));
    } catch (e: any) {
      setLastAction(`${t('Error')}: ${e?.message ?? 'unknown'}`);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const danger = health?.circuitOpen || health?.authExpired ||
    (health?.oldestPendingAgeMs != null && health.oldestPendingAgeMs > 5 * 60 * 1000);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>🩺 {t('Sync Diagnostics')}</h3>
        <p style={{ fontSize: 12, color: 'var(--text3, #64748b)', margin: '4px 0 0' }}>
          {t('Live view of the cloud sync pipeline. Refreshes every 3 seconds.')}
        </p>
      </div>

      {/* Health summary */}
      <div style={{
        background: danger ? 'rgba(239,68,68,0.1)' : 'var(--surface2, #334155)',
        border: danger ? '1px solid var(--danger, #ef4444)' : 'none',
        borderRadius: 10, padding: 16, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10,
      }}>
        <HealthRow label={t('Connection')} value={health?.isOnline ? `${t('Online')} (${health?.connectionQuality ?? 'good'})` : t('Offline')} ok={!!health?.isOnline} />
        <HealthRow label={t('Circuit breaker')} value={health?.circuitOpen ? t('OPEN — sync paused') : t('Closed')} ok={!health?.circuitOpen} />
        <HealthRow label={t('Authentication')} value={health?.authExpired ? t('Expired — re-login needed') : t('Valid')} ok={!health?.authExpired} />
        <HealthRow label={t('Pending items')} value={String(health?.pendingCount ?? 0)} ok={(health?.pendingCount ?? 0) === 0} />
        <HealthRow label={t('Oldest pending')} value={formatAge(health?.oldestPendingAgeMs)} ok={!health?.oldestPendingAgeMs || health.oldestPendingAgeMs < 60_000} />
        <HealthRow label={t('Last sync')} value={health?.lastSyncAt ? new Date(health.lastSyncAt).toLocaleTimeString() : '—'} ok={true} />
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          onClick={runForceSync}
          disabled={busy}
          style={{ padding: '8px 14px', borderRadius: 6, background: 'var(--primary, #3b82f6)', color: '#fff', border: 'none', fontSize: 12, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1 }}
        >
          {t('Force sync now')}
        </button>
        <button
          onClick={runResetAll}
          disabled={busy || activeItems.length === 0}
          style={{ padding: '8px 14px', borderRadius: 6, background: 'var(--surface3, #475569)', color: 'var(--text, #f1f5f9)', border: '1px solid var(--border, #475569)', fontSize: 12, fontWeight: 600, cursor: busy || activeItems.length === 0 ? 'not-allowed' : 'pointer', opacity: busy || activeItems.length === 0 ? 0.6 : 1 }}
        >
          {t('Reset & retry all')}
        </button>
        <button
          onClick={refresh}
          disabled={busy}
          style={{ padding: '8px 14px', borderRadius: 6, background: 'transparent', color: 'var(--text, #f1f5f9)', border: '1px solid var(--border, #475569)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
        >
          {t('Refresh')}
        </button>
      </div>
      {lastAction && <div style={{ fontSize: 11, color: 'var(--text3, #64748b)' }}>{lastAction}</div>}

      {/* Foreign-org banner — shown only when the queue contains items
          whose organization_id doesn't match the signed-in business.
          These items are never retried (wrong RLS would reject them
          anyway), so we surface them separately with a one-click clear. */}
      {breakdown && breakdown.foreign > 0 && (
        <div style={{
          background: 'rgba(234,179,8,0.12)',
          border: '1px solid rgba(234,179,8,0.4)',
          borderRadius: 10,
          padding: '12px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#eab308' }}>
              {t('{count} items from another business', { count: breakdown.foreign })}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text3, #64748b)', marginTop: 2 }}>
              {t('Paused — these were queued while signed into a different business and won\'t sync under the current login.')}
            </div>
          </div>
          <button
            onClick={discardForeign}
            disabled={busy}
            style={{
              padding: '8px 14px', borderRadius: 6, border: 'none',
              background: '#eab308', color: '#000',
              fontSize: 12, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            {t('Discard items from other businesses')}
          </button>
        </div>
      )}

      {/* Pending queue — scoped to the active business. Foreign items
          (from a previous sign-in) are summarized in the yellow banner
          above and intentionally hidden here so the list reflects only
          what the current session is actually trying to sync. */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
          {t('Pending queue')} ({activeItems.length})
        </div>
        {activeItems.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text3, #64748b)', fontSize: 12, background: 'var(--surface2, #334155)', borderRadius: 8 }}>
            ✓ {t('Nothing pending. All changes are on the cloud.')}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 340, overflowY: 'auto' }}>
            {activeItems.map((it) => {
              const ageMs = Date.now() - new Date(it.created_at).getTime();
              const stuck = it.attempts >= 3 || ageMs > 2 * 60 * 1000;
              // Org-status tag: makes it immediately visible whether a
              // row has a resolved organization_id, matches the current
              // session, or is a legacy null that may need backfill.
              const orgStatus: 'active' | 'unresolved' | 'mismatched' =
                it.organization_id == null ? 'unresolved'
                : it.organization_id === activeOrgId ? 'active'
                : 'mismatched';
              const tagStyle: React.CSSProperties = {
                fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 3,
                textTransform: 'uppercase', letterSpacing: 0.5,
                background: orgStatus === 'active' ? 'rgba(34,197,94,0.15)'
                  : orgStatus === 'unresolved' ? 'rgba(148,163,184,0.15)'
                  : 'rgba(234,179,8,0.15)',
                color: orgStatus === 'active' ? '#22c55e'
                  : orgStatus === 'unresolved' ? '#94a3b8'
                  : '#eab308',
              };
              return (
                <div key={it.id} style={{
                  padding: '8px 12px', borderRadius: 6,
                  background: stuck ? 'rgba(239,68,68,0.1)' : 'var(--surface2, #334155)',
                  display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {it.operation} → {it.table_name}
                      {it.ticket_number && (
                        <span style={{
                          fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 3,
                          background: 'var(--surface, #1e293b)', color: 'var(--text, #e2e8f0)',
                          border: '1px solid var(--border, #334155)',
                          fontFamily: 'ui-monospace, monospace',
                        }}>
                          #{it.ticket_number}
                        </span>
                      )}
                      <span style={tagStyle}>
                        {orgStatus === 'active' ? t('active')
                          : orgStatus === 'unresolved' ? t('no org')
                          : t('other org')}
                      </span>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text3, #64748b)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {it.record_id.substring(0, 18)}… · {t('age')}: {formatAge(ageMs)} · {t('attempts')}: {it.attempts}
                      {it.last_error && <span style={{ color: 'var(--danger, #ef4444)' }}> · {it.last_error}</span>}
                    </div>
                  </div>
                  <button onClick={() => retry(it.id)} style={{ padding: '3px 8px', borderRadius: 4, background: 'var(--primary, #3b82f6)', color: '#fff', border: 'none', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>
                    {t('Retry')}
                  </button>
                  <button onClick={() => discard(it.id)} style={{ padding: '3px 8px', borderRadius: 4, background: 'transparent', color: 'var(--danger, #ef4444)', border: '1px solid var(--danger, #ef4444)', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>
                    {t('Discard')}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function HealthRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--text3, #64748b)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: ok ? 'var(--text, #f1f5f9)' : 'var(--danger, #ef4444)' }}>
        {ok ? '✓' : '⚠'} {value}
      </div>
    </div>
  );
}
