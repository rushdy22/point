-- Customer credit and receipts ledger (additive).
alter table public.customers add column if not exists balance numeric(12,2) not null default 0;
alter table public.sales add column if not exists payment_status text not null default 'paid'
  check (payment_status in ('unpaid', 'partial', 'paid'));
alter table public.sale_items add column if not exists original_unit_price numeric(12,2);
update public.sale_items set original_unit_price = unit_price where original_unit_price is null;

create table if not exists public.customer_payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  branch_id uuid not null references public.branches(id),
  amount numeric(12,2) not null check (amount > 0),
  payment_method text not null default 'cash',
  paid_at timestamptz not null default now(),
  received_by uuid references public.profiles(id),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.customer_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.customer_payments(id) on delete cascade,
  sale_id uuid not null references public.sales(id),
  amount numeric(12,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique(payment_id, sale_id)
);
create index if not exists idx_customer_payments_customer on public.customer_payments(customer_id, paid_at);
create index if not exists idx_customer_payment_allocations_sale on public.customer_payment_allocations(sale_id);

alter table public.customer_payments enable row level security;
alter table public.customer_payment_allocations enable row level security;
drop policy if exists "customer_payments_branch_scoped" on public.customer_payments;
create policy "customer_payments_branch_scoped" on public.customer_payments for all to authenticated
  using (public.is_admin() or branch_id = public.current_branch_id())
  with check (public.is_admin() or branch_id = public.current_branch_id());
drop policy if exists "customer_payment_allocations_all" on public.customer_payment_allocations;
create policy "customer_payment_allocations_all" on public.customer_payment_allocations for all to authenticated using (true) with check (true);
do $$ begin alter publication supabase_realtime add table public.customer_payments; exception when duplicate_object or undefined_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.customer_payment_allocations; exception when duplicate_object or undefined_object then null; end $$;
