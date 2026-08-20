-- v24: Make repair type fully generic.
-- Run once in Supabase SQL Editor after the repair module migration.
-- Existing repair rows remain unchanged; only the hard-coded type restriction is removed.

begin;

-- Remove the old PlayStation/Xbox-only CHECK constraint if it exists.
alter table public.repair_orders
  drop constraint if exists repair_orders_device_type_check;

-- Keep the field required, but allow any user-entered repair type.
alter table public.repair_orders
  alter column device_type set not null;

commit;
