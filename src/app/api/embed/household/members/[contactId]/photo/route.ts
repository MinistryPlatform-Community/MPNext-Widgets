/**
 * My Household member photo endpoint for embed widgets
 * POST /api/embed/household/members/:contactId/photo - upload a member photo (head of household only)
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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ contactId: string }> }
) {
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

    const { contactId } = await params;
    const contactIdNum = parseInt(contactId, 10);
    if (isNaN(contactIdNum)) {
      return NextResponse.json(
        { error: "Invalid contact ID" },
        { status: 400, headers: getCorsHeaders(origin) }
      );
    }

    // SECURITY: the contact must belong to the caller's household.
    const inHousehold = await service.verifyMemberInHousehold(contactIdNum, user.householdId);
    if (!inHousehold) {
      return NextResponse.json(
        { error: "Contact is not a member of this household." },
        { status: 403, headers: getCorsHeaders(origin) }
      );
    }

    const formData = await req.formData();
    const file = formData.get("photo") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "No photo file provided" },
        { status: 400, headers: getCorsHeaders(origin) }
      );
    }

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Please upload a JPEG, PNG, GIF, or WebP image." },
        { status: 400, headers: getCorsHeaders(origin) }
      );
    }

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 10MB." },
        { status: 400, headers: getCorsHeaders(origin) }
      );
    }

    const result = await service.uploadMemberPhoto(user.householdId, contactIdNum, file);

    return NextResponse.json(
      { success: true, uniqueFileId: result.UniqueFileId },
      { status: 200, headers: getCorsHeaders(origin) }
    );
  } catch (error) {
    console.error("Error uploading household member photo:", error);

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to upload photo" },
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
