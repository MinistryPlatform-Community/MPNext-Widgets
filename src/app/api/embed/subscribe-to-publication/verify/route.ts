/**
 * `POST /api/embed/subscribe-to-publication/verify` — redeem the emailed link
 * (C70).
 *
 * This is where the subscription is finally written. `/send-verification` wrote
 * nothing; the submission has been sitting sealed in the session store, and the
 * visitor holding the emailed handle is the proof that the address they typed
 * is theirs.
 *
 * ## Single-use, and this is the widget where that matters most
 *
 * `consumePendingAction` burns the record atomically. Without that, the write
 * would be replayable for three days — and because it is **idempotent in the
 * subscribe direction**, replay is not harmless the way it first looks: a
 * visitor subscribes, later unsubscribes, and then anything that re-fetches the
 * old confirmation link *re-subscribes them*. A mail-client prefetcher, a
 * security scanner, a forwarded thread or someone tidying their inbox is
 * enough; no attacker is required. Idempotency, which is what made replay look
 * safe, is exactly what makes it harmful once `Unsubscribed` can have been
 * flipped in between. That is also why `pending-action.ts` lists
 * `publication-verify` and deliberately omits `unsubscribe`: the two flows
 * differ precisely on whether replay is harmless.
 *
 * The cost is honest and accepted: a second click gets `verification_used`
 * rather than a cheerful second confirmation, because the payload is burned and
 * we no longer know which publication or address it named. The widget renders
 * that as reassurance plus the manage-preferences link, not as an error.
 *
 * ## POST, not the GET legacy used
 *
 * A state-changing `GET` is fetched by mailbox link scanners, link-preview bots
 * and URL-rewriting gateways — which here would mean **subscribing someone who
 * never clicked**. So the emailed link is a navigation to the church's page,
 * which only renders, and the write is this POST, issued by the mounted widget,
 * which needs a widget JWT minted from an allowlisted origin. Keeping the
 * handle in the body also keeps it out of access logs, out of any CDN cache key
 * and out of a `Referer`.
 *
 * ## Four outcomes, and the fourth is the one to get right
 *
 * | Reason | Answer | Store |
 * |---|---|---|
 * | `invalid` — bad signature, another flow, unreadable payload | `verification_invalid` 400 | untouched |
 * | `expired` — proved from the signature | `verification_expired` 410 | untouched |
 * | `used` — envelope good, record already burned | `verification_used` 409 | read |
 * | `unavailable` — store unreachable | `internal_error` 500 | **not burned** |
 *
 * `unavailable` is never a successful write, and the record survives it — so
 * the widget's error state re-POSTs the *same* handle rather than asking the
 * visitor to sign up again.
 */

import { NextRequest, NextResponse } from "next/server";
import { buildOptionsResponse } from "@/lib/embed/auth";
import { withAnonymousWrite, errorResponse } from "@/lib/embed/anonymous-write";
import { consumePendingAction } from "@/lib/embed/pending-action";
import { verifyActionToken } from "@/lib/embed/action-token";
import { SubscriptionService } from "@/services/subscriptionService";
import {
  SubscribeVerifyRequestSchema,
  guardPublicationVerifyData,
  type SubscribeVerifyResponse,
} from "@mpnext/types";

/** The handle out of a not-yet-validated body. */
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
 * budget of the visitors holding real links. C69's verify route reasons the
 * same way and this follows it deliberately.
 *
 * A body with **no** handle is metered: a caller sending garbage still has to
 * be counted, and the route answers `invalid_request` afterwards.
 */
async function costsAnything(body: unknown): Promise<boolean> {
  const token = rawToken(body);
  if (token === null) return true;

  // Envelope only: one HMAC verification, no store access. It is verified again
  // inside `consumePendingAction`; a second HMAC is a rounding error next to a
  // Redis round-trip, and the alternative is leaking the store-burn step out of
  // the primitive that owns it.
  const envelope = await verifyActionToken("publication-verify", token, (payload) =>
    typeof payload.jti === "string" && payload.jti ? { jti: payload.jti } : null
  );
  return envelope.ok;
}

export async function POST(req: NextRequest) {
  return withAnonymousWrite(
    req,
    {
      widget: ["subscribe-to-publication", "*"],
      limits: async ({ ip, body }) =>
        (await costsAnything(body)) ? [{ key: `subpub:verify:${ip}`, limit: 20 }] : [],
      // Fail closed, the wrapper's default: this route writes MP records.
    },
    async ({ origin, cors, body }) => {
      const parsed = SubscribeVerifyRequestSchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse(
          "invalid_request",
          "A confirmation handle is required.",
          400,
          cors
        );
      }

      // **This is the burn.** Everything after it runs on an already-consumed
      // record.
      const redeemed = await consumePendingAction(
        "publication-verify",
        parsed.data.token,
        guardPublicationVerifyData
      );

      if (!redeemed.ok) {
        if (redeemed.reason === "expired") {
          return errorResponse(
            "verification_expired",
            "The confirmation handle has expired.",
            410,
            cors
          );
        }
        if (redeemed.reason === "used") {
          return errorResponse(
            "verification_used",
            "The confirmation handle has already been redeemed.",
            409,
            cors
          );
        }
        if (redeemed.reason === "unavailable") {
          // Never a successful write on a store error — and the record was not
          // burned, so the same handle is still redeemable on a retry.
          console.error(
            "[subscribe-to-publication/verify] the session store was unreachable"
          );
          return errorResponse("internal_error", "Internal server error", 500, cors);
        }
        // `invalid` folds in a handle minted for another flow: saying which
        // flow it belonged to would leak what else the bearer holds.
        return errorResponse(
          "verification_invalid",
          "The confirmation handle is not valid.",
          400,
          cors
        );
      }

      const data = redeemed.data;

      // The cross-origin replay check, and **deliberately not its own code**: a
      // distinct answer would tell a prober that the handle was otherwise
      // valid. Note the ordering cost — the record is burned before this runs,
      // so a cross-origin replay consumes the link rather than leaving it
      // usable. That is the right way round: a handle presented from the wrong
      // origin is evidence it has leaked, and burning it is containment.
      if (data.origin !== origin) {
        console.warn(
          `[subscribe-to-publication/verify] handle minted for another origin (redeemed at ${origin})`
        );
        return errorResponse(
          "verification_invalid",
          "The confirmation handle is not valid.",
          400,
          cors
        );
      }

      const service = await SubscriptionService.getInstance();

      // Three days apart, so a publication taken offline between minting and
      // clicking is a real case rather than a theoretical one.
      const publication = await service.getOnlinePublication(data.publicationId);
      if (!publication) {
        return errorResponse(
          "publication_not_found",
          "No Available_Online publication has that id.",
          404,
          cors
        );
      }

      let outcome;
      try {
        outcome = await service.subscribeEmailToPublication({
          email: data.email,
          firstName: data.firstName,
          lastName: data.lastName,
          publicationId: publication.Publication_ID,
        });
      } catch (error) {
        // Never the address: it is the one piece of personal data this flow
        // holds, and a failure line is not worth putting it in a log.
        console.error(
          `[subscribe-to-publication/verify] the MP write failed for publication ${publication.Publication_ID}:`,
          error instanceof Error ? error.message : error
        );
        // 500, not 502 — see the note in `send-verification`.
        return errorResponse(
          "save_failed",
          "MinistryPlatform rejected the subscription write.",
          500,
          cors
        );
      }

      const responseBody: SubscribeVerifyResponse = {
        subscribed: true,
        publicationTitle: publication.Title,
        // Echoed from the sealed handle: the confirmation is a fresh page load,
        // quite possibly on a different device from the one the form was typed
        // on, so the widget holds no state across it.
        email: data.email,
        // For a host page's analytics, not for a branch in the copy — the
        // visitor is told the same thing either way. Safe to report, because
        // the caller has already proved control of the mailbox.
        alreadySubscribed: outcome.alreadySubscribed,
      };
      return NextResponse.json(responseBody, { status: 200, headers: cors });
    }
  );
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
