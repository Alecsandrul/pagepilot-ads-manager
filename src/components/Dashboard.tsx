import { useCallback, useEffect, useMemo, useState } from "react";
import type * as React from "react";
import { buildTree, metric, sumMetrics, type PlatformTree } from "../lib/aggregate";
import { toCsv, downloadCsv } from "../lib/csv";
import { fetchAdRows, fetchSyncStatus, type SyncStatus } from "../lib/data";
import { DEFAULT_RANGE, previousRange, relativeTime } from "../lib/dates";
import { fmtCell } from "../lib/display";
import { dec, EMPTY, MINUS, money, num, pct } from "../lib/format";
import { fetchTiktokValue, saveTiktokValue, TIKTOK_VALUE_DEFAULT } from "../lib/settings";
import { supabase } from "../lib/supabase";
import {
  COLUMNS,
  PLATFORMS,
  PLATFORM_META,
  type AdRow,
  type Currency,
  type DateRange,
  type Density,
  type Entity,
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
    fetchSyncStatus()
      .then(setSync)
      .catch(() => setSync(null));
    fetchTiktokValue()
      .then((v) => {
        setTiktokValue(v);
        setTiktokDraft(String(v));
      })
      .catch(() => {
        // Table missing or unreachable: the default stands.
      });
  }, []);

  // Trees for the current and previous period, per platform
  const trees = useMemo(() => {
    const cur: Partial<Record<Platform, PlatformTree>> = {};
    const before: Partial<Record<Platform, PlatformTree>> = {};
    const opts = { tiktokValuePerResult: tiktokValue };
    for (const p of PLATFORMS) {
      const platformRows = (rows ?? []).filter((r) => r.platform === p);
      cur[p] = buildTree(p, platformRows.filter((r) => r.date >= range.from), opts);
      before[p] = buildTree(p, platformRows.filter((r) => r.date < range.from), opts);
    }
    return { cur: cur as Record<Platform, PlatformTree>, before: before as Record<Platform, PlatformTree> };
  }, [rows, range.from, tiktokValue]);

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

  // Items at the current level, before search and sort
  const { baseItems, notice } = useMemo((): { baseItems: Entity[]; notice: string | null } => {
    if (isGoogle && level > 0) {
      return {
        baseItems: tree.campaigns,
        notice: "Google reports at campaign level, so its campaigns are shown rolled up here.",
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
        note = "This Smart+ campaign reports at campaign level only, so there are no rows at this level.";
      } else if (!parent) {
        const n = tree.campaignGrainOnly.size;
        note =
          n === 1
            ? "1 Smart+ campaign reports at campaign level and appears under Campaigns only."
            : `${n} Smart+ campaigns report at campaign level and appear under Campaigns only.`;
      }
    }
    return { baseItems: items, notice: note };
  }, [tree, level, parent, isGoogle, platform]);

  const items = useMemo(() => {
    let out = baseItems;
    const needle = q.trim().toLowerCase();
    if (needle) out = out.filter((e) => `${e.name} ${e.sub}`.toLowerCase().includes(needle));
    const dir = sort.dir === "asc" ? 1 : -1;
    const value = (e: Entity) =>
      sort.key === "status" ? (isActive(e) ? 1 : 0) : sort.key === "budget" ? 0 : metric(e.m, sort.key);
    return [...out].sort((a, b) => (value(a) - value(b)) * dir || b.m.spend - a.m.spend);
  }, [baseItems, q, sort, isActive]);

  const totals = useMemo(() => sumMetrics(items.map((i) => i.m)), [items]);

  const visibleCols = useMemo(() => COLUMNS.filter((c) => !hiddenCols.has(c.k)), [hiddenCols]);

  const counts: [number, number, number] = isGoogle
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
      const hint = isGoogle
        ? d.k === "conv" || d.k === "roas"
          ? "pooled conversions, not purchases"
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
      };
    });
  }, [tree, prevTree, currency, isGoogle, tiktokValue]);

  const tabs: PlatformTab[] = PLATFORMS.map((p) => ({
    key: p,
    label: PLATFORM_META[p].label,
    dot: PLATFORM_META[p].dot,
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
      {/* Sync problem banner: schema rule, never render a silent zero */}
      {sync && sync.problems.length > 0 && (
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
          {`Data may be incomplete. ${sync.problems.join(" · ")}`}
        </div>
      )}

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
          pooledPlatform={isGoogle}
          estTooltip={estTooltip}
          footerRight={footerRight}
        />
      )}
    </div>
  );
}
