'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/components/providers/locale-provider';

/**
 * One-click WhatsApp Embedded Signup.
 *
 * Loads Meta's Facebook JS SDK, opens the Embedded Signup popup, and posts
 * the returned { code, waba_id, phone_number_id } to our callback endpoint
 * which handles token exchange, webhook subscription, phone registration
 * and template provisioning.
 *
 * Gracefully disables itself when Qflo's Meta app env vars aren't set — in
 * that case tenants stay on the shared Qflo number (the default).
 */

interface Config {
  enabled: boolean;
  appId: string;
  configId: string;
}

declare global {
  interface Window {
    FB?: any;
    fbAsyncInit?: () => void;
  }
}

export function WhatsAppEmbeddedSignupButton({
  onConnected,
}: {
  onConnected?: () => void;
}) {
  const { t } = useI18n();
  const [config, setConfig] = useState<Config | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [sdkReady, setSdkReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/whatsapp/embedded-signup/config')
      .then((r) => r.json())
      .then((c: Config) => {
        if (!cancelled) {
          setConfig(c);
          setLoadingConfig(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setConfig({ enabled: false, appId: '', configId: '' });
          setLoadingConfig(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!config?.enabled || !config.appId) return;
    // Load Facebook SDK once
    if (window.FB) {
      setSdkReady(true);
      return;
    }
    window.fbAsyncInit = () => {
      window.FB?.init({
        appId: config.appId,
        cookie: true,
        xfbml: false,
        version: 'v22.0',
      });
      setSdkReady(true);
    };
    const existing = document.getElementById('facebook-jssdk');
    if (existing) return;
    const script = document.createElement('script');
    script.id = 'facebook-jssdk';
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    document.body.appendChild(script);
  }, [config]);

  function handleConnect() {
    if (!window.FB || !config) return;
    setError(null);
    setSuccess(null);

    // Listen for the Embedded Signup session_info postMessage
    const messageListener = (ev: MessageEvent) => {
      if (!ev.data || typeof ev.data !== 'object') return;
      if (ev.origin !== 'https://www.facebook.com' && ev.origin !== 'https://web.facebook.com') return;
      try {
        const data = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
        if (data?.type === 'WA_EMBEDDED_SIGNUP') {
          (window as any).__qfloEsPayload = data.data;
        }
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('message', messageListener);

    window.FB.login(
      (response: any) => {
        window.removeEventListener('message', messageListener);
        const code = response?.authResponse?.code;
        const payload = (window as any).__qfloEsPayload ?? {};
        const wabaId = payload?.waba_id;
        const phoneNumberId = payload?.phone_number_id;

        if (!code) {
          setError(t('Sign-in was cancelled.'));
          return;
        }
        if (!wabaId || !phoneNumberId) {
          setError(
            t('Meta did not return WABA / phone number info. Please retry the flow.'),
          );
          return;
        }

        setSubmitting(true);
        fetch('/api/whatsapp/embedded-signup/callback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code,
            waba_id: wabaId,
            phone_number_id: phoneNumberId,
          }),
        })
          .then(async (r) => {
            const body = await r.json().catch(() => ({}));
            if (!r.ok) {
              setError(body?.error ?? t('Failed to complete WhatsApp setup.'));
              return;
            }
            const submitted = body?.templates?.submitted ?? 0;
            const attempted = body?.templates?.attempted ?? 0;
            setSuccess(
              t('WhatsApp connected. Templates submitted: {submitted}/{attempted}')
                .replace('{submitted}', String(submitted))
                .replace('{attempted}', String(attempted)),
            );
            onConnected?.();
          })
          .catch(() => {
            setError(t('Network error — please retry.'));
          })
          .finally(() => setSubmitting(false));
      },
      {
        config_id: config.configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: { solutionID: config.configId }, version: 'v3' },
      },
    );
  }

  if (loadingConfig) {
    return (
      <div className="text-xs text-muted-foreground">
        {t('Checking WhatsApp integration…')}
      </div>
    );
  }

  if (!config?.enabled) {
    return (
      <div
        className="rounded-lg border px-4 py-3 text-sm"
        style={{ background: 'var(--surface2)', borderColor: 'var(--border)', color: 'var(--text)' }}
      >
        <p className="font-medium">{t('Use your own WhatsApp number (optional)')}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t(
            'Embedded Signup is not enabled on this Qflo instance yet. Until it is, your customers receive messages from the shared Qflo WhatsApp number. No action needed.',
          )}
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border px-4 py-4 space-y-3"
      style={{ background: 'var(--surface2)', borderColor: 'var(--border)', color: 'var(--text)' }}
    >
      <div>
        <p className="text-sm font-medium">{t('Use your own WhatsApp number (optional)')}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t(
            'Connect your own WhatsApp Business number so customers see your business name as the sender. Qflo handles the setup. Takes ~5 minutes; display-name approval takes 1–3 days.',
          )}
        </p>
      </div>
      <button
        type="button"
        onClick={handleConnect}
        disabled={!sdkReady || submitting}
        className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60 transition-colors"
        style={{ background: '#1877F2' }}
      >
        {submitting
          ? t('Finishing setup…')
          : sdkReady
            ? t('Connect with Facebook')
            : t('Loading…')}
      </button>
      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          {success}
        </div>
      )}
    </div>
  );
}
