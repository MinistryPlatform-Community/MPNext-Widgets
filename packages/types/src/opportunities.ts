import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────
// Opportunity Finder (public search)
//
// Ported from the legacy `mpp-opportunity-finder` portal widget / .NET
// `OpportunityService.SearchOpportunities`. Search runs the
// `api_MPPW_SearchOpportunities` procedure; the service then drops any
// opportunity whose Maximum_Needed has been met.
// ─────────────────────────────────────────────────────────────────────────

/** A single opportunity card returned by the finder search. */
export const OpportunitySearchResultSchema = z.object({
  id: z.number(),
  title: z.string(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  location: z.string().nullable(),
  /** Recurring meeting day name, or "Ongoing" for opportunities with no date. */
  meetingDay: z.string().nullable(),
  /** Wall-clock start datetime (MP domain time); empty when ongoing. */
  meetingTime: z.string().nullable(),
  featured: z.boolean(),
  /** Pill strings (required gender, minimum age) for the card. */
  attributes: z.array(z.string()),
});
export type OpportunitySearchResult = z.infer<typeof OpportunitySearchResultSchema>;

export const OpportunitySearchResponseSchema = z.object({
  opportunities: z.array(OpportunitySearchResultSchema),
});
export type OpportunitySearchResponse = z.infer<typeof OpportunitySearchResponseSchema>;

/** An id/name option used to populate finder filter dropdowns. */
export const OpportunityFilterOptionSchema = z.object({
  id: z.number(),
  name: z.string(),
});
export type OpportunityFilterOption = z.infer<typeof OpportunityFilterOptionSchema>;

/** A grouped attribute-type option (type → its selectable attributes). */
export const OpportunityAttributeTypeSchema = z.object({
  id: z.number(),
  name: z.string(),
  attributes: z.array(OpportunityFilterOptionSchema),
});
export type OpportunityAttributeType = z.infer<typeof OpportunityAttributeTypeSchema>;

/** Dropdown configuration data for the opportunity finder. */
export const OpportunityConfigurationsSchema = z.object({
  congregations: z.array(OpportunityFilterOptionSchema),
  ministries: z.array(OpportunityFilterOptionSchema),
  genders: z.array(OpportunityFilterOptionSchema),
  attributeTypes: z.array(OpportunityAttributeTypeSchema),
});
export type OpportunityConfigurations = z.infer<typeof OpportunityConfigurationsSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Opportunity Details (single opportunity + respond form)
//
// Ported from `mpp-opportunity-details` / .NET `OpportunityManager
// .GetOpportunityById`. Read straight from the Opportunities table with FK
// traversal; response count drives the "remaining needed" gate.
// ─────────────────────────────────────────────────────────────────────────

export const OpportunityContactSchema = z.object({
  displayName: z.string().nullable(),
  imageUrl: z.string().nullable(),
  emailAddress: z.string().nullable(),
});
export type OpportunityContact = z.infer<typeof OpportunityContactSchema>;

export const OpportunityDetailSchema = z.object({
  id: z.number(),
  title: z.string(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  location: z.string().nullable(),
  /** Full address line for the map, when resolvable. */
  address: z.string().nullable(),
  /** Wall-clock start datetime (MP domain time); empty when ongoing. */
  startDate: z.string(),
  /** Recurring meeting day name, or "Ongoing". */
  meetingDay: z.string().nullable(),
  requiredGender: z.string().nullable(),
  minimumAge: z.string().nullable(),
  /** Remaining volunteers needed; null when Maximum_Needed is unset (no cap). */
  remainingNeeded: z.number().nullable(),
  maximumNeeded: z.number().nullable(),
  numberOfResponses: z.number(),
  visibilityLevel: z.number(),
  eventId: z.number().nullable(),
  customFormId: z.number().nullable(),
  customFormGuid: z.string().nullable(),
  forceLogin: z.boolean(),
  contacts: z.array(OpportunityContactSchema),
});
export type OpportunityDetail = z.infer<typeof OpportunityDetailSchema>;

/**
 * Respond (volunteer inquiry) submission. Custom-form fields are dynamic
 * (`mp_customform_*`), so the request is a loose string map mirroring the
 * legacy multipart form. Well-known fields: ContactId, FirstName, LastName,
 * EmailAddress, MobilePhoneNumber, Message, OpportunityId, mp_customformformid.
 */
export const OpportunityRespondRequestSchema = z.record(z.string(), z.string());
export type OpportunityRespondRequest = z.infer<typeof OpportunityRespondRequestSchema>;

export const OpportunityRespondResponseSchema = z.object({
  success: z.boolean(),
  responseId: z.number().nullable(),
  message: z.string().optional(),
});
export type OpportunityRespondResponse = z.infer<typeof OpportunityRespondResponseSchema>;
