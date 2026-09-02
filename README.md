# PagePilot Ads Manager

One internal dashboard for daily Meta, TikTok and Google ad performance.
Stack mirrors the Creators Hub: Supabase (Postgres + RLS) + Vercel frontend.

## Architecture

```
scripts/sync_meta.py    \
scripts/sync_tiktok.py   >--> NDJSON in data/ --> loader (TODO) --> Supabase
scripts/sync_google.py  /                                             |
                                                                      v
                                              Next/Vite frontend (from Alex's design)
```

Each sync script is standalone Python (stdlib only), reads credentials from
`/home/ubuntu/pagepilot-workspace/.env`, pulls one day (default yesterday,
`--date YYYY-MM-DD`, `--days N` for backfill) and writes
`data/<platform>_<date>.ndjson` with rows matching `public.ad_daily`.
A failed or suspicious pull exits nonzero and writes nothing; there is no
such thing as a silent zero here (see `sync_runs` in the schema).

## Grain

| platform | grain | why |
|---|---|---|
| meta | ad | Insights reliable at ad level when queried per campaign; account-level paginated pulls on the development_access token silently return $0 after a rate limit |
| tiktok manual | ad | AUCTION_AD reporting is reliable for manual campaigns |
| tiktok Smart+ | campaign | Smart+ reports oddly at ad level (auto ad shells); flag is `campaign_automation_type` containing `SMART` (e.g. `UPGRADED_SMART_PLUS`) while `is_smart_performance_campaign` stays false |
| google | campaign | campaign stats are what we trust; all budget decisions are campaign level |

Metric traps baked into the scripts (do not "fix" them away):

- Meta purchases = `purchase` action type; pixel CPA is ~6x inflated vs
  Stripe, use as a relative ranking only.
- TikTok purchases = `complete_payment`, never `conversion` (dead
  ON_WEB_ORDER event, zero for May to Jul 2026 over $52k of spend).
- Google `metrics.conversions` POOLS signups with purchases; it lands in the
  `purchases` column for uniformity but is not comparable to Meta/TikTok
  until a purchase-only conversion action exists. This is STRUCTURAL:
  `ad_daily.purchases_are_pooled` is a generated column (true where
  `platform = 'google'`, migration 0002) and the frontend must exclude
  `purchases_are_pooled` rows from every cross-platform CPA or purchase
  aggregate. Generated, not synced, so it can never drift.
- `video_plays` is `video_play_actions`, NOT the 3 second view; hook rate =
  `video_views / video_plays`.
- Google REST v16 to v21 return a bare HTML 404 (retired, not blocked);
  currently pinned to v24, valid set v22 to v25 as of 2026-09-02.

## What exists

- Supabase project `xtrapxzbfuovnutldete` (eu-west-1), migrations 0000-0002
  applied live.
- `supabase/migrations/` - 0000 `private.is_admin` bootstrap, 0001
  `ad_daily` (mixed grain, expression unique index) + `sync_runs`
  (observability, every run recorded) + admin RLS, 0002
  `purchases_are_pooled` generated column.
- `scripts/sync_{meta,tiktok,google}.py` - tested against the live APIs
  (read-only) for 2026-09-01.
- `scripts/load.py` - NDJSON -> `ad_daily` upsert via psql `\copy` staging
  (no Python DB driver on the VPS; PEP 668 blocks pip), one `sync_runs` row
  per platform per run including failures; a missing NDJSON becomes a
  recorded error, never a silent gap. Verified idempotent (double load of
  2026-09-01 left counts unchanged).
- `scripts/daily_sync.sh` - cron entrypoint: three syncs staggered with
  off-minute pauses, stderr captured per platform, then load. Cron NOT
  installed yet (main session schedules it).
- `data/` - NDJSON output, gitignored.

## What waits

- Cron for `daily_sync.sh` (scheduled by the main session, not this repo).
- Vercel project + frontend build from the imported dashboard design.
- Historical backfill beyond 2026-09-01 (`--days N` is ready on all three
  sync scripts).
