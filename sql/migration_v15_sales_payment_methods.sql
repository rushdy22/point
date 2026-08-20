-- Allow the payment methods used by the current cashier application while
-- retaining legacy values already present in existing sales records.
-- Run this once in Supabase Dashboard -> SQL Editor.

alter table public.sales
  drop constraint if exists sales_payment_method_check;

alter table public.sales
  add constraint sales_payment_method_check
  check (payment_method in ('cash', 'card', 'mixed', 'instapay', 'wallet', 'visa'));
