import { useState, useEffect, useCallback, Component, type ReactNode } from 'react';
import { Login } from './screens/Login';
import { Station } from './screens/Station';
import { StatusBar } from './components/StatusBar';
import type { StaffSession, SyncStatus } from './lib/types';
import './styles.css';

// ── Error Boundary — prevents full app crash on render errors ─────
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
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
          <h2 style={{ fontSize: 22, fontWeight: 700 }}>Something went wrong</h2>
          <p style={{ fontSize: 14, color: '#94a3b8', maxWidth: 400 }}>{this.state.error.message}</p>
          <button
            onClick={() => { this.setState({ error: null }); window.location.reload(); }}
            style={{ padding: '10px 24px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}
          >
            Reload App
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  const [session, setSession] = useState<StaffSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    isOnline: false,
    pendingCount: 0,
    lastSyncAt: null,
  });
  const [staffStatus, setStaffStatus] = useState<'available' | 'on_break' | 'away'>('available');
  const [queuePaused, setQueuePaused] = useState(false);

  // Load saved session on mount
  useEffect(() => {
    window.qf.session.load().then((s: StaffSession | null) => {
      setSession(s);
      setLoading(false);
    });
  }, []);

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

  // Note: we intentionally do NOT auto-logout on auth errors.
  // The sync engine logs token issues and retries automatically.
  // The user sees "Offline Mode" and can manually sign out/in if needed.

  if (loading) {
    return (
      <div className="app-loading">
        <div className="spinner" />
        <p>Loading Qflo Station...</p>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="app">
        <StatusBar session={session} syncStatus={syncStatus} onLogout={handleLogout} staffStatus={staffStatus} queuePaused={queuePaused} />
        {session ? (
          <Station session={session} isOnline={syncStatus.isOnline} staffStatus={staffStatus} queuePaused={queuePaused} onStaffStatusChange={setStaffStatus} onQueuePausedChange={setQueuePaused} />
        ) : (
          <Login onLogin={handleLogin} />
        )}
      </div>
    </ErrorBoundary>
  );
}
