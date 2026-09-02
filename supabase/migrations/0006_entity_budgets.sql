-- 0006 - entity_budgets: current budgets for the Budget column (Alex,
-- 2026-09-02). NOT applied live by this repo; the main session applies it.
--
-- DESIGN: budgets are CURRENT entity attributes, not daily history, so they
-- live in a small snapshot table that each sync run fully replaces
-- (delete all + insert), never in ad_daily. One row per entity that OWNS a
-- budget at the level where it actually lives:
--   meta   -> adset daily/lifetime budget; campaign budget for CBO campaigns
--             (an adset under CBO has no budget row - the UI shows "CBO").
--   tiktok -> ad group budget; campaign budget for CBO / Smart+ campaigns
--             (BUDGET_MODE_DYNAMIC_DAILY_BUDGET); BUDGET_MODE_INFINITE ad
--             groups own nothing and get no row.
--   google -> campaign budget (campaign_budget.amount_micros / 1e6), always
--             daily.
-- Amounts are USD (account currency on all three accounts).

create table if not exists public.entity_budgets (
  platform    text        not null check (platform in ('meta','tiktok','google')),
  level       text        not null check (level in ('campaign','adset')),
  entity_id   text        not null,
  campaign_id text,                 -- parent campaign for adset rows
  entity_name text,
  budget      numeric     not null,
  budget_type text        not null check (budget_type in ('daily','lifetime')),
  fetched_at  timestamptz not null default now(),
  primary key (platform, level, entity_id)
);

alter table public.entity_budgets enable row level security;

create policy entity_budgets_admin_all on public.entity_budgets
  for all using (private.is_admin()) with check (private.is_admin());

-- The sync loader connects as ads_sync (least privilege, see load.py).
grant select, insert, update, delete on public.entity_budgets to ads_sync;

-- Let sync_runs record the budgets refresh like any platform sync.
alter table public.sync_runs drop constraint if exists sync_runs_platform_check;
alter table public.sync_runs
  add constraint sync_runs_platform_check
  check (platform in ('meta','tiktok','google','budgets'));
