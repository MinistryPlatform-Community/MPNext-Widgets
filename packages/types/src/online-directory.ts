import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────
// Online Directory (authenticated member directory)
//
// Ported from the legacy `mpp-online-directory` portal widget / .NET
// `OnlineDirectoryService`. Access is gated by the signed-in user's
// participant type + member status (`Can_Access_Directory` flags); search runs
// a Contacts read with directory-eligibility filters.
// ─────────────────────────────────────────────────────────────────────────

/** Whether the signed-in user may view the directory at all. */
export const DirectoryAccessSchema = z.object({
  canAccess: z.boolean(),
});
export type DirectoryAccess = z.infer<typeof DirectoryAccessSchema>;

export const DirectoryFilterOptionSchema = z.object({
  id: z.number(),
  name: z.string(),
});
export type DirectoryFilterOption = z.infer<typeof DirectoryFilterOptionSchema>;

/** Dropdown + behavior configuration for the directory search form. */
export const DirectoryConfigSchema = z.object({
  congregations: z.array(DirectoryFilterOptionSchema),
  /** Minimum keyword length before a search runs (legacy default: 3). */
  minimumSearchLength: z.number(),
  /** Debounce delay for the keyword input, in ms (legacy default: 1000). */
  searchInputTimeout: z.number(),
  /** Prefix that turns a keyword into a household-id lookup (legacy: "hh "). */
  householdPrefix: z.string(),
});
export type DirectoryConfig = z.infer<typeof DirectoryConfigSchema>;

/** A single directory member card. Unlisted fields are nulled server-side. */
export const DirectoryMemberSchema = z.object({
  contactId: z.number(),
  displayName: z.string(),
  householdPosition: z.string().nullable(),
  householdId: z.number().nullable(),
  householdName: z.string().nullable(),
  congregationId: z.number().nullable(),
  contactImageUrl: z.string().nullable(),
  mobilePhone: z.string().nullable(),
  homePhone: z.string().nullable(),
  /** Whether the member exposes an email contact action (address kept server-side). */
  canEmail: z.boolean(),
  /** Birthday display "Mon D" (no year), null when hidden/unset. */
  dateOfBirthShort: z.string().nullable(),
  /** Birthday month/day "MM-DD" for building the client-side ICS, no year. */
  dateOfBirthMonthDay: z.string().nullable(),
  /** Pre-joined "Line 1, City, State PostalCode" for the map link, when listed. */
  address: z.string().nullable(),
});
export type DirectoryMember = z.infer<typeof DirectoryMemberSchema>;

export const DirectorySearchResponseSchema = z.object({
  members: z.array(DirectoryMemberSchema),
});
export type DirectorySearchResponse = z.infer<typeof DirectorySearchResponseSchema>;

/** Compose-email request: the recipient is referenced by contact id only. */
export const DirectoryEmailRequestSchema = z.object({
  toContactId: z.number(),
  subject: z.string().min(1),
  body: z.string().min(1),
});
export type DirectoryEmailRequest = z.infer<typeof DirectoryEmailRequestSchema>;

export const DirectoryEmailResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
});
export type DirectoryEmailResponse = z.infer<typeof DirectoryEmailResponseSchema>;
