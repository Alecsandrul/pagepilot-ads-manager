import { metric } from "./aggregate";
import { dec, EMPTY, money, num, pct } from "./format";
import type { Currency, Entity, Metrics, MetricKey } from "./types";

export interface DeliveryState {
  label: string;
  color: string;
  bg: string;
  /** Why the row reads the way it does. Always set for a non delivering row. */
  tip?: string;
}

/**
 * Turn each platform's status vocabulary into one honest Delivery pill.
 *
 * Three distinct things used to collapse into "No delivery", or worse into
 * no row at all (root cause, 2026-09-03):
 *   1. it delivered on the most recent active day  -> Delivering
 *   2. it EXISTS and is live but has not spent yet -> No spend yet
 *   3. it EXISTS and is switched off               -> Paused, and by whom
 * Cases 2 and 3 only became expressible once ad_entities (migration 0010)
 * supplied the things the insights APIs never report.
 *
 * The parent that did the pausing is named wherever the platform says so
 * (Meta ADSET_PAUSED / CAMPAIGN_PAUSED, TikTok *_ADGROUP_DISABLE /
 * *_CAMPAIGN_DISABLE): "my ad is paused" and "the ad set holding my ad is
 * paused" need different fixes.
 */
export function deliveryState(e: Entity, deliveredLatest: boolean): DeliveryState {
  const GREEN = { color: "#1E7B4D", bg: "#E4F3EA" };
  const AMBER = { color: "#8A5300", bg: "#FFF4E5" };
  const GRAY = { color: "#65676B", bg: "#F0F2F5" };
  const s = (e.status ?? "").toUpperCase();

  if (deliveredLatest) return { label: "Delivering", ...GREEN };

  const pausedBy =
    s.includes("ADSET_PAUSED") || s.includes("ADGROUP_DISABLE")
      ? "ad set"
      : s.includes("CAMPAIGN_PAUSED") || s.includes("CAMPAIGN_DISABLE")
        ? "campaign"
        : null;

  if (e.noDelivery) {
    // It exists, but has nothing in this date range at all.
    if (e.isLive) {
      return {
        label: "No spend yet",
        ...AMBER,
        tip: "Live on the platform but it has not spent inside the selected range. A newly launched ad can take a few hours to start delivering.",
      };
    }
    if (pausedBy) {
      return {
        label: `Paused (${pausedBy})`,
        ...GRAY,
        tip: `Never delivered: switched off because its ${pausedBy} is paused. The platform reports ${e.status}.`,
      };
    }
    return {
      label: "Paused",
      ...GRAY,
      tip: `Built but never delivered: it is switched off. The platform reports ${e.status ?? "no status"}.`,
    };
  }

  // It DID deliver inside the range, just not on the most recent day.
  if (e.isLive) {
    return {
      label: "No delivery",
      ...GRAY,
      tip: "Live on the platform, but it did not spend on the most recent day in this range.",
    };
  }
  if (pausedBy) {
    return {
      label: `Paused (${pausedBy})`,
      ...GRAY,
      tip: `It spent earlier in this range and is now switched off because its ${pausedBy} is paused.`,
    };
  }
  if (s) {
    return {
      label: "Paused",
      ...GRAY,
      tip: "It spent earlier in this range and is now switched off.",
    };
  }
  return { label: "No delivery", ...GRAY };
}

/**
 * Format a metric cell exactly like the design's fmt().
 * Budget cells are rendered by AdsTable from entity_budgets; here the
 * budget key is only a placeholder fallback.
 * Conversion value and ROAS are the placeholder where no purchase_value
 * exists (tiktok, and any entity with no valued rows).
 */
export function fmtCell(m: Metrics, k: MetricKey, cur: Currency): string {
  if (k === "budget") return EMPTY;
  if ((k === "revenue" || k === "roas") && m.purchaseValue == null) return EMPTY;
  // Hook rate = 3 second plays / video starts (tiktok: 2 second watched).
  // Placeholder when either side is missing or zero (google always, and
  // days synced before the video fields existed).
  if (k === "hookrate") {
    if (!m.videoViews || !m.videoPlays) return EMPTY;
    return dec((m.videoViews / m.videoPlays) * 100, 1) + "%";
  }
  // Hold rate = ThruPlays / 3 second plays (tiktok: 6s watched / 2s watched).
  // Ratio of sums, like hook rate. Placeholder where either side is missing
  // or zero (google always, and rows synced before migration 0005).
  if (k === "holdrate") {
    if (!m.thruplays || !m.videoViews) return EMPTY;
    return dec((m.thruplays / m.videoViews) * 100, 1) + "%";
  }
  const v = metric(m, k);
  if (k === "spend" || k === "revenue" || k === "cpa") return money(v, 0, cur);
  if (k === "cpc" || k === "cpm") return money(v, 2, cur);
  if (k === "impressions" || k === "clicks") return num(v);
  if (k === "conv") return num(v);
  if (k === "ctr") return pct(v);
  if (k === "roas") return dec(v, 2) + "x";
  return "";
}

/**
 * ROAS verdict colors (Alex, 2026-09-02): any ROAS >= 1.00 renders green and
 * any ROAS < 1.00 renders red, wherever a ROAS shows (table cells, totals
 * row, KPI card). This SUPERSEDES the earlier rule that estimated TikTok
 * ROAS stayed neutral gray with no verdict color: estimated values are
 * colored too, in a LIGHTER shade of the same green/red, and they keep their
 * "est" marker so an estimate never passes as platform reported.
 */
const ROAS_COLORS = {
  green: "#1E7B4D",
  red: "#C0392B",
  greenEst: "#63A583",
  redEst: "#D98C82",
};

/** Verdict color for a ROAS, or null when no ROAS exists to judge. */
export function roasColor(m: Metrics, estimated: boolean): string | null {
  if (m.purchaseValue == null || !m.spend) return null;
  const good = m.purchaseValue / m.spend >= 1;
  if (estimated) return good ? ROAS_COLORS.greenEst : ROAS_COLORS.redEst;
  return good ? ROAS_COLORS.green : ROAS_COLORS.red;
}
