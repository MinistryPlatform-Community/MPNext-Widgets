/**
 * The one client-side way this app signs a user out.
 *
 * A sign-out here has to end **two** sessions:
 *
 *  1. the Better Auth session (cookie + row in the session store), and
 *  2. the MinistryPlatform IdP session that issued it.
 *
 * Ending only (1) is not a sign-out. `/signin` immediately restarts the OAuth
 * round trip, MP still recognises the browser, and the user is bounced back
 * into `/demo` with a brand-new session and no prompt — observed while
 * verifying TODO 24, filed as TODO 27.
 *
 * Better Auth's own `POST /api/auth/sign-out` does (1) only, so nothing in the
 * app may call it directly. `POST /api/auth/logout`
 * (`src/app/api/auth/logout/route.ts`) is the app's logout endpoint: it calls
 * `auth.api.signOut()` and returns MP's `end_session` URL with an
 * `id_token_hint`, which the caller must then reach by a top-level navigation.
 *
 * Every logout entry point routes through here — the widget path
 * (`TokenBridge`, TODO 13) and the `/demo` header's Sign Out button — so the
 * two cannot drift apart.
 *
 * It takes no "send me back here afterwards" argument, on purpose. MP only
 * finishes an end-session whose `post_logout_redirect_uri` is registered on
 * the OAuth client; handed anything else it drops the logout context and shows
 * a "Would you like to logout?" prompt while the SSO session survives. The
 * widget path used to pass `window.location.href` and hit exactly that
 * (TODO 29). The destination is fixed server-side instead —
 * `getRegisteredPostLogoutRedirectUri()` in `src/lib/embed/mp-oauth.ts`.
 */

/**
 * The `mpp-widgets_*` keys `TokenBridge` mirrors the MP tokens into for the
 * legacy MP widgets. They outlive the server session unless explicitly
 * cleared, and a stale token reads as "still signed in" to those widgets.
 */
export const MP_WIDGET_STORAGE_KEYS = [
  "mpp-widgets_AuthToken",
  "mpp-widgets_IdToken",
  "mpp-widgets_ExpiresAfter",
  "mpp-widgets_Refresh",
] as const;

/** Drops every browser-held copy of the MP identity. Never throws. */
export function clearMpWidgetStorage(): void {
  for (const key of MP_WIDGET_STORAGE_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      // localStorage may be blocked (private mode, third-party context)
    }
  }
  try {
    sessionStorage.removeItem("userObj");
  } catch {
    // sessionStorage may be blocked
  }
}

/**
 * Clears the browser-held MP tokens, ends the Better Auth session, and returns
 * MP's end-session URL for the caller to navigate to.
 *
 * Returns `null` when the endpoint failed or returned no URL — callers should
 * fall back to `/signin` rather than pretending the logout completed.
 */
export async function requestAppLogout(): Promise<string | null> {
  clearMpWidgetStorage();

  try {
    const res = await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = (await res.json()) as { redirectUrl?: string };
    return data.redirectUrl ?? null;
  } catch {
    // Network failure or a non-JSON body — the caller falls back to /signin.
    return null;
  }
}
