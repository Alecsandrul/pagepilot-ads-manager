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

## Delivery is not existence (root cause, 2026-09-03)

Every metric here comes from an **insights** API, and insights only describe
delivery. An ad that has been built but has not spent returns **no insights
row at all**, and `sync_meta.py` additionally drops any row with zero spend
and zero impressions. So a new creative was invisible until it started
spending, no matter what the UI did.

That is what was reported on 2026-09-03: 98 of the 182 non-archived ads in
the Meta Creative Testing campaign had never reached `ad_daily`, including
all 24 ads of batches 99 to 106, built 2026-09-02 and left **paused**.

The fix is `ad_entities` (migration 0010) plus `scripts/sync_entities.py`:
a snapshot of what **exists** in each account, with status and creation
time, replaced wholesale on every run just like `entity_budgets`. The
frontend merges it over the insights tree (`mergeEntities`) so a built ad
appears with true zeros and a Delivery pill that says why.

Two deliberate choices:

- **Which zero-delivery rows are shown**: those live right now, and those
  created inside the selected range. Meta carries 1,873 non-archived ad
  entities against 139 that delivered in a 30 day window, so showing every
  one would bury the live rows. `is_active` is a fact about *now*, so it is
  applied only when the range reaches the present; a historical range admits
  only entities created inside it. Widen the range and older builds appear.
- **The pipeline stays D-1** and is not extended to pull today. An ad
  launched this morning is now visible through `ad_entities` with a
  "No spend yet" pill, which is the honest state; pulling a partial today
  would double the per-campaign insights calls against the fragile
  `development_access` Meta token to buy a few hours of half-formed numbers.

**An ad is identified by (ad set, ad), never by ad id alone.** Google's
`ad_group_ad` links ONE ad resource into MANY ad groups and reports each link
separately, so google ad ids are not unique: 19 ids in this account appear 2
to 8 times, 75 rows over 19 ids. `ad_entities` is therefore keyed by a unique
index on `(platform, level, entity_id, coalesce(adset_id,''))` — an index and
not a primary key, because a PK cannot hold an expression and `adset_id` is
null for campaign and adset rows. The frontend composes the same key in
`adKey()`, used by BOTH `buildTree` and `mergeEntities`.

`ad_daily` deliberately keeps storing the **bare** platform ad id with
`adset_id` beside it, so entities and metrics still join with no change to
`sync_google.py` and no backfill. This also fixes a latent bug in
`buildTree`, which grouped ads by `ad_id` alone: the day two ad groups both
spend on one google ad, that would have summed its spend across every ad
group it sits in and kept an arbitrary parent.

Status vocabularies differ and are stored verbatim, never normalised at sync
time: Meta's `effective_status` already folds in the parents
(`ADSET_PAUSED`, `CAMPAIGN_PAUSED`), TikTok's `secondary_status` likewise
(`AD_STATUS_ADGROUP_DISABLE`), but **Google's per level `status` does not**,
so `sync_entities.py` walks the ancestors itself. Without that walk Google
reported 372 "active" entities against a true 46.

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
  App.tsx                     route + auth gate (recovery > session > login)
  components/
    Dashboard.tsx             all view state, data fetch, KPI + export logic
    AdsTable.tsx              level chips, drill down, sticky table, totals, footer
    DateRangePicker.tsx       presets (7/14/30 days ending yesterday) + custom
    PlatformTabs.tsx          Meta / TikTok / Google with per platform spend
    KpiCards.tsx              6 cards with delta vs previous equal length period
    Login.tsx                 email + password (accounts created by an admin)
    ForgotPassword.tsx        request a reset link, never enumerates addresses
    ResetPassword.tsx         the /reset-password landing a recovery mail opens
    ChangePassword.tsx        signed in change, current password required
    authUi.tsx                shared card, field, rules and note primitives
    Dropdown.tsx              shared menu shell
  lib/
    supabase.ts               client + ARRIVAL_URL snapshot (taken pre client)
    authPolicy.ts             password rules and non enumerating error wording
    routes.ts                 3 route switch, no router dependency
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

## Passwords: change, forget, reset (2026-09-03)

Alex approved a self serve password flow so his password never has to travel
through a chat window. Three screens, one shared policy file.

| screen | route | who can reach it |
|---|---|---|
| Change password | dialog over the dashboard | signed in |
| Forgot password | `/forgot-password` | anyone |
| Reset password | `/reset-password` | anyone holding a recovery link |

Change password is a DIALOG, not a route, so it does not unmount the table
and re fetch a 30 day range on the way back. The other two are real routes:
`vercel.json` already rewrites every path to `index.html`, so a three way
switch on `location.pathname` is all a deep link needs and no router
dependency was added.

**The current password is verified client side, on purpose.** This project
has `security_update_password_require_reauthentication = false`, so
`updateUser({ password })` does NOT ask for the old one and anyone reaching an
unlocked browser could set a new one. `ChangePassword` therefore calls
`signInWithPassword` with the typed current password first and only updates if
that succeeds. Verified in auth-js 2.113.0 rather than assumed: a FAILED
`signInWithPassword` returns `{ data: { user: null, session: null }, error }`
and never calls `_removeSession`, so a typo cannot sign you out of the page
you are standing on. Confirmed live in the browser too.

### Three arrival shapes, and the third is the one that ships broken

```
implicit  #access_token=...&refresh_token=...&type=recovery
pkce      ?code=...
FAILURE   #error=access_denied&error_code=otp_expired&error_description=...
```

The failure shape carries no tokens, so a reset screen that only looks for
tokens renders nothing for an expired link. It is handled first, by name.

`ARRIVAL_URL` in `supabase.ts` snapshots the hash and query **before**
`createClient` runs. `detectSessionInUrl` defaults to true, so auth-js
consumes a recovery callback and `history.replaceState`s it away during client
construction; anything reading `window.location` afterwards sees a clean URL
and concludes the link was invalid. Do not move those lines, and do not read
`window.location` in the reset screen.

`flowType` is left at the auth-js default, `implicit`. PKCE keeps tokens out
of the URL but pins the link to the browser that requested it (the code
verifier lives in that browser's localStorage), so requesting on a laptop and
opening the mail on a phone fails. auth-js rejects a mismatch in both
directions, so if this ever becomes `pkce` the reset screen must change with
it.

### No email enumeration

Sign in and forgot password both speak in fixed sentences instead of
forwarding what the API said. Supabase is careful today (one message for a
wrong password and for an unknown address, and `resetPasswordForEmail`
succeeds either way) but not uniformly: "Email not confirmed" confirms an
account exists. `publicAuthError` collapses everything except rate limiting
and network failure. Forgot password shows its confirmation even when the call
returned an error, and does not echo the address back.

Verified against the live auth server: an address with no account and
`alex@pagepilot.ai` with a wrong password both render, byte for byte, "That
email and password combination did not work. Check both and try again."

### Alex has to change two things in the Supabase dashboard

Read from the live auth config on 2026-09-03, **both are currently wrong and
either one alone breaks every reset link**:

```
site_url       = 'http://localhost:3000'     <- reset mails point at a dead localhost
uri_allow_list = ''                          <- empty, so redirectTo is rejected and
                                                falls back to site_url, silently
```

Authentication -> URL Configuration:

- **Site URL** -> `https://pagepilot-ads-manager2.vercel.app`
- **Redirect URLs**, add both:
  - `https://pagepilot-ads-manager2.vercel.app/**`
  - `http://localhost:5173/**` (local dev only)

Vercel PREVIEW deployments get a new hostname per build and are deliberately
not whitelisted: a wildcard wide enough to cover them is an open redirect
surface on the auth endpoint. Test resets on production or on localhost.

Three more worth his attention, none of them blocking:

- `disable_signup = false`. Public signup is ON for an internal tool whose
  anon key ships in the JS bundle by design, so anyone can create an auth
  user. RLS still shows them nothing (`private.is_admin()`), but they can
  burn the email quota. Turn it off in Authentication -> Sign In / Providers.
- `password_min_length = 6` with no character requirement. The app asks for
  12, but that is a CLIENT rule; the API accepts 6. Raise it to 12 to make it
  real.
- `smtp_host` is unset, so recovery mail goes through Supabase's built in
  sender with `rate_limit_email_sent = 2` per hour. That is fine for two
  people and will feel broken the moment anyone retries. Custom SMTP if it
  ever matters.

Do NOT turn on `security_update_password_require_reauthentication`. It makes
`updateUser({ password })` demand a nonce from a separate reauthentication
email, which would break both the change and the reset screens. The client
side verification above covers the same threat.
