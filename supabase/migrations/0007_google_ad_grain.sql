-- 0007 - Google ad grain + purchase-only conversions (Alex approved
-- 2026-09-02: "da extinde pe google"). NOT applied live by this repo; the
-- main session applies it, then runs the google re-backfill, then deploys
-- the frontend.
--
-- 1. sync_google.py now reports at AD grain (ad_group_ad), with a
--    campaign-grain fallback per campaign-day when ad rows do not cover the
--    campaign's spend (Performance Max reports on asset groups). VERIFIED
--    2026-09-02: ad rows reconcile exactly with campaign totals for SEARCH
--    and DEMAND_GEN.
-- 2. google `purchases` become the browser_payment conversion action ONLY
--    (segmented), not metrics.conversions. VERIFIED 2026-09-02:
--    metrics.conversions pools 'PagePilot (web) store_creation'
--    (ENGAGEMENT) with browser_payment, so the raw metric stays unusable;
--    the segmented purchase count reconciles across grains.
-- 3. purchases_are_pooled therefore stops being a platform fact and becomes
--    a per-row fact: drop the generated column, recreate as a plain
--    boolean the loader writes. Existing google rows keep TRUE - their
--    `purchases` still hold pooled metrics.conversions - until the
--    re-backfill replaces them (google history starts 2026-08-02, 31 days).
-- 4. Old campaign-grain google rows share no conflict key with new ad-grain
--    rows, so an upsert alone would DOUBLE COUNT a re-loaded day. load.py
--    now DELETEs platform='google' rows for a day before inserting that day
--    (replace-day semantics, google only, same transaction). Recorded here
--    so the behavior is on the record; no SQL needed for it.

alter table public.ad_daily drop column if exists purchases_are_pooled;

alter table public.ad_daily
  add column purchases_are_pooled boolean not null default false;

-- Rows loaded before this migration: google rows carry pooled
-- metrics.conversions until re-synced.
update public.ad_daily set purchases_are_pooled = true where platform = 'google';
