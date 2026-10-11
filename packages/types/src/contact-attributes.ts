/**
 * `next-contact-attributes` (C52) — self-service contact attributes.
 *
 * The legacy widget was `mpp-about-me`. Two things its naming got wrong and
 * this file does not: the grouping entity is **`Attribute_Types`**, not
 * "Attribute_Categories" (which does not exist in MinistryPlatform — the legacy
 * `category_2_attribute_3` checkbox name interpolates an `Attribute_Type_ID`
 * into a variable its author happened to call `category`), and member
 * visibility is `Attribute_Types.Available_Online`, a **type**-level flag.
 * `Attributes` carries no online flag at all, so a church cannot hide one
 * attribute within a visible type.
 *
 * Full reasoning: `.claude/TODO/Comparison/Plans/contact-attributes.md`.
 */

import { z } from "zod";

// ── Read ──

/**
 * One member-visible attribute, with whether the contact currently holds it.
 *
 * `selected` is true when an **active** `Contact_Attributes` row exists —
 * `End_Date` null or in the future. An end-dated row is a past declaration and
 * reads as unselected, but it is not gone: re-selecting reactivates that same
 * row rather than inserting a second one.
 */
export const ContactAttributeItemSchema = z.object({
  attributeId: z.number().int(),
  attributeName: z.string(),
  selected: z.boolean(),
});
export type ContactAttributeItem = z.infer<typeof ContactAttributeItemSchema>;

/**
 * One `Attribute_Types` row with `Available_Online = 1` and its attributes.
 *
 * Types are ordered by `Online_Sort_Order` (nulls last) then name, and
 * attributes by name. Legacy ignored `Online_Sort_Order` entirely; honouring it
 * is a deliberate small improvement, not a parity break.
 *
 * A type whose attribute list would be empty is dropped before it reaches the
 * wire, matching legacy's `results.Where(r => r.Attributes.SafeAny())`.
 */
export const ContactAttributeGroupSchema = z.object({
  attributeTypeId: z.number().int(),
  attributeTypeName: z.string(),
  attributes: z.array(ContactAttributeItemSchema),
});
export type ContactAttributeGroup = z.infer<typeof ContactAttributeGroupSchema>;

/**
 * `GET /api/embed/contact-attributes`.
 *
 * An empty `types` array is **not** an error — it is what a domain with no
 * `Available_Online` attribute type returns, which is the default on a fresh
 * MP domain. The widget renders an explanatory state; answering 4xx would make
 * the demo page look broken on day one.
 */
export const ContactAttributesResponseSchema = z.object({
  types: z.array(ContactAttributeGroupSchema),
});
export type ContactAttributesResponse = z.infer<typeof ContactAttributesResponseSchema>;

// ── Write ──

/**
 * `PUT /api/embed/contact-attributes` — the **complete** desired set.
 *
 * Deliberately not legacy's `{ attributesToAdd, attributesToRemove }` delta.
 * The legacy client computed that delta from click events against a snapshot,
 * so two open tabs silently clobbered each other with no version and no error,
 * and "absent from both arrays" was the only encoding for both "leave alone"
 * and "the client forgot". Sending the full set moves the diff to the server,
 * where the truth is, and makes a replay a no-op instead of a resurrection.
 *
 * The server rejects any id outside the member-visible universe
 * (`invalid_attribute`) — legacy validated nothing here, so a signed-in
 * congregant could write themselves any attribute in any hidden type.
 */
export const ContactAttributesUpdateSchema = z.object({
  attributeIds: z.array(z.number().int()),
});
export type ContactAttributesUpdateRequest = z.infer<typeof ContactAttributesUpdateSchema>;

/**
 * The PUT answers with the recomputed read payload rather than a bare success
 * flag, so the widget re-renders from the server's truth instead of from what
 * it hoped it wrote.
 */
export const ContactAttributesUpdateResponseSchema = ContactAttributesResponseSchema;
export type ContactAttributesUpdateResponse = ContactAttributesResponse;
