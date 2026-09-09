/**
 * Invoice list endpoint for embed widgets
 * GET /api/embed/invoices - user's invoices
 */

import { NextRequest, NextResponse } from "next/server";
import { requireWidgetAuth, getCorsHeaders, resolveRequestOrigin, buildOptionsResponse, buildFallbackCorsHeaders } from "@/lib/embed/auth";
import { getMpUserAccessToken } from "@/lib/embed/embed-session";
import { InvoiceService } from "@/services/invoiceService";

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    // The invoices tab is rendered inside the next-user-menu modal on any page,
    // so it rides on whatever page-level token the host issues. Accept any
    // authenticated widget for the read (still enforces non-public sub).
    const claims = await requireWidgetAuth(req, { widget: "*" });

    if (claims.sub === "public") {
      return NextResponse.json(
        { error: "auth_required", message: "Authentication required. Please sign in." },
        { status: 401, headers: getCorsHeaders(origin) }
      );
    }

    const service = await InvoiceService.getInstance();
    const user = await service.getUserByGuid(claims.sub);
    if (!user) {
      return NextResponse.json(
        { error: "user_not_found", message: "User not found" },
        { status: 404 }
      );
    }

    const invoices = await service.getInvoices(
      user.Contact_ID,
      (await getMpUserAccessToken(claims)) ?? undefined
    );

    const headers = getCorsHeaders(origin);

    return NextResponse.json(
      { invoices },
      { status: 200, headers }
    );
  } catch (error) {
    console.error("Error loading invoices:", error);

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
