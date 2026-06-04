/**
 * Group inquiry submission for the next-group-details widget.
 * POST /api/embed/group-details/inquire
 *
 * Public-allowed: an anonymous inquiry stores the supplied name/email/phone with
 * no Contact_ID; a signed-in inquiry attaches the selected household contact.
 *
 * NOTE: the legacy widget could also fire an optional confirmation email via an
 * MP message template. That email send is intentionally not ported in v1 — the
 * Group_Inquiries record is still created exactly as before.
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

    let userId: number | null = null;
    if (claims.sub !== "public") {
      const user = await service.getUserByGuid(claims.sub);
      userId = user?.User_ID ?? null;
    }

    await service.createInquiry(payload, userId);

    return NextResponse.json(
      { success: true },
      { status: 200, headers: getCorsHeaders(origin) }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("Error creating group inquiry:", error);
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
