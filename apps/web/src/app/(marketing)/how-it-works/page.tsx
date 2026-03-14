import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';

const steps = [
  {
    number: '01',
    title: 'Create your account',
    description: 'Sign up in 30 seconds. Choose your industry template or start from scratch.',
    details: [
      'No credit card required',
      'Industry-specific templates auto-configure departments and services',
      'Or start blank and set up everything how you need it',
    ],
  },
  {
    number: '02',
    title: 'Configure your queue',
    description: 'Set up your departments, services, counters, and staff from the admin dashboard.',
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
    title: 'Share your QR code',
    description: 'Print the QR code and place it at your entrance. Customers scan to join.',
    details: [
      'Works with any phone camera \u2014 no app download needed',
      'Place at your entrance, on tables, or on your website',
      'Customers can also join remotely before arriving',
      'Set up a self-service kiosk for walk-in customers',
    ],
  },
  {
    number: '04',
    title: 'Manage from your dashboard',
    description: 'Call next customer, mark served, handle no-shows \u2014 all from your operator panel.',
    details: [
      'One-click "Call Next" respects queue order and priority',
      'View customer info and intake data before they arrive',
      'Transfer tickets between departments',
      'Track real-time queue statistics',
    ],
  },
  {
    number: '05',
    title: 'Customers track in real-time',
    description: 'After scanning, customers see their position, estimated wait, and get live updates.',
    details: [
      'Real-time position tracking \u2014 "You are #3 in queue"',
      'Estimated wait time based on average service duration',
      'Live updates without refreshing the page',
      'Works on any phone browser \u2014 iOS, Android, desktop',
    ],
  },
  {
    number: '06',
    title: 'Instant push notifications',
    description: "When it's their turn, customers get an instant push notification \u2014 even with the screen locked.",
    details: [
      'Free unlimited push notifications on ALL plans',
      'Works on locked phones \u2014 no SMS needed',
      'No per-message fees \u2014 $0 cost to you',
      'Customers see "YOUR TURN \u2014 Go to Counter 3"',
    ],
  },
];

const extras = [
  {
    title: 'TV Display Boards',
    description: 'Connect any screen to show your queue in real-time. 3 layout options, dark/light themes, customizable colors.',
  },
  {
    title: 'Analytics & Insights',
    description: 'Track wait times, peak hours, staff performance, and customer satisfaction. Export reports as CSV or PDF.',
  },
];

export default function HowItWorksPage() {
  return (
    <div className="bg-white">
      {/* Hero */}
      <section className="pb-16 pt-20 md:pt-28">
        <div className="mx-auto max-w-6xl px-6 text-center">
          <p className="text-[13px] font-semibold uppercase tracking-widest text-gray-400">How it works</p>
          <h1 className="mt-3 text-4xl font-bold tracking-[-0.03em] text-gray-900 md:text-5xl">
            From sign-up to first notification
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-7 text-gray-500">
            Here&apos;s exactly how QueueFlow transforms your queue management.
          </p>
        </div>
      </section>

      {/* Steps */}
      <section className="pb-20">
        <div className="mx-auto max-w-3xl px-6">
          <div className="space-y-6">
            {steps.map((step, i) => (
              <div
                key={step.number}
                className="relative flex gap-5"
              >
                {/* Timeline line */}
                {i < steps.length - 1 && (
                  <div className="absolute left-[22px] top-[56px] h-[calc(100%-20px)] w-px bg-gray-100" />
                )}

                {/* Number */}
                <div className="shrink-0">
                  <div className="relative z-10 flex h-11 w-11 items-center justify-center rounded-xl bg-gray-50 text-sm font-bold text-gray-900">
                    {step.number}
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 rounded-xl border border-gray-100 bg-white p-5">
                  <h3 className="text-[16px] font-semibold text-gray-900">{step.title}</h3>
                  <p className="mt-1.5 text-[13px] leading-6 text-gray-500">
                    {step.description}
                  </p>
                  <ul className="mt-3 space-y-2">
                    {step.details.map((detail) => (
                      <li key={detail} className="flex items-start gap-2 text-[12px]">
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                        <span className="text-gray-600">{detail}</span>
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
      <section className="border-y border-gray-100 bg-white py-16">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-xl font-semibold text-gray-900">Plus, powerful extras</h2>
          <div className="mx-auto mt-8 grid max-w-3xl gap-4 md:grid-cols-2">
            {extras.map((extra) => (
              <div
                key={extra.title}
                className="rounded-xl border border-gray-100 bg-white p-5"
              >
                <h3 className="text-sm font-semibold text-gray-900">{extra.title}</h3>
                <p className="mt-1.5 text-[13px] leading-6 text-gray-500">
                  {extra.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-2xl font-semibold text-gray-900">Ready to get started?</h2>
          <p className="mt-3 text-[15px] text-gray-500">
            Set up your first queue in under 3 minutes. Free forever for up to 50 customers/month.
          </p>
          <div className="mt-8">
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-5 py-2.5 text-[14px] font-medium text-white transition hover:bg-gray-800"
            >
              Create free account
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="mt-5 flex items-center justify-center gap-5 text-[12px] text-gray-400">
            <span className="flex items-center gap-1.5"><Check className="h-3 w-3" /> No credit card</span>
            <span className="flex items-center gap-1.5"><Check className="h-3 w-3" /> Free push notifications</span>
            <span className="flex items-center gap-1.5"><Check className="h-3 w-3" /> Cancel anytime</span>
          </div>
        </div>
      </section>
    </div>
  );
}
