-- 0010 - ad_entities: the things that EXIST in the ad accounts, independent
-- of whether they ever delivered. NOT applied live by this repo; the main
-- session applies it.
--
-- WHY (root cause, 2026-09-03): the whole dashboard is built from ad_daily,
-- and ad_daily is built from the INSIGHTS APIs. An ad with no delivery
-- returns no insights row at all, and sync_meta.py additionally drops any
-- row with spend = 0 and impressions = 0. So an ad that has been built but
-- has never spent CANNOT appear in the dashboard, by construction.
--
-- Evidence: on 2026-09-03, 98 of the 182 non-archived ads in the Creative
-- Testing campaign (120243779623220189) had never appeared in ad_daily.
-- Among them all 24 ads of batches 99 to 106, created 2026-09-02 and built
-- PAUSED - exactly the "new creatives" that were reported missing.
--
-- DESIGN: entities are CURRENT attributes, not daily history - same shape as
-- entity_budgets (migration 0006): every sync captures the full picture and
-- the loader REPLACES the table wholesale. Nothing here is a metric; joining
-- ad_daily to this table is what lets the UI say "this ad exists and has not
-- delivered" instead of silently omitting it.
--
-- Grain: one row per entity, keyed (platform, level, entity_id). level is
-- campaign / adset / ad, matching entity_budgets' vocabulary (adset covers
-- Meta ad sets, TikTok ad groups and Google ad groups).
--
-- Run as postgres:
--   PGPASSWORD="$(grep '^ADSMGR_DB_PASS=' /home/ubuntu/pagepilot-workspace/.env | cut -d= -f2-)" \
--   psql -h db.xtrapxzbfuovnutldete.supabase.co -p 5432 -U postgres -d postgres \
--        -v ON_ERROR_STOP=1 -1 -f /home/ubuntu/projects/pagepilot-ads-manager/supabase/migrations/0010_ad_entities.sql

create table if not exists public.ad_entities (
  platform    text        not null check (platform in ('meta','tiktok','google')),
  level       text        not null check (level in ('campaign','adset','ad')),
  entity_id   text        not null,
  entity_name text,
  -- Parents. A campaign row has neither; an adset row has campaign_id; an
  -- ad row has both. Kept as plain text ids to match ad_daily.
  campaign_id text,
  adset_id    text,
  -- The platform's own words, verbatim, never normalised: ACTIVE, PAUSED,
  -- ADSET_PAUSED, CAMPAIGN_PAUSED (meta) / ENABLE, DISABLE (tiktok) /
  -- ENABLED, PAUSED (google). The UI maps these for display; storing a
  -- normalised guess would lose the "paused by its parent" distinction that
  -- explains why an ACTIVE ad is not spending.
  status      text,
  -- True when the platform considers the entity live RIGHT NOW. Derived at
  -- sync time so the UI does not have to know three status vocabularies.
  is_active   boolean     not null default false,
  -- When the entity was created on the platform. This is what makes "built
  -- yesterday, no delivery yet" distinguishable from "dead since May".
  created_at  timestamptz,
  fetched_at  timestamptz not null default now()
);

-- IDENTITY: (platform, level, entity_id, parent) - NOT entity_id alone.
--
-- Google's ad_group_ad is keyed by (ad_group, ad): one ad RESOURCE is linked
-- into many ad groups, and each link is a real, separately reported row. In
-- this account 19 google ad ids appear 2 to 8 times, 75 rows collapsing to
-- 19 keys, so an entity_id-only key rejected 56 genuine rows with
-- "duplicate key value violates unique constraint" on the first load
-- (2026-09-03). Deduping the snapshot instead would have DELETED real ads.
-- Meta and TikTok ad ids happen to be globally unique; Google's are not, and
-- the key has to describe the weakest guarantee, not the strongest.
--
-- This is a unique INDEX, not a primary key, because a PRIMARY KEY cannot
-- contain an expression and adset_id is nullable (campaign and adset rows
-- have none). Same pattern ad_daily already uses for its mixed grain. The
-- loader replaces the table wholesale and never upserts, so uniqueness is
-- all that is required here.
--
-- Re-runnable: drops the entity_id-only primary key if an earlier apply of
-- this file created it.
alter table public.ad_entities drop constraint if exists ad_entities_pkey;
create unique index if not exists ad_entities_key
  on public.ad_entities (platform, level, entity_id, coalesce(adset_id, ''));

-- The UI asks "which entities exist under this campaign / ad set".
create index if not exists ad_entities_campaign_idx
  on public.ad_entities (platform, campaign_id);
create index if not exists ad_entities_adset_idx
  on public.ad_entities (platform, adset_id);

alter table public.ad_entities enable row level security;

-- CREATE POLICY has no IF NOT EXISTS, so each is dropped first: this file
-- must survive a re-apply on a database where an earlier version of it
-- already ran.
--
-- Scoped to authenticated from the start: see migration 0009. A policy
-- created TO public also applies to ads_sync, whose qual then calls
-- private.is_admin() -> auth.role(), and ads_sync has no USAGE on schema
-- auth. That is what killed 32 google loads on 2026-09-03.
drop policy if exists ad_entities_admin_all on public.ad_entities;
create policy ad_entities_admin_all on public.ad_entities
  for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- The sync loader connects as ads_sync (least privilege, see load.py) and
-- REPLACES the table wholesale, so it needs delete as well.
drop policy if exists ad_entities_ads_sync_select on public.ad_entities;
create policy ad_entities_ads_sync_select on public.ad_entities
  for select to ads_sync using (true);
drop policy if exists ad_entities_ads_sync_insert on public.ad_entities;
create policy ad_entities_ads_sync_insert on public.ad_entities
  for insert to ads_sync with check (true);
drop policy if exists ad_entities_ads_sync_delete on public.ad_entities;
create policy ad_entities_ads_sync_delete on public.ad_entities
  for delete to ads_sync using (true);

grant select, insert, update, delete on public.ad_entities to ads_sync;

-- Let sync_runs record the entities refresh like any platform sync.
alter table public.sync_runs drop constraint if exists sync_runs_platform_check;
alter table public.sync_runs
  add constraint sync_runs_platform_check
  check (platform in ('meta','tiktok','google','budgets','entities'));

-- Same latent bug as 0009, missed there: app_settings_admin_all is still
-- TO public, so any ads_sync statement against app_settings would evaluate
-- private.is_admin() and die with "permission denied for schema auth". The
-- loader does not touch app_settings today, which is the only reason this
-- has not fired yet. Scope it now.
alter policy app_settings_admin_all on public.app_settings to authenticated;
