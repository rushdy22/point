-- PES identity unification migration
-- Canonical identity:
--   system_id   = pes
--   project_ref = eaxdtyoozszfshnjmwdj
--
-- Safe behavior:
-- * creates the singleton table only if it does not exist
-- * refuses to overwrite a conflicting existing identity
-- * never deletes business data
-- * never resets the database

begin;

create table if not exists public.system_identity (
  singleton_id integer primary key default 1,
  system_id text not null,
  project_ref text not null,
  display_name text,
  updated_at timestamptz not null default now()
);

do $$
declare
  existing_system_id text;
  existing_project_ref text;
begin
  select system_id, project_ref
    into existing_system_id, existing_project_ref
    from public.system_identity
   where singleton_id = 1
   limit 1;

  if existing_system_id is not null
     and (existing_system_id <> 'pes'
          or existing_project_ref <> 'eaxdtyoozszfshnjmwdj') then
    raise exception
      'CRITICAL_SYNC_STOP:PROJECT_IDENTITY_MISMATCH_CLOUD: existing system_id=% project_ref=% expected system_id=pes project_ref=eaxdtyoozszfshnjmwdj',
      existing_system_id, existing_project_ref;
  end if;

  insert into public.system_identity
      (singleton_id, system_id, project_ref, display_name, updated_at)
  values
      (1, 'pes', 'eaxdtyoozszfshnjmwdj', 'PES', now())
  on conflict (singleton_id) do update
      set system_id = excluded.system_id,
          project_ref = excluded.project_ref,
          display_name = coalesce(public.system_identity.display_name, excluded.display_name),
          updated_at = now();
end $$;

commit;
