'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useI18n } from '@/components/providers/locale-provider';

export function SandboxQrCard({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}) {
  const { t } = useI18n();
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [absoluteUrl, setAbsoluteUrl] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const nextUrl = `${window.location.origin}${path}`;
    setAbsoluteUrl(nextUrl);

    QRCode.toDataURL(nextUrl, {
      width: 220,
      margin: 1,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''));
  }, [path]);

  async function handleCopy() {
    if (!absoluteUrl || typeof navigator === 'undefined') return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(absoluteUrl);
      } else if (typeof document !== 'undefined') {
        const textarea = document.createElement('textarea');
        textarea.value = absoluteUrl;
        textarea.setAttribute('readonly', 'true');
        textarea.style.position = 'absolute';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }

      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="rounded-[1.75rem] border border-border bg-white p-5 shadow-sm">
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary/80">{title}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
      <div className="mt-4 flex justify-center rounded-[1.5rem] border border-border bg-slate-50 p-4">
        {qrDataUrl ? (
          <img src={qrDataUrl} alt={title} className="h-52 w-52 rounded-xl bg-white p-2" />
        ) : (
          <div className="flex h-52 w-52 items-center justify-center rounded-xl bg-white text-sm text-muted-foreground">
            {t('Preparing QR')}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => void handleCopy()}
        className="mt-4 w-full rounded-xl border border-border px-4 py-3 text-sm font-medium text-foreground hover:bg-muted"
      >
        {copied ? t('Copied') : t('Copy sandbox link')}
      </button>
    </div>
  );
}
