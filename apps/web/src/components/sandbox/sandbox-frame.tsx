import Link from 'next/link';
import type { ReactNode } from 'react';
import type { SandboxPreviewData } from '@/lib/platform/sandbox-preview';
import { sandboxSurfaceMeta } from '@/lib/platform/sandbox-surfaces';
import { SandboxResetFeedback } from '@/components/sandbox/sandbox-reset-feedback';
import { SandboxResetButton } from '@/components/sandbox/sandbox-reset-button';

export function SandboxFrame({
  preview,
  title,
  subtitle,
  resetHref,
  children,
}: {
  preview: SandboxPreviewData;
  title: string;
  subtitle: string;
  resetHref: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#dbeafe_0%,#eff6ff_24%,#ffffff_72%)]">
      <div className="border-b border-amber-200 bg-amber-50/90 px-4 py-3 text-center text-sm font-medium text-amber-900 backdrop-blur">
        Sandbox mode. Everything on this screen is a safe preview and never creates live bookings, queue tickets, cancellations, or alerts.
      </div>
      <SandboxResetFeedback />

      <header className="border-b border-border/70 bg-white/90 px-4 py-6 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            {preview.organization.logoUrl ? (
              <div className="flex h-20 w-20 items-center justify-center rounded-[1.75rem] border border-border bg-white shadow-sm">
                <img
                  src={preview.organization.logoUrl}
                  alt={`${preview.organization.name} logo`}
                  className="max-h-14 w-auto max-w-[56px] object-contain"
                />
              </div>
            ) : null}
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-primary/80">
                {preview.organization.name}
              </p>
              <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
                {title}
              </h1>
              <p className="mt-2 text-base text-slate-600">{subtitle}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <SandboxResetButton resetHref={resetHref} />
            {sandboxSurfaceMeta.map((surface) => {
              const href =
                surface.key === 'overview'
                  ? preview.links.hub
                  : preview.links[surface.key];

              return (
                <Link
                  key={surface.key}
                  href={href}
                  className="rounded-full border border-border bg-white px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
                >
                  {surface.label}
                </Link>
              );
            })}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
