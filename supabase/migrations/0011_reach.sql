-- 0011 - reach: the denominator of Frequency. NOT applied by this repo; the
-- main session applies it.
--
-- WHY (Alex, 2026-09-03): Frequency is impressions divided by reach. It is a
-- RATIO, so it can never be summed. At every aggregated row it has to be
-- recomputed as sum(impressions) / sum(reach), exactly like hook rate and
-- hold rate already are, and that is only possible if reach itself is stored.
-- Storing a per day `frequency` column instead would be the trap: the first
-- caller to SUM it or average it would get a number that means nothing.
-- Hence ONE column here, not two.
--
-- WHAT REACH IS, AND WHAT OUR MULTI DAY FREQUENCY THEREFORE IS NOT.
-- Reach is unique people, and unique people do NOT add up across days: a
-- person who saw the ad on Monday and Tuesday counts twice in
-- sum(daily reach) but once in Meta's own reach for the Monday to Tuesday
-- window. So sum(impressions) / sum(daily reach) is the average impressions
-- per person per DAY, and it sits BELOW the deduplicated window frequency
-- Ads Manager shows for the same range.
--
-- MEASURED on campaign 120235045548680189 (Main Scaling CBO), 27 Aug to
-- 2 Sep 2026, live Meta API, 2026-09-03:
--     sum of 7 daily reaches   153,366
--     Meta deduplicated 7d     109,432   (1.40x smaller)
--     ratio of sums            1.88
--     Meta 7d frequency        2.64      (our figure is 28.6% lower)
-- A ONE DAY range is exact; every longer range understates. The column
-- tooltip in src/lib/types.ts says this in the UI, in those words. Fixing it
-- properly would need a window level reach pull per range, which the daily
-- grain of ad_daily cannot express - do not "fix" it by summing frequency.
--
-- COVERAGE (probed live 2026-09-03):
--   meta   - insights `reach` at AD level. frequency returned alongside it
--            equals impressions/reach to 6 decimals, so the ratio is right.
--   tiktok - `reach` is a valid BASIC metric at AUCTION_AD, AUCTION_ADGROUP,
--            AUCTION_CAMPAIGN and AUCTION_ADVERTISER. Both grains we sync
--            (manual ads, Smart+ campaigns) return it.
--   google - metrics.unique_users exists ONLY on FROM campaign (v24 rejects
--            it on ad_group_ad with INVALID_ARGUMENT), and our google grain
--            has been ad level since 2026-09-02. Campaign level unique users
--            cannot be split across ads, so google reach stays NULL and the
--            Frequency cell renders its placeholder there. Verified the
--            metric does work at campaign grain: the Branded Search campaign
--            on 2026-09-02 returned impressions 545, uniqueUsers 482,
--            averageImpressionFrequencyPerUser 1.1307 (= 545/482).
--
-- Nullable with no default: every row synced before this migration has an
-- UNKNOWN reach, not a zero. A zero would divide into infinity; NULL makes
-- the UI show its placeholder, which is the truth.
--
-- Run as postgres:
--   PGPASSWORD="$(grep '^ADSMGR_DB_PASS=' /home/ubuntu/pagepilot-workspace/.env | cut -d= -f2-)" \
--   psql -h db.xtrapxzbfuovnutldete.supabase.co -p 5432 -U postgres -d postgres \
--        -v ON_ERROR_STOP=1 -1 -f /home/ubuntu/projects/pagepilot-ads-manager/supabase/migrations/0011_reach.sql

alter table public.ad_daily add column if not exists reach bigint;

comment on column public.ad_daily.reach is
  'Unique people reached on this day (meta: insights reach; tiktok: BASIC '
  'metric reach; google: NULL, unique_users is campaign grain only). NOT '
  'additive across days: summing it over a range counts a person once per '
  'day they saw the ad, so sum(impressions)/sum(reach) is the average daily '
  'frequency and is LOWER than the platform deduplicated window frequency.';

grant select, insert, update, delete on public.ad_daily to ads_sync;
