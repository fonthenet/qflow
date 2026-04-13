import { useState, useEffect, useCallback, Component, type ReactNode } from 'react';
import { Login } from './screens/Login';
import { Station } from './screens/Station';
import { StatusBar } from './components/StatusBar';
import { ConfirmDialogProvider } from './components/ConfirmDialog';
import type { StaffSession, SyncStatus, UpdateStatus } from './lib/types';
import { getSupabase, restoreSession, listenForTokenRefresh } from './lib/supabase';
import { getDirection, normalizeLocale, t as translate, type DesktopLocale } from './lib/i18n';
import './styles.css';

// ── Error Boundary — prevents full app crash on render errors ─────
class ErrorBoundary extends Component<{ children: ReactNode; locale: DesktopLocale }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: any) {
    console.error('[ErrorBoundary] Caught:', error, info?.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 16, padding: 40, textAlign: 'center', background: '#0f172a', color: '#e2e8f0' }}>
          <div style={{ fontSize: 48 }}>⚠️</div>
          <h2 style={{ fontSize: 22, fontWeight: 700 }}>{translate(this.props.locale, 'Something went wrong')}</h2>
          <p style={{ fontSize: 14, color: '#94a3b8', maxWidth: 400 }}>{this.state.error.message}</p>
          <button
            onClick={() => { this.setState({ error: null }); window.location.reload(); }}
            style={{ padding: '10px 24px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}
          >
            {translate(this.props.locale, 'Reload App')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  const STAFF_STATUS_KEY = 'qflo_station_staff_status';
  const QUEUE_PAUSED_KEY = 'qflo_station_queue_paused';
  const [session, setSession] = useState<StaffSession | null>(null);
  const [locale, setLocale] = useState<DesktopLocale>('en');
  const [stationVersion, setStationVersion] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    isOnline: false,
    pendingCount: 0,
    lastSyncAt: null,
  });
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({
    status: 'idle',
    version: null,
    progress: null,
    message: null,
  });
  const [staffStatus, setStaffStatus] = useState<'available' | 'on_break' | 'away'>('available');
  const [queuePaused, setQueuePaused] = useState(false);

  // Load saved session on mount
  useEffect(() => {
    Promise.all([
      window.qf.session.load(),
      Promise.resolve(window.qf.settings?.getLocale?.()).catch(() => 'en'),
    ]).then(([s, savedLocale]: [StaffSession | null, string]) => {
      try {
        const storedStaffStatus = window.localStorage.getItem(STAFF_STATUS_KEY);
        if (storedStaffStatus === 'available' || storedStaffStatus === 'on_break' || storedStaffStatus === 'away') {
          setStaffStatus(storedStaffStatus);
        }
        const storedQueuePaused = window.localStorage.getItem(QUEUE_PAUSED_KEY);
        if (storedQueuePaused === 'true' || storedQueuePaused === 'false') {
          setQueuePaused(storedQueuePaused === 'true');
        }
      } catch {
        // ignore persistence failures
      }
      if (s?.access_token && s?.refresh_token) {
        restoreSession(s.access_token, s.refresh_token).catch(() => {});
      }
      setSession(s);
      setLocale(normalizeLocale(savedLocale));
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STAFF_STATUS_KEY, staffStatus);
    } catch {
      // ignore persistence failures
    }
  }, [staffStatus]);

  useEffect(() => {
    try {
      window.localStorage.setItem(QUEUE_PAUSED_KEY, String(queuePaused));
    } catch {
      // ignore persistence failures
    }
  }, [queuePaused]);

  useEffect(() => {
    window.qf.getConfig?.()
      .then((config: { APP_VERSION?: string } | null | undefined) => {
        setStationVersion(config?.APP_VERSION ?? null);
      })
      .catch(() => {
        setStationVersion(null);
      });
  }, []);

  useEffect(() => {
    const unsub = window.qf.settings?.onLocaleChange?.((nextLocale: string) => {
      setLocale(normalizeLocale(nextLocale));
    });
    return () => { unsub?.(); };
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = getDirection(locale);
    document.body.dir = getDirection(locale);
    document.title = translate(locale, 'Qflo Station');
  }, [locale]);

  // Listen for token refresh from main process — keeps renderer's Supabase client in sync
  useEffect(() => {
    const unsub = listenForTokenRefresh();
    return () => { unsub(); };
  }, []);

  // Listen for sync status changes
  useEffect(() => {
    const unsub1 = window.qf.sync.onStatusChange((status: string) => {
      setSyncStatus((prev) => ({ ...prev, isOnline: status === 'online' || status === 'syncing' }));
    });
    const unsub2 = window.qf.sync.onProgress((count: number) => {
      setSyncStatus((prev) => ({ ...prev, pendingCount: count }));
    });
    const unsub3 = window.qf.sync.onError((error: { message: string; ticketNumber?: string; type: string }) => {
      setSyncStatus((prev) => ({ ...prev, lastError: { ...error, at: Date.now() } }));
      // Auto-clear error after 15s
      setTimeout(() => {
        setSyncStatus((prev) => {
          if (prev.lastError && Date.now() - prev.lastError.at >= 14000) {
            return { ...prev, lastError: null };
          }
          return prev;
        });
      }, 15000);
    });

    // Initial status
    window.qf.sync.getStatus().then(setSyncStatus);

    return () => { unsub1(); unsub2(); unsub3(); };
  }, []);

  useEffect(() => {
    const unsub = window.qf.updater?.onStatusChange?.((status: UpdateStatus) => {
      setUpdateStatus(status);
    });
    window.qf.updater?.getStatus?.().then(setUpdateStatus).catch(() => {});
    return () => { unsub?.(); };
  }, []);

  const handleLogin = useCallback(async (s: StaffSession) => {
    await window.qf.session.save(s);
    if (s.access_token && s.refresh_token) {
      await restoreSession(s.access_token, s.refresh_token);
    }
    // Pull cloud data into SQLite BEFORE showing the Station screen
    // so tickets are visible immediately (avoids blank queue on first load)
    try { await window.qf.sync.forceSync(); } catch { /* non-critical */ }
    setSession(s);
  }, []);

  const handleLogout = useCallback(async () => {
    // Close the desk in Supabase before logging out
    if (session?.desk_id) {
      try {
        const sb = await getSupabase();
        if (sb) {
          await sb.from('desks')
            .update({ status: 'closed', current_staff_id: null })
            .eq('id', session.desk_id);
        }
      } catch (err) {
        console.warn('[App] desk close-on-logout error:', err);
      }
    }
    await window.qf.session.clear();
    setSession(null);
  }, [session?.desk_id]);

  const t = useCallback((key: string, values?: Record<string, string | number | null | undefined>) => {
    return translate(locale, key, values);
  }, [locale]);

  // Note: we intentionally do NOT auto-logout on auth errors.
  // The sync engine logs token issues and retries automatically.
  // The user sees "Offline Mode" and can manually sign out/in if needed.

  const handleInstallNow = useCallback(() => {
    window.qf.updater?.installUpdate?.();
  }, []);

  if (loading) {
    return (
      <div className="app-loading">
        <div className="spinner" />
        <p>{t('Loading Qflo Station...')}</p>
      </div>
    );
  }

  return (
    <ErrorBoundary locale={locale}>
      <ConfirmDialogProvider>
      <div className="app">
        {/* Update progress overlay — visible during download and when ready to install */}
        {(updateStatus.status === 'downloading' || updateStatus.status === 'available') && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
            background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
            color: 'white', padding: '10px 20px',
            display: 'flex', alignItems: 'center', gap: 12,
            boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
          }}>
            <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
            <span style={{ fontWeight: 600, fontSize: 13 }}>
              {updateStatus.progress != null && updateStatus.progress > 0
                ? t('Downloading update... {progress}%', { progress: Math.round(updateStatus.progress) })
                : t('Downloading update...')}
            </span>
            {updateStatus.progress != null && updateStatus.progress > 0 && (
              <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.2)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${updateStatus.progress}%`, height: '100%', background: 'white', borderRadius: 2, transition: 'width 0.3s ease' }} />
              </div>
            )}
            <span style={{ fontSize: 11, opacity: 0.8 }}>{t('Do not close the app')}</span>
          </div>
        )}
        {updateStatus.status === 'downloaded' && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
            background: 'linear-gradient(135deg, #16a34a, #15803d)',
            color: 'white', padding: '10px 20px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
          }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>
              {t('Update ready! Restart to apply.')}
              {updateStatus.version && <span style={{ opacity: 0.8, marginLeft: 8, fontSize: 11 }}>v{updateStatus.version}</span>}
            </span>
            <button
              onClick={handleInstallNow}
              style={{
                background: 'white', color: '#15803d', border: 'none',
                padding: '6px 16px', borderRadius: 6, fontWeight: 700,
                fontSize: 12, cursor: 'pointer',
              }}
            >
              {t('Restart Now')}
            </button>
          </div>
        )}
        <StatusBar
          session={session}
          syncStatus={syncStatus}
          updateStatus={updateStatus}
          stationVersion={stationVersion}
          onLogout={handleLogout}
          staffStatus={staffStatus}
          queuePaused={queuePaused}
          locale={locale}
        />
        {session ? (
          <Station
            session={session}
            locale={locale}
            isOnline={syncStatus.isOnline}
            staffStatus={staffStatus}
            queuePaused={queuePaused}
            onStaffStatusChange={setStaffStatus}
            onQueuePausedChange={setQueuePaused}
          />
        ) : (
          <Login onLogin={handleLogin} locale={locale} />
        )}
      </div>
      </ConfirmDialogProvider>
    </ErrorBoundary>
  );
}
