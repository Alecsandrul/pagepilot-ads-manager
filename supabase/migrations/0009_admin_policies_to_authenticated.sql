-- 0009 - scope the admin RLS policies to `authenticated`.
--
-- WHY: the three *_admin_all policies were created TO public, so they also
-- apply to ads_sync. Their qual calls private.is_admin() -> auth.role(), and
-- ads_sync has no USAGE on schema auth. Constant-true ads_sync quals
-- short-circuit the OR, which is why select/insert/update worked - but the
-- google DELETE policy is qualified (platform='google'), so Postgres
-- evaluates the admin qual too and every google re-load dies with
-- "permission denied for schema auth" (32 LOAD FAILED on 2026-09-03).
-- The admin dashboard reads as `authenticated`; postgres bypasses RLS as
-- superuser - scoping these policies to authenticated loses nothing.
--
-- Run as postgres:
--   PGPASSWORD="$(grep '^ADSMGR_DB_PASS=' /home/ubuntu/pagepilot-workspace/.env | cut -d= -f2-)" \
--   psql -h db.xtrapxzbfuovnutldete.supabase.co -p 5432 -U postgres -d postgres \
--        -v ON_ERROR_STOP=1 -1 -f /home/ubuntu/projects/pagepilot-ads-manager/supabase/migrations/0009_admin_policies_to_authenticated.sql

ALTER POLICY ad_daily_admin_all        ON public.ad_daily       TO authenticated;
ALTER POLICY sync_runs_admin_all       ON public.sync_runs      TO authenticated;
ALTER POLICY entity_budgets_admin_all  ON public.entity_budgets TO authenticated;
