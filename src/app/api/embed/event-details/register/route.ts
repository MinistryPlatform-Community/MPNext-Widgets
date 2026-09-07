/**
 * Event registration submission for the next-event-details widget.
 * POST /api/embed/event-details/register
 *
 * Builds the invoice + event participant + custom-form responses and returns
 * the Invoice_GUID. Payment is collected downstream by a separate checkout
 * widget (the legacy widget likewise only built the invoice then redirected).
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

    let payload: Record<string, string>;
    try {
      payload = (await req.json()) as Record<string, string>;
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON body" },
        { status: 400, headers: getCorsHeaders(origin) }
      );
    }

    // Resolve the MP user id for the audit user (null for anonymous).
    let userId: number | null = null;
    if (claims.sub !== "public") {
      const details = await EventDetailsService.getInstance();
      const user = await details.getUserByGuid(claims.sub);
      userId = user?.User_ID ?? null;
    }

    const service = await RegistrationService.getInstance();
    const result = await service.saveRegistration(payload, userId);

    return NextResponse.json(result, { status: 200, headers: getCorsHeaders(origin) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    if (message === "INVOICE-EXPIRED") {
      return NextResponse.json(
        { success: false, message: "INVOICE-EXPIRED" },
        { status: 409, headers: getCorsHeaders(origin) }
      );
    }
    console.error("Error saving registration:", error);
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
