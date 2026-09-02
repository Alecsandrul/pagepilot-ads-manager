import { useState, type FormEvent } from "react";
import type * as React from "react";
import { supabase } from "../lib/supabase";

const inputStyle: React.CSSProperties = {
  height: 38,
  padding: "0 12px",
  border: "1px solid #CFD2D7",
  borderRadius: 8,
  fontSize: 14,
  color: "#1C2B33",
  width: "100%",
};

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) setError(err.message);
    setBusy(false);
  }

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
        onSubmit={submit}
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
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em" }}>
            Ads Reporting
          </div>
          <div style={{ fontSize: 13, color: "#65676B", marginTop: 3 }}>
            All platforms, one report
          </div>
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "#5A5F66" }}>Email</span>
          <input
            className="search-input"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "#5A5F66" }}>Password</span>
          <input
            className="search-input"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
          />
        </label>
        {error && (
          <div style={{ fontSize: 12.5, color: "#C0392B" }}>{error}</div>
        )}
        <button
          className="btn-primary"
          type="submit"
          disabled={busy}
          style={{
            height: 38,
            border: "none",
            borderRadius: 8,
            background: "#0064E0",
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <div style={{ fontSize: 11.5, color: "#8A8D91" }}>
          Internal tool. Accounts are created by an administrator.
        </div>
      </form>
    </div>
  );
}
