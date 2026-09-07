import { z } from "zod";

// ── Response Schemas ──

export const ContributionStatementSchema = z.object({
  Statement_ID: z.number(),
  Statement_Year: z.number(),
  File_Name: z.string(),
  Unique_Name: z.string(),
  Extension: z.string(),
  Download_Url: z.string(),
});
export type ContributionStatement = z.infer<typeof ContributionStatementSchema>;

export const ContributionStatementGroupSchema = z.object({
  Accounting_Company_Name: z.string(),
  statements: z.array(ContributionStatementSchema),
});
export type ContributionStatementGroup = z.infer<
  typeof ContributionStatementGroupSchema
>;

export const ContributionStatementsResponseSchema = z.object({
  groups: z.array(ContributionStatementGroupSchema),
});
export type ContributionStatementsResponse = z.infer<
  typeof ContributionStatementsResponseSchema
>;
