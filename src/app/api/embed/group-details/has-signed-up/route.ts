/**
 * Has-signed-up check for the next-group-details widget.
 * GET /api/embed/group-details/has-signed-up?groupId=&contactId= -> { hasSignedUp }
 *
 * The widget asks this for the contact picked in its "Sign up as" picker, so
 * the answer is only given for the signed-in caller or a member of their
 * household (`canActAsContact`). Any other contact id — or any id at all from a
 * public token — is refused with `403 not_household_member` before MP is read:
 * an open boolean here disclosed, one bit per request, whether any contact in
 * the domain belonged to any group (C12, left open by W3).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireWidgetAuth,
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import { GroupsService } from "@/services/groupsService";
import { canActAsContact } from "@/services/_shared/household-contact";

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    const claims = await requireWidgetAuth(req, { widget: ["group-details", "user-menu", "*"] });

    const sp = req.nextUrl.searchParams;
    const groupId = parseInt(sp.get("groupId") || "", 10);
    const contactId = parseInt(sp.get("contactId") || "", 10);

    if (isNaN(groupId) || isNaN(contactId) || groupId <= 0 || contactId <= 0) {
      return NextResponse.json(
        { hasSignedUp: false },
        { status: 200, headers: getCorsHeaders(origin) }
      );
    }

    if (!(await canActAsContact(claims.sub, contactId))) {
      return NextResponse.json(
        { error: "not_household_member", message: "contactId is not the caller or their household" },
        { status: 403, headers: getCorsHeaders(origin) }
      );
    }

    const service = await GroupsService.getInstance();
    const hasSignedUp = await service.hasSignedUp(groupId, contactId);

    return NextResponse.json(
      { hasSignedUp },
      { status: 200, headers: getCorsHeaders(origin) }
    );
  } catch (error) {
    console.error("Error checking group sign-up:", error);
    const tokenFault = error instanceof Error && error.message.includes("Token");
    return NextResponse.json(
      tokenFault
        ? { error: "forbidden", message: "Token verification failed" }
        : { error: "internal_error", message: "Failed to check group sign-up" },
      { status: tokenFault ? 403 : 500, headers: buildFallbackCorsHeaders(origin) }
    );
  }
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
