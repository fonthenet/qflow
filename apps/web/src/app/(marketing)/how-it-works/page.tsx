import Link from 'next/link';
import { ArrowRight, BellRing, Building2, CalendarClock, Monitor, QrCode, ShieldCheck, Workflow } from 'lucide-react';
import { Sora } from 'next/font/google';

const display = Sora({
  subsets: ['latin'],
});

const steps = [
  {
    number: '01',
    title: 'Start with your category and operating model',
    description:
      'QueueFlow shapes the first workspace around your business type, whether you run walk-ins, appointments, reservations, or a mix of all three.',
    icon: Building2,
  },
  {
    number: '02',
    title: 'Turn on the intake paths that match reality',
    description:
      'Use QR join, shared links, staff-created visits, reservations, appointment check-in, or kiosk intake without fragmenting the flow.',
    icon: QrCode,
  },
  {
    number: '03',
    title: 'Run one universal command center',
    description:
      'Every arrival moves through the same lifecycle so staff can call, serve, transfer, and complete work with full context attached.',
    icon: Workflow,
  },
  {
    number: '04',
    title: 'Keep customers informed through each handoff',
    description:
      'Customers get a calm, app-free journey with live status, clear next steps, display boards, and branded updates.',
    icon: BellRing,
  },
  {
    number: '05',
    title: 'Expand into bookings, reservations, and owner control',
    description:
      'As the business grows, QueueFlow extends into scheduling, customer flow analytics, and the platform-level controls needed to scale.',
    icon: ShieldCheck,
  },
];

const surfaces = [
  {
    title: 'For the operator',
    description: 'A command center for arrivals, waiting, live service, and transfer between teams or stations.',
  },
  {
    title: 'For the customer',
    description: 'A modern browser journey with status clarity, less crowding, and no forced app install.',
  },
  {
    title: 'For the owner',
    description: 'A platform layer for plans, traffic, templates, feature flags, and rollout control.',
  },
];

export default function HowItWorksPage() {
  return (
    <div className="bg-[#f6f1ea] text-slate-900">
      <section className="border-b border-black/5 bg-[radial-gradient(circle_at_top_left,_rgba(255,241,226,0.95),_rgba(246,241,234,0)_38%),radial-gradient(circle_at_right,_rgba(199,232,223,0.7),_rgba(246,241,234,0)_36%),linear-gradient(180deg,_#f8f4ee_0%,_#f6f1ea_100%)]">
        <div className="mx-auto max-w-7xl px-6 py-18 md:py-24">
          <div className="mx-auto max-w-4xl text-center">
            <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-slate-400">How it works</p>
            <h1 className={`${display.className} mt-4 text-[clamp(2.4rem,5vw,4.8rem)] leading-[0.98] tracking-[-0.055em] text-[#101717]`}>
              Customer flow software that matches how service businesses actually operate.
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-[16px] leading-7 text-slate-600">
              QueueFlow is designed to unify arrivals, waiting, bookings, reservations, and handoff instead of treating each
              one like a separate tool.
            </p>
          </div>

          <div className="mx-auto mt-12 grid max-w-5xl gap-4 md:grid-cols-3">
            {surfaces.map((surface) => (
              <div key={surface.title} className="rounded-[28px] border border-white/70 bg-white/80 p-6 shadow-[0_14px_30px_rgba(20,27,26,0.05)]">
                <p className="text-lg font-semibold text-slate-900">{surface.title}</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">{surface.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-6xl px-6 py-18 md:py-22">
          <div className="grid gap-6">
            {steps.map((step) => {
              const Icon = step.icon;
              return (
                <div key={step.number} className="grid gap-4 rounded-[30px] border border-slate-200 bg-[#fbfaf8] p-6 shadow-[0_14px_30px_rgba(20,27,26,0.04)] md:grid-cols-[auto_1fr_auto] md:items-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#10292f] text-sm font-semibold text-white">
                    {step.number}
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-slate-900">{step.title}</h2>
                    <p className="mt-2 text-sm leading-7 text-slate-600">{step.description}</p>
                  </div>
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-[#10292f]">
                    <Icon className="h-5 w-5" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="border-y border-black/5 bg-[#10292f] text-white">
        <div className="mx-auto max-w-6xl px-6 py-18 md:py-22">
          <div className="grid gap-4 md:grid-cols-4">
            {[
              { label: 'Intake paths', value: '6' },
              { label: 'Universal lifecycle', value: '1' },
              { label: 'Customer app installs', value: '0' },
              { label: 'Owner consoles needed', value: '1' },
            ].map((item) => (
              <div key={item.label} className="rounded-[26px] border border-white/10 bg-white/5 p-5">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">{item.label}</p>
                <p className={`${display.className} mt-3 text-4xl leading-none tracking-[-0.05em] text-white`}>{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[linear-gradient(180deg,_#f6f1ea_0%,_#fff7ee_100%)]">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center md:py-24">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[24px] bg-white text-[#10292f] shadow-[0_16px_34px_rgba(20,27,26,0.08)]">
            <CalendarClock className="h-7 w-7" />
          </div>
          <h2 className={`${display.className} mt-6 text-[clamp(2rem,4vw,3.6rem)] leading-[0.98] tracking-[-0.05em] text-[#111716]`}>
            Build the first workspace now. Add the rest of the flow as you grow.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-[16px] leading-7 text-slate-600">
            Start with one location and a clean command center, then expand into reservations, bookings, displays,
            analytics, and owner-level controls.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-full bg-[#10292f] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#18383f]"
            >
              Create your workspace
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/solutions"
              className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
            >
              Explore categories
              <Monitor className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
