-- v23: Generic Repair Management module.
-- Additive only: no existing table, column, trigger, or policy is
-- dropped or altered in a breaking way. New tables mirror the local
-- SQLite cache table-for-table (see electron/db/localSchema.js +
-- electron/db/tableConfig.js) so the existing generic query/sync engine
-- covers them automatically — no new IPC channel needed for basic CRUD.
begin;

-- 'technician' is a new role: diagnoses/repairs devices but does not get
-- admin/manager/cashier scope elsewhere. Existing rows are unaffected
-- since we only widen the allowed set.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin','manager','cashier','technician'));

create table if not exists public.technicians (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  specialty text,
  commission_percent numeric(6,2) not null default 0,
  is_active boolean not null default true,
  branch_id uuid references public.branches(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.repair_orders (
  id uuid primary key default gen_random_uuid(),
  repair_number text not null unique,
  branch_id uuid not null references public.branches(id),
  customer_id uuid references public.customers(id),
  customer_name text,
  customer_phone text,
  device_type text not null,
  device_model text,
  serial_number text,
  reported_issue text,
  device_condition text,
  accessories_received text,
  technician_id uuid references public.technicians(id),
  status text not null default 'received'
    check (status in ('received','inspection','waiting_approval','in_repair','ready','delivered','cancelled')),
  diagnosis text,
  required_parts_notes text,
  labor_cost numeric(18,2) not null default 0,
  parts_cost numeric(18,2) not null default 0,
  discount numeric(18,2) not null default 0,
  estimated_total numeric(18,2) not null default 0,
  total numeric(18,2) not null default 0,
  deposit_amount numeric(18,2) not null default 0,
  paid_amount numeric(18,2) not null default 0,
  remaining_amount numeric(18,2) not null default 0,
  approval_status text not null default 'pending' check (approval_status in ('pending','approved','rejected')),
  approved_at timestamptz,
  expected_delivery_date date,
  delivered_at timestamptz,
  cancelled_reason text,
  warranty_days integer not null default 0,
  warranty_start_date date,
  warranty_expiry_date date,
  is_warranty_claim boolean not null default false,
  original_repair_id uuid references public.repair_orders(id),
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.repair_status_history (
  id uuid primary key default gen_random_uuid(),
  repair_id uuid not null references public.repair_orders(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  status text not null,
  notes text,
  changed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.repair_parts_used (
  id uuid primary key default gen_random_uuid(),
  repair_id uuid not null references public.repair_orders(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  product_id uuid references public.products(id),
  product_name text,
  quantity numeric(18,3) not null default 1 check (quantity > 0),
  unit_cost numeric(18,2) not null default 0,
  unit_price numeric(18,2) not null default 0,
  total numeric(18,2) not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.repair_payments (
  id uuid primary key default gen_random_uuid(),
  repair_id uuid not null references public.repair_orders(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  customer_id uuid references public.customers(id),
  amount numeric(18,2) not null check (amount > 0),
  payment_method text default 'cash',
  payment_type text not null default 'payment' check (payment_type in ('deposit','payment')),
  received_by uuid references public.profiles(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.repair_photos (
  id uuid primary key default gen_random_uuid(),
  repair_id uuid not null references public.repair_orders(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  stage text not null default 'before' check (stage in ('before','during','after')),
  file_path text,
  caption text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.repair_notifications (
  id uuid primary key default gen_random_uuid(),
  repair_id uuid not null references public.repair_orders(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  event_type text not null,
  channel text not null default 'whatsapp',
  message text,
  sent_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_technicians_branch on public.technicians(branch_id);
create index if not exists idx_repair_orders_branch on public.repair_orders(branch_id, created_at);
create index if not exists idx_repair_orders_status on public.repair_orders(status);
create index if not exists idx_repair_orders_serial on public.repair_orders(serial_number);
create index if not exists idx_repair_orders_customer on public.repair_orders(customer_id);
create index if not exists idx_repair_orders_technician on public.repair_orders(technician_id);
create index if not exists idx_repair_status_history_repair on public.repair_status_history(repair_id);
create index if not exists idx_repair_parts_used_repair on public.repair_parts_used(repair_id);
create index if not exists idx_repair_payments_repair on public.repair_payments(repair_id);
create index if not exists idx_repair_photos_repair on public.repair_photos(repair_id);
create index if not exists idx_repair_notifications_repair on public.repair_notifications(repair_id);

-- Row level security: same branch-scoped pattern as every other table
-- (public.is_admin() / public.current_branch_id(), see sql/schema.sql).
alter table public.technicians enable row level security;
alter table public.repair_orders enable row level security;
alter table public.repair_status_history enable row level security;
alter table public.repair_parts_used enable row level security;
alter table public.repair_payments enable row level security;
alter table public.repair_photos enable row level security;
alter table public.repair_notifications enable row level security;

drop policy if exists technicians_branch_scoped on public.technicians;
create policy technicians_branch_scoped on public.technicians for all to authenticated
  using (public.is_admin() or branch_id = public.current_branch_id())
  with check (public.is_admin() or branch_id = public.current_branch_id());

drop policy if exists repair_orders_branch_scoped on public.repair_orders;
create policy repair_orders_branch_scoped on public.repair_orders for all to authenticated
  using (public.is_admin() or branch_id = public.current_branch_id())
  with check (public.is_admin() or branch_id = public.current_branch_id());

drop policy if exists repair_status_history_branch_scoped on public.repair_status_history;
create policy repair_status_history_branch_scoped on public.repair_status_history for all to authenticated
  using (public.is_admin() or branch_id = public.current_branch_id())
  with check (public.is_admin() or branch_id = public.current_branch_id());

drop policy if exists repair_parts_used_branch_scoped on public.repair_parts_used;
create policy repair_parts_used_branch_scoped on public.repair_parts_used for all to authenticated
  using (public.is_admin() or branch_id = public.current_branch_id())
  with check (public.is_admin() or branch_id = public.current_branch_id());

drop policy if exists repair_payments_branch_scoped on public.repair_payments;
create policy repair_payments_branch_scoped on public.repair_payments for all to authenticated
  using (public.is_admin() or branch_id = public.current_branch_id())
  with check (public.is_admin() or branch_id = public.current_branch_id());

drop policy if exists repair_photos_branch_scoped on public.repair_photos;
create policy repair_photos_branch_scoped on public.repair_photos for all to authenticated
  using (public.is_admin() or branch_id = public.current_branch_id())
  with check (public.is_admin() or branch_id = public.current_branch_id());

drop policy if exists repair_notifications_branch_scoped on public.repair_notifications;
create policy repair_notifications_branch_scoped on public.repair_notifications for all to authenticated
  using (public.is_admin() or branch_id = public.current_branch_id())
  with check (public.is_admin() or branch_id = public.current_branch_id());

do $$ begin
  alter publication supabase_realtime add table public.technicians;
exception when duplicate_object or undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.repair_orders;
exception when duplicate_object or undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.repair_status_history;
exception when duplicate_object or undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.repair_parts_used;
exception when duplicate_object or undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.repair_payments;
exception when duplicate_object or undefined_object then null; end $$;

commit;
