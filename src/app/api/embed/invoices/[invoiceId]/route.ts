/**
 * Invoice detail endpoint for embed widgets
 * GET /api/embed/invoices/:invoiceId - invoice with line items
 *
 * Scoped to the signed-in purchaser (`getInvoiceDetail` filters on
 * `Purchaser_Contact_ID`); another contact's id is a 404.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireWidgetAuth,
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import { errorResponse } from "@/lib/embed/anonymous-write";
import { getMpUserAccessToken } from "@/lib/embed/embed-session";
import { InvoiceService } from "@/services/invoiceService";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const origin = resolveRequestOrigin(req);

  let claims;
  try {
    // The invoices tab is rendered inside the next-user-menu modal on any page,
    // so it rides on whatever page-level token the host issues. Accept any
    // authenticated widget for the read (still enforces non-public sub).
    claims = await requireWidgetAuth(req, { widget: "*" });
  } catch {
    return errorResponse(
      "auth_required",
      "A valid widget token is required.",
      401,
      buildFallbackCorsHeaders(origin)
    );
  }

  const cors = getCorsHeaders(origin);
  if (claims.sub === "public") {
    return errorResponse("auth_required", "Authentication required. Please sign in.", 401, cors);
  }

  const { invoiceId } = await params;
  const invoiceIdNum = parseInt(invoiceId, 10);
  if (isNaN(invoiceIdNum)) {
    return errorResponse("invalid_request", "Invalid invoice ID", 400, cors);
  }

  try {
    const service = await InvoiceService.getInstance();
    const user = await service.getUserByGuid(claims.sub);
    if (!user) {
      return errorResponse("user_not_found", "User not found", 404, cors);
    }

    const detail = await service.getInvoiceDetail(
      invoiceIdNum,
      user.Contact_ID,
      (await getMpUserAccessToken(claims)) ?? undefined
    );
    if (!detail) {
      return errorResponse("invoice_not_found", "Invoice not found", 404, cors);
    }

    return NextResponse.json(detail, { status: 200, headers: cors });
  } catch (error) {
    console.error("[invoices/:id] MP read failed:", error);
    return errorResponse("mp_unavailable", "MP did not respond", 503, cors);
  }
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
