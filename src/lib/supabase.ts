import { createClient } from "@supabase/supabase-js";

/**
 * THE ARRIVAL URL, SNAPSHOT BEFORE ANYTHING CAN EAT IT.
 *
 * `detectSessionInUrl` defaults to true, so the moment `createClient` runs
 * below, auth-js starts consuming a recovery callback and then calls
 * `history.replaceState` to strip it from the address bar. Anything reading
 * `window.location` later (a React component mounting, say) sees a clean URL
 * and cannot tell a recovery landing from an ordinary visit. That race is
 * exactly how a reset link ends up on a blank page.
 *
 * These lines run BEFORE createClient in the same module, so the snapshot is
 * always the URL the user actually arrived on. Do not move them below the
 * client, and do not re read window.location in the reset screen.
 */
const loc = typeof window === "undefined" ? null : window.location;
export const ARRIVAL_URL = {
  /** Fragment without the "#", e.g. access_token=...&type=recovery */
  hash: loc?.hash.replace(/^#/, "") ?? "",
  /** Query without the "?", e.g. code=... */
  search: loc?.search.replace(/^\?/, "") ?? "",
  path: loc?.pathname ?? "/",
} as const;

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  // Fail loudly at startup instead of a blank white screen later.
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local and fill both in."
  );
}

/**
 * FLOW TYPE IS LEFT AT THE auth-js DEFAULT, `implicit`, ON PURPOSE.
 *
 * PKCE is the more modern flow and keeps tokens out of the URL, but it stores
 * a code verifier in the localStorage of the browser that REQUESTED the
 * reset, and the link then only works in that same browser. Request it on the
 * laptop, open the mail on the phone, and PKCE fails with "both auth code and
 * code verifier should be non-empty". For a two person internal tool whose
 * recovery mail is as likely to be opened on a phone, a link that works
 * everywhere beats a link that is tidier, and the fragment is stripped from
 * the address bar as soon as it is consumed.
 *
 * auth-js REFUSES a mismatch in both directions (AuthImplicitGrantRedirect
 * Error "Not a valid implicit grant flow url." for a `?code=` link on an
 * implicit client, and the mirror image for pkce), so if this ever becomes
 * `pkce` the reset screen must change with it. ResetPassword already reads
 * both shapes and reports a mismatch in words rather than rendering nothing,
 * but a mismatch can only be reported, never recovered from.
 */
export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
