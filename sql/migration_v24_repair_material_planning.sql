-- v24: Repair materials/quotation planning.
-- Additive only. Lets a technician attach maintenance-inventory materials to
-- a repair's quotation while it is still in "Awaiting Inspection" /
-- "Awaiting Customer Approval" WITHOUT touching stock yet. Stock is only
-- deducted once the repair is confirmed into 'in_repair' (see
-- electron/businessOperations.js: submitRepairDiagnosis / recordRepairApproval).
begin;

alter table public.repair_parts_used
  add column if not exists stock_deducted boolean not null default false;

commit;
