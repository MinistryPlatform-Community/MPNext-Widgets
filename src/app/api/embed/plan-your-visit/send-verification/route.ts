/**
 * Step 1 of Plan Your Visit: send the email-verification link.
 * POST /api/embed/plan-your-visit/send-verification
 *   body: { firstName, lastName, email, returnUrl, verificationEmailTemplate }
 *   -> { success, contactExists?, message? }
 *
 * Mints a signed verify token, builds a `returnUrl?mpp-verify-id=<token>` link,
 * and emails it from the configured dp_Communications template. When the email
 * already belongs to an existing contact, no email is sent and the widget is
 * told to offer sign-in instead (mirrors the legacy "Contact exists" branch).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireWidgetAuth,
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import { PlanYourVisitService } from "@/services/planYourVisitService";
import { createVerifyToken } from "@/lib/embed/verify-token";
import type { PyvVerifyRequest } from "@mpnext/types";

export async function POST(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    await requireWidgetAuth(req, { widget: ["plan-your-visit", "user-menu", "*"] });

    let body: PyvVerifyRequest;
    try {
      body = (await req.json()) as PyvVerifyRequest;
    } catch {
      return NextResponse.json(
        { success: false, message: "Invalid JSON body" },
        { status: 400, headers: getCorsHeaders(origin) }
      );
    }

    const firstName = (body.firstName || "").trim();
    const lastName = (body.lastName || "").trim();
    const email = (body.email || "").trim();
    const returnUrl = (body.returnUrl || "").trim();
    const templateId = parseInt(String(body.verificationEmailTemplate ?? ""), 10);

    if (!firstName || !lastName || !email || !returnUrl) {
      return NextResponse.json(
        { success: false, message: "First name, last name, email and return URL are required." },
        { status: 422, headers: getCorsHeaders(origin) }
      );
    }
    if (Number.isNaN(templateId) || templateId <= 0) {
      return NextResponse.json(
        { success: false, message: "A verification email template is not configured." },
        { status: 422, headers: getCorsHeaders(origin) }
      );
    }

    const service = await PlanYourVisitService.getInstance();

    const token = await createVerifyToken({ firstName, lastName, email });
    const sep = returnUrl.includes("?") ? "&" : "?";
    const verifyUrl = `${returnUrl}${sep}mpp-verify-id=${encodeURIComponent(token)}`;

    const { contactExists } = await service.sendVerificationEmail({
      firstName,
      lastName,
      email,
      verifyUrl,
      templateId,
    });

    if (contactExists) {
      return NextResponse.json(
        { success: false, contactExists: true, message: "An account already exists for that email." },
        { status: 200, headers: getCorsHeaders(origin) }
      );
    }

    return NextResponse.json(
      { success: true },
      { status: 200, headers: getCorsHeaders(origin) }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("Error sending verification email:", error);
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
