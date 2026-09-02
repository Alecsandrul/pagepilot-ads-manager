-- 0008 - scoped DELETE for the loader role + entity_budgets policies.
--
-- WHY: 0007 gave google replace-day semantics (delete the day, insert the
-- day, one transaction) because old campaign-grain and new ad-grain rows
-- share no conflict key. The least-privilege loader role ads_sync was
-- deliberately created WITHOUT delete; every google re-load therefore fails
-- inside the RLS admin-policy check (31 LOAD-FAILs on 2026-09-02). The
-- delete stays as narrow as the semantics need: google rows only.
-- entity_budgets (0006) additionally needs ads_sync row policies - the grant
-- existed but RLS only had the admin policy, so the loader's full-replace
-- write was rejected.
--
-- Run as postgres:
--   PGPASSWORD="$(grep '^ADSMGR_DB_PASS=' /home/ubuntu/pagepilot-workspace/.env | cut -d= -f2-)" \
--   psql -h db.xtrapxzbfuovnutldete.supabase.co -p 5432 -U postgres -d postgres \
--        -v ON_ERROR_STOP=1 -1 -f /home/ubuntu/projects/pagepilot-ads-manager/supabase/migrations/0008_ads_sync_delete_scope.sql

GRANT DELETE ON public.ad_daily TO ads_sync;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ad_daily' AND policyname='ad_daily_ads_sync_delete') THEN
    CREATE POLICY ad_daily_ads_sync_delete ON public.ad_daily
      FOR DELETE TO ads_sync USING (platform = 'google');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='entity_budgets' AND policyname='entity_budgets_ads_sync_select') THEN
    CREATE POLICY entity_budgets_ads_sync_select ON public.entity_budgets FOR SELECT TO ads_sync USING (true);
    CREATE POLICY entity_budgets_ads_sync_insert ON public.entity_budgets FOR INSERT TO ads_sync WITH CHECK (true);
    CREATE POLICY entity_budgets_ads_sync_delete ON public.entity_budgets FOR DELETE TO ads_sync USING (true);
  END IF;
END $$;
