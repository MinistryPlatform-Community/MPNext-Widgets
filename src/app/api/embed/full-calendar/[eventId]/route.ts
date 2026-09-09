/**
 * Single event detail endpoint for embed widgets
 * GET /api/embed/full-calendar/:eventId
 */

import { NextRequest, NextResponse } from "next/server";
import { requireWidgetAuth, getCorsHeaders, resolveRequestOrigin, buildOptionsResponse, buildFallbackCorsHeaders } from "@/lib/embed/auth";
import { FullCalendarService } from "@/services/fullCalendarService";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const origin = resolveRequestOrigin(req);

  try {
    // Accept the page's user-menu token too: the sign-in widget lives in the
    // shared header on every page, so the page session is scoped to user-menu.
    const claims = await requireWidgetAuth(req, { widget: ["full-calendar", "user-menu"] });

    const { eventId: eventIdParam } = await params;
    const eventId = parseInt(eventIdParam, 10);

    if (isNaN(eventId) || eventId <= 0) {
      return NextResponse.json(
        { error: "invalid_request", message: "Invalid eventId: must be a positive integer" },
        { status: 400, headers: buildFallbackCorsHeaders(origin) }
      );
    }

    const userGuid = claims.sub !== "public" ? claims.sub : undefined;

    const service = await FullCalendarService.getInstance();
    const result = await service.getEventDetail(eventId, userGuid);

    const headers: HeadersInit = {
      ...getCorsHeaders(origin),
      "Cache-Control": "private, max-age=60",
    };

    return NextResponse.json(result, { status: 200, headers });
  } catch (error) {
    console.error("Error loading event detail:", error);

    const status =
      error instanceof Error && error.message === "Event not found"
        ? 404
        : error instanceof Error && error.message.includes("Token")
          ? 403
          : 500;

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status, headers: buildFallbackCorsHeaders(origin) }
    );
  }
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
