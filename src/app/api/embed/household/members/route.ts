/**
 * My Household member endpoint for embed widgets
 * POST /api/embed/household/members - create or update a household member (head of household only)
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
import { UpdateHouseholdMemberRequestSchema } from "@mpnext/types";
import { z } from "zod";

export async function POST(req: NextRequest) {
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
    const parsed = UpdateHouseholdMemberRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: z.flattenError(parsed.error).fieldErrors },
        { status: 400, headers: getCorsHeaders(origin) }
      );
    }

    // Never trust a client-supplied household; pin to the caller's household.
    // When editing an existing contact, verify it belongs to the caller's household.
    if (parsed.data.contactId != null) {
      const inHousehold = await service.verifyMemberInHousehold(
        parsed.data.contactId,
        user.householdId
      );
      if (!inHousehold) {
        return NextResponse.json(
          { error: "Contact is not a member of this household." },
          { status: 403, headers: getCorsHeaders(origin) }
        );
      }
    }

    const { members, contactId } = await service.saveMember(user.householdId, parsed.data);

    return NextResponse.json(
      { members, contactId },
      { status: 200, headers: getCorsHeaders(origin) }
    );
  } catch (error) {
    console.error("Error saving household member:", error);

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
