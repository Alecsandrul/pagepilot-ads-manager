import { metric } from "./aggregate";
import { dec, EMPTY, money, num, pct } from "./format";
import type { Currency, Metrics, MetricKey } from "./types";

/**
 * Format a metric cell exactly like the design's fmt().
 * Budget is always the placeholder (budgets are not synced yet).
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
  const v = metric(m, k);
  if (k === "spend" || k === "revenue" || k === "cpa") return money(v, 0, cur);
  if (k === "cpc" || k === "cpm") return money(v, 2, cur);
  if (k === "impressions" || k === "clicks") return num(v);
  if (k === "conv") return num(v);
  if (k === "ctr") return pct(v);
  if (k === "roas") return dec(v, 2) + "x";
  return "";
}
