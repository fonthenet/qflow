-- Replace BYO payment methods with a single optional `accepts_cash` flag on organizations.
--
-- Rationale: "only keep cash" + "and its optional" — businesses opt in with one toggle.
-- No more multi-method table, no QR images, no WhatsApp QR keyword, no storage bucket.
-- The toggle is off by default; Qflo takes zero role in payment processing.

-- 1. Add the single opt-in flag on organizations.
alter table organizations
  add column if not exists accepts_cash boolean not null default false;

-- 2. Seed: any org that currently has an enabled cash row keeps cash accepted.
update organizations o
   set accepts_cash = true
  where exists (
    select 1
      from org_payment_methods m
     where m.organization_id = o.id
       and m.type = 'cash'
       and m.enabled = true
  );

-- 3. Drop the multi-method scaffold.
drop table if exists org_payment_methods cascade;

-- 4. Remove the QR storage bucket and its policies (no more QR images).
do $$
begin
  -- Policies first (bucket deletion is blocked while policies reference it).
  delete from storage.policies where bucket_id = 'payment-qrs';
exception when undefined_table then
  -- storage.policies layout varies across Supabase versions; fall through.
  null;
end $$;

delete from storage.objects where bucket_id = 'payment-qrs';
delete from storage.buckets where id = 'payment-qrs';
