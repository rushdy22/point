-- V33: Customer vehicle identity + sale customer snapshot + inactive-customer follow-up.
begin;

-- Customer master data. Keep repair_type for backward compatibility with older builds.
alter table public.customers add column if not exists vehicle_type text;
alter table public.customers add column if not exists vehicle_number text;

-- Persist customer contact/vehicle data on every sales invoice so A4/WhatsApp
-- reprints keep the exact customer data captured at checkout.
alter table public.sales add column if not exists customer_phone text;
alter table public.sales add column if not exists customer_vehicle_type text;
alter table public.sales add column if not exists customer_vehicle_number text;

create index if not exists idx_customers_vehicle_number on public.customers(vehicle_number);
create index if not exists idx_sales_customer_phone on public.sales(customer_phone);

-- Backfill new fields for records that already have a linked customer.
update public.customers c
set vehicle_type = coalesce(c.vehicle_type, c.repair_type)
where c.vehicle_type is null and c.repair_type is not null;

update public.customers c
set vehicle_number = (
  select ro.serial_number
  from public.repair_orders ro
  where ro.customer_id = c.id
    and ro.serial_number is not null
  order by ro.created_at desc nulls last, ro.id desc
  limit 1
)
where c.vehicle_number is null
  and exists (
    select 1
    from public.repair_orders ro
    where ro.customer_id = c.id
      and ro.serial_number is not null
  );

update public.sales s
set customer_phone = coalesce(s.customer_phone, c.phone),
    customer_vehicle_type = coalesce(s.customer_vehicle_type, c.vehicle_type),
    customer_vehicle_number = coalesce(s.customer_vehicle_number, c.vehicle_number)
from public.customers c
where s.customer_id = c.id;

commit;
