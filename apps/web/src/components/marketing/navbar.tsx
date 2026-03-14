'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Menu, X } from 'lucide-react';

const navLinks = [
  { href: '/', label: 'Overview' },
  { href: '/solutions', label: 'Solutions' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/how-it-works', label: 'How It Works' },
  { href: '/contact', label: 'Contact' },
];

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-gray-100 bg-white backdrop-blur-xl">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
        <Link href="/" className="flex items-baseline gap-1.5">
          <span className="text-[17px] font-semibold tracking-tight text-gray-900">QueueFlow</span>
        </Link>

        <div className="hidden items-center gap-8 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-[13px] font-medium text-gray-500 transition-colors hover:text-gray-900"
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="hidden items-center gap-4 md:flex">
          <Link
            href="/login"
            className="text-[13px] font-medium text-gray-500 transition-colors hover:text-gray-900"
          >
            Log in
          </Link>
          <Link
            href="/register"
            className="rounded-lg bg-gray-900 px-4 py-2 text-[13px] font-medium text-white transition hover:bg-gray-800"
          >
            Start free
          </Link>
        </div>

        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="rounded-lg p-2 text-gray-400 hover:text-gray-900 md:hidden"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </nav>

      {mobileOpen && (
        <div className="border-t border-gray-100 bg-white px-6 py-4 md:hidden">
          <div className="flex flex-col gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              >
                {link.label}
              </Link>
            ))}
            <hr className="my-2 border-gray-100" />
            <Link
              href="/login"
              onClick={() => setMobileOpen(false)}
              className="rounded-lg px-3 py-2.5 text-sm font-medium text-gray-500 hover:bg-gray-50"
            >
              Log in
            </Link>
            <Link
              href="/register"
              onClick={() => setMobileOpen(false)}
              className="mt-1 rounded-lg bg-gray-900 px-3 py-2.5 text-center text-sm font-medium text-white"
            >
              Start free
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
