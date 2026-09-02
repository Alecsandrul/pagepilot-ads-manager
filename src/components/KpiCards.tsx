export interface Kpi {
  label: string;
  value: string;
  delta: string;
  deltaColor: string;
  hint?: string;
  /** Small marker after the value, e.g. "est" for estimated figures. */
  suffix?: string;
  /** Tooltip on the value, e.g. how an estimate is derived. */
  title?: string;
  /** Color for the value, e.g. the ROAS verdict green/red. */
  valueColor?: string;
}

export default function KpiCards({ kpis }: { kpis: Kpi[] }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
        background: "#FFFFFF",
        borderBottom: "1px solid #DFE1E6",
      }}
    >
      {kpis.map((k) => (
        <div
          key={k.label}
          style={{
            background: "#fff",
            padding: "16px 20px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 7,
            boxShadow: "1px 1px 0 #DFE1E6",
          }}
        >
          <div
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: "#8A8D91",
            }}
          >
            {k.label}
          </div>
          <div
            title={k.title}
            style={{
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
              color: k.valueColor,
            }}
          >
            {k.value}
            {k.suffix && (
              <span style={{ fontSize: 12, fontWeight: 600, color: "#8A8D91", marginLeft: 6 }}>
                {k.suffix}
              </span>
            )}
          </div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: k.deltaColor,
              whiteSpace: "nowrap",
            }}
          >
            {k.delta}
          </div>
          {k.hint && (
            <div style={{ fontSize: 11, color: "#8A8D91", marginTop: -3 }}>{k.hint}</div>
          )}
        </div>
      ))}
    </div>
  );
}
