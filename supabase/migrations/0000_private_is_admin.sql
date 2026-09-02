-- 0000 — private schema + is_admin(), applied before 0001_core.sql.
-- Single admin project: any authenticated user is the admin for now.
-- TODO tighten to a profiles/allowlist check when auth ships with the frontend.
create schema if not exists private;
create or replace function private.is_admin() returns boolean
language sql stable as $$ select auth.role() = 'authenticated' $$;
