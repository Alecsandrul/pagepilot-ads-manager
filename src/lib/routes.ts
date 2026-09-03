import { ARRIVAL_URL } from "./supabase";

/**
 * The smallest router that does the job. No dependency is added for three
 * routes: `vercel.json` already rewrites every path to index.html, so a
 * client side switch on `location.pathname` is all a deep link needs.
 */
export type Route = "app" | "forgot" | "reset";

export const PATHS: Record<Exclude<Route, "app">, string> = {
  forgot: "/forgot-password",
  reset: "/reset-password",
};

/**
 * Does this URL carry a password recovery callback?
 *
 * Checked against the SNAPSHOT, never against live `window.location`: by the
 * time React mounts, auth-js has already stripped the fragment. Both shapes
 * count, plus the error shape, because an expired link arrives as
 * `#error=access_denied&error_code=otp_expired` and must land on the reset
 * screen to be explained rather than on a login form that says nothing.
 */
export function hasRecoveryCallback(): boolean {
  const h = new URLSearchParams(ARRIVAL_URL.hash);
  const q = new URLSearchParams(ARRIVAL_URL.search);
  if (h.get("type") === "recovery") return true; // implicit flow
  if (h.has("error") || h.has("error_code") || q.has("error") || q.has("error_code")) {
    // Only treat an error as ours when it landed on the reset path, so an
    // unrelated ?error= on the dashboard does not hijack the whole app.
    return ARRIVAL_URL.path === PATHS.reset;
  }
  if (q.has("code") && ARRIVAL_URL.path === PATHS.reset) return true; // pkce flow
  return false;
}

/** Route for the URL the app was opened on. */
export function initialRoute(): Route {
  // Recovery wins over everything, including an existing signed in session:
  // the recovery link CREATES a session, so a plain session check would drop
  // the user straight onto the dashboard and silently swallow the reset.
  if (hasRecoveryCallback() || ARRIVAL_URL.path === PATHS.reset) return "reset";
  if (ARRIVAL_URL.path === PATHS.forgot) return "forgot";
  return "app";
}

/** Change route and address bar together, without a page load. */
export function navigate(route: Route): void {
  const path = route === "app" ? "/" : PATHS[route];
  window.history.pushState({}, "", path);
}

/**
 * Drop any recovery tokens still sitting in the address bar. auth-js clears
 * what it consumed, but an error fragment (`#error=...`) is never consumed by
 * anything, and leaving it there means a refresh re shows a stale failure.
 */
export function clearAuthParams(): void {
  const url = new URL(window.location.href);
  url.hash = "";
  for (const k of ["code", "error", "error_code", "error_description"]) {
    url.searchParams.delete(k);
  }
  window.history.replaceState(window.history.state, "", url.toString());
}
