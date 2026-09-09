/**
 * Base invoice-detail-id lookup for the next-event-details widget.
 * GET /api/embed/event-details/invoice-detail?eventParticipantId=
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

    const eventParticipantId = parseInt(
      req.nextUrl.searchParams.get("eventParticipantId") ?? "",
      10
    );
    if (isNaN(eventParticipantId) || eventParticipantId <= 0) {
      return NextResponse.json(
        { error: "invalid_request", message: "eventParticipantId must be a positive integer" },
        { status: 400, headers: buildFallbackCorsHeaders(origin) }
      );
    }

    const service = await EventDetailsService.getInstance();
    const invoiceDetailId =
      await service.getBaseInvoiceDetailId(eventParticipantId);

    return NextResponse.json(
      { invoiceDetailId },
      { status: 200, headers: getCorsHeaders(origin) }
    );
  } catch (error) {
    console.error("Error loading invoice detail id:", error);

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
