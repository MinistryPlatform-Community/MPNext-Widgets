/**
 * Pending-availability endpoint for the next-event-details widget.
 * GET /api/embed/event-details/pending-availability?eventId=
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

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    await requireWidgetAuth(req, {
      widget: ["event-details", "user-menu", "*"],
    });

    const eventId = parseInt(req.nextUrl.searchParams.get("eventId") ?? "", 10);
    if (isNaN(eventId) || eventId <= 0) {
      return NextResponse.json(
        { error: "eventId must be a positive integer" },
        { status: 400, headers: buildFallbackCorsHeaders(origin) }
      );
    }

    const service = await EventDetailsService.getInstance();
    const available = await service.checkPendingEventAvailability(eventId);

    return NextResponse.json(
      { available },
      { status: 200, headers: getCorsHeaders(origin) }
    );
  } catch (error) {
    console.error("Error checking pending availability:", error);

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
