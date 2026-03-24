/**
 * Invoice detail endpoint for embed widgets
 * GET /api/embed/invoices/:invoiceId - invoice with line items
 */

import { NextRequest, NextResponse } from "next/server";
import { requireWidgetAuth, getCorsHeaders, resolveRequestOrigin, buildOptionsResponse, buildFallbackCorsHeaders } from "@/lib/embed/auth";
import { InvoiceService } from "@/services/invoiceService";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const origin = resolveRequestOrigin(req);

  try {
    const claims = await requireWidgetAuth(req, { widget: ["invoices", "user-menu"] });

    if (claims.sub === "public") {
      return NextResponse.json(
        { error: "Authentication required. Please sign in." },
        { status: 401, headers: getCorsHeaders(origin) }
      );
    }

    const { invoiceId } = await params;
    const invoiceIdNum = parseInt(invoiceId, 10);
    if (isNaN(invoiceIdNum)) {
      return NextResponse.json(
        { error: "Invalid invoice ID" },
        { status: 400, headers: getCorsHeaders(origin) }
      );
    }

    const service = await InvoiceService.getInstance();
    const user = await service.getUserByGuid(claims.sub);
    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404, headers: getCorsHeaders(origin) }
      );
    }

    const detail = await service.getInvoiceDetail(
      invoiceIdNum,
      user.Contact_ID,
      claims.mpAccessToken || undefined
    );
    if (!detail) {
      return NextResponse.json(
        { error: "Invoice not found" },
        { status: 404, headers: getCorsHeaders(origin) }
      );
    }

    const headers = getCorsHeaders(origin);

    return NextResponse.json(detail, { status: 200, headers });
  } catch (error) {
    console.error("Error loading invoice detail:", error);

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
