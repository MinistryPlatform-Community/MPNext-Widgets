import { z } from "zod";

// ── Response Schemas ──

export const PledgeSchema = z.object({
  pledgeId: z.number(),
  pledgeCampaignId: z.number(),
  campaignName: z.string(),
  pledgeDescription: z.string(),
  contactFirstName: z.string().nullable(),
  contactLastName: z.string().nullable(),
  pledgeStatusId: z.number(),
  pledgeStatus: z.string(),
  installmentsPlanned: z.number(),
  firstInstallmentDate: z.string(),
  imageUrl: z.string().nullable(),
  totalPledge: z.number(),
  pledgeTotalToDate: z.number(),
});
export type Pledge = z.infer<typeof PledgeSchema>;

export const MyPledgesResponseSchema = z.object({
  pledges: z.array(PledgeSchema),
});
export type MyPledgesResponse = z.infer<typeof MyPledgesResponseSchema>;

// ── Request Schemas ──

export const CancelPledgeRequestSchema = z.object({
  pledgeId: z.number(),
  cancelEmailTemplateId: z.number().optional(),
  congregationId: z.number().optional(),
});
export type CancelPledgeRequest = z.infer<typeof CancelPledgeRequestSchema>;
