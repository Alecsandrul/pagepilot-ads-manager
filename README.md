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

## Frontend

Vite + React + TypeScript at the repo root (Vercel imports it directly).
No UI framework: the design file `design/Ads Reporting Dashboard.dc.html`
is the spec and the components recreate it with plain React and CSS.

```
src/
  App.tsx                     auth gate (session -> Dashboard, else Login)
  components/
    Dashboard.tsx             all view state, data fetch, KPI + export logic
    AdsTable.tsx              level chips, drill down, sticky table, totals, footer
    DateRangePicker.tsx       presets (7/14/30 days ending yesterday) + custom
    PlatformTabs.tsx          Meta / TikTok / Google with per platform spend
    KpiCards.tsx              6 cards with delta vs previous equal length period
    Login.tsx                 email + password (accounts created by an admin)
    Dropdown.tsx              shared menu shell
  lib/
    supabase.ts               client from VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
    data.ts                   paginated ad_daily fetch (never selects raw jsonb),
                              sync_runs staleness check (>26h, error, missing)
    aggregate.ts              entity trees per grain, pooled purchases exclusion
    display.ts / format.ts    design faithful number formatting, USD/EUR/RON
    dates.ts / csv.ts / types.ts
```

Rules the frontend enforces:

- Reads ONLY Supabase; aggregation is client side (a 30 day window is a few
  thousand rows, paginated past the PostgREST 1000 row cap). No 0003 views
  migration was needed.
- `purchases_are_pooled` rows (google) are excluded from purchases/value in
  any aggregate that mixes pooled and unpooled sources (`sumMetrics`); the
  Google tab shows them with a "pooled conversions, not purchases" hint.
- Conversion value / ROAS render the placeholder where `purchase_value` is
  null (tiktok). Budget is always the placeholder: budgets are not synced.
- Delivery pill is DERIVED (spend or impressions on the platform's most
  recent active day in range), because delivery status is not synced; it is
  labeled Delivering / No delivery, never Active / Paused.
- Google at Ad group / Ad level shows campaigns rolled up with a note;
  TikTok Smart+ campaigns appear under Campaigns only, with a note.
- A missing, stale (>26h) or errored `sync_runs` entry produces a warning
  banner; the footer shows last sync age per platform. Never a silent zero.

Dev:

```
cp .env.example .env.local   # fill VITE_SUPABASE_ANON_KEY (publishable key)
npm install
npm run dev                  # port 8080
npm run typecheck && npm run build
```

Deploy: Vercel project pointed at this repo (root), env vars
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Handled by the main
session, not from here.
