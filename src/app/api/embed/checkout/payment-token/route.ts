/**
 * Build the signed payment request token handed off to the gateway.
 * GET /api/embed/checkout/payment-token?guid=<Invoice_GUID>&amount=&returnUrl=
 *
 * Same ownership rule as `checkout/invoice`: anonymous holders of the GUID may
 * pay it; a signed-in payer may pay only an invoice they purchased (C80 / C42).
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
import { CheckoutService } from "@/services/checkoutService";
import type { PaymentRequestToken } from "@mpnext/types";

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
  const sp = req.nextUrl.searchParams;
  const guid = sp.get("guid")?.trim();
  if (!guid) {
    return errorResponse("invalid_request", "Missing guid", 400, cors);
  }
  const returnUrl = sp.get("returnUrl")?.trim() ?? "";
  const amountParam = Number(sp.get("amount"));

  try {
    const service = await InvoiceService.getInstance();
    const owner = await resolveInvoiceOwner(service, claims.sub);
    const invoice = await service.getCheckoutInvoiceByGuid(guid, owner);
    if (!invoice) {
      return errorResponse("invoice_not_found", "Invoice not found", 404, cors);
    }
    if (!invoice.canPay) {
      return errorResponse("invoice_not_payable", "Invoice is not payable", 409, cors);
    }

    const amount =
      Number.isFinite(amountParam) && amountParam > 0
        ? amountParam
        : invoice.balanceDue;

    const requestToken: PaymentRequestToken = {
      invoiceId: invoice.invoiceGuid,
      amount,
      payorContactId: invoice.payorContactId,
      returnUrl,
      paymentNotifyUrl: `${origin}/api/embed/payment/notify`,
      firstName: invoice.payor.firstName,
      lastName: invoice.payor.lastName,
      email: invoice.payor.email,
      mobilePhone: invoice.payor.mobilePhone,
      addressStreet: invoice.payor.addressLine1,
      addressStreet2: invoice.payor.addressLine2,
      addressCity: invoice.payor.city,
      addressState: invoice.payor.state,
      addressZip: invoice.payor.postalCode,
      addressCountry: null,
      fundId: null,
    };

    const token = CheckoutService.getInstance().buildRequestToken(requestToken);

    return NextResponse.json({ token }, { status: 200, headers: cors });
  } catch (error) {
    console.error("[checkout/payment-token] failed:", error);
    return errorResponse("mp_unavailable", "MP did not respond", 503, cors);
  }
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
