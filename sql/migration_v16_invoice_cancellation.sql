-- =====================================================================
-- POS SYSTEM - MIGRATION V16: PURCHASE INVOICE CANCELLATION (additive, safe)
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Sales invoices already support a 'cancelled'/'refunded' status
-- (see sql/schema.sql). Purchases had no equivalent, so a purchase could
-- never be voided. This adds the same status column to purchases so
-- cancelling a purchase invoice can be recorded the same way, without
-- deleting the invoice or its line items (kept for the audit trail).
-- =====================================================================

alter table public.purchases add column if not exists status text not null default 'completed'
  check (status in ('completed', 'cancelled'));

create index if not exists idx_purchases_status on public.purchases(status);
