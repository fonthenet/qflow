'use client';

import { useState, useTransition } from 'react';
import { useI18n } from '@/components/providers/locale-provider';
import { saveWhatsAppCredentials } from '@/lib/actions/whatsapp-actions';

interface Props {
  initialPhoneNumberId: string;
  initialBusinessAccountId: string;
  initialVerifyToken: string;
  hasToken: boolean;
  webhookBase: string;
}

const INPUT_STYLE: React.CSSProperties = {
  colorScheme: 'light dark',
  background: 'var(--bg)',
  color: 'var(--text)',
  borderColor: 'var(--border)',
};

function generateVerifyToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function WhatsAppSettingsClient({
  initialPhoneNumberId,
  initialBusinessAccountId,
  initialVerifyToken,
  hasToken,
  webhookBase,
}: Props) {
  const { t, locale } = useI18n();
  const isRtl = locale === 'ar';

  const [phoneNumberId, setPhoneNumberId] = useState(initialPhoneNumberId);
  const [accessToken, setAccessToken] = useState('');
  const [businessAccountId, setBusinessAccountId] = useState(initialBusinessAccountId);
  const [verifyToken, setVerifyToken] = useState(initialVerifyToken);
  const [showToken, setShowToken] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'loading' | 'ok' | 'fail'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [copied, setCopied] = useState(false);

  const webhookUrl = `${webhookBase}/api/channels/whatsapp/webhook`;
  const webhookDisplay = verifyToken
    ? `${webhookUrl}?verify_token=${verifyToken}`
    : webhookUrl;

  function handleGenerateToken() {
    setVerifyToken(generateVerifyToken());
  }

  function handleCopy() {
    navigator.clipboard.writeText(webhookDisplay).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleSave() {
    setSaveError(null);
    setSaveSuccess(false);
    startTransition(async () => {
      // If no new token entered and one already exists, we don't allow empty save
      // (user must provide a token to update credentials)
      if (!accessToken.trim() && !hasToken) {
        setSaveError(t('Access token is required.'));
        return;
      }
      if (!accessToken.trim() && hasToken) {
        // Saving non-token fields only — not supported via this form;
        // require re-entry to avoid accidental wipe
        setSaveError(t('Re-enter the access token to save changes.'));
        return;
      }

      const result = await saveWhatsAppCredentials({
        phone_number_id: phoneNumberId,
        access_token: accessToken,
        business_account_id: businessAccountId,
        verify_token: verifyToken,
      });

      if (result.ok) {
        setSaveSuccess(true);
        setAccessToken(''); // Clear plaintext from state immediately
      } else {
        setSaveError(result.error ?? t('An error occurred. Please try again.'));
      }
    });
  }

  function handleTestConnection() {
    setTestStatus('loading');
    setTestMessage('');
    fetch('/api/channels/whatsapp/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone_number_id: phoneNumberId }),
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (res.ok) {
          setTestStatus('ok');
          setTestMessage(body.name ?? t('Connection successful'));
        } else {
          setTestStatus('fail');
          setTestMessage(body.error ?? t('Connection failed'));
        }
      })
      .catch(() => {
        setTestStatus('fail');
        setTestMessage(t('Network error — check your connection.'));
      });
  }

  return (
    <div
      className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-5"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      {/* Phone Number ID */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">
          {t('Phone Number ID')} <span className="text-destructive">*</span>
        </label>
        <input
          type="text"
          value={phoneNumberId}
          onChange={(e) => setPhoneNumberId(e.target.value)}
          placeholder={t('From Meta App Dashboard → WhatsApp → API Setup')}
          style={INPUT_STYLE}
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          autoComplete="off"
        />
      </div>

      {/* Access Token */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">
          {t('Access Token')} <span className="text-destructive">*</span>
          {hasToken && (
            <span className="ms-2 text-xs font-normal text-muted-foreground">
              ({t('Token saved — re-enter to update')})
            </span>
          )}
        </label>
        <div className="relative">
          <input
            type={showToken ? 'text' : 'password'}
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            placeholder={hasToken ? t('Enter new token to replace existing') : t('Permanent or system user token from Meta')}
            style={INPUT_STYLE}
            className="w-full rounded-lg border px-3 py-2 pe-12 text-sm outline-none focus:ring-2 focus:ring-ring"
            autoComplete="new-password"
          />
          <button
            type="button"
            onClick={() => setShowToken((v) => !v)}
            className="absolute inset-y-0 end-0 flex items-center px-3 text-muted-foreground hover:text-foreground transition-colors"
            tabIndex={-1}
            aria-label={showToken ? t('Hide token') : t('Show token')}
          >
            {showToken ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074L3.707 2.293zM10 5c.812 0 1.595.116 2.333.332l-1.5 1.5A4 4 0 006.332 12.33l-1.86 1.86A8.002 8.002 0 012.032 10C3.093 6.842 6.275 5 10 5zm4.967 5.833a8 8 0 01-1.78 2.388l-1.423-1.424A4 4 0 0010.667 6.335l-1.5-1.5A8 8 0 0110 5c3.725 0 6.907 1.842 7.968 5l-.001.001a10.04 10.04 0 01-3 4.832z" clipRule="evenodd" />
              </svg>
            )}
          </button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('Encrypted with AES-256-GCM before storage. Never logged.')}
        </p>
      </div>

      {/* Business Account ID */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">
          {t('WhatsApp Business Account ID')} <span className="text-destructive">*</span>
        </label>
        <input
          type="text"
          value={businessAccountId}
          onChange={(e) => setBusinessAccountId(e.target.value)}
          placeholder={t('From Meta Business Manager → WhatsApp Accounts')}
          style={INPUT_STYLE}
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          autoComplete="off"
        />
      </div>

      {/* Verify Token */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">
          {t('Webhook Verify Token')} <span className="text-destructive">*</span>
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={verifyToken}
            onChange={(e) => setVerifyToken(e.target.value)}
            placeholder={t('Random secret — paste this into Meta App Dashboard')}
            style={INPUT_STYLE}
            className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring font-mono"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={handleGenerateToken}
            className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface2 transition-colors"
            style={{ background: 'var(--surface2)', color: 'var(--text)' }}
          >
            {t('Generate')}
          </button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('Used by Meta to verify your webhook endpoint.')}
        </p>
      </div>

      {/* Webhook URL copy box */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">
          {t('Your Webhook URL')}
        </label>
        <div
          className="flex items-center gap-2 rounded-lg border px-3 py-2"
          style={{ background: 'var(--surface2)', borderColor: 'var(--border)' }}
        >
          <span
            className="flex-1 truncate font-mono text-xs"
            style={{ color: 'var(--text)' }}
          >
            {webhookDisplay}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            className="shrink-0 text-xs text-muted-foreground hover:text-foreground transition-colors"
            aria-label={t('Copy webhook URL')}
          >
            {copied ? t('Copied!') : t('Copy')}
          </button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('Paste this URL in Meta App Dashboard → WhatsApp → Configuration → Webhook.')}
        </p>
      </div>

      {/* Feedback */}
      {saveError && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {saveError}
        </div>
      )}
      {saveSuccess && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          {t('WhatsApp credentials saved successfully.')}
        </div>
      )}

      {/* Test connection status */}
      {testStatus === 'ok' && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          {t('Connection successful')}{testMessage ? `: ${testMessage}` : ''}
        </div>
      )}
      {testStatus === 'fail' && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {t('Connection failed')}: {testMessage}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending}
          className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition-colors"
        >
          {isPending ? t('Saving…') : t('Save Credentials')}
        </button>
        <button
          type="button"
          onClick={handleTestConnection}
          disabled={testStatus === 'loading' || !phoneNumberId || !hasToken}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-surface2 disabled:opacity-50 transition-colors"
          style={{ background: 'var(--surface)', color: 'var(--text)', borderColor: 'var(--border)' }}
          title={!hasToken ? t('Save credentials first before testing') : undefined}
        >
          {testStatus === 'loading' ? t('Testing…') : t('Test Connection')}
        </button>
      </div>
    </div>
  );
}
