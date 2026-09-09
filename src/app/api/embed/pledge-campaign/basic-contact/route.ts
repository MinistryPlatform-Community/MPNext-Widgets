/**
 * Current basic-contact endpoint for the next-pledge-campaign widget.
 * GET /api/embed/pledge-campaign/basic-contact
 *
 * Returns the authenticated user's basic contact info to pre-fill the pledge
 * form's personal-details fields. Requires a non-public token.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireWidgetAuth,
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import { PledgeCampaignService } from "@/services/pledgeCampaignService";

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    const claims = await requireWidgetAuth(req, {
      widget: ["pledge-campaign", "user-menu", "*"],
    });

    if (claims.sub === "public") {
      return NextResponse.json(
        { error: "auth_required", message: "Authentication required. Please sign in." },
        { status: 401, headers: getCorsHeaders(origin) }
      );
    }

    const service = await PledgeCampaignService.getInstance();
    const user = await service.getUserByGuid(claims.sub);
    if (!user) {
      return NextResponse.json(
        { error: "user_not_found", message: "User not found" },
        { status: 404, headers: getCorsHeaders(origin) }
      );
    }

    const contact = await service.getBasicContact(user.Contact_ID);
    if (!contact) {
      return NextResponse.json(
        { error: "contact_not_found", message: "Contact not found" },
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
