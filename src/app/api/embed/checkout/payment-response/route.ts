/**
 * Process a signed payment response token and record the payment in MP.
 * POST /api/embed/checkout/payment-response  body: { token }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireWidgetAuth,
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import { CheckoutService } from "@/services/checkoutService";
import { PaymentService } from "@/services/paymentService";
import { InvoiceService } from "@/services/invoiceService";

export async function POST(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    const claims = await requireWidgetAuth(req, { widget: ["checkout", "*"] });

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: "invalid_body", message: "Invalid JSON body" },
        { status: 400, headers: getCorsHeaders(origin) }
      );
    }

    const tokenInput = typeof body.token === "string" ? body.token : "";
    if (!tokenInput) {
      return NextResponse.json(
        { error: "invalid_request", message: "Missing token" },
        { status: 400, headers: getCorsHeaders(origin) }
      );
    }

    // Decode + verify the response token (throws if signature/expiry invalid).
    const response = CheckoutService.getInstance().decodeResponseToken(tokenInput);

    // Resolve the audit contact for the authenticated payor, if any.
    let mpContactId: number | undefined;
    if (claims.sub !== "public") {
      const invoiceSvc = await InvoiceService.getInstance();
      const user = await invoiceSvc.getUserByGuid(claims.sub);
      mpContactId = user?.Contact_ID;
    }

    const service = await PaymentService.getInstance();
    const result = await service.createPaymentFromResponse(response, mpContactId);

    return NextResponse.json(
      {
        invoiceId: result.invoiceId,
        success: result.success,
        paymentReceived: result.paymentReceived,
        ...(result.message ? { message: result.message } : {}),
      },
      { status: 200, headers: getCorsHeaders(origin) }
    );
  } catch (error) {
    console.error("Error processing payment response:", error);
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
