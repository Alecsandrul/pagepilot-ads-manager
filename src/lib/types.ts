export type Platform = "meta" | "tiktok" | "google";

export const PLATFORMS: Platform[] = ["meta", "tiktok", "google"];

export const PLATFORM_META: Record<Platform, { label: string; dot: string; terms: [string, string, string] }> = {
  meta: { label: "Meta Ads", dot: "#0064E0", terms: ["Campaigns", "Ad sets", "Ads"] },
  tiktok: { label: "TikTok Ads", dot: "#FE2C55", terms: ["Campaigns", "Ad groups", "Ads"] },
  google: { label: "Google Ads", dot: "#34A853", terms: ["Campaigns", "Ad groups", "Ads"] },
};

/** One row of public.ad_daily as read through PostgREST (raw jsonb never fetched). */
export interface AdRow {
  platform: Platform;
  date: string; // YYYY-MM-DD
  campaign_id: string;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  ad_id: string | null;
  ad_name: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  /** Unique people on this DAY (migration 0011). NULL for google and for days synced before it. */
  reach: number | null;
  video_views: number | null;
  video_plays: number | null;
  thruplays: number | null;
  purchases: number;
  purchase_value: number | null;
  purchases_are_pooled: boolean;
}

/** Additive metrics for one entity over the selected range. */
export interface Metrics {
  spend: number;
  impressions: number;
  clicks: number;
  /** Platform reported purchases. Google pools signups with purchases (purchases_are_pooled). */
  purchases: number;
  /** Sum of purchase_value; null when no row in the aggregate carried a value. */
  purchaseValue: number | null;
  /** True when purchaseValue is an ESTIMATE (tiktok assumed $ per result), not platform reported. */
  valueIsEstimated: boolean;
  /**
   * Sum of DAILY reach (migration 0011). Frequency is impressions / reach and
   * is never summed; it is recomputed from this pair at every row, like hook
   * rate. Beware what the sum means: unique people do not add across days, so
   * over a multi day range this is person days, and the resulting frequency
   * is the average per day, BELOW the platform's deduplicated window figure
   * (measured 1.88 here vs 2.64 in Meta over 7 days, 2026-09-03). Null when
   * no row in the aggregate carried a reach (google, and pre 0011 days).
   */
  reach: number | null;
  /**
   * How many ad_daily rows contributed to `reach`. EXACTLY ONE means the
   * frequency derived from it is the platform's own number; more than one
   * means people were counted once per contributing row and the frequency
   * is a LOWER BOUND. Both axes lose the same way: across days (a person
   * seen Monday and Tuesday counts twice) and across children (a person
   * seen by two ads of one campaign counts twice). Measured 2026-09-02 on
   * campaign 120235045548680189, one day, 43 ads: rolling the ads up gives
   * 1.29 where Meta's own campaign row says 1.99, 35% low.
   */
  reachRows: number;
  /** 3 second video plays (meta: video_view action; tiktok: video_watched_2s). Null when never synced. */
  videoViews: number | null;
  /** Video starts (video_play_actions on both platforms). Null when never synced. */
  videoPlays: number | null;
  /** ThruPlays (meta: video_thruplay_watched_actions; tiktok: video_watched_6s, its closest analog). Null when never synced. */
  thruplays: number | null;
  /** True when any row in this aggregate has purchases_are_pooled (google). */
  pooled: boolean;
  /** Most recent date with any spend or impressions, for the Delivery pill. */
  latestActivity: string | null;
}

export type Level = 0 | 1 | 2;

/** One row of public.entity_budgets: the current budget an entity OWNS. */
export interface BudgetRow {
  platform: Platform;
  level: "campaign" | "adset";
  entity_id: string;
  campaign_id: string | null;
  budget: number;
  budget_type: "daily" | "lifetime";
}

/**
 * One row of public.ad_entities (migration 0010): a thing that EXISTS in the
 * ad account, whether or not it ever delivered.
 *
 * WHY THIS TABLE EXISTS: ad_daily is built from the INSIGHTS APIs, and
 * insights only describe delivery. An ad that has been built but never spent
 * returns no insights row at all, so it can never reach ad_daily and could
 * never appear here. On 2026-09-03 that hid all 24 ads of batches 99 to 106,
 * built the day before and left paused.
 */
export interface EntityRow {
  platform: Platform;
  level: "campaign" | "adset" | "ad";
  entity_id: string;
  entity_name: string | null;
  campaign_id: string | null;
  adset_id: string | null;
  /** The platform's own word, verbatim: ACTIVE, PAUSED, ADSET_PAUSED, ENABLED. */
  status: string | null;
  is_active: boolean;
  created_at: string | null;
}

export interface Entity {
  id: string;
  level: Level;
  name: string;
  sub: string;
  campaignId: string;
  groupId: string | null;
  /** Tooltip explaining a campaign grain row (google, TikTok Smart+). */
  grainTip?: string;
  /**
   * Set on entities that EXIST (ad_entities) but have no ad_daily row in the
   * selected range. Every metric on them is a true zero, not a missing
   * number, and the Delivery column says why instead of omitting the row.
   */
  noDelivery?: boolean;
  /** Raw platform status from ad_entities, when known. */
  status?: string | null;
  /** Platform considers this live right now (parent statuses folded in). */
  isLive?: boolean;
  /** Creation time from ad_entities, when the platform reports one. */
  createdAt?: string | null;
  /** Current budget this entity owns (entity_budgets), attached client side. */
  budget?: { amount: number; type: "daily" | "lifetime" };
  /** Muted note when the entity owns no budget: "CBO" or "Ad set budgets". */
  budgetNote?: string;
  m: Metrics;
}

export type MetricKey =
  | "status"
  | "budget"
  | "spend"
  | "impressions"
  | "clicks"
  | "ctr"
  | "hookrate"
  | "holdrate"
  | "cpc"
  | "cpm"
  | "frequency"
  | "conv"
  | "cpa"
  | "revenue"
  | "roas";

export interface ColumnDef {
  k: MetricKey;
  l: string;
  w: number; // px
  a: "flex-start" | "flex-end";
  /** Optional tooltip on the column header. */
  tip?: string;
}

/** Column set copied from the design file (widths and order are law). */
export const COLUMNS: ColumnDef[] = [
  { k: "status", l: "Delivery", w: 130, a: "flex-start" },
  {
    k: "budget",
    l: "Budget",
    w: 150,
    a: "flex-end",
    tip: "Current budget, shown at the level it lives: Meta ad set (campaign for CBO), TikTok ad group (campaign for CBO and Smart+), Google campaign. A snapshot from the last sync, not history.",
  },
  { k: "spend", l: "Amount spent", w: 140, a: "flex-end" },
  { k: "impressions", l: "Impressions", w: 125, a: "flex-end" },
  { k: "clicks", l: "Clicks", w: 105, a: "flex-end" },
  { k: "ctr", l: "CTR", w: 95, a: "flex-end" },
  {
    k: "hookrate",
    l: "Hook rate",
    w: 110,
    a: "flex-end",
    tip: "Hook rate = 3 second video plays divided by video starts. TikTok has no 3 second metric, so its 2 second watched count is used there.",
  },
  {
    k: "holdrate",
    l: "Hold rate",
    w: 110,
    a: "flex-end",
    tip: "Hold rate = ThruPlays divided by 3 second video plays (Meta's custom metric). TikTok has no ThruPlay, so 6 second watched over 2 second watched is the closest analog there. Google syncs no video metrics.",
  },
  { k: "cpc", l: "CPC", w: 100, a: "flex-end" },
  { k: "cpm", l: "CPM", w: 100, a: "flex-end" },
  {
    k: "frequency",
    l: "Frequency",
    w: 115,
    a: "flex-end",
    tip:
      "Frequency = impressions divided by reach, recomputed at every row from the sums, never averaged. " +
      "Reach is synced one day at a time, and the same person seen on two days counts twice in the sum, " +
      "so over a multi day range this reads as impressions per person per day and sits BELOW the " +
      "deduplicated figure Ads Manager shows for the same window (measured 1.88 here against 2.64 in " +
      "Meta over 7 days). A single day range matches the platform exactly. Google reports unique users " +
      "only at campaign level while we sync google at ad level, so it stays blank there.",
  },
  { k: "conv", l: "Results", w: 110, a: "flex-end" },
  { k: "cpa", l: "Cost per result", w: 150, a: "flex-end" },
  { k: "revenue", l: "Conversion value", w: 160, a: "flex-end" },
  { k: "roas", l: "ROAS", w: 100, a: "flex-end" },
];

export type Currency = "USD" | "EUR" | "RON";
export type Density = "compact" | "comfortable";

export interface DateRange {
  from: string; // YYYY-MM-DD inclusive
  to: string; // YYYY-MM-DD inclusive
  label: string; // preset label or "Custom"
}

export interface SyncRun {
  platform: Platform;
  started_at: string;
  finished_at: string | null;
  status: "running" | "success" | "error";
  rows_written: number | null;
  error: string | null;
}
