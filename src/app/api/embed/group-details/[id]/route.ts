/**
 * Single group detail endpoint for the next-group-details widget.
 * GET /api/embed/group-details/:id?showFullAddress=&countGroupInquiries=
 *
 * Public-allowed: returns the group for anonymous viewers; when an authenticated
 * token rides along, the user's inquiry / sign-up flags are resolved so the
 * widget can warn about prior activity.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireWidgetAuth,
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import { GroupsService } from "@/services/groupsService";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const origin = resolveRequestOrigin(req);

  try {
    const claims = await requireWidgetAuth(req, {
      widget: ["group-details", "user-menu", "*"],
    });

    const { id } = await params;
    const groupId = parseInt(id, 10);
    if (isNaN(groupId) || groupId <= 0) {
      return NextResponse.json(
        { error: "invalid_request", message: "Invalid groupId: must be a positive integer" },
        { status: 400, headers: buildFallbackCorsHeaders(origin) }
      );
    }

    const sp = req.nextUrl.searchParams;
    const showFullAddress = sp.get("showFullAddress") === "true";
    const countGroupInquiries = sp.get("countGroupInquiries") === "true";

    const service = await GroupsService.getInstance();

    let userId: number | null = null;
    if (claims.sub !== "public") {
      const user = await service.getUserByGuid(claims.sub);
      userId = user?.User_ID ?? null;
    }

    const group = await service.getGroupDetails(
      groupId,
      showFullAddress,
      countGroupInquiries,
      userId
    );

    if (!group) {
      return NextResponse.json(
        { error: "group_not_found", message: "Group not found" },
        { status: 404, headers: buildFallbackCorsHeaders(origin) }
      );
    }

    return NextResponse.json(
      { group },
      {
        status: 200,
        headers: { ...getCorsHeaders(origin), "Cache-Control": "private, max-age=60" },
      }
    );
  } catch (error) {
    console.error("Error loading group detail:", error);
    const status =
      error instanceof Error && error.message.includes("Token") ? 403 : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status, headers: buildFallbackCorsHeaders(origin) }
    );
  }
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
