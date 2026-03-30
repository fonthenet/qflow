'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { useI18n } from '@/components/providers/locale-provider';
import { LanguageSwitcher } from '@/components/shared/language-switcher';

const navLinks = [
  { href: '/solutions', label: 'Solutions' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/how-it-works', label: 'How It Works' },
  { href: '/resources', label: 'Resources' },
  { href: '/contact', label: 'Contact' },
];

interface NavbarProps {
  signedIn?: boolean;
  organizationName?: string | null;
}

export function Navbar({ signedIn = false, organizationName }: NavbarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { t } = useI18n();
  const signedInLabel = organizationName
    ? t('Signed in to {organization}', { organization: organizationName })
    : t('Signed in');

  return (
    <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-lg">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-lg font-black text-primary-foreground">
            Q
          </div>
          <span className="text-xl font-bold tracking-tight">
            Q<span className="text-primary">flo</span>
          </span>
        </Link>

        {/* Desktop Nav */}
        <div className="hidden items-center gap-8 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {t(link.label)}
            </Link>
          ))}
        </div>

        {/* Desktop CTA */}
        <div className="hidden items-center gap-3 md:flex">
          <LanguageSwitcher />
          {signedIn ? (
            <>
              <span className="rounded-full border border-primary/15 bg-primary/5 px-3 py-1.5 text-sm font-medium text-primary">
                {signedInLabel}
              </span>
              <Link
                href="/admin/offices"
                className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 hover:shadow-md"
              >
                {t('Open Dashboard')}
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {t('Log in')}
              </Link>
              <Link
                href="/register"
                className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 hover:shadow-md"
              >
                {t('Get Started Free')}
              </Link>
            </>
          )}
        </div>

        {/* Mobile Menu Button */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="md:hidden rounded-lg p-2 text-muted-foreground hover:bg-muted"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </nav>

      {/* Mobile Menu */}
      {mobileOpen && (
        <div className="border-t border-border bg-background px-6 py-4 md:hidden">
          <div className="flex flex-col gap-3">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-foreground hover:bg-muted"
              >
                {t(link.label)}
              </Link>
            ))}
            <hr className="my-2 border-border" />
            <LanguageSwitcher />
            {signedIn ? (
              <>
                <div className="rounded-lg px-3 py-2 text-sm font-medium text-primary">
                  {signedInLabel}
                </div>
                <Link
                  href="/admin/offices"
                  onClick={() => setMobileOpen(false)}
                  className="rounded-lg bg-primary px-3 py-2.5 text-center text-sm font-semibold text-primary-foreground"
                >
                  {t('Open Dashboard')}
                </Link>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  onClick={() => setMobileOpen(false)}
                  className="rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted"
                >
                  {t('Log in')}
                </Link>
                <Link
                  href="/register"
                  onClick={() => setMobileOpen(false)}
                  className="rounded-lg bg-primary px-3 py-2.5 text-center text-sm font-semibold text-primary-foreground"
                >
                  {t('Get Started Free')}
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
