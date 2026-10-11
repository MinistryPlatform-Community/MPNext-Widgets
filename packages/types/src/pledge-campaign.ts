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

  // ── Registration window and capacity (C76 phase 1) ──
  //
  // `api_MPPW_GetPledgeCampaign` has always returned these four; the service
  // simply did not map them, so a campaign with a seat cap accepted pledges
  // indefinitely. Mission trips need them (a trip has a bus), but the gap was
  // never trip-specific — a capital campaign with `Maximum_Registrants` set had
  // the same defect.
  //
  // Wall-clock strings from MP, passed through verbatim like `startDate` /
  // `endDate` above: never re-serialised through `Date`, or the day shifts.

  /** Seat cap. `null` or `0` both mean uncapped. */
  maximumRegistrants: z.number().nullable(),
  /**
   * Pledges already placed against the campaign — the procedure's `PledgeCount`,
   * counting statuses 1, 2 and 4. Distinct from `numberOfPledges` only in name;
   * both map the same column, and this one is the spelling the capacity check
   * reads so the intent is legible at the call site.
   */
  currentRegistrants: z.number(),
  /** Applications open. `null` means "no opening date", i.e. already open. */
  registrationStart: z.string().nullable(),
  /** Applications close. `null` means "no closing date", i.e. never closes. */
  registrationEnd: z.string().nullable(),
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
/**
 * Ceiling on a pledge's installment amount and total (C32), in the domain's
 * currency. A **flat** bound, deliberately not derived from the campaign goal:
 * a donor may legitimately pledge past the goal, and a goal-derived cap would
 * reject good pledges. One billion leaves two orders of magnitude over any
 * plausible single pledge while still refusing the "sixteen trillion" typo the
 * comparison run wrote into `Pledges` (`Total_Pledge = 15999999999984`).
 *
 * `next-pledge-campaign` mirrors this value (the SDK does not import this
 * package at runtime); `pledge-campaign.test.ts` asserts the two agree.
 */
export const MAX_PLEDGE_AMOUNT = 1_000_000_000;

/** A pledge money value (Zod 4 numbers are already finite): greater than zero, at most {@link MAX_PLEDGE_AMOUNT}. */
export const PledgeMoneySchema = z.number().positive().max(MAX_PLEDGE_AMOUNT);

export const SavePledgeRequestSchema = z.object({
  pledgeCampaignId: z.number(),
  pledgeEmailTemplateId: z.number().optional(),
  contactId: z.number(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().optional(),
  mobilePhoneNumber: z.string().optional(),
  installmentAmount: PledgeMoneySchema,
  frequency: z.number(),
  firstInstallmentDate: z.string(),
  lastInstallmentDate: z.string().nullable().optional(),
  installmentsPlanned: z.number(),
  installmentsPerYear: z.number(),
  totalPledge: PledgeMoneySchema,
});
export type SavePledgeRequest = z.infer<typeof SavePledgeRequestSchema>;

export const SavePledgeResponseSchema = z.object({
  success: z.boolean(),
  pledgeId: z.number().nullable(),
  message: z.string().optional(),
});
export type SavePledgeResponse = z.infer<typeof SavePledgeResponseSchema>;
