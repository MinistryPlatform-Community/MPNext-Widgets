/**
 * Member search endpoint for the next-online-directory widget.
 * GET /api/embed/online-directory?keyword=&congregationId=
 *
 * Authentication + directory access required.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireWidgetAuth,
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import { OnlineDirectoryService } from "@/services/onlineDirectoryService";

function parseIntParam(value: string | null): number | null {
  if (!value) return null;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
}

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    const claims = await requireWidgetAuth(req, { widget: "*" });
    if (claims.sub === "public") {
      return NextResponse.json(
        { error: "auth_required", message: "Authentication required. Please sign in." },
        { status: 401, headers: getCorsHeaders(origin) }
      );
    }

    const service = await OnlineDirectoryService.getInstance();
    const user = await service.getUserByGuid(claims.sub);
    if (!user || !(await service.canAccessDirectory(user.Contact_ID))) {
      return NextResponse.json(
        { error: "directory_forbidden", message: "You do not have access to the directory." },
        { status: 403, headers: getCorsHeaders(origin) }
      );
    }

    const sp = req.nextUrl.searchParams;
    const members = await service.search({
      keyword: sp.get("keyword") ?? "",
      congregationId: parseIntParam(sp.get("congregationId")),
    });

    return NextResponse.json(
      { members },
      { status: 200, headers: getCorsHeaders(origin) }
    );
  } catch (error) {
    console.error("Error searching directory:", error);
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
