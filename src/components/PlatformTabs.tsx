import type { Platform } from "../lib/types";

export interface PlatformTab {
  key: Platform;
  label: string;
  dot: string;
  spend: string;
  active: boolean;
}

interface Props {
  tabs: PlatformTab[];
  onSelect: (p: Platform) => void;
}

export default function PlatformTabs({ tabs, onSelect }: Props) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: 4,
        padding: "0 20px",
        background: "#FFFFFF",
        borderBottom: "1px solid #DFE1E6",
      }}
    >
      {tabs.map((t) => (
        <div
          key={t.key}
          className="tab-hover"
          onClick={() => onSelect(t.key)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 16px 13px",
            cursor: "pointer",
            borderBottom: `2px solid ${t.active ? "#0064E0" : "transparent"}`,
            marginBottom: -1,
          }}
        >
          <span style={{ width: 9, height: 9, borderRadius: 2, background: t.dot }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: t.active ? "#1C2B33" : "#65676B" }}>
            {t.label}
          </span>
          <span style={{ fontSize: 12, color: "#8A8D91", fontVariantNumeric: "tabular-nums" }}>
            {t.spend}
          </span>
        </div>
      ))}
    </div>
  );
}
