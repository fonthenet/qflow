'use client';

/**
 * Styled confirm/alert dialog — replaces native browser confirm()/alert().
 *
 * Usage:
 *   <ConfirmDialogProvider>
 *     <App />
 *   </ConfirmDialogProvider>
 *
 * In any component:
 *   const { confirm, alert } = useConfirmDialog();
 *   const yes = await confirm('Delete?', { confirmLabel: 'Delete', variant: 'danger' });
 */
import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from 'react';

interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
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
        open: true, message,
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
        open: true, message,
        title: opts?.title,
        confirmLabel: 'OK', cancelLabel: '',
        variant: 'info', isAlert: true,
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

  useEffect(() => {
    if (!state.open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleCancel();
      if (e.key === 'Enter') handleConfirm();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [state.open, handleConfirm, handleCancel]);

  return (
    <ConfirmDialogContext.Provider value={{ confirm, alert }}>
      {children}
      {state.open && (
        <div
          onClick={handleCancel}
          className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-[420px] max-w-[calc(100vw-2rem)] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-2 duration-200"
          >
            {/* Top accent */}
            <div className={`h-1 ${state.variant === 'danger' ? 'bg-gradient-to-r from-red-500 to-orange-500' : 'bg-gradient-to-r from-blue-500 to-cyan-500'}`} />

            {/* Icon + Message */}
            <div className="p-6 flex gap-4 items-start">
              <div className={`w-11 h-11 rounded-xl flex-shrink-0 flex items-center justify-center text-xl
                ${state.variant === 'danger'
                  ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
                  : state.isAlert
                    ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
                    : 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800'
                }`}
              >
                {state.variant === 'danger' ? (
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-red-500">
                    <path d="M10 6v4m0 4h.01M8.68 2.79l-6.37 11a2 2 0 001.74 3H15.95a2 2 0 001.74-3l-6.37-11a2 2 0 00-3.48 0z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : state.isAlert ? (
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-green-500">
                    <path d="M16.67 5L7.5 14.17 3.33 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-blue-500">
                    <path d="M10 18a8 8 0 100-16 8 8 0 000 16zM10 6v4m0 4h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </div>
              <div className="flex-1 min-w-0">
                {state.title && (
                  <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-1">
                    {state.title}
                  </h3>
                )}
                <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed font-medium">
                  {state.message}
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="px-6 pb-5 flex gap-3 justify-end">
              {!state.isAlert && (
                <button
                  onClick={handleCancel}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200 transition-all"
                >
                  {state.cancelLabel}
                </button>
              )}
              <button
                autoFocus
                onClick={handleConfirm}
                className={`px-6 py-2.5 rounded-xl text-sm font-bold text-white transition-all shadow-lg hover:-translate-y-px
                  ${state.variant === 'danger'
                    ? 'bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 shadow-red-500/25 hover:shadow-red-500/40'
                    : 'bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 shadow-blue-500/25 hover:shadow-blue-500/40'
                  }`}
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
