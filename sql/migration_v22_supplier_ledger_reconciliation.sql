-- v22: one supplier ledger source of truth, opening balances and purchase
-- returns. Additive only; existing purchases/payments remain untouched.
begin;

alter table public.suppliers add column if not exists opening_balance numeric(18,2) not null default 0;

alter table public.inventory_movements drop constraint if exists inventory_movements_type_check;
alter table public.inventory_movements add constraint inventory_movements_type_check
  check (type in ('in','out','adjustment','sale','refund','purchase_return','transfer_in','transfer_out','stock_count','opening_balance'));

create table if not exists public.purchase_returns (
  id uuid primary key default gen_random_uuid(),
  original_purchase_id uuid not null references public.purchases(id),
  supplier_id uuid not null references public.suppliers(id),
  branch_id uuid not null references public.branches(id),
  total numeric(18,2) not null default 0 check (total >= 0),
  status text not null default 'completed' check (status in ('completed','cancelled')),
  created_by uuid references public.profiles(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.purchase_return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.purchase_returns(id) on delete cascade,
  original_purchase_id uuid not null references public.purchases(id),
  original_purchase_item_id uuid not null references public.purchase_items(id),
  supplier_id uuid not null references public.suppliers(id),
  branch_id uuid not null references public.branches(id),
  product_id uuid references public.products(id),
  quantity numeric(18,3) not null check (quantity > 0),
  unit_cost numeric(18,2) not null default 0,
  total numeric(18,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists ux_purchase_return_item_once on public.purchase_return_items(return_id, original_purchase_item_id);
create index if not exists idx_purchase_returns_supplier on public.purchase_returns(supplier_id, created_at);
create index if not exists idx_purchase_return_items_original on public.purchase_return_items(original_purchase_item_id);

alter table public.purchase_returns enable row level security;
alter table public.purchase_return_items enable row level security;
drop policy if exists purchase_returns_branch_scoped on public.purchase_returns;
create policy purchase_returns_branch_scoped on public.purchase_returns for all to authenticated
  using (public.is_admin() or branch_id = public.current_branch_id())
  with check (public.is_admin() or branch_id = public.current_branch_id());
drop policy if exists purchase_return_items_branch_scoped on public.purchase_return_items;
create policy purchase_return_items_branch_scoped on public.purchase_return_items for all to authenticated
  using (public.is_admin() or branch_id = public.current_branch_id())
  with check (public.is_admin() or branch_id = public.current_branch_id());

-- Repair only the denormalized supplier.balance cache. No business row is
-- deleted; with opening_balance=0, purchases 2668 and payments 2668 becomes 0.
update public.suppliers s
set balance = coalesce(s.opening_balance, 0)
  + coalesce((select sum(p.total) from public.purchases p where p.supplier_id=s.id and p.status <> 'cancelled'), 0)
  - coalesce((select sum(pr.total) from public.purchase_returns pr where pr.supplier_id=s.id and pr.status='completed'), 0)
  - coalesce((select sum(p.paid_amount) from public.purchases p where p.supplier_id=s.id and p.status <> 'cancelled'), 0)
  - coalesce((select sum(sp.amount) from public.supplier_payments sp where sp.supplier_id=s.id), 0),
  updated_at = now();

do $$ begin
  alter publication supabase_realtime add table public.purchase_returns;
exception when duplicate_object or undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.purchase_return_items;
exception when duplicate_object or undefined_object then null; end $$;

commit;
