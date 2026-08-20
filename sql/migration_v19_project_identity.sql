-- v19: bind this Supabase project to the Rashed Systems application.
-- The sync engine must stop before any push/pull when this identity is absent
-- or does not match its local identity.

create table if not exists public.system_identity (
  singleton_id integer primary key check (singleton_id = 1),
  system_id text not null unique,
  project_ref text not null unique,
  display_name text not null,
  updated_at timestamptz not null default now()
);

do $$
begin
  if exists (select 1 from public.system_identity where singleton_id = 1
             and (system_id <> 'pes' or project_ref <> 'eaxdtyoozszfshnjmwdj')) then
    raise exception 'SYSTEM_IDENTITY_MISMATCH_EXISTING_CLOUD_ROW';
  end if;
  insert into public.system_identity (singleton_id, system_id, project_ref, display_name)
  values (1, 'pes', 'eaxdtyoozszfshnjmwdj', 'الراشد للأنظمة')
  on conflict (singleton_id) do update set updated_at = now();
end $$;

alter table public.system_identity enable row level security;
revoke all on public.system_identity from public, anon, authenticated;
grant select on public.system_identity to authenticated;
drop policy if exists system_identity_select_authenticated on public.system_identity;
create policy system_identity_select_authenticated on public.system_identity
  for select to authenticated using (true);
