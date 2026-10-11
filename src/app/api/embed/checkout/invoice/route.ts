/**
 * Load a single invoice for the checkout / payment flow.
 * GET /api/embed/checkout/invoice?guid=<Invoice_GUID>
 *
 * Public-allowed: an anonymous payer holding the GUID may open it (legacy
 * parity). A signed-in payer may open only an invoice they purchased — anything
 * else is a 404, never a disclosure (C80 / C42).
 *
 * Errors are machine codes. An MP fault answers `mp_unavailable`; the MP text
 * (procedure name, HTTP status) goes to the server log and never to the payer.
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
import { InvoiceService, resolveInvoiceOwner } from "@/services/invoiceService";

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  let claims;
  try {
    claims = await requireWidgetAuth(req, {
      widget: ["checkout", "my-invoices", "user-menu", "*"],
    });
  } catch {
    return errorResponse(
      "auth_required",
      "A valid widget token is required.",
      401,
      buildFallbackCorsHeaders(origin)
    );
  }

  const cors = getCorsHeaders(origin);
  const guid = req.nextUrl.searchParams.get("guid")?.trim();
  if (!guid) {
    return errorResponse("invalid_request", "Missing guid", 400, cors);
  }

  try {
    const service = await InvoiceService.getInstance();
    const owner = await resolveInvoiceOwner(service, claims.sub);
    const invoice = await service.getCheckoutInvoiceByGuid(guid, owner);
    if (!invoice) {
      return errorResponse("invoice_not_found", "Invoice not found", 404, cors);
    }

    return NextResponse.json({ invoice }, { status: 200, headers: cors });
  } catch (error) {
    console.error("[checkout/invoice] MP read failed:", error);
    return errorResponse("mp_unavailable", "MP did not respond", 503, cors);
  }
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
