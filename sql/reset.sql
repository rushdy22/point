-- شغّل هذا أولاً لحذف أي جداول قديمة/ناقصة، ثم أعد تشغيل sql/schema.sql كاملاً
drop table if exists public.invoices cascade;
drop table if exists public.inventory_movements cascade;
drop table if exists public.sale_items cascade;
drop table if exists public.sales cascade;
drop table if exists public.products cascade;
drop table if exists public.categories cascade;
drop table if exists public.profiles cascade;
drop sequence if exists public.invoice_seq cascade;
drop function if exists public.handle_new_user() cascade;
drop function if exists public.set_updated_at() cascade;
drop function if exists public.handle_sale_item_insert() cascade;
drop trigger if exists on_auth_user_created on auth.users;
