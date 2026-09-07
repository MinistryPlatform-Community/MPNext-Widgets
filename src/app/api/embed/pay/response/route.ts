/**
 * Sandbox payment gateway: validate the (fake) card and build a signed
 * payment response token. Mirrors a real vendor's hosted-page callback.
 * POST /api/embed/pay/response  body: { token, cardNumber, ... }
 *
 * SANDBOX RULE: a transaction succeeds only when the card number (digits only)
 * is the Visa test PAN 4111 1111 1111 1111. Everything else is declined.
 */

import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  requireWidgetAuth,
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import { CheckoutService } from "@/services/checkoutService";
import type { PaymentResponseToken } from "@mpnext/types";

const SANDBOX_SUCCESS_PAN = "4111111111111111";

export async function POST(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    await requireWidgetAuth(req, { widget: ["pay", "*"] });

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400, headers: getCorsHeaders(origin) }
      );
    }

    const tokenInput = typeof body.token === "string" ? body.token : "";
    if (!tokenInput) {
      return NextResponse.json(
        { error: "Missing token" },
        { status: 400, headers: getCorsHeaders(origin) }
      );
    }

    const checkout = CheckoutService.getInstance();
    // Decode the request token to copy invoice + payor fields (throws if bad).
    const request = checkout.decodeRequestToken(tokenInput);

    const cardNumber = String(body.cardNumber ?? "").replace(/\s+/g, "");
    const transactionSuccess = cardNumber === SANDBOX_SUCCESS_PAN;
    const type =
      typeof body.type === "string" && body.type ? body.type : "CREDIT_DEBIT";

    const responseToken: PaymentResponseToken = {
      invoiceId: request.invoiceId,
      amount: request.amount,
      transactionSuccess,
      transactionCode: crypto.randomUUID(),
      type,
      itemNumber:
        typeof body.itemNumber === "string" ? body.itemNumber : null,
      firstName: request.firstName,
      lastName: request.lastName,
      email: request.email,
      mobilePhone: request.mobilePhone,
      addressStreet: request.addressStreet,
      addressStreet2: request.addressStreet2,
      addressCity: request.addressCity,
      addressState: request.addressState,
      addressZip: request.addressZip,
    };

    const token = checkout.buildResponseToken(responseToken);

    return NextResponse.json(
      { token },
      { status: 200, headers: getCorsHeaders(origin) }
    );
  } catch (error) {
    console.error("Error building payment response token:", error);
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
