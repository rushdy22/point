-- =====================================================================
-- POS SYSTEM - MIGRATION V8: SUPPLIERS & PURCHASES (additive, safe)
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Adds: suppliers (with running balance), purchase invoices + items,
--       supplier payments, automatic stock increase on purchase items,
--       and automatic supplier balance updates.
-- Mirrors the existing customers/sales pattern on purpose so the app
-- code, offline SQLite mirror, and sync engine all stay consistent.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) SUPPLIERS
-- ---------------------------------------------------------------------
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  address text,
  notes text,
  -- amount the store currently owes this supplier (increases with each
  -- purchase's unpaid portion, decreases with each payment recorded)
  balance numeric(12,2) not null default 0,
  branch_id uuid not null references public.branches(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_suppliers_branch on public.suppliers(branch_id);

drop trigger if exists trg_suppliers_updated_at on public.suppliers;
create trigger trg_suppliers_updated_at
  before update on public.suppliers
  for each row execute procedure public.set_updated_at();

-- ---------------------------------------------------------------------
-- 2) PURCHASES (invoice header) + PURCHASE ITEMS (invoice lines)
-- ---------------------------------------------------------------------
create sequence if not exists public.purchase_invoice_seq start 1;

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  invoice_number text unique not null default ('PUR-' || to_char(now(),'YYYYMMDD') || '-' || lpad(nextval('purchase_invoice_seq')::text,5,'0')),
  supplier_id uuid not null references public.suppliers(id),
  branch_id uuid not null references public.branches(id),
  subtotal numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  paid_amount numeric(12,2) not null default 0,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_purchases_branch_created on public.purchases(branch_id, created_at desc);
create index if not exists idx_purchases_supplier on public.purchases(supplier_id);

drop trigger if exists trg_purchases_updated_at on public.purchases;
create trigger trg_purchases_updated_at
  before update on public.purchases
  for each row execute procedure public.set_updated_at();

create table if not exists public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  product_id uuid references public.products(id),
  product_name text not null,
  quantity numeric(12,2) not null default 1,
  unit_cost numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_purchase_items_purchase on public.purchase_items(purchase_id);
create index if not exists idx_purchase_items_product on public.purchase_items(product_id);

-- auto-increase stock + log movement whenever a purchase item is inserted
-- (mirrors public.handle_sale_item_insert, just the opposite direction)
create or replace function public.handle_purchase_item_insert()
returns trigger as $$
begin
  if new.product_id is not null then
    update public.products
      set stock_quantity = stock_quantity + new.quantity
      where id = new.product_id;

    insert into public.inventory_movements (product_id, type, quantity, reason, created_by, branch_id)
    values (new.product_id, 'in', new.quantity, 'شراء - فاتورة مشتريات', auth.uid(), new.branch_id);
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_purchase_item_stock on public.purchase_items;
create trigger trg_purchase_item_stock
  after insert on public.purchase_items
  for each row execute procedure public.handle_purchase_item_insert();

-- ---------------------------------------------------------------------
-- 3) SUPPLIER PAYMENTS (money paid toward a supplier's balance)
-- ---------------------------------------------------------------------
create table if not exists public.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  amount numeric(12,2) not null check (amount > 0),
  method text not null default 'cash' check (method in ('cash','card','other')),
  note text,
  txn_date date not null default current_date,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_supplier_payments_supplier on public.supplier_payments(supplier_id);
create index if not exists idx_supplier_payments_branch on public.supplier_payments(branch_id, created_at desc);

-- =====================================================================
-- ROW LEVEL SECURITY (branch-scoped, same shape as products/customers)
-- =====================================================================
alter table public.suppliers enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;
alter table public.supplier_payments enable row level security;

drop policy if exists "suppliers_branch_scoped" on public.suppliers;
create policy "suppliers_branch_scoped" on public.suppliers for all
  to authenticated
  using (public.is_admin() or branch_id = public.current_branch_id())
  with check (public.is_admin() or branch_id = public.current_branch_id());

drop policy if exists "purchases_branch_scoped" on public.purchases;
create policy "purchases_branch_scoped" on public.purchases for all
  to authenticated
  using (public.is_admin() or branch_id = public.current_branch_id())
  with check (public.is_admin() or branch_id = public.current_branch_id());

drop policy if exists "purchase_items_branch_scoped" on public.purchase_items;
create policy "purchase_items_branch_scoped" on public.purchase_items for all
  to authenticated
  using (public.is_admin() or branch_id = public.current_branch_id())
  with check (public.is_admin() or branch_id = public.current_branch_id());

drop policy if exists "supplier_payments_branch_scoped" on public.supplier_payments;
create policy "supplier_payments_branch_scoped" on public.supplier_payments for all
  to authenticated
  using (public.is_admin() or branch_id = public.current_branch_id())
  with check (public.is_admin() or branch_id = public.current_branch_id());

-- =====================================================================
-- REALTIME: live sync across devices for the new tables
-- =====================================================================
do $$ begin
  alter publication supabase_realtime add table public.suppliers;
exception when duplicate_object or undefined_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.purchases;
exception when duplicate_object or undefined_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.purchase_items;
exception when duplicate_object or undefined_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.supplier_payments;
exception when duplicate_object or undefined_object then null; end $$;

-- =====================================================================
-- NOTE: supplier.balance is maintained by the application (same pattern
-- as customers.total_purchases) so it works identically online and in
-- the offline-first SQLite mirror: creating a purchase adds
-- (total - paid_amount) to the balance, recording a payment subtracts
-- the paid amount. See src/lib/db/suppliers.js and purchases.js.
-- =====================================================================
