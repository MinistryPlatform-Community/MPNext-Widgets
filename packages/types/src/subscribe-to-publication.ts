/**
 * `next-subscribe-to-publication` — the wire contract for anonymous, email-
 * verified publication opt-in (C70).
 *
 * "Sign up for our newsletter" on a church home page is the most common
 * publication touchpoint there is, and it is anonymous by definition: the
 * visitor has no MP login and will not create one to join a mailing list.
 * `next-subscriptions` is the signed-in management surface and refuses
 * `sub === "public"` outright, so before this widget the only route onto a
 * publication was to already have an account.
 *
 * ## Three hops, and what each one is allowed to know
 *
 * 1. `GET /publication` — the title and description of one `Available_Online`
 *    publication, so the form can name what the visitor is joining.
 * 2. `POST /send-verification` — validate, seal, email a one-time link.
 *    **Reads no `Contacts` row at all**, which is what makes the uniform `202`
 *    honest rather than merely uniform: there is no branch to leak and no
 *    timing difference to measure. A known address, an unknown one, an
 *    already-subscribed one and an undeliverable one produce byte-identical
 *    responses.
 * 3. `POST /verify` — redeem the link, resolve or create the contact **from the
 *    verified address**, upsert the subscription.
 *
 * ## No contact id crosses the wire, in either direction
 *
 * Legacy bound a `ContactId` off the form on an `[AllowAnonymous]` endpoint,
 * copied it into its verification token, and on redemption **overwrote that
 * contact's `Email_Address` with whatever the form held**
 * (`SubscriptionsService.cs:144-150`). On an email-identified IdP that is a
 * password-reset takeover driven from a public form. Nothing in this contract
 * accepts or returns a contact id: the completing hop identifies a person only
 * by an address they have proved they can read, and no route writes
 * `Contacts.Email_Address` ever.
 */

import { z } from "zod";
import { VerifyParamNameSchema } from "./prayer-feedback";

/**
 * The query parameter carrying the emailed verification handle.
 *
 * **Not legacy's `mpp-verify-id`.** `mpp-` is the legacy MP prefix that the
 * `nextwidgets_*` rename spent a whole change removing from client-facing keys,
 * and the convention covers every browser-visible key the SDK owns — extended
 * here to query parameters, which is exactly what this is. It also differs from
 * `next-plan-your-visit`'s default on purpose, so two verification widgets on
 * one page cannot both consume the same handle.
 */
export const SUBSCRIBE_VERIFY_PARAM = "nextwidgets_verify";

/** `dp_Publications.Title` is `nvarchar(50)`. */
export const PUBLICATION_TITLE_MAX = 50;

/** `Contacts.First_Name` / `Last_Name` are `nvarchar(50)`. */
export const SUBSCRIBER_NAME_MAX = 50;

/** `Contacts.Email_Address` is `nvarchar(254)`. */
export const SUBSCRIBER_EMAIL_MAX = 254;

/**
 * What the form needs to know about a publication — and nothing else.
 *
 * `Congregation_ID` is deliberately absent. The service reads it (it seeds a
 * created household's congregation) but the widget has no use for it, and a
 * public endpoint should not report a church's internal structure to answer
 * "what is this newsletter called".
 */
export const OnlinePublicationSchema = z.object({
  Publication_ID: z.number().int().positive(),
  Title: z.string(),
  Description: z.string().nullable(),
});
export type OnlinePublication = z.infer<typeof OnlinePublicationSchema>;

export const SubscribePublicationResponseSchema = z.object({
  publication: OnlinePublicationSchema,
});
export type SubscribePublicationResponse = z.infer<
  typeof SubscribePublicationResponseSchema
>;

/**
 * `POST /send-verification`'s body.
 *
 * Every bound field is either a length-checked scalar or the return URL, which
 * is checked against the request `Origin` before it can reach an email. There
 * is **no attacker-controlled free text**: the merged body of the church's
 * template gets a first name, a last name, a same-origin URL and the
 * publication's own title, all HTML-escaped by `messageTemplateService`.
 */
export const SubscribeVerificationRequestSchema = z.object({
  publicationId: z.number().int().positive(),
  firstName: z.string().trim().min(1).max(SUBSCRIBER_NAME_MAX),
  lastName: z.string().trim().min(1).max(SUBSCRIBER_NAME_MAX),
  email: z.email().max(SUBSCRIBER_EMAIL_MAX),
  /**
   * `dp_Communications.Communication_ID` for the verification email. Required
   * in practice — a flow whose whole mechanism is an emailed link cannot run
   * without one — but optional here so an unconfigured host page gets
   * `template_not_configured`, which names what is missing, rather than a
   * generic `validation_failed`.
   */
  verificationEmailTemplateId: z.number().int().positive().optional(),
  /**
   * Where the emailed link lands. Must be https (localhost excepted) and
   * same-origin with the request; defaults to the host page's own URL.
   *
   * Capped here as well as validated, because `isReturnUrlAllowed` checks shape
   * rather than length and a 100KB "URL" should not reach a `new URL()` call.
   */
  returnUrl: z.string().max(2048).optional(),
  verifyParamName: VerifyParamNameSchema.optional(),
  /** Opt-in bot check. Absent, or with no secret configured, it is a no-op. */
  recaptchaToken: z.string().max(4096).optional(),
});
export type SubscribeVerificationRequest = z.input<
  typeof SubscribeVerificationRequestSchema
>;
export type ParsedSubscribeVerificationRequest = z.output<
  typeof SubscribeVerificationRequestSchema
>;

/**
 * What `POST /send-verification` answers — for **every** accepted submission.
 *
 * One field, one value, one status (`202`). This is the anti-enumeration
 * guarantee in type form: there is no shape here that could differ between a
 * known and an unknown address, which is the deliberate divergence from
 * `plan-your-visit/send-verification`'s `{ contactExists: true }`.
 */
export const SubscribeVerificationResponseSchema = z.object({
  ok: z.literal(true),
});
export type SubscribeVerificationResponse = z.infer<
  typeof SubscribeVerificationResponseSchema
>;

/**
 * `POST /verify`'s body.
 *
 * The handle only — the publication and the address travel sealed inside it, so
 * a landing page cannot redirect a confirmed address onto a publication of its
 * own choosing. Short, because the envelope signs a random `jti` rather than a
 * payload.
 */
export const SubscribeVerifyRequestSchema = z.object({
  token: z.string().min(1).max(1024),
});
export type SubscribeVerifyRequest = z.infer<typeof SubscribeVerifyRequestSchema>;

/**
 * What `POST /verify` answers.
 *
 * `email` is echoed from the sealed token rather than held by the widget,
 * because the confirmation is a **fresh page load** — the visitor arrived from
 * their inbox, quite possibly on a different device from the one they typed the
 * form on.
 *
 * `alreadySubscribed` is for a host page's analytics, not for a branch in the
 * visitor-facing copy: one success sentence covers both, since nothing
 * actionable differs and a double-clicked link is the common cause. Safe to
 * report, because the caller has already proved control of the mailbox.
 */
export const SubscribeVerifyResponseSchema = z.object({
  subscribed: z.literal(true),
  publicationTitle: z.string(),
  email: z.string(),
  alreadySubscribed: z.boolean(),
});
export type SubscribeVerifyResponse = z.infer<typeof SubscribeVerifyResponseSchema>;

/**
 * What a `publication-verify` pending action carries between the two hops.
 *
 * Compare legacy's JWT payload, which held `firstName`, `lastName`, `email`,
 * `mobilePhone`, `publicationID`, `contactId` **and** `onBehalfId`. Two claims
 * are dropped deliberately and neither is an oversight:
 *
 * - **`contactId`** — a token naming a contact row is a contact-scoped *write
 *   credential* sitting in an inbox. The contact is resolved from the verified
 *   address instead, which is the structural half of the takeover fix.
 * - **`onBehalfId`** — it only had meaning alongside the signed-in "Subscribe
 *   As" household dropdown, which is not ported.
 *
 * And one claim legacy did not have is added: **`origin`**, the request origin
 * at mint time. Without it a handle minted on church A's page redeems from
 * church B's, and both origins are on the allowlist, so `requireWidgetAuth`
 * alone will not catch it. The payload is sealed and signed, so the value is
 * unforgeable; the redeeming route compares it.
 */
export interface PublicationVerifyData {
  email: string;
  firstName: string;
  lastName: string;
  publicationId: number;
  origin: string;
}

/**
 * Narrow a redeemed pending-action payload, or reject it.
 *
 * Runs after the signature, the `kind` check and the atomic store burn, so this
 * is not a provenance boundary — it is a shape check against deploy skew, and a
 * payload written by an older build whose shape we no longer recognise is
 * reported as invalid rather than half-trusted.
 *
 * A plain predicate rather than a Zod schema because that is what
 * `consumePendingAction` takes; the shape it narrows to lives in this file, so
 * one module still owns it.
 */
export function guardPublicationVerifyData(
  data: unknown
): PublicationVerifyData | null {
  if (typeof data !== "object" || data === null) return null;
  const { email, firstName, lastName, publicationId, origin } = data as Record<
    string,
    unknown
  >;

  if (typeof email !== "string" || email.trim() === "") return null;
  if (typeof firstName !== "string" || firstName.trim() === "") return null;
  if (typeof lastName !== "string" || lastName.trim() === "") return null;
  if (typeof origin !== "string" || origin.trim() === "") return null;
  if (
    typeof publicationId !== "number" ||
    !Number.isInteger(publicationId) ||
    publicationId <= 0
  ) {
    return null;
  }

  return { email, firstName, lastName, publicationId, origin };
}
