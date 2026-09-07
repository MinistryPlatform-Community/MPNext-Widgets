/**
 * Current basic-contact endpoint for the next-event-details widget.
 * GET /api/embed/event-details/basic-contact
 *
 * Returns the authenticated user's basic contact info to pre-fill the
 * registrant fields. Requires a non-public token.
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
    const claims = await requireWidgetAuth(req, {
      widget: ["event-details", "user-menu", "*"],
    });

    if (claims.sub === "public") {
      return NextResponse.json(
        { error: "Authentication required. Please sign in." },
        { status: 401, headers: getCorsHeaders(origin) }
      );
    }

    const service = await EventDetailsService.getInstance();
    const user = await service.getUserByGuid(claims.sub);
    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404, headers: getCorsHeaders(origin) }
      );
    }

    const contact = await service.getBasicContact(user.User_ID);
    if (!contact) {
      return NextResponse.json(
        { error: "Contact not found" },
        { status: 404, headers: getCorsHeaders(origin) }
      );
    }

    return NextResponse.json(
      { contact },
      { status: 200, headers: getCorsHeaders(origin) }
    );
  } catch (error) {
    console.error("Error loading basic contact:", error);

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
