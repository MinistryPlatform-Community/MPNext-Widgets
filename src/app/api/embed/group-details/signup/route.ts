/**
 * Group sign-up submission for the next-group-details widget.
 * POST /api/embed/group-details/signup
 *
 * Requires authentication. Resolves the selected contact's participant record
 * (creating one when missing) and adds a pending Group_Participant using the
 * group type's default role.
 *
 * NOTE: optional participant-confirmation and leader-notification emails the
 * legacy widget could send are not ported in v1 — the Group_Participants record
 * is still created exactly as before.
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
import type { GroupInquiryRequest } from "@mpnext/types";

export async function POST(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    const claims = await requireWidgetAuth(req, {
      widget: ["group-details", "user-menu", "*"],
    });

    if (claims.sub === "public") {
      return NextResponse.json(
        { success: false, message: "Please sign in to sign up for a group." },
        { status: 401, headers: getCorsHeaders(origin) }
      );
    }

    let payload: GroupInquiryRequest;
    try {
      payload = (await req.json()) as GroupInquiryRequest;
    } catch {
      return NextResponse.json(
        { success: false, message: "Invalid JSON body" },
        { status: 400, headers: getCorsHeaders(origin) }
      );
    }

    if (!payload.targetId || payload.targetId <= 0) {
      return NextResponse.json(
        { success: false, message: "A group is required." },
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

    // Default the sign-up to the signed-in contact when the form omits one.
    if (!payload.contactId || payload.contactId <= 0) {
      payload.contactId = user.Contact_ID;
    }

    await service.signUp(payload, user.User_ID);

    return NextResponse.json(
      { success: true },
      { status: 200, headers: getCorsHeaders(origin) }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("Error signing up for group:", error);
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
