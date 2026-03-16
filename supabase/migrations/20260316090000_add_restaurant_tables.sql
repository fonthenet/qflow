create table if not exists public.restaurant_tables (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  code text not null,
  label text not null,
  zone text,
  capacity integer,
  min_party_size integer,
  max_party_size integer,
  reservable boolean default true,
  status text not null default 'available',
  current_ticket_id uuid references public.tickets(id) on delete set null,
  assigned_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (office_id, code)
);

create index if not exists restaurant_tables_office_id_idx
  on public.restaurant_tables (office_id);

create index if not exists restaurant_tables_current_ticket_id_idx
  on public.restaurant_tables (current_ticket_id);

create index if not exists restaurant_tables_status_idx
  on public.restaurant_tables (status);

create or replace function public.set_restaurant_tables_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_restaurant_tables_updated_at on public.restaurant_tables;
create trigger trg_restaurant_tables_updated_at
before update on public.restaurant_tables
for each row
execute function public.set_restaurant_tables_updated_at();
