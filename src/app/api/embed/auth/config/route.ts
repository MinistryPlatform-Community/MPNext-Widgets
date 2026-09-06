/**
 * Auth configuration for the embed SDK
 * GET /api/embed/auth/config
 *
 * Tells the SDK which auth mode applies to the calling origin and where the
 * login/logout/me endpoints live. Cacheable per origin for 5 minutes.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import { resolveAuthMode } from "@/lib/embed/auth-mode";
import { getPublicUrl, isEmbedOriginAllowed } from "../_lib/auth-route-helpers";

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  if (!isEmbedOriginAllowed(origin)) {
    return NextResponse.json(
      { error: `Origin ${origin} not allowed` },
      { status: 403, headers: buildFallbackCorsHeaders(origin) },
    );
  }

  const publicUrl = getPublicUrl(req);

  return NextResponse.json(
    {
      mode: resolveAuthMode(origin),
      loginUrl: `${publicUrl}/api/embed/auth/login`,
      logoutUrl: `${publicUrl}/api/embed/auth/logout`,
      meUrl: `${publicUrl}/api/embed/auth/me`,
    },
    {
      status: 200,
      headers: {
        ...getCorsHeaders(origin),
        "Cache-Control": "public, max-age=300",
      },
    },
  );
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
