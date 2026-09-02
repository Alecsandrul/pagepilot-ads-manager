import type { AdRow, Entity, Level, Metrics, MetricKey, Platform } from "./types";
import { PLATFORM_META } from "./types";

export function emptyMetrics(): Metrics {
  return {
    spend: 0,
    impressions: 0,
    clicks: 0,
    purchases: 0,
    purchaseValue: null,
    pooled: false,
    latestActivity: null,
  };
}

function addRow(m: Metrics, r: AdRow): void {
  m.spend += r.spend || 0;
  m.impressions += r.impressions || 0;
  m.clicks += r.clicks || 0;
  m.purchases += r.purchases || 0;
  if (r.purchase_value != null) {
    m.purchaseValue = (m.purchaseValue ?? 0) + r.purchase_value;
  }
  if (r.purchases_are_pooled) m.pooled = true;
  if ((r.spend || 0) > 0 || (r.impressions || 0) > 0) {
    if (!m.latestActivity || r.date > m.latestActivity) m.latestActivity = r.date;
  }
}

/**
 * Sum a list of metrics into one aggregate.
 *
 * RULE (README, migration 0002): rows where purchases_are_pooled (google -
 * signups pooled with purchases) are EXCLUDED from any cross platform
 * purchases/CPA/ROAS aggregate. Within a single platform tab the pooled
 * values are shown, with a hint. This helper enforces the rule whenever the
 * inputs mix pooled and unpooled sources.
 */
export function sumMetrics(list: Metrics[]): Metrics {
  const out = emptyMetrics();
  const mixed = list.some((m) => m.pooled) && list.some((m) => !m.pooled);
  for (const m of list) {
    out.spend += m.spend;
    out.impressions += m.impressions;
    out.clicks += m.clicks;
    if (!(mixed && m.pooled)) {
      out.purchases += m.purchases;
      if (m.purchaseValue != null) out.purchaseValue = (out.purchaseValue ?? 0) + m.purchaseValue;
    }
    if (m.pooled) out.pooled = true;
    if (m.latestActivity && (!out.latestActivity || m.latestActivity > out.latestActivity)) {
      out.latestActivity = m.latestActivity;
    }
  }
  return out;
}

interface Grouped {
  key: string;
  name: string;
  sub: string;
  campaignId: string;
  groupId: string | null;
  rows: AdRow[];
}

function groupBy(rows: AdRow[], keyFn: (r: AdRow) => string | null, meta: (r: AdRow) => Omit<Grouped, "rows" | "key">): Grouped[] {
  const map = new Map<string, Grouped>();
  for (const r of rows) {
    const k = keyFn(r);
    if (k == null) continue;
    let g = map.get(k);
    if (!g) {
      g = { key: k, rows: [], ...meta(r) };
      map.set(k, g);
    }
    g.rows.push(r);
  }
  return [...map.values()];
}

function toEntity(g: Grouped, level: Level): Entity {
  const m = emptyMetrics();
  for (const r of g.rows) addRow(m, r);
  return {
    id: g.key,
    level,
    name: g.name,
    sub: g.sub,
    campaignId: g.campaignId,
    groupId: g.groupId,
    m,
  };
}

export interface PlatformTree {
  platform: Platform;
  campaigns: Entity[];
  groups: Entity[];
  ads: Entity[];
  /** Campaign ids whose data exists ONLY at campaign grain (google, TikTok Smart+). */
  campaignGrainOnly: Set<string>;
  m: Metrics;
}

/** Build campaign, group and ad entities for one platform from ad_daily rows. */
export function buildTree(platform: Platform, rows: AdRow[]): PlatformTree {
  const terms = PLATFORM_META[platform].terms;

  const campaignGroups = groupBy(
    rows,
    (r) => r.campaign_id,
    (r) => ({
      name: r.campaign_name || r.campaign_id,
      sub: "",
      campaignId: r.campaign_id,
      groupId: null,
    })
  );

  const adsetGroups = groupBy(
    rows.filter((r) => r.adset_id != null),
    (r) => r.adset_id,
    (r) => ({
      name: r.adset_name || r.adset_id || "",
      sub: r.campaign_name || r.campaign_id,
      campaignId: r.campaign_id,
      groupId: r.adset_id,
    })
  );

  const adGroups = groupBy(
    rows.filter((r) => r.ad_id != null),
    (r) => r.ad_id,
    (r) => ({
      name: r.ad_name || r.ad_id || "",
      sub: r.adset_name || r.adset_id || "",
      campaignId: r.campaign_id,
      groupId: r.adset_id,
    })
  );

  const groups = adsetGroups.map((g) => toEntity(g, 1));
  const ads = adGroups.map((g) => toEntity(g, 2));

  const campaignGrainOnly = new Set<string>();
  const campaigns = campaignGroups.map((g) => {
    const e = toEntity(g, 0);
    const nGroups = groups.filter((x) => x.campaignId === e.id).length;
    const nAds = ads.filter((x) => x.campaignId === e.id).length;
    if (nGroups === 0 && nAds === 0) {
      campaignGrainOnly.add(e.id);
      e.sub = "Reports at campaign level";
    } else {
      e.sub = `${nGroups} ${(nGroups === 1 ? terms[1].slice(0, -1) : terms[1]).toLowerCase()} · ${nAds} ${(nAds === 1 ? terms[2].slice(0, -1) : terms[2]).toLowerCase()}`;
    }
    return e;
  });

  return {
    platform,
    campaigns,
    groups,
    ads,
    campaignGrainOnly,
    m: sumMetrics(campaigns.map((c) => c.m)),
  };
}

/** Derived metric value for sorting and display. */
export function metric(m: Metrics, k: MetricKey): number {
  switch (k) {
    case "spend":
      return m.spend;
    case "impressions":
      return m.impressions;
    case "clicks":
      return m.clicks;
    case "conv":
      return m.purchases;
    case "revenue":
      return m.purchaseValue ?? 0;
    case "ctr":
      return m.impressions ? m.clicks / m.impressions : 0;
    case "cpc":
      return m.clicks ? m.spend / m.clicks : 0;
    case "cpm":
      return m.impressions ? (m.spend / m.impressions) * 1000 : 0;
    case "cpa":
      return m.purchases ? m.spend / m.purchases : 0;
    case "roas":
      return m.spend && m.purchaseValue != null ? m.purchaseValue / m.spend : 0;
    default:
      return 0;
  }
}
