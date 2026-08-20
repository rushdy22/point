-- V31: WhatsApp message control, customer repair type, and true business-data reset.
begin;

alter table public.customers add column if not exists repair_type text;
alter table public.branches add column if not exists whatsapp_settings text;

create or replace function public.owner_admin_hard_delete_all()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ok boolean;
  t text;
  deleted_count bigint := 0;
  tables text[] := array[
    'repair_notifications','repair_photos','repair_status_history','repair_payments','repair_parts_used','repair_orders',
    'customer_payment_allocations','customer_payments','cash_movements','cash_shifts',
    'employee_transactions','employee_branch_rates','employees',
    'supplier_payments','purchase_return_items','purchase_returns','purchase_items','purchases','suppliers',
    'sale_return_items','sale_returns','sale_items','invoices','sales','inventory_movements','stock_transfers',
    'transactions','customers','technicians','products','categories'
  ];
begin
  select exists(select 1 from public.profiles where id = auth.uid() and is_active = true and (role='admin' or coalesce(is_owner_admin,false))) into ok;
  if not ok then raise exception 'permission-denied'; end if;
  foreach t in array tables loop
    execute format('delete from public.%I', t);
    get diagnostics deleted_count = row_count;
  end loop;
  begin alter sequence public.invoice_seq restart with 1; exception when undefined_object then null; end;
  begin alter sequence public.purchase_invoice_seq restart with 1; exception when undefined_object then null; end;
  return jsonb_build_object('success', true, 'message', 'ALL_BUSINESS_DATA_DELETED');
end;
$$;

grant execute on function public.owner_admin_hard_delete_all() to authenticated;

commit;
