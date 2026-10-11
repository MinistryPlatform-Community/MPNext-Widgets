/**
 * Build the signed payment request token handed off to the gateway.
 * GET /api/embed/checkout/payment-token?guid=<Invoice_GUID>&amount=&returnUrl=
 *
 * Same ownership rule as `checkout/invoice`: anonymous holders of the GUID may
 * pay it; a signed-in payer may pay only an invoice they purchased (C80 / C42).
 *
 * The token is single-use (C43): it carries a `jti` recorded open in the KV
 * store, spent by the first successful `pay/response`. An amount above the
 * balance due is refused here, before anything reaches a processor.
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
import { exceedsBalance } from "@/services/paymentService";
import { getPublicUrl } from "../../auth/_lib/auth-route-helpers";
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
  // `receipt-template-id` on next-checkout (C66). Anything but a positive
  // integer is ignored rather than refused: a bad attribute must not block a
  // payment, it just means no receipt.
  const receiptParam = Number(sp.get("receiptTemplateId"));
  const receiptTemplateId =
    Number.isInteger(receiptParam) && receiptParam > 0 ? receiptParam : null;

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

    // The overpay guard that matters (C43): the form's cap is a courtesy.
    // 422 is the widget's cue to reload the invoice — the balance most often
    // moved under it (a payment in another tab) rather than being tampered.
    if (exceedsBalance(amount, invoice.balanceDue)) {
      return errorResponse(
        "invalid_request",
        "Amount exceeds the invoice balance due",
        422,
        cors
      );
    }

    const requestToken: Omit<PaymentRequestToken, "jti"> = {
      invoiceId: invoice.invoiceGuid,
      amount,
      payorContactId: invoice.payorContactId,
      returnUrl,
      // The vendor calls *this* host, not the church page that embedded the
      // widget — the request origin is the latter.
      paymentNotifyUrl: `${getPublicUrl(req)}/api/embed/payment/notify`,
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
      receiptTemplateId,
    };

    const token = await CheckoutService.getInstance().issueRequestToken(requestToken);

    return NextResponse.json({ token }, { status: 200, headers: cors });
  } catch (error) {
    console.error("[checkout/payment-token] failed:", error);
    return errorResponse("mp_unavailable", "MP did not respond", 503, cors);
  }
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
