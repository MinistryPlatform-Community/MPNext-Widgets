/**
 * My Groups endpoint for embed widgets
 * GET /api/embed/my-groups - user's groups (read-only)
 */

import { NextRequest, NextResponse } from "next/server";
import { requireWidgetAuth, getCorsHeaders, resolveRequestOrigin, buildOptionsResponse, buildFallbackCorsHeaders } from "@/lib/embed/auth";
import { MyGroupsService } from "@/services/myGroupsService";

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    // The groups tab is rendered inside the next-user-menu modal on any page,
    // so it rides on whatever page-level token the host issues. Accept any
    // authenticated widget for the read (still enforces non-public sub below).
    const claims = await requireWidgetAuth(req, { widget: "*" });

    if (claims.sub === "public") {
      return NextResponse.json(
        { error: "Authentication required. Please sign in." },
        { status: 401, headers: getCorsHeaders(origin) }
      );
    }

    const service = await MyGroupsService.getInstance();
    const user = await service.getUserByGuid(claims.sub);
    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    const [groups, cloudUrlPrefix] = await Promise.all([
      service.getGroups(user.User_ID),
      service.getCloudUrlPrefix(),
    ]);

    return NextResponse.json(
      { groups, cloudUrlPrefix },
      { status: 200, headers: getCorsHeaders(origin) }
    );
  } catch (error) {
    console.error("Error loading my groups:", error);

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      {
        status: error instanceof Error && error.message.includes("Token") ? 403 : 500,
        headers: buildFallbackCorsHeaders(origin),
      }
    );
  }
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
