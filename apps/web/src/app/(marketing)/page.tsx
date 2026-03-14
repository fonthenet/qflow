import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

/* ---------- mock UI ---------- */

function QueueCard() {
  return (
    <div className="w-full max-w-[340px] overflow-hidden rounded-2xl bg-white shadow-[0_4px_40px_rgba(0,0,0,0.08)] ring-1 ring-gray-950/5">
      <div className="px-5 pb-1 pt-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400">Live queue</p>
            <p className="mt-0.5 text-[15px] font-semibold text-gray-900">Downtown Clinic</p>
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-600">
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Live
          </div>
        </div>
      </div>
      <div className="mt-2 px-5">
        {[
          { name: 'Sarah M.', service: 'General Consult', badge: 'Now serving', accent: true },
          { name: 'James K.', service: 'Lab Work', badge: '#2', accent: false },
          { name: 'Amira L.', service: 'Prescription', badge: '#3', accent: false },
        ].map((v, i) => (
          <div key={v.name} className={`flex items-center justify-between py-3 ${i > 0 ? 'border-t border-gray-100' : ''}`}>
            <div className="flex items-center gap-3">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${v.accent ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'}`}>
                {v.name.split(' ').map(n => n[0]).join('')}
              </div>
              <div>
                <p className="text-[13px] font-medium text-gray-900">{v.name}</p>
                <p className="text-[11px] text-gray-400">{v.service}</p>
              </div>
            </div>
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${v.accent ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'}`}>
              {v.badge}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1 border-t border-gray-100 px-5 py-3">
        <div className="flex items-center justify-between text-[11px] text-gray-400">
          <span>Avg wait: <span className="font-medium text-gray-600">8 min</span></span>
          <span>3 in queue</span>
        </div>
      </div>
    </div>
  );
}

function PhoneStatus() {
  return (
    <div className="w-full max-w-[220px] overflow-hidden rounded-[2rem] bg-white shadow-[0_8px_40px_rgba(0,0,0,0.1)] ring-1 ring-gray-950/5">
      <div className="flex items-center justify-center pt-4">
        <div className="h-5 w-20 rounded-full bg-gray-900" />
      </div>
      <div className="px-6 pb-8 pt-6 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100">
          <span className="text-xl font-bold text-gray-900">#2</span>
        </div>
        <p className="mt-4 text-[17px] font-semibold text-gray-900">You&apos;re next</p>
        <p className="mt-1 text-[13px] text-gray-500">About 4 min remaining</p>
        <div className="mx-auto mt-5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
          <div className="h-full w-3/4 rounded-full bg-gray-900" />
        </div>
        <p className="mt-4 text-[11px] text-gray-400">General Consultation &middot; Counter 3</p>
      </div>
    </div>
  );
}

function DashboardPreview() {
  return (
    <div className="w-full overflow-hidden rounded-xl bg-white shadow-[0_4px_40px_rgba(0,0,0,0.06)] ring-1 ring-gray-950/5">
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2.5">
        <div className="flex gap-1.5">
          <div className="h-3 w-3 rounded-full bg-gray-200" />
          <div className="h-3 w-3 rounded-full bg-gray-200" />
          <div className="h-3 w-3 rounded-full bg-gray-200" />
        </div>
        <div className="ml-2 h-5 w-48 rounded bg-gray-100" />
      </div>
      <div className="grid grid-cols-[200px_1fr]">
        <div className="border-r border-gray-100 p-3">
          {['Queue', 'Visitors', 'Services', 'Analytics', 'Settings'].map((item, i) => (
            <div
              key={item}
              className={`rounded-lg px-3 py-2 text-[12px] font-medium ${i === 0 ? 'bg-gray-900 text-white' : 'text-gray-400'}`}
            >
              {item}
            </div>
          ))}
        </div>
        <div className="p-5">
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'In queue', value: '7', change: '+2' },
              { label: 'Avg wait', value: '11m', change: '-3m' },
              { label: 'Served today', value: '43', change: '+12' },
            ].map((s) => (
              <div key={s.label} className="rounded-xl bg-gray-50 p-4">
                <p className="text-2xl font-semibold text-gray-900">{s.value}</p>
                <div className="mt-1 flex items-center gap-2">
                  <p className="text-[11px] text-gray-400">{s.label}</p>
                  <span className="text-[10px] font-medium text-emerald-600">{s.change}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 flex items-center justify-between rounded-xl bg-gray-900 px-4 py-3 text-white">
            <div className="flex items-center gap-2.5">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500">
                <ArrowRight className="h-3 w-3" />
              </div>
              <span className="text-[13px] font-medium">Call next &mdash; Sarah M. &middot; General Consultation</span>
            </div>
            <span className="rounded-md bg-white/10 px-2.5 py-1 text-[11px] font-medium text-gray-300">Counter 2</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- page ---------- */

export default function HomePage() {
  return (
    <div className="bg-white">
      {/* Hero */}
      <section className="relative overflow-hidden pb-16 pt-20 md:pb-24 md:pt-28">
        {/* clean white — no gradient */}
        <div className="relative mx-auto max-w-6xl px-6">
          <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-20">
            <div>
              <h1 className="text-[clamp(2.2rem,5vw,3.8rem)] font-bold leading-[1.08] tracking-[-0.04em] text-gray-900">
                Stop losing customers{' '}
                <br className="hidden sm:block" />
                to bad wait experiences.
              </h1>
              <p className="mt-5 max-w-[440px] text-[16px] leading-7 text-gray-600">
                QueueFlow replaces paper sign-ins and guesswork with a live service flow. Visitors join from their phone, track their place, and get called when ready.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <Link
                  href="/register"
                  className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-6 py-3 text-[14px] font-semibold text-white shadow-sm transition hover:bg-gray-800"
                >
                  Start free
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/how-it-works"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-5 py-3 text-[14px] font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  See how it works
                </Link>
              </div>
              <div className="mt-10 flex flex-wrap gap-5 text-[13px] text-gray-500">
                <span>No app download</span>
                <span className="text-gray-300">·</span>
                <span>Free forever plan</span>
                <span className="text-gray-300">·</span>
                <span>Setup in 3 minutes</span>
              </div>
            </div>

            <div className="relative flex justify-center lg:justify-end">
              <div className="relative">
                <QueueCard />
                <div className="absolute -bottom-8 -left-12 lg:-left-16">
                  <PhoneStatus />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Social proof bar */}
      <section className="border-y border-gray-100">
        <div className="mx-auto max-w-6xl px-6 py-6">
          <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-3">
            {['Clinics', 'Government', 'Banks', 'Retail', 'Hotels', 'Barbershops'].map((item) => (
              <span key={item} className="text-[13px] font-medium text-gray-400">{item}</span>
            ))}
          </div>
        </div>
      </section>

      {/* Dashboard preview */}
      <section className="py-20 md:py-28">
        <div className="mx-auto max-w-5xl px-6">
          <div className="text-center">
            <p className="text-[13px] font-semibold uppercase tracking-widest text-gray-400">The operator view</p>
            <h2 className="mt-2 text-[clamp(1.5rem,3vw,2.2rem)] font-semibold tracking-[-0.03em] text-gray-900">
              One screen to manage every visit
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-[15px] leading-7 text-gray-600">
              Call the next visitor, route between departments, and track wait times — all from a single dashboard.
            </p>
          </div>
          <div className="mt-14">
            <DashboardPreview />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-y border-gray-100">
        <div className="mx-auto max-w-5xl px-6 py-20 md:py-28">
          <p className="text-[13px] font-semibold uppercase tracking-widest text-gray-400">How it works</p>
          <h2 className="mt-2 text-[clamp(1.5rem,3vw,2.2rem)] font-semibold tracking-[-0.03em] text-gray-900">
            Three steps. No training needed.
          </h2>
          <div className="mt-14 grid gap-8 md:grid-cols-3 md:gap-12">
            {[
              {
                n: '01',
                title: 'They arrive',
                desc: 'QR code at the door, a link on your site, or a kiosk. No app install. They pick a service and they\u2019re in.',
              },
              {
                n: '02',
                title: 'They wait \u2014 informed',
                desc: 'Position in queue, estimated time, live updates. All on their phone. They can leave and come back.',
              },
              {
                n: '03',
                title: 'You serve',
                desc: 'Call, route, transfer, complete. One screen for your whole team. Clean records for every visit.',
              },
            ].map((item) => (
              <div key={item.n}>
                <p className="text-[12px] font-semibold text-gray-400">{item.n}</p>
                <h3 className="mt-1 text-[17px] font-semibold text-gray-900">{item.title}</h3>
                <p className="mt-2 text-[14px] leading-6 text-gray-600">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 md:py-28">
        <div className="mx-auto max-w-5xl px-6">
          <div className="max-w-lg">
            <p className="text-[13px] font-semibold uppercase tracking-widest text-gray-400">What&apos;s included</p>
            <h2 className="mt-2 text-[clamp(1.5rem,3vw,2.2rem)] font-semibold leading-[1.15] tracking-[-0.025em] text-gray-900">
              One platform. Not six tools duct-taped together.
            </h2>
            <p className="mt-3 text-[15px] leading-7 text-gray-600">
              Everything from check-in to completion. No add-ons, no per-message fees.
            </p>
          </div>

          <div className="mt-10 grid gap-x-12 gap-y-4 sm:grid-cols-2">
            {[
              'Walk-ins + appointments in one queue',
              'Live status pages for visitors',
              'Push notifications — free, unlimited',
              'QR code and kiosk check-in',
              'Desk and department routing',
              'Multi-location from day one',
              'TV display boards',
              'Intake forms before handoff',
              'Priority rules (VIP, elderly)',
              'Analytics and export',
            ].map((f) => (
              <div key={f} className="flex items-center gap-3 border-b border-gray-100 py-3">
                <div className="h-1 w-1 shrink-0 rounded-full bg-gray-900" />
                <span className="text-[14px] text-gray-600">{f}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Industries */}
      <section className="border-y border-gray-100">
        <div className="mx-auto max-w-5xl px-6 py-20 md:py-28">
          <div className="max-w-md">
            <p className="text-[13px] font-semibold uppercase tracking-widest text-gray-400">Industries</p>
            <h2 className="mt-2 text-[clamp(1.5rem,3vw,2.2rem)] font-semibold leading-[1.12] tracking-[-0.03em] text-gray-900">
              If people walk in and wait, this is for you.
            </h2>
          </div>

          <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { name: 'Clinics', detail: 'Check-in, triage, multi-department routing' },
              { name: 'Government', detail: 'Kiosk ticketing, counter displays, priority rules' },
              { name: 'Banks', detail: 'VIP routing, appointments + walk-ins, analytics' },
              { name: 'Retail', detail: 'Service desks, returns, browse-while-waiting' },
              { name: 'Hotels', detail: 'Check-in queue, concierge, spa and restaurant' },
              { name: 'Barbershops', detail: 'Digital waitlist, stylist selection, push alerts' },
            ].map((ind) => (
              <Link
                key={ind.name}
                href={`/solutions/${ind.name.toLowerCase()}`}
                className="group flex items-start justify-between rounded-xl border border-gray-100 p-5 transition-all hover:border-gray-200 hover:shadow-sm"
              >
                <div>
                  <h3 className="text-[15px] font-semibold text-gray-900">{ind.name}</h3>
                  <p className="mt-1 text-[13px] leading-5 text-gray-600">{ind.detail}</p>
                </div>
                <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-gray-400 transition group-hover:text-gray-900" />
              </Link>
            ))}
          </div>

          <Link href="/solutions" className="mt-6 inline-flex items-center gap-1.5 text-[13px] font-medium text-gray-500 transition hover:text-gray-900">
            All solutions <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-gray-100 py-24 md:py-32">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-[clamp(1.8rem,4vw,2.8rem)] font-bold leading-[1.12] tracking-[-0.03em] text-gray-900">
            Start with one location.<br />Scale when it works.
          </h2>
          <p className="mx-auto mt-4 max-w-md text-[15px] leading-7 text-gray-500">
            Free plan. No credit card. No sales call. Set up your first queue in minutes.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-6 py-3 text-[14px] font-semibold text-white transition hover:bg-gray-800"
            >
              Create your queue
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/pricing" className="text-[14px] font-medium text-gray-500 transition hover:text-gray-900">
              View pricing &rarr;
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
