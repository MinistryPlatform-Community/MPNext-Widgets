/**
 * Session endpoint for issuing short-lived JWT tokens to embed widgets
 * POST /api/embed/session
 *
 * Authorization is based on the request origin matching EMBED_ALLOWED_ORIGINS.
 * No init token or shared secret is required.
 *
 * Credential ladder (see WIDGET-AUTH-MIGRATION-PLAN.md):
 *   1. `sid`          → server-side embed session → v2 token. Any failure → 401 invalid_session.
 *   2. `mpUserToken`  → (legacy: v1 token carrying the MP token) | (dual: silently
 *                        upgraded to a server-side session → v2 + sid). Ignored in hardened.
 *                        A stale token yields a public session, never an error.
 *   3. Better Auth same-origin session → (legacy: v1) | (dual/hardened: v2 + sid).
 *   4. Public token.
 */

import { NextRequest, NextResponse } from "next/server";
import { allowedOrigins } from "@/lib/embed/config";
import { createWidgetToken, JWT_EXPIRY_SECONDS } from "@/lib/embed/jwt";
import {
  getCorsHeaders,
  resolveRequestOrigin,
  isOriginAllowed,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
  getClientIp,
} from "@/lib/embed/auth";
import { resolveAuthMode } from "@/lib/embed/auth-mode";
import { checkRateLimit } from "@/lib/embed/rate-limit";
import { createEmbedSession, getEmbedSession } from "@/lib/embed/embed-session";
import { fetchMpUserinfo, mapUserinfoToSessionUser } from "@/lib/embed/mp-oauth";
import type { EmbedAuthMode, SessionRequest, SessionResponse, WidgetClaims } from "@/lib/embed/types";
import { auth } from "@/lib/auth";

type MintableClaims = Omit<WidgetClaims, "iat" | "exp" | "jti" | "iss" | "aud">;

async function respond(
  claims: MintableClaims,
  mode: EmbedAuthMode,
  headers: HeadersInit,
  sid?: string,
): Promise<NextResponse> {
  const token = await createWidgetToken(claims);
  const body: SessionResponse = { token, expiresIn: JWT_EXPIRY_SECONDS, mode };
  if (sid) body.sid = sid;
  return NextResponse.json(body, { status: 200, headers });
}

export async function POST(req: NextRequest) {
  const origin = resolveRequestOrigin(req);
  const fallbackCors = buildFallbackCorsHeaders(origin);

  try {
    let body: SessionRequest;
    try {
      body = (await req.json()) as SessionRequest;
    } catch {
      return NextResponse.json(
        { error: "Invalid or empty JSON body" },
        { status: 400, headers: fallbackCors },
      );
    }
    const { wid, sid, mpUserToken } = body ?? {};

    if (!wid || typeof wid !== "string") {
      return NextResponse.json(
        { error: "Missing required field: wid" },
        { status: 400, headers: fallbackCors },
      );
    }

    // Validate origin against allowlist
    const originAllowed = isOriginAllowed(origin, allowedOrigins);

    if (!originAllowed && process.env.NODE_ENV !== "development") {
      return NextResponse.json(
        { error: `Origin ${origin} not allowed` },
        { status: 403, headers: fallbackCors },
      );
    }

    const corsHeaders = getCorsHeaders(origin);

    const rate = await checkRateLimit(`ip:${getClientIp(req)}`);
    if (!rate.ok) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { ...corsHeaders, "Retry-After": "60" } },
      );
    }

    const mode = resolveAuthMode(origin);

    // 1. Server-side session id (v2)
    if (typeof sid === "string" && sid) {
      let record: Awaited<ReturnType<typeof getEmbedSession>> = null;
      try {
        record = await getEmbedSession(sid, origin);
      } catch (error) {
        console.warn(
          "Embed session lookup failed:",
          error instanceof Error ? error.message : "unknown error",
        );
      }
      if (!record) {
        return NextResponse.json(
          { error: "invalid_session" },
          { status: 401, headers: corsHeaders },
        );
      }
      return respond(
        { sub: record.user.userGuid, wid, origin, ver: 2, sid },
        mode,
        corsHeaders,
      );
    }

    // 2. MP access token from the host page (mpp-user-login). Ignored in hardened mode.
    if (typeof mpUserToken === "string" && mpUserToken && mode !== "hardened") {
      // The mpUserToken is opportunistic: the SDK sends whatever it finds in
      // localStorage (mpp-widgets_AuthToken) on every session request. A
      // stale/expired token must NOT block the widget — public widgets only
      // need an anonymous session, and auth-required widgets render their
      // logged-out state. Fall back to a public session instead of erroring.
      const userinfo = await fetchMpUserinfo(mpUserToken);
      if (!userinfo) {
        console.warn("Ignoring invalid/expired mpUserToken; issuing public session");
        return respond({ sub: "public", wid, origin, ver: 2 }, mode, corsHeaders);
      }

      if (mode === "legacy") {
        return respond(
          { sub: userinfo.sub, wid, origin, ver: 1, mpAccessToken: mpUserToken },
          mode,
          corsHeaders,
        );
      }

      // dual: silent upgrade to a server-side session. No refresh token is
      // available from the host page, so the session lives as long as the MP
      // token does (default 3600s when unknown).
      const { sid: newSid } = await createEmbedSession({
        origin,
        user: mapUserinfoToSessionUser(userinfo),
        mpAccessToken: mpUserToken,
      });
      return respond(
        { sub: userinfo.sub, wid, origin, ver: 2, sid: newSid },
        mode,
        corsHeaders,
        newSid,
      );
    }

    // 3. Better Auth same-origin session (host app pages)
    const session = await auth.api.getSession({ headers: req.headers });
    const accessToken = session?.session?.accessToken ?? null;
    const userGuid = session?.user?.userGuid || "";

    if (accessToken) {
      if (mode === "legacy") {
        return respond(
          { sub: userGuid || "public", wid, origin, ver: 1, mpAccessToken: accessToken },
          mode,
          corsHeaders,
        );
      }

      if (userGuid) {
        const expiresAt = session?.session?.expiresAt ?? null;
        const nowSeconds = Math.floor(Date.now() / 1000);
        const { sid: newSid } = await createEmbedSession({
          origin,
          user: {
            userGuid,
            firstName: session?.user?.firstName ?? "",
            lastName: session?.user?.lastName ?? "",
            email: session?.user?.email ?? "",
            imageGuid: session?.user?.imageGuid ?? null,
          },
          mpAccessToken: accessToken,
          mpRefreshToken: session?.session?.refreshToken ?? null,
          mpIdToken: session?.session?.idToken ?? null,
          mpExpiresIn:
            typeof expiresAt === "number" && expiresAt > nowSeconds
              ? expiresAt - nowSeconds
              : undefined,
        });
        return respond(
          { sub: userGuid, wid, origin, ver: 2, sid: newSid },
          mode,
          corsHeaders,
          newSid,
        );
      }
    }

    // 4. Public token
    return respond({ sub: "public", wid, origin, ver: 2 }, mode, corsHeaders);
  } catch (error) {
    console.error("Error creating session:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500, headers: fallbackCors },
    );
  }
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
