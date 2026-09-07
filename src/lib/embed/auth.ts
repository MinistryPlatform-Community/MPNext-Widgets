/**
 * Authentication middleware for embed widgets
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyWidgetToken } from "./jwt";
import { allowedOrigins } from "./config";
import { WidgetClaims } from "./types";

export interface AuthOptions {
  /**
   * Widget id(s) permitted to call this route. Use the wildcard `"*"` to accept
   * any authenticated widget — appropriate for shared user-menu "chrome"
   * requests (e.g. the avatar photo) that ride on whatever page-level token the
   * host happens to issue, regardless of which primary widget is embedded.
   */
  widget: string | string[];
  requireAuth?: boolean;
}

/**
 * Resolve the request origin, falling back to the Referer header.
 * Browsers omit the Origin header on same-origin requests and some
 * privacy configurations strip it entirely. The Referer header's
 * origin portion is a reliable fallback in those cases.
 */
export function resolveRequestOrigin(req: NextRequest): string {
  const origin = req.headers.get("origin");
  if (origin) return origin;

  const referer = req.headers.get("referer");
  if (referer) {
    try {
      const url = new URL(referer);
      return url.origin;
    } catch {
      // malformed referer — ignore
    }
  }

  return "";
}

/**
 * Best-effort client IP for rate limiting: first hop of `x-forwarded-for`,
 * then `x-real-ip`, else `"unknown"`.
 */
export function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "unknown";
}

/**
 * Verify widget authentication and return claims
 */
export async function requireWidgetAuth(
  req: NextRequest,
  options: AuthOptions,
): Promise<WidgetClaims> {
  const { widget } = options;

  // Extract token from Authorization header
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    throw new Error("Missing Authorization header");
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    throw new Error("Invalid Authorization header format");
  }

  const token = parts[1];
  if (!token || token.trim() === "") {
    throw new Error("Authorization token is empty");
  }

  // Verify JWT
  let claims: WidgetClaims;
  try {
    claims = await verifyWidgetToken(token);
  } catch (error) {
    throw new Error(
      `Token verification failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }

  // Validate widget type ("*" accepts any authenticated widget)
  const allowedWidgets = Array.isArray(widget) ? widget : [widget];
  if (!allowedWidgets.includes("*") && !allowedWidgets.includes(claims.wid)) {
    throw new Error(
      `Invalid widget: expected ${allowedWidgets.join(" or ")}, got ${claims.wid}`,
    );
  }

  // Validate origin against allowlist
  const origin = resolveRequestOrigin(req);
  const originOk = isOriginAllowed(origin, allowedOrigins);
  const isDev = process.env.NODE_ENV === "development";

  if (!originOk && !isDev) {
    throw new Error(`Origin ${origin} not allowed`);
  }

  if (!originOk && isDev) {
    console.warn(
      `⚠️ DEV MODE: Origin ${origin} not in allowlist, allowing anyway`,
    );
  }

  // Bind the token to the origin it was issued for. A token minted for one
  // host must not be replayable from another allowed host.
  if (claims.origin && origin && claims.origin !== origin) {
    if (isDev) {
      console.warn(
        `⚠️ DEV MODE: token origin ${claims.origin} does not match request origin ${origin}, allowing anyway`,
      );
    } else {
      throw new Error("Token origin mismatch");
    }
  }

  return claims;
}

/**
 * Shared OPTIONS preflight response for all embed API routes.
 */
export function buildOptionsResponse(req: NextRequest): NextResponse {
  const origin = resolveRequestOrigin(req);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
  };

  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }

  return new NextResponse(null, { status: 204, headers });
}

/**
 * Fallback CORS headers for error responses issued before auth context
 * is available. Returns empty object when origin is unknown (no wildcard).
 */
export function buildFallbackCorsHeaders(origin: string): HeadersInit {
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };
}

const LOCAL_HOSTNAMES: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Check whether an origin is present in the allowlist.
 *
 * - The origin must parse as a URL; comparison is against `url.origin`.
 * - Exact entries match `url.origin` exactly.
 * - Wildcard entries (`*.example.com`) match the apex (`example.com`) or any
 *   subdomain on a dot boundary (`www.example.com`), never a lookalike
 *   (`evilexample.com`) or a suffix-attack (`example.com.attacker.net`).
 * - Wildcard matches require `https:` unless NODE_ENV is `development` or the
 *   hostname is `localhost` / `127.0.0.1`.
 */
export function isOriginAllowed(
  origin: string,
  origins: string[],
): boolean {
  if (!origin) return false;

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.origin === "null") return false;

  const hostname = url.hostname.toLowerCase();
  const isDev = process.env.NODE_ENV === "development";

  return origins.some((allowed) => {
    if (!allowed) return false;

    if (allowed.startsWith("*.")) {
      const domain = allowed.slice(2).toLowerCase();
      if (!domain) return false;
      const hostMatches = hostname === domain || hostname.endsWith(`.${domain}`);
      if (!hostMatches) return false;
      if (url.protocol === "https:") return true;
      return isDev || LOCAL_HOSTNAMES.has(hostname);
    }

    if (allowed === url.origin) return true;
    // Tolerate allowlist entries written with a path or trailing slash.
    try {
      return new URL(allowed).origin === url.origin;
    } catch {
      return false;
    }
  });
}

/**
 * Get CORS headers for the response
 */
export function getCorsHeaders(origin: string): HeadersInit {
  if (
    !isOriginAllowed(origin, allowedOrigins) &&
    process.env.NODE_ENV !== "development"
  ) {
    return {};
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    "Access-Control-Allow-Credentials": "false",
    Vary: "Origin",
  };
}
