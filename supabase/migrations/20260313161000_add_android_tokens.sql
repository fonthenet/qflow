create extension if not exists pgcrypto;

create table if not exists public.android_tokens (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  device_token text not null,
  package_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create unique index if not exists android_tokens_ticket_device_idx
  on public.android_tokens (ticket_id, device_token);

create index if not exists android_tokens_ticket_id_idx
  on public.android_tokens (ticket_id);

create index if not exists android_tokens_device_token_idx
  on public.android_tokens (device_token);

create or replace function public.set_android_tokens_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists android_tokens_set_updated_at on public.android_tokens;
create trigger android_tokens_set_updated_at
before update on public.android_tokens
for each row
execute function public.set_android_tokens_updated_at();

alter table public.android_tokens enable row level security;

create policy "android_tokens_select_all"
on public.android_tokens
for select
using (true);

create policy "android_tokens_insert_all"
on public.android_tokens
for insert
with check (true);

create policy "android_tokens_update_all"
on public.android_tokens
for update
using (true)
with check (true);

create policy "android_tokens_delete_all"
on public.android_tokens
for delete
using (true);
