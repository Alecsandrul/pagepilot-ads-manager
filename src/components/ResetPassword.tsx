import { useEffect, useRef, useState, type FormEvent } from "react";
import { checkPassword, privateAuthError, strength } from "../lib/authPolicy";
import { clearAuthParams } from "../lib/routes";
import { ARRIVAL_URL, supabase } from "../lib/supabase";
import {
  AuthCard,
  ErrorNote,
  Field,
  linkStyle,
  PasswordRules,
  primaryButton,
  SuccessNote,
} from "./authUi";

/**
 * The landing page a password recovery link opens.
 *
 * WITHOUT THIS ROUTE THE WHOLE FEATURE IS DEAD (the reason it exists, Alex
 * 2026-09-03): the app had only a login screen, so a Supabase recovery mail
 * pointed at a path that did not render anything.
 *
 * Three arrival shapes have to be told apart, and the third is the one that
 * usually ships broken:
 *
 *   implicit  #access_token=...&refresh_token=...&type=recovery
 *   pkce      ?code=...
 *   FAILURE   #error=access_denied&error_code=otp_expired&error_description=...
 *
 * The failure shape is what an expired or already used link looks like, and
 * it carries no tokens at all. A screen that only checks for tokens renders
 * nothing for it, which is the blank page this was asked to avoid. It is
 * handled first, by name.
 *
 * Everything is read from ARRIVAL_URL, the snapshot taken before
 * `createClient` ran. Reading `window.location` here would be a race with
 * auth-js's own `detectSessionInUrl`, which strips the fragment as it
 * consumes it, and the loser of that race sees a clean URL and concludes the
 * link was invalid.
 */

type Status =
  | { kind: "checking" }
  | { kind: "ready" }
  | { kind: "invalid"; message: string }
  | { kind: "done" };

/** Turn GoTrue's error codes into a sentence that says what to do next. */
function explainLinkError(code: string, description: string): string {
  const c = code.toLowerCase();
  const d = description.replace(/\+/g, " ");
  if (c.includes("otp_expired") || d.toLowerCase().includes("expired")) {
    return "This reset link has expired. Links are good for one hour and can be used once. Request a new one.";
  }
  if (c.includes("access_denied")) {
    return "This reset link is no longer valid. It may already have been used. Request a new one.";
  }
  return d
    ? `This reset link could not be used: ${d}. Request a new one.`
    : "This reset link could not be used. Request a new one.";
}

export default function ResetPassword({ onDone, onRequestNew }: { onDone: () => void; onRequestNew: () => void }) {
  const [status, setStatus] = useState<Status>({ kind: "checking" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // StrictMode mounts effects twice in dev; consuming a one time code twice
  // would fail the second time and report a good link as broken.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    (async () => {
      const hash = new URLSearchParams(ARRIVAL_URL.hash);
      const query = new URLSearchParams(ARRIVAL_URL.search);

      // 1. An explicit failure, in either place. Named first because it
      //    carries no tokens and every token first implementation renders a
      //    blank page for it.
      const errCode = hash.get("error_code") ?? query.get("error_code") ?? "";
      const errName = hash.get("error") ?? query.get("error") ?? "";
      if (errCode || errName) {
        clearAuthParams();
        setStatus({
          kind: "invalid",
          message: explainLinkError(
            errCode || errName,
            hash.get("error_description") ?? query.get("error_description") ?? ""
          ),
        });
        return;
      }

      // 2. Implicit flow: adopt the tokens ourselves rather than waiting to
      //    see whether detectSessionInUrl got there first. setSession with
      //    tokens already adopted is a no op, so doing both is safe and the
      //    outcome no longer depends on which one won.
      const access_token = hash.get("access_token");
      const refresh_token = hash.get("refresh_token");
      if (access_token && refresh_token) {
        const { error: err } = await supabase.auth.setSession({ access_token, refresh_token });
        clearAuthParams();
        setStatus(
          err
            ? { kind: "invalid", message: explainLinkError("", err.message) }
            : { kind: "ready" }
        );
        return;
      }

      // 3. PKCE flow. The client is on `implicit` (see supabase.ts), so this
      //    normally cannot happen and auth-js would reject the mismatch. It
      //    is handled anyway: a link generated elsewhere, or a later switch
      //    of flowType, must produce a sentence rather than a blank page.
      const code = query.get("code");
      if (code) {
        const { error: err } = await supabase.auth.exchangeCodeForSession(code);
        clearAuthParams();
        if (!err) {
          setStatus({ kind: "ready" });
          return;
        }
        const m = err.message.toLowerCase();
        setStatus({
          kind: "invalid",
          message:
            m.includes("code verifier") || m.includes("not a valid")
              ? "This reset link has to be opened in the same browser that requested it. Open it there, or request a new link from this browser."
              : explainLinkError("", err.message),
        });
        return;
      }

      // 4. No callback in the URL. Either auth-js consumed it before the
      //    snapshot (should not happen, but a session is proof enough) or
      //    somebody typed the path. A live session is sufficient authority
      //    to set a password, so let those through.
      const { data } = await supabase.auth.getSession();
      setStatus(
        data.session
          ? { kind: "ready" }
          : {
              kind: "invalid",
              message:
                "This page needs a valid reset link. Open the most recent link from your email, or request a new one.",
            }
      );
    })().catch((e: unknown) => {
      setStatus({
        kind: "invalid",
        message: `This reset link could not be read: ${
          e instanceof Error ? e.message : String(e)
        }. Request a new one.`,
      });
    });
  }, []);

  // Backstop: auth-js emits PASSWORD_RECOVERY when it consumes a recovery
  // callback itself. If that happens while we are still deciding, take it as
  // proof the link was good.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setStatus((s) => (s.kind === "checking" ? { kind: "ready" } : s));
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const check = checkPassword(password);
  const matches = password.length > 0 && password === confirm;
  const canSubmit = check.ok && matches && !busy;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) {
      setError(privateAuthError(err.message));
      return;
    }
    setPassword("");
    setConfirm("");
    setStatus({ kind: "done" });
  }

  if (status.kind === "checking") {
    return (
      <AuthCard title="Reset your password" subtitle="Checking your link">
        <div style={{ fontSize: 13, color: "#65676B" }}>One moment…</div>
      </AuthCard>
    );
  }

  if (status.kind === "invalid") {
    return (
      <AuthCard title="Reset link problem" subtitle="Password reset">
        <ErrorNote>{status.message}</ErrorNote>
        <button type="button" className="btn-primary" onClick={onRequestNew} style={primaryButton}>
          Request a new link
        </button>
        <button type="button" onClick={onDone} style={linkStyle}>
          Back to sign in
        </button>
      </AuthCard>
    );
  }

  if (status.kind === "done") {
    return (
      <AuthCard title="Password updated" subtitle="You are signed in">
        <SuccessNote>
          Your new password is saved. Use it the next time you sign in.
        </SuccessNote>
        <button type="button" className="btn-primary" onClick={onDone} style={primaryButton}>
          Go to the dashboard
        </button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password" subtitle="Password reset" onSubmit={submit}>
      <Field
        label="New password"
        type="password"
        required
        autoComplete="new-password"
        autoFocus
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <PasswordRules rules={check.rules} bar={strength(password)} show={password.length > 0} />
      <Field
        label="Confirm new password"
        type="password"
        required
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
      />
      {confirm.length > 0 && !matches && <ErrorNote>The two passwords do not match.</ErrorNote>}
      {error && <ErrorNote>{error}</ErrorNote>}
      <button
        type="submit"
        className="btn-primary"
        disabled={!canSubmit}
        style={{ ...primaryButton, opacity: canSubmit ? 1 : 0.55, cursor: canSubmit ? "pointer" : "not-allowed" }}
      >
        {busy ? "Saving…" : "Save new password"}
      </button>
    </AuthCard>
  );
}
