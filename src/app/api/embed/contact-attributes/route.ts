/**
 * Contact attributes for the signed-in congregant (C52).
 *
 * `GET`  — the member-visible universe plus the contact's selection, grouped
 *          and sorted. One round trip where legacy needed two.
 * `PUT`  — the **complete** desired set, and the recomputed read payload back.
 *
 * The contact id comes from `claims.sub` and nowhere else: the route accepts no
 * contact id in the body or the query, so there is no IDOR to defend. What it
 * does defend is *which attributes* may be written — see `invalid_attribute`
 * below, and `InvalidAttributeError` in the service.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  buildFallbackCorsHeaders,
  buildOptionsResponse,
  getCorsHeaders,
  requireWidgetAuth,
  resolveRequestOrigin,
} from "@/lib/embed/auth";
import {
  ContactAttributeService,
  InvalidAttributeError,
} from "@/services/contactAttributeService";
import { ContactAttributesUpdateSchema } from "@mpnext/types";

const WIDGET = "contact-attributes";

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  let claims;
  try {
    claims = await requireWidgetAuth(req, { widget: WIDGET });
  } catch {
    // Never echo the auth failure's detail: it distinguishes "bad token" from
    // "wrong origin" from "wrong widget" for an unauthenticated caller.
    return NextResponse.json(
      { error: "auth_required", message: "A valid widget token is required" },
      { status: 401, headers: buildFallbackCorsHeaders(origin) }
    );
  }

  const headers = getCorsHeaders(origin);

  if (claims.sub === "public") {
    return NextResponse.json(
      { error: "auth_required", message: "Authentication required" },
      { status: 401, headers }
    );
  }

  try {
    const service = await ContactAttributeService.getInstance();
    const contactId = await service.getContactIdByUserGuid(claims.sub);
    if (contactId === null) {
      return NextResponse.json(
        { error: "user_not_found", message: "No contact is linked to this account" },
        { status: 404, headers }
      );
    }

    // An empty `types` is a 200, deliberately. A fresh MP domain has no
    // `Available_Online` attribute type, and answering 4xx would make the demo
    // page look broken on day one; the widget renders an explanatory state.
    const types = await service.getForContact(contactId);
    return NextResponse.json({ types }, { status: 200, headers });
  } catch (error) {
    console.error("Error loading contact attributes:", error);
    return NextResponse.json(
      { error: "internal_error", message: "Failed to load contact attributes" },
      { status: 500, headers }
    );
  }
}

export async function PUT(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  let claims;
  try {
    claims = await requireWidgetAuth(req, { widget: WIDGET });
  } catch {
    return NextResponse.json(
      { error: "auth_required", message: "A valid widget token is required" },
      { status: 401, headers: buildFallbackCorsHeaders(origin) }
    );
  }

  const headers = getCorsHeaders(origin);

  if (claims.sub === "public") {
    return NextResponse.json(
      { error: "auth_required", message: "Authentication required" },
      { status: 401, headers }
    );
  }

  try {
    const body = await req.json().catch(() => null);
    const parsed = ContactAttributesUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_request", message: "Expected { attributeIds: number[] }" },
        { status: 400, headers }
      );
    }

    const service = await ContactAttributeService.getInstance();
    const contactId = await service.getContactIdByUserGuid(claims.sub);
    if (contactId === null) {
      return NextResponse.json(
        { error: "user_not_found", message: "No contact is linked to this account" },
        { status: 404, headers }
      );
    }

    try {
      const types = await service.setForContact(contactId, parsed.data.attributeIds);
      return NextResponse.json({ types }, { status: 200, headers });
    } catch (error) {
      if (error instanceof InvalidAttributeError) {
        // Legacy wrote whatever it was handed. The rejected ids are logged and
        // never echoed: telling the caller which of them exist would turn the
        // guard into an enumeration oracle for the church's private types.
        console.warn(
          `contact-attributes: rejected ${error.attributeIds.length} attribute id(s) outside the member-visible universe`
        );
        return NextResponse.json(
          // On one line because `i18n/error-codes.test.ts` reads these sources
          // textually and wants the `message:` beside its `error:`.
          { error: "invalid_attribute", message: "An attribute is not available online" },
          { status: 400, headers }
        );
      }
      throw error;
    }
  } catch (error) {
    console.error("Error saving contact attributes:", error);
    return NextResponse.json(
      { error: "internal_error", message: "Failed to save contact attributes" },
      { status: 500, headers }
    );
  }
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
