-- Allow push tokens to target either a ticket OR an appointment.
-- Enables instant APNs/Android push on appointment lifecycle transitions
-- (approved, declined, cancelled, no_show, checked_in, serving, completed).

-- apns_tokens ---------------------------------------------------------------

alter table public.apns_tokens
  add column if not exists appointment_id uuid references public.appointments(id) on delete cascade;

alter table public.apns_tokens
  alter column ticket_id drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'apns_tokens_target_check'
  ) then
    alter table public.apns_tokens
      add constraint apns_tokens_target_check
      check (ticket_id is not null or appointment_id is not null);
  end if;
end$$;

create index if not exists idx_apns_tokens_appointment
  on public.apns_tokens(appointment_id);

-- android_tokens ------------------------------------------------------------

alter table public.android_tokens
  add column if not exists appointment_id uuid references public.appointments(id) on delete cascade;

alter table public.android_tokens
  alter column ticket_id drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'android_tokens_target_check'
  ) then
    alter table public.android_tokens
      add constraint android_tokens_target_check
      check (ticket_id is not null or appointment_id is not null);
  end if;
end$$;

create unique index if not exists android_tokens_appointment_device_idx
  on public.android_tokens (appointment_id, device_token)
  where appointment_id is not null;

create index if not exists android_tokens_appointment_id_idx
  on public.android_tokens (appointment_id);
