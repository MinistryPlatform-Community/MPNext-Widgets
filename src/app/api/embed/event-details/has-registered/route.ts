/**
 * Registration-check endpoint for the next-event-details widget.
 * GET /api/embed/event-details/has-registered?eventId=&contactId=
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

    const sp = req.nextUrl.searchParams;
    const eventId = parseInt(sp.get("eventId") ?? "", 10);
    const contactId = parseInt(sp.get("contactId") ?? "", 10);

    if (isNaN(eventId) || eventId <= 0 || isNaN(contactId) || contactId <= 0) {
      return NextResponse.json(
        { error: "eventId and contactId must be positive integers" },
        { status: 400, headers: buildFallbackCorsHeaders(origin) }
      );
    }

    const service = await EventDetailsService.getInstance();
    const hasRegistered = await service.hasRegistered(eventId, contactId);

    return NextResponse.json(
      { hasRegistered },
      { status: 200, headers: getCorsHeaders(origin) }
    );
  } catch (error) {
    console.error("Error checking registration:", error);

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
