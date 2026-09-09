/**
 * Remove a participant from an in-progress (unpaid) event registration invoice.
 * POST /api/embed/event-details/delete-registration  body: { invoiceDetailId }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireWidgetAuth,
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import { RegistrationService } from "@/services/registrationService";
import { EventDetailsService } from "@/services/eventDetailsService";

export async function POST(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    const claims = await requireWidgetAuth(req, {
      widget: ["event-details", "user-menu", "*"],
    });

    let body: { invoiceDetailId?: number };
    try {
      body = (await req.json()) as { invoiceDetailId?: number };
    } catch {
      return NextResponse.json(
        { success: false, error: "invalid_body", message: "Invalid JSON body" },
        { status: 400, headers: getCorsHeaders(origin) }
      );
    }

    const invoiceDetailId = Number(body.invoiceDetailId);
    if (!invoiceDetailId) {
      return NextResponse.json(
        { success: false, error: "invalid_request", message: "Missing invoiceDetailId" },
        { status: 400, headers: getCorsHeaders(origin) }
      );
    }

    let contactId: number | undefined;
    if (claims.sub !== "public") {
      const details = await EventDetailsService.getInstance();
      const user = await details.getUserByGuid(claims.sub);
      contactId = user?.Contact_ID;
    }

    const service = await RegistrationService.getInstance();
    const result = await service.deleteEventRegistration(invoiceDetailId, contactId);

    return NextResponse.json(result, { status: 200, headers: getCorsHeaders(origin) });
  } catch (error) {
    console.error("Error deleting registration:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { success: false, error: message },
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
