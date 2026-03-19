import { useState, useEffect, useCallback } from 'react';
import { Login } from './screens/Login';
import { Station } from './screens/Station';
import { StatusBar } from './components/StatusBar';
import type { StaffSession, SyncStatus } from './lib/types';
import './styles.css';

export function App() {
  const [session, setSession] = useState<StaffSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    isOnline: false,
    pendingCount: 0,
    lastSyncAt: null,
  });

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

  // Force re-login when the sync engine can't refresh an expired token
  useEffect(() => {
    const unsub = window.qf.auth?.onSessionExpired?.(() => {
      window.qf.session.clear();
      setSession(null);
    });
    return () => unsub?.();
  }, []);

  if (loading) {
    return (
      <div className="app-loading">
        <div className="spinner" />
        <p>Loading QueueFlow Station...</p>
      </div>
    );
  }

  return (
    <div className="app">
      <StatusBar session={session} syncStatus={syncStatus} onLogout={handleLogout} />
      {session ? (
        <Station session={session} isOnline={syncStatus.isOnline} />
      ) : (
        <Login onLogin={handleLogin} />
      )}
    </div>
  );
}
