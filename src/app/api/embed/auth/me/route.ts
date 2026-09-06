/**
 * Current embed user
 * GET /api/embed/auth/me   (Bearer widget JWT)
 *
 * v2 tokens with a session id resolve to the stored user; public tokens are
 * 401; legacy v1 tokens are 200 unauthenticated (the host page owns identity
 * in legacy mode).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireWidgetAuth,
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import { getEmbedSession } from "@/lib/embed/embed-session";

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    const claims = await requireWidgetAuth(req, { widget: "*" });
    const corsHeaders = getCorsHeaders(origin);

    if (claims.sub === "public") {
      return NextResponse.json(
        { authenticated: false },
        { status: 401, headers: corsHeaders },
      );
    }

    if (!claims.sid) {
      // v1 (legacy) token: identity lives on the host page, not with us.
      return NextResponse.json(
        { authenticated: false },
        { status: 200, headers: corsHeaders },
      );
    }

    const record = await getEmbedSession(claims.sid, origin);
    if (!record) {
      return NextResponse.json(
        { authenticated: false, error: "invalid_session" },
        { status: 401, headers: corsHeaders },
      );
    }

    return NextResponse.json(
      { authenticated: true, user: record.user },
      { status: 200, headers: corsHeaders },
    );
  } catch (error) {
    console.error("Error resolving embed user:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      {
        authenticated: false,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 401, headers: buildFallbackCorsHeaders(origin) },
    );
  }
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
