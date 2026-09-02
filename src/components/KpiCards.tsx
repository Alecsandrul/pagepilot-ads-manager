export interface Kpi {
  label: string;
  value: string;
  delta: string;
  deltaColor: string;
  hint?: string;
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
            style={{
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
            }}
          >
            {k.value}
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
