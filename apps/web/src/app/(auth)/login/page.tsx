'use client';

import { useState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { login } from '@/lib/actions/auth-actions';
import { useI18n } from '@/components/providers/locale-provider';

function SubmitButton() {
  const { pending } = useFormStatus();
  const { t } = useI18n();

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-50"
    >
      {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {pending ? t('Signing in...') : t('Sign In')}
    </button>
  );
}

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberPassword, setRememberPassword] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    const savedEmail = localStorage.getItem('qflo_saved_email');
    if (savedEmail) setEmail(savedEmail);

    const rememberPref = localStorage.getItem('qflo_remember_password') === 'true';
    setRememberPassword(rememberPref);

    // Migrate: remove any legacy plaintext password from localStorage
    try { localStorage.removeItem('qflo_saved_password'); } catch {}
  }, []);

  async function handleSubmit(formData: FormData) {
    setError(null);

    const emailValue = (formData.get('email') as string | null)?.trim() ?? '';
    const passwordValue = (formData.get('password') as string | null) ?? '';

    // Inline validation — avoids Chromium's dark native validation tooltip.
    if (!emailValue) return setError(t('Email is required.'));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) return setError(t('Enter a valid email address.'));
    if (!passwordValue) return setError(t('Password is required.'));

    localStorage.setItem('qflo_saved_email', emailValue);
    localStorage.setItem('qflo_remember_password', rememberPassword ? 'true' : 'false');

    // Password no longer stored in localStorage (security fix)
    // Web uses Supabase session cookies for persistence

    const result = await login(formData);
    if (result?.error) {
      setError(result.error);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/5 via-background to-primary/10 px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold">
            Q<span className="text-primary">flo</span>
          </h1>
          <p className="mt-2 text-muted-foreground">{t('Sign in to your account')}</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-8 shadow-sm">
          <form action={handleSubmit} noValidate className="space-y-5">
            {error && (
              <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium">
                {t('Email')}
              </label>
              <input
                id="email"
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="you@company.com"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium">
                {t('Password')}
              </label>
              <input
                id="password"
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder={t('Enter your password')}
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                id="rememberPassword"
                type="checkbox"
                checked={rememberPassword}
                onChange={(e) => setRememberPassword(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              <label htmlFor="rememberPassword" className="text-sm text-muted-foreground">
                {t('Remember password')}
              </label>
            </div>

            <SubmitButton />
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {t("Don't have an account?")}{' '}
            <Link href="/register" className="font-medium text-primary hover:underline">
              {t('Register your business')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
