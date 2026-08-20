-- v21: fixed three-decimal inventory quantities, idempotent stock triggers,
-- and first-class partial sale returns. This migration is additive and does
-- not rewrite or delete existing business rows.

begin;

alter table public.products alter column stock_quantity type numeric(18,3) using round(stock_quantity::numeric, 3);
alter table public.products alter column low_stock_threshold type numeric(18,3) using round(low_stock_threshold::numeric, 3);
alter table public.sale_items alter column quantity type numeric(18,3) using round(quantity::numeric, 3);
alter table public.inventory_movements alter column quantity type numeric(18,3) using round(quantity::numeric, 3);
alter table public.purchase_items alter column quantity type numeric(18,3) using round(quantity::numeric, 3);
alter table public.stock_transfers alter column quantity type numeric(18,3) using round(quantity::numeric, 3);

alter table public.sale_items add column if not exists original_unit_price numeric(18,2);
alter table public.sale_items add column if not exists updated_at timestamptz;
alter table public.sale_items add column if not exists deleted_at timestamptz;
alter table public.inventory_movements add column if not exists updated_at timestamptz;
alter table public.inventory_movements add column if not exists deleted_at timestamptz;
alter table public.purchase_items add column if not exists updated_at timestamptz;
alter table public.purchase_items add column if not exists deleted_at timestamptz;

create table if not exists public.sale_returns (
  id uuid primary key default gen_random_uuid(),
  original_sale_id uuid not null references public.sales(id),
  branch_id uuid not null references public.branches(id),
  customer_id uuid references public.customers(id),
  total numeric(18,2) not null default 0 check (total >= 0),
  refund_method text not null default 'cash',
  status text not null default 'completed' check (status in ('completed','cancelled')),
  created_by uuid references public.profiles(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.sale_return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.sale_returns(id) on delete cascade,
  original_sale_id uuid not null references public.sales(id),
  original_sale_item_id uuid not null references public.sale_items(id),
  branch_id uuid not null references public.branches(id),
  product_id uuid references public.products(id),
  quantity numeric(18,3) not null check (quantity > 0),
  unit_price numeric(18,2) not null default 0,
  unit_cost numeric(18,2) not null default 0,
  total numeric(18,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists ux_sale_return_item_once on public.sale_return_items(return_id, original_sale_item_id);
create index if not exists idx_sale_returns_sale on public.sale_returns(original_sale_id, created_at);
create index if not exists idx_sale_returns_customer on public.sale_returns(customer_id, created_at);
create index if not exists idx_sale_return_items_original on public.sale_return_items(original_sale_item_id);

alter table public.sale_returns enable row level security;
alter table public.sale_return_items enable row level security;
drop policy if exists sale_returns_branch_scoped on public.sale_returns;
create policy sale_returns_branch_scoped on public.sale_returns for all to authenticated
  using (public.is_admin() or branch_id = public.current_branch_id())
  with check (public.is_admin() or branch_id = public.current_branch_id());
drop policy if exists sale_return_items_branch_scoped on public.sale_return_items;
create policy sale_return_items_branch_scoped on public.sale_return_items for all to authenticated
  using (public.is_admin() or branch_id = public.current_branch_id())
  with check (public.is_admin() or branch_id = public.current_branch_id());

create or replace function public.handle_sale_item_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare current_stock numeric;
begin
  if new.product_id is null then return new; end if;
  -- The local client uses the sale_item UUID as the movement UUID. If a
  -- retry already published the movement, this trigger must not deduct again.
  if exists (select 1 from public.inventory_movements where id = new.id) then return new; end if;
  select stock_quantity into current_stock from public.products where id = new.product_id for update;
  if current_stock is null or current_stock < new.quantity then
    raise exception 'INSUFFICIENT_STOCK';
  end if;
  update public.products set stock_quantity = stock_quantity - new.quantity where id = new.product_id;
  insert into public.inventory_movements (id, product_id, type, quantity, reason, created_by, branch_id, created_at)
  values (new.id, new.product_id, 'sale', -new.quantity, 'بيع - فاتورة', auth.uid(), new.branch_id, coalesce(new.created_at, now()));
  return new;
end;
$$;

create or replace function public.handle_purchase_item_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.product_id is null then return new; end if;
  if exists (select 1 from public.inventory_movements where id = new.id) then return new; end if;
  update public.products set stock_quantity = stock_quantity + new.quantity where id = new.product_id;
  insert into public.inventory_movements (id, product_id, type, quantity, reason, created_by, branch_id, created_at)
  values (new.id, new.product_id, 'in', new.quantity, 'شراء - فاتورة مشتريات', auth.uid(), new.branch_id, coalesce(new.created_at, now()));
  return new;
end;
$$;

drop trigger if exists trg_sale_item_stock on public.sale_items;
create trigger trg_sale_item_stock after insert on public.sale_items for each row execute procedure public.handle_sale_item_insert();
drop trigger if exists trg_purchase_item_stock on public.purchase_items;
create trigger trg_purchase_item_stock after insert on public.purchase_items for each row execute procedure public.handle_purchase_item_insert();

do $$ begin
  alter publication supabase_realtime add table public.sale_returns;
exception when duplicate_object or undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.sale_return_items;
exception when duplicate_object or undefined_object then null; end $$;

commit;
