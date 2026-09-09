/**
 * Getting an embedded visitor back to the church site after an MP logout.
 *
 * ## Why this exists
 *
 * The obvious way to return a visitor to the page they logged out from is to
 * pass that page as `post_logout_redirect_uri`. MinistryPlatform will not
 * accept it: the URI has to be registered on the OAuth client, and an embed
 * SDK's host pages are an open-ended set belonging to other people. Sending an
 * unregistered one is worse than sending none — MP discards the whole logout
 * context and shows a "Would you like to logout?" interstitial while the SSO
 * session stays alive (TODO 29).
 *
 * MP's registered URI also cannot carry the destination in a query string: the
 * registered value has to match, so the return target must travel out of band.
 *
 * ## The bounce
 *
 * ```
 * church page                                      (host origin)
 *   └─ POST /api/embed/auth/logout   → sealed ticket
 *   └─ GET  /api/embed/auth/logout?t=<ticket>      (widget host, top level)
 *        ├─ Set-Cookie: nextwidgets_logout_return=<church page>   SameSite=Lax
 *        └─ 302 → MP endsession (id_token_hint + the registered URI)
 *   └─ MP ends its session, 302 → ${BETTER_AUTH_URL}/signin   (registered)
 *        └─ src/proxy.ts sees the cookie, clears it, 302 → church page
 * ```
 *
 * `SameSite=Lax` is exactly right here and `None` is not: the cookie is set
 * and read on the widget host, and the only cross-site step is MP's top-level
 * GET navigation back, which Lax allows. Nothing is stored third-party, so no
 * browser's third-party-cookie policy can break it.
 *
 * The ticket is sealed (AES-256-GCM, `src/lib/embed/crypto.ts`) because it
 * carries the MP `id_token` the end-session hint needs. Sealing keeps it
 * opaque in the browser's history and in any log that records the URL, and it
 * keeps the bounce stateless — no store round trip, and no dependency on the
 * in-memory store being the same instance.
 *
 * Every return target is checked against the embed origin allowlist twice —
 * when the ticket is minted and again before the redirect is issued — so the
 * cookie can never turn `/signin` into an open redirect.
 */

import { open, seal } from "./crypto";
import { isOriginAllowed } from "./auth";
import { allowedOrigins } from "./config";

/** Carries the return target across MP's end-session round trip. */
export const LOGOUT_RETURN_COOKIE = "nextwidgets_logout_return";

/**
 * Ticket lifetime. Long enough for a human to finish an MP logout, short
 * enough that a leaked URL is worthless. The cookie gets the same budget.
 */
export const LOGOUT_RETURN_TTL_SECONDS = 300;

interface LogoutReturnTicket {
  /** Absolute URL on an allowed embedding origin. */
  returnTo: string;
  /** MP id_token for the `id_token_hint`, when the session had one. */
  idToken?: string;
  /** Epoch seconds after which the ticket is refused. */
  exp: number;
}

/**
 * True when `target` is an absolute http(s) URL on an allowed embedding
 * origin. The single gate on every redirect this module can cause.
 */
export function isAllowedReturnTarget(target: string | null | undefined): boolean {
  if (!target) return false;
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return isOriginAllowed(url.origin, allowedOrigins);
}

/**
 * Seal a return target (and the id_token the end-session needs) into an opaque
 * ticket. Returns null when the target is not an allowed embedding origin, so
 * a caller cannot mint a ticket for somewhere else.
 */
export async function sealLogoutReturn(args: {
  returnTo: string;
  idToken?: string | null;
}): Promise<string | null> {
  if (!isAllowedReturnTarget(args.returnTo)) return null;
  const ticket: LogoutReturnTicket = {
    returnTo: args.returnTo,
    exp: Math.floor(Date.now() / 1000) + LOGOUT_RETURN_TTL_SECONDS,
  };
  if (args.idToken) ticket.idToken = args.idToken;
  return seal(JSON.stringify(ticket));
}

/**
 * Open a ticket produced by {@link sealLogoutReturn}. Null on tamper, on a bad
 * shape, once expired, or if the allowlist has since stopped covering the
 * target. Never throws.
 */
export async function openLogoutReturn(
  ticket: string | null | undefined,
): Promise<{ returnTo: string; idToken?: string } | null> {
  if (!ticket) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await open(ticket));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { returnTo, idToken, exp } = parsed as Record<string, unknown>;
  if (typeof returnTo !== "string" || typeof exp !== "number") return null;
  if (exp <= Math.floor(Date.now() / 1000)) return null;
  if (!isAllowedReturnTarget(returnTo)) return null;
  return typeof idToken === "string" && idToken ? { returnTo, idToken } : { returnTo };
}
