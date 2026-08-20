create table if not exists public.cash_shifts (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  opened_by uuid references public.profiles(id),
  opened_at timestamptz not null default now(),
  opening_float numeric(12,2) not null default 0,
  closed_by uuid references public.profiles(id),
  closed_at timestamptz,
  actual_cash_counted numeric(12,2), expected_cash numeric(12,2), difference numeric(12,2),
  status text not null default 'open' check (status in ('open', 'closed')),
  notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists idx_cash_shifts_one_open_per_branch on public.cash_shifts(branch_id) where status = 'open';
create index if not exists idx_cash_shifts_branch on public.cash_shifts(branch_id);
drop trigger if exists trg_cash_shifts_updated_at on public.cash_shifts;
create trigger trg_cash_shifts_updated_at before update on public.cash_shifts for each row execute procedure public.set_updated_at();

create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.cash_shifts(id) on delete cascade,
  branch_id uuid references public.branches(id),
  type text not null check (type in ('cash_in', 'cash_out')),
  amount numeric(12,2) not null check (amount > 0), reason text,
  created_by uuid references public.profiles(id), created_at timestamptz not null default now()
);
create index if not exists idx_cash_movements_shift on public.cash_movements(shift_id);

alter table public.cash_shifts enable row level security;
alter table public.cash_movements enable row level security;
drop policy if exists "cash_shifts_all" on public.cash_shifts;
create policy "cash_shifts_all" on public.cash_shifts for all to authenticated using (true) with check (true);
drop policy if exists "cash_movements_all" on public.cash_movements;
create policy "cash_movements_all" on public.cash_movements for all to authenticated using (true) with check (true);
do $$ begin alter publication supabase_realtime add table public.cash_shifts; exception when duplicate_object or undefined_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.cash_movements; exception when duplicate_object or undefined_object then null; end $$;
