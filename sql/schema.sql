-- =====================================================================
-- POS SYSTEM - SUPABASE SCHEMA
-- Run this whole file in: Supabase Dashboard -> SQL Editor -> New query
-- NOTE (fresh installs): after this file, also run in order:
--   sql/migration_v2.sql, sql/migration_v3.sql, sql/migration_v4.sql
-- (v4 adds multi-branch support: branches table, branch_id scoping,
--  stock transfers between branches, and branch-based RLS.)
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1) PROFILES (extends auth.users) - stores role + display info
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  username text unique,
  role text not null default 'cashier' check (role in ('admin','manager','cashier')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- auto-create a profile row whenever a new auth user signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, username, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'username', new.email),
    coalesce(new.raw_user_meta_data->>'role', 'cashier')
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------
-- 2) CATEGORIES
-- ---------------------------------------------------------------------
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_en text,
  color text default '#0F766E',
  icon text default '📦',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3) PRODUCTS
-- ---------------------------------------------------------------------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_en text,
  barcode text unique,
  category_id uuid references public.categories(id) on delete set null,
  price numeric(12,2) not null default 0,
  cost numeric(12,2) not null default 0,
  stock_quantity numeric(12,2) not null default 0,
  low_stock_threshold numeric(12,2) not null default 5,
  unit text not null default 'قطعة',
  image_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_products_barcode on public.products(barcode);
create index if not exists idx_products_category on public.products(category_id);
create index if not exists idx_products_name on public.products using gin (to_tsvector('simple', name));

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
  before update on public.products
  for each row execute procedure public.set_updated_at();

-- ---------------------------------------------------------------------
-- 4) SALES (invoice header)
-- ---------------------------------------------------------------------
create sequence if not exists public.invoice_seq start 1;

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  invoice_number text unique not null default ('INV-' || to_char(now(),'YYYYMMDD') || '-' || lpad(nextval('invoice_seq')::text,5,'0')),
  cashier_id uuid references public.profiles(id),
  subtotal numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  tax numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  paid_amount numeric(12,2) not null default 0,
  change_amount numeric(12,2) not null default 0,
  payment_method text not null default 'cash' check (payment_method in ('cash','card','mixed','instapay','wallet','visa')),
  status text not null default 'completed' check (status in ('completed','refunded','cancelled')),
  customer_name text,
  customer_phone text,
  customer_vehicle_type text,
  customer_vehicle_number text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_sales_created_at on public.sales(created_at);
create index if not exists idx_sales_cashier on public.sales(cashier_id);

-- ---------------------------------------------------------------------
-- 5) SALE ITEMS (invoice lines)
-- ---------------------------------------------------------------------
create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id uuid references public.products(id),
  product_name text not null,
  quantity numeric(12,2) not null default 1,
  unit_price numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  unit_cost numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_sale_items_sale on public.sale_items(sale_id);
create index if not exists idx_sale_items_product on public.sale_items(product_id);

-- ---------------------------------------------------------------------
-- 5b) CUSTOMERS
-- ---------------------------------------------------------------------
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text unique,
  vehicle_type text,
  vehicle_number text,
  total_purchases numeric(12,2) not null default 0,
  visits_count integer not null default 0,
  last_visit_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_customers_phone on public.customers(phone);

alter table public.sales add column if not exists customer_id uuid references public.customers(id);

-- ---------------------------------------------------------------------
-- 5c) ACCOUNTING: manual income / expense records
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

-- ---------------------------------------------------------------------
-- 6) INVOICES (printable record / reprint tracking)
-- ---------------------------------------------------------------------
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid unique not null references public.sales(id) on delete cascade,
  invoice_number text not null,
  printed_count integer not null default 0,
  last_printed_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 7) INVENTORY MOVEMENTS (stock tracking / audit trail)
-- ---------------------------------------------------------------------
create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  type text not null check (type in ('in','out','adjustment','sale','refund')),
  quantity numeric(12,2) not null,
  reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_inv_moves_product on public.inventory_movements(product_id);

-- auto-decrement stock + log movement whenever a sale item is inserted
create or replace function public.handle_sale_item_insert()
returns trigger as $$
begin
  if new.product_id is not null then
    update public.products
      set stock_quantity = stock_quantity - new.quantity
      where id = new.product_id;

    insert into public.inventory_movements (product_id, type, quantity, reason, created_by)
    values (new.product_id, 'sale', -new.quantity, 'بيع - فاتورة', auth.uid());
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_sale_item_stock on public.sale_items;
create trigger trg_sale_item_stock
  after insert on public.sale_items
  for each row execute procedure public.handle_sale_item_insert();

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.invoices enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.customers enable row level security;
alter table public.transactions enable row level security;

-- profiles: user can read all profiles (needed to show cashier names),
-- but only edit their own row; admins can edit any row.
drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all" on public.profiles for select
  to authenticated using (true);

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

-- categories: any authenticated user can read/write (single-store system)
drop policy if exists "categories_all" on public.categories;
create policy "categories_all" on public.categories for all
  to authenticated using (true) with check (true);

-- products
drop policy if exists "products_all" on public.products;
create policy "products_all" on public.products for all
  to authenticated using (true) with check (true);

-- sales
drop policy if exists "sales_all" on public.sales;
create policy "sales_all" on public.sales for all
  to authenticated using (true) with check (true);

-- sale_items
drop policy if exists "sale_items_all" on public.sale_items;
create policy "sale_items_all" on public.sale_items for all
  to authenticated using (true) with check (true);

-- invoices
drop policy if exists "invoices_all" on public.invoices;
create policy "invoices_all" on public.invoices for all
  to authenticated using (true) with check (true);

-- inventory_movements
drop policy if exists "inventory_movements_all" on public.inventory_movements;
create policy "inventory_movements_all" on public.inventory_movements for all
  to authenticated using (true) with check (true);

-- customers
drop policy if exists "customers_all" on public.customers;
create policy "customers_all" on public.customers for all
  to authenticated using (true) with check (true);

-- transactions (accounting)
drop policy if exists "transactions_all" on public.transactions;
create policy "transactions_all" on public.transactions for all
  to authenticated using (true) with check (true);

-- =====================================================================
-- REALTIME: enable live sync across devices for key tables
-- =====================================================================
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

-- =====================================================================
-- SEED DATA (optional starter categories)
-- =====================================================================
insert into public.categories (name, name_en, color, icon)
values
  ('مشروبات', 'Beverages', '#0F766E', '🥤'),
  ('مواد غذائية', 'Groceries', '#D4A017', '🛒'),
  ('منظفات', 'Cleaning', '#2563EB', '🧴'),
  ('أخرى', 'Other', '#6B7280', '📦')
on conflict do nothing;

-- =====================================================================
-- NOTE: To create the first admin user:
-- 1. In Supabase Dashboard -> Authentication -> Users -> Add user
--    (email + password)
-- 2. Then run:
--    update public.profiles set role = 'admin', full_name = 'المدير'
--    where id = '<the-user-uuid>';
-- =====================================================================
