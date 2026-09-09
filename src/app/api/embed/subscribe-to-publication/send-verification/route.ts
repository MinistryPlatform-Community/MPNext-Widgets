/**
 * `POST /api/embed/subscribe-to-publication/send-verification` — step 1 of the
 * anonymous double opt-in (C70).
 *
 * Validate, seal the submission, email a one-time link. **No MP record is
 * written and no `Contacts` row is read.**
 *
 * ## The anti-enumeration property, and why it is structural
 *
 * This route does not look the address up and hide the answer — it **does not
 * perform the query**. Contact resolution happens on the verify hop, after the
 * caller has proved they can read the mailbox, which is also where legacy did
 * it (`SubscriptionsService.cs:144`). So there is no branch to leak and no
 * timing difference to measure: the work is constant — validate, mint, read the
 * template, send — and every accepted submission answers `202 { "ok": true }`,
 * byte for byte, whether the address is known, unknown, already subscribed or
 * undeliverable.
 *
 * The deliberate contrast is
 * `src/app/api/embed/plan-your-visit/send-verification/route.ts:78-83`, which
 * answers `{ success: false, contactExists: true, … }` on a public endpoint —
 * an existence oracle any allowlisted caller can walk one address at a time.
 * That is filed separately; the fix there is to *send* a "you already have an
 * account" email and return the same uniform response, not to delete the
 * branch. **Do not reintroduce that shape here.**
 *
 * There is a route test that asserts the serialised body is identical for a
 * known and an unknown address, and one that asserts the MP mock is never
 * called with `table: "Contacts"` on this hop.
 *
 * ## Two rate-limit buckets, and the second one is the point
 *
 * 5/min per IP, and **3/hour per submitted address**. One IP must not fan out
 * across addresses, and one address must not be mail-bombable from a botnet —
 * and the per-address bucket has to be *per hour*, because a per-minute cap
 * still permits a steady all-day bombardment of one mailbox from rotating IPs.
 * Both `failClosed`, the wrapper's default: failing open on an endpoint that
 * emails a submitted address turns a store outage into an open relay.
 * `next-unsubscribe`'s `failClosed: false` is a narrow compliance exception and
 * does not generalise here.
 *
 * Both report the same `rate_limited`. That is the wrapper's design and it
 * matters more here than its comment says: a distinguishable per-bucket code
 * would tell a caller that the address they submitted had recently been
 * submitted before — a weaker but real version of the oracle above.
 *
 * Legacy has no rate limiting anywhere in the solution — `grep -rn
 * "RateLimit\|Throttl\|EnableRateLimiting" --include=*.cs` returns zero hits —
 * so `ReturnUrl` interpolated unvalidated into an unlimited, unauthenticated
 * send (`SubscriptionsService.cs:164`) was a phishing kit with the church's
 * deliverability reputation attached.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { buildOptionsResponse } from "@/lib/embed/auth";
import {
  withAnonymousWrite,
  errorResponse,
  isReturnUrlAllowed,
  buildReturnUrl,
} from "@/lib/embed/anonymous-write";
import { sha256Hex } from "@/lib/embed/crypto";
import { createPendingAction } from "@/lib/embed/pending-action";
import { ACTION_TOKEN_EXPIRY } from "@/lib/embed/action-token";
import { verifyRecaptchaToken } from "@/lib/embed/recaptcha";
import { SubscriptionService } from "@/services/subscriptionService";
import {
  MessageTemplateService,
  NoFromAddressError,
  TemplateNotFoundError,
} from "@/services/messageTemplateService";
import {
  SUBSCRIBE_VERIFY_PARAM,
  SubscribeVerificationRequestSchema,
  type PublicationVerifyData,
  type SubscribeVerificationResponse,
} from "@mpnext/types";

/** The submitted address, when there is one, for the per-address bucket. */
function submittedEmail(raw: unknown): string | null {
  const body = (raw ?? {}) as { email?: unknown };
  return typeof body.email === "string" && body.email.trim() !== ""
    ? body.email.trim().toLowerCase()
    : null;
}

/**
 * Does `value` contain a control character?
 *
 * `isReturnUrlAllowed` validates *shape*, and `new URL()` is tolerant of some
 * whitespace, so a CR or LF in a value that ends up in a mail header is worth
 * refusing before it gets that far. Length is capped by the schema.
 */
function hasControlChars(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

export async function POST(req: NextRequest) {
  return withAnonymousWrite(
    req,
    {
      widget: ["subscribe-to-publication", "*"],
      // The callback form, because the per-address key depends on the body.
      // The wrapper parses it once and runs this after authentication, so an
      // unauthenticated caller never gets a JSON parse and a SHA-256 done for
      // them.
      limits: async ({ ip, body }) => {
        const email = submittedEmail(body);
        return [
          { key: `subpub:send:ip:${ip}`, limit: 5 },
          // Hashed, so no address reaches Redis in cleartext. Added only when
          // an address was actually submitted: metering every address-less
          // request under one "no address" key would cap a whole congregation
          // at 3/hour, which is the defect C69 found in using this helper.
          // Step 1 always carries an address in practice, so this branch is
          // for a malformed body — which is still metered by the IP bucket.
          ...(email
            ? [
                {
                  key: `subpub:send:email:${await sha256Hex(email)}`,
                  limit: 3,
                  windowSeconds: 3600,
                },
              ]
            : []),
        ];
      },
      // Fail closed, the wrapper's default: this route sends email.
    },
    async ({ origin, cors, body }) => {
      const parsed = SubscribeVerificationRequestSchema.safeParse(body);
      if (!parsed.success) {
        const details = z.flattenError(parsed.error).fieldErrors;
        return NextResponse.json(
          { error: "validation_failed", message: "The subscription submission was not valid.", details },
          { status: 400, headers: cors }
        );
      }
      const data = parsed.data;

      // Opt-in, and a no-op for churches that do not: `verifyRecaptchaToken`
      // returns success with no secret configured. Checked before anything is
      // read, minted or sent.
      if (data.recaptchaToken) {
        const captcha = await verifyRecaptchaToken(data.recaptchaToken);
        if (!captcha.success) {
          return errorResponse(
            "validation_failed",
            "The reCAPTCHA challenge was not accepted.",
            400,
            cors
          );
        }
      }

      // Before the return-url check, so a church that forgot the template gets
      // the code that names what they forgot. The widget refuses to render a
      // submit button in this state, so reaching here means a stale page or a
      // hand-built request.
      if (!data.verificationEmailTemplateId) {
        return errorResponse(
          "template_not_configured",
          "verification-email-template-id is required to send a confirmation link.",
          422,
          cors
        );
      }

      // The `return-url` attribute is host-page markup that ends up inside an
      // email the church's own domain sends, which makes it an open-redirect
      // vector aimed at that church's own congregation: the link inherits the
      // church's credibility. `isReturnUrlAllowed` requires same-origin with
      // the request `Origin`, https (localhost excepted), and no credentials in
      // the URL — so `https://church.example@evil.example` is refused outright
      // rather than merely parsing to the wrong origin. Legacy validated it not
      // at all.
      const returnUrl = data.returnUrl ?? "";
      if (hasControlChars(returnUrl) || !isReturnUrlAllowed(returnUrl, origin)) {
        return errorResponse(
          "invalid_request",
          "return-url must be https and same-origin with the request.",
          400,
          cors
        );
      }

      const service = await SubscriptionService.getInstance();
      const publication = await service.getOnlinePublication(data.publicationId);
      if (!publication) {
        return errorResponse(
          "publication_not_found",
          "No Available_Online publication has that id.",
          404,
          cors
        );
      }

      // The sealed payload. No `contactId`, ever — legacy's was a
      // contact-scoped write credential sitting in an inbox. `origin` is the
      // one claim legacy did not have, and it is checked on redemption: without
      // it a handle minted on one allowlisted church site verifies from
      // another.
      const pending: PublicationVerifyData = {
        email: data.email.trim().toLowerCase(),
        firstName: data.firstName,
        lastName: data.lastName,
        publicationId: publication.Publication_ID,
        origin,
      };

      // Minted *before* the send, and a failure here is answered rather than
      // swallowed: an email carrying a link that can never be redeemed is
      // worse than no email. The reverse order would deliver exactly that.
      let token: string;
      try {
        token = await createPendingAction(
          "publication-verify",
          pending,
          ACTION_TOKEN_EXPIRY["publication-verify"]
        );
      } catch (error) {
        console.error(
          "[subscribe-to-publication/send-verification] the pending-action store write failed:",
          error
        );
        return errorResponse("internal_error", "Internal server error", 500, cors);
      }

      // `buildReturnUrl`, never a hand-built string: `searchParams.set`
      // preserves a legitimate `?page=2`, overwrites rather than duplicates a
      // param the host already carries, and encodes the handle exactly once.
      // It also removes the opportunity to write `` `${base}?` + `${p}=${t}` ``,
      // which `src/lib/no-template-concat.test.ts` fails the run for.
      const verifyUrl = buildReturnUrl(
        returnUrl,
        data.verifyParamName ?? SUBSCRIBE_VERIFY_PARAM,
        token
      );

      try {
        const templates = await MessageTemplateService.getInstance();
        // Legacy's three merge tokens, so a template a church already authored
        // drops straight in, plus `mpp_publication_title` — a verification
        // email that cannot name the publication is a worse email, and an MP
        // template ignores a token it does not use.
        await templates.sendMessageTemplate(
          data.verificationEmailTemplateId,
          { email: pending.email, name: `${data.firstName} ${data.lastName}`.trim() },
          {
            mpp_verify_email_url: verifyUrl,
            mpp_contact_first_name: data.firstName,
            mpp_contact_last_name: data.lastName,
            mpp_publication_title: publication.Title,
          }
        );
      } catch (error) {
        // Two codes, because they need two different actions from two different
        // people: a missing template, or one with no From contact, is the
        // church's to fix; a send that threw is worth retrying.
        if (error instanceof TemplateNotFoundError || error instanceof NoFromAddressError) {
          console.error(
            "[subscribe-to-publication/send-verification] the verification template is misconfigured:",
            error.message
          );
          return errorResponse(
            "template_not_configured",
            "The configured verification template is missing or has no From contact.",
            422,
            cors
          );
        }
        console.error(
          "[subscribe-to-publication/send-verification] the verification email failed:",
          error
        );
        // 500, not the 502 a bad upstream would suggest. The machine code
        // already carries the meaning and the widget branches on the code,
        // never the status; an upstream-failure convention belongs across all
        // thirty embed routes as its own change, not started in three new ones.
        return errorResponse(
          "email_send_failed",
          "Sending the verification email failed.",
          500,
          cors
        );
      }

      // Identical for every accepted submission. Nothing here reports a fact
      // about a person — only about the request or the host's configuration.
      const responseBody: SubscribeVerificationResponse = { ok: true };
      return NextResponse.json(responseBody, { status: 202, headers: cors });
    }
  );
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
