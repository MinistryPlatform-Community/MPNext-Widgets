/**
 * `next-unsubscribe` — the wire contract for the one-click unsubscribe landing
 * page (C72).
 *
 * The recipient of a bulk email has no login, so the request carries a bearer
 * *capability* instead of a session: either `cg` (the `Contacts.Contact_GUID`
 * MP's merge engine writes as `[Contact_GUID]`) or `token` (a sealed action
 * token, for links we mint ourselves). Both are opaque to this module — it only
 * describes the shape, and `src/app/api/embed/unsubscribe/route.ts` decides
 * which one wins.
 *
 * ## `pubid` has three spellings for one meaning
 *
 * Legacy read `urlParams.get("pubid") || 0` and its controller defaulted the
 * parameter to `0`, so links already sitting in people's inboxes omit it, send
 * it empty, or send a literal `0` — and all three mean *"bulk email opt-out"*,
 * not *"publication number zero"*. `resolvePublicationId` is the single place
 * that collapses them, so no caller has to remember the sentinel. A value that
 * is neither absent nor a non-negative integer is a malformed request and the
 * schema rejects it, rather than silently degrading to the bulk path — a typo'd
 * `pubid` must not quietly unsubscribe someone from *everything*.
 */

import { z } from "zod";

/**
 * Which direction the route writes.
 *
 * One route rather than legacy's `Unsubscribe` + `UndoUnsubscribe` pair: every
 * guard (auth, both rate limits, GUID validation, masking, the uniform
 * response) is identical between them, and duplicating guards across two files
 * is how they drift apart.
 */
export const UnsubscribeActionSchema = z.enum(["unsubscribe", "resubscribe"]);
export type UnsubscribeAction = z.infer<typeof UnsubscribeActionSchema>;

/** Whether the write touched one publication or the whole bulk-email flag. */
export const UnsubscribeScopeSchema = z.enum(["publication", "bulk"]);
export type UnsubscribeScope = z.infer<typeof UnsubscribeScopeSchema>;

/**
 * `pubid` as it arrives: a number, a numeric string, empty, or absent.
 *
 * Accepts `0` and `""` because legacy links contain them; rejects `-1`, `1.5`
 * and `"abc"` so a malformed link is a `validation_failed`, never a silent bulk
 * opt-out.
 */
const PublicationIdInputSchema = z.union([
  z.number().int().nonnegative(),
  z.string().regex(/^\d*$/),
]);

export const UnsubscribeRequestSchema = z.object({
  /**
   * `Contacts.Contact_GUID`. Length-capped here purely to bound the work before
   * the strict GUID-shape check in `isContactGuid` runs; this schema does not
   * validate the shape, because a malformed `cg` and a missing one are the same
   * `invalid_request` at the route.
   */
  cg: z.string().max(64).optional(),
  pubid: PublicationIdInputSchema.nullish(),
  /** Sealed action token (`typ: "unsubscribe"`), for links we mint. */
  token: z.string().max(4096).optional(),
  action: UnsubscribeActionSchema.default("unsubscribe"),
});
export type UnsubscribeRequest = z.input<typeof UnsubscribeRequestSchema>;
export type ParsedUnsubscribeRequest = z.output<typeof UnsubscribeRequestSchema>;

/**
 * The response, which is deliberately the same shape and status for a real
 * unsubscribe, an unknown capability and an already-opted-out contact.
 *
 * A distinguishable 404 would make the route an oracle for *"is this GUID a
 * live contact"*; `email: null` / `canUndo: false` are values a real contact
 * legitimately produces too (no address on file, already opted out).
 */
export const UnsubscribeResponseSchema = z.object({
  success: z.literal(true),
  scope: UnsubscribeScopeSchema,
  /** `null` on the bulk path. Never the publication's title — see the plan. */
  publicationId: z.number().nullable(),
  /** Masked server-side (`j•••@g•••.com`), or `null`. Never the full address. */
  email: z.string().nullable(),
  /**
   * Whether to offer Undo. `false` covers "already opted out" and "unknown
   * capability" identically, which is also the fix for legacy's undo bug: undo
   * only ever *reduces* an opt-out, so someone who was already opted out is
   * never offered a button that would opt them back in.
   */
  canUndo: z.boolean(),
});
export type UnsubscribeResponse = z.infer<typeof UnsubscribeResponseSchema>;

/**
 * Collapse `pubid`'s three bulk spellings — absent, `""`, `0` — to `null`.
 *
 * `null` means the bulk-email path (`Contacts.Bulk_Email_Opt_Out`); a positive
 * integer means one publication.
 */
export function resolvePublicationId(
  pubid: number | string | null | undefined
): number | null {
  if (pubid === null || pubid === undefined || pubid === "") return null;
  const parsed = typeof pubid === "number" ? pubid : Number(pubid);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** The scope a resolved publication id implies. */
export function unsubscribeScope(publicationId: number | null): UnsubscribeScope {
  return publicationId === null ? "bulk" : "publication";
}
