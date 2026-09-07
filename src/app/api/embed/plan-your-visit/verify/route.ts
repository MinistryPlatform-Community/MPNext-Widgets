/**
 * Step 2a of Plan Your Visit: validate the email-link token.
 * GET /api/embed/plan-your-visit/verify?token=<mpp-verify-id>
 *   -> { success, firstName, lastName, email, reason? }
 *
 * Returns the name/email embedded in the signed token so the registration form
 * can pre-fill. Fails with reason "invalid"/"expired" for a bad token, or
 * "exists" when a contact with that email already exists.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireWidgetAuth,
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import { PlanYourVisitService } from "@/services/planYourVisitService";
import { verifyVerifyToken } from "@/lib/embed/verify-token";

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    await requireWidgetAuth(req, { widget: ["plan-your-visit", "user-menu", "*"] });

    const token = req.nextUrl.searchParams.get("token") || "";
    const payload = await verifyVerifyToken(token);

    if (!payload) {
      return NextResponse.json(
        { success: false, firstName: null, lastName: null, email: null, reason: "invalid" },
        { status: 200, headers: getCorsHeaders(origin) }
      );
    }

    // Re-check for an existing contact (someone may have registered meanwhile).
    const service = await PlanYourVisitService.getInstance();
    const existing = await service.findContact(payload.firstName, payload.lastName, payload.email);
    if (existing != null) {
      return NextResponse.json(
        { success: false, firstName: null, lastName: null, email: null, reason: "exists" },
        { status: 200, headers: getCorsHeaders(origin) }
      );
    }

    return NextResponse.json(
      {
        success: true,
        firstName: payload.firstName,
        lastName: payload.lastName,
        email: payload.email,
      },
      { status: 200, headers: getCorsHeaders(origin) }
    );
  } catch (error) {
    console.error("Error verifying plan-your-visit token:", error);
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
