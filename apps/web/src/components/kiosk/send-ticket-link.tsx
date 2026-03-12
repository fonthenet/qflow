'use client';

import { useState } from 'react';

interface SendTicketLinkProps {
  ticketUrl: string;
  ticketNumber: string;
  officeName: string;
}

export function SendTicketLink({ ticketUrl, ticketNumber, officeName }: SendTicketLinkProps) {
  const [mode, setMode] = useState<'choose' | 'sms' | 'email'>('choose');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  const message = `Your ticket ${ticketNumber} at ${officeName}. Track your position: ${ticketUrl}`;

  function handleSendSMS() {
    // Use sms: URI scheme — opens the user's SMS app with pre-filled message
    const smsUrl = `sms:${phone}?body=${encodeURIComponent(message)}`;
    window.open(smsUrl, '_blank');
    setSent(true);
  }

  function handleSendEmail() {
    const subject = `Your Queue Ticket: ${ticketNumber} — ${officeName}`;
    const body = `Hello,\n\nYour ticket number is ${ticketNumber} at ${officeName}.\n\nTrack your position in the queue here:\n${ticketUrl}\n\nKeep this link open to receive notifications when it's your turn.`;
    const mailtoUrl = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(mailtoUrl, '_blank');
    setSent(true);
  }

  function handleCopyLink() {
    navigator.clipboard.writeText(ticketUrl).then(() => {
      setSent(true);
      setTimeout(() => setSent(false), 2000);
    });
  }

  function reset() {
    setMode('choose');
    setPhone('');
    setEmail('');
    setSent(false);
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="mb-3 text-center text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        Get your tracking link
      </p>

      {mode === 'choose' && (
        <div className="grid grid-cols-3 gap-3">
          {/* SMS */}
          <button
            onClick={() => setMode('sms')}
            className="flex flex-col items-center gap-2 rounded-lg border border-border bg-background p-4 hover:border-primary hover:bg-primary/5 transition-all"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            <span className="text-sm font-medium">SMS</span>
          </button>

          {/* Email */}
          <button
            onClick={() => setMode('email')}
            className="flex flex-col items-center gap-2 rounded-lg border border-border bg-background p-4 hover:border-primary hover:bg-primary/5 transition-all"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <span className="text-sm font-medium">Email</span>
          </button>

          {/* Copy Link */}
          <button
            onClick={handleCopyLink}
            className="flex flex-col items-center gap-2 rounded-lg border border-border bg-background p-4 hover:border-primary hover:bg-primary/5 transition-all"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
            </svg>
            <span className="text-sm font-medium">{sent ? 'Copied!' : 'Copy Link'}</span>
          </button>
        </div>
      )}

      {mode === 'sms' && (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-muted-foreground">Phone number</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="07 123 456 78"
              className="w-full rounded-lg border border-border bg-background px-4 py-3 text-lg focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              autoFocus
            />
          </div>
          {sent ? (
            <div className="flex items-center justify-center gap-2 rounded-lg bg-green-50 py-3 text-green-700">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span className="font-medium">SMS app opened!</span>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={reset}
                className="rounded-lg border border-border bg-background px-4 py-3 text-sm font-medium hover:bg-muted transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleSendSMS}
                disabled={!phone.trim()}
                className="flex-1 rounded-lg bg-green-600 px-4 py-3 text-sm font-medium text-white hover:bg-green-700 transition-colors disabled:opacity-50"
              >
                Send via SMS
              </button>
            </div>
          )}
        </div>
      )}

      {mode === 'email' && (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-muted-foreground">Email address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="customer@example.com"
              className="w-full rounded-lg border border-border bg-background px-4 py-3 text-lg focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              autoFocus
            />
          </div>
          {sent ? (
            <div className="flex items-center justify-center gap-2 rounded-lg bg-blue-50 py-3 text-blue-700">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span className="font-medium">Email app opened!</span>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={reset}
                className="rounded-lg border border-border bg-background px-4 py-3 text-sm font-medium hover:bg-muted transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleSendEmail}
                disabled={!email.trim()}
                className="flex-1 rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                Send via Email
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
