/**
 * Password policy and error wording for every auth screen.
 *
 * ONE RULE ABOVE ALL (Alex, 2026-09-03): nothing here may tell an anonymous
 * caller whether an email address has an account. That is why sign in and
 * "forgot password" both speak in fixed sentences instead of forwarding what
 * the API said. Supabase itself is careful (`signInWithPassword` answers
 * "Invalid login credentials" for a wrong password AND for an address that
 * does not exist, and `resetPasswordForEmail` succeeds either way), but its
 * other messages are not: "Email not confirmed" confirms the account exists,
 * and a raw message is one Supabase release away from leaking. So the app
 * decides the wording, never the server.
 */

/**
 * Minimum length. Length is the only property that reliably buys strength, so
 * this is deliberately a length rule with one weak composition check rather
 * than a maze of character classes that pushes people toward Passw0rd!
 *
 * WARNING, and it is Alex's to fix if he cares: this is a CLIENT rule.
 * The project's own floor is `password_min_length = 6` with
 * `password_required_characters` unset (read from the live auth config
 * 2026-09-03), so anything 6 characters or longer is accepted by the API
 * whatever this file says. See the README for the dashboard change that
 * raises the real floor.
 */
export const MIN_PASSWORD = 12;

export interface PasswordCheck {
  ok: boolean;
  /** Every rule, in display order, with its current state. */
  rules: { label: string; ok: boolean }[];
  /** First failure, as a sentence. Null when the password passes. */
  problem: string | null;
}

/**
 * Judge a candidate password. `current` is passed when it is known (the
 * change password screen) so that "new password same as the old one" is a
 * hard failure rather than a silent no op: `updateUser` accepts an unchanged
 * password and reports success, which would read as "changed" when nothing
 * changed at all.
 */
export function checkPassword(next: string, current?: string): PasswordCheck {
  const longEnough = next.length >= MIN_PASSWORD;
  // One letter plus one non letter. Enough to stop 123456789012 and
  // aaaaaaaaaaaa without pretending a symbol quota is security.
  const mixed = /\p{L}/u.test(next) && /[^\p{L}]/u.test(next);
  const different = !current || next !== current;
  const rules = [
    { label: `At least ${MIN_PASSWORD} characters`, ok: longEnough },
    { label: "Mixes letters with numbers or symbols", ok: mixed },
    ...(current ? [{ label: "Different from your current password", ok: different }] : []),
  ];
  const problem = !longEnough
    ? `Use at least ${MIN_PASSWORD} characters.`
    : !mixed
      ? "Mix letters with at least one number or symbol."
      : !different
        ? "The new password is the same as your current one."
        : null;
  return { ok: longEnough && mixed && different, rules, problem };
}

/** Coarse buckets for the strength bar. Presentation only, never a gate. */
export function strength(pw: string): { score: 0 | 1 | 2 | 3; label: string; color: string } {
  if (pw.length < MIN_PASSWORD) return { score: 0, label: "Too short", color: "#C0392B" };
  const classes =
    Number(/[a-z]/.test(pw)) +
    Number(/[A-Z]/.test(pw)) +
    Number(/[0-9]/.test(pw)) +
    Number(/[^A-Za-z0-9]/.test(pw));
  if (pw.length >= 20 || (pw.length >= 16 && classes >= 3)) {
    return { score: 3, label: "Strong", color: "#1E7B4D" };
  }
  if (pw.length >= 14 || classes >= 3) return { score: 2, label: "Good", color: "#1E7B4D" };
  return { score: 1, label: "Fair", color: "#8A5300" };
}

/** The one sentence every failed sign in gets, whatever the server said. */
export const SIGN_IN_FAILED =
  "That email and password combination did not work. Check both and try again.";

/**
 * Turn a Supabase auth error into something safe to show on a screen that an
 * anonymous visitor can reach.
 *
 * Rate limiting is the one condition worth naming, because "try again" with
 * no explanation sends people into a retry loop that makes it worse. It says
 * nothing about any account: the limit is per address AND per IP, so hitting
 * it proves nothing about whether the address is registered.
 */
export function publicAuthError(message: string | undefined): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("rate limit") || m.includes("too many") || m.includes("429")) {
    return "Too many attempts just now. Wait a minute and try again.";
  }
  if (m.includes("fetch") || m.includes("network")) {
    return "Could not reach the server. Check your connection and try again.";
  }
  return SIGN_IN_FAILED;
}

/**
 * Errors on a screen the user has ALREADY authenticated for (change
 * password, and the reset screen once its recovery session exists). No
 * enumeration risk there, so these may be specific and are much more useful
 * when they are.
 */
export function privateAuthError(message: string | undefined): string {
  const raw = (message ?? "").trim();
  const m = raw.toLowerCase();
  if (m.includes("rate limit") || m.includes("too many") || m.includes("429")) {
    return "Too many attempts just now. Wait a minute and try again.";
  }
  if (m.includes("same as the old") || m.includes("should be different")) {
    return "That is already your password. Choose a different one.";
  }
  if (m.includes("weak") || m.includes("password should be at least")) {
    return `That password was rejected as too weak. Use at least ${MIN_PASSWORD} characters.`;
  }
  if (m.includes("session") || m.includes("jwt") || m.includes("token")) {
    return "Your session expired before the change was saved. Sign in again and retry.";
  }
  return raw || "Something went wrong. Try again.";
}
