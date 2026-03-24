import { useState, useEffect, useCallback, Component, type ReactNode } from 'react';
import { Login } from './screens/Login';
import { Station } from './screens/Station';
import { StatusBar } from './components/StatusBar';
import type { StaffSession, SyncStatus, UpdateStatus } from './lib/types';
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
  const [session, setSession] = useState<StaffSession | null>(null);
  const [locale, setLocale] = useState<DesktopLocale>('en');
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
      setSession(s);
      setLocale(normalizeLocale(savedLocale));
      setLoading(false);
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

  // Listen for sync status changes
  useEffect(() => {
    const unsub1 = window.qf.sync.onStatusChange((status: string) => {
      setSyncStatus((prev) => ({ ...prev, isOnline: status === 'online' || status === 'syncing' }));
    });
    const unsub2 = window.qf.sync.onProgress((count: number) => {
      setSyncStatus((prev) => ({ ...prev, pendingCount: count }));
    });

    // Initial status
    window.qf.sync.getStatus().then(setSyncStatus);

    return () => { unsub1(); unsub2(); };
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
    setSession(s);
    // Immediately pull cloud data into SQLite after login
    window.qf.sync.forceSync();
  }, []);

  const handleLogout = useCallback(async () => {
    await window.qf.session.clear();
    setSession(null);
  }, []);

  const t = useCallback((key: string, values?: Record<string, string | number | null | undefined>) => {
    return translate(locale, key, values);
  }, [locale]);

  // Note: we intentionally do NOT auto-logout on auth errors.
  // The sync engine logs token issues and retries automatically.
  // The user sees "Offline Mode" and can manually sign out/in if needed.

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
      <div className="app">
        <StatusBar
          session={session}
          syncStatus={syncStatus}
          updateStatus={updateStatus}
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
    </ErrorBoundary>
  );
}
