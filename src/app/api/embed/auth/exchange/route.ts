/**
 * Redeem a one-time login handoff code for a session id + widget token
 * POST /api/embed/auth/exchange   body { code, wid }
 *
 * The code is minted by /auth/callback (60s TTL, single use, origin-bound).
 */

import { NextRequest, NextResponse } from "next/server";
import { createWidgetToken, JWT_EXPIRY_SECONDS } from "@/lib/embed/jwt";
import {
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
  getClientIp,
} from "@/lib/embed/auth";
import { resolveAuthMode } from "@/lib/embed/auth-mode";
import { checkRateLimit } from "@/lib/embed/rate-limit";
import { getEmbedSession, redeemHandoffCode } from "@/lib/embed/embed-session";
import { isEmbedOriginAllowed } from "../_lib/auth-route-helpers";

interface ExchangeRequest {
  code?: string;
  wid?: string;
}

export async function POST(req: NextRequest) {
  const origin = resolveRequestOrigin(req);
  const fallbackCors = buildFallbackCorsHeaders(origin);

  try {
    let body: ExchangeRequest;
    try {
      body = ((await req.json()) ?? {}) as ExchangeRequest;
    } catch {
      return NextResponse.json(
        { error: "invalid_body", message: "Invalid or empty JSON body" },
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

    const rate = await checkRateLimit(`ip:${getClientIp(req)}`);
    if (!rate.ok) {
      return NextResponse.json(
        { error: "rate_limited", message: "Too many requests" },
        { status: 429, headers: { ...corsHeaders, "Retry-After": "60" } },
      );
    }

    const code = typeof body.code === "string" ? body.code : "";
    if (!code) {
      return NextResponse.json(
        { error: "invalid_code" },
        { status: 400, headers: corsHeaders },
      );
    }

    const redeemed = await redeemHandoffCode(code, origin);
    const record = redeemed ? await getEmbedSession(redeemed.sid, origin) : null;
    if (!redeemed || !record) {
      return NextResponse.json(
        { error: "invalid_code" },
        { status: 400, headers: corsHeaders },
      );
    }

    const wid = typeof body.wid === "string" && body.wid ? body.wid : redeemed.wid;
    const token = await createWidgetToken({
      sub: record.user.userGuid,
      wid,
      origin,
      ver: 2,
      sid: redeemed.sid,
    });

    return NextResponse.json(
      {
        sid: redeemed.sid,
        token,
        expiresIn: JWT_EXPIRY_SECONDS,
        mode: resolveAuthMode(origin),
      },
      { status: 200, headers: corsHeaders },
    );
  } catch (error) {
    console.error("Error exchanging handoff code:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: "internal_error", message: "Internal server error" },
      { status: 500, headers: fallbackCors },
    );
  }
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
