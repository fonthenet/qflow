import Link from 'next/link';
import { ArrowRight, Sparkles } from 'lucide-react';
import { Sora } from 'next/font/google';
import { solutions } from '@/lib/data/solutions';

const display = Sora({
  subsets: ['latin'],
});

export default function SolutionsPage() {
  return (
    <div className="bg-[#f6f1ea] text-slate-900">
      <section className="border-b border-black/5 bg-[radial-gradient(circle_at_top_left,_rgba(255,241,226,0.95),_rgba(246,241,234,0)_38%),radial-gradient(circle_at_right,_rgba(199,232,223,0.7),_rgba(246,241,234,0)_36%),linear-gradient(180deg,_#f8f4ee_0%,_#f6f1ea_100%)]">
        <div className="mx-auto max-w-7xl px-6 py-18 md:py-24">
          <div className="mx-auto max-w-4xl text-center">
            <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-slate-400">Solutions</p>
            <h1 className={`${display.className} mt-4 text-[clamp(2.4rem,5vw,4.8rem)] leading-[0.98] tracking-[-0.055em] text-[#101717]`}>
              Category-aware workspaces for service businesses with real customer flow complexity.
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-[16px] leading-7 text-slate-600">
              QueueFlow keeps one operating model across categories while adapting the shell, defaults, and language to match how each business serves customers.
            </p>
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-6 py-18 md:py-22">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {solutions.map((solution) => (
              <Link
                key={solution.id}
                href={`/solutions/${solution.slug}`}
                className="group flex h-full flex-col rounded-[30px] border border-slate-200 bg-[#fbfaf8] p-6 shadow-[0_14px_30px_rgba(20,27,26,0.04)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_36px_rgba(20,27,26,0.08)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold text-slate-900">{solution.title}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{solution.shortDescription}</p>
                  </div>
                  <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-400 transition group-hover:text-slate-900" />
                </div>

                <div className="mt-5 grid grid-cols-3 gap-3">
                  {solution.stats.map((stat) => (
                    <div key={stat.label} className="rounded-[22px] bg-white p-3 text-center">
                      <p className="text-lg font-semibold text-slate-900">{stat.value}</p>
                      <p className="mt-1 text-[11px] leading-4 text-slate-400">{stat.label}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  {solution.features.slice(0, 3).map((feature) => (
                    <span key={feature.title} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600">
                      {feature.title}
                    </span>
                  ))}
                </div>

                <div className="mt-6 rounded-[24px] bg-[#10292f] px-4 py-4 text-white">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">Positioning</p>
                  <p className="mt-2 text-sm leading-6 text-white/82">{solution.heroHeadline}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-black/5 bg-[#10292f] text-white">
        <div className="mx-auto max-w-6xl px-6 py-18 md:py-22">
          <div className="grid gap-6 md:grid-cols-3">
            {[
              'One shared command center across categories.',
              'Category-specific language and defaults from onboarding.',
              'A platform layer that scales across organizations and templates.',
            ].map((item) => (
              <div key={item} className="rounded-[28px] border border-white/10 bg-white/5 p-6">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-[#10292f]">
                  <Sparkles className="h-5 w-5" />
                </div>
                <p className="mt-4 text-sm leading-7 text-white/82">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[linear-gradient(180deg,_#f6f1ea_0%,_#fff7ee_100%)]">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center md:py-24">
          <h2 className={`${display.className} text-[clamp(2rem,4vw,3.6rem)] leading-[0.98] tracking-[-0.05em] text-[#111716]`}>
            Don&apos;t see your category? Start with the universal model and shape it from there.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-[16px] leading-7 text-slate-600">
            QueueFlow is built for service businesses first. The category template just gets you to the right starting point faster.
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
              href="/contact"
              className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
            >
              Talk to us
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
