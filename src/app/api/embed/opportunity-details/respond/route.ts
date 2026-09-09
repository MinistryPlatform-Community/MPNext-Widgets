/**
 * Respond (volunteer inquiry) endpoint for the next-opportunity-details widget.
 * POST /api/embed/opportunity-details/respond
 *   body: flat string map (ContactId, FirstName, LastName, EmailAddress,
 *   MobilePhoneNumber, Message, OpportunityId, mp_customform_* ...)
 *
 * Mirrors the legacy OpportunitiesApi/Respond: resolve/create a contact +
 * participant, write a Responses row, and persist any custom-form answers.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireWidgetAuth,
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import { OpportunityDetailsService } from "@/services/opportunityDetailsService";
import { EventDetailsService } from "@/services/eventDetailsService";

export async function POST(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    const claims = await requireWidgetAuth(req, {
      widget: ["opportunity-details", "user-menu", "*"],
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

    const opportunityId = Number(payload.OpportunityId);
    if (!opportunityId || Number.isNaN(opportunityId)) {
      return NextResponse.json(
        { success: false, error: "invalid_request", message: "Missing or invalid OpportunityId" },
        { status: 400, headers: getCorsHeaders(origin) }
      );
    }

    // ContactId comes from the form only (the "Respond As" picker). A blank
    // form means anonymous — the service finds/creates a contact from the typed
    // name/email/phone, matching the legacy InquiryFormTranslator. The session
    // only supplies the audit user id for create attribution.
    const rawContactId = Number(payload.ContactId);
    const contactId = rawContactId && rawContactId > 0 ? rawContactId : null;

    let userId: number | null = null;
    if (claims.sub !== "public") {
      const details = await EventDetailsService.getInstance();
      const user = await details.getUserByGuid(claims.sub);
      if (user) userId = user.User_ID;
    }

    const service = await OpportunityDetailsService.getInstance();
    const responseId = await service.respond({
      opportunityId,
      contactId,
      firstName: (payload.FirstName ?? "").trim(),
      lastName: (payload.LastName ?? "").trim(),
      email: (payload.EmailAddress ?? "").trim(),
      phone: (payload.MobilePhoneNumber ?? "").trim(),
      message: (payload.Message ?? "").trim(),
      userId,
    });

    // Persist any custom-form answers (best-effort; does not block the response).
    const formId = Number(payload.mp_customformformid);
    if (formId && !Number.isNaN(formId)) {
      await service.saveCustomForm(
        formId,
        payload,
        contactId,
        req.headers.get("x-forwarded-for") || null
      );
    }

    return NextResponse.json(
      { success: true, responseId },
      { status: 200, headers: getCorsHeaders(origin) }
    );
  } catch (error) {
    console.error("Error responding to opportunity:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { success: false, message, error: message },
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
