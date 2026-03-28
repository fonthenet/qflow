'use client';

import { useState } from 'react';
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
  const { t } = useI18n();

  async function handleSubmit(formData: FormData) {
    setError(null);
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
          <form action={handleSubmit} className="space-y-5">
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
                required
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
                required
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder={t('Enter your password')}
              />
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
