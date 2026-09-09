/**
 * `next-prayer-feedback` — the wire contract for prayer / feedback intake (C69).
 *
 * The widget writes `Feedback_Entries`, which is the table church staff actually
 * work a prayer queue from. That is why it is its own element rather than a
 * hand-built `next-custom-form`: a Custom Form writes `Form_Responses`, carries
 * no Feedback Type and no Program, and never reaches the prayer queue.
 *
 * ## Two paths through one submit endpoint
 *
 * A **signed-in** submitter is already a verified identity in the encrypted
 * server session, so the entry is written immediately and the acknowledgement
 * email (when configured) is the church's touchpoint.
 *
 * A **signed-out** submitter writes nothing at all. The submission is sealed
 * into a pending action, a one-time link is emailed, and the `Feedback_Entries`
 * row — plus, if needed, the `Households` + `Contacts` pair — is created only
 * when that link is redeemed. That double opt-in is what makes "create a
 * Contact" safe: without it an unauthenticated POST mints rows in a church's
 * CRM as fast as a script can manage.
 *
 * ## Limits are end to end, not per-layer
 *
 * Legacy disagreed with itself: its textarea said `maxlength="2000"`, the column
 * allows 2000, and both its token and its insert truncated at 1000 — so a
 * congregant's last thousand characters vanished silently. The two constants
 * below are the single source for the schema, the widget's `maxlength` and the
 * service's truncation, so they cannot drift again.
 */

import { z } from "zod";

/** `Feedback_Entries.Entry_Title` is `nvarchar(50)`. */
export const FEEDBACK_SUMMARY_MAX = 50;

/** `Feedback_Entries.Description` is `nvarchar(2000)` — all of it usable. */
export const FEEDBACK_DESCRIPTION_MAX = 2000;

/** `Visibility_Levels.Visibility_Level_ID` for `2 - Staff Only`. */
export const VISIBILITY_STAFF_ONLY = 2;

/** `Visibility_Levels.Visibility_Level_ID` for `4 - Public`. */
export const VISIBILITY_PUBLIC = 4;

/** One option in the Feedback Type dropdown. */
export const FeedbackTypeOptionSchema = z.object({
  id: z.number().int().positive(),
  /** `Feedback_Types.Feedback_Type`, as the church typed it — never translated. */
  name: z.string(),
  description: z.string().nullable(),
});
export type FeedbackTypeOption = z.infer<typeof FeedbackTypeOptionSchema>;

export const PrayerFeedbackTypesResponseSchema = z.object({
  types: z.array(FeedbackTypeOptionSchema),
});
export type PrayerFeedbackTypesResponse = z.infer<
  typeof PrayerFeedbackTypesResponseSchema
>;

/**
 * The query parameter name carrying the emailed verification handle.
 *
 * Legacy's spelling, kept as the default so an MP template a church already
 * edited — and a bookmark someone already saved — keeps working. Overridable
 * per element with `verify-param-name`.
 */
export const DEFAULT_VERIFY_PARAM = "mpp-verify-id";

/**
 * A parameter name safe to hand to `URLSearchParams.set`.
 *
 * Restricted rather than escaped: the value is host-page markup that ends up in
 * an emailed URL, and a conservative charset is easier to reason about than
 * working out what a mail client's link rewriter will do with a percent-encoded
 * parameter *name*.
 */
export const VerifyParamNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_.-]+$/);

export const PrayerFeedbackSubmitRequestSchema = z.object({
  feedbackTypeId: z.number().int().positive(),
  /** → `Entry_Title`. Required: a queue of untitled entries is unworkable. */
  summary: z.string().trim().min(1).max(FEEDBACK_SUMMARY_MAX),
  /** → `Description`. Optional, and the full 2000 characters survive. */
  description: z.string().max(FEEDBACK_DESCRIPTION_MAX).optional(),
  /** Ticked ⇒ `Visibility_Level_ID = 2` (Staff Only) rather than `4` (Public). */
  isPrivate: z.boolean().optional(),
  /** `Feedback_Entries.Program_ID`. Omitted from the write when absent or `<= 0`. */
  programId: z.number().int().nullish(),
  /**
   * Echo of the element's `feedback-type-ids`.
   *
   * A **correctness** check, not a security boundary: it is host-page markup,
   * so a caller can send anything. It catches a stale form posting a type the
   * church has since removed from the dropdown; `isKnownFeedbackType` is the
   * real guard against a bogus FK. Anyone wanting a hard restriction is asking
   * for server-side tenant config, which is out of scope.
   */
  allowedTypeIds: z.array(z.number().int().positive()).max(100).optional(),

  // ── Anonymous path only ──
  firstName: z.string().trim().max(50).optional(),
  lastName: z.string().trim().max(50).optional(),
  email: z.email().max(254).optional(),
  mobilePhone: z.string().trim().max(50).optional(),
  /** Where the emailed link lands. Must be same-origin with the request. */
  returnUrl: z.string().max(2048).optional(),
  verifyParamName: VerifyParamNameSchema.optional(),
  /** `dp_Communications.Communication_ID`; must render `[mpp_verify_email_url]`. */
  verificationEmailTemplateId: z.number().int().positive().optional(),

  // ── Signed-in path only ──
  /** A household member to file on behalf of. Verified server-side. */
  onBehalfOfContactId: z.number().int().positive().optional(),

  // ── Both paths ──
  /** `dp_Communications.Communication_ID`. Absent ⇒ no acknowledgement mail. */
  acknowledgementEmailTemplateId: z.number().int().positive().nullish(),
});
export type PrayerFeedbackSubmitRequest = z.input<
  typeof PrayerFeedbackSubmitRequestSchema
>;
export type ParsedPrayerFeedbackSubmitRequest = z.output<
  typeof PrayerFeedbackSubmitRequestSchema
>;

/**
 * `POST /verify`'s body.
 *
 * A POST rather than the emailed `GET` legacy used, so the handle never lands in
 * a server access log, a `Referer` header, or a mailbox scanner's fetch. The
 * emailed link is a navigation to a *page*; the widget on that page issues this.
 */
export const PrayerFeedbackVerifyRequestSchema = z.object({
  /**
   * The handle from the emailed link. **The only field**: the acknowledgement
   * template was chosen at submit time and travels inside the sealed payload,
   * so the landing page cannot redirect the acknowledgement to a template of
   * its own choosing.
   */
  token: z.string().min(1).max(4096),
});
export type PrayerFeedbackVerifyRequest = z.infer<
  typeof PrayerFeedbackVerifyRequestSchema
>;

/**
 * What `POST /submit` answers.
 *
 * `verification_sent` is returned with the **same body and the same status
 * whether or not the address matches an existing contact** — the deliberate
 * divergence from `plan-your-visit`, whose `contactExists: true` makes a public
 * endpoint an email-existence oracle. Prayer intake must not have one.
 */
export const PrayerFeedbackSubmitResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("submitted"),
    feedbackEntryId: z.number().int().positive(),
  }),
  z.object({ status: z.literal("verification_sent") }),
]);
export type PrayerFeedbackSubmitResponse = z.infer<
  typeof PrayerFeedbackSubmitResponseSchema
>;

export const PrayerFeedbackVerifyResponseSchema = z.object({
  status: z.literal("verified"),
  feedbackEntryId: z.number().int().positive(),
});
export type PrayerFeedbackVerifyResponse = z.infer<
  typeof PrayerFeedbackVerifyResponseSchema
>;

/** One person the signed-in form can file on behalf of. */
export const SubmitterOptionSchema = z.object({
  contactId: z.number().int().positive(),
  displayName: z.string(),
  /**
   * Whether MP holds an address for them.
   *
   * A boolean, not the address: it is all the widget needs to decide whether to
   * show the email field (legacy's `ShowHideEmailContainer`), and shipping a
   * household's addresses to the browser to answer a yes/no question would be a
   * disclosure the flow does not require.
   */
  hasEmail: z.boolean(),
});
export type SubmitterOption = z.infer<typeof SubmitterOptionSchema>;

export const PrayerFeedbackSubmitterResponseSchema = z.object({
  /** The signed-in user themselves, always first. */
  self: SubmitterOptionSchema,
  /** Other living household members. Empty for a one-person household. */
  household: z.array(SubmitterOptionSchema),
});
export type PrayerFeedbackSubmitterResponse = z.infer<
  typeof PrayerFeedbackSubmitterResponseSchema
>;

/**
 * Parse a `feedback-type-ids` attribute (or a `?ids=` query) into ids.
 *
 * Returns `null` when the input is present but malformed, so a route can answer
 * `invalid_request` rather than silently falling back to the default list — a
 * typo'd allowlist must not quietly widen the dropdown. An absent or empty
 * value is `[]`, which *is* the request for the default.
 */
export function parseFeedbackTypeIds(raw: string | null | undefined): number[] | null {
  if (raw == null) return [];
  const trimmed = raw.trim();
  if (trimmed === "") return [];

  const ids: number[] = [];
  for (const part of trimmed.split(",")) {
    const token = part.trim();
    if (!/^\d+$/.test(token)) return null;
    const id = Number(token);
    if (!Number.isInteger(id) || id <= 0) return null;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}
