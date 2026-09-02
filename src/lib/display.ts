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
