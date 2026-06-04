/**
 * Has-pledged check for the next-pledge-campaign widget.
 * GET /api/embed/pledge-campaign/has-pledged?campaignId=&contactId=
 *
 * Reports whether a contact already has a pledge for a campaign, used to warn
 * the user when they select a household member who has already pledged.
 * Requires a non-public token.
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
        { error: "Authentication required. Please sign in." },
        { status: 401, headers: getCorsHeaders(origin) }
      );
    }

    const { searchParams } = new URL(req.url);
    const campaignId = parseInt(searchParams.get("campaignId") ?? "", 10);
    const contactId = parseInt(searchParams.get("contactId") ?? "", 10);
    if (isNaN(campaignId) || isNaN(contactId)) {
      return NextResponse.json(
        { error: "campaignId and contactId are required" },
        { status: 400, headers: getCorsHeaders(origin) }
      );
    }

    const service = await PledgeCampaignService.getInstance();
    const hasPledged = await service.hasPledged(campaignId, contactId);

    return NextResponse.json(
      { hasPledged },
      { status: 200, headers: getCorsHeaders(origin) }
    );
  } catch (error) {
    console.error("Error checking has-pledged:", error);
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
