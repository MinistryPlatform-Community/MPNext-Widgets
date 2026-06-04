/**
 * Save-pledge endpoint for the next-pledge-campaign widget.
 * POST /api/embed/pledge-campaign/save
 *
 * Creates a Pledge (resolving/creating the Donor + Contact for anonymous
 * "blank form" submissions) and sends a best-effort confirmation email.
 * Anonymous pledges are allowed (legacy parity), so a public token is accepted;
 * an authenticated caller's User_ID is threaded through for MP audit stamping.
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
import { SavePledgeRequestSchema } from "@mpnext/types";

export async function POST(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    const claims = await requireWidgetAuth(req, {
      widget: ["pledge-campaign", "user-menu", "*"],
    });

    const body = await req.json().catch(() => null);
    const parsed = SavePledgeRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, pledgeId: null, message: "Invalid request body." },
        { status: 400, headers: getCorsHeaders(origin) }
      );
    }

    const service = await PledgeCampaignService.getInstance();

    let userId: number | null = null;
    if (claims.sub !== "public") {
      const user = await service.getUserByGuid(claims.sub);
      userId = user?.User_ID ?? null;
    }

    const result = await service.savePledge(parsed.data, userId);

    return NextResponse.json(result, {
      status: result.success ? 200 : 400,
      headers: getCorsHeaders(origin),
    });
  } catch (error) {
    console.error("Error saving pledge:", error);
    return NextResponse.json(
      {
        success: false,
        pledgeId: null,
        message: error instanceof Error ? error.message : "Internal server error",
      },
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
