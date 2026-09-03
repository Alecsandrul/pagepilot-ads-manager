import type * as React from "react";

/**
 * Shared chrome for the auth screens (sign in, forgot password, reset
 * password) and the change password dialog. Extracted so the four of them
 * cannot drift apart: they are the only screens an unauthenticated visitor
 * ever sees, and four hand rolled cards is four chances for one to look
 * broken.
 */

export const inputStyle: React.CSSProperties = {
  height: 38,
  padding: "0 12px",
  border: "1px solid #CFD2D7",
  borderRadius: 8,
  fontSize: 14,
  color: "#1C2B33",
  width: "100%",
};

export const primaryButton: React.CSSProperties = {
  height: 38,
  border: "none",
  borderRadius: 8,
  background: "#0064E0",
  color: "#fff",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

export const linkStyle: React.CSSProperties = {
  fontSize: 12.5,
  color: "#0064E0",
  cursor: "pointer",
  background: "none",
  border: "none",
  padding: 0,
  textAlign: "left",
  fontFamily: "inherit",
};

export function Field({
  label,
  ...input
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: "#5A5F66" }}>{label}</span>
      <input className="search-input" style={inputStyle} {...input} />
    </label>
  );
}

/** Red failure text. `role="alert"` so a screen reader announces it. */
export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" style={{ fontSize: 12.5, color: "#C0392B", lineHeight: 1.45 }}>
      {children}
    </div>
  );
}

/** Green success panel, the counterpart to ErrorNote. */
export function SuccessNote({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="status"
      style={{
        fontSize: 12.5,
        color: "#1E7B4D",
        background: "#E4F3EA",
        border: "1px solid #C6E6D4",
        borderRadius: 8,
        padding: "9px 11px",
        lineHeight: 1.45,
      }}
    >
      {children}
    </div>
  );
}

/** The centred card every full page auth screen sits in. */
export function AuthCard({
  title,
  subtitle,
  onSubmit,
  children,
}: {
  title: string;
  subtitle: string;
  onSubmit?: (e: React.FormEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#F4F5F7",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          width: 360,
          background: "#fff",
          border: "1px solid #DFE1E6",
          borderRadius: 12,
          boxShadow: "0 1px 2px rgba(28,43,51,0.05)",
          padding: "28px 26px 26px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em" }}>{title}</div>
          <div style={{ fontSize: 13, color: "#65676B", marginTop: 3 }}>{subtitle}</div>
        </div>
        {children}
      </form>
    </div>
  );
}

/**
 * Live checklist plus strength bar for a new password. Shown only once the
 * user has typed something, so an untouched form is not already scolding
 * them in red.
 */
export function PasswordRules({
  rules,
  bar,
  show,
}: {
  rules: { label: string; ok: boolean }[];
  bar: { score: number; label: string; color: string };
  show: boolean;
}) {
  if (!show) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ display: "flex", gap: 3, flex: 1 }}>
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              style={{
                height: 4,
                flex: 1,
                borderRadius: 2,
                background: bar.score >= i ? bar.color : "#E4E6EB",
              }}
            />
          ))}
        </div>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: bar.color, minWidth: 62 }}>
          {bar.label}
        </span>
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 3 }}>
        {rules.map((r) => (
          <li
            key={r.label}
            style={{
              fontSize: 11.5,
              color: r.ok ? "#1E7B4D" : "#8A8D91",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span style={{ width: 11, display: "inline-block" }}>{r.ok ? "✓" : "○"}</span>
            {r.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
