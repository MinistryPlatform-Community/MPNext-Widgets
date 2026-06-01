/**
 * My Household endpoint for embed widgets
 * GET  /api/embed/household - household + members + lookups for the signed-in user
 * PUT  /api/embed/household - update household (head of household only)
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireWidgetAuth,
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import { HouseholdService } from "@/services/householdService";
import { UpdateHouseholdRequestSchema } from "@mpnext/types";
import { z } from "zod";

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    // The household widget can be embedded as a secondary widget (or via the
    // next-user-menu modal) on any page, so it rides on whatever page-level
    // token the host issues. Accept any authenticated widget for the read
    // (still enforces non-public sub). Writes below stay restricted.
    const claims = await requireWidgetAuth(req, { widget: "*" });

    if (claims.sub === "public") {
      return NextResponse.json(
        { error: "Authentication required. Please sign in." },
        { status: 401, headers: getCorsHeaders(origin) }
      );
    }

    const service = await HouseholdService.getInstance();
    const bundle = await service.getHouseholdBundle(claims.sub);

    return NextResponse.json(bundle, { status: 200, headers: getCorsHeaders(origin) });
  } catch (error) {
    console.error("Error loading household:", error);

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      {
        status: error instanceof Error && error.message.includes("Token") ? 403 : 500,
        headers: buildFallbackCorsHeaders(origin),
      }
    );
  }
}

export async function PUT(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    const claims = await requireWidgetAuth(req, { widget: ["my-household", "user-menu"] });

    if (claims.sub === "public") {
      return NextResponse.json(
        { error: "Authentication required. Please sign in." },
        { status: 401, headers: getCorsHeaders(origin) }
      );
    }

    const service = await HouseholdService.getInstance();
    const user = await service.resolveUser(claims.sub);

    if (!user || user.householdId == null) {
      return NextResponse.json(
        { error: "Household not found" },
        { status: 404, headers: getCorsHeaders(origin) }
      );
    }

    if (!user.isHeadOfHousehold) {
      return NextResponse.json(
        { error: "Only the head of household can edit." },
        { status: 403, headers: getCorsHeaders(origin) }
      );
    }

    const body = await req.json();
    const parsed = UpdateHouseholdRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: z.flattenError(parsed.error).fieldErrors },
        { status: 400, headers: getCorsHeaders(origin) }
      );
    }

    const household = await service.updateHousehold(user.householdId, parsed.data);

    return NextResponse.json({ household }, { status: 200, headers: getCorsHeaders(origin) });
  } catch (error) {
    console.error("Error updating household:", error);

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
