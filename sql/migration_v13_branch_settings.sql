-- =====================================================================
-- MIGRATION V13: PER-BRANCH SETTINGS (additive, safe)
-- Every branch previously shared one global "pos-settings" entry stored
-- only in the browser's localStorage, so receipt/logo/printer changes on
-- one branch could bleed into another (or vanish) instead of belonging to
-- that branch. This migration moves those settings onto the branches
-- table itself, alongside the name/address/phone the branch already has,
-- so every setting is scoped to a single branch_id like the rest of the
-- app's data.
-- =====================================================================

alter table public.branches add column if not exists logo text;
alter table public.branches add column if not exists tax_rate numeric(5,2) not null default 0;
alter table public.branches add column if not exists printer_name text;
