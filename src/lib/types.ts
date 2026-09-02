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
  video_views: number | null;
  video_plays: number | null;
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
  /** 3 second video plays (meta: video_view action; tiktok: video_watched_2s). Null when never synced. */
  videoViews: number | null;
  /** Video starts (video_play_actions on both platforms). Null when never synced. */
  videoPlays: number | null;
  /** True when any row in this aggregate has purchases_are_pooled (google). */
  pooled: boolean;
  /** Most recent date with any spend or impressions, for the Delivery pill. */
  latestActivity: string | null;
}

export type Level = 0 | 1 | 2;

export interface Entity {
  id: string;
  level: Level;
  name: string;
  sub: string;
  campaignId: string;
  groupId: string | null;
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
  | "cpc"
  | "cpm"
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
  { k: "budget", l: "Budget", w: 150, a: "flex-end" },
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
  { k: "cpc", l: "CPC", w: 100, a: "flex-end" },
  { k: "cpm", l: "CPM", w: 100, a: "flex-end" },
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
