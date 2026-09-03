import { useState, type FormEvent } from "react";
import { publicAuthError } from "../lib/authPolicy";
import { supabase } from "../lib/supabase";
import { AuthCard, ErrorNote, Field, linkStyle, primaryButton } from "./authUi";

/**
 * Sign in.
 *
 * THE ERROR TEXT IS OURS, NOT THE SERVER'S (Alex, 2026-09-03: nothing about
 * the password work may weaken the login). Supabase answers "Invalid login
 * credentials" for a wrong password and for an address with no account
 * alike, which is the behaviour we want, but it is not the only message it
 * can return: "Email not confirmed" tells an anonymous caller that the
 * address IS registered. Forwarding `err.message` to the screen makes this
 * form an account oracle the day Supabase adds another message like that.
 * `publicAuthError` collapses everything except rate limiting and network
 * failure into one fixed sentence.
 */
export default function Login({ onForgot }: { onForgot: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) setError(publicAuthError(err.message));
    setBusy(false);
  }

  return (
    <AuthCard title="Ads Reporting" subtitle="All platforms, one report" onSubmit={submit}>
      <Field
        label="Email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Field
        label="Password"
        type="password"
        required
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && <ErrorNote>{error}</ErrorNote>}
      <button
        className="btn-primary"
        type="submit"
        disabled={busy}
        style={{ ...primaryButton, opacity: busy ? 0.7 : 1 }}
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
      <button type="button" onClick={onForgot} style={linkStyle}>
        Forgot your password?
      </button>
      <div style={{ fontSize: 11.5, color: "#8A8D91" }}>
        Internal tool. Accounts are created by an administrator.
      </div>
    </AuthCard>
  );
}
