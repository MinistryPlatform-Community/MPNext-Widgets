import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────
// Group Finder (public search) — backed by api_MPPW_SearchGroups
// ─────────────────────────────────────────────────────────────────────────

/** A single group card returned by the finder search. */
export const GroupCardSchema = z.object({
  id: z.number(),
  title: z.string(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  /** Group Type name, shown when there is no image. */
  noImageText: z.string().nullable(),
  location: z.string().nullable(),
  meetingDay: z.string().nullable(),
  /** Wall-clock time string (e.g. "18:30:00"); formatted client-side. */
  meetingTime: z.string().nullable(),
  startDate: z.string().nullable(),
  isFull: z.boolean(),
  meetsOnline: z.boolean(),
  totalParticipantsCount: z.number(),
  targetSize: z.number().nullable(),
});
export type GroupCard = z.infer<typeof GroupCardSchema>;

export const GroupSearchResponseSchema = z.object({
  groups: z.array(GroupCardSchema),
});
export type GroupSearchResponse = z.infer<typeof GroupSearchResponseSchema>;

/** An id/name option used to populate finder filter dropdowns. */
export const GroupFilterOptionSchema = z.object({
  id: z.number(),
  name: z.string(),
});
export type GroupFilterOption = z.infer<typeof GroupFilterOptionSchema>;

/** Dropdown configuration data for the finder + suggest-a-group form. */
export const GroupConfigurationsSchema = z.object({
  congregations: z.array(GroupFilterOptionSchema),
  parentGroups: z.array(GroupFilterOptionSchema),
  groupFocuses: z.array(GroupFilterOptionSchema),
  lifeStages: z.array(GroupFilterOptionSchema),
});
export type GroupConfigurations = z.infer<typeof GroupConfigurationsSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Group Details (single group, api_MPPW_SearchGroups filtered by @GroupId)
// ─────────────────────────────────────────────────────────────────────────

/** A group leader / primary contact (second result set of the search proc). */
export const GroupContactSchema = z.object({
  contactId: z.number(),
  displayName: z.string().nullable(),
  firstName: z.string().nullable(),
  nickName: z.string().nullable(),
  lastName: z.string().nullable(),
  imageUrl: z.string().nullable(),
  emailAddress: z.string().nullable(),
});
export type GroupContact = z.infer<typeof GroupContactSchema>;

export const GroupDetailSchema = GroupCardSchema.extend({
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  address: z.string().nullable(),
  lifeStage: z.string().nullable(),
  groupFocus: z.string().nullable(),
  meetingFrequency: z.string().nullable(),
  userHasInquired: z.boolean(),
  userHasSignedUp: z.boolean(),
  contacts: z.array(GroupContactSchema),
});
export type GroupDetail = z.infer<typeof GroupDetailSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Inquiry / Sign-up / Suggest requests
// ─────────────────────────────────────────────────────────────────────────

/**
 * Group inquiry or sign-up submission. `contactId` is the selected household
 * member (0/empty = anonymous "Blank Form"). The name/email/phone fields back
 * the anonymous blank form. `targetId` is the group id.
 */
export const GroupInquiryRequestSchema = z.object({
  targetId: z.number(),
  contactId: z.number().nullable().optional(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  emailAddress: z.string().nullable().optional(),
  mobilePhoneNumber: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
});
export type GroupInquiryRequest = z.infer<typeof GroupInquiryRequestSchema>;

export const GroupActionResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
});
export type GroupActionResponse = z.infer<typeof GroupActionResponseSchema>;

/** Suggest-a-group submission (requires authentication). */
export const SuggestGroupRequestSchema = z.object({
  groupName: z.string(),
  description: z.string(),
  newGroupCongregationId: z.number(),
  newGroupGroupFocusId: z.number().nullable().optional(),
  newGroupLifeStageId: z.number().nullable().optional(),
  newGroupMeetingDayId: z.number().nullable().optional(),
  /** "HH:mm" time string from the form's time input. */
  newGroupMeetingTime: z.string().nullable().optional(),
});
export type SuggestGroupRequest = z.infer<typeof SuggestGroupRequestSchema>;

/** Current signed-in contact + household members for the Inquire/Sign-up "as" picker. */
export const GroupContactOptionSchema = z.object({
  contactId: z.number(),
  displayName: z.string(),
});
export type GroupContactOption = z.infer<typeof GroupContactOptionSchema>;

export const GroupCurrentContactSchema = z.object({
  contactId: z.number(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  emailAddress: z.string().nullable(),
  mobilePhoneNumber: z.string().nullable(),
  householdId: z.number().nullable(),
  members: z.array(GroupContactOptionSchema),
});
export type GroupCurrentContact = z.infer<typeof GroupCurrentContactSchema>;
