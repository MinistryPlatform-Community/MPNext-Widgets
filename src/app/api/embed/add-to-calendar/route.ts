/**
 * Add-to-calendar event data endpoint for embed widgets
 * GET /api/embed/add-to-calendar?eventId=<id>
 * Public widget auth — no user sign-in required.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireWidgetAuth, getCorsHeaders, resolveRequestOrigin, buildOptionsResponse, buildFallbackCorsHeaders } from "@/lib/embed/auth";
import { AddToCalendarService } from "@/services/addToCalendarService";

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    const claims = await requireWidgetAuth(req, { widget: "add-to-calendar" });

    const url = new URL(req.url);
    const eventIdParam = url.searchParams.get("eventId");
    const eventId = parseInt(eventIdParam || "", 10);

    if (!eventIdParam || isNaN(eventId) || eventId <= 0) {
      return NextResponse.json(
        { error: "Missing required parameter: eventId" },
        { status: 400, headers: buildFallbackCorsHeaders(origin) }
      );
    }

    const service = await AddToCalendarService.getInstance();
    const eventData = await service.getEventForCalendar(eventId);

    if (!eventData) {
      return NextResponse.json(
        { error: `Event not found: ${eventId}` },
        { status: 404, headers: buildFallbackCorsHeaders(origin) }
      );
    }

    const headers = {
      ...getCorsHeaders(origin),
      "Cache-Control": "public, max-age=300",
    };

    return NextResponse.json(eventData, { status: 200, headers });
  } catch (error) {
    console.error("Error loading event for calendar:", error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      {
        status:
          error instanceof Error && error.message.includes("Token") ? 403 : 500,
        headers: buildFallbackCorsHeaders(origin),
      }
    );
  }
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
