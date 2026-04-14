/**
 * Styled confirm/alert dialog that replaces native browser confirm()/alert().
 *
 * Usage:
 *   <ConfirmDialogProvider>
 *     <App />
 *   </ConfirmDialogProvider>
 *
 * In any component:
 *   const { confirm, alert } = useConfirmDialog();
 *   const yes = await confirm('Delete?', { confirmLabel: 'Delete', variant: 'danger' });
 *   await alert('Done!');
 */
import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from 'react';

interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'danger' = red confirm button, 'info' = blue (default) */
  variant?: 'danger' | 'info';
}

interface ConfirmDialogContextValue {
  confirm: (message: string, opts?: ConfirmOptions) => Promise<boolean>;
  alert: (message: string, opts?: { title?: string }) => Promise<void>;
}

const ConfirmDialogContext = createContext<ConfirmDialogContextValue | null>(null);

export function useConfirmDialog() {
  const ctx = useContext(ConfirmDialogContext);
  if (!ctx) throw new Error('useConfirmDialog must be inside <ConfirmDialogProvider>');
  return ctx;
}

interface DialogState {
  open: boolean;
  message: string;
  title?: string;
  confirmLabel: string;
  cancelLabel: string;
  variant: 'danger' | 'info';
  isAlert: boolean;
}

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DialogState>({
    open: false, message: '', confirmLabel: 'OK', cancelLabel: 'Cancel',
    variant: 'info', isAlert: false,
  });
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((message: string, opts?: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState({
        open: true,
        message,
        title: opts?.title,
        confirmLabel: opts?.confirmLabel ?? 'OK',
        cancelLabel: opts?.cancelLabel ?? 'Cancel',
        variant: opts?.variant ?? 'info',
        isAlert: false,
      });
    });
  }, []);

  const alert = useCallback((message: string, opts?: { title?: string }): Promise<void> => {
    return new Promise((resolve) => {
      resolveRef.current = () => resolve(undefined as any);
      setState({
        open: true,
        message,
        title: opts?.title,
        confirmLabel: 'OK',
        cancelLabel: '',
        variant: 'info',
        isAlert: true,
      });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    resolveRef.current?.(true);
    resolveRef.current = null;
    setState(s => ({ ...s, open: false }));
  }, []);

  const handleCancel = useCallback(() => {
    resolveRef.current?.(false);
    resolveRef.current = null;
    setState(s => ({ ...s, open: false }));
  }, []);

  // Close on Escape, confirm on Enter
  useEffect(() => {
    if (!state.open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleCancel();
      if (e.key === 'Enter') handleConfirm();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [state.open, handleConfirm, handleCancel]);

  const confirmBg = state.variant === 'danger'
    ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'
    : 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)';

  return (
    <ConfirmDialogContext.Provider value={{ confirm, alert }}>
      {children}
      {state.open && (
        <div
          onClick={handleCancel}
          style={{
            position: 'fixed', inset: 0, zIndex: 99999,
            background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'confirmOverlayIn 0.2s ease-out',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'linear-gradient(145deg, var(--surface) 0%, var(--bg) 100%)',
              border: '1px solid var(--border)',
              borderRadius: 16,
              padding: 0,
              width: 400,
              maxWidth: 'calc(100vw - 40px)',
              boxShadow: '0 25px 60px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.05)',
              animation: 'confirmDialogIn 0.25s cubic-bezier(0.16,1,0.3,1)',
              overflow: 'hidden',
            }}
          >
            {/* Header accent bar */}
            <div style={{
              height: 3,
              background: state.variant === 'danger'
                ? 'linear-gradient(90deg, #ef4444, #f97316)'
                : 'linear-gradient(90deg, #3b82f6, #06b6d4)',
            }} />

            {/* Icon + Message */}
            <div style={{ padding: '24px 28px 16px', display: 'flex', gap: 16, alignItems: 'flex-start' }}>
              <div style={{
                width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 22,
                background: state.variant === 'danger'
                  ? 'rgba(239,68,68,0.12)' : state.isAlert ? 'rgba(34,197,94,0.12)' : 'rgba(59,130,246,0.12)',
                border: `1px solid ${state.variant === 'danger'
                  ? 'rgba(239,68,68,0.2)' : state.isAlert ? 'rgba(34,197,94,0.2)' : 'rgba(59,130,246,0.2)'}`,
              }}>
                {state.variant === 'danger' ? '⚠' : state.isAlert ? '✓' : '?'}
              </div>
              <div style={{ flex: 1 }}>
                {state.title && (
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
                    {state.title}
                  </div>
                )}
                <div style={{
                  fontSize: 14, color: 'var(--text2)', lineHeight: 1.55,
                  fontWeight: 500,
                }}>
                  {state.message}
                </div>
              </div>
            </div>

            {/* Buttons */}
            <div style={{
              padding: '12px 28px 20px',
              display: 'flex', gap: 10, justifyContent: 'flex-end',
            }}>
              {!state.isAlert && (
                <button
                  onClick={handleCancel}
                  style={{
                    padding: '9px 20px', borderRadius: 10,
                    border: '1px solid var(--border)',
                    background: 'var(--surface2)',
                    color: 'var(--text2)', cursor: 'pointer',
                    fontSize: 13, fontWeight: 600,
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--surface2)';
                    e.currentTarget.style.color = 'var(--text)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'var(--surface2)';
                    e.currentTarget.style.color = 'var(--text2)';
                  }}
                >
                  {state.cancelLabel}
                </button>
              )}
              <button
                autoFocus
                onClick={handleConfirm}
                style={{
                  padding: '9px 24px', borderRadius: 10,
                  border: 'none',
                  background: confirmBg,
                  color: '#fff', cursor: 'pointer',
                  fontSize: 13, fontWeight: 700,
                  boxShadow: state.variant === 'danger'
                    ? '0 4px 14px rgba(239,68,68,0.3)'
                    : '0 4px 14px rgba(59,130,246,0.3)',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.boxShadow = state.variant === 'danger'
                    ? '0 6px 20px rgba(239,68,68,0.4)'
                    : '0 6px 20px rgba(59,130,246,0.4)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = '';
                  e.currentTarget.style.boxShadow = state.variant === 'danger'
                    ? '0 4px 14px rgba(239,68,68,0.3)'
                    : '0 4px 14px rgba(59,130,246,0.3)';
                }}
              >
                {state.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmDialogContext.Provider>
  );
}
