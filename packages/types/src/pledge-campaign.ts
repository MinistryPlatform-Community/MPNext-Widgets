import { z } from "zod";

// ── Response Schemas ──

/**
 * A pledge campaign with its aggregate progress totals, sourced from the
 * `api_MPPW_GetPledgeCampaign` stored procedure (legacy parity). Percentages
 * are computed client-side from `pledged` / `received` against `campaignGoal`.
 */
export const PledgeCampaignSchema = z.object({
  pledgeCampaignId: z.number(),
  title: z.string(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  campaignGoal: z.number(),
  fundraisingGoal: z.number().nullable(),
  /** Sum of all pledged amounts for the campaign. */
  pledged: z.number(),
  /** Sum of donations received toward the campaign. */
  received: z.number(),
  numberOfPledges: z.number(),
  startDate: z.string(),
  endDate: z.string().nullable(),
  allowOnlinePledge: z.boolean(),
  pledgeBeyondEndDate: z.boolean(),
  onlineThankYouMessage: z.string().nullable(),
  forceLogin: z.boolean(),
  eventId: z.number().nullable(),
  customFormId: z.number().nullable(),
  customFormGuid: z.string().nullable(),
});
export type PledgeCampaign = z.infer<typeof PledgeCampaignSchema>;

export const PledgeCampaignResponseSchema = z.object({
  campaign: PledgeCampaignSchema,
  /** True when the signed-in contact already has a pledge for this campaign. */
  userHasAlreadyPledged: z.boolean(),
});
export type PledgeCampaignResponse = z.infer<typeof PledgeCampaignResponseSchema>;

/** Pledge frequency lookup item (id = Frequency_ID, e.g. 12 = Monthly). */
export const PledgeFrequencySchema = z.object({
  id: z.number(),
  name: z.string(),
});
export type PledgeFrequency = z.infer<typeof PledgeFrequencySchema>;

/** Basic signed-in contact used to prefill / drive the "Make a Pledge As" picker. */
export const PledgeBasicContactSchema = z.object({
  contactId: z.number(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  emailAddress: z.string().nullable(),
  mobilePhoneNumber: z.string().nullable(),
  householdId: z.number().nullable(),
});
export type PledgeBasicContact = z.infer<typeof PledgeBasicContactSchema>;

// ── Request Schemas ──

/**
 * Save-pledge payload. All values arrive as strings from the form and are
 * coerced server-side. `contactId` is the selected household member's contact
 * id, or "0" / "Blank Form" for an anonymous/blank registrant.
 */
export const SavePledgeRequestSchema = z.object({
  pledgeCampaignId: z.number(),
  pledgeEmailTemplateId: z.number().optional(),
  contactId: z.number(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().optional(),
  mobilePhoneNumber: z.string().optional(),
  installmentAmount: z.number(),
  frequency: z.number(),
  firstInstallmentDate: z.string(),
  lastInstallmentDate: z.string().nullable().optional(),
  installmentsPlanned: z.number(),
  installmentsPerYear: z.number(),
  totalPledge: z.number(),
});
export type SavePledgeRequest = z.infer<typeof SavePledgeRequestSchema>;

export const SavePledgeResponseSchema = z.object({
  success: z.boolean(),
  pledgeId: z.number().nullable(),
  message: z.string().optional(),
});
export type SavePledgeResponse = z.infer<typeof SavePledgeResponseSchema>;
