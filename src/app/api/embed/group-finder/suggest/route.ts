/**
 * Suggest-a-group submission for the next-group-finder widget.
 * POST /api/embed/group-finder/suggest
 *
 * Requires authentication. Creates an offline (Available_Online = false) Group
 * record using the SuggestGroup_MinistryId / SuggestGroup_GroupTypeId config
 * settings, attributed to the signed-in user as Primary_Contact.
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
import type { SuggestGroupRequest } from "@mpnext/types";

export async function POST(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    const claims = await requireWidgetAuth(req, {
      widget: ["group-finder", "user-menu", "*"],
    });

    if (claims.sub === "public") {
      return NextResponse.json(
        { success: false, message: "Please sign in to suggest a group." },
        { status: 401, headers: getCorsHeaders(origin) }
      );
    }

    let payload: SuggestGroupRequest;
    try {
      payload = (await req.json()) as SuggestGroupRequest;
    } catch {
      return NextResponse.json(
        { success: false, message: "Invalid JSON body" },
        { status: 400, headers: getCorsHeaders(origin) }
      );
    }

    if (!payload.groupName || !payload.description || !payload.newGroupCongregationId) {
      return NextResponse.json(
        { success: false, message: "Group name, description and congregation are required." },
        { status: 422, headers: getCorsHeaders(origin) }
      );
    }

    const service = await GroupsService.getInstance();
    const user = await service.getUserByGuid(claims.sub);
    if (!user) {
      return NextResponse.json(
        { success: false, message: "User not found" },
        { status: 404, headers: getCorsHeaders(origin) }
      );
    }

    await service.suggestGroup(payload, user.Contact_ID, user.User_ID);

    return NextResponse.json(
      { success: true },
      { status: 200, headers: getCorsHeaders(origin) }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("Error suggesting group:", error);
    return NextResponse.json(
      { success: false, message },
      {
        status: message.includes("Token") ? 403 : 500,
        headers: buildFallbackCorsHeaders(origin),
      }
    );
  }
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
