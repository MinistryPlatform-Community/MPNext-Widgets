/**
 * Invoice list endpoint for embed widgets
 * GET /api/embed/invoices - user's invoices
 */

import { NextRequest, NextResponse } from "next/server";
import { requireWidgetAuth, getCorsHeaders, resolveRequestOrigin, buildOptionsResponse, buildFallbackCorsHeaders } from "@/lib/embed/auth";
import { getTenantConfig } from "@/lib/embed/config";
import { InvoiceService } from "@/services/invoiceService";

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    const claims = await requireWidgetAuth(req, { widget: ["invoices", "user-menu"] });

    if (claims.sub === "public") {
      const tenant = await getTenantConfig(claims.tid);
      return NextResponse.json(
        { error: "Authentication required. Please sign in." },
        { status: 401, headers: getCorsHeaders(origin, tenant?.allowedOrigins || []) }
      );
    }

    const service = await InvoiceService.getInstance();
    const user = await service.getUserByGuid(claims.sub);
    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    const invoices = await service.getInvoices(
      user.Contact_ID,
      claims.mpAccessToken || undefined
    );

    const tenant = await getTenantConfig(claims.tid);
    const headers = getCorsHeaders(origin, tenant?.allowedOrigins || []);

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
