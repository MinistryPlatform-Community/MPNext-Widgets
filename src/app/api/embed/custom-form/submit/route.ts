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
import {
  canActAsContact,
  getContactBasics,
  type ContactBasics,
} from "@/services/_shared/household-contact";

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

    // Who the response is filed against (C26).
    //  - No `ContactId` key (anonymous, or an embed predating the picker):
    //    the signed-in caller, as before; null when anonymous.
    //  - `ContactId: ""` ("Someone else (blank form)"): nobody. The typed
    //    details describe a person who is not the caller.
    //  - `ContactId: <id>`: that contact, **only** when the caller may act as
    //    them (self or household), and then their details come from MP's own
    //    record, not from the client (same rule as C21 / C12).
    let contactId: number | null = null;
    let picked: ContactBasics | null = null;
    if (Object.prototype.hasOwnProperty.call(payload, "ContactId")) {
      const raw = String(payload.ContactId ?? "").trim();
      if (raw !== "") {
        const requested = Number(raw);
        if (!(await canActAsContact(claims.sub, requested))) {
          return NextResponse.json(
            { success: false, error: "not_household_member", message: "ContactId is not the caller or their household" },
            { status: 403, headers: getCorsHeaders(origin) }
          );
        }
        contactId = requested;
        picked = await getContactBasics(requested);
      }
    } else if (claims.sub !== "public") {
      const details = await EventDetailsService.getInstance();
      const user = await details.getUserByGuid(claims.sub);
      contactId = user?.Contact_ID ?? null;
    }

    const typedOr = (fromRecord: string | null | undefined, typed: string | undefined) =>
      fromRecord || typed;

    const formResponseId = await forms.saveFormResponse({
      formId,
      contactId,
      ipAddress: req.headers.get("x-forwarded-for") || null,
      answers,
      contact: {
        firstName: typedOr(picked?.firstName, payload.FirstName),
        lastName: typedOr(picked?.lastName, payload.LastName),
        email: typedOr(picked?.email, payload.EmailAddress),
        phone: typedOr(picked?.phone, payload.MobilePhoneNumber),
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
