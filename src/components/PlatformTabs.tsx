import type { Platform } from "../lib/types";

export interface PlatformTab {
  key: Platform;
  label: string;
  spend: string;
  active: boolean;
}

interface Props {
  tabs: PlatformTab[];
  onSelect: (p: Platform) => void;
}

/** Hand authored platform logo glyphs, ~16px, no external assets. */
function PlatformLogo({ platform }: { platform: Platform }) {
  if (platform === "meta") {
    // Meta infinity mark, brand blue
    return (
      <svg width="18" height="12" viewBox="0 0 24 16" fill="none" aria-hidden="true">
        <path
          d="M12 8 C10.4 4 9 3 6.8 3 A5 5 0 0 0 6.8 13 C9 13 10.4 12 12 8 C13.6 4 15 3 17.2 3 A5 5 0 0 1 17.2 13 C15 13 13.6 12 12 8 Z"
          stroke="#0064E0"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (platform === "tiktok") {
    // TikTok note mark, monochrome
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#1C2B33"
          d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"
        />
      </svg>
    );
  }
  // Google G mark, brand colors
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"
      />
    </svg>
  );
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
          className={t.active ? undefined : "tab-hover"}
          onClick={() => onSelect(t.key)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 16px 13px",
            cursor: "pointer",
            background: t.active ? "#EBF3FE" : "transparent",
            borderRadius: "9px 9px 0 0",
            borderBottom: `2px solid ${t.active ? "#0064E0" : "transparent"}`,
            marginBottom: -1,
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 18,
              height: 16,
              opacity: t.active ? 1 : 0.5,
            }}
          >
            <PlatformLogo platform={t.key} />
          </span>
          <span
            style={{
              fontSize: 14,
              fontWeight: t.active ? 700 : 600,
              color: t.active ? "#1C2B33" : "#8A8D91",
            }}
          >
            {t.label}
          </span>
          <span
            style={{
              fontSize: 12,
              color: t.active ? "#5A5F66" : "#8A8D91",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {t.spend}
          </span>
        </div>
      ))}
    </div>
  );
}
