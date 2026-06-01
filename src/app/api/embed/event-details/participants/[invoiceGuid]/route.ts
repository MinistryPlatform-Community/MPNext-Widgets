/**
 * Existing invoice / participants endpoint for the next-event-details widget.
 * GET /api/embed/event-details/participants/:invoiceGuid
 *
 * Returns the ExistingInvoice payload (re-population data) for an in-progress or
 * completed registration. Public-allowed; when an authenticated user rides
 * along, their MP contact id scopes the invoice read.
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
  { params }: { params: Promise<{ invoiceGuid: string }> }
) {
  const origin = resolveRequestOrigin(req);

  try {
    const claims = await requireWidgetAuth(req, {
      widget: ["event-details", "user-menu", "*"],
    });

    const { invoiceGuid } = await params;
    if (!invoiceGuid || invoiceGuid.trim() === "") {
      return NextResponse.json(
        { error: "Invalid invoice GUID" },
        { status: 400, headers: buildFallbackCorsHeaders(origin) }
      );
    }

    const service = await EventDetailsService.getInstance();

    let mpContactId: number | undefined;
    if (claims.sub !== "public") {
      const user = await service.getUserByGuid(claims.sub);
      mpContactId = user?.Contact_ID;
    }

    const invoice = await service.getEventParticipantsByInvoice(
      invoiceGuid,
      mpContactId
    );

    const headers: HeadersInit = {
      ...getCorsHeaders(origin),
      "Cache-Control": "private, no-store",
    };

    return NextResponse.json(invoice, { status: 200, headers });
  } catch (error) {
    console.error("Error loading event participants:", error);

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
