alter table public.intake_form_fields
add column if not exists visibility text not null default 'public',
add column if not exists consent_flag text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'intake_form_fields_visibility_check'
  ) then
    alter table public.intake_form_fields
    add constraint intake_form_fields_visibility_check
    check (visibility in ('public', 'staff_only', 'internal'));
  end if;
end $$;
