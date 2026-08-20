-- =====================================================================
-- MIGRATION V32: BRANCH PASSWORDS
-- Adds a per-branch password hash. New branches created by the app require
-- a password (the UI defaults to karim123++ so it can be changed before save).
-- The password is never stored in plain text.
-- =====================================================================

alter table public.branches
  add column if not exists password_hash text;

-- Existing branches remain unlocked until a password is explicitly set.
-- New branches created from the updated app receive password_hash.
