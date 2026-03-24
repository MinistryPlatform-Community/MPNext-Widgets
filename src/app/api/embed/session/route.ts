/**
 * Session endpoint for issuing short-lived JWT tokens to embed widgets
 * POST /api/embed/session
 */

import { NextRequest, NextResponse } from "next/server";
import { validateInitToken } from "@/lib/embed/config";
import { createWidgetToken } from "@/lib/embed/jwt";
import { getCorsHeaders, resolveRequestOrigin, isOriginAllowed, buildOptionsResponse, buildFallbackCorsHeaders } from "@/lib/embed/auth";
import { SessionRequest, SessionResponse } from "@/lib/embed/types";
import { auth } from "@/auth";

export async function POST(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  const fallbackCors = buildFallbackCorsHeaders(origin);

  try {
    const body: SessionRequest = await req.json();
    const { tid, wid, initToken, mpUserToken } = body;

    if (!tid || !wid || !initToken) {
      return NextResponse.json(
        { error: "Missing required fields: tid, wid, initToken" },
        { status: 400, headers: fallbackCors }
      );
    }

    // Validate init token and get tenant config
    const tenant = await validateInitToken(tid, initToken);
    if (!tenant) {
      return NextResponse.json(
        { error: "Invalid tenant or init token" },
        { status: 403, headers: fallbackCors }
      );
    }

    const corsHeaders = getCorsHeaders(origin, tenant.allowedOrigins);

    // Check if origin is allowed
    const originAllowed = isOriginAllowed(origin, tenant.allowedOrigins);

    if (!originAllowed && process.env.NODE_ENV !== "development") {
      return NextResponse.json(
        { error: `Origin ${origin} not allowed for tenant ${tid}` },
        { status: 403, headers: fallbackCors }
      );
    }

    // Determine user identity and MP access token
    let sub = "public";
    let mpAccessToken = "";

    if (mpUserToken) {
      // MP Widget Login flow: verify the MP OAuth token via OIDC userinfo
      try {
        const mpBaseUrl = process.env.MINISTRY_PLATFORM_BASE_URL;
        if (!mpBaseUrl) {
          throw new Error("MINISTRY_PLATFORM_BASE_URL not configured");
        }
        const userinfoRes = await fetch(
          `${mpBaseUrl}/oauth/connect/userinfo`,
          {
            headers: { Authorization: `Bearer ${mpUserToken}` },
          }
        );
        if (!userinfoRes.ok) {
          throw new Error(`MP userinfo returned ${userinfoRes.status}`);
        }
        const userinfo = await userinfoRes.json();
        if (userinfo.sub) {
          sub = userinfo.sub;
          mpAccessToken = mpUserToken;
          console.log("MP Widget Login: resolved user GUID:", sub);
        } else {
          console.warn("MP userinfo response missing sub claim");
        }
      } catch (error) {
        console.error("Failed to verify mpUserToken:", error);
        return NextResponse.json(
          { error: "Invalid MP user token. Please sign in again." },
          { status: 403, headers: corsHeaders }
        );
      }
    } else {
      // Fallback: NextAuth session (internal app) or public
      const session = await auth();
      if (session?.accessToken) {
        mpAccessToken = session.accessToken;
      } else {
        console.warn("No user session found, using empty MP token");
        mpAccessToken = process.env.MINISTRY_PLATFORM_SERVICE_TOKEN || "";
      }
      sub = session?.user?.id || "public";
    }

    // Create short-lived JWT (5 minutes)
    const token = await createWidgetToken({
      sub,
      tid,
      wid,
      mpAccessToken,
      origin,
    });

    const response: SessionResponse = {
      token,
      expiresIn: 300, // 5 minutes in seconds
    };

    return NextResponse.json(response, {
      status: 200,
      headers: corsHeaders,
    });
  } catch (error) {
    console.error("Error creating session:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500, headers: fallbackCors }
    );
  }
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
