import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, Check } from 'lucide-react';
import { getSolutionBySlug, getAllSolutionSlugs } from '@/lib/data/solutions';

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
    <>
      {/* Hero */}
      <section className="bg-gradient-to-br from-primary/5 via-background to-primary/10 py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-3xl text-center">
            <Link
              href="/solutions"
              className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              &larr; All Solutions
            </Link>
            <h1 className="text-4xl font-extrabold tracking-tight md:text-5xl">
              {solution.heroHeadline}
            </h1>
            <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
              {solution.heroSubheadline}
            </p>
            <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Link
                href="/register"
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-8 py-4 text-base font-semibold text-primary-foreground shadow-lg transition-all hover:bg-primary/90"
              >
                Get Started Free
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/how-it-works"
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-8 py-4 text-base font-semibold shadow-sm hover:bg-muted"
              >
                See How It Works
              </Link>
            </div>
          </div>

          {/* Stats */}
          <div className="mx-auto mt-16 grid max-w-2xl grid-cols-3 gap-8">
            {solution.stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <p className="text-4xl font-extrabold text-primary">{stat.value}</p>
                <p className="mt-1 text-sm text-muted-foreground">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pain Points */}
      <section className="py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold">The Problem</h2>
            <p className="mt-4 text-muted-foreground">
              Sound familiar? Qflo solves all of these.
            </p>
          </div>
          <div className="mx-auto mt-12 grid max-w-3xl gap-4 md:grid-cols-2">
            {solution.painPoints.map((pain) => (
              <div
                key={pain}
                className="flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-5"
              >
                <span className="mt-0.5 text-destructive">✕</span>
                <p className="text-sm font-medium">{pain}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-y border-border bg-muted/20 py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold">The Solution</h2>
            <p className="mt-4 text-muted-foreground">
              Features built specifically for {solution.title.toLowerCase()}.
            </p>
          </div>
          <div className="mt-16 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {solution.features.map((feature) => (
              <div
                key={feature.title}
                className="rounded-2xl border border-border bg-card p-6 transition-all hover:shadow-lg"
              >
                <div className="mb-3 inline-flex rounded-xl bg-primary/10 p-2.5 text-primary">
                  <Check className="h-5 w-5" />
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

      {/* Use Cases */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold">Real-World Use Cases</h2>
          </div>
          <div className="mx-auto mt-12 grid max-w-4xl gap-8 md:grid-cols-2">
            {solution.useCases.map((useCase) => (
              <div
                key={useCase.title}
                className="rounded-2xl border border-border bg-card p-8"
              >
                <h3 className="text-lg font-semibold">{useCase.title}</h3>
                <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                  {useCase.description}
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
            Ready to Transform Your {solution.title}?
          </h2>
          <p className="mt-4 text-lg text-primary-foreground/80">
            Start free with our {solution.title.toLowerCase()} template. Set up in under 3 minutes.
          </p>
          <div className="mt-8">
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-xl bg-white px-8 py-4 text-base font-semibold text-primary shadow-lg transition-all hover:shadow-xl"
            >
              Get Started Free
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="mt-6 flex items-center justify-center gap-6 text-sm text-primary-foreground/70">
            <span className="flex items-center gap-1.5"><Check className="h-4 w-4" /> Free forever plan</span>
            <span className="flex items-center gap-1.5"><Check className="h-4 w-4" /> No credit card</span>
            <span className="flex items-center gap-1.5"><Check className="h-4 w-4" /> {solution.title} template included</span>
          </div>
        </div>
      </section>
    </>
  );
}
