'use client';

import { useState, useEffect } from 'react';

interface IosInstallPromptProps {
  onDismiss: () => void;
  appName?: string;
}

/**
 * Full-screen iOS PWA install overlay.
 * Shows animated step-by-step instructions pointing at Safari's Share button.
 * Designed to feel like a native install prompt — not a wall of text.
 */
export function IosInstallPrompt({ onDismiss, appName = 'QueueFlow' }: IosInstallPromptProps) {
  const [step, setStep] = useState(1);
  const [animateIn, setAnimateIn] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setAnimateIn(true));
  }, []);

  // Detect if user is in Chrome/Firefox/other iOS browser (not Safari)
  const isSafari = typeof navigator !== 'undefined' &&
    /Safari/.test(navigator.userAgent) &&
    !/CriOS|FxiOS|OPiOS|EdgiOS/.test(navigator.userAgent);

  const isChrome = typeof navigator !== 'undefined' && /CriOS/.test(navigator.userAgent);
  const isFirefox = typeof navigator !== 'undefined' && /FxiOS/.test(navigator.userAgent);

  const notSafari = !isSafari && (isChrome || isFirefox);

  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col transition-all duration-300 ${
        animateIn ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onDismiss} />

      {/* Content card — slides up from bottom like a native sheet */}
      <div
        className={`relative mt-auto rounded-t-3xl bg-white px-6 pb-8 pt-6 shadow-2xl transition-transform duration-500 ease-out ${
          animateIn ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        {/* Handle bar */}
        <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-gray-300" />

        {/* Close button */}
        <button
          onClick={onDismiss}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-500 active:bg-gray-200"
          aria-label="Close"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* If not Safari, show redirect message first */}
        {notSafari ? (
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50">
              <svg className="h-8 w-8 text-blue-500" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 18c-4.411 0-8-3.589-8-8s3.589-8 8-8 8 3.589 8 8-3.589 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/>
              </svg>
            </div>
            <h2 className="text-lg font-bold text-gray-900">Open in Safari</h2>
            <p className="mt-2 text-sm text-gray-600 leading-relaxed">
              To get notifications, you need to use <strong>Safari</strong>.
              Copy this page URL and open it in Safari.
            </p>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(window.location.href);
              }}
              className="mt-4 w-full rounded-xl bg-blue-500 py-3.5 text-sm font-semibold text-white shadow-sm active:scale-[0.98] transition-transform"
            >
              Copy Link
            </button>
            <p className="mt-3 text-xs text-gray-400">Then paste it in Safari&apos;s address bar</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="mb-5 text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-500 shadow-lg shadow-blue-500/25">
                <svg className="h-7 w-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
              </div>
              <h2 className="text-lg font-bold text-gray-900">Get Notified When Called</h2>
              <p className="mt-1 text-sm text-gray-500">
                Install {appName} to receive push notifications — even when your phone is locked.
              </p>
            </div>

            {/* Steps */}
            <div className="space-y-0">
              {/* Step 1 */}
              <button
                onClick={() => setStep(1)}
                className={`flex w-full items-center gap-3.5 rounded-xl px-3 py-3 text-left transition-colors ${
                  step === 1 ? 'bg-blue-50' : ''
                }`}
              >
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-colors ${
                  step === 1 ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-400'
                }`}>
                  1
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${step === 1 ? 'text-gray-900' : 'text-gray-400'}`}>
                    Tap the Share button
                  </p>
                  {step === 1 && (
                    <p className="mt-0.5 text-xs text-gray-500">
                      The{' '}
                      <span className="inline-flex items-center align-middle">
                        <ShareIcon className="inline h-4 w-4 text-blue-500" />
                      </span>
                      {' '}icon at the bottom of Safari
                    </p>
                  )}
                </div>
                {step === 1 && (
                  <div className="shrink-0 animate-bounce">
                    <svg className="h-5 w-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                    </svg>
                  </div>
                )}
              </button>

              {/* Step 2 */}
              <button
                onClick={() => setStep(2)}
                className={`flex w-full items-center gap-3.5 rounded-xl px-3 py-3 text-left transition-colors ${
                  step === 2 ? 'bg-blue-50' : ''
                }`}
              >
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-colors ${
                  step === 2 ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-400'
                }`}>
                  2
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${step === 2 ? 'text-gray-900' : 'text-gray-400'}`}>
                    Tap &quot;Add to Home Screen&quot;
                  </p>
                  {step === 2 && (
                    <p className="mt-0.5 text-xs text-gray-500">
                      Scroll down in the share menu to find it
                    </p>
                  )}
                </div>
                {step === 2 && (
                  <div className="shrink-0">
                    <span className="inline-flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">
                      <PlusIcon className="h-3.5 w-3.5" />
                      Add
                    </span>
                  </div>
                )}
              </button>

              {/* Step 3 */}
              <button
                onClick={() => setStep(3)}
                className={`flex w-full items-center gap-3.5 rounded-xl px-3 py-3 text-left transition-colors ${
                  step === 3 ? 'bg-blue-50' : ''
                }`}
              >
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-colors ${
                  step === 3 ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-400'
                }`}>
                  3
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${step === 3 ? 'text-gray-900' : 'text-gray-400'}`}>
                    Open from Home Screen &amp; enable alerts
                  </p>
                  {step === 3 && (
                    <p className="mt-0.5 text-xs text-gray-500">
                      Tap the {appName} icon, then enable notifications
                    </p>
                  )}
                </div>
                {step === 3 && (
                  <div className="shrink-0">
                    <svg className="h-5 w-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
              </button>
            </div>

            {/* Visual hint — bouncing arrow pointing to Safari's share button */}
            {step === 1 && (
              <div className="mt-4 flex flex-col items-center">
                <p className="text-xs font-medium text-blue-500 animate-pulse">
                  ↓ Tap the share icon below ↓
                </p>
              </div>
            )}

            {/* Time estimate */}
            <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-gray-400">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>Takes about 10 seconds</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Safari share icon (square with up arrow) */
function ShareIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );
}

/** Plus icon for Add to Home Screen */
function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
