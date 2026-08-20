-- =====================================================================
-- POS SYSTEM - MIGRATION V4: MULTI-BRANCH SUPPORT (additive, safe)
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- All existing data is preserved and automatically assigned to a
-- default branch ("الفرع الرئيسي" / code MAIN) created by this script.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) BRANCHES
-- ---------------------------------------------------------------------
create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique not null,
  address text,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.branches (name, code)
select 'الفرع الرئيسي', 'MAIN'
where not exists (select 1 from public.branches where code = 'MAIN');

-- ---------------------------------------------------------------------
-- 2) ADD branch_id COLUMNS (nullable first, backfilled, then locked down)
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists branch_id uuid references public.branches(id);
-- profiles.branch_id stays NULLABLE: null = admin with access to ALL branches.

alter table public.products add column if not exists branch_id uuid references public.branches(id);
alter table public.sales add column if not exists branch_id uuid references public.branches(id);
alter table public.sale_items add column if not exists branch_id uuid references public.branches(id);
alter table public.customers add column if not exists branch_id uuid references public.branches(id);
alter table public.transactions add column if not exists branch_id uuid references public.branches(id);
alter table public.inventory_movements add column if not exists branch_id uuid references public.branches(id);

-- backfill everything that predates this migration into the default branch
do $$
declare main_id uuid;
begin
  select id into main_id from public.branches where code = 'MAIN';

  update public.products set branch_id = main_id where branch_id is null;
  update public.sales set branch_id = main_id where branch_id is null;
  update public.sale_items si set branch_id = s.branch_id
    from public.sales s where si.sale_id = s.id and si.branch_id is null;
  update public.customers set branch_id = main_id where branch_id is null;
  update public.transactions set branch_id = main_id where branch_id is null;
  update public.inventory_movements set branch_id = main_id where branch_id is null;
  -- existing admins keep branch_id = null (all branches); everyone else -> MAIN
  update public.profiles set branch_id = main_id where branch_id is null and role <> 'admin';
end $$;

-- lock down NOT NULL where every row must belong to exactly one branch
alter table public.products alter column branch_id set not null;
alter table public.sales alter column branch_id set not null;
alter table public.sale_items alter column branch_id set not null;
alter table public.customers alter column branch_id set not null;
alter table public.transactions alter column branch_id set not null;
alter table public.inventory_movements alter column branch_id set not null;

-- ---------------------------------------------------------------------
-- 3) RE-SCOPE UNIQUENESS TO BE PER-BRANCH (was global before)
-- ---------------------------------------------------------------------
alter table public.products drop constraint if exists products_barcode_key;
drop index if exists idx_products_barcode;
create unique index if not exists uq_products_branch_barcode
  on public.products(branch_id, barcode) where barcode is not null;
create index if not exists idx_products_branch on public.products(branch_id);

alter table public.customers drop constraint if exists customers_phone_key;
drop index if exists idx_customers_phone;
create unique index if not exists uq_customers_branch_phone
  on public.customers(branch_id, phone) where phone is not null;
create index if not exists idx_customers_branch on public.customers(branch_id);

-- ---------------------------------------------------------------------
-- 4) PERFORMANCE INDEXES for common per-branch report queries
-- ---------------------------------------------------------------------
create index if not exists idx_sales_branch_created on public.sales(branch_id, created_at desc);
create index if not exists idx_sale_items_branch on public.sale_items(branch_id);
create index if not exists idx_sale_items_sale_branch on public.sale_items(sale_id, branch_id);
create index if not exists idx_transactions_branch_date on public.transactions(branch_id, txn_date desc);
create index if not exists idx_inventory_movements_branch on public.inventory_movements(branch_id, created_at desc);
create index if not exists idx_profiles_branch on public.profiles(branch_id);

-- ---------------------------------------------------------------------
-- 5) STOCK TRANSFERS BETWEEN BRANCHES (with history)
-- ---------------------------------------------------------------------
create table if not exists public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  from_branch_id uuid not null references public.branches(id),
  to_branch_id uuid not null references public.branches(id),
  from_product_id uuid references public.products(id),
  to_product_id uuid references public.products(id),
  product_name text not null,
  quantity numeric(12,2) not null check (quantity > 0),
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_stock_transfers_from on public.stock_transfers(from_branch_id, created_at desc);
create index if not exists idx_stock_transfers_to on public.stock_transfers(to_branch_id, created_at desc);

-- ---------------------------------------------------------------------
-- 6) helper: resolve the logged-in user's assigned branch (null = admin/all)
-- ---------------------------------------------------------------------
create or replace function public.current_branch_id()
returns uuid
language sql
security definer
stable
as $$
  select branch_id from public.profiles where id = auth.uid();
$$;

-- ---------------------------------------------------------------------
-- 7) UPDATE THE SALE-DRIVEN INVENTORY TRIGGER TO CARRY branch_id THROUGH
-- ---------------------------------------------------------------------
create or replace function public.handle_sale_item_insert()
returns trigger as $$
begin
  if new.product_id is not null then
    update public.products
      set stock_quantity = stock_quantity - new.quantity
      where id = new.product_id;

    insert into public.inventory_movements (product_id, type, quantity, reason, created_by, branch_id)
    values (new.product_id, 'sale', -new.quantity, 'بيع - فاتورة', auth.uid(), new.branch_id);
  end if;
  return new;
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------------------
-- 8) ROW LEVEL SECURITY: enforce branch scoping (admin bypasses via is_admin())
-- ---------------------------------------------------------------------
alter table public.branches enable row level security;
alter table public.stock_transfers enable row level security;

drop policy if exists "branches_select_all" on public.branches;
create policy "branches_select_all" on public.branches for select to authenticated using (true);

drop policy if exists "branches_admin_write" on public.branches;
create policy "branches_admin_write" on public.branches for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "products_all" on public.products;
create policy "products_branch_scoped" on public.products for all
  to authenticated
  using (public.is_admin() or branch_id = public.current_branch_id())
  with check (public.is_admin() or branch_id = public.current_branch_id());

drop policy if exists "customers_all" on public.customers;
create policy "customers_branch_scoped" on public.customers for all
  to authenticated
  using (public.is_admin() or branch_id = public.current_branch_id())
  with check (public.is_admin() or branch_id = public.current_branch_id());

drop policy if exists "sales_all" on public.sales;
create policy "sales_branch_scoped" on public.sales for all
  to authenticated
  using (public.is_admin() or branch_id = public.current_branch_id())
  with check (public.is_admin() or branch_id = public.current_branch_id());

drop policy if exists "sale_items_all" on public.sale_items;
create policy "sale_items_branch_scoped" on public.sale_items for all
  to authenticated
  using (public.is_admin() or branch_id = public.current_branch_id())
  with check (public.is_admin() or branch_id = public.current_branch_id());

drop policy if exists "transactions_all" on public.transactions;
create policy "transactions_branch_scoped" on public.transactions for all
  to authenticated
  using (public.is_admin() or branch_id = public.current_branch_id())
  with check (public.is_admin() or branch_id = public.current_branch_id());

-- inventory_movements: keep read broad for admin reports, but writes scoped
drop policy if exists "inventory_movements_all" on public.inventory_movements;
create policy "inventory_movements_branch_scoped" on public.inventory_movements for all
  to authenticated
  using (public.is_admin() or branch_id = public.current_branch_id())
  with check (public.is_admin() or branch_id = public.current_branch_id());

-- stock_transfers: only admin performs transfers (crosses branch boundaries)
drop policy if exists "stock_transfers_admin" on public.stock_transfers;
create policy "stock_transfers_admin" on public.stock_transfers for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

-- categories remain global/shared across branches (unchanged on purpose)

-- ---------------------------------------------------------------------
-- 9) REALTIME for the new tables
-- ---------------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.branches;
exception when duplicate_object or undefined_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.stock_transfers;
exception when duplicate_object or undefined_object then null; end $$;

-- =====================================================================
-- NOTE: after running this, every existing product/sale/customer/
-- transaction/movement now belongs to "الفرع الرئيسي" (MAIN). Create
-- additional branches from the "الفروع" page (admin), then assign
-- managers/cashiers to them from "المستخدمون".
-- =====================================================================
