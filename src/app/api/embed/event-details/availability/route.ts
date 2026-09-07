/**
 * Availability-check endpoint for the next-event-details widget.
 * POST /api/embed/event-details/availability
 * Body: { eventId: number, options: { optionPriceId: number, qty: number }[] }
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

interface AvailabilityBody {
  eventId?: number;
  options?: { optionPriceId?: number; qty?: number }[];
}

export async function POST(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    await requireWidgetAuth(req, {
      widget: ["event-details", "user-menu", "*"],
    });

    const body = (await req.json()) as AvailabilityBody;
    const eventId = Number(body.eventId);
    if (!Number.isInteger(eventId) || eventId <= 0) {
      return NextResponse.json(
        { error: "eventId must be a positive integer" },
        { status: 400, headers: buildFallbackCorsHeaders(origin) }
      );
    }

    const options = (body.options ?? [])
      .map((o) => ({
        optionPriceId: Number(o.optionPriceId),
        qty: Number(o.qty),
      }))
      .filter(
        (o) => Number.isFinite(o.optionPriceId) && Number.isFinite(o.qty)
      );

    const service = await EventDetailsService.getInstance();
    const result = await service.checkAvailability(eventId, options);

    return NextResponse.json(result, {
      status: 200,
      headers: getCorsHeaders(origin),
    });
  } catch (error) {
    console.error("Error checking availability:", error);

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
