import Link from 'next/link';
import { ArrowRight, LayoutGrid, Users } from 'lucide-react';
import { getAssetBoardData } from '../asset-board-data';

export default async function TablesPage({
  searchParams,
}: {
  searchParams: Promise<{ office?: string }>;
}) {
  const params = await searchParams;
  const data = await getAssetBoardData(params);

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-white/70 bg-[linear-gradient(135deg,_#2b1c0e_0%,_#52351d_100%)] px-6 py-6 text-white shadow-[0_24px_70px_rgba(43,28,14,0.16)] sm:px-8 sm:py-8">
        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#ffd396]">Seating operations</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              Tables are now a live operating layer, not a static floor-list.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-white/72">
              {data.organizationName} is configured for {data.businessType?.replace(/_/g, ' ') || 'service operations'}.
              Use this board to see which tables are serving now, which are being called next, and how much booked volume is still coming.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <HeroStat label="Total tables" value={data.summary.totalAssets.toString()} helper="Active seating assets in this office" />
            <HeroStat label="Serving now" value={data.summary.occupiedCount.toString()} helper="Actively occupied tables" />
            <HeroStat label="Called to seat" value={data.summary.calledCount.toString()} helper="Guests responding to a call" />
            <HeroStat label="Booked arrivals" value={data.summary.bookedCount.toString()} helper="Scheduled parties not checked in" />
          </div>
        </div>
      </section>

      <section className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-[0_14px_30px_rgba(20,27,26,0.04)] md:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <form action="/admin/tables" className="flex flex-wrap items-end gap-3">
            <label className="min-w-[240px]">
              <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Office</span>
              <select name="office" defaultValue={data.selectedOfficeId} className="w-full rounded-full border border-slate-200 bg-[#fbfaf8] px-4 py-2.5 text-sm text-slate-700 outline-none">
                {data.offices.map((office) => (
                  <option key={office.id} value={office.id}>{office.name}</option>
                ))}
              </select>
            </label>
            <button type="submit" className="rounded-full border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400">
              Apply
            </button>
          </form>

          <div className="flex gap-3">
            <Link href="/admin/desks" className="rounded-full border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400">
              Manage table assets
            </Link>
            <Link href="/admin/queue" className="inline-flex items-center justify-center gap-2 rounded-full bg-[#2b1c0e] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#52351d]">
              Open command center
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Available" value={data.summary.availableCount.toString()} helper="Ready for the next guest" />
        <MetricCard label="Waiting assignment" value={data.summary.waitingAssignmentCount.toString()} helper="Active visits not yet seated" />
        <MetricCard label="Called" value={data.summary.calledCount.toString()} helper="Guests moving toward a table" />
        <MetricCard label="Service board" value="Live" helper="Linked to desk occupancy and queue state" />
      </div>

      <section className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_12px_24px_rgba(20,27,26,0.04)]">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Table board</h2>
          <p className="mt-1 text-sm leading-7 text-slate-500">
            Status is inferred from the live queue and current desk assignment, so the seating picture stays aligned with what operators are doing.
          </p>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.assets.length === 0 ? (
            <div className="col-span-full rounded-[24px] border border-dashed border-slate-200 bg-[#fbfaf8] px-4 py-12 text-center text-sm text-slate-400">
              No active table assets configured for this office.
            </div>
          ) : (
            data.assets.map((asset) => {
              const status =
                asset.ticket?.status === 'serving'
                  ? { label: 'Occupied', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
                  : asset.ticket?.status === 'called'
                    ? { label: 'Called to seat', tone: 'bg-sky-50 text-sky-700 border-sky-200' }
                    : { label: 'Available', tone: 'bg-slate-100 text-slate-600 border-slate-200' };

              return (
                <article key={asset.id} className="rounded-[24px] border border-slate-200 bg-[#fbfaf8] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-lg font-semibold text-slate-950">{asset.display_name || asset.name}</p>
                      <p className="mt-1 text-sm text-slate-500">{asset.department?.name || 'Dining area'}</p>
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${status.tone}`}>{status.label}</span>
                  </div>

                  <div className="mt-4 grid gap-3">
                    <InfoPill label="Assigned staff" value={asset.current_staff?.full_name || 'Unassigned'} />
                    <InfoPill label="Current ticket" value={asset.ticket?.ticket_number || 'No active ticket'} />
                    <InfoPill label="Guest" value={asset.customerName || 'No seated guest'} />
                    <InfoPill label="Service" value={asset.ticket?.service?.name || 'Ready for next seating'} />
                  </div>
                </article>
              );
            })
          )}
        </div>
      </section>

      <aside className="rounded-[30px] border border-[#ead9c5] bg-[#fbf4ea] p-5">
        <div className="flex items-center gap-2">
          <LayoutGrid className="h-4 w-4 text-[#7a5a32]" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7a5a32]">Seating playbook</p>
        </div>
        <div className="mt-4 space-y-3">
          {[
            'Use the command center to call the next waiting guest, then watch the table status update here when the desk becomes active.',
            'Booked arrivals are counted separately so hosts can balance reservations against walk-in flow.',
            'Table assets still come from the desks workspace, so every seatable surface shares one source of truth.',
          ].map((item) => (
            <div key={item} className="rounded-[20px] border border-white/80 bg-white px-4 py-3 text-sm leading-6 text-[#664d2a]">
              {item}
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

function HeroStat({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/8 px-4 py-4">
      <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-white">{value}</p>
      <p className="mt-1 text-sm text-white/65">{helper}</p>
    </div>
  );
}

function MetricCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_10px_24px_rgba(20,27,26,0.04)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-1 text-sm text-slate-500">{helper}</p>
    </div>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] border border-white/80 bg-white px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className="mt-2 text-sm font-medium text-slate-900">{value}</p>
    </div>
  );
}
