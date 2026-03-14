'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Mail } from 'lucide-react';
import { login, requestMagicLink } from '@/lib/actions/auth-actions';
import { AuthShell } from '@/components/auth/auth-shell';

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [magicError, setMagicError] = useState<string | null>(null);
  const [magicSent, setMagicSent] = useState(false);
  const [magicLoading, setMagicLoading] = useState(false);

  async function handlePasswordLogin(formData: FormData) {
    setLoading(true);
    setError(null);
    const result = await login(formData);
    if (result?.error) {
      setError(result.error);
      setLoading(false);
    }
  }

  async function handleMagicLink(formData: FormData) {
    setMagicLoading(true);
    setMagicSent(false);
    setMagicError(null);
    const result = await requestMagicLink(formData);
    if (result?.error) {
      setMagicError(result.error);
      setMagicLoading(false);
      return;
    }
    setMagicSent(true);
    setMagicLoading(false);
  }

  return (
    <AuthShell
      eyebrow="Sign in"
      title="Return to the command center without losing the thread."
      description="Use your password or request a secure email link. QueueFlow will route you back into the right workspace and resume onboarding if your setup is still in progress."
      footer={
        <>
          Need a new workspace?{' '}
          <Link href="/register" className="font-semibold text-slate-900 transition hover:text-slate-700">
            Create one
          </Link>
        </>
      }
    >
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Welcome back</p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Sign in to QueueFlow</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Jump back into the customer flow workspace with the sign-in method that fits your team.
        </p>
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <form action={handlePasswordLogin} className="space-y-4 rounded-[28px] border border-slate-200 bg-[#fbfaf8] p-5">
          <div>
            <p className="text-sm font-semibold text-slate-900">Password sign-in</p>
            <p className="mt-1 text-sm leading-6 text-slate-500">Use your account password if you already sign in that way.</p>
          </div>

          {error && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="email" className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              className="flex h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-slate-400"
              placeholder="you@business.com"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              className="flex h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-slate-400"
              placeholder="Enter your password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#10292f] px-5 text-sm font-semibold text-white transition hover:bg-[#18383f] disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign in with password'}
            {!loading ? <ArrowRight className="h-4 w-4" /> : null}
          </button>
        </form>

        <form action={handleMagicLink} className="space-y-4 rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_16px_32px_rgba(15,23,42,0.04)]">
          <div>
            <p className="text-sm font-semibold text-slate-900">Email magic link</p>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              Send yourself a secure sign-in link and jump straight back into QueueFlow.
            </p>
          </div>

          {magicSent && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              Magic link sent. Check your inbox and open it on this device.
            </div>
          )}

          {magicError && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {magicError}
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="magic-email" className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Email
            </label>
            <input
              id="magic-email"
              name="email"
              type="email"
              required
              className="flex h-12 w-full rounded-2xl border border-slate-200 bg-[#fbfaf8] px-4 text-sm text-slate-900 outline-none transition focus:border-slate-400"
              placeholder="you@business.com"
            />
          </div>

          <button
            type="submit"
            disabled={magicLoading}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-800 transition hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50"
          >
            <Mail className="h-4 w-4" />
            {magicLoading ? 'Sending link...' : 'Email me a sign-in link'}
          </button>

          <div className="rounded-[24px] border border-slate-100 bg-[#f6f7f4] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">When to use it</p>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
              <li>If you are signing in on a shared or new device.</li>
              <li>If your team prefers passwordless entry.</li>
              <li>If onboarding is still underway and you want to resume quickly.</li>
            </ul>
          </div>
        </form>
      </div>
    </AuthShell>
  );
}
