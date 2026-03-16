import Link from 'next/link';
import type { SandboxPreviewData } from '@/lib/platform/sandbox-preview';
import { SandboxQrCard } from '@/components/sandbox/sandbox-qr-card';
import { sandboxSurfaceMeta } from '@/lib/platform/sandbox-surfaces';

function OverviewCard({
  title,
  description,
  href,
}: {
  title: string;
  description: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-[1.75rem] border border-border bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
    >
      <p className="text-lg font-semibold text-slate-950">{title}</p>
      <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
    </Link>
  );
}

export function SandboxOverview({ preview }: { preview: SandboxPreviewData }) {
  const surfaceHref: Record<string, string> = {
    overview: preview.links.hub,
    booking: preview.links.booking,
    kiosk: preview.links.kiosk,
    desk: preview.links.desk,
    queue: preview.links.queue,
    display: preview.links.display,
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="space-y-6">
        <div className="rounded-[2rem] border border-border bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary/80">
            Full test ride
          </p>
          <h2 className="mt-3 text-4xl font-black tracking-tight text-slate-950">
            Try the business like a real customer would
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
            Open each preview below to test booking, kiosk issue, queue tracking, and the large display experience. Every page is sandboxed and clearly marked so the business can explore with confidence.
          </p>
          <div className="mt-5 rounded-[1.5rem] border border-primary/15 bg-primary/5 p-4">
            <p className="text-sm font-semibold text-slate-950">
              Active scenario: {preview.scenario.name}
            </p>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              {preview.scenario.description}
            </p>
            {preview.scenario.rotatesAutomatically && (
              <p className="mt-2 text-xs font-medium uppercase tracking-[0.16em] text-primary/80">
                Rotates automatically across {preview.scenario.total} sandbox scenarios
              </p>
            )}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {sandboxSurfaceMeta
            .filter((surface) => surface.key !== 'overview')
            .map((surface) => (
              <OverviewCard
                key={surface.key}
                title={`${surface.label} preview`}
                description={surface.description}
                href={surfaceHref[surface.key]}
              />
            ))}
        </div>

        <div className="rounded-[2rem] border border-border bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary/80">
            Preloaded sandbox activity
          </p>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <div className="rounded-[1.5rem] border border-border bg-slate-50 p-4">
              <p className="text-sm font-semibold text-foreground">Sandbox bookings</p>
              <p className="mt-2 text-4xl font-black text-slate-950">{preview.bookings.length}</p>
            </div>
            <div className="rounded-[1.5rem] border border-border bg-slate-50 p-4">
              <p className="text-sm font-semibold text-foreground">Queue tickets</p>
              <p className="mt-2 text-4xl font-black text-slate-950">{preview.queueTickets.length}</p>
            </div>
            <div className="rounded-[1.5rem] border border-border bg-slate-50 p-4">
              <p className="text-sm font-semibold text-foreground">Open {preview.vocabulary.deskLabel.toLowerCase()}s</p>
              <p className="mt-2 text-4xl font-black text-slate-950">{preview.desks.length}</p>
            </div>
            {preview.tablePresets.length > 0 && (
              <div className="rounded-[1.5rem] border border-border bg-slate-50 p-4">
                <p className="text-sm font-semibold text-foreground">Tables in rotation</p>
                <p className="mt-2 text-4xl font-black text-slate-950">{preview.tablePresets.length}</p>
              </div>
            )}
            {preview.serviceAreas.length > 0 && (
              <div className="rounded-[1.5rem] border border-border bg-slate-50 p-4">
                <p className="text-sm font-semibold text-foreground">Service areas</p>
                <p className="mt-2 text-4xl font-black text-slate-950">{preview.serviceAreas.length}</p>
              </div>
            )}
          </div>
        </div>
      </section>

      <aside className="space-y-4">
        <SandboxQrCard
          title="Scan to open the sandbox"
          description="Use a real phone camera to open this template sandbox on another device."
          path={preview.links.hub}
        />

        <div className="rounded-[1.75rem] border border-border bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary/80">
            Current draft setup
          </p>
          <div className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
            <p>{preview.template.title}</p>
            <p>{preview.scenario.name}</p>
            <p>{preview.departments.length} {preview.vocabulary.departmentLabel.toLowerCase()}s</p>
            <p>{preview.departments.reduce((total, department) => total + department.services.length, 0)} {preview.vocabulary.serviceLabel.toLowerCase()}s</p>
            <p>{preview.displays.length > 0 ? `${preview.displays.length} display screens` : 'No starter display screens'}</p>
            {preview.tablePresets.length > 0 ? <p>{preview.tablePresets.length} tables ready for testing</p> : null}
          </div>
        </div>
      </aside>
    </div>
  );
}
