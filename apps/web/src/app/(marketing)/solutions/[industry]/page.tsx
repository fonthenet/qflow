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
    <div className="bg-white">
      {/* Hero */}
      <section className="pb-16 pt-20 md:pt-28">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto max-w-3xl text-center">
            <Link
              href="/solutions"
              className="mb-4 inline-flex items-center gap-1 text-[13px] font-medium text-gray-400 hover:text-gray-900"
            >
              &larr; All solutions
            </Link>
            <h1 className="text-3xl font-semibold tracking-[-0.03em] text-gray-900 md:text-4xl">
              {solution.heroHeadline}
            </h1>
            <p className="mt-4 text-[15px] leading-7 text-gray-500">
              {solution.heroSubheadline}
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
                href="/how-it-works"
                className="inline-flex items-center rounded-lg border border-gray-200 px-5 py-2.5 text-[14px] font-medium text-gray-600 transition hover:bg-gray-50"
              >
                See how it works
              </Link>
            </div>
          </div>

          {/* Stats */}
          <div className="mx-auto mt-14 grid max-w-2xl grid-cols-3 gap-4">
            {solution.stats.map((stat) => (
              <div key={stat.label} className="rounded-2xl bg-gray-50 p-5 text-center">
                <p className="text-3xl font-semibold text-gray-900">{stat.value}</p>
                <p className="mt-1 text-[13px] text-gray-500">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pain Points */}
      <section className="border-y border-gray-100 bg-white py-16">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-[13px] font-semibold text-red-500">The problem</p>
            <h2 className="mt-2 text-2xl font-semibold text-gray-900">Sound familiar?</h2>
          </div>
          <div className="mx-auto mt-10 grid max-w-3xl gap-3 md:grid-cols-2">
            {solution.painPoints.map((pain) => (
              <div
                key={pain}
                className="flex items-start gap-3 rounded-xl border border-red-100 bg-red-50/50 px-4 py-3.5"
              >
                <span className="mt-0.5 text-[13px] text-red-400">&#10005;</span>
                <p className="text-[13px] font-medium text-gray-700">{pain}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-[13px] font-semibold uppercase tracking-widest text-gray-400">The solution</p>
            <h2 className="mt-2 text-2xl font-semibold text-gray-900">
              Built for {solution.title.toLowerCase()}
            </h2>
          </div>
          <div className="mt-12 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {solution.features.map((feature) => (
              <div
                key={feature.title}
                className="rounded-xl border border-gray-100 bg-white p-5 transition-all hover:border-gray-200"
              >
                <div className="mb-3 inline-flex rounded-lg bg-emerald-50 p-2 text-emerald-500">
                  <Check className="h-4 w-4" />
                </div>
                <h3 className="text-sm font-semibold text-gray-900">{feature.title}</h3>
                <p className="mt-1.5 text-[13px] leading-6 text-gray-500">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Use Cases */}
      <section className="border-y border-gray-100 bg-white py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-[13px] font-semibold uppercase tracking-widest text-gray-400">Use cases</p>
            <h2 className="mt-2 text-2xl font-semibold text-gray-900">Real-world scenarios</h2>
          </div>
          <div className="mx-auto mt-10 grid max-w-4xl gap-4 md:grid-cols-2">
            {solution.useCases.map((useCase) => (
              <div
                key={useCase.title}
                className="rounded-xl border border-gray-100 bg-white p-6"
              >
                <h3 className="text-sm font-semibold text-gray-900">{useCase.title}</h3>
                <p className="mt-2 text-[13px] leading-6 text-gray-500">
                  {useCase.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-2xl font-semibold text-gray-900">
            Ready to transform your {solution.title.toLowerCase()}?
          </h2>
          <p className="mt-3 text-[15px] text-gray-500">
            Start free with our {solution.title.toLowerCase()} template. Set up in under 3 minutes.
          </p>
          <div className="mt-8">
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-5 py-2.5 text-[14px] font-medium text-white transition hover:bg-gray-800"
            >
              Get started free
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="mt-5 flex items-center justify-center gap-5 text-[12px] text-gray-400">
            <span className="flex items-center gap-1.5"><Check className="h-3 w-3" /> Free forever plan</span>
            <span className="flex items-center gap-1.5"><Check className="h-3 w-3" /> No credit card</span>
            <span className="flex items-center gap-1.5"><Check className="h-3 w-3" /> {solution.title} template</span>
          </div>
        </div>
      </section>
    </div>
  );
}
