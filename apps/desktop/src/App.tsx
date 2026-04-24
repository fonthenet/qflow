import { useState, useEffect, useCallback, Component, type ReactNode } from 'react';
import { Login } from './screens/Login';
import { Station } from './screens/Station';
import { MiniQueue } from './screens/MiniQueue';
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
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 16, padding: 40, textAlign: 'center', background: 'var(--bg)', color: 'var(--text)' }}>
          <div style={{ fontSize: 48 }}>⚠️</div>
          <h2 style={{ fontSize: 22, fontWeight: 700 }}>{translate(this.props.locale, 'Something went wrong')}</h2>
          <p style={{ fontSize: 14, color: 'var(--text2)', maxWidth: 400 }}>{this.state.error.message}</p>
          <button
            onClick={() => { this.setState({ error: null }); window.location.reload(); }}
            style={{ padding: '10px 24px', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}
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
  // Mini floating queue window — spawned by main.ts when the user
  // minimizes the Station. Renders a compact always-on-top card that
  // reuses the existing SQLite + IPC plumbing, nothing else. Apply
  // the saved theme synchronously before render so the mini doesn't
  // flash dark when the user is on a light theme.
  if (typeof window !== 'undefined' && window.location.hash === '#mini') {
    try {
      const saved = localStorage.getItem('qflo_theme');
      if (saved === 'dark' || saved === 'light') {
        document.documentElement.setAttribute('data-theme', saved);
      }
    } catch {}
    return <MiniQueue />;
  }

  const STAFF_STATUS_KEY = 'qflo_station_staff_status';
  const QUEUE_PAUSED_KEY = 'qflo_station_queue_paused';
  const isHttpBridge = !!(window as any).__QF_HTTP_MODE__;
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
  const [sessionExpired, setSessionExpired] = useState(false);

  // Apply saved theme on mount (ensures CSS variables are set even if index.html script missed it)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('qflo_theme');
      if (saved === 'dark' || saved === 'light') {
        document.documentElement.setAttribute('data-theme', saved);
      }
    } catch {}
  }, []);

  // ── Touch mode ────────────────────────────────────────────────────
  // Per-device preference (persisted in localStorage) that adds a
  // `touch-mode` class on <body>. CSS in styles.css scales every
  // interactive surface to ≥44px tap targets. Listens for a
  // `qflo:touch-mode-changed` window event so the SettingsModal toggle
  // takes effect instantly across the app without a reload.
  useEffect(() => {
    const apply = () => {
      try {
        const on = localStorage.getItem('qflo_touch_mode') === 'true';
        document.body.classList.toggle('touch-mode', on);
      } catch {}
    };
    apply();
    const handler = () => apply();
    window.addEventListener('qflo:touch-mode-changed', handler);
    return () => window.removeEventListener('qflo:touch-mode-changed', handler);
  }, []);

  // Load saved session on mount
  useEffect(() => {
    Promise.all([
      window.qf.session.load().catch(() => null),
      Promise.resolve(window.qf.settings?.getLocale?.()).catch(() => 'en'),
    ]).then(([rawSession, savedLocale]: [StaffSession | null, string]) => {
      // Validate session has required fields (guards against error objects from HTTP bridge)
      const s = rawSession && rawSession.staff_id && rawSession.office_id ? rawSession : null;
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
      setLocale(normalizeLocale(savedLocale));
      if (s) {
        // Ask main process for a FRESH token (not the stale one from SQLite)
        // This is critical: the stored token may be expired after idle/restart,
        // and using it would cause all Supabase queries to return empty (RLS block).
        const freshLogin = async () => {
          try {
            const result = await window.qf.auth.getToken();
            if (result?.ok && result.token) {
              // Always pass refresh_token so Supabase can auto-refresh the JWT.
              // In Electron, main process also pushes updates via IPC.
              // In HTTP bridge (kiosk), this is the ONLY way to auto-refresh.
              await restoreSession(result.token, s.refresh_token || '');
            } else if (s.access_token) {
              // Fallback to stored token (better than nothing)
              await restoreSession(s.access_token, s.refresh_token || '').catch(() => {});
            }
          } catch {
            // Last resort: use stored token
            if (s.access_token) {
              await restoreSession(s.access_token, s.refresh_token || '').catch(() => {});
            }
          }
        };
        // Get fresh token + force sync, then show Station
        freshLogin()
          .then(() => window.qf.sync.forceSync().catch(() => {}))
          .finally(() => {
            setSession(s);
            setLoading(false);
          });
      } else {
        setSession(s);
        setLoading(false);
      }
    });
  }, []);

  // In HTTP bridge mode, if no session, poll every 3s until desktop logs in
  useEffect(() => {
    if (!isHttpBridge || session || loading) return;
    const interval = setInterval(() => {
      window.qf.session.load().then((rawSession: StaffSession | null) => {
        const s = rawSession && rawSession.staff_id && rawSession.office_id ? rawSession : null;
        if (s) {
          if (s.access_token && s.refresh_token) {
            restoreSession(s.access_token, s.refresh_token).catch(() => {});
          }
          window.qf.sync.forceSync().catch(() => {}).finally(() => {
            setSession(s);
          });
        }
      }).catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
  }, [isHttpBridge, session, loading]);

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

  // Listen for session expired — pure token auth, no password fallback
  useEffect(() => {
    const unsub = window.qf.auth?.onSessionExpired?.(() => {
      setSessionExpired(true);
    });
    return () => { unsub?.(); };
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

    // Refresh health fields (circuit breaker, auth-expired, oldest pending
    // age) every 5s so the StatusBar banners stay honest without waiting
    // for a status-change event.
    const healthPoll = setInterval(() => {
      window.qf.sync.getStatus().then((s: any) => {
        setSyncStatus((prev) => ({
          ...prev,
          circuitOpen: s?.circuitOpen ?? false,
          authExpired: s?.authExpired ?? false,
          oldestPendingAgeMs: s?.oldestPendingAgeMs ?? null,
          connectionQuality: s?.connectionQuality ?? prev.connectionQuality,
          lastSyncAt: s?.lastSyncAt ?? prev.lastSyncAt,
        }));
      }).catch(() => {});
    }, 5000);

    return () => { unsub1(); unsub2(); unsub3(); clearInterval(healthPoll); };
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

  const handleReLogin = useCallback(async () => {
    setSessionExpired(false);
    await handleLogout();
  }, [handleLogout]);

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
        {/* Session expired overlay — QF-AUTH-001 */}
        {sessionExpired && session && (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{
              background: 'var(--bg, #fff)', borderRadius: 16, padding: '40px 48px',
              textAlign: 'center', maxWidth: 420, boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
            }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>🔑</div>
              <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px', color: 'var(--text)' }}>{t('Session Expired')}</h2>
              <p style={{ fontSize: 14, color: 'var(--text2)', margin: '0 0 8px' }}>{t('Your login session has expired. Please log in again to continue.')}</p>
              <p style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text3)', margin: '0 0 20px', opacity: 0.7 }}>QF-AUTH-001</p>
              <button
                onClick={handleReLogin}
                style={{
                  padding: '12px 32px', background: 'var(--primary, #2563eb)', color: '#fff',
                  border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 14,
                }}
              >
                {t('Log In Again')}
              </button>
            </div>
          </div>
        )}
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
            onSessionPatch={(patch) => {
              const next = { ...session, ...patch };
              setSession(next);
              window.qf.session.save(next).catch(() => {});
            }}
          />
        ) : isHttpBridge ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 16, padding: 40, textAlign: 'center', background: 'var(--bg)', color: 'var(--text)' }}>
            <div className="spinner" style={{ width: 32, height: 32 }} />
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{t('Waiting for Station Login')}</h2>
            <p style={{ fontSize: 14, color: 'var(--text2)', maxWidth: 400, margin: 0 }}>{t('Please log in on the desktop Station app. This screen will connect automatically.')}</p>
          </div>
        ) : (
          <Login onLogin={handleLogin} locale={locale} />
        )}
      </div>
      </ConfirmDialogProvider>
    </ErrorBoundary>
  );
}
