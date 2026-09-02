import { metric } from "../lib/aggregate";
import { fmtCell } from "../lib/display";
import { EMPTY } from "../lib/format";
import type {
  ColumnDef,
  Currency,
  Density,
  Entity,
  Level,
  MetricKey,
  Metrics,
} from "../lib/types";

export interface ParentRef {
  id: string;
  name: string;
  level: Level;
}

export interface SortState {
  key: MetricKey;
  dir: "asc" | "desc";
}

interface Props {
  terms: [string, string, string];
  counts: [number, number, number];
  items: Entity[];
  totalCount: number;
  totals: Metrics;
  columns: ColumnDef[];
  level: Level;
  onLevel: (l: Level) => void;
  parent: ParentRef | null;
  onClearParent: () => void;
  onDrill: (e: Entity) => void;
  drillable: (e: Entity) => boolean;
  isActive: (e: Entity) => boolean;
  sort: SortState;
  onSort: (k: MetricKey) => void;
  q: string;
  onSearch: (s: string) => void;
  sel: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onClearSel: () => void;
  currency: Currency;
  density: Density;
  notice: string | null;
  /** True on the google tab: Results values are pooled conversions. */
  pooledPlatform: boolean;
  /** Tooltip for estimated Conversion value / ROAS cells (tiktok assumed value). */
  estTooltip: string;
  footerRight: string;
}

function Checkbox({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <span
      onClick={onClick}
      style={{
        flex: "0 0 15px",
        width: 15,
        height: 15,
        border: `1.5px solid ${on ? "#0064E0" : "#C4C9CE"}`,
        background: on ? "#0064E0" : "transparent",
        borderRadius: 4,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        fontSize: 10,
        lineHeight: 1,
      }}
    >
      {on ? "✓" : ""}
    </span>
  );
}

export default function AdsTable(props: Props) {
  const {
    terms,
    counts,
    items,
    totalCount,
    totals,
    columns,
    level,
    onLevel,
    parent,
    onClearParent,
    onDrill,
    drillable,
    isActive,
    sort,
    onSort,
    q,
    onSearch,
    sel,
    onToggle,
    onToggleAll,
    onClearSel,
    currency,
    density,
    notice,
    pooledPlatform,
    estTooltip,
    footerRight,
  } = props;

  const rowH = density === "compact" ? 48 : 62;
  const tableWidth = 340 + columns.reduce((a, c) => a + c.w, 0);
  const allOn = items.length > 0 && items.every((i) => sel.has(i.id));
  const selCount = sel.size;

  function cellFor(e: Entity, c: ColumnDef) {
    if (c.k === "status") {
      const active = isActive(e);
      return (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "3px 9px",
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            color: active ? "#1E7B4D" : "#65676B",
            background: active ? "#E4F3EA" : "#F0F2F5",
            whiteSpace: "nowrap",
          }}
        >
          {active ? "Delivering" : "No delivery"}
        </span>
      );
    }
    const v = fmtCell(e.m, c.k, currency);
    const isEst = (c.k === "revenue" || c.k === "roas") && e.m.valueIsEstimated && v !== EMPTY;
    let color = "#1C2B33";
    if (v === EMPTY) color = "#B0B3B8";
    else if (isEst) color = "#65676B";
    else if (c.k === "roas" && e.m.purchaseValue != null) {
      const r = metric(e.m, "roas");
      color = r >= 2 ? "#1E7B4D" : r < 1.2 ? "#C0392B" : "#1C2B33";
    }
    return (
      <span
        title={
          isEst
            ? estTooltip
            : pooledPlatform && (c.k === "conv" || c.k === "cpa") && v !== EMPTY
              ? "Pooled conversions, not purchases"
              : undefined
        }
        style={{
          fontSize: 13,
          fontVariantNumeric: "tabular-nums",
          color,
          whiteSpace: "nowrap",
        }}
      >
        {v}
        {isEst && <span style={{ fontSize: 10.5, color: "#8A8D91", marginLeft: 5 }}>est</span>}
        {pooledPlatform && c.k === "conv" && v !== EMPTY && (
          <span style={{ fontSize: 10.5, color: "#8A8D91", marginLeft: 5 }}>pooled</span>
        )}
      </span>
    );
  }

  return (
    <div style={{ padding: "18px 20px 28px", flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div
        style={{
          background: "#fff",
          border: "1px solid #DFE1E6",
          borderRadius: 12,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          boxShadow: "0 1px 2px rgba(28,43,51,0.05)",
        }}
      >
        {/* Toolbar: level chips, parent chip, search */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            padding: "10px 14px",
            borderBottom: "1px solid #EBEDF0",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#F0F2F5", padding: 3, borderRadius: 9 }}>
            {terms.map((label, i) => {
              const on = i === level;
              return (
                <div
                  key={label}
                  onClick={() => onLevel(i as Level)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    padding: "7px 13px",
                    borderRadius: 7,
                    cursor: "pointer",
                    background: on ? "#FFFFFF" : "transparent",
                    boxShadow: on ? "0 1px 2px rgba(28,43,51,0.14)" : "none",
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: on ? "#1C2B33" : "#65676B" }}>
                    {label}
                  </span>
                  <span style={{ fontSize: 11.5, color: "#8A8D91", fontVariantNumeric: "tabular-nums" }}>
                    {counts[i]}
                  </span>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {parent && level > 0 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  height: 32,
                  padding: "0 6px 0 11px",
                  border: "1px solid #BBD6F7",
                  background: "#EBF3FE",
                  borderRadius: 8,
                  fontSize: 12.5,
                  fontWeight: 500,
                  color: "#0055BE",
                }}
              >
                <span style={{ maxWidth: 280, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {parent.name}
                </span>
                <span
                  className="chip-x"
                  onClick={onClearParent}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 20,
                    height: 20,
                    borderRadius: 5,
                    cursor: "pointer",
                    color: "#0064E0",
                    fontSize: 14,
                  }}
                >
                  ×
                </span>
              </div>
            )}
            <input
              className="search-input"
              value={q}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Search by name…"
              style={{
                height: 32,
                width: 230,
                padding: "0 11px",
                border: "1px solid #CFD2D7",
                borderRadius: 8,
                fontSize: 13,
                color: "#1C2B33",
              }}
            />
          </div>
        </div>

        {/* Grain notice */}
        {notice && (
          <div
            style={{
              padding: "8px 16px",
              background: "#EBF3FE",
              color: "#0055BE",
              fontSize: 12.5,
              borderBottom: "1px solid #DCEAFD",
            }}
          >
            {notice}
          </div>
        )}

        {/* Selection bar (actions are visual placeholders for now) */}
        {selCount > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              padding: "9px 16px",
              background: "#1C2B33",
              color: "#fff",
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              {selCount === 1 ? "1 row selected" : `${selCount} rows selected`}
            </span>
            <span title="Not available yet" style={{ fontSize: 13, color: "#A7ADB2", cursor: "not-allowed" }}>
              Edit budget
            </span>
            <span title="Not available yet" style={{ fontSize: 13, color: "#A7ADB2", cursor: "not-allowed" }}>
              Duplicate
            </span>
            <span title="Not available yet" style={{ fontSize: 13, color: "#A7ADB2", cursor: "not-allowed" }}>
              Turn off
            </span>
            <span
              className="link-white"
              onClick={onClearSel}
              style={{ marginLeft: "auto", fontSize: 13, fontWeight: 500, cursor: "pointer", color: "#fff" }}
            >
              Deselect all
            </span>
          </div>
        )}

        {/* Table */}
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <div style={{ minWidth: tableWidth }}>
            {/* Header */}
            <div
              style={{
                display: "flex",
                position: "sticky",
                top: 0,
                zIndex: 3,
                background: "#FAFBFC",
                borderBottom: "1px solid #DFE1E6",
              }}
            >
              <div
                style={{
                  position: "sticky",
                  left: 0,
                  zIndex: 2,
                  width: 340,
                  flex: "0 0 340px",
                  background: "#FAFBFC",
                  borderRight: "1px solid #EBEDF0",
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  padding: "0 14px",
                  height: 42,
                }}
              >
                <Checkbox on={allOn} onClick={onToggleAll} />
                <span style={{ fontSize: 12, fontWeight: 600, color: "#5A5F66" }}>{terms[level]}</span>
              </div>
              {columns.map((c) => (
                <div
                  key={c.k}
                  className="col-head"
                  title={c.tip}
                  onClick={() => onSort(c.k)}
                  style={{
                    flex: `0 0 ${c.w}px`,
                    width: c.w,
                    height: 42,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: c.a,
                    gap: 5,
                    padding: "0 14px",
                    cursor: "pointer",
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: sort.key === c.k ? "#1C2B33" : "#5A5F66",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {c.l}
                  </span>
                  <span style={{ fontSize: 10, color: "#0064E0" }}>
                    {sort.key === c.k ? (sort.dir === "asc" ? "▲" : "▼") : ""}
                  </span>
                </div>
              ))}
            </div>

            {/* Totals row */}
            <div style={{ display: "flex", borderBottom: "1px solid #DFE1E6", background: "#FFFFFF" }}>
              <div
                style={{
                  position: "sticky",
                  left: 0,
                  zIndex: 2,
                  width: 340,
                  flex: "0 0 340px",
                  background: "#FFFFFF",
                  borderRight: "1px solid #EBEDF0",
                  display: "flex",
                  alignItems: "center",
                  padding: "0 14px 0 40px",
                  height: 44,
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                {`Total · ${items.length} ${terms[level].toLowerCase()}`}
              </div>
              {columns.map((c) => {
                const v = c.k === "status" || c.k === "budget" ? "" : fmtCell(totals, c.k, currency);
                const isEst =
                  (c.k === "revenue" || c.k === "roas") &&
                  totals.valueIsEstimated &&
                  v !== "" &&
                  v !== EMPTY;
                return (
                  <div
                    key={c.k}
                    title={isEst ? estTooltip : undefined}
                    style={{
                      flex: `0 0 ${c.w}px`,
                      width: c.w,
                      height: 44,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: c.a,
                      padding: "0 14px",
                      fontSize: 13,
                      fontWeight: 600,
                      fontVariantNumeric: "tabular-nums",
                      color: isEst ? "#65676B" : "#1C2B33",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {v}
                    {isEst && (
                      <span style={{ fontSize: 10.5, color: "#8A8D91", marginLeft: 5, fontWeight: 400 }}>
                        est
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Rows */}
            {items.map((e) => {
              const on = sel.has(e.id);
              const canDrill = drillable(e);
              const active = isActive(e);
              return (
                <div
                  key={e.id}
                  className={`trow${on ? " sel" : ""}`}
                  style={{ display: "flex", borderBottom: "1px solid #F0F2F5" }}
                >
                  <div
                    className="name-cell"
                    style={{
                      position: "sticky",
                      left: 0,
                      zIndex: 2,
                      width: 340,
                      flex: "0 0 340px",
                      borderRight: "1px solid #EBEDF0",
                      display: "flex",
                      alignItems: "center",
                      gap: 11,
                      padding: "0 14px",
                      height: rowH,
                    }}
                  >
                    <Checkbox on={on} onClick={() => onToggle(e.id)} />
                    <span
                      style={{
                        flex: "0 0 7px",
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: active ? "#31A24C" : "#C4C9CE",
                      }}
                    />
                    <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                      <span
                        className={canDrill ? "name-drill" : undefined}
                        onClick={() => canDrill && onDrill(e)}
                        style={{
                          fontSize: 13.5,
                          fontWeight: 600,
                          color: canDrill ? "#0064E0" : "#1C2B33",
                          cursor: canDrill ? "pointer" : "default",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {e.name}
                      </span>
                      <span
                        style={{
                          fontSize: 11.5,
                          color: "#8A8D91",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {e.sub}
                      </span>
                    </span>
                  </div>
                  {columns.map((c) => (
                    <div
                      key={c.k}
                      style={{
                        flex: `0 0 ${c.w}px`,
                        width: c.w,
                        height: rowH,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: c.a,
                        padding: "0 14px",
                      }}
                    >
                      {cellFor(e, c)}
                    </div>
                  ))}
                </div>
              );
            })}

            {items.length === 0 && (
              <div style={{ padding: "56px 20px", textAlign: "center", color: "#8A8D91", fontSize: 13.5 }}>
                No rows match your filters.
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "11px 16px",
            borderTop: "1px solid #EBEDF0",
            background: "#FAFBFC",
            fontSize: 12.5,
            color: "#65676B",
          }}
        >
          <span>{`${items.length} of ${totalCount} rows · ${currency}`}</span>
          <span>{footerRight}</span>
        </div>
      </div>
    </div>
  );
}
