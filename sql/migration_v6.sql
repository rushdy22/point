-- =====================================================================
-- POS SYSTEM - MIGRATION V6: PER-BRANCH CATEGORIES (additive, safe)
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Categories used to be global/shared across all branches on purpose
-- (see migration_v4.sql). This makes them branch-scoped instead, exactly
-- like products already are: every existing category is assigned to
-- "الفرع الرئيسي" (MAIN) so nothing disappears, then branch_id becomes
-- required going forward. If you want the SAME set of categories to
-- exist independently in another branch too, duplicate them manually
-- from the الأقسام page after running this (each branch then edits its
-- own copy independently — that's the whole point of this migration).
-- =====================================================================

-- 1) add the column (nullable first, so this is safe to run on a live DB)
alter table public.categories add column if not exists branch_id uuid references public.branches(id);

-- 2) backfill every existing category onto the MAIN branch
do $$
declare main_id uuid;
begin
  select id into main_id from public.branches where code = 'MAIN' limit 1;
  if main_id is not null then
    update public.categories set branch_id = main_id where branch_id is null;
  end if;
end $$;

-- 3) lock it down — every category from now on must belong to a branch
alter table public.categories alter column branch_id set not null;

create index if not exists idx_categories_branch on public.categories(branch_id);

-- 4) RLS stays permissive (this system enforces branch scoping at the
--    application-query level, same as products/customers/sales) — no
--    policy change needed, "categories_all" already covers this.
