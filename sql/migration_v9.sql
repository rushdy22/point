-- =====================================================================
-- POS SYSTEM - MIGRATION V9: FINANCE DASHBOARD SUPPORT (additive, safe)
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Adds: a simple "raw material" flag on products so the Finance
--       dashboard can split stock value into "Inventory Value"
--       (finished/sellable goods) and "Raw Materials Value" (inputs).
-- No other schema changes are needed: the Finance dashboard and the
-- Suppliers summary are calculated on the fly from existing tables
-- (sales, sale_items, transactions, products, suppliers, purchases,
-- supplier_payments) — see src/lib/db/finance.js.
-- =====================================================================

alter table public.products
  add column if not exists is_raw_material boolean not null default false;

comment on column public.products.is_raw_material is
  'When true, this product''s stock is counted under "Raw Materials Value" '
  'on the Finance dashboard instead of "Inventory Value".';
