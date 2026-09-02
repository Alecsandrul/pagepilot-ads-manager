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
  until a purchase-only conversion action exists.
- `video_plays` is `video_play_actions`, NOT the 3 second view; hook rate =
  `video_views / video_plays`.
- Google REST v16 to v21 return a bare HTML 404 (retired, not blocked);
  currently pinned to v24, valid set v22 to v25 as of 2026-09-02.

## What exists

- `supabase/migrations/0001_core.sql` - `ad_daily` (mixed grain, expression
  unique index), `sync_runs` (observability, every run recorded), RLS
  policies gated on `private.is_admin()`.
- `scripts/sync_{meta,tiktok,google}.py` - tested against the live APIs
  (read-only) for 2026-09-01.
- `data/` - NDJSON output, gitignored.

## What waits on infrastructure

- GitHub repo, Vercel project, Supabase project: none exist yet.
- `private.is_admin()` must be created (copy the Creators Hub auth
  migration) BEFORE `0001_core.sql` will apply.
- Loader script (NDJSON -> upsert into `ad_daily`, one `sync_runs` row per
  run) once the Supabase project exists. Upsert conflict target:
  `(platform, date, campaign_id, COALESCE(adset_id,''), COALESCE(ad_id,''))`.
- Scheduling (cron on the VPS, same pattern as the Creators Hub worker).
- Frontend, pending Alex's design.
