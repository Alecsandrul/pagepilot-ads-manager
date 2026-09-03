import { useCallback, useEffect, useMemo, useState } from "react";
import type * as React from "react";
import { applyBudgets, buildTree, mergeEntities, metric, sumMetrics, type PlatformTree } from "../lib/aggregate";
import { toCsv, downloadCsv } from "../lib/csv";
import { fetchAdRows, fetchBudgets, fetchEntities, fetchSyncStatus, type SyncStatus } from "../lib/data";
import { DEFAULT_RANGE, previousRange, relativeTime } from "../lib/dates";
import { fmtCell, roasColor } from "../lib/display";
import { dec, EMPTY, MINUS, money, num, pct } from "../lib/format";
import { fetchTiktokValue, saveTiktokValue, TIKTOK_VALUE_DEFAULT } from "../lib/settings";
import { supabase } from "../lib/supabase";
import {
  COLUMNS,
  PLATFORMS,
  PLATFORM_META,
  type AdRow,
  type BudgetRow,
  type Currency,
  type DateRange,
  type Density,
  type Entity,
  type EntityRow,
  type Level,
  type MetricKey,
  type Platform,
} from "../lib/types";
import AdsTable, { type ParentRef, type SortState } from "./AdsTable";
import DateRangePicker from "./DateRangePicker";
import Dropdown from "./Dropdown";
import KpiCards, { type Kpi } from "./KpiCards";
import PlatformTabs, { type PlatformTab } from "./PlatformTabs";

const btnSecondary: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  height: 34,
  padding: "0 14px",
  border: "1px solid #CFD2D7",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  background: "#fff",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

function checkGlyph(on: boolean) {
  return (
    <span
      style={{
        width: 15,
        height: 15,
        border: `1.5px solid ${on ? "#0064E0" : "#C4C9CE"}`,
        background: on ? "#0064E0" : "transparent",
        borderRadius: 4,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        fontSize: 10,
        lineHeight: 1,
        flex: "0 0 15px",
      }}
    >
      {on ? "✓" : ""}
    </span>
  );
}

export default function Dashboard() {
  // Data
  const [range, setRange] = useState<DateRange>(DEFAULT_RANGE);
  const [rows, setRows] = useState<AdRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  /** Set when sync_runs could not be READ: distinct from "no sync ran". */
  const [syncUnreadable, setSyncUnreadable] = useState<string | null>(null);
  const [budgets, setBudgets] = useState<BudgetRow[]>([]);
  /** Set when entity_budgets could not be read: budgets show placeholders. */
  const [budgetsError, setBudgetsError] = useState<string | null>(null);
  /**
   * Everything that exists in the accounts (ad_entities, migration 0010).
   * Without it the table can only ever show what DELIVERED, which is what
   * hid the 24 newly built batch 99 to 106 ads on 2026-09-03.
   */
  const [entities, setEntities] = useState<EntityRow[]>([]);
  /** Set when ad_entities could not be read: only delivering rows are shown. */
  const [entitiesError, setEntitiesError] = useState<string | null>(null);

  // View state
  const [platform, setPlatform] = useState<Platform>("meta");
  const [level, setLevel] = useState<Level>(0);
  const [parent, setParent] = useState<ParentRef | null>(null);
  const [sort, setSort] = useState<SortState>({ key: "spend", dir: "desc" });
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [currency, setCurrency] = useState<Currency>("USD");
  const [density, setDensity] = useState<Density>("compact");
  const [hiddenCols, setHiddenCols] = useState<Set<MetricKey>>(new Set());
  const [colsOpen, setColsOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);

  // TikTok assumed $ per result (app_settings, migration 0004)
  const [tiktokValue, setTiktokValue] = useState<number>(TIKTOK_VALUE_DEFAULT);
  const [tiktokDraft, setTiktokDraft] = useState<string>(String(TIKTOK_VALUE_DEFAULT));
  const [tiktokSaveError, setTiktokSaveError] = useState<string | null>(null);

  const prev = useMemo(() => previousRange(range), [range]);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    fetchAdRows(prev.from, range.to)
      .then(setRows)
      .catch((e: Error) => setLoadError(e.message))
      .finally(() => setLoading(false));
  }, [prev.from, range.to]);

  useEffect(load, [load]);
  useEffect(() => {
    const refreshStatus = () => {
      fetchSyncStatus()
        .then((s) => {
          setSync(s);
          setSyncUnreadable(null);
        })
        .catch((e: Error) => {
          // Cannot read is NOT "never ran" - say so in the banner instead
          // of hiding it (honesty doctrine; live bug 2026-09-03).
          setSync(null);
          setSyncUnreadable(e.message);
        });
      fetchBudgets()
        .then((b) => {
          setBudgets(b);
          setBudgetsError(null);
        })
        .catch((e: Error) => {
          // Budgets stay empty (placeholders render); the banner says why
          // instead of failing silently.
          setBudgetsError(e.message);
        });
      fetchEntities()
        .then((e) => {
          setEntities(e);
          setEntitiesError(null);
        })
        .catch((e: Error) => {
          // Falls back to the old insights-only behaviour: ads that never
          // delivered go missing again. That is exactly the failure this
          // table was added to fix, so the banner must say it out loud
          // rather than quietly showing a shorter list.
          setEntities([]);
          setEntitiesError(e.message);
        });
    };
    refreshStatus();
    // Re-read on tab focus: a ONE SHOT fetch left a long lived tab stuck
    // forever with whatever it saw at mount - the live 2026-09-03 bug was a
    // tab opened before entity_budgets was first loaded, showing the
    // placeholder in every Budget cell while the table sat full (an empty
    // authenticated read raises no error). Sync status ages the same way.
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshStatus();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    fetchTiktokValue()
      .then((v) => {
        setTiktokValue(v);
        setTiktokDraft(String(v));
      })
      .catch(() => {
        // Table missing or unreachable: the default stands.
      });
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  // Trees for the current and previous period, per platform
  const trees = useMemo(() => {
    const cur: Partial<Record<Platform, PlatformTree>> = {};
    const before: Partial<Record<Platform, PlatformTree>> = {};
    const opts = { tiktokValuePerResult: tiktokValue };
    for (const p of PLATFORMS) {
      const platformRows = (rows ?? []).filter((r) => r.platform === p);
      cur[p] = buildTree(p, platformRows.filter((r) => r.date >= range.from), opts);
      // Add what EXISTS but did not deliver, before budgets attach: a newly
      // built ad set owns a budget too, and should show it.
      mergeEntities(cur[p]!, entities, range);
      applyBudgets(cur[p]!, budgets);
      // The previous period feeds KPI deltas only. Merging zero rows into it
      // would add nothing and would compare against entities that did not
      // exist back then, so it stays purely insights based.
      before[p] = buildTree(p, platformRows.filter((r) => r.date < range.from), opts);
    }
    return { cur: cur as Record<Platform, PlatformTree>, before: before as Record<Platform, PlatformTree> };
  }, [rows, range, tiktokValue, budgets, entities]);

  const tree = trees.cur[platform];
  const prevTree = trees.before[platform];
  const meta = PLATFORM_META[platform];
  const isGoogle = platform === "google";

  // "Delivering" = had spend or impressions on the most recent day with any
  // activity on this platform inside the selected range. We do not sync
  // paused/active status, so delivery is derived, never claimed as status.
  const platformLatest = useMemo(() => {
    let latest: string | null = null;
    for (const c of tree.campaigns) {
      if (c.m.latestActivity && (!latest || c.m.latestActivity > latest)) latest = c.m.latestActivity;
    }
    return latest;
  }, [tree]);

  const isActive = useCallback(
    (e: Entity) => e.m.latestActivity != null && e.m.latestActivity === platformLatest,
    [platformLatest]
  );

  /**
   * Does the Amount spent KPI equal the sum of the rows on screen?
   *
   * THE QUESTION (Alex, 2026-09-03): "only the campaigns with spend show up,
   * so I do not think the ones without are counted in Amount spent". The
   * card is the whole platform (buildTree sums EVERY campaign), and every
   * ad_daily row carries a campaign_id, so at Campaigns level the two are
   * identical by construction and always have been.
   *
   * Below that level they are not, and it is not a bug: ad_daily is a MIXED
   * grain. A TikTok Smart+ campaign is stored as one campaign row with
   * adset_id and ad_id NULL (the API publishes no per ad breakdown for it),
   * so it can never produce an ad group or ad row. On 2026-09-02 that was
   * $6,842 of TikTok's $11,391 in the last 30 days, 60% of the platform.
   * Meta and Google both cover 100% at every level.
   *
   * Rather than argue it in a comment, the number is now on screen: the
   * footer states what the rows cover, always, and the notice explains any
   * shortfall. A future grain change that starts hiding spend will show up
   * here by itself.
   */
  const coverage = useMemo(() => {
    const list =
      isGoogle && level > 0 && tree.groups.length === 0 && tree.ads.length === 0
        ? tree.campaigns
        : level === 0
          ? tree.campaigns
          : level === 1
            ? tree.groups
            : tree.ads;
    const covered = list.reduce((a, e) => a + e.m.spend, 0);
    const gap = tree.m.spend - covered;
    // Money is stored at 2dp and summed over hundreds of rows; anything under
    // half a unit of currency is float noise, not missing spend.
    return { total: tree.m.spend, covered, gap: Math.abs(gap) < 0.5 ? 0 : gap };
  }, [tree, level, isGoogle]);

  // Items at the current level, before search and sort
  const { baseItems, notice } = useMemo((): { baseItems: Entity[]; notice: string | null } => {
    // Google syncs at ad grain since 2026-09-02; a range holding only the
    // older campaign grain rows still rolls up to campaigns at every level.
    if (isGoogle && level > 0 && tree.groups.length === 0 && tree.ads.length === 0) {
      return {
        baseItems: tree.campaigns,
        notice:
          "Google data in this range is campaign level only (synced before the ad grain sync), so its campaigns are shown rolled up here.",
      };
    }
    let items: Entity[];
    if (level === 0) items = tree.campaigns;
    else if (level === 1)
      items = parent ? tree.groups.filter((g) => g.campaignId === parent.id) : tree.groups;
    else
      items = parent
        ? tree.ads.filter((a) => (parent.level === 0 ? a.campaignId === parent.id : a.groupId === parent.id))
        : tree.ads;

    let note: string | null = null;
    if (level > 0 && tree.campaignGrainOnly.size > 0 && platform === "tiktok") {
      if (parent && tree.campaignGrainOnly.has(parent.id)) {
        note =
          "TikTok's API gives no per ad breakdown for Smart+ campaigns, so this campaign has no rows at this level.";
      } else if (!parent) {
        const n = tree.campaignGrainOnly.size;
        note =
          n === 1
            ? "1 Smart+ campaign appears under Campaigns only: TikTok's API gives no per ad breakdown for Smart+."
            : `${n} Smart+ campaigns appear under Campaigns only: TikTok's API gives no per ad breakdown for Smart+.`;
      }
    }

    // Say when rows are present that never delivered, so a screen full of
    // zeros reads as a fact about the ads rather than as broken data. These
    // come from ad_entities (migration 0010) and are the whole reason a
    // newly built creative is visible at all.
    const zero = items.filter((e) => e.noDelivery).length;
    if (zero > 0) {
      const term = meta.terms[level].toLowerCase();
      const one = zero === 1;
      const zeroNote =
        `${zero} ${one ? term.replace(/s$/, "") : term} here ${one ? "has" : "have"} not spent in this range ` +
        `(built or live but not delivering). ${one ? "It shows" : "They show"} zero, not missing data.`;
      note = note ? `${note} ${zeroNote}` : zeroNote;
    }

    // Name the missing spend in money, not in prose. Only without a parent
    // chip: inside one campaign the rows are meant to be a subset of the
    // platform, and comparing them to the platform wide card would be
    // nonsense. See the coverage memo above for why a gap is legitimate.
    if (!parent && coverage.gap > 0) {
      const why =
        platform === "tiktok"
          ? "TikTok publishes no per ad breakdown for Smart+ campaigns, so they are stored at campaign level"
          : "some campaigns in this range report above this level";
      const gapNote =
        `${money(coverage.gap, 0, currency)} of the ${money(coverage.total, 0, currency)} in Amount spent ` +
        `has no row at this level (${why}), so these rows add up to ${money(coverage.covered, 0, currency)}. ` +
        `Switch to ${meta.terms[0]} to see all of it.`;
      note = note ? `${note} ${gapNote}` : gapNote;
    }
    return { baseItems: items, notice: note };
  }, [tree, level, parent, isGoogle, platform, meta, coverage, currency]);

  const items = useMemo(() => {
    let out = baseItems;
    const needle = q.trim().toLowerCase();
    if (needle) out = out.filter((e) => `${e.name} ${e.sub}`.toLowerCase().includes(needle));
    const dir = sort.dir === "asc" ? 1 : -1;
    const value = (e: Entity) =>
      sort.key === "status" ? (isActive(e) ? 1 : 0) : sort.key === "budget" ? (e.budget?.amount ?? 0) : metric(e.m, sort.key);
    return [...out].sort((a, b) => (value(a) - value(b)) * dir || b.m.spend - a.m.spend);
  }, [baseItems, q, sort, isActive]);

  const totals = useMemo(() => sumMetrics(items.map((i) => i.m)), [items]);

  const visibleCols = useMemo(() => COLUMNS.filter((c) => !hiddenCols.has(c.k)), [hiddenCols]);

  const counts: [number, number, number] =
    isGoogle && tree.groups.length === 0 && tree.ads.length === 0
      ? [tree.campaigns.length, tree.campaigns.length, tree.campaigns.length]
      : [tree.campaigns.length, tree.groups.length, tree.ads.length];

  // KPI cards with delta vs the previous equal length period
  const kpis = useMemo((): Kpi[] => {
    const cur = tree.m;
    const before = prevTree.m;
    const defs: { label: string; k: MetricKey; fmt: (v: number) => string; na?: boolean }[] = [
      { label: "Amount spent", k: "spend", fmt: (v) => money(v, 0, currency) },
      { label: "Impressions", k: "impressions", fmt: num },
      { label: "Clicks", k: "clicks", fmt: num },
      { label: "CTR", k: "ctr", fmt: pct },
      { label: "Results", k: "conv", fmt: num },
      { label: "ROAS", k: "roas", fmt: (v) => dec(v, 2) + "x", na: cur.purchaseValue == null },
    ];
    return defs.map((d) => {
      if (d.na) {
        return {
          label: d.label,
          value: EMPTY,
          delta: "no conversion value on this platform",
          deltaColor: "#8A8D91",
        };
      }
      const v = metric(cur, d.k);
      const pv = metric(before, d.k);
      let delta: string;
      let deltaColor: string;
      if (!pv) {
        delta = "no data for prior period";
        deltaColor = "#8A8D91";
      } else {
        const change = ((v - pv) / pv) * 100;
        const up = change >= 0;
        delta = `${up ? "+" : MINUS}${dec(Math.abs(change), 1)}% vs. prev.`;
        deltaColor = up ? "#1E7B4D" : "#C0392B";
      }
      const isEst = d.k === "roas" && cur.valueIsEstimated;
      // ROAS verdict color on the KPI card too (roasColor in display.ts).
      const valueColor = d.k === "roas" ? (roasColor(cur, isEst) ?? undefined) : undefined;
      // Pooled labeling is data driven since the google ad grain sync:
      // rows synced before it hold pooled conversions (purchases_are_pooled)
      // while re-synced rows hold browser_payment purchases only.
      const hint = cur.pooled
        ? d.k === "conv" || d.k === "roas"
          ? "includes pooled conversions, not purchases"
          : undefined
        : isEst
          ? `estimated at $${tiktokValue} per result`
          : undefined;
      return {
        label: d.label,
        value: d.fmt(v),
        delta,
        deltaColor,
        hint,
        suffix: isEst ? "est" : undefined,
        title: isEst ? `Estimated at $${tiktokValue} per result, set in Display settings` : undefined,
        valueColor,
      };
    });
  }, [tree, prevTree, currency, isGoogle, tiktokValue]);

  const tabs: PlatformTab[] = PLATFORMS.map((p) => ({
    key: p,
    label: PLATFORM_META[p].label,
    spend: money(trees.cur[p].m.spend, 0, currency),
    active: p === platform,
  }));

  // Footer right: sync freshness, never a silent zero
  const footerRight = useMemo(() => {
    const run = sync?.latest[platform];
    if (!run) return "Sync status unknown";
    const rel = relativeTime(run.started_at);
    if (run.status === "error") return `Last ${meta.label} sync FAILED ${rel}`;
    return `Last ${meta.label} sync ${rel} · platform reported metrics`;
  }, [sync, platform, meta.label]);

  // Footer centre: a standing, checkable answer to "is Amount spent made of
  // rows I can see?". Stated whether the answer is yes or no, because only
  // saying it when something is wrong leaves the good case unverifiable.
  const footerCoverage = useMemo(() => {
    const term = meta.terms[level].toLowerCase();
    if (coverage.gap <= 0) {
      return `${term} cover all ${money(coverage.total, 0, currency)} of Amount spent`;
    }
    return `${term} cover ${money(coverage.covered, 0, currency)} of the ${money(coverage.total, 0, currency)} in Amount spent`;
  }, [coverage, currency, meta, level]);

  const estTooltip = `Estimated at $${tiktokValue} per result, set in Display settings`;
  const tiktokDraftValid = Number.isFinite(Number(tiktokDraft)) && Number(tiktokDraft) > 0;

  function saveTiktok() {
    const v = Number(tiktokDraft);
    if (!Number.isFinite(v) || v <= 0) return;
    setTiktokValue(v); // optimistic: recompute immediately
    setTiktokSaveError(null);
    saveTiktokValue(v).catch((e: Error) => setTiktokSaveError(`Saved locally only: ${e.message}`));
  }

  function selectPlatform(p: Platform) {
    setPlatform(p);
    setParent(null);
    setSel(new Set());
    setQ("");
    setLevel(0);
  }

  function changeLevel(l: Level) {
    setLevel(l);
    if (l === 0) setParent(null);
    setSel(new Set());
  }

  function drill(e: Entity) {
    setParent({ id: e.id, name: e.name, level });
    setLevel((level + 1) as Level);
    setSel(new Set());
  }

  function drillable(e: Entity) {
    if (level >= 2) return false;
    if (tree.campaignGrainOnly.has(e.id)) return false;
    return true;
  }

  function onSort(k: MetricKey) {
    setSort((s) => ({ key: k, dir: s.key === k && s.dir === "desc" ? "asc" : "desc" }));
  }

  function toggleSel(id: string) {
    setSel((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSel((s) => {
      const allOn = items.length > 0 && items.every((i) => s.has(i.id));
      return allOn ? new Set<string>() : new Set(items.map((i) => i.id));
    });
  }

  function exportCsv() {
    const header = [meta.terms[level], "Detail", ...visibleCols.filter((c) => c.k !== "status" && c.k !== "budget").map((c) => c.l)];
    const dataCols = visibleCols.filter((c) => c.k !== "status" && c.k !== "budget");
    const csvCell = (m: (typeof totals), k: MetricKey) => {
      const v = fmtCell(m, k, currency);
      const isEst = (k === "revenue" || k === "roas") && m.valueIsEstimated && v !== EMPTY;
      return isEst ? `${v} est` : v;
    };
    const body = items.map((e) => [
      e.name,
      e.sub,
      ...dataCols.map((c) => csvCell(e.m, c.k)),
    ]);
    const totalRow = ["Total", "", ...dataCols.map((c) => csvCell(totals, c.k))];
    const csv = toCsv([header, ...body, totalRow]);
    const term = meta.terms[level].toLowerCase().replace(/ /g, "_");
    downloadCsv(`ads_${platform}_${term}_${range.from}_${range.to}.csv`, csv);
  }

  const menuItem: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 9,
    padding: "7px 10px",
    borderRadius: 7,
    fontSize: 13,
    cursor: "pointer",
  };
  const menuHeading: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "#8A8D91",
    padding: "6px 10px 3px",
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#F4F5F7",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Sync problem banner: schema rule, never render a silent zero -
          and never claim "no sync ran" when the status simply could not be
          read (the two are kept distinct). */}
      {(() => {
        const problems: string[] = [];
        if (syncUnreadable) {
          problems.push(`sync status could not be read (${syncUnreadable}); data freshness unknown`);
        } else if (sync) {
          problems.push(...sync.problems);
        }
        if (budgetsError) {
          problems.push(`budgets could not be read (${budgetsError}); Budget column shows placeholders`);
        }
        if (entitiesError) {
          problems.push(
            `the list of built ads could not be read (${entitiesError}); ads that have not spent yet are missing from this table`
          );
        }
        if (problems.length === 0) return null;
        return (
          <div
            style={{
              padding: "8px 28px",
              background: "#FFF4E5",
              color: "#8A5300",
              fontSize: 12.5,
              fontWeight: 500,
              borderBottom: "1px solid #F0D9B5",
            }}
          >
            {`Data may be incomplete. ${problems.join(" · ")}`}
          </div>
        );
      })()}

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 24,
          padding: "18px 28px 16px",
          background: "#FFFFFF",
          borderBottom: "1px solid #DFE1E6",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em" }}>Ads Reporting</div>
          <div style={{ fontSize: 13, color: "#65676B" }}>All platforms, one report</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <DateRangePicker range={range} onChange={setRange} />

          <Dropdown
            open={displayOpen}
            onClose={() => setDisplayOpen(false)}
            width={210}
            trigger={
              <div className="btn-secondary" onClick={() => setDisplayOpen(!displayOpen)} style={btnSecondary}>
                Display
              </div>
            }
          >
            <div style={menuHeading}>Density</div>
            {(["compact", "comfortable"] as Density[]).map((d) => (
              <div key={d} className="menu-item" style={menuItem} onClick={() => setDensity(d)}>
                {checkGlyph(density === d)}
                <span style={{ textTransform: "capitalize" }}>{d}</span>
              </div>
            ))}
            <div style={menuHeading}>Currency</div>
            {(["USD", "EUR", "RON"] as Currency[]).map((c) => (
              <div key={c} className="menu-item" style={menuItem} onClick={() => setCurrency(c)}>
                {checkGlyph(currency === c)}
                <span>{c}</span>
                {c !== "USD" && <span style={{ fontSize: 11, color: "#8A8D91" }}>fixed rate</span>}
              </div>
            ))}
            <div style={menuHeading}>TikTok value per result ($)</div>
            <div style={{ padding: "2px 10px 8px", display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  className="search-input"
                  type="number"
                  min={1}
                  step="any"
                  value={tiktokDraft}
                  onChange={(e) => setTiktokDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && tiktokDraftValid) saveTiktok();
                  }}
                  style={{
                    height: 30,
                    width: 90,
                    padding: "0 8px",
                    border: "1px solid #CFD2D7",
                    borderRadius: 7,
                    fontSize: 12.5,
                    color: "#1C2B33",
                  }}
                />
                <button
                  className="btn-primary"
                  onClick={saveTiktok}
                  disabled={!tiktokDraftValid}
                  style={{
                    height: 30,
                    padding: "0 12px",
                    border: "none",
                    borderRadius: 7,
                    background: "#0064E0",
                    color: "#fff",
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: "pointer",
                    opacity: tiktokDraftValid ? 1 : 0.5,
                  }}
                >
                  Save
                </button>
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: tiktokSaveError ? "#C0392B" : "#8A8D91",
                  lineHeight: 1.4,
                }}
              >
                {tiktokSaveError ??
                  (tiktokDraftValid
                    ? "Drives estimated Conversion value and ROAS for TikTok rows."
                    : "Enter a positive number.")}
              </div>
            </div>
          </Dropdown>

          <Dropdown
            open={colsOpen}
            onClose={() => setColsOpen(false)}
            width={230}
            trigger={
              <div className="btn-secondary" onClick={() => setColsOpen(!colsOpen)} style={btnSecondary}>
                Columns
              </div>
            }
          >
            <div style={menuHeading}>Show columns</div>
            {COLUMNS.map((c) => {
              const on = !hiddenCols.has(c.k);
              return (
                <div
                  key={c.k}
                  className="menu-item"
                  style={menuItem}
                  onClick={() =>
                    setHiddenCols((s) => {
                      const next = new Set(s);
                      if (next.has(c.k)) next.delete(c.k);
                      else if (COLUMNS.length - next.size > 1) next.add(c.k);
                      return next;
                    })
                  }
                >
                  {checkGlyph(on)}
                  <span>{c.l}</span>
                </div>
              );
            })}
          </Dropdown>

          <div className="btn-primary" onClick={exportCsv} style={{ ...btnSecondary, border: "none", background: "#0064E0", color: "#fff" }}>
            Export
          </div>

          <div
            onClick={() => supabase.auth.signOut()}
            style={{ fontSize: 12.5, color: "#8A8D91", cursor: "pointer", marginLeft: 6 }}
          >
            Sign out
          </div>
        </div>
      </div>

      <PlatformTabs tabs={tabs} onSelect={selectPlatform} />
      <KpiCards kpis={kpis} />

      {loadError ? (
        <div style={{ padding: "40px 28px", textAlign: "center" }}>
          <div style={{ fontSize: 14, color: "#C0392B", marginBottom: 12 }}>
            {`Could not load data: ${loadError}`}
          </div>
          <div
            className="btn-primary"
            onClick={load}
            style={{ ...btnSecondary, border: "none", background: "#0064E0", color: "#fff", display: "inline-flex" }}
          >
            Retry
          </div>
        </div>
      ) : loading && rows == null ? (
        <div style={{ padding: "56px 28px", textAlign: "center", color: "#8A8D91", fontSize: 13.5 }}>
          Loading data…
        </div>
      ) : (
        <AdsTable
          terms={meta.terms}
          counts={counts}
          items={items}
          totalCount={baseItems.length}
          totals={totals}
          columns={visibleCols}
          level={level}
          onLevel={changeLevel}
          parent={parent}
          onClearParent={() => setParent(null)}
          onDrill={drill}
          drillable={drillable}
          isActive={isActive}
          sort={sort}
          onSort={onSort}
          q={q}
          onSearch={setQ}
          sel={sel}
          onToggle={toggleSel}
          onToggleAll={toggleAll}
          onClearSel={() => setSel(new Set())}
          currency={currency}
          density={density}
          notice={notice}
          estTooltip={estTooltip}
          footerCoverage={footerCoverage}
          footerRight={footerRight}
        />
      )}
    </div>
  );
}
