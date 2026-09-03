import { useEffect, useState, type FormEvent } from "react";
import type * as React from "react";
import { checkPassword, privateAuthError, strength } from "../lib/authPolicy";
import { supabase } from "../lib/supabase";
import { ErrorNote, Field, PasswordRules, primaryButton, SuccessNote } from "./authUi";

/**
 * Change password for the signed in user.
 *
 * WHY THE CURRENT PASSWORD IS CHECKED BY SIGNING IN AGAIN.
 * `updateUser({ password })` alone does NOT ask for the old one: this project
 * has `security_update_password_require_reauthentication = false` (read from
 * the live auth config, 2026-09-03), so anyone who reaches an unlocked
 * browser could set a new password without knowing the current one. The check
 * therefore happens here: `signInWithPassword` with the SAME account and the
 * typed current password, and the update only runs if that succeeds.
 *
 * That is safe against the obvious objection, which was verified in
 * auth-js 2.113.0 rather than assumed: a FAILED `signInWithPassword` returns
 * `{ data: { user: null, session: null }, error }` and never calls
 * `_removeSession`, so a typo cannot sign the user out of the dashboard they
 * are standing in. A SUCCESSFUL one replaces the session with a fresh one for
 * the same user, which is harmless.
 *
 * Rendered as a dialog over the dashboard rather than as its own route, so
 * changing a password does not unmount the table and re fetch a 30 day range
 * on the way back.
 */
export default function ChangePassword({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState<string | null>(null);
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? null));
  }, []);

  // Escape closes, like the other overlays in this app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const check = checkPassword(password, current || undefined);
  const matches = password.length > 0 && password === confirm;
  const canSubmit = current.length > 0 && check.ok && matches && !busy && !!email;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || !email) return;
    setBusy(true);
    setError(null);

    // 1. Prove the current password. See the header for why this is done
    //    client side and why a failure here is harmless.
    const { error: verifyErr } = await supabase.auth.signInWithPassword({
      email,
      password: current,
    });
    if (verifyErr) {
      setBusy(false);
      setError("That is not your current password.");
      return;
    }

    // 2. Only now set the new one.
    const { error: updateErr } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateErr) {
      setError(privateAuthError(updateErr.message));
      return;
    }
    setCurrent("");
    setPassword("");
    setConfirm("");
    setDone(true);
  }

  const backdrop: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    background: "rgba(28,43,51,0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    zIndex: 50,
  };

  return (
    <div style={backdrop} onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label="Change password"
        style={{
          width: 380,
          maxHeight: "90vh",
          overflowY: "auto",
          background: "#fff",
          border: "1px solid #DFE1E6",
          borderRadius: 12,
          boxShadow: "0 8px 28px rgba(28,43,51,0.22)",
          padding: "24px 24px 22px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em" }}>
              Change password
            </div>
            <div style={{ fontSize: 12.5, color: "#65676B", marginTop: 3 }}>
              {email ?? "Signed in"}
            </div>
          </div>
          <span
            onClick={onClose}
            aria-label="Close"
            style={{ fontSize: 18, color: "#8A8D91", cursor: "pointer", lineHeight: 1, padding: "2px 4px" }}
          >
            ×
          </span>
        </div>

        {done ? (
          <>
            <SuccessNote>
              Password changed. Your other devices stay signed in, so sign out there if you want
              them to use the new one.
            </SuccessNote>
            <button type="button" className="btn-primary" onClick={onClose} style={primaryButton}>
              Done
            </button>
          </>
        ) : (
          <>
            <Field
              label="Current password"
              type="password"
              required
              autoComplete="current-password"
              autoFocus
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
            <Field
              label="New password"
              type="password"
              required
              autoComplete="new-password"
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
              style={{
                ...primaryButton,
                opacity: canSubmit ? 1 : 0.55,
                cursor: canSubmit ? "pointer" : "not-allowed",
              }}
            >
              {busy ? "Saving…" : "Save new password"}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
