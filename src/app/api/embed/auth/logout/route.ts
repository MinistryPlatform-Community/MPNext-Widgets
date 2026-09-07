/**
 * End an embed session
 * POST /api/embed/auth/logout   body { sid, postLogoutRedirectUri? }
 *
 * Deletes the server-side session (idempotent) and returns the MP end-session
 * URL the SDK may navigate to so the MP SSO cookie is cleared as well.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import { deleteEmbedSession } from "@/lib/embed/embed-session";
import { buildEndSessionUrl } from "@/lib/embed/mp-oauth";
import { isEmbedOriginAllowed, validateReturnTo } from "../_lib/auth-route-helpers";

interface LogoutRequest {
  sid?: string;
  postLogoutRedirectUri?: string;
}

export async function POST(req: NextRequest) {
  const origin = resolveRequestOrigin(req);
  const fallbackCors = buildFallbackCorsHeaders(origin);

  try {
    let body: LogoutRequest;
    try {
      body = ((await req.json()) ?? {}) as LogoutRequest;
    } catch {
      return NextResponse.json(
        { error: "Invalid or empty JSON body" },
        { status: 400, headers: fallbackCors },
      );
    }

    if (!isEmbedOriginAllowed(origin)) {
      return NextResponse.json(
        { error: `Origin ${origin} not allowed` },
        { status: 403, headers: fallbackCors },
      );
    }

    const corsHeaders = getCorsHeaders(origin);

    const sid = typeof body.sid === "string" ? body.sid : "";
    const { idToken } = sid ? await deleteEmbedSession(sid) : { idToken: null };

    // Only bounce back to the embedding site itself.
    const postLogoutRedirectUri =
      validateReturnTo(
        typeof body.postLogoutRedirectUri === "string" ? body.postLogoutRedirectUri : null,
        origin,
      ) ?? undefined;

    return NextResponse.json(
      { endSessionUrl: buildEndSessionUrl({ idToken, postLogoutRedirectUri }) },
      { status: 200, headers: corsHeaders },
    );
  } catch (error) {
    console.error("Error ending embed session:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: fallbackCors },
    );
  }
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
