-- Google's metrics.conversions POOLS signups with purchases (no purchase-only
-- conversion action exists as of 2026-09-02), so its `purchases` values are
-- NOT comparable to Meta/TikTok purchases. Make that structural: a generated
-- column the frontend filters on for any cross-platform CPA/purchase
-- aggregate. Generated (not written by the sync) so it can never drift from
-- the platform value; flip the expression if Google ever gets a purchase-only
-- conversion action.

alter table public.ad_daily
  add column if not exists purchases_are_pooled boolean
  generated always as (platform = 'google') stored;
