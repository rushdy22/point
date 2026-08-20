-- =====================================================================
-- POS SYSTEM - MIGRATION V7: LAST LOGIN TRACKING (additive, safe)
-- Run in: Supabase Dashboard -> SQL Editor -> New query
-- Supabase Auth already stamps auth.users.last_sign_in_at on every
-- sign-in — this migration just mirrors it onto public.profiles so it's
-- readable through the normal profiles RLS policy and flows through the
-- existing offline-first SQLite sync engine like every other column.
-- =====================================================================

alter table public.profiles add column if not exists last_login_at timestamptz;

create or replace function public.handle_user_login()
returns trigger as $$
begin
  if new.last_sign_in_at is distinct from old.last_sign_in_at then
    update public.profiles set last_login_at = new.last_sign_in_at where id = new.id;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_login on auth.users;
create trigger on_auth_user_login
  after update on auth.users
  for each row execute procedure public.handle_user_login();
