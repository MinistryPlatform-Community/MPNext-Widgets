import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────
// Plan Your Visit — configuration (congregations / genders / countries / mask)
// ─────────────────────────────────────────────────────────────────────────

export const PyvOptionSchema = z.object({
  id: z.number(),
  name: z.string(),
});
export type PyvOption = z.infer<typeof PyvOptionSchema>;

export const PyvCountrySchema = z.object({
  code: z.string(),
  name: z.string(),
});
export type PyvCountry = z.infer<typeof PyvCountrySchema>;

export const PlanYourVisitConfigSchema = z.object({
  congregations: z.array(PyvOptionSchema),
  genders: z.array(PyvOptionSchema),
  countries: z.array(PyvCountrySchema),
  phoneMask: z.string().nullable(),
});
export type PlanYourVisitConfig = z.infer<typeof PlanYourVisitConfigSchema>;

/** One age/grade group option for a child, with the promote-age used to sort. */
export const AgeOrGradeGroupSchema = z.object({
  id: z.number(),
  value: z.string(),
  ageInMonthsToPromote: z.number().nullable(),
});
export type AgeOrGradeGroup = z.infer<typeof AgeOrGradeGroupSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Verification (step 1)
// ─────────────────────────────────────────────────────────────────────────

export const PyvVerifyRequestSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  returnUrl: z.string(),
  /** dp_Communications template id used for the verification email. */
  verificationEmailTemplate: z.string().nullable().optional(),
});
export type PyvVerifyRequest = z.infer<typeof PyvVerifyRequestSchema>;

export const PyvSendResponseSchema = z.object({
  success: z.boolean(),
  /** Set when the email already belongs to an existing contact (offer sign-in). */
  contactExists: z.boolean().optional(),
  message: z.string().optional(),
});
export type PyvSendResponse = z.infer<typeof PyvSendResponseSchema>;

export const PyvVerifyResultSchema = z.object({
  success: z.boolean(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: z.string().nullable(),
  /** "expired" | "invalid" | "exists" when success is false. */
  reason: z.string().nullable().optional(),
});
export type PyvVerifyResult = z.infer<typeof PyvVerifyResultSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Registration (step 2)
// ─────────────────────────────────────────────────────────────────────────

export const PyvAddressSchema = z.object({
  addressLine1: z.string().nullable().optional(),
  addressLine2: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  stateRegion: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  countryCode: z.string().nullable().optional(),
});
export type PyvAddress = z.infer<typeof PyvAddressSchema>;

export const PyvChildSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  dateOfBirth: z.string().nullable().optional(),
  genderId: z.number().nullable().optional(),
  /** Group_ID of the chosen Age or Grade Group (0/none = no group assignment). */
  ageAndGradeGroup: z.number().nullable().optional(),
});
export type PyvChild = z.infer<typeof PyvChildSchema>;

export const PyvSpouseSchema = z.object({
  firstName: z.string().nullable().optional(),
  emailAddress: z.string().nullable().optional(),
  mobilePhoneNumber: z.string().nullable().optional(),
});
export type PyvSpouse = z.infer<typeof PyvSpouseSchema>;

export const PyvRegisterRequestSchema = z.object({
  /** The verification token from the email link — gates the whole write path. */
  token: z.string(),
  /**
   * Head-of-household email. The client sends the value shown read-only, but the
   * server overwrites it with the email embedded in the verified token.
   */
  email: z.string(),
  congregationId: z.number(),
  whenCanWeExpectYou: z.string(),
  headOfHousehold: z.object({
    firstName: z.string(),
    lastName: z.string(),
    mobilePhoneNumber: z.string().nullable().optional(),
  }),
  spouse: PyvSpouseSchema.nullable().optional(),
  children: z.array(PyvChildSchema).optional(),
  address: PyvAddressSchema.nullable().optional(),
  milestoneToAssignId: z.number().nullable().optional(),
  milestoneProgramId: z.number().nullable().optional(),
  /** dp_Communications template ids (from widget attributes). */
  churchNotificationEmailTemplate: z.string().nullable().optional(),
  userNotificationEmailTemplate: z.string().nullable().optional(),
});
export type PyvRegisterRequest = z.infer<typeof PyvRegisterRequestSchema>;

export const PyvRegisterResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
});
export type PyvRegisterResponse = z.infer<typeof PyvRegisterResponseSchema>;
