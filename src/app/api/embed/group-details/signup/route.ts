/**
 * Group sign-up submission for the next-group-details widget.
 * POST /api/embed/group-details/signup
 *
 * Requires authentication. Resolves the selected household contact — or, for
 * "Someone else…" (C14), finds or creates the typed person — then their
 * participant record (creating one when missing), and adds a Group_Participant
 * using the group type's default role.
 *
 * `signup-email-template` sends a confirmation to the person signed up, and
 * `leader-signup-email-template` notifies the group's leaders (C11). Both are
 * `dp_Communications` message templates and both are best-effort: a template
 * fault answers `200 { success: true, warning: "email_not_sent" }`.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireWidgetAuth,
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import {
  GroupsService,
  IncompleteIdentityError,
  NotHouseholdMemberError,
} from "@/services/groupsService";
import type { GroupInquiryRequest } from "@mpnext/types";

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

    if (claims.sub === "public") {
      return NextResponse.json(
        { success: false, message: "Please sign in to sign up for a group." },
        { status: 401, headers: getCorsHeaders(origin) }
      );
    }

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
    const user = await service.getUserByGuid(claims.sub);
    if (!user) {
      return NextResponse.json(
        { success: false, message: "User not found" },
        { status: 404, headers: getCorsHeaders(origin) }
      );
    }

    // Default the sign-up to the signed-in contact when the form names no one —
    // neither a picked contact nor a typed "Someone else…" identity (C14).
    const typedSomeoneElse = Boolean(payload.firstName || payload.lastName || payload.emailAddress);
    if ((!payload.contactId || payload.contactId <= 0) && !typedSomeoneElse) {
      payload.contactId = user.Contact_ID;
    }

    let emailed = true;
    try {
      const who = await service.signUp(payload, {
        userId: user.User_ID,
        contactId: user.Contact_ID,
      });
      emailed = await service.sendSignupEmails(payload.targetId, who, payload.message, {
        signup: templateId(payload.signupEmailTemplate),
        leaderSignup: templateId(payload.leaderSignupEmailTemplate),
      });
    } catch (err) {
      if (err instanceof NotHouseholdMemberError) {
        return NextResponse.json(
          { success: false, error: "not_household_member", message: err.message },
          { status: 403, headers: getCorsHeaders(origin) }
        );
      }
      if (err instanceof IncompleteIdentityError) {
        return NextResponse.json(
          { success: false, error: "validation_failed", message: err.message },
          { status: 422, headers: getCorsHeaders(origin) }
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
    console.error("Error signing up for group:", error);
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
