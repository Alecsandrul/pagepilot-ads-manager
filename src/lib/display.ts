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
  const RED = { color: "#C0392B", bg: "#FBEAE8" };
  const GRAY = { color: "#65676B", bg: "#F0F2F5" };
  const s = (e.status ?? "").toUpperCase();

  // Rejected and in-review come FIRST: each explains a zero better than any
  // pause does, and a rejected ad must never read as merely "no delivery".
  if (s.includes("DISAPPROVED") || s.includes("REJECT")) {
    return {
      label: "Rejected",
      ...RED,
      tip: `The platform rejected this, so it cannot deliver. It reports ${e.status}.`,
    };
  }
  // PARTIALLY_APPROVED is NOT pending: it runs on the placements that passed.
  if (
    !s.includes("PARTIALLY_APPROVED") &&
    (s.includes("PENDING_REVIEW") ||
      s.includes("IN_PROCESS") ||
      s.includes("PREAPPROVED") ||
      s.includes("REVIEW"))
  ) {
    return {
      label: "In review",
      ...AMBER,
      tip: `Waiting on platform review, so it has not started delivering. It reports ${e.status}.`,
    };
  }
  if (s.includes("PENDING_BILLING")) {
    return {
      label: "Billing hold",
      ...RED,
      tip: `Blocked on billing information, so it cannot deliver. It reports ${e.status}.`,
    };
  }

  // "Running, but something is wrong" is a real Meta state (WITH_ISSUES), and
  // TikTok's partially approved is its analog. Both DELIVER, so they stay
  // distinct from green and from paused.
  //
  // UNLESS an ancestor is paused. WITH_ISSUES OUTRANKS CAMPAIGN_PAUSED in
  // Meta's effective_status precedence, so the status alone cannot be
  // trusted here: 9 ads in this account read WITH_ISSUES while sitting in a
  // PAUSED campaign and were labelled "Live, issues" (found 2026-09-03).
  // sync_entities.py now folds the ancestors into is_active, and isLive
  // false is the signal that the parent, not the issue, is why it is dark.
  // Fall through to the paused branches below in that case.
  if ((s.includes("WITH_ISSUES") || s.includes("PARTIALLY_APPROVED")) && e.isLive !== false) {
    return {
      label: deliveredLatest ? "Delivering, issues" : "Live, issues",
      ...AMBER,
      tip: deliveredLatest
        ? `Delivering, but the platform flags a problem (${e.status}). Some placements may be restricted.`
        : `Live with a problem flagged (${e.status}) and no spend on the most recent day in this range.`,
    };
  }

  if (deliveredLatest) return { label: "Delivering", ...GREEN };

  // Which parent switched it off. Meta and TikTok usually name it in the
  // status itself; Google never does (its per level status ignores
  // ancestors, so an ad under a paused campaign still reads ENABLED), and
  // Meta's WITH_ISSUES outranks CAMPAIGN_PAUSED so it does not name it
  // either. In both of those cases sync_entities.py has already resolved
  // the truth into is_active, and a status that CLAIMS to be live while
  // is_active is false can only mean an ancestor is paused. Saying
  // "Paused ... reports ENABLED" would contradict itself, so those get their
  // own label.
  const claimsLive =
    s === "ENABLED" ||
    s === "ACTIVE" ||
    s.includes("WITH_ISSUES") ||
    s.includes("PARTIALLY_APPROVED") ||
    (s.includes("ENABLE") && !s.includes("DISABLE"));
  const pausedBy =
    s.includes("ADSET_PAUSED") || s.includes("ADGROUP_DISABLE")
      ? "ad set"
      : s.includes("CAMPAIGN_PAUSED") || s.includes("CAMPAIGN_DISABLE")
        ? "campaign"
        : claimsLive && e.isLive === false
          ? "parent"
          : null;
  if (pausedBy === "parent") {
    return {
      label: "Paused (parent)",
      ...GRAY,
      tip: `Its own status is ${e.status}, but an ad set, ad group or campaign above it is paused, so it cannot deliver.`,
    };
  }

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
  // Frequency = impressions / reach, ratio of sums like the two above.
  // Placeholder wherever reach is unknown: google (unique_users exists only
  // at campaign grain and our google rows are ad grain) and every day synced
  // before migration 0011. A missing denominator must never print as a
  // number - a partial reach would silently inflate the ratio.
  if (k === "frequency") {
    if (!m.reach || !m.impressions) return EMPTY;
    return dec(m.impressions / m.reach, 2);
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
 * Per cell caveat for a Frequency figure, or undefined when there is none.
 *
 * A frequency built from ONE ad_daily row is the platform's own number. Built
 * from more than one it is a LOWER BOUND, because reach is unique people and
 * people do not add up: the same person counts once per day and once per ad
 * that reached them. Both losses are real and large on this account.
 *   across days  : campaign 120235045548680189, 27 Aug to 2 Sep 2026,
 *                  1.88 by ratio of sums against 2.64 in Meta (28.6% low)
 *   across ads   : the same campaign on 2026-09-02 alone, 43 ads,
 *                  1.29 by ratio of sums against 1.99 in Meta (35.2% low)
 * Ratio of sums is still the only defensible aggregate available at the daily
 * grain ad_daily stores: averaging the per row frequencies would weight a day
 * that reached 12 people the same as one that reached 30,000, which is worse
 * and hides the problem instead of bounding it.
 */
export function frequencyTip(m: Metrics): string | undefined {
  if (!m.reach || !m.impressions) return undefined;
  if (m.reachRows <= 1) return "Exactly as the platform reports it: one ad, one day.";
  return (
    "A LOWER BOUND. This row sums " +
    `${m.reachRows} daily reach figures, and reach is unique people: anyone who saw the ads on ` +
    "two days, or through two of these ads, is counted twice in the denominator. The platform " +
    "deduplicates them and reports a HIGHER frequency for the same rows (measured 1.29 here " +
    "against 1.99 in Meta on one campaign day). Drill down to a single ad and pick a single day " +
    "to read the exact figure."
  );
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
