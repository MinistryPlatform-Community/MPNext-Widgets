/**
 * Group inquiry submission for the next-group-details widget.
 * POST /api/embed/group-details/inquire
 *
 * Public-allowed: an anonymous inquiry stores the supplied name/email/phone with
 * no Contact_ID; a signed-in inquiry attaches the selected household contact,
 * whose name/email/phone are read from MP rather than taken from the request
 * (C12). A contact outside the caller's household is refused with
 * `not_household_member`.
 *
 * When the widget carries `inquiry-email-template`, a confirmation is sent to
 * the inquirer from that `dp_Communications` message template (C11). The send
 * is best-effort: a template fault answers `200 { success: true, warning:
 * "email_not_sent" }`, because the inquiry row is already written.
 *
 * Anonymous inquiries are rate-limited per IP (fail-closed): the route writes
 * an MP record and can send email to a typed address.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireWidgetAuth,
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
  getClientIp,
} from "@/lib/embed/auth";
import { checkRateLimit } from "@/lib/embed/rate-limit";
import { GroupsService, NotHouseholdMemberError } from "@/services/groupsService";
import type { GroupInquiryRequest } from "@mpnext/types";

/** Anonymous inquiries allowed per IP per hour. */
const ANON_INQUIRIES_PER_HOUR = 10;

function templateId(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function POST(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    const claims = await requireWidgetAuth(req, {
      widget: ["group-details", "user-menu", "*"],
    });

    let payload: GroupInquiryRequest;
    try {
      payload = (await req.json()) as GroupInquiryRequest;
    } catch {
      return NextResponse.json(
        { success: false, message: "Invalid JSON body" },
        { status: 400, headers: getCorsHeaders(origin) }
      );
    }

    if (!payload.targetId || payload.targetId <= 0) {
      return NextResponse.json(
        { success: false, message: "A group is required." },
        { status: 422, headers: getCorsHeaders(origin) }
      );
    }

    const service = await GroupsService.getInstance();

    let userId: number | null = null;
    let actorContactId: number | null = null;
    if (claims.sub !== "public") {
      const user = await service.getUserByGuid(claims.sub);
      userId = user?.User_ID ?? null;
      actorContactId = user?.Contact_ID ?? null;
    }

    if (claims.sub === "public") {
      const rate = await checkRateLimit(
        `group-inquiry:ip:${getClientIp(req)}`,
        ANON_INQUIRIES_PER_HOUR,
        { windowSeconds: 3600, failClosed: true }
      );
      if (!rate.ok) {
        return NextResponse.json(
          { success: false, error: "rate_limited", message: "Too many inquiries" },
          { status: 429, headers: getCorsHeaders(origin) }
        );
      }
    }

    let emailed = true;
    try {
      const who = await service.createInquiry(payload, { userId, contactId: actorContactId });
      emailed = await service.sendInquiryEmails(payload.targetId, who, payload.message, {
        inquiry: templateId(payload.inquiryEmailTemplate),
      });
    } catch (err) {
      if (err instanceof NotHouseholdMemberError) {
        return NextResponse.json(
          { success: false, error: "not_household_member", message: err.message },
          { status: 403, headers: getCorsHeaders(origin) }
        );
      }
      throw err;
    }

    return NextResponse.json(
      emailed ? { success: true } : { success: true, warning: "email_not_sent" },
      { status: 200, headers: getCorsHeaders(origin) }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("Error creating group inquiry:", error);
    return NextResponse.json(
      { success: false, message },
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
