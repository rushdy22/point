-- POS v18: permanent application access.
-- This migration removes the server-side time gate while preserving existing
-- profile rows and legacy columns so old customer databases remain readable.

do $$
declare tbl text;
begin
  foreach tbl in array array['profiles','branches','categories','products','customers','sales','sale_items',
    'invoices','inventory_movements','transactions','employees','employee_branch_rates',
    'employee_transactions','stock_transfers','suppliers','purchases','purchase_items',
    'supplier_payments','cash_shifts','cash_movements','customer_payments',
    'customer_payment_allocations'] loop
    if to_regclass('public.' || tbl) is not null then
      execute format('drop policy if exists trial_access_gate on public.%I', tbl);
    end if;
  end loop;
end $$;

alter table if exists public.profiles drop constraint if exists profiles_trial_expiry_check;
drop trigger if exists trg_protect_trial_fields on public.profiles;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='is_client_trial')
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='expires_at') then
    update public.profiles set is_client_trial = false, expires_at = null;
  end if;
end $$;

drop function if exists public.manage_client_trial(uuid, text);
drop function if exists public.get_my_access_status();
drop function if exists public.protect_trial_fields();
drop function if exists public.has_application_access();

create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active = true
  );
$$;

create or replace function public.is_owner_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_owner_admin = true and is_active = true
  );
$$;

-- Keep the existing owner-protection policy name, but remove its dependency
-- on the retired access gate.
drop policy if exists "profiles_update_own_or_non_owner_admin" on public.profiles;
drop policy if exists "profiles_update_own_or_admin" on public.profiles;
drop policy if exists "profiles_update_admin_or_own" on public.profiles;
create policy "profiles_update_own_or_non_owner_admin" on public.profiles for update
  to authenticated
  using (auth.uid() = id or (public.is_admin() and is_owner_admin = false))
  with check (auth.uid() = id or public.is_owner_admin() or is_owner_admin = false);

-- RLS cannot compare OLD and NEW values. This trigger closes the self-update
-- escalation path that would otherwise let a normal user promote themselves,
-- move branches, disable/enable accounts, or resurrect a tombstone.
create or replace function public.prevent_profile_privilege_escalation()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
  if auth.uid() = old.id and not public.is_owner_admin() then
    if new.role is distinct from old.role
       or new.branch_id is distinct from old.branch_id
       or new.is_owner_admin is distinct from old.is_owner_admin
       or new.is_active is distinct from old.is_active
       or new.deleted_at is distinct from old.deleted_at
       or new.auth_email is distinct from old.auth_email then
      raise exception 'permission denied: administrative profile fields are protected';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile_privileges on public.profiles;
create trigger trg_protect_profile_privileges
before update on public.profiles
for each row execute function public.prevent_profile_privilege_escalation();

-- Replace the old provisioning overload so the client can only provision a
-- normal permanent profile. The owner-admin flag is retained for permissions.
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
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      confirmation_token, recovery_token, email_change_token_new, email_change_token_current, email_change,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000'::uuid, p_user_id, 'authenticated', 'authenticated',
      coalesce(nullif(trim(p_email), ''), p_user_id::text || '@internal.pos'), crypt(p_password, gen_salt('bf', 10)), now(),
      '', '', '', '', '', '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', p_full_name, 'username', lower(trim(p_username)), 'role', p_role), now(), now());
  end if;

  insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
  values (p_user_id::text, p_user_id,
    jsonb_build_object('sub', p_user_id::text,
      'email', coalesce(nullif(trim(p_email), ''), p_user_id::text || '@internal.pos'),
      'email_verified', false, 'phone_verified', false),
    'email', now(), now())
  on conflict (provider_id, provider) do update set
    user_id = excluded.user_id, identity_data = excluded.identity_data, updated_at = now();

  insert into public.profiles (id, full_name, username, auth_email, role, branch_id, is_active, is_owner_admin, deleted_at, updated_at)
  values (p_user_id, p_full_name, lower(trim(p_username)),
    coalesce(nullif(trim(p_email), ''), p_user_id::text || '@internal.pos'), p_role,
    case when p_role = 'admin' then null else p_branch_id end, p_is_active, p_is_owner_admin, null, now())
  on conflict (id) do update set
    full_name=excluded.full_name, username=excluded.username, auth_email=excluded.auth_email,
    role=excluded.role, branch_id=excluded.branch_id, is_active=excluded.is_active,
    is_owner_admin=excluded.is_owner_admin, deleted_at=null, updated_at=now()
  returning * into result;
  return result;
end;
$$;

revoke all on function public.provision_pos_user(uuid,text,text,text,text,text,uuid,boolean,boolean) from public;
grant execute on function public.provision_pos_user(uuid,text,text,text,text,text,uuid,boolean,boolean) to authenticated;
