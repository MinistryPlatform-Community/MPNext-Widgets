/**
 * Single event detail endpoint for the next-event-details widget.
 * GET /api/embed/event-details/:id
 *
 * Public-allowed: returns the event for anonymous viewers; when an authenticated
 * (non-public) token rides along, the staff flag is resolved so staff-only event
 * fields are surfaced.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireWidgetAuth,
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import { EventDetailsService } from "@/services/eventDetailsService";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const origin = resolveRequestOrigin(req);

  try {
    const claims = await requireWidgetAuth(req, {
      widget: ["event-details", "user-menu", "*"],
    });

    const { id } = await params;
    const eventId = parseInt(id, 10);
    if (isNaN(eventId) || eventId <= 0) {
      return NextResponse.json(
        { error: "Invalid eventId: must be a positive integer" },
        { status: 400, headers: buildFallbackCorsHeaders(origin) }
      );
    }

    const service = await EventDetailsService.getInstance();

    let isUserStaff = false;
    if (claims.sub !== "public") {
      const user = await service.getUserByGuid(claims.sub);
      if (user) {
        const info = await service.getContactInfo(user.User_ID);
        isUserStaff = info.isStaff;
      }
    }

    const event = await service.getEventById(eventId, isUserStaff);

    const headers: HeadersInit = {
      ...getCorsHeaders(origin),
      "Cache-Control": "private, max-age=60",
    };

    return NextResponse.json({ event, isUserStaff }, { status: 200, headers });
  } catch (error) {
    console.error("Error loading event detail:", error);

    const status =
      error instanceof Error && error.message === "Event not found"
        ? 404
        : error instanceof Error && error.message.includes("Token")
          ? 403
          : 500;

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status, headers: buildFallbackCorsHeaders(origin) }
    );
  }
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
