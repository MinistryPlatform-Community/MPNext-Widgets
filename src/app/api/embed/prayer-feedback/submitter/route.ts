/**
 * `GET /api/embed/prayer-feedback/submitter` — who a signed-in member may file
 * for (C69).
 *
 * Backs legacy's *"Provide Feedback As"* dropdown, which is the one legacy
 * affordance members actually use: without it a spouse's prayer request gets
 * filed against the wrong contact.
 *
 * ## Why it is not folded into `/types`
 *
 * `/types` is `Cache-Control: public, max-age=600` — a lookup table with nothing
 * personal in it. This is per-user household data, so it answers `no-store` and
 * is a separate endpoint rather than a conditional branch in a cacheable one.
 * Merging them would put one household's member names in a shared cache.
 *
 * ## What it deliberately does not return
 *
 * Names and contact ids, and a `hasEmail` **boolean** — never the addresses.
 * The widget's only question is whether to show the email field (legacy's
 * `ShowHideEmailContainer`), and shipping a household's addresses to the browser
 * to answer a yes/no is a disclosure the flow does not require. The contact ids
 * are not a capability: `/submit` re-checks household membership server-side on
 * every write.
 *
 * Unlike the other three prayer-feedback routes this one requires a real
 * subject. It is not part of the anonymous surface — there is nothing to answer
 * for a visitor with no MP account — and a `public` token gets `auth_required`.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireWidgetAuth,
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import { errorResponse } from "@/lib/embed/anonymous-write";
import { PrayerFeedbackService } from "@/services/prayerFeedbackService";
import type { PrayerFeedbackSubmitterResponse } from "@mpnext/types";

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  let sub: string;
  try {
    const claims = await requireWidgetAuth(req, { widget: ["prayer-feedback", "*"] });
    sub = claims.sub;
  } catch {
    return errorResponse(
      "auth_required",
      "A valid widget token is required.",
      401,
      buildFallbackCorsHeaders(origin)
    );
  }

  const cors = getCorsHeaders(origin);

  if (sub === "public") {
    return errorResponse(
      "auth_required",
      "A signed-in widget token is required to list household submitters.",
      401,
      cors
    );
  }

  try {
    const service = await PrayerFeedbackService.getInstance();
    const contactId = await service.getContactIdByUserGuid(sub);
    if (contactId == null) {
      return errorResponse(
        "contact_not_found",
        "No Contacts row is linked to the signed-in user.",
        404,
        cors
      );
    }

    const body: PrayerFeedbackSubmitterResponse =
      await service.getSubmitterOptions(contactId);

    return NextResponse.json(body, {
      status: 200,
      headers: { ...cors, "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("[prayer-feedback/submitter] household read failed:", error);
    return errorResponse("internal_error", "Internal server error", 500, cors);
  }
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
