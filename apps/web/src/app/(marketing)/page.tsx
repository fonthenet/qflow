import Link from 'next/link';
import {
  QrCode, Bell, Monitor, Clock, Users, Shield,
  Smartphone, BarChart3, Zap, Globe, Tablet, Calendar,
  ArrowRight, Check, ChevronRight,
} from 'lucide-react';

const features = [
  {
    icon: QrCode,
    title: 'QR Code Check-In',
    description: 'Customers scan a QR code to join your queue — no app download, no signup required.',
  },
  {
    icon: Bell,
    title: 'Free Push Notifications',
    description: 'Unlimited push notifications on all plans. No SMS fees, no WhatsApp charges. Ever.',
  },
  {
    icon: Monitor,
    title: 'TV Display Boards',
    description: 'Show real-time queue status on lobby screens with 3 layout options and dark/light themes.',
  },
  {
    icon: Clock,
    title: 'Real-Time Tracking',
    description: 'Customers see their exact position and estimated wait time, updated live on their phone.',
  },
  {
    icon: Users,
    title: 'Multi-Department',
    description: 'Run separate queues for different departments — each with its own numbering and counters.',
  },
  {
    icon: Shield,
    title: 'Priority Queue',
    description: 'Configurable priority categories for elderly, disabled, VIP, or any custom group.',
  },
  {
    icon: Tablet,
    title: 'Self-Service Kiosk',
    description: 'Touch-screen kiosk mode for lobbies — customers select their service and get a ticket.',
  },
  {
    icon: Calendar,
    title: 'Appointments',
    description: 'Online booking with walk-in/appointment hybrid mode — automated interleaving.',
  },
  {
    icon: Globe,
    title: 'Virtual Queue',
    description: 'Customers join remotely from anywhere — wait at home and arrive when it\'s their turn.',
  },
];

const industries = [
  { name: 'Restaurants', slug: 'restaurants', icon: '🍽️' },
  { name: 'Clinics', slug: 'clinics', icon: '🏥' },
  { name: 'Retail', slug: 'retail', icon: '🛍️' },
  { name: 'Government', slug: 'government', icon: '🏛️' },
  { name: 'Banks', slug: 'banks', icon: '🏦' },
  { name: 'Hotels', slug: 'hotels', icon: '🏨' },
  { name: 'Barbershops', slug: 'barbershops', icon: '💈' },
  { name: 'Pharmacies', slug: 'pharmacies', icon: '💊' },
];

const steps = [
  { number: '01', title: 'Sign Up in 2 Minutes', description: 'Create your account, choose your industry template, and your queue system is ready.' },
  { number: '02', title: 'Share Your QR Code', description: 'Print or display the QR code. Customers scan to join — no app needed.' },
  { number: '03', title: 'Manage Your Queue', description: 'Call next, serve, track — all from your dashboard. Customers get notified instantly.' },
];

export default function HomePage() {
  return (
    <>
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-primary/10" />
        <div className="relative mx-auto max-w-7xl px-6 py-24 md:py-32">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-sm font-medium text-primary">
              <Zap className="h-3.5 w-3.5" />
              Unlimited free push notifications
            </div>
            <h1 className="text-5xl font-extrabold tracking-tight md:text-6xl lg:text-7xl">
              Smart Queue Management for{' '}
              <span className="bg-gradient-to-r from-primary to-blue-400 bg-clip-text text-transparent">
                Modern Business
              </span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground md:text-xl">
              Customers scan a QR code to join your queue, track their position in real-time, and get notified when it&apos;s their turn. No app download. No SMS fees.
            </p>
            <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Link
                href="/register"
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-8 py-4 text-base font-semibold text-primary-foreground shadow-lg transition-all hover:bg-primary/90 hover:shadow-xl hover:-translate-y-0.5"
              >
                Get Started Free
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/how-it-works"
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-8 py-4 text-base font-semibold shadow-sm transition-all hover:bg-muted"
              >
                See How It Works
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              Free forever for up to 50 customers/month. No credit card required.
            </p>
          </div>
        </div>
      </section>

      {/* Social Proof Bar */}
      <section className="border-y border-border bg-muted/30 py-8">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
            {[
              { value: '0', label: 'Cost per notification' },
              { value: '<3 min', label: 'Setup time' },
              { value: '0', label: 'Apps to download' },
              { value: '99.9%', label: 'Uptime SLA' },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <p className="text-3xl font-extrabold text-primary">{stat.value}</p>
                <p className="mt-1 text-sm text-muted-foreground">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
              Everything You Need to Manage Queues
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              From QR check-in to TV display boards — a complete queue management platform with zero per-message fees.
            </p>
          </div>
          <div className="mt-16 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="group rounded-2xl border border-border bg-card p-6 transition-all hover:border-primary/30 hover:shadow-lg"
              >
                <div className="mb-4 inline-flex rounded-xl bg-primary/10 p-3 text-primary">
                  <feature.icon className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-semibold">{feature.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works (Brief) */}
      <section className="border-y border-border bg-muted/20 py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
              Up and Running in 3 Steps
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              No complex setup. No training needed. Start managing queues in minutes.
            </p>
          </div>
          <div className="mt-16 grid gap-8 md:grid-cols-3">
            {steps.map((step) => (
              <div key={step.number} className="relative text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-2xl font-extrabold text-primary-foreground">
                  {step.number}
                </div>
                <h3 className="text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{step.description}</p>
              </div>
            ))}
          </div>
          <div className="mt-12 text-center">
            <Link
              href="/how-it-works"
              className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
            >
              Learn more about how it works
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Industry Solutions */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
              Built for Every Industry
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Pre-configured templates for your industry. Choose one and start in seconds.
            </p>
          </div>
          <div className="mt-16 grid grid-cols-2 gap-4 md:grid-cols-4">
            {industries.map((industry) => (
              <Link
                key={industry.slug}
                href={`/solutions/${industry.slug}`}
                className="group flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-6 text-center transition-all hover:border-primary/30 hover:shadow-lg"
              >
                <span className="text-4xl">{industry.icon}</span>
                <span className="text-sm font-semibold group-hover:text-primary transition-colors">
                  {industry.name}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Preview */}
      <section className="border-y border-border bg-muted/20 py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
              Simple, Transparent Pricing
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Start free. Upgrade as you grow. All plans include unlimited push notifications.
            </p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3 lg:grid-cols-5">
            {[
              { name: 'Free', price: '$0', desc: '50 customers/mo' },
              { name: 'Starter', price: '$19', desc: '500 customers/mo' },
              { name: 'Growth', price: '$49', desc: '2,000 customers/mo', highlight: true },
              { name: 'Pro', price: '$99', desc: '10,000 customers/mo' },
              { name: 'Enterprise', price: '$199', desc: 'Unlimited' },
            ].map((plan) => (
              <div
                key={plan.name}
                className={`rounded-2xl border p-6 text-center transition-all ${
                  plan.highlight
                    ? 'border-primary bg-primary/5 shadow-lg scale-105'
                    : 'border-border bg-card hover:border-primary/30'
                }`}
              >
                <p className="text-sm font-semibold text-muted-foreground">{plan.name}</p>
                <p className="mt-2 text-3xl font-extrabold">{plan.price}</p>
                <p className="mt-1 text-xs text-muted-foreground">/month</p>
                <p className="mt-3 text-sm text-muted-foreground">{plan.desc}</p>
              </div>
            ))}
          </div>
          <div className="mt-10 text-center">
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-8 py-3.5 text-sm font-semibold text-primary-foreground shadow transition-all hover:bg-primary/90"
            >
              View Full Pricing
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Why QueueFlow vs SMS */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-3xl">
            <div className="text-center">
              <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
                Why Pay for SMS When Push Is Free?
              </h2>
              <p className="mt-4 text-lg text-muted-foreground">
                Other queue systems charge $0.08-$0.15 per SMS. With QueueFlow, every notification is free.
              </p>
            </div>
            <div className="mt-12 overflow-hidden rounded-2xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-6 py-4 text-left font-semibold">Feature</th>
                    <th className="px-6 py-4 text-center font-semibold text-muted-foreground">SMS-Based Systems</th>
                    <th className="px-6 py-4 text-center font-semibold text-primary">QueueFlow</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Cost per notification', '$0.08 - $0.15', 'Free'],
                    ['1,000 notifications/mo', '$80 - $150', '$0'],
                    ['Notification speed', '5-30 seconds', 'Instant'],
                    ['Works on locked phone', 'Yes', 'Yes'],
                    ['Rich content (links, images)', 'Limited', 'Yes'],
                    ['No phone number required', 'No', 'Yes'],
                    ['International coverage', 'Extra cost', 'Free worldwide'],
                  ].map(([feature, sms, qf]) => (
                    <tr key={feature} className="border-b border-border last:border-0">
                      <td className="px-6 py-3.5 font-medium">{feature}</td>
                      <td className="px-6 py-3.5 text-center text-muted-foreground">{sms}</td>
                      <td className="px-6 py-3.5 text-center font-semibold text-primary">{qf}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-primary py-20">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-3xl font-bold text-primary-foreground md:text-4xl">
            Ready to Eliminate Wait Time Frustration?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-primary-foreground/80">
            Join businesses that have transformed their customer experience with smart queue management.
          </p>
          <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-xl bg-white px-8 py-4 text-base font-semibold text-primary shadow-lg transition-all hover:shadow-xl hover:-translate-y-0.5"
            >
              Get Started Free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 rounded-xl border border-primary-foreground/30 px-8 py-4 text-base font-semibold text-primary-foreground transition-all hover:bg-primary-foreground/10"
            >
              Talk to Sales
            </Link>
          </div>
          <div className="mt-6 flex items-center justify-center gap-6 text-sm text-primary-foreground/70">
            <span className="flex items-center gap-1.5"><Check className="h-4 w-4" /> Free forever plan</span>
            <span className="flex items-center gap-1.5"><Check className="h-4 w-4" /> No credit card</span>
            <span className="flex items-center gap-1.5"><Check className="h-4 w-4" /> Setup in 3 minutes</span>
          </div>
        </div>
      </section>
    </>
  );
}
