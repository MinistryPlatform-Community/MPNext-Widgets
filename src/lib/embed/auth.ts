/**
 * Authentication middleware for embed widgets
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyWidgetToken } from "./jwt";
import { allowedOrigins } from "./config";
import { WidgetClaims } from "./types";

export interface AuthOptions {
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

  // Validate widget type
  const allowedWidgets = Array.isArray(widget) ? widget : [widget];
  if (!allowedWidgets.includes(claims.wid)) {
    throw new Error(
      `Invalid widget: expected ${allowedWidgets.join(" or ")}, got ${claims.wid}`,
    );
  }

  // Validate origin against allowlist
  const origin = resolveRequestOrigin(req);
  const originOk = isOriginAllowed(origin, allowedOrigins);

  if (!originOk && process.env.NODE_ENV !== "development") {
    throw new Error(`Origin ${origin} not allowed`);
  }

  if (!originOk && process.env.NODE_ENV === "development") {
    console.warn(
      `⚠️ DEV MODE: Origin ${origin} not in allowlist, allowing anyway`,
    );
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
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, Idempotency-Key",
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
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key",
  };
}

/**
 * Check whether an origin is present in the allowlist.
 * Supports exact matches and wildcard subdomains (e.g. *.example.com).
 */
export function isOriginAllowed(
  origin: string,
  origins: string[],
): boolean {
  if (!origin) return false;
  return origins.some((allowed) => {
    if (allowed === origin) return true;
    if (allowed.startsWith("*.")) {
      const domain = allowed.slice(2);
      return origin.endsWith(domain);
    }
    return false;
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
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key",
    "Access-Control-Max-Age": "86400",
    "Access-Control-Allow-Credentials": "false",
    Vary: "Origin",
  };
}
