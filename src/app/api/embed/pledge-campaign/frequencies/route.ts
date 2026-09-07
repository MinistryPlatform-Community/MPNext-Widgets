/**
 * Pledge frequency lookup for the next-pledge-campaign widget.
 * GET /api/embed/pledge-campaign/frequencies
 *
 * Returns the fixed frequency options (Weekly, Monthly, …) the installment
 * math keys off of. Public-readable.
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
    await requireWidgetAuth(req, {
      widget: ["pledge-campaign", "user-menu", "*"],
    });

    const service = await PledgeCampaignService.getInstance();
    const frequencies = service.getFrequencies();

    return NextResponse.json(
      { frequencies },
      {
        status: 200,
        headers: { ...getCorsHeaders(origin), "Cache-Control": "public, max-age=3600" },
      }
    );
  } catch (error) {
    console.error("Error loading pledge frequencies:", error);
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
