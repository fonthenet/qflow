import Link from 'next/link';
import { ArrowRight, DoorOpen, Sparkles } from 'lucide-react';
import { getAssetBoardData } from '../asset-board-data';

export default async function RoomAssignmentPage({
  searchParams,
}: {
  searchParams: Promise<{ office?: string }>;
}) {
  const params = await searchParams;
  const data = await getAssetBoardData(params);

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-white/70 bg-[linear-gradient(135deg,_#10292f_0%,_#214e57_100%)] px-6 py-6 text-white shadow-[0_24px_70px_rgba(10,26,31,0.14)] sm:px-8 sm:py-8">
        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#8de2d5]">Resource routing</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              Rooms and service stations now reflect live occupancy and pending handoff.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-white/72">
              {data.organizationName} is configured for {data.businessType?.replace(/_/g, ' ') || 'service operations'}.
              Use this board when you need to see which rooms are in service, which are about to receive the next customer, and where assignment gaps still exist.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <HeroStat label="Rooms live" value={data.summary.totalAssets.toString()} helper="Active room or station assets" />
            <HeroStat label="Occupied" value={data.summary.occupiedCount.toString()} helper="Currently in service" />
            <HeroStat label="Next to arrive" value={data.summary.calledCount.toString()} helper="Called and moving into a room" />
            <HeroStat label="Awaiting assignment" value={data.summary.waitingAssignmentCount.toString()} helper="Waiting visits without a room yet" />
          </div>
        </div>
      </section>

      <section className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-[0_14px_30px_rgba(20,27,26,0.04)] md:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <form action="/admin/room-assignment" className="flex flex-wrap items-end gap-3">
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
              Manage room assets
            </Link>
            <Link href="/admin/queue" className="inline-flex items-center justify-center gap-2 rounded-full bg-[#10292f] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#18383f]">
              Open command center
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Available now" value={data.summary.availableCount.toString()} helper="Open for the next handoff" />
        <MetricCard label="Serving" value={data.summary.occupiedCount.toString()} helper="Active live sessions" />
        <MetricCard label="Called forward" value={data.summary.calledCount.toString()} helper="On the way to a room" />
        <MetricCard label="Booked volume" value={data.summary.bookedCount.toString()} helper="Scheduled arrivals still ahead" />
      </div>

      <section className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_12px_24px_rgba(20,27,26,0.04)]">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Assignment board</h2>
          <p className="mt-1 text-sm leading-7 text-slate-500">
            Asset state is derived from active desk assignments and live queue activity, so room readiness stays aligned with what staff is actually doing.
          </p>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.assets.length === 0 ? (
            <div className="col-span-full rounded-[24px] border border-dashed border-slate-200 bg-[#fbfaf8] px-4 py-12 text-center text-sm text-slate-400">
              No room assets configured for this office.
            </div>
          ) : (
            data.assets.map((asset) => {
              const status =
                asset.ticket?.status === 'serving'
                  ? { label: 'In service', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
                  : asset.ticket?.status === 'called'
                    ? { label: 'Reserved for next arrival', tone: 'bg-sky-50 text-sky-700 border-sky-200' }
                    : { label: 'Open', tone: 'bg-slate-100 text-slate-600 border-slate-200' };

              return (
                <article key={asset.id} className="rounded-[24px] border border-slate-200 bg-[#fbfaf8] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-lg font-semibold text-slate-950">{asset.display_name || asset.name}</p>
                      <p className="mt-1 text-sm text-slate-500">{asset.department?.name || 'Service area'}</p>
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${status.tone}`}>{status.label}</span>
                  </div>

                  <div className="mt-4 grid gap-3">
                    <InfoPill label="Staff owner" value={asset.current_staff?.full_name || 'Unassigned'} />
                    <InfoPill label="Active visit" value={asset.ticket?.ticket_number || 'No active visit'} />
                    <InfoPill label="Customer" value={asset.customerName || 'No one assigned'} />
                    <InfoPill label="Workflow" value={asset.ticket?.service?.name || 'Ready for next assignment'} />
                  </div>
                </article>
              );
            })
          )}
        </div>
      </section>

      <aside className="rounded-[30px] border border-[#d9ebe7] bg-[#f0f6f5] p-5">
        <div className="flex items-center gap-2">
          <DoorOpen className="h-4 w-4 text-[#446068]" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#446068]">Assignment playbook</p>
        </div>
        <div className="mt-4 space-y-3">
          {[
            'Use called state to reserve the next room before the customer physically arrives.',
            'Serving state marks a room as occupied, which prevents staff from double-assigning the same asset.',
            'Keep desks and rooms in one shared asset layer so hospitality, healthcare, and any room-based workflow stay consistent.',
          ].map((item) => (
            <div key={item} className="rounded-[20px] border border-white/80 bg-white px-4 py-3 text-sm leading-6 text-[#35525a]">
              {item}
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-[22px] border border-white/80 bg-white px-4 py-3 text-sm text-[#35525a]">
          <div className="flex items-center gap-2 font-semibold text-[#25444c]">
            <Sparkles className="h-4 w-4" />
            Shared asset model
          </div>
          <p className="mt-2 leading-6">
            This page uses the same desk model as command center assignments. That keeps room occupancy, staff ownership, and service handoff synchronized across the dashboard.
          </p>
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
