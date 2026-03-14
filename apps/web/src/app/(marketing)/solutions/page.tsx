import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { solutions } from '@/lib/data/solutions';

export default function SolutionsPage() {
  return (
    <div className="bg-white">
      {/* Hero */}
      <section className="pb-16 pt-20 md:pt-28">
        <div className="mx-auto max-w-6xl px-6 text-center">
          <p className="text-[13px] font-semibold uppercase tracking-widest text-gray-400">Solutions</p>
          <h1 className="mt-3 text-4xl font-bold tracking-[-0.03em] text-gray-900 md:text-5xl">
            Queue management for every industry
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-7 text-gray-500">
            Pre-configured templates tailored to your business. Choose your industry and start managing queues in minutes.
          </p>
        </div>
      </section>

      {/* Solutions Grid */}
      <section className="pb-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid gap-4 md:grid-cols-2">
            {solutions.map((solution) => (
              <Link
                key={solution.id}
                href={`/solutions/${solution.slug}`}
                className="group rounded-2xl border border-gray-100 bg-white p-6 transition-all hover:border-gray-200 hover:shadow-sm"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h2 className="text-lg font-semibold text-gray-900">
                      {solution.title}
                    </h2>
                    <p className="mt-1.5 text-[13px] leading-6 text-gray-500">
                      {solution.shortDescription}
                    </p>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-gray-300 transition-all group-hover:translate-x-0.5 group-hover:text-gray-900" />
                </div>

                {/* Stats */}
                <div className="mt-6 grid grid-cols-3 gap-4">
                  {solution.stats.map((stat) => (
                    <div key={stat.label} className="rounded-xl bg-gray-50 p-3 text-center">
                      <p className="text-lg font-semibold text-gray-900">{stat.value}</p>
                      <p className="text-[11px] text-gray-400">{stat.label}</p>
                    </div>
                  ))}
                </div>

                {/* Feature Pills */}
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {solution.features.slice(0, 4).map((f) => (
                    <span
                      key={f.title}
                      className="rounded-full bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-500"
                    >
                      {f.title}
                    </span>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-gray-100 bg-white py-16">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-2xl font-semibold text-gray-900">Don&apos;t see your industry?</h2>
          <p className="mt-3 text-[15px] text-gray-500">
            QueueFlow works for any business with a queue. Start with a blank template and customize everything.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-5 py-2.5 text-[14px] font-medium text-white transition hover:bg-gray-800"
            >
              Get started free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center rounded-lg border border-gray-200 px-5 py-2.5 text-[14px] font-medium text-gray-600 transition hover:bg-gray-50"
            >
              Contact us
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
