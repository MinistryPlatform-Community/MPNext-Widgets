/**
 * Pledge campaign detail endpoint for the next-pledge-campaign widget.
 * GET /api/embed/pledge-campaign/:id
 *
 * Public-readable (campaign progress is shown to anonymous visitors). When the
 * caller is authenticated, also reports whether they have already pledged so
 * the widget can surface the "already pledged" warning.
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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const origin = resolveRequestOrigin(req);

  try {
    const claims = await requireWidgetAuth(req, {
      widget: ["pledge-campaign", "user-menu", "*"],
    });

    const { id } = await params;
    const campaignId = parseInt(id, 10);
    if (isNaN(campaignId) || campaignId <= 0) {
      return NextResponse.json(
        { error: "invalid_request", message: "Invalid campaign id: must be a positive integer" },
        { status: 400, headers: buildFallbackCorsHeaders(origin) }
      );
    }

    const service = await PledgeCampaignService.getInstance();
    const campaign = await service.getCampaign(campaignId);
    if (!campaign) {
      return NextResponse.json(
        { error: "campaign_not_found", message: "Pledge campaign not found" },
        { status: 404, headers: buildFallbackCorsHeaders(origin) }
      );
    }

    let userHasAlreadyPledged = false;
    if (claims.sub !== "public") {
      const user = await service.getUserByGuid(claims.sub);
      if (user) {
        userHasAlreadyPledged = await service.hasPledged(
          campaignId,
          user.Contact_ID
        );
      }
    }

    return NextResponse.json(
      { campaign, userHasAlreadyPledged },
      {
        status: 200,
        headers: { ...getCorsHeaders(origin), "Cache-Control": "private, max-age=30" },
      }
    );
  } catch (error) {
    console.error("Error loading pledge campaign:", error);
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
