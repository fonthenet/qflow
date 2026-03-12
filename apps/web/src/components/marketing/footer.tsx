import Link from 'next/link';

const footerLinks = {
  Product: [
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
};

export function Footer() {
  return (
    <footer className="border-t border-border bg-muted/30">
      <div className="mx-auto max-w-7xl px-6 py-16">
        <div className="grid gap-12 md:grid-cols-4">
          {/* Brand */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-black text-primary-foreground">
                Q
              </div>
              <span className="text-lg font-bold">
                Queue<span className="text-primary">Flow</span>
              </span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Smart queue management for modern businesses. Free push notifications, no SMS fees.
            </p>
          </div>

          {/* Link Columns */}
          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category}>
              <h3 className="mb-4 text-sm font-semibold text-foreground">{category}</h3>
              <ul className="space-y-3">
                {links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-border pt-8 md:flex-row">
          <p className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} QueueFlow. All rights reserved.
          </p>
          <div className="flex gap-6">
            <Link href="#" className="text-sm text-muted-foreground hover:text-foreground">
              Privacy Policy
            </Link>
            <Link href="#" className="text-sm text-muted-foreground hover:text-foreground">
              Terms of Service
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
