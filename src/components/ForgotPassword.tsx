import { useState, type FormEvent } from "react";
import { publicAuthError } from "../lib/authPolicy";
import { PATHS } from "../lib/routes";
import { supabase } from "../lib/supabase";
import { AuthCard, ErrorNote, Field, linkStyle, primaryButton, SuccessNote } from "./authUi";

/**
 * "Send me a reset link".
 *
 * NO ENUMERATION, and it is the whole design of this screen: the confirmation
 * is IDENTICAL whether or not the address has an account, and it is shown
 * even when `resetPasswordForEmail` returns an error. Supabase already
 * answers success for an unknown address, but relying on that alone would
 * mean any future change of theirs quietly turns this form into an account
 * oracle. The only failure allowed through is rate limiting, which is scoped
 * per IP as well as per address and so proves nothing about any account.
 *
 * The confirmation deliberately does NOT echo the address back. "We sent a
 * link to alex@..." shown to whoever typed it is a small leak of its own on a
 * shared screen, and it is not needed: the person typed it a second ago.
 */
export default function ForgotPassword({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // Absolute URL of OUR reset route. Supabase rejects a redirectTo that is
    // not in the project's allow list and silently falls back to Site URL,
    // which is how a reset link ends up pointing at localhost in production.
    // The README lists the two dashboard entries this needs.
    const redirectTo = `${window.location.origin}${PATHS.reset}`;
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
    setBusy(false);
    if (err) {
      const msg = publicAuthError(err.message);
      // Anything that is not a rate limit is swallowed on purpose: reporting
      // it would separate "address exists" from "address does not".
      if (msg.startsWith("Too many") || msg.startsWith("Could not reach")) {
        setError(msg);
        return;
      }
    }
    setSent(true);
  }

  if (sent) {
    return (
      <AuthCard title="Check your email" subtitle="Password reset">
        <SuccessNote>
          If that address has an account, a reset link is on its way. The link is good for one
          hour and can be used once.
        </SuccessNote>
        <div style={{ fontSize: 11.5, color: "#8A8D91", lineHeight: 1.5 }}>
          Nothing after a few minutes? Check spam, then try again. Sending is rate limited, so
          asking repeatedly makes it slower, not faster.
        </div>
        <button type="button" onClick={onBack} style={linkStyle}>
          Back to sign in
        </button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Reset your password" subtitle="We will email you a link" onSubmit={submit}>
      <Field
        label="Email"
        type="email"
        required
        autoComplete="email"
        autoFocus
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      {error && <ErrorNote>{error}</ErrorNote>}
      <button type="submit" className="btn-primary" disabled={busy} style={{ ...primaryButton, opacity: busy ? 0.7 : 1 }}>
        {busy ? "Sending…" : "Send reset link"}
      </button>
      <button type="button" onClick={onBack} style={linkStyle}>
        Back to sign in
      </button>
    </AuthCard>
  );
}
