/**
 * My Pledges endpoint for embed widgets
 * GET  /api/embed/my-pledges - user's pledges
 * POST /api/embed/my-pledges - cancel a pledge (status -> Discontinued) and
 *                              send a cancellation confirmation email
 */

import { NextRequest, NextResponse } from "next/server";
import { requireWidgetAuth, getCorsHeaders, resolveRequestOrigin, buildOptionsResponse, buildFallbackCorsHeaders } from "@/lib/embed/auth";
import { MyPledgesService } from "@/services/myPledgesService";
import { CancelPledgeRequestSchema } from "@mpnext/types";

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    const claims = await requireWidgetAuth(req, { widget: ["my-pledges", "user-menu"] });

    if (claims.sub === "public") {
      return NextResponse.json(
        { error: "Authentication required. Please sign in." },
        { status: 401, headers: getCorsHeaders(origin) }
      );
    }

    // ── Congregation (optional; only passed if valid) ──
    const congregationParam = req.nextUrl.searchParams.get("congregationId");
    const parsedCongId = congregationParam ? parseInt(congregationParam, 10) : NaN;
    const congregationId = !Number.isNaN(parsedCongId) ? parsedCongId : undefined;

    const service = await MyPledgesService.getInstance();
    const user = await service.getUserByGuid(claims.sub);
    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // The proc keys off dp_Users.User_ID, so pass User_ID (not Contact_ID).
    const pledges = await service.getPledges(user.User_ID, congregationId);

    return NextResponse.json(
      { pledges },
      { status: 200, headers: getCorsHeaders(origin) }
    );
  } catch (error) {
    console.error("Error loading my pledges:", error);

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      {
        status: error instanceof Error && error.message.includes("Token") ? 403 : 500,
        headers: buildFallbackCorsHeaders(origin),
      }
    );
  }
}

export async function POST(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    const claims = await requireWidgetAuth(req, { widget: ["my-pledges", "user-menu"] });

    if (claims.sub === "public") {
      return NextResponse.json(
        { error: "Authentication required. Please sign in." },
        { status: 401, headers: getCorsHeaders(origin) }
      );
    }

    const body = await req.json().catch(() => null);
    const result = CancelPledgeRequestSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid request body." },
        { status: 400, headers: getCorsHeaders(origin) }
      );
    }
    const parsed = result.data;

    const service = await MyPledgesService.getInstance();
    const user = await service.getUserByGuid(claims.sub);
    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    const owned = await service.verifyPledgeOwnedByContact(
      parsed.pledgeId,
      user.Contact_ID
    );
    if (!owned) {
      return NextResponse.json(
        { error: "You do not have permission to cancel this pledge." },
        { status: 403, headers: getCorsHeaders(origin) }
      );
    }

    await service.cancelPledge(parsed.pledgeId);

    if (parsed.cancelEmailTemplateId && parsed.cancelEmailTemplateId > 0) {
      // Best-effort — the service swallows failures internally.
      await service.sendCancellationEmail(
        parsed.cancelEmailTemplateId,
        user.Contact_ID
      );
    }

    // Re-fetch so the widget can re-render without a second round trip.
    const pledges = await service.getPledges(user.User_ID, parsed.congregationId);

    return NextResponse.json(
      { pledges },
      { status: 200, headers: getCorsHeaders(origin) }
    );
  } catch (error) {
    console.error("Error cancelling pledge:", error);

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
