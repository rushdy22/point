-- v20: repair existing Auth linkage without changing user UUIDs or passwords.
-- This only creates the single missing email identity for an auth.users row
-- that already has a matching public.profiles row.

update public.profiles p
set auth_email = u.email,
    updated_at = now()
from auth.users u
where u.id = p.id
  and p.auth_email is distinct from u.email
  and p.deleted_at is null;

insert into auth.identities (
  provider_id, user_id, identity_data, provider, created_at, updated_at
)
select
  u.id::text,
  u.id,
  jsonb_build_object(
    'sub', u.id::text,
    'email', u.email,
    'email_verified', (u.email_confirmed_at is not null),
    'phone_verified', false
  ),
  'email',
  coalesce(u.created_at, now()),
  now()
from auth.users u
join public.profiles p on p.id = u.id
where u.email is not null
  and u.deleted_at is null
  and p.deleted_at is null
  and not exists (
    select 1 from auth.identities i
    where i.user_id = u.id and i.provider = 'email'
  )
on conflict (provider_id, provider) do update set
  user_id = excluded.user_id,
  identity_data = excluded.identity_data,
  updated_at = now();

-- Keep the username-only resolver callable for a first-device login, but do
-- not expose profile rows or credentials through it.
revoke all on function public.resolve_pos_login_email(text) from public;
grant execute on function public.resolve_pos_login_email(text) to anon, authenticated;
