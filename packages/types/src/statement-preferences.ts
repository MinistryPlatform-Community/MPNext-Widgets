import { z } from "zod";

// ── Response Schemas ──

export const StatementPreferenceSchema = z.object({
  donorId: z.number(),
  statementMethodId: z.number(),
  paperless: z.boolean(),
});
export type StatementPreference = z.infer<typeof StatementPreferenceSchema>;

// ── Request Schemas ──

export const UpdateStatementPreferenceRequestSchema = z.object({
  paperless: z.boolean(),
});
export type UpdateStatementPreferenceRequest = z.infer<
  typeof UpdateStatementPreferenceRequestSchema
>;
