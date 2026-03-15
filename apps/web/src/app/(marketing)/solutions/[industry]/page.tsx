import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight, CheckCircle2, Sparkles, Workflow } from 'lucide-react';
import { Sora } from 'next/font/google';
import { getAllSolutionSlugs, getSolutionBySlug } from '@/lib/data/solutions';

const display = Sora({
  subsets: ['latin'],
});

export function generateStaticParams() {
  return getAllSolutionSlugs().map((slug) => ({ industry: slug }));
}

interface IndustryPageProps {
  params: Promise<{ industry: string }>;
}

export default async function IndustryPage({ params }: IndustryPageProps) {
  const { industry } = await params;
  const solution = getSolutionBySlug(industry);

  if (!solution) notFound();

  return (
    <div className="bg-[#f6f1ea] text-slate-900">
      <section className="border-b border-black/5 bg-[radial-gradient(circle_at_top_left,_rgba(255,241,226,0.95),_rgba(246,241,234,0)_38%),radial-gradient(circle_at_right,_rgba(199,232,223,0.7),_rgba(246,241,234,0)_36%),linear-gradient(180deg,_#f8f4ee_0%,_#f6f1ea_100%)]">
        <div className="mx-auto max-w-7xl px-6 py-18 md:py-24">
          <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-end">
            <div className="max-w-4xl">
              <Link
                href="/solutions"
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
              >
                <ArrowLeft className="h-4 w-4" />
                All categories
              </Link>
              <p className="mt-6 text-[12px] font-semibold uppercase tracking-[0.2em] text-slate-400">{solution.title}</p>
              <h1 className={`${display.className} mt-4 text-[clamp(2.4rem,5vw,4.8rem)] leading-[0.98] tracking-[-0.055em] text-[#101717]`}>
                {solution.heroHeadline}
              </h1>
              <p className="mt-5 max-w-2xl text-[16px] leading-7 text-slate-600">
                {solution.heroSubheadline}
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link
                  href="/register"
                  className="inline-flex items-center gap-2 rounded-full bg-[#10292f] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#18383f]"
                >
                  Create your workspace
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/contact"
                  className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
                >
                  Talk through rollout
                </Link>
              </div>
            </div>

            <div className="rounded-[34px] border border-black/5 bg-[#10292f] p-6 text-white shadow-[0_18px_36px_rgba(20,27,26,0.08)]">
              <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">Category fit</p>
              <p className={`${display.className} mt-3 text-3xl leading-[1.02] tracking-[-0.05em] text-white`}>
                {solution.shortDescription}
              </p>
              <div className="mt-6 grid gap-3">
                {solution.features.slice(0, 3).map((feature) => (
                  <div key={feature.title} className="rounded-[22px] bg-white/8 px-4 py-4">
                    <p className="text-sm font-semibold text-white">{feature.title}</p>
                    <p className="mt-1 text-sm leading-6 text-white/72">{feature.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {solution.stats.map((stat) => (
              <div key={stat.label} className="rounded-[28px] border border-white/70 bg-white/80 p-6 text-center shadow-[0_14px_30px_rgba(20,27,26,0.05)]">
                <p className={`${display.className} text-4xl leading-none tracking-[-0.05em] text-[#10292f]`}>{stat.value}</p>
                <p className="mt-2 text-sm text-slate-600">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-6xl px-6 py-18 md:py-22">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-slate-400">Pressure points</p>
            <h2 className={`${display.className} mt-4 text-[clamp(2rem,4vw,3.2rem)] leading-[0.98] tracking-[-0.05em] text-[#111716]`}>
              Where {solution.title.toLowerCase()} teams lose momentum.
            </h2>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {solution.painPoints.map((pain) => (
              <div key={pain} className="rounded-[26px] border border-red-100 bg-red-50/70 p-5">
                <p className="text-sm font-semibold text-red-600">Pain point</p>
                <p className="mt-2 text-sm leading-7 text-slate-700">{pain}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-black/5 bg-[#10292f] text-white">
        <div className="mx-auto max-w-6xl px-6 py-18 md:py-22">
          <div className="grid gap-6 md:grid-cols-[0.8fr_1.2fr] md:items-start">
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-white/45">Workspace blueprint</p>
              <h2 className={`${display.className} mt-4 text-[clamp(2rem,4vw,3.2rem)] leading-[0.98] tracking-[-0.05em] text-white`}>
                What QueueFlow puts in place for this category.
              </h2>
              <p className="mt-5 text-sm leading-7 text-white/72">
                The template gives teams the right vocabulary, operating defaults, and customer-facing paths from day one without locking them into a rigid setup.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {solution.features.map((feature, index) => (
                <div key={feature.title} className="rounded-[28px] border border-white/10 bg-white/5 p-5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-[#10292f]">
                    <span className="text-sm font-semibold">{String(index + 1).padStart(2, '0')}</span>
                  </div>
                  <p className="mt-4 text-lg font-semibold text-white">{feature.title}</p>
                  <p className="mt-2 text-sm leading-7 text-white/75">{feature.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-6xl px-6 py-18 md:py-22">
          <div className="grid gap-8 lg:grid-cols-[1fr_0.9fr]">
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-slate-400">In practice</p>
              <h2 className={`${display.className} mt-4 text-[clamp(2rem,4vw,3.2rem)] leading-[0.98] tracking-[-0.05em] text-[#111716]`}>
                Typical customer-flow moments in {solution.title.toLowerCase()}.
              </h2>
              <div className="mt-8 space-y-4">
                {solution.useCases.map((useCase) => (
                  <div key={useCase.title} className="rounded-[28px] border border-slate-200 bg-[#fbfaf8] p-6 shadow-[0_14px_30px_rgba(20,27,26,0.04)]">
                    <p className="text-lg font-semibold text-slate-900">{useCase.title}</p>
                    <p className="mt-2 text-sm leading-7 text-slate-600">{useCase.description}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[34px] border border-slate-200 bg-[linear-gradient(180deg,_#f6f1ea_0%,_#fff7ee_100%)] p-6 shadow-[0_16px_32px_rgba(20,27,26,0.06)]">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#10292f] text-white">
                <Workflow className="h-5 w-5" />
              </div>
              <p className={`${display.className} mt-5 text-3xl leading-[1.02] tracking-[-0.05em] text-[#111716]`}>
                The goal is not another isolated queue tool.
              </p>
              <p className="mt-4 text-sm leading-7 text-slate-600">
                QueueFlow is most useful when arrivals, bookings, handoff, and live service all sit in one operational model.
              </p>

              <div className="mt-6 space-y-3">
                {[
                  'Category terminology and defaults from onboarding',
                  'One command center for live operations',
                  'App-free customer updates and status visibility',
                ].map((item) => (
                  <div key={item} className="flex items-start gap-3 rounded-[22px] border border-slate-200 bg-white px-4 py-4">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    <p className="text-sm leading-6 text-slate-600">{item}</p>
                  </div>
                ))}
              </div>

              <div className="mt-6 rounded-[24px] bg-[#10292f] px-5 py-5 text-white">
                <div className="flex items-center gap-3">
                  <Sparkles className="h-5 w-5 text-[#cfe8e2]" />
                  <p className="text-sm font-semibold">Best starting move</p>
                </div>
                <p className="mt-3 text-sm leading-7 text-white/75">
                  Use the category template to launch faster, then tune departments, services, and experience rules around your real operation.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[linear-gradient(180deg,_#f6f1ea_0%,_#fff7ee_100%)]">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center md:py-24">
          <h2 className={`${display.className} text-[clamp(2rem,4vw,3.6rem)] leading-[0.98] tracking-[-0.05em] text-[#111716]`}>
            Ready to build the {solution.title.toLowerCase()} workspace?
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-[16px] leading-7 text-slate-600">
            Start with the category blueprint, shape the public journey, and grow into the rest of the platform as the business expands.
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
              See plans
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
