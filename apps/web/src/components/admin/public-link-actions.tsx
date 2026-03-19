'use client';

import { useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, ExternalLink, QrCode, Download } from 'lucide-react';

interface PublicLinkActionsProps {
  path: string;
  qrTitle: string;
  qrDescription?: string;
  downloadName?: string;
  buttonClassName?: string;
}

export function PublicLinkActions({
  path,
  qrTitle,
  qrDescription,
  downloadName = 'qflo-link.png',
  buttonClassName = 'rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted',
}: PublicLinkActionsProps) {
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [showQr, setShowQr] = useState(false);
  const [isGeneratingQr, setIsGeneratingQr] = useState(false);

  const absoluteUrl = useMemo(() => {
    if (typeof window === 'undefined') {
      return path;
    }

    return new URL(path, window.location.origin).toString();
  }, [path]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(absoluteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const el = document.createElement('textarea');
      el.value = absoluteUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  async function handleShowQr() {
    setIsGeneratingQr(true);

    try {
      const dataUrl = await QRCode.toDataURL(absoluteUrl, {
        width: 320,
        margin: 2,
        color: { dark: '#111827', light: '#ffffff' },
      });
      setQrDataUrl(dataUrl);
      setShowQr(true);
    } finally {
      setIsGeneratingQr(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <a
          href={path}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClassName}
        >
          <span className="inline-flex items-center gap-2">
            <ExternalLink className="h-4 w-4" />
            Open
          </span>
        </a>
        <button type="button" onClick={handleCopy} className={buttonClassName}>
          <span className="inline-flex items-center gap-2">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Copied' : 'Copy link'}
          </span>
        </button>
        <button
          type="button"
          onClick={handleShowQr}
          disabled={isGeneratingQr}
          className={buttonClassName}
        >
          <span className="inline-flex items-center gap-2">
            <QrCode className="h-4 w-4" />
            {isGeneratingQr ? 'Loading...' : 'QR code'}
          </span>
        </button>
      </div>

      {showQr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowQr(false)} />
          <div className="relative z-10 w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-foreground">{qrTitle}</h3>
            {qrDescription ? (
              <p className="mt-1 text-sm text-muted-foreground">{qrDescription}</p>
            ) : null}

            <div className="mt-4 flex justify-center rounded-2xl bg-white p-4">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt={qrTitle} className="h-64 w-64" />
              ) : (
                <div className="flex h-64 w-64 items-center justify-center text-sm text-muted-foreground">
                  Preparing QR code...
                </div>
              )}
            </div>

            <p className="mt-3 break-all text-xs text-muted-foreground">{absoluteUrl}</p>

            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={handleCopy}
                className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                {copied ? 'Copied' : 'Copy link'}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!qrDataUrl) return;
                  const link = document.createElement('a');
                  link.download = downloadName;
                  link.href = qrDataUrl;
                  link.click();
                }}
                className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <span className="inline-flex items-center gap-2">
                  <Download className="h-4 w-4" />
                  Download
                </span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowQr(false)}
              className="mt-3 w-full rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
