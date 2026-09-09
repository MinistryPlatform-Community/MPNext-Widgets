/**
 * `POST /api/embed/prayer-feedback/verify` — redeem the emailed link (C69).
 *
 * This is where an anonymous submission finally becomes a `Feedback_Entries`
 * row. `/submit` wrote nothing; the whole submission has been sitting sealed in
 * the session store, and the visitor holding the emailed handle is the proof
 * that the address they typed is theirs.
 *
 * ## POST, not GET
 *
 * The handle would otherwise land in a server access log, in a `Referer`, and
 * in whatever a URL-rewriting mail gateway keeps. Worse, mailbox link scanners
 * and link-preview bots *fetch* emailed URLs — which for legacy's
 * `[HttpGet] [AllowAnonymous]` verify action meant a prayer request could be
 * filed by a scanner. So the emailed link is a navigation to the church's page,
 * which only renders; the write is this POST, issued by the mounted widget, and
 * it needs a widget JWT minted from an allowlisted origin.
 *
 * ## The three outcomes, and the fourth
 *
 * `consumePendingAction` distinguishes them honestly because the envelope
 * carries a signed `exp` and the payload lives in the store:
 *
 * | Reason | Answer | Store touched |
 * |---|---|---|
 * | `invalid` — bad signature, wrong flow, unreadable payload | `verification_invalid` 400 | no |
 * | `expired` — proved from the signature | `verification_expired` 410 | **no** |
 * | `used` — envelope good, record already burned | `verification_used` 409 | yes |
 * | `unavailable` — the store could not be reached | `internal_error` 500 | attempted |
 *
 * The last row is the one to get right: a store error is **never** a successful
 * redemption. Getting that backwards means a duplicate prayer entry on every
 * retry, which is exactly the failure legacy tried to paper over with its
 * (broken) content-comparison duplicate guard.
 */

import { NextRequest, NextResponse } from "next/server";
import { buildOptionsResponse } from "@/lib/embed/auth";
import { withAnonymousWrite, errorResponse } from "@/lib/embed/anonymous-write";
import { consumePendingAction } from "@/lib/embed/pending-action";
import { verifyActionToken } from "@/lib/embed/action-token";
import {
  PrayerFeedbackService,
  guardPendingFeedbackAction,
} from "@/services/prayerFeedbackService";
import {
  PrayerFeedbackVerifyRequestSchema,
  type PrayerFeedbackVerifyResponse,
} from "@mpnext/types";

/** The token out of a not-yet-validated body. */
function rawToken(body: unknown): string | null {
  const b = (body ?? {}) as { token?: unknown };
  return typeof b.token === "string" && b.token !== "" ? b.token : null;
}

/**
 * Should this request spend a rate-limit slot?
 *
 * Only when it is going to cost something. An expired or forged handle is
 * answered from the signature alone — no store round-trip, no MP call — so
 * metering it would let link-scanning traffic and stale bookmarks exhaust the
 * budget of the visitors who hold real links. Verify the envelope, then
 * rate-limit, then touch the store, in that order.
 *
 * A body with no token at all *is* metered: a caller sending garbage still has
 * to be counted, and the route answers `validation_failed` afterwards.
 */
async function costsAnything(body: unknown): Promise<boolean> {
  const token = rawToken(body);
  if (token === null) return true;

  // Envelope only — one HMAC verification, no store access. The envelope is
  // verified again inside `consumePendingAction`; a second HMAC is a rounding
  // error next to a Redis round-trip, and the alternative is leaking the
  // store-burn step out of the primitive that owns it.
  const envelope = await verifyActionToken("prayer-feedback", token, (payload) =>
    typeof payload.jti === "string" && payload.jti ? { jti: payload.jti } : null
  );
  return envelope.ok;
}

export async function POST(req: NextRequest) {
  return withAnonymousWrite(
    req,
    {
      widget: ["prayer-feedback", "*"],
      limits: async ({ ip, body }) =>
        (await costsAnything(body)) ? [{ key: `pf:ip:${ip}`, limit: 5 }] : [],
      // Fail closed: this route writes MP records.
    },
    async ({ cors, body }) => {
      const parsed = PrayerFeedbackVerifyRequestSchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse(
          "validation_failed",
          "A token is required to redeem a prayer-feedback submission.",
          400,
          cors
        );
      }

      const redeemed = await consumePendingAction(
        "prayer-feedback",
        parsed.data.token,
        guardPendingFeedbackAction
      );

      if (!redeemed.ok) {
        if (redeemed.reason === "expired") {
          return errorResponse(
            "verification_expired",
            "The verification handle has expired.",
            410,
            cors
          );
        }
        if (redeemed.reason === "used") {
          return errorResponse(
            "verification_used",
            "The verification handle has already been redeemed.",
            409,
            cors
          );
        }
        if (redeemed.reason === "unavailable") {
          // Never a successful write on a store error. A duplicate entry per
          // retry is a far worse outcome than a retryable failure.
          console.error("[prayer-feedback/verify] the session store was unreachable");
          return errorResponse("internal_error", "Internal server error", 500, cors);
        }
        return errorResponse(
          "verification_invalid",
          "The verification handle is not valid.",
          400,
          cors
        );
      }

      const pending = redeemed.data;
      const service = await PrayerFeedbackService.getInstance();

      let entry;
      try {
        entry = await service.createFeedbackEntry(pending);
      } catch (error) {
        // The handle is already burned by now, so this is not retryable with
        // the same link — which is the right trade. The alternative is a
        // redeemable token after a partial write, i.e. duplicate entries.
        console.error("[prayer-feedback/verify] the Feedback_Entries insert failed:", error);
        return errorResponse(
          "feedback_save_failed",
          "MinistryPlatform rejected the Feedback_Entries insert.",
          500,
          cors
        );
      }

      // Only into an empty address, and only for a contact that already
      // existed: a contact this redemption just created was given the address
      // at creation.
      if (!entry.contactCreated) {
        await service.backfillContactEmail(entry.contactId, pending.email);
      }

      if (pending.acknowledgementEmailTemplateId) {
        await service.sendAcknowledgement({
          templateId: pending.acknowledgementEmailTemplateId,
          to: {
            email: pending.email,
            name: `${pending.firstName} ${pending.lastName}`.trim(),
          },
          firstName: pending.firstName,
          lastName: pending.lastName,
          feedbackTypeId: pending.feedbackTypeId,
          summary: pending.summary,
          dateSubmitted: entry.dateSubmitted,
        });
      }

      const responseBody: PrayerFeedbackVerifyResponse = {
        status: "verified",
        feedbackEntryId: entry.feedbackEntryId,
      };
      return NextResponse.json(responseBody, { status: 200, headers: cors });
    }
  );
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
