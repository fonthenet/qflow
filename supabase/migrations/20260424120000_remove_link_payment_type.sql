-- Remove any existing link-type rows
delete from org_payment_methods where type = 'link';

-- Drop and re-create the CHECK constraint without 'link'
alter table org_payment_methods drop constraint if exists org_payment_methods_type_check;
alter table org_payment_methods add constraint org_payment_methods_type_check
  check (type in ('bank_transfer','mobile_money','qr_code','cash','custom'));
