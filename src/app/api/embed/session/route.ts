/**
 * Session endpoint for issuing short-lived JWT tokens to embed widgets
 * POST /api/embed/session
 *
 * Authorization is based on the request origin matching EMBED_ALLOWED_ORIGINS.
 * No init token or shared secret is required.
 */

import { NextRequest, NextResponse } from "next/server";
import { allowedOrigins } from "@/lib/embed/config";
import { createWidgetToken } from "@/lib/embed/jwt";
import {
  getCorsHeaders,
  resolveRequestOrigin,
  isOriginAllowed,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import { SessionRequest, SessionResponse } from "@/lib/embed/types";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export async function POST(req: NextRequest) {
  const origin = resolveRequestOrigin(req);
  const fallbackCors = buildFallbackCorsHeaders(origin);

  try {
    const body: SessionRequest = await req.json();
    const { wid, mpUserToken } = body;

    if (!wid) {
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
          },
        );
        if (!userinfoRes.ok) {
          throw new Error(`MP userinfo returned ${userinfoRes.status}`);
        }
        const userinfo = await userinfoRes.json();
        if (userinfo.sub) {
          sub = userinfo.sub;
          mpAccessToken = mpUserToken;
        } else {
          console.warn("MP userinfo response missing sub claim");
        }
      } catch (error) {
        console.error("Failed to verify mpUserToken:", error);
        return NextResponse.json(
          { error: "Invalid MP user token. Please sign in again." },
          { status: 403, headers: corsHeaders },
        );
      }
    } else {
      const session = await auth.api.getSession({
        headers: await headers(),
      });
      if (session?.session?.accessToken) {
        mpAccessToken = session.session.accessToken;
      }
      sub = session?.user?.userGuid || "public";
    }

    // Create short-lived JWT (5 minutes)
    const token = await createWidgetToken({
      sub,
      wid,
      mpAccessToken,
      origin,
    });

    const response: SessionResponse = {
      token,
      expiresIn: 300,
    };

    return NextResponse.json(response, {
      status: 200,
      headers: corsHeaders,
    });
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
