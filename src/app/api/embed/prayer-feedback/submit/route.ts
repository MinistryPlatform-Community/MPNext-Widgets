/**
 * `POST /api/embed/prayer-feedback/submit` — prayer / feedback intake (C69).
 *
 * Two paths through one endpoint, and which one runs is decided by **who the
 * request can prove the subject of the entry is**, not by a client flag:
 *
 * | Caller | `Feedback_Entries` write | Email |
 * |---|---|---|
 * | Signed in, filing for self or a household member | immediate | acknowledgement, if configured |
 * | Signed out | **none at all** | one-time verification link |
 * | Signed in, filing for someone outside the household ("blank form") | none at all | one-time verification link |
 *
 * The third row is worth spelling out. Dropping the verification round-trip for
 * a signed-in submitter is right because we already hold a verified identity —
 * but that identity is the *submitter's*, and it says nothing about a third
 * party whose name and address they have just typed. So the blank-form option
 * takes the same round-trip a stranger does, which is also exactly what legacy
 * did (it verified everyone). No new "signed-in users may mint contacts"
 * privilege is created here.
 *
 * ## The anonymous path performs zero MP writes
 *
 * This is the single most important property of the design, and the reason
 * "match an existing contact, else create one" is a safe answer to
 * `Feedback_Entries.Contact_ID` being `NOT NULL`. A row is only ever created by
 * someone who has demonstrably opened a mailbox. Without that, an
 * unauthenticated POST mints `Households` + `Contacts` pairs in a church's CRM
 * as fast as a script can manage, and MP has no good bulk undo.
 *
 * ## Three legacy holes closed here
 *
 * - **The email cannon.** `PrayerFeedbackApiController.cs:66` was
 *   `[AllowAnonymous]` and took `ContactId` straight off the form: post
 *   someone else's id and the server looked them up, harvested their real name
 *   and address, and mailed them a link that would file a prayer request
 *   against them. Here `onBehalfOfContactId` is **only ever read on a
 *   signed-in path**, and only after `isInSameHousehold` passes.
 * - **No rate limit of any kind.** Now 5/min per IP and 3/hour per submitted
 *   address, both before any MP call and any send.
 * - **No origin check on `returnUrl`.** The church's domain sends the mail, so
 *   the link inherits its credibility; `isReturnUrlAllowed` requires
 *   same-origin with the request `Origin`.
 *
 * ## No existence oracle
 *
 * `{ status: "verification_sent" }` is returned with the same body and the same
 * status whether or not the address matches an existing contact — the
 * deliberate divergence from `plan-your-visit`, which answers
 * `contactExists: true` on a public endpoint. Prayer intake must not report a
 * fact about an address to whoever asks.
 */

import { NextRequest, NextResponse } from "next/server";
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
import {
  PrayerFeedbackService,
  type PendingFeedbackAction,
} from "@/services/prayerFeedbackService";
import {
  MessageTemplateService,
  NoFromAddressError,
  TemplateNotFoundError,
} from "@/services/messageTemplateService";
import {
  DEFAULT_VERIFY_PARAM,
  PrayerFeedbackSubmitRequestSchema,
  type ParsedPrayerFeedbackSubmitRequest,
  type PrayerFeedbackSubmitResponse,
} from "@mpnext/types";

/** The submitted address, when there is one, for the per-address bucket. */
function submittedEmail(raw: unknown): string | null {
  const body = (raw ?? {}) as { email?: unknown };
  return typeof body.email === "string" && body.email.trim() !== ""
    ? body.email.trim().toLowerCase()
    : null;
}

/**
 * Is this a submission about a person the request cannot vouch for?
 *
 * True for every signed-out caller, and for a signed-in one who typed a name
 * and address instead of choosing themselves or a household member — the
 * "blank form" option. Both need the emailed round-trip before anything is
 * written.
 */
function needsVerification(
  isPublic: boolean,
  data: ParsedPrayerFeedbackSubmitRequest
): boolean {
  if (isPublic) return true;
  if (data.onBehalfOfContactId) return false;
  return Boolean(data.firstName && data.lastName && data.email);
}

export async function POST(req: NextRequest) {
  return withAnonymousWrite(
    req,
    {
      widget: ["prayer-feedback", "*"],
      // A callback, because the per-address bucket depends on the body. The
      // helper parses it once and runs this after authentication, so an
      // unauthenticated caller never gets a SHA-256 done for them.
      limits: async ({ ip, body }) => {
        const email = submittedEmail(body);
        return [
          // Much lower than the 120/min default, because this endpoint sends
          // email. Generous for a household behind one NAT and a resubmit.
          { key: `pf:ip:${ip}`, limit: 5 },
          // The bucket that matters: one address cannot be mail-bombed from
          // rotating IPs. Hashed, so no address reaches Redis in cleartext.
          // Added only when an address was actually submitted — a signed-in
          // submission carries none, and metering those all together under one
          // "no address" key would cap a whole congregation at 3/hour.
          ...(email
            ? [{ key: `pf:email:${await sha256Hex(email)}`, limit: 3, windowSeconds: 3600 }]
            : []),
        ];
      },
      // Fail closed, the helper's default: this route sends email and writes
      // records, so a store outage must not become an unmetered open door.
      // `next-unsubscribe`'s `failClosed: false` is a compliance-path exception
      // and does not generalise here.
    },
    async ({ claims, origin, cors, body }) => {
      const parsed = PrayerFeedbackSubmitRequestSchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse(
          "validation_failed",
          "The prayer-feedback submission body was not valid.",
          400,
          cors
        );
      }
      const data = parsed.data;

      const service = await PrayerFeedbackService.getInstance();

      // The host page's allowlist, echoed back. A *correctness* check only —
      // it is markup, so a caller can send any list — which catches a stale
      // form posting a type the church has since removed from the dropdown.
      if (
        data.allowedTypeIds &&
        data.allowedTypeIds.length > 0 &&
        !data.allowedTypeIds.includes(data.feedbackTypeId)
      ) {
        return errorResponse(
          "feedback_type_not_allowed",
          "The posted Feedback_Type_ID is outside the form's configured allowlist.",
          422,
          cors
        );
      }

      // The real guard: a type MP's own FK would reject, answered with a code
      // the widget can render instead of a 500 from MP.
      if (!(await service.isKnownFeedbackType(data.feedbackTypeId))) {
        return errorResponse(
          "feedback_type_not_found",
          "The posted Feedback_Type_ID does not exist in Feedback_Types.",
          422,
          cors
        );
      }

      const isPublic = claims.sub === "public";

      if (needsVerification(isPublic, data)) {
        return sendVerification({ data, origin, cors });
      }

      return writeSignedIn({ claims, data, cors });
    }
  );
}

/**
 * The verification path: seal the submission, email a one-time link, write
 * nothing.
 *
 * Note the ordering — the pending action is created *before* the send. A send
 * failure therefore leaves an orphaned sealed record, which expires on its own
 * 24 hours later and can never be redeemed because nobody holds its token.
 * The other order would be worse: a delivered email whose link had no payload.
 */
async function sendVerification(ctx: {
  data: ParsedPrayerFeedbackSubmitRequest;
  origin: string;
  cors: HeadersInit;
}): Promise<NextResponse> {
  const { data, origin, cors } = ctx;

  const firstName = data.firstName ?? "";
  const lastName = data.lastName ?? "";
  const email = data.email ?? "";
  if (!firstName || !lastName || !email) {
    return errorResponse(
      "validation_failed",
      "firstName, lastName and email are required for an unverified submission.",
      400,
      cors
    );
  }

  // Checked before the return URL, so a church that forgot the template gets
  // the code that names what they forgot. The widget also refuses to render a
  // submit button in this state, so reaching here means a stale page or a
  // hand-built request.
  if (!data.verificationEmailTemplateId) {
    return errorResponse(
      "template_not_configured",
      "verification-email-template-id is required for an unverified submission.",
      422,
      cors
    );
  }

  // The `return-url` attribute is host-page markup that ends up inside an email
  // the church's own domain sends, which makes it an open-redirect vector aimed
  // at that church's congregation. Same-origin with the request `Origin` is
  // exactly where a legitimate return URL points.
  const returnUrl = data.returnUrl ?? "";
  if (!isReturnUrlAllowed(returnUrl, origin)) {
    return errorResponse(
      "invalid_return_url",
      "returnUrl must be same-origin with the request Origin.",
      400,
      cors
    );
  }

  const pending: PendingFeedbackAction = {
    // `null`, always, on this path: the Contact is resolved (or created) only
    // when the link is redeemed. A caller-supplied `onBehalfOfContactId` is
    // never read here — that is the legacy email-cannon hole, closed.
    contactId: null,
    firstName,
    lastName,
    email,
    mobilePhone: data.mobilePhone ?? null,
    feedbackTypeId: data.feedbackTypeId,
    summary: data.summary,
    description: data.description ?? null,
    isPrivate: data.isPrivate === true,
    programId: data.programId ?? null,
    acknowledgementEmailTemplateId: data.acknowledgementEmailTemplateId ?? null,
  };

  const token = await createPendingAction(
    "prayer-feedback",
    pending,
    ACTION_TOKEN_EXPIRY["prayer-feedback"]
  );
  const verifyUrl = buildReturnUrl(
    returnUrl,
    data.verifyParamName ?? DEFAULT_VERIFY_PARAM,
    token
  );

  try {
    const templates = await MessageTemplateService.getInstance();
    // Legacy's exact three merge tokens, kept so an MP template a church
    // already authored drops straight in.
    await templates.sendMessageTemplate(
      data.verificationEmailTemplateId,
      { email, name: `${firstName} ${lastName}`.trim() },
      {
        mpp_verify_email_url: verifyUrl,
        mpp_contact_first_name: firstName,
        mpp_contact_last_name: lastName,
      }
    );
  } catch (error) {
    // Two codes, because they need two different actions from two different
    // people: a missing template or a template with no From contact is the
    // church's to fix, while a send that threw is worth retrying.
    if (error instanceof TemplateNotFoundError || error instanceof NoFromAddressError) {
      console.error("[prayer-feedback/submit] verification template misconfigured:", error.message);
      return errorResponse(
        "template_not_configured",
        "The configured verification template is missing or has no From contact.",
        422,
        cors
      );
    }
    console.error("[prayer-feedback/submit] verification email failed:", error);
    return errorResponse(
      "email_send_failed",
      "Sending the verification email failed.",
      500,
      cors
    );
  }

  // Deliberately says nothing about whether the address matches a contact.
  const body: PrayerFeedbackSubmitResponse = { status: "verification_sent" };
  return NextResponse.json(body, { status: 200, headers: cors });
}

/** The signed-in path: resolve the subject, write the entry, acknowledge it. */
async function writeSignedIn(ctx: {
  claims: { sub: string };
  data: ParsedPrayerFeedbackSubmitRequest;
  cors: HeadersInit;
}): Promise<NextResponse> {
  const { claims, data, cors } = ctx;
  const service = await PrayerFeedbackService.getInstance();

  const callerContactId = await service.getContactIdByUserGuid(claims.sub);
  if (callerContactId == null) {
    return errorResponse(
      "contact_not_found",
      "No Contacts row is linked to the signed-in user.",
      404,
      cors
    );
  }

  // The dropdown is a convenience; this is the boundary. A member may file for
  // their household and nobody else.
  let targetContactId = callerContactId;
  if (data.onBehalfOfContactId && data.onBehalfOfContactId !== callerContactId) {
    if (!(await service.isInSameHousehold(callerContactId, data.onBehalfOfContactId))) {
      return errorResponse(
        "not_household_member",
        "onBehalfOfContactId is not in the caller's household.",
        403,
        cors
      );
    }
    targetContactId = data.onBehalfOfContactId;
  }

  const target = await service.getContactSummary(targetContactId);
  if (!target) {
    return errorResponse(
      "contact_not_found",
      "The target Contacts row could not be read.",
      404,
      cors
    );
  }

  // The form's email field only appears when the chosen member has none on
  // file, which is also the only case it is used for.
  const suppliedEmail = data.email ?? null;

  let entry;
  try {
    entry = await service.createFeedbackEntry({
      contactId: targetContactId,
      firstName: target.firstName,
      lastName: target.lastName,
      email: target.email ?? suppliedEmail ?? "",
      mobilePhone: data.mobilePhone ?? null,
      feedbackTypeId: data.feedbackTypeId,
      summary: data.summary,
      description: data.description ?? null,
      isPrivate: data.isPrivate === true,
      programId: data.programId ?? null,
    });
  } catch (error) {
    console.error("[prayer-feedback/submit] the Feedback_Entries insert failed:", error);
    return errorResponse(
      "feedback_save_failed",
      "MinistryPlatform rejected the Feedback_Entries insert.",
      500,
      cors
    );
  }

  // Only into an empty address, and only when the form actually collected one.
  if (!target.email && suppliedEmail) {
    await service.backfillContactEmail(targetContactId, suppliedEmail);
  }

  // To the *subject's* own address, not whatever the form held: a member filing
  // for a spouse should not get the spouse's confirmation in their own inbox.
  const acknowledgeTo = target.email ?? suppliedEmail;
  if (data.acknowledgementEmailTemplateId && acknowledgeTo) {
    // Awaited but never fatal — the row is saved, so a mail failure must not
    // report failure to the congregant. `sendAcknowledgement` swallows and logs.
    await service.sendAcknowledgement({
      templateId: data.acknowledgementEmailTemplateId,
      to: { email: acknowledgeTo, name: target.displayName },
      firstName: target.firstName,
      lastName: target.lastName,
      feedbackTypeId: data.feedbackTypeId,
      summary: data.summary,
      dateSubmitted: entry.dateSubmitted,
    });
  }

  const body: PrayerFeedbackSubmitResponse = {
    status: "submitted",
    feedbackEntryId: entry.feedbackEntryId,
  };
  return NextResponse.json(body, { status: 200, headers: cors });
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
