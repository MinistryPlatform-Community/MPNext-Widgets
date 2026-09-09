/**
 * The convention for a route that writes MP records for a caller with no login.
 *
 * Three widgets need one: `next-prayer-feedback` (C69) files a prayer request,
 * `next-subscribe-to-publication` (C70) joins a mailing list, and
 * `next-unsubscribe` (C72) leaves one. Before this, the repo had exactly one
 * precedent — `plan-your-visit/send-verification` — and settling the shape once
 * is what makes the other three cheap and, more to the point, consistently
 * safe. The legacy .NET widgets are the cautionary tale: all four
 * `[AllowAnonymous]` actions on `PrayerFeedbackApiController` have no rate
 * limit and no origin check, and one of them takes a client-supplied contact id
 * plus an arbitrary email address and sends mail to it.
 *
 * ## "Anonymous" means the *user* is anonymous, not the request
 *
 * A widget JWT is still required. `requireWidgetAuth` still runs, the `origin`
 * claim must still match the request origin, and the origin must still be on a
 * tenant allowlist. What these routes relax is only that `claims.sub` may be
 * `"public"` — where most routes reject that outright. So the endpoint is not
 * reachable from `curl` without first minting a token from an allowlisted
 * origin, which is the difference between "a form a visitor can submit" and
 * "an open endpoint".
 *
 * ## POST only
 *
 * A state-changing `GET` is fetched by mail scanners, link-preview bots and
 * URL-rewriting gateways, which is how an emailed link unsubscribes someone
 * who never clicked it. The emailed link must therefore land on a *page* that
 * renders, and the write is a POST that page issues. This wrapper enforces the
 * method so that cannot be got wrong route by route.
 *
 * ## Limits are checked before anything else
 *
 * Every limit runs before the handler, so before any MP read, any MP write and
 * any email. A limiter that runs after the expensive part is decoration.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireWidgetAuth,
  getCorsHeaders,
  resolveRequestOrigin,
  buildFallbackCorsHeaders,
  getClientIp,
} from "./auth";
import { checkRateLimit } from "./rate-limit";
import type { WidgetClaims } from "./types";

/** One rate-limit bucket, checked before the handler runs. */
export interface AnonymousWriteLimit {
  /**
   * Counter key. Namespace it per route (`pf:ip:`, `sub:email:`) — the window
   * length is added by `checkRateLimit`, but the subject is yours to scope.
   */
  key: string;
  /** Requests allowed per window. */
  limit: number;
  /** Window length in seconds. Defaults to 60. */
  windowSeconds?: number;
}

export interface AnonymousWriteOptions {
  /** Passed to `requireWidgetAuth`. */
  widget: string | string[];
  /**
   * Buckets to check, in order. Keep the cheapest and broadest first: an IP
   * bucket rejects a flood without hashing anything.
   */
  limits: AnonymousWriteLimit[];
  /**
   * Deny when the rate-limit store is unreachable. Defaults to **true** — the
   * opposite of `checkRateLimit`'s own default, because every caller here
   * writes records or sends email. Pass `false` only for a route that does
   * neither.
   */
  failClosed?: boolean;
}

export interface AnonymousWriteContext {
  claims: WidgetClaims;
  origin: string;
  /** CORS headers for the resolved origin. Put them on every response. */
  cors: HeadersInit;
  /** Client IP, already resolved through the proxy headers. */
  ip: string;
}

/** `{ error, message }` — the machine-code envelope every embed route uses. */
export function errorResponse(
  code: string,
  message: string,
  status: number,
  cors: HeadersInit
): NextResponse {
  return NextResponse.json({ error: code, message }, { status, headers: cors });
}

/**
 * Wrap a POST handler with the anonymous-write convention.
 *
 * The handler receives verified claims and returns its own response. Failures
 * it throws become `internal_error` — deliberately opaque, because the
 * alternative on an unauthenticated endpoint is echoing MP's error text to
 * whoever asked.
 */
export async function withAnonymousWrite(
  req: NextRequest,
  options: AnonymousWriteOptions,
  handler: (ctx: AnonymousWriteContext) => Promise<NextResponse>
): Promise<NextResponse> {
  const origin = resolveRequestOrigin(req);

  if (req.method !== "POST") {
    return errorResponse(
      "method_not_allowed",
      "This endpoint accepts POST only.",
      405,
      buildFallbackCorsHeaders(origin)
    );
  }

  let claims: WidgetClaims;
  try {
    claims = await requireWidgetAuth(req, { widget: options.widget });
  } catch {
    // Never echo the auth failure's detail: it distinguishes "bad token" from
    // "wrong origin" from "wrong widget" for an unauthenticated caller.
    return errorResponse(
      "auth_required",
      "A valid widget token is required.",
      401,
      buildFallbackCorsHeaders(origin)
    );
  }

  const cors = getCorsHeaders(origin);
  const failClosed = options.failClosed ?? true;

  for (const bucket of options.limits) {
    const result = await checkRateLimit(bucket.key, bucket.limit, {
      windowSeconds: bucket.windowSeconds,
      failClosed,
    });
    if (!result.ok) {
      // One code for every bucket: telling the caller *which* limit they hit
      // reports whether the address they submitted is one we have seen before.
      return errorResponse("rate_limited", "Too many requests.", 429, cors);
    }
  }

  try {
    return await handler({ claims, origin, cors, ip: getClientIp(req) });
  } catch (error) {
    console.error("Anonymous write failed:", error);
    return errorResponse("internal_error", "Internal server error", 500, cors);
  }
}

/**
 * Is `candidate` a URL we are willing to email a link to?
 *
 * These widgets take a `return-url` from host-page markup and put it in an
 * email, which makes the attribute an open-redirect vector aimed at a church's
 * own congregation: the church's domain sends the mail, so the link inherits
 * its credibility. The rule is that the URL must be same-origin with the
 * request `Origin` — i.e. the page that hosts the widget — which is exactly
 * where a legitimate `return-url` points.
 *
 * `https:` only, except for localhost, so a development page still works
 * without weakening the deployed rule. Credentials in the URL are refused
 * outright: `https://church.example@evil.example` is same-"origin" to nobody's
 * eye but a parser's.
 */
export function isReturnUrlAllowed(candidate: string, origin: string): boolean {
  if (!candidate || !origin) return false;

  let url: URL;
  let originUrl: URL;
  try {
    url = new URL(candidate);
    originUrl = new URL(origin);
  } catch {
    return false;
  }

  if (url.username || url.password) return false;

  const isLocalhost =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalhost)) {
    return false;
  }

  return url.origin === originUrl.origin;
}

/**
 * Append a query parameter to a `return-url` that may already have some.
 *
 * `URL.searchParams` rather than string concatenation, so a return URL that
 * already carries `?page=2` keeps it and the token is encoded once — a
 * hand-rolled `?`/`&` chain has produced a double-encoded token in this
 * codebase's ancestry more than once.
 */
export function buildReturnUrl(returnUrl: string, param: string, value: string): string {
  const url = new URL(returnUrl);
  url.searchParams.set(param, value);
  return url.toString();
}
