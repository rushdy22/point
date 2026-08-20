-- =====================================================================
-- POS SYSTEM - MIGRATION V3 (additive, safe to run on existing DB)
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Fixes: inventory movements created automatically by a sale now record
--        which logged-in user (cashier) made the sale, so "سجل الحركات"
--        can show who performed each stock withdrawal.
-- =====================================================================

create or replace function public.handle_sale_item_insert()
returns trigger as $$
begin
  if new.product_id is not null then
    update public.products
      set stock_quantity = stock_quantity - new.quantity
      where id = new.product_id;

    insert into public.inventory_movements (product_id, type, quantity, reason, created_by)
    values (new.product_id, 'sale', -new.quantity, 'بيع - فاتورة', auth.uid());
  end if;
  return new;
end;
$$ language plpgsql security definer;

-- trigger already exists and points at this function, no need to recreate it
