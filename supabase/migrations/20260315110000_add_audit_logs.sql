create extension if not exists pgcrypto;

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  office_id uuid null references public.offices(id) on delete set null,
  actor_staff_id uuid null references public.staff(id) on delete set null,
  action_type text not null,
  entity_type text not null,
  entity_id text null,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_organization_created_idx
  on public.audit_logs (organization_id, created_at desc);

create index if not exists audit_logs_office_created_idx
  on public.audit_logs (office_id, created_at desc);

create index if not exists audit_logs_actor_created_idx
  on public.audit_logs (actor_staff_id, created_at desc);

create index if not exists audit_logs_entity_idx
  on public.audit_logs (entity_type, entity_id);

alter table public.audit_logs enable row level security;

create policy "audit_logs_select_all"
on public.audit_logs
for select
using (true);

create policy "audit_logs_insert_all"
on public.audit_logs
for insert
with check (true);

create policy "audit_logs_update_all"
on public.audit_logs
for update
using (true)
with check (true);

create policy "audit_logs_delete_all"
on public.audit_logs
for delete
using (true);
