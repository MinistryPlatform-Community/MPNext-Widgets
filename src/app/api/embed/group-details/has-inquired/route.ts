/**
 * Has-inquired check for the next-group-details widget.
 * GET /api/embed/group-details/has-inquired?groupId=&contactId= -> { hasInquired }
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

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    await requireWidgetAuth(req, { widget: ["group-details", "user-menu", "*"] });

    const sp = req.nextUrl.searchParams;
    const groupId = parseInt(sp.get("groupId") || "", 10);
    const contactId = parseInt(sp.get("contactId") || "", 10);

    if (isNaN(groupId) || isNaN(contactId) || groupId <= 0 || contactId <= 0) {
      return NextResponse.json(
        { hasInquired: false },
        { status: 200, headers: getCorsHeaders(origin) }
      );
    }

    const service = await GroupsService.getInstance();
    const hasInquired = await service.hasInquired(groupId, contactId);

    return NextResponse.json(
      { hasInquired },
      { status: 200, headers: getCorsHeaders(origin) }
    );
  } catch (error) {
    console.error("Error checking group inquiry:", error);
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
