-- =============================================================================
-- PagePilot Ads Manager - core schema
-- Daily ad performance across Meta, TikTok, Google, plus sync observability.
--
-- GRAIN DECISIONS (do not change without re-reading the sync scripts):
--
--   meta    -> AD level. The Insights API reports reliably at ad level when
--              queried per-campaign (account-level paginated pulls on our
--              development_access token hit the rate limit and then silently
--              return $0 for everything - never query account-wide).
--
--   tiktok  -> MIXED. Manual campaigns: AD level (AUCTION_AD reporting is
--              reliable there). Smart+ campaigns: CAMPAIGN level, because
--              Smart+ reports oddly at ad level (auto-generated ad shells,
--              unstable ids). For Smart+ rows adset_id/ad_id are NULL and the
--              row IS the campaign total for that day.
--
--   google  -> CAMPAIGN level only (GAQL campaign + metrics via
--              googleAds:search). Ad-level stats exist but campaign_stats is
--              what we trust and all budget decisions are campaign level.
--              NOTE: metrics.conversions POOLS signups and purchases - it is
--              NOT purchases. We store it in `purchases` for uniformity but
--              any cross-platform CPA comparison must exclude google or use a
--              purchase-only conversion action once one exists (none does as
--              of 2026-09-02).
--
-- A row's entity is identified by (campaign_id, adset_id, ad_id) where the
-- trailing ids are NULL above the stored grain. Uniqueness is enforced by an
-- expression index (COALESCE to '') because PRIMARY KEY cannot contain NULLs
-- or expressions. The loader must UPSERT via
--   ON CONFLICT (platform, date, campaign_id, COALESCE(adset_id,''), COALESCE(ad_id,''))
-- =============================================================================

create table if not exists public.ad_daily (
  platform        text        not null check (platform in ('meta','tiktok','google')),
  date            date        not null,
  campaign_id     text        not null,
  campaign_name   text,
  adset_id        text,               -- NULL when row grain is campaign
  adset_name      text,
  ad_id           text,               -- NULL when row grain is campaign or adset
  ad_name         text,
  spend           numeric     not null default 0,
  impressions     bigint      not null default 0,
  clicks          bigint      not null default 0,
  video_views     bigint,             -- meta: 3s video_view action; tiktok: video_watched_2s
  video_plays     bigint,             -- meta: video_play_actions; tiktok: video_play_actions
                                      -- (NOT the 3s play - hook rate = video_views/video_plays)
  purchases       numeric     not null default 0,
                                      -- meta: actions[purchase]; tiktok: complete_payment
                                      -- (NEVER `conversion` - dead ON_WEB_ORDER event, zero
                                      -- May-Jul 2026); google: metrics.conversions = signups
                                      -- POOLED with purchases, see grain notes above
  purchase_value  numeric,            -- meta: action_values[purchase]; google: conversions_value;
                                      -- tiktok: NULL (no trustworthy value metric on this account)
  raw             jsonb,              -- the platform row as returned, for re-derivation
  synced_at       timestamptz not null default now()
);

-- Uniqueness at the mixed grain (see header). Expression index, not a PK.
create unique index if not exists ad_daily_grain_uq
  on public.ad_daily (platform, date, campaign_id, coalesce(adset_id, ''), coalesce(ad_id, ''));

create index if not exists ad_daily_date_idx     on public.ad_daily (date desc);
create index if not exists ad_daily_platform_idx on public.ad_daily (platform, date desc);

-- =============================================================================
-- sync_runs: one row per sync attempt, success OR failure.
-- HARD LESSON (morning report, 2026-08-14): a failed pull that prints $0 is
-- worse than no pull. Every sync writes a row here; status='error' rows carry
-- the error text; a sync that returns all-zero spend on a day with active
-- campaigns must be recorded as 'error', never as 0 rows of truth.
-- The dashboard must surface the latest run per platform and scream if it is
-- missing, stale (>26h), or errored - never render a silent zero.
-- =============================================================================

create table if not exists public.sync_runs (
  id            bigint generated always as identity primary key,
  platform      text        not null check (platform in ('meta','tiktok','google')),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  status        text        not null default 'running'
                            check (status in ('running','success','error')),
  rows_written  integer,
  error         text
);

create index if not exists sync_runs_platform_idx on public.sync_runs (platform, started_at desc);

-- =============================================================================
-- RLS: admin-only, matching the Creators Hub pattern.
-- DEPENDENCY: private.is_admin() does NOT exist yet in this (future) Supabase
-- project - it is created by the auth/admin migration when the project is set
-- up (copy from Creators Hub). Until then this migration will fail at the
-- policy statements below; apply 0000_private_is_admin.sql first when the
-- project exists. Service-role key (used by the sync loader) bypasses RLS.
-- =============================================================================

alter table public.ad_daily  enable row level security;
alter table public.sync_runs enable row level security;

create policy ad_daily_admin_all on public.ad_daily
  for all using (private.is_admin()) with check (private.is_admin());

create policy sync_runs_admin_all on public.sync_runs
  for all using (private.is_admin()) with check (private.is_admin());
