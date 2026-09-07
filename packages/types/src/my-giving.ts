import { z } from "zod";

// ── Response Schemas ──

export const DonationRecordSchema = z.object({
  donationDate: z.string(),
  amount: z.number(),
  programId: z.number(),
  programName: z.string(),
  statementTitle: z.string(),
  isTaxDeductible: z.boolean(),
  isSpouseDonation: z.boolean(),
  isSoftCredit: z.boolean(),
  isPending: z.boolean(),
  isOmitAmount: z.boolean(),
});
export type DonationRecord = z.infer<typeof DonationRecordSchema>;

export const MyGivingResponseSchema = z.object({
  donations: z.array(DonationRecordSchema),
});
export type MyGivingResponse = z.infer<typeof MyGivingResponseSchema>;
