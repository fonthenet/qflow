import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight,
  BarChart3,
  BellRing,
  Building2,
  CalendarClock,
  ChevronRight,
  Layers3,
  Link2,
  MapPin,
  Monitor,
  QrCode,
  ShieldCheck,
  Ticket,
  UserPlus,
  Workflow,
} from 'lucide-react';
import { Sora } from 'next/font/google';
import Link from 'next/link';

const display = Sora({
  subsets: ['latin'],
});

const intakeModes: Array<{ title: string; description: string; icon: LucideIcon }> = [
  {
    title: 'QR scan to join',
    description: 'Turn signs, tables, and storefront glass into structured arrival points.',
    icon: QrCode,
  },
  {
    title: 'Shared join link',
    description: 'Let visitors enter the flow from your website, SMS, or social profile.',
    icon: Link2,
  },
  {
    title: 'Staff-created visit',
    description: 'Front desk teams can create and route arrivals without breaking rhythm.',
    icon: UserPlus,
  },
  {
    title: 'Appointment check-in',
    description: 'Bring scheduled visits into the same operating view as walk-ins.',
    icon: CalendarClock,
  },
  {
    title: 'Reservation arrival',
    description: 'Handle arrivals for booked tables, counters, or service windows with less friction.',
    icon: MapPin,
  },
  {
    title: 'Kiosk intake',
    description: 'Use a self-serve screen when you need guided intake on-site.',
    icon: Monitor,
  },
];

const flowStages = [
  {
    name: 'Created',
    description: 'Every visit enters the same model, whether it started online or on-site.',
  },
  {
    name: 'Waiting',
    description: 'Customers get a readable status page instead of guessing or crowding a lobby.',
  },
  {
    name: 'Called',
    description: 'Call, recall, or transfer with context intact across desks, departments, or stations.',
  },
  {
    name: 'Serving',
    description: 'Staff see the service state clearly while the customer sees the next step.',
  },
  {
    name: 'Completed',
    description: 'Capture throughput, service outcomes, and clean history for every visit.',
  },
  {
    name: 'Transferred',
    description: 'Move a customer between teams without starting over or losing information.',
  },
];

const workspaceAreas = [
  'Command center',
  'Services and departments',
  'Staff and stations',
  'Customers',
  'Bookings and reservations',
  'Displays and kiosk',
  'Analytics',
  'Settings and integrations',
];

const categoryProfiles = [
  {
    name: 'Healthcare clinics',
    href: '/solutions/clinics',
    summary: 'Blend booked visits, walk-ins, triage, and handoff between departments.',
    modules: ['Check-in forms', 'Department routing', 'Remote waiting'],
    tone: 'bg-[#edf7f2]',
  },
  {
    name: 'Restaurants',
    href: '/solutions/restaurants',
    summary: 'Run reservations, quoted waits, and table-ready notifications from one shell.',
    modules: ['Reservation arrival', 'Host stand control', 'Guest updates'],
    tone: 'bg-[#fff1e2]',
  },
  {
    name: 'Government services',
    href: '/solutions/government',
    summary: 'Coordinate ticketing, counters, kiosk intake, and priority rules without legacy clutter.',
    modules: ['Counter routing', 'Priority lanes', 'Display boards'],
    tone: 'bg-[#eaf0ff]',
  },
];

const ownerControls: Array<{ title: string; description: string; icon: LucideIcon }> = [
  {
    title: 'Organization and plan control',
    description: 'Monitor workspace health, billing state, and rollout readiness from one owner console.',
    icon: Building2,
  },
  {
    title: 'Feature and template management',
    description: 'Control branding, website templates, and feature flags without treating each account as custom work.',
    icon: Layers3,
  },
  {
    title: 'Traffic and incident visibility',
    description: 'Spot live queue pressure, access anomalies, and support issues before they become churn.',
    icon: BarChart3,
  },
  {
    title: 'Audit-friendly operations',
    description: 'Keep an owner-grade record of changes, access, and operational events across the platform.',
    icon: ShieldCheck,
  },
];

const customerMoments = [
  {
    title: 'App-free from the first visit',
    description: 'Customers can join, track, and check in from a browser without installing anything.',
  },
  {
    title: 'Calm status instead of waiting-room chaos',
    description: 'Readable progress, clear ETA language, and branded screens make waiting feel intentional.',
  },
  {
    title: 'A next step at every handoff',
    description: 'Call, reservation arrival, service start, and completion can all trigger the right customer update.',
  },
];

function HeroBoard() {
  return (
    <div className="relative mx-auto w-full max-w-[560px] pt-6 lg:pt-12">
      <div className="overflow-hidden rounded-[32px] border border-[#12343a] bg-[#0f2328] text-white shadow-[0_30px_90px_rgba(10,26,31,0.28)]">
        <div className="border-b border-white/10 px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.24em] text-white/55">QueueFlow command center</p>
              <p className="mt-1 text-sm font-medium text-white/90">One operating model for every arrival type</p>
            </div>
            <div className="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1 text-[11px] font-medium text-emerald-100">
              Live workspace
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[
              { label: 'Arrivals today', value: '126' },
              { label: 'Avg wait', value: '11 min' },
              { label: 'Transfers', value: '14' },
            ].map((stat) => (
              <div key={stat.label} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.16em] text-white/45">{stat.label}</p>
                <p className="mt-2 text-2xl font-semibold text-white">{stat.value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-4 p-5 sm:p-6 lg:grid-cols-[1.02fr_0.98fr]">
          <div className="space-y-4">
            <div className="rounded-[28px] border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-white/65">Universal intake</p>
                  <p className="mt-1 text-sm text-white/90">Every way a customer can arrive</p>
                </div>
                <div className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] text-white/70">6 active paths</div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                {['QR join', 'Reservation', 'Staff intake', 'Check-in', 'Shared link', 'Kiosk'].map((item) => (
                  <div key={item} className="rounded-2xl border border-white/8 bg-[#153037] px-3 py-2.5 text-white/80">
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[28px] bg-[#11343b] p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <Workflow className="h-4 w-4 text-[#8de2d5]" />
                Flexible service flow
              </div>
              <div className="mt-4 space-y-3">
                {[
                  { title: 'Waiting', meta: '18 active' },
                  { title: 'Called', meta: 'Counter 4 ready' },
                  { title: 'Serving', meta: '6 in progress' },
                ].map((step, index) => (
                  <div key={step.title} className="flex items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-[#11343b]">
                      {index + 1}
                    </div>
                    <div className="flex flex-1 items-center justify-between rounded-2xl border border-white/10 bg-white/8 px-3 py-2.5">
                      <span className="text-sm text-white/92">{step.title}</span>
                      <span className="text-[11px] uppercase tracking-[0.12em] text-white/55">{step.meta}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-[28px] bg-white p-4 text-slate-900">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">Customer status</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">Reservation arrival for Lee W.</p>
                </div>
                <div className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">ETA 4 min</div>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#10292f] text-xl font-semibold text-white">
                  18
                </div>
                <div>
                  <p className="text-lg font-semibold text-slate-900">Waiting -&gt; called next</p>
                  <p className="mt-1 text-sm text-slate-500">Dining room | Party of 4 | Host stand A</p>
                </div>
              </div>
              <div className="mt-4 h-2 rounded-full bg-slate-100">
                <div className="h-full w-4/5 rounded-full bg-[#11343b]" />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {[
                  { label: 'Join', value: '6:18 PM' },
                  { label: 'Notify', value: 'Push + board' },
                  { label: 'Service', value: 'Table 12' },
                ].map((item) => (
                  <div key={item.label} className="rounded-2xl bg-slate-50 px-3 py-2.5">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{item.label}</p>
                    <p className="mt-1 text-sm font-medium text-slate-900">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <BellRing className="h-4 w-4 text-[#f7c98b]" />
                Next handoff
              </div>
              <div className="mt-3 rounded-2xl border border-white/8 bg-[#16343a] px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-white">Counter 2 is ready for Omar H.</p>
                    <p className="mt-1 text-xs text-white/55">Appointment check-in | Insurance review</p>
                  </div>
                  <div className="rounded-full bg-[#f8d4a7] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#5f3b16]">
                    Call now
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-white/45">
                <Ticket className="h-3.5 w-3.5" />
                Bookings, walk-ins, and reservations stay in one timeline
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="relative mt-4 ml-4 max-w-[260px] rounded-[28px] border border-[#d8e8de] bg-white px-4 py-4 shadow-[0_22px_60px_rgba(28,45,35,0.12)] lg:absolute lg:-bottom-8 lg:left-6 lg:mt-0">
        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Owner console</p>
        <p className="mt-2 text-sm font-semibold text-slate-900">Platform health across active organizations</p>
        <div className="mt-4 space-y-2.5">
          {[
            { label: 'Healthy workspaces', value: '42' },
            { label: 'Billing alerts', value: '3' },
            { label: 'Feature rollouts live', value: '5' },
          ].map((item) => (
            <div key={item.label} className="flex items-center justify-between rounded-2xl bg-[#f6f7f4] px-3 py-2.5">
              <span className="text-sm text-slate-600">{item.label}</span>
              <span className="text-sm font-semibold text-slate-900">{item.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function MarketingHomepage() {
  return (
    <div className="bg-[#f6f1ea] text-slate-900">
      <section className="relative overflow-hidden border-b border-black/5 bg-[radial-gradient(circle_at_top_left,_rgba(255,241,226,0.95),_rgba(246,241,234,0)_38%),radial-gradient(circle_at_right,_rgba(199,232,223,0.8),_rgba(246,241,234,0)_36%),linear-gradient(180deg,_#f8f4ee_0%,_#f6f1ea_100%)]">
        <div className="absolute inset-x-0 top-0 h-px bg-white/70" />
        <div className="mx-auto max-w-7xl px-6 pb-[4.5rem] pt-16 sm:pb-20 md:pt-24 lg:pb-24">
          <div className="grid items-center gap-14 lg:grid-cols-[1.02fr_0.98fr] lg:gap-12">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#d7ddd7] bg-white/80 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600 shadow-sm backdrop-blur">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Customer flow software for service businesses
              </div>
              <h1
                className={`${display.className} mt-6 text-[clamp(2.9rem,7vw,6rem)] leading-[0.96] tracking-[-0.055em] text-[#101717]`}
              >
                Run arrivals, waiting, bookings, reservations, and service handoff in one system.
              </h1>
              <p className="mt-6 max-w-xl text-[17px] leading-8 text-slate-600 sm:text-[18px]">
                QueueFlow gives every location a category-aware command center for walk-ins, appointments, reservations,
                and customer updates, with owner-grade platform control behind the scenes.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link
                  href="/register"
                  className="inline-flex items-center gap-2 rounded-full bg-[#10292f] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#18383f]"
                >
                  Start free
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/how-it-works"
                  className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white/85 px-6 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-white"
                >
                  See the workflow
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
              <div className="mt-10 grid gap-4 sm:grid-cols-3">
                {[
                  { value: '6', label: 'intake paths supported' },
                  { value: '1', label: 'universal service lifecycle' },
                  { value: '0', label: 'app installs required' },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-[26px] border border-white/70 bg-white/75 px-4 py-4 shadow-[0_14px_30px_rgba(25,35,32,0.06)] backdrop-blur">
                    <p className={`${display.className} text-3xl leading-none tracking-[-0.05em] text-[#10292f]`}>{stat.value}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{stat.label}</p>
                  </div>
                ))}
              </div>
              <div className="mt-8 flex flex-wrap gap-3 text-[13px] font-medium text-slate-500">
                {['Walk-ins', 'Bookings', 'Reservations', 'Check-ins', 'Queue updates', 'Owner console'].map((item) => (
                  <span key={item} className="rounded-full border border-slate-200 bg-white/70 px-3 py-1.5">
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <HeroBoard />
          </div>
        </div>
      </section>

      <section className="border-b border-black/5 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-[4.5rem] md:py-[5.5rem]">
          <div className="max-w-3xl">
            <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-slate-400">Universal intake</p>
            <h2 className={`${display.className} mt-3 text-[clamp(2rem,4vw,3.5rem)] leading-[1] tracking-[-0.05em] text-[#111716]`}>
              One product, every way people arrive.
            </h2>
            <p className="mt-4 max-w-2xl text-[16px] leading-7 text-slate-600">
              Whether a customer scans a QR code, arrives for a reservation, checks in for an appointment, or gets
              entered by staff, QueueFlow keeps the intake consistent and the operations model clear.
            </p>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {intakeModes.map((mode) => {
              const Icon = mode.icon;
              return (
                <div key={mode.title} className="rounded-[28px] border border-slate-200 bg-[#fbfaf8] p-6 shadow-[0_14px_30px_rgba(20,27,26,0.04)]">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#112d33] text-white">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-5 text-lg font-semibold text-slate-900">{mode.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{mode.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="border-b border-black/5 bg-[#f3eee6]">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 py-[4.5rem] md:py-[5.5rem] lg:grid-cols-[0.92fr_1.08fr] lg:items-start">
          <div className="max-w-xl">
            <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-slate-400">Flexible service flow</p>
            <h2 className={`${display.className} mt-3 text-[clamp(2rem,4vw,3.4rem)] leading-[1] tracking-[-0.05em] text-[#111716]`}>
              A universal lifecycle for the messy real world.
            </h2>
            <p className="mt-4 text-[16px] leading-7 text-slate-600">
              Walk-ins, appointments, and reservations should not live in separate tools. QueueFlow gives each visit
              the same status model so teams can call, serve, transfer, and complete work without breaking context.
            </p>
            <div className="mt-8 rounded-[28px] bg-[#10292f] p-6 text-white shadow-[0_24px_60px_rgba(10,26,31,0.18)]">
              <p className="text-[11px] uppercase tracking-[0.18em] text-white/50">What staff see</p>
              <p className="mt-3 text-lg font-semibold text-white">A command center built for throughput, not guesswork.</p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {[
                  'Call and recall from one queue view',
                  'Move customers between desks or departments',
                  'Keep intake details attached to the visit',
                  'Measure wait and service time without extra tooling',
                ].map((item) => (
                  <div key={item} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/80">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-[32px] border border-white/70 bg-white p-6 shadow-[0_18px_40px_rgba(20,27,26,0.06)] sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-slate-400">Visit lifecycle</p>
                <p className="mt-2 text-lg font-semibold text-slate-900">Every arrival type resolves through the same flow.</p>
              </div>
              <div className="rounded-full bg-[#edf7f2] px-3 py-1.5 text-[12px] font-medium text-[#1f6c5a]">
                Walk-ins + bookings + reservations
              </div>
            </div>
            <div className="mt-8 space-y-4">
              {flowStages.map((stage, index) => (
                <div key={stage.name} className="grid gap-3 rounded-[26px] bg-[#f6f7f4] p-4 sm:grid-cols-[auto_1fr] sm:items-start sm:p-5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#10292f] text-sm font-semibold text-white">
                    {index + 1}
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-semibold text-slate-900">{stage.name}</p>
                      {index < flowStages.length - 1 ? (
                        <span className="rounded-full bg-white px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] text-slate-400">
                          next stage available
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{stage.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-black/5 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-[4.5rem] md:py-[5.5rem]">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-slate-400">Category-aware workspace</p>
              <h2 className={`${display.className} mt-3 text-[clamp(2rem,4vw,3.4rem)] leading-[1] tracking-[-0.05em] text-[#111716]`}>
                The shell stays consistent. The workspace adapts by business type.
              </h2>
              <p className="mt-4 text-[16px] leading-7 text-slate-600">
                Service businesses need a shared operating model, but they do not all need the same defaults. QueueFlow
                can shape the experience around the category without turning every deployment into a custom project.
              </p>
              <div className="mt-8 rounded-[30px] border border-slate-200 bg-[#fbfaf8] p-6">
                <p className="text-sm font-semibold text-slate-900">Shared workspace areas</p>
                <div className="mt-4 flex flex-wrap gap-2.5">
                  {workspaceAreas.map((area) => (
                    <span key={area} className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                      {area}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              {categoryProfiles.map((profile) => (
                <Link
                  key={profile.name}
                  href={profile.href}
                  className={`group flex h-full flex-col rounded-[30px] border border-slate-200 p-6 transition hover:-translate-y-0.5 hover:shadow-[0_16px_34px_rgba(20,27,26,0.08)] ${profile.tone}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-lg font-semibold text-slate-900">{profile.name}</p>
                    <ArrowRight className="h-4 w-4 text-slate-400 transition group-hover:text-slate-900" />
                  </div>
                  <p className="mt-3 flex-1 text-sm leading-6 text-slate-600">{profile.summary}</p>
                  <div className="mt-6 flex flex-wrap gap-2">
                    {profile.modules.map((module) => (
                      <span key={module} className="rounded-full bg-white/80 px-3 py-1.5 text-[12px] font-medium text-slate-600">
                        {module}
                      </span>
                    ))}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-black/5 bg-[#10292f] text-white">
        <div className="mx-auto max-w-7xl px-6 py-[4.5rem] md:py-[5.5rem]">
          <div className="grid gap-10 lg:grid-cols-[0.88fr_1.12fr] lg:items-start">
            <div className="max-w-xl">
              <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-white/45">Platform control</p>
              <h2 className={`${display.className} mt-3 text-[clamp(2rem,4vw,3.4rem)] leading-[1] tracking-[-0.05em] text-white`}>
                Built for the owner, not only the local dashboard.
              </h2>
              <p className="mt-4 text-[16px] leading-7 text-white/72">
                QueueFlow is meant to scale across organizations, templates, plans, and feature rollouts. The platform
                layer should feel like a real operating console, not an afterthought.
              </p>
              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                {[
                  { label: 'Organizations', value: '42' },
                  { label: 'Feature flags live', value: '18' },
                  { label: 'Support incidents', value: '2' },
                ].map((item) => (
                  <div key={item.label} className="rounded-[24px] border border-white/10 bg-white/5 px-4 py-4">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">{item.label}</p>
                    <p className={`${display.className} mt-3 text-3xl leading-none tracking-[-0.05em] text-white`}>{item.value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {ownerControls.map((control) => {
                const Icon = control.icon;
                return (
                  <div key={control.title} className="rounded-[30px] border border-white/10 bg-white/5 p-6">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-[#10292f]">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="mt-5 text-lg font-semibold text-white">{control.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-white/70">{control.description}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-black/5 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-[4.5rem] md:py-[5.5rem]">
          <div className="max-w-3xl">
            <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-slate-400">Customer journey</p>
            <h2 className={`${display.className} mt-3 text-[clamp(2rem,4vw,3.4rem)] leading-[1] tracking-[-0.05em] text-[#111716]`}>
              The experience feels modern before your team says a word.
            </h2>
            <p className="mt-4 text-[16px] leading-7 text-slate-600">
              The product has to work for staff and still feel calm, readable, and brandable for customers. That means
              mobile-first pages, no forced app installs, and a clear next step at every moment in the visit.
            </p>
          </div>

          <div className="mt-10 grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
            <div className="rounded-[32px] border border-slate-200 bg-[#fbfaf8] p-6 shadow-[0_16px_30px_rgba(20,27,26,0.04)]">
              <div className="mx-auto max-w-[280px] rounded-[30px] border border-slate-200 bg-white px-5 pb-7 pt-4 shadow-[0_18px_40px_rgba(20,27,26,0.06)]">
                <div className="mx-auto h-1.5 w-20 rounded-full bg-slate-900" />
                <div className="mt-6 flex items-center justify-center">
                  <div className="flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-[24px] bg-[#10292f] text-2xl font-semibold text-white">
                    12
                  </div>
                </div>
                <p className="mt-5 text-center text-lg font-semibold text-slate-900">You are next in line</p>
                <p className="mt-2 text-center text-sm leading-6 text-slate-500">Please head to service desk B. We will keep this page updated.</p>
                <div className="mt-5 h-2 rounded-full bg-slate-100">
                  <div className="h-full w-4/5 rounded-full bg-[#10292f]" />
                </div>
                <div className="mt-5 space-y-3">
                  {[
                    { label: 'Status', value: 'Called' },
                    { label: 'Service', value: 'Document review' },
                    { label: 'Notify', value: 'Push + display board' },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center justify-between rounded-2xl bg-[#f6f7f4] px-3 py-2.5">
                      <span className="text-sm text-slate-500">{item.label}</span>
                      <span className="text-sm font-medium text-slate-900">{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-4">
              {customerMoments.map((moment) => (
                <div key={moment.title} className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_24px_rgba(20,27,26,0.04)]">
                  <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-slate-400">Visitor experience</p>
                  <h3 className="mt-3 text-xl font-semibold text-slate-900">{moment.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{moment.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[linear-gradient(180deg,_#f6f1ea_0%,_#fff7ee_100%)]">
        <div className="mx-auto max-w-5xl px-6 py-20 text-center md:py-24">
          <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-slate-400">Start the rebuild</p>
          <h2 className={`${display.className} mx-auto mt-3 max-w-4xl text-[clamp(2.2rem,4.5vw,4rem)] leading-[0.98] tracking-[-0.05em] text-[#111716]`}>
            Start with one location. Grow into a category-aware customer flow platform.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-[16px] leading-7 text-slate-600">
            Launch a single command center now, then expand into bookings, reservations, displays, and owner-level
            controls as the operation grows.
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
              href="/pricing"
              className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
            >
              View pricing
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
