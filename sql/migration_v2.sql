-- =====================================================================
-- POS SYSTEM - MIGRATION V2 (additive, safe to run on existing DB)
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Adds: customers, manual income/expense (transactions), manager role,
--       cost snapshot on sale_items, admin-can-manage-users policy,
--       realtime replication for live multi-device sync.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) ROLES: allow 'manager' in addition to 'admin' / 'cashier'
-- ---------------------------------------------------------------------
do $$
begin
  alter table public.profiles drop constraint if exists profiles_role_check;
  alter table public.profiles add constraint profiles_role_check
    check (role in ('admin','manager','cashier'));
exception when others then
  null;
end $$;

alter table public.profiles add column if not exists is_active boolean not null default true;

-- ---------------------------------------------------------------------
-- 2) CUSTOMERS
-- ---------------------------------------------------------------------
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text unique,
  total_purchases numeric(12,2) not null default 0,
  visits_count integer not null default 0,
  last_visit_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_customers_phone on public.customers(phone);

alter table public.sales add column if not exists customer_id uuid references public.customers(id);

alter table public.customers enable row level security;
drop policy if exists "customers_all" on public.customers;
create policy "customers_all" on public.customers for all
  to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------
-- 3) COST SNAPSHOT ON SALE ITEMS (needed for accurate profit reports)
-- ---------------------------------------------------------------------
alter table public.sale_items add column if not exists unit_cost numeric(12,2) not null default 0;

-- ---------------------------------------------------------------------
-- 4) ACCOUNTING: manual income / expense records
-- ---------------------------------------------------------------------
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('income','expense')),
  category text,
  amount numeric(12,2) not null check (amount >= 0),
  description text,
  txn_date date not null default current_date,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_transactions_date on public.transactions(txn_date);

alter table public.transactions enable row level security;
drop policy if exists "transactions_all" on public.transactions;
create policy "transactions_all" on public.transactions for all
  to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------
-- 5) ADMIN CAN MANAGE ALL PROFILES (roles / activation) WITHOUT RECURSION
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_update_own_or_admin" on public.profiles;
create policy "profiles_update_own_or_admin" on public.profiles for update
  to authenticated
  using (auth.uid() = id or public.is_admin())
  with check (auth.uid() = id or public.is_admin());

-- ---------------------------------------------------------------------
-- 6) REALTIME: enable live sync across devices for key tables
-- ---------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.products;
exception when duplicate_object or undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.sales;
exception when duplicate_object or undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.sale_items;
exception when duplicate_object or undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.customers;
exception when duplicate_object or undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.transactions;
exception when duplicate_object or undefined_object then null;
end $$;

-- If the DO blocks above raised "undefined_object" (publication doesn't
-- exist on your project), enable Realtime manually instead:
-- Supabase Dashboard -> Database -> Replication -> toggle the tables on.

-- =====================================================================
-- NOTE: existing sale_items rows created before this migration will have
-- unit_cost = 0, so profit reports for OLD sales will show full revenue
-- as profit. New sales going forward will record accurate cost.
-- =====================================================================
