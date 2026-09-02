-- 0005 - thruplays, for the Hold rate column (requested by Alex, 2026-09-02).
-- Additive and nullable. NOT applied live by this repo; the main session
-- applies it (and only then deploys a frontend that selects the column -
-- PostgREST rejects a select of a column that does not exist).
--
--   meta   -> video_thruplay_watched_actions (ThruPlay: watched to 15s or to
--             completion). Hold rate = thruplays / video_views (3s plays).
--   tiktok -> video_watched_6s, the closest analog of ThruPlay this API has
--             (hold rate there = 6s watched / 2s watched = video_views).
--   google -> never written, stays NULL (no video metrics synced).
--
-- History: NDJSON files written before 2026-09-02 do NOT contain these
-- fields even in `raw` (the sync never requested them), so a re-load of old
-- NDJSON cannot backfill this column - only a fresh API re-pull can.

alter table public.ad_daily add column if not exists thruplays bigint;

comment on column public.ad_daily.thruplays is
  'meta: video_thruplay_watched_actions; tiktok: video_watched_6s; google: NULL. Hold rate = thruplays / video_views.';
