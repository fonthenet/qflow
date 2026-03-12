import Link from 'next/link';
import {
  UserPlus, Settings, QrCode, LayoutDashboard,
  Smartphone, Bell, Monitor, BarChart3,
  ArrowRight, Check, ChevronDown,
} from 'lucide-react';

const steps = [
  {
    number: '01',
    icon: UserPlus,
    title: 'Create Your Account',
    description: 'Sign up in 30 seconds. Choose your industry template (restaurant, clinic, retail, etc.) or start from scratch.',
    details: [
      'No credit card required',
      'Industry-specific templates auto-configure departments, services, and desks',
      'Or start blank and set up everything exactly how you need it',
    ],
  },
  {
    number: '02',
    icon: Settings,
    title: 'Configure Your Queue',
    description: 'Set up your departments, services, counters, and staff. Customize everything from the admin dashboard.',
    details: [
      'Create departments (e.g., Teller, Loans, Customer Service)',
      'Add services within each department',
      'Set up desks/counters and assign staff',
      'Configure priority categories (elderly, VIP, etc.)',
      'Customize intake forms per service',
    ],
  },
  {
    number: '03',
    icon: QrCode,
    title: 'Share Your QR Code',
    description: 'Print the QR code and place it at your entrance, counter, or on your website. Customers scan to join.',
    details: [
      'QR codes work with any phone camera — no app download needed',
      'Place at your entrance, on tables, or on your website',
      'Customers can also join remotely before arriving',
      'Set up a self-service kiosk for walk-in customers',
    ],
  },
  {
    number: '04',
    icon: LayoutDashboard,
    title: 'Manage from Your Dashboard',
    description: 'Call next customer, mark served, handle no-shows — everything from your operator panel.',
    details: [
      'One-click "Call Next" button respects queue order and priority',
      'View customer info and intake form data before they arrive',
      'Transfer tickets between departments',
      'Track real-time queue statistics',
    ],
  },
  {
    number: '05',
    icon: Smartphone,
    title: 'Customers Track in Real-Time',
    description: 'After scanning the QR code, customers see their position, estimated wait time, and get live updates.',
    details: [
      'Real-time position tracking — "You are #3 in queue"',
      'Estimated wait time based on average service duration',
      'Live updates without refreshing the page',
      'Works on any phone browser — iOS, Android, desktop',
    ],
  },
  {
    number: '06',
    icon: Bell,
    title: 'Instant Push Notifications',
    description: 'When it\'s their turn, customers get an instant push notification — even with the screen locked.',
    details: [
      'Free unlimited push notifications on ALL plans',
      'Works on locked phones — no SMS needed',
      'No per-message fees — $0 cost to you',
      'Customers see "YOUR TURN — Go to Counter 3"',
    ],
  },
];

const extras = [
  {
    icon: Monitor,
    title: 'TV Display Boards',
    description: 'Connect any screen to show your queue in real-time. 3 layout options, dark/light themes, customizable colors.',
  },
  {
    icon: BarChart3,
    title: 'Analytics & Insights',
    description: 'Track wait times, peak hours, staff performance, and customer satisfaction. Export reports as CSV or PDF.',
  },
];

export default function HowItWorksPage() {
  return (
    <>
      {/* Hero */}
      <section className="bg-gradient-to-br from-primary/5 via-background to-primary/10 py-20">
        <div className="mx-auto max-w-7xl px-6 text-center">
          <h1 className="text-4xl font-extrabold tracking-tight md:text-5xl">
            How QueueFlow Works
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            From sign-up to your first customer notification — here&apos;s exactly how QueueFlow transforms your queue management.
          </p>
        </div>
      </section>

      {/* Steps */}
      <section className="py-24">
        <div className="mx-auto max-w-4xl px-6">
          <div className="space-y-12">
            {steps.map((step, i) => (
              <div
                key={step.number}
                className="relative flex gap-6 md:gap-10"
              >
                {/* Timeline line */}
                {i < steps.length - 1 && (
                  <div className="absolute left-[27px] top-[68px] h-[calc(100%-20px)] w-0.5 bg-border md:left-[31px]" />
                )}

                {/* Number bubble */}
                <div className="shrink-0">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-lg font-extrabold text-primary-foreground shadow-lg md:h-16 md:w-16">
                    {step.number}
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 pb-4">
                  <h3 className="text-xl font-bold md:text-2xl">{step.title}</h3>
                  <p className="mt-2 text-muted-foreground leading-relaxed">
                    {step.description}
                  </p>
                  <ul className="mt-4 space-y-2">
                    {step.details.map((detail) => (
                      <li key={detail} className="flex items-start gap-2 text-sm">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                        <span>{detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Extras */}
      <section className="border-y border-border bg-muted/20 py-20">
        <div className="mx-auto max-w-7xl px-6">
          <h2 className="text-center text-3xl font-bold">Plus, Powerful Extras</h2>
          <div className="mx-auto mt-12 grid max-w-4xl gap-8 md:grid-cols-2">
            {extras.map((extra) => (
              <div
                key={extra.title}
                className="rounded-2xl border border-border bg-card p-8"
              >
                <div className="mb-4 inline-flex rounded-xl bg-primary/10 p-3 text-primary">
                  <extra.icon className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-semibold">{extra.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                  {extra.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-primary py-20">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-3xl font-bold text-primary-foreground">
            Ready to Get Started?
          </h2>
          <p className="mt-4 text-lg text-primary-foreground/80">
            Set up your first queue in under 3 minutes. Free forever for up to 50 customers/month.
          </p>
          <div className="mt-8">
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-xl bg-white px-8 py-4 text-base font-semibold text-primary shadow-lg transition-all hover:shadow-xl"
            >
              Create Free Account
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="mt-6 flex items-center justify-center gap-6 text-sm text-primary-foreground/70">
            <span className="flex items-center gap-1.5"><Check className="h-4 w-4" /> No credit card</span>
            <span className="flex items-center gap-1.5"><Check className="h-4 w-4" /> Free push notifications</span>
            <span className="flex items-center gap-1.5"><Check className="h-4 w-4" /> Cancel anytime</span>
          </div>
        </div>
      </section>
    </>
  );
}
