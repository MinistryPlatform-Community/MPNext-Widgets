/**
 * Build the signed payment request token handed off to the gateway.
 * GET /api/embed/checkout/payment-token?guid=<Invoice_GUID>&amount=&returnUrl=
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireWidgetAuth,
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import { InvoiceService } from "@/services/invoiceService";
import { CheckoutService } from "@/services/checkoutService";
import type { PaymentRequestToken } from "@mpnext/types";

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    const claims = await requireWidgetAuth(req, {
      widget: ["checkout", "my-invoices", "user-menu", "*"],
    });

    const sp = req.nextUrl.searchParams;
    const guid = sp.get("guid")?.trim();
    if (!guid) {
      return NextResponse.json(
        { error: "Missing guid" },
        { status: 400, headers: getCorsHeaders(origin) }
      );
    }
    const returnUrl = sp.get("returnUrl")?.trim() ?? "";
    const amountParam = Number(sp.get("amount"));

    const service = await InvoiceService.getInstance();

    let mpContactId: number | undefined;
    if (claims.sub !== "public") {
      const user = await service.getUserByGuid(claims.sub);
      mpContactId = user?.Contact_ID;
    }

    const invoice = await service.getCheckoutInvoiceByGuid(guid, mpContactId);
    if (!invoice) {
      return NextResponse.json(
        { error: "Invoice not found" },
        { status: 404, headers: getCorsHeaders(origin) }
      );
    }
    if (!invoice.canPay) {
      return NextResponse.json(
        { error: "Invoice is not payable" },
        { status: 409, headers: getCorsHeaders(origin) }
      );
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

    return NextResponse.json(
      { token },
      { status: 200, headers: getCorsHeaders(origin) }
    );
  } catch (error) {
    console.error("Error building payment token:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { error: message },
      {
        status: message.includes("Token") ? 403 : 500,
        headers: buildFallbackCorsHeaders(origin),
      }
    );
  }
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
