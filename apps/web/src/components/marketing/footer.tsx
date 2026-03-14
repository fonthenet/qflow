import Link from 'next/link';

const footerLinks = {
  Product: [
    { href: '/', label: 'Overview' },
    { href: '/solutions', label: 'Solutions' },
    { href: '/pricing', label: 'Pricing' },
    { href: '/how-it-works', label: 'How It Works' },
  ],
  Solutions: [
    { href: '/solutions/restaurants', label: 'Restaurants' },
    { href: '/solutions/clinics', label: 'Healthcare' },
    { href: '/solutions/government', label: 'Government' },
    { href: '/solutions/banks', label: 'Banks' },
    { href: '/solutions/retail', label: 'Retail' },
  ],
  Company: [
    { href: '/contact', label: 'Contact' },
    { href: '/login', label: 'Log in' },
    { href: '/register', label: 'Sign up' },
  ],
  Trust: [
    { href: '/privacy', label: 'Privacy' },
    { href: '/terms', label: 'Terms' },
  ],
};

export function Footer() {
  return (
    <footer className="border-t border-gray-100 bg-white">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="grid gap-10 md:grid-cols-[1.2fr_repeat(4,minmax(0,1fr))]">
          <div className="space-y-3">
            <span className="text-[15px] font-semibold text-gray-900">QueueFlow</span>
            <p className="max-w-xs text-[13px] leading-relaxed text-gray-500">
              Customer flow software for service businesses managing arrivals, waiting, bookings, reservations, and
              handoff in one place.
            </p>
          </div>

          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category}>
              <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">{category}</h3>
              <ul className="space-y-2">
                {links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-[13px] text-gray-500 transition-colors hover:text-gray-900">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-gray-100 pt-6 md:flex-row">
          <p className="text-[12px] text-gray-400">&copy; {new Date().getFullYear()} QueueFlow. All rights reserved.</p>
          <div className="flex gap-6">
            <Link href="/privacy" className="text-[12px] text-gray-400 hover:text-gray-600">Privacy Policy</Link>
            <Link href="/terms" className="text-[12px] text-gray-400 hover:text-gray-600">Terms of Service</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
