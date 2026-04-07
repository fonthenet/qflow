import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { solutions } from '@/lib/data/solutions';

export default function SolutionsPage() {
  return (
    <>
      {/* Hero */}
      <section className="bg-gradient-to-br from-primary/5 via-background to-primary/10 py-20">
        <div className="mx-auto max-w-7xl px-6 text-center">
          <h1 className="text-4xl font-extrabold tracking-tight md:text-5xl">
            Queue Management for Every Industry
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Pre-configured templates and features tailored to your business. Choose your industry and start managing queues in minutes.
          </p>
        </div>
      </section>

      {/* Solutions Grid */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid gap-8 md:grid-cols-2">
            {solutions.map((solution) => (
              <Link
                key={solution.id}
                href={`/solutions/${solution.slug}`}
                className="group rounded-2xl border border-border bg-card p-8 transition-all hover:border-primary/30 hover:shadow-xl"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h2 className="text-2xl font-bold group-hover:text-primary transition-colors">
                      {solution.title}
                    </h2>
                    <p className="mt-2 text-muted-foreground leading-relaxed">
                      {solution.shortDescription}
                    </p>
                  </div>
                  <ArrowRight className="h-5 w-5 text-muted-foreground transition-all group-hover:text-primary group-hover:translate-x-1" />
                </div>

                {/* Stats */}
                <div className="mt-6 grid grid-cols-3 gap-4">
                  {solution.stats.map((stat) => (
                    <div key={stat.label} className="text-center">
                      <p className="text-xl font-bold text-primary">{stat.value}</p>
                      <p className="text-xs text-muted-foreground">{stat.label}</p>
                    </div>
                  ))}
                </div>

                {/* Feature Pills */}
                <div className="mt-6 flex flex-wrap gap-2">
                  {solution.features.slice(0, 4).map((f) => (
                    <span
                      key={f.title}
                      className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground"
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
      <section className="border-t border-border bg-muted/20 py-20">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-3xl font-bold">Don&apos;t See Your Industry?</h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Qflo works for any business with a queue. Start with a blank template and customize everything.
          </p>
          <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-8 py-3.5 text-sm font-semibold text-primary-foreground shadow transition-all hover:bg-primary/90"
            >
              Contact Us
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
