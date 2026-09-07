/**
 * Helpers shared by the `/api/embed/auth/*` route handlers.
 *
 * Lives in a private (`_lib`) folder so Next.js never treats it as a route
 * segment. Nothing here logs token material.
 */

import type { NextRequest, NextResponse } from "next/server";
import { MPHelper } from "@/lib/providers/ministry-platform";
import { allowedOrigins } from "@/lib/embed/config";
import { isOriginAllowed } from "@/lib/embed/auth";

/** Cookie carrying the signed OAuth state between /login and /callback. */
export const STATE_COOKIE_NAME = "nw_oauth_state";
/** Cookie is scoped to the auth routes only. */
export const STATE_COOKIE_PATH = "/api/embed/auth";
/** Lifetime of the state cookie / state token, in seconds. */
export const STATE_TTL_SECONDS = 600;
/** Default widget id when the login link does not name one. */
export const DEFAULT_WID = "user-menu";

/** Payload signed into the `nw_oauth_state` cookie. */
export interface OAuthStatePayload {
  state: string;
  nonce: string;
  origin: string;
  return_to: string;
  wid: string;
  codeVerifier?: string;
  scope?: string;
}

const LOCAL_HOSTNAMES: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Public origin of this widget host, used to build `redirect_uri` and the
 * absolute URLs advertised by `/auth/config`. `EMBED_PUBLIC_URL` wins (needed
 * behind proxies); otherwise the request URL's origin.
 */
export function getPublicUrl(req: NextRequest): string {
  const configured = process.env.EMBED_PUBLIC_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      console.warn("EMBED_PUBLIC_URL is not a valid URL; deriving the public URL from the request");
    }
  }
  return new URL(req.url).origin;
}

/** The OAuth redirect URI registered with the MP client. */
export function getCallbackUrl(publicUrl: string): string {
  return `${publicUrl}/api/embed/auth/callback`;
}

/** `Secure` cookies everywhere except a plain-http local dev host. */
export function isSecureCookieContext(publicUrl: string): boolean {
  try {
    const url = new URL(publicUrl);
    if (url.protocol === "https:") return true;
    return !LOCAL_HOSTNAMES.has(url.hostname.toLowerCase());
  } catch {
    return true;
  }
}

/** Attach the state cookie to a response. */
export function setStateCookie(res: NextResponse, value: string, publicUrl: string): void {
  res.cookies.set(STATE_COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureCookieContext(publicUrl),
    path: STATE_COOKIE_PATH,
    maxAge: STATE_TTL_SECONDS,
  });
}

/** Expire the state cookie on a response. */
export function clearStateCookie(res: NextResponse, publicUrl: string): void {
  res.cookies.set(STATE_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureCookieContext(publicUrl),
    path: STATE_COOKIE_PATH,
    maxAge: 0,
  });
}

/**
 * True when `origin` is an allowed embedding origin. Mirrors the other embed
 * routes: unknown origins are tolerated in `development` (with a warning).
 */
export function isEmbedOriginAllowed(origin: string): boolean {
  if (isOriginAllowed(origin, allowedOrigins)) return true;
  if (process.env.NODE_ENV === "development") {
    console.warn(`⚠️ DEV MODE: Origin ${origin} not in allowlist, allowing anyway`);
    return true;
  }
  return false;
}

/**
 * Validate that `returnTo` is an absolute http(s) URL on exactly `origin`.
 * Returns the parsed URL's string form, or null.
 */
export function validateReturnTo(returnTo: string | null | undefined, origin: string): string | null {
  if (!returnTo || !origin) return null;
  let url: URL;
  try {
    url = new URL(returnTo);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.origin !== origin) return null;
  return returnTo;
}

/**
 * Append `key=value` to the fragment of `url`, preserving any existing
 * fragment verbatim (joined with `&`). Operates on the string so the host
 * page's URL is not re-normalized.
 */
export function appendFragmentParam(url: string, key: string, value: string): string {
  const pair = `${key}=${encodeURIComponent(value)}`;
  const hashIndex = url.indexOf("#");
  if (hashIndex === -1) return `${url}#${pair}`;
  const base = url.slice(0, hashIndex);
  const existing = url.slice(hashIndex + 1);
  return existing ? `${base}#${existing}&${pair}` : `${base}#${pair}`;
}

/**
 * Best-effort lookup of the user's photo file GUID from `dp_Users`, mirroring
 * `mapProfileToUser` in `src/lib/auth.ts`. Never throws; null when unavailable.
 */
export async function lookupImageGuid(userGuid: string): Promise<string | null> {
  if (!userGuid) return null;
  try {
    const mp = new MPHelper();
    const records = await mp.getTableRecords<{ Image_GUID: string | null }>({
      table: "dp_Users",
      filter: `User_GUID = '${userGuid.replace(/'/g, "''")}'`,
      select: "Contact_ID_TABLE.dp_fileUniqueId AS Image_GUID",
      top: 1,
    });
    return records[0]?.Image_GUID || null;
  } catch (error) {
    console.error(
      "embed auth callback - error fetching image GUID:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
