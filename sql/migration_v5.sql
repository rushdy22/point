-- =====================================================================
-- POS SYSTEM - MIGRATION V5 (additive, safe to run on existing DB)
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- 1) Ensures the employees / commission module tables exist (idempotent —
--    safe even if you already created them yourself; nothing is dropped).
-- 2) Adds updated_at + triggers to customers/sales so the offline-first
--    SQLite sync engine can pull incremental changes correctly (needed
--    because these rows get updated after creation — e.g. a customer's
--    running totals, or a sale's status on refund).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) EMPLOYEES / COMMISSION MODULE
-- ---------------------------------------------------------------------
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  salary numeric(12,2) not null default 0,
  default_commission_percent numeric(5,2) not null default 0,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.employee_branch_rates (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  commission_percent numeric(5,2) not null default 0,
  unique (employee_id, branch_id)
);

create table if not exists public.employee_transactions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  type text not null check (type in ('deduction','advance','commission_manual','commission_auto')),
  amount numeric(12,2) not null default 0,
  branch_id uuid references public.branches(id),
  sale_id uuid references public.sales(id),
  description text,
  txn_date date not null default current_date,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_employee_transactions_employee on public.employee_transactions(employee_id);
create index if not exists idx_employee_transactions_date on public.employee_transactions(txn_date);

alter table public.sales add column if not exists employee_id uuid references public.employees(id);

alter table public.employees enable row level security;
alter table public.employee_branch_rates enable row level security;
alter table public.employee_transactions enable row level security;

drop policy if exists "employees_all" on public.employees;
create policy "employees_all" on public.employees for all
  to authenticated using (true) with check (true);

drop policy if exists "employee_branch_rates_all" on public.employee_branch_rates;
create policy "employee_branch_rates_all" on public.employee_branch_rates for all
  to authenticated using (true) with check (true);

drop policy if exists "employee_transactions_all" on public.employee_transactions;
create policy "employee_transactions_all" on public.employee_transactions for all
  to authenticated using (true) with check (true);

do $$ begin
  alter publication supabase_realtime add table public.employees;
exception when duplicate_object or undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.employee_branch_rates;
exception when duplicate_object or undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.employee_transactions;
exception when duplicate_object or undefined_object then null; end $$;

-- ---------------------------------------------------------------------
-- 2) updated_at TRACKING for offline-sync watermarks
-- ---------------------------------------------------------------------
alter table public.customers add column if not exists updated_at timestamptz not null default now();
alter table public.sales add column if not exists updated_at timestamptz not null default now();

drop trigger if exists trg_customers_updated_at on public.customers;
create trigger trg_customers_updated_at
  before update on public.customers
  for each row execute procedure public.set_updated_at();

drop trigger if exists trg_sales_updated_at on public.sales;
create trigger trg_sales_updated_at
  before update on public.sales
  for each row execute procedure public.set_updated_at();

-- =====================================================================
-- NOTE: public.set_updated_at() and public.is_admin() are assumed to
-- already exist from earlier migrations (schema.sql / migration_v2.sql).
-- =====================================================================
