-- POS v17: local-auth metadata, durable tombstones, version watermarks and
-- server-side user provisioning. This migration is additive and idempotent.

create extension if not exists "pgcrypto";

alter table if exists public.profiles add column if not exists auth_email text;
alter table if exists public.profiles add column if not exists updated_at timestamptz not null default now();
alter table if exists public.profiles add column if not exists deleted_at timestamptz;

update public.profiles p
set auth_email = u.email
from auth.users u
where u.id = p.id and p.auth_email is null;

create or replace function public.touch_pos_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','branches','categories','products','customers','sales','sale_items',
    'invoices','inventory_movements','transactions','employees','employee_branch_rates',
    'employee_transactions','stock_transfers','suppliers','purchases','purchase_items',
    'supplier_payments','cash_shifts','cash_movements','customer_payments',
    'customer_payment_allocations'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I add column if not exists updated_at timestamptz not null default now()', t);
      execute format('alter table public.%I add column if not exists deleted_at timestamptz', t);
      execute format('drop trigger if exists trg_pos_updated_at on public.%I', t);
      execute format('create trigger trg_pos_updated_at before update on public.%I for each row execute procedure public.touch_pos_updated_at()', t);
    end if;
  end loop;
end $$;

drop policy if exists stock_transfers_branch_scoped_v17 on public.stock_transfers;
drop policy if exists stock_transfers_admin_v17 on public.stock_transfers;
create policy stock_transfers_admin_v17 on public.stock_transfers for all to authenticated
using (public.is_admin()) with check (public.is_admin());

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, username, auth_email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'cashier')
  )
  on conflict (id) do update set auth_email = excluded.auth_email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

-- The caller must be an active global admin. The function is the only client
-- surface that can create/update auth.users; service_role never ships to POS.
drop function if exists public.provision_pos_user(uuid,text,text,text,text,text,uuid,boolean,boolean,timestamptz,boolean);
create or replace function public.provision_pos_user(
  p_user_id uuid,
  p_username text,
  p_email text,
  p_password text default null,
  p_full_name text default '',
  p_role text default 'cashier',
  p_branch_id uuid default null,
  p_is_active boolean default true,
  p_is_owner_admin boolean default false
)
returns public.profiles
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare result public.profiles;
begin
  if not public.is_admin() then raise exception 'permission denied'; end if;
  if p_username is null or length(trim(p_username)) < 3 then raise exception 'invalid username'; end if;
  if p_role not in ('admin','manager','cashier') then raise exception 'invalid role'; end if;
  if p_role <> 'admin' and p_branch_id is null then raise exception 'branch required'; end if;

  if exists (select 1 from auth.users where id = p_user_id) then
    update auth.users
      set instance_id = coalesce(instance_id, '00000000-0000-0000-0000-000000000000'::uuid),
          email = coalesce(nullif(trim(p_email), ''), email),
          encrypted_password = case when p_password is null then encrypted_password else crypt(p_password, gen_salt('bf', 10)) end,
          email_confirmed_at = coalesce(email_confirmed_at, now()),
          confirmation_token = coalesce(confirmation_token, ''),
          recovery_token = coalesce(recovery_token, ''),
          email_change_token_new = coalesce(email_change_token_new, ''),
          email_change_token_current = coalesce(email_change_token_current, ''),
          email_change = coalesce(email_change, ''),
          is_sso_user = coalesce(is_sso_user, false),
          is_anonymous = coalesce(is_anonymous, false),
          banned_until = case when p_is_active then null else now() + interval '100 years' end,
          raw_user_meta_data = jsonb_build_object('full_name', p_full_name, 'username', lower(trim(p_username)), 'role', p_role),
          updated_at = now()
    where id = p_user_id;
  else
    if p_password is null then raise exception 'password required for new user'; end if;
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, confirmation_token, recovery_token, email_change_token_new, email_change_token_current, email_change, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000'::uuid, p_user_id, 'authenticated', 'authenticated', coalesce(nullif(trim(p_email), ''), p_user_id::text || '@internal.pos'), crypt(p_password, gen_salt('bf', 10)), now(), '', '', '', '', '', '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', p_full_name, 'username', lower(trim(p_username)), 'role', p_role), now(), now());
  end if;

  -- GoTrue expects a matching email identity for password sign-in. A direct
  -- auth.users insert without this row exists in the database but fails at
  -- runtime with "Database error querying schema" during sign-in.
  insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
  values (
    p_user_id::text,
    p_user_id,
    jsonb_build_object(
      'sub', p_user_id::text,
      'email', coalesce(nullif(trim(p_email), ''), p_user_id::text || '@internal.pos'),
      'email_verified', false,
      'phone_verified', false
    ),
    'email',
    now(), now()
  )
  on conflict (provider_id, provider) do update set
    user_id = excluded.user_id,
    identity_data = excluded.identity_data,
    updated_at = now();

  insert into public.profiles (id, full_name, username, auth_email, role, branch_id, is_active, is_owner_admin, deleted_at, updated_at)
  values (p_user_id, p_full_name, lower(trim(p_username)), coalesce(nullif(trim(p_email), ''), p_user_id::text || '@internal.pos'), p_role, case when p_role = 'admin' then null else p_branch_id end, p_is_active, p_is_owner_admin, null, now())
  on conflict (id) do update set full_name=excluded.full_name, username=excluded.username, auth_email=excluded.auth_email,
    role=excluded.role, branch_id=excluded.branch_id, is_active=excluded.is_active,
    is_owner_admin=excluded.is_owner_admin, deleted_at=null, updated_at=now()
  returning * into result;
  return result;
end;
$$;

create or replace function public.delete_pos_user(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then raise exception 'permission denied'; end if;
  update public.profiles set is_active=false, deleted_at=now(), updated_at=now() where id=p_user_id;
  update auth.users set banned_until=now() + interval '100 years', updated_at=now() where id=p_user_id;
  return true;
end;
$$;

revoke all on function public.provision_pos_user(uuid,text,text,text,text,text,uuid,boolean,boolean) from public;
grant execute on function public.provision_pos_user(uuid,text,text,text,text,text,uuid,boolean,boolean) to authenticated;
revoke all on function public.delete_pos_user(uuid) from public;
grant execute on function public.delete_pos_user(uuid) to authenticated;

-- Username-only login on a brand-new device: return only the technical Auth
-- email, never a password or profile data. The value is not a customer email;
-- it is the internal address used solely by Supabase Auth.
create or replace function public.resolve_pos_login_email(p_username text)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select auth_email from public.profiles
  where lower(username) = lower(trim(p_username)) and deleted_at is null and is_active = true
  limit 1;
$$;
revoke all on function public.resolve_pos_login_email(text) from public;
grant execute on function public.resolve_pos_login_email(text) to anon, authenticated;

-- Branch isolation for every table carrying branch_id. Existing data is kept;
-- rows without a branch remain visible only to global admins.
create or replace function public.has_branch_access(p_branch_id uuid)
returns boolean language sql security definer stable set search_path=public as $$
  select public.is_admin() or (p_branch_id is not null and p_branch_id = public.current_branch_id());
$$;

do $$
declare t text; policy_name text;
begin
  foreach t in array array['categories','products','customers','sales','sale_items','inventory_movements','transactions','employee_transactions','employee_branch_rates','suppliers','purchases','purchase_items','supplier_payments','cash_shifts','cash_movements','customer_payments'] loop
    if to_regclass('public.' || t) is not null
       and exists (select 1 from information_schema.columns where table_schema='public' and table_name=t and column_name='branch_id') then
      policy_name := t || '_branch_scoped_v17';
      execute format('drop policy if exists %I on public.%I', t || '_all', t);
      execute format('drop policy if exists %I on public.%I', t || '_branch_scoped', t);
      execute format('drop policy if exists %I on public.%I', policy_name, t);
      execute format('create policy %I on public.%I for all to authenticated using (public.has_branch_access(branch_id)) with check (public.has_branch_access(branch_id))', policy_name, t);
    end if;
  end loop;
end $$;

drop policy if exists branches_select_all on public.branches;
drop policy if exists branches_select_branch_scoped_v17 on public.branches;
create policy branches_select_branch_scoped_v17 on public.branches for select to authenticated
using (public.is_admin() or id = public.current_branch_id());

drop policy if exists invoices_all on public.invoices;
drop policy if exists invoices_branch_scoped_v17 on public.invoices;
create policy invoices_branch_scoped_v17 on public.invoices for all to authenticated
using (public.is_admin() or exists (select 1 from public.sales s where s.id = sale_id and public.has_branch_access(s.branch_id)))
with check (public.is_admin() or exists (select 1 from public.sales s where s.id = sale_id and public.has_branch_access(s.branch_id)));

drop policy if exists customer_payment_allocations_all on public.customer_payment_allocations;
drop policy if exists customer_payment_allocations_branch_scoped_v17 on public.customer_payment_allocations;
create policy customer_payment_allocations_branch_scoped_v17 on public.customer_payment_allocations for all to authenticated
using (public.is_admin() or exists (select 1 from public.customer_payments p where p.id = payment_id and public.has_branch_access(p.branch_id)))
with check (public.is_admin() or exists (select 1 from public.customer_payments p where p.id = payment_id and public.has_branch_access(p.branch_id)));

drop policy if exists profiles_select_all on public.profiles;
drop policy if exists profiles_select_branch_scoped on public.profiles;
create policy profiles_select_branch_scoped on public.profiles for select to authenticated
using (public.is_admin() or id = auth.uid() or (branch_id is not null and branch_id = public.current_branch_id()));

drop policy if exists profiles_update_own_or_admin on public.profiles;
drop policy if exists profiles_update_admin_or_own on public.profiles;
create policy profiles_update_admin_or_own on public.profiles for update to authenticated
using (auth.uid() = id or public.is_admin()) with check (auth.uid() = id or public.is_admin());

do $$ begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object or undefined_object then null; end $$;
