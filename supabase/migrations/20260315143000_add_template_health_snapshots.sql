create extension if not exists pgcrypto;

create table if not exists public.template_health_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  office_id uuid null references public.offices(id) on delete cascade,
  actor_staff_id uuid null references public.staff(id) on delete set null,
  snapshot_scope text not null check (snapshot_scope in ('organization', 'office')),
  snapshot_type text not null,
  template_id text not null,
  applied_version text not null,
  latest_version text not null,
  organization_drift_count integer not null default 0,
  office_drift_count integer not null default 0,
  office_count integer not null default 0,
  offices_current_count integer not null default 0,
  offices_behind_count integer not null default 0,
  offices_with_drift integer not null default 0,
  current_version_coverage_percent integer not null default 0,
  branch_alignment_percent integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists template_health_snapshots_org_created_idx
  on public.template_health_snapshots (organization_id, created_at desc);

create index if not exists template_health_snapshots_office_created_idx
  on public.template_health_snapshots (office_id, created_at desc);

create index if not exists template_health_snapshots_scope_created_idx
  on public.template_health_snapshots (snapshot_scope, created_at desc);

create index if not exists template_health_snapshots_template_created_idx
  on public.template_health_snapshots (template_id, created_at desc);

alter table public.template_health_snapshots enable row level security;

create policy "template_health_snapshots_select_all"
on public.template_health_snapshots
for select
using (true);

create policy "template_health_snapshots_insert_all"
on public.template_health_snapshots
for insert
with check (true);

create policy "template_health_snapshots_update_all"
on public.template_health_snapshots
for update
using (true)
with check (true);

create policy "template_health_snapshots_delete_all"
on public.template_health_snapshots
for delete
using (true);
