/**
 * Standalone custom-form submission (non-checkout). Persists a Form_Response +
 * answers via the shared CustomFormService — the same save path event
 * registration uses.
 * POST /api/embed/custom-form/submit  body: flat string map incl. mp_customform_* fields
 *
 * Note: forms with a Product_ID (paid forms that route to checkout) are handled
 * by the checkout flow; this route saves the response only.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireWidgetAuth,
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import { CustomFormService } from "@/services/customFormService";
import { EventDetailsService } from "@/services/eventDetailsService";

export async function POST(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    const claims = await requireWidgetAuth(req, {
      widget: ["custom-form", "user-menu", "*"],
    });

    let payload: Record<string, string>;
    try {
      payload = (await req.json()) as Record<string, string>;
    } catch {
      return NextResponse.json(
        { success: false, error: "invalid_body", message: "Invalid JSON body" },
        { status: 400, headers: getCorsHeaders(origin) }
      );
    }

    const formId = Number(payload.mp_customformformid || payload.formId);
    if (!formId) {
      return NextResponse.json(
        { success: false, error: "invalid_request", message: "Missing form id" },
        { status: 400, headers: getCorsHeaders(origin) }
      );
    }

    const forms = await CustomFormService.getInstance();
    const answers = forms.extractAnswers(payload);

    // Resolve the authenticated contact (optional — forms can be anonymous).
    let contactId: number | null = null;
    if (claims.sub !== "public") {
      const details = await EventDetailsService.getInstance();
      const user = await details.getUserByGuid(claims.sub);
      contactId = user?.Contact_ID ?? null;
    }

    const formResponseId = await forms.saveFormResponse({
      formId,
      contactId,
      ipAddress: req.headers.get("x-forwarded-for") || null,
      answers,
      contact: {
        firstName: payload.FirstName,
        lastName: payload.LastName,
        email: payload.EmailAddress,
        phone: payload.MobilePhoneNumber,
      },
      address: {
        line1: payload.AddressLine1,
        line2: payload.AddressLine2,
        city: payload.City,
        state: payload.StateRegion,
        zip: payload.PostalCode,
      },
    });

    return NextResponse.json(
      { success: true, formResponseId },
      { status: 200, headers: getCorsHeaders(origin) }
    );
  } catch (error) {
    console.error("Error submitting custom form:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { success: false, error: message },
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
