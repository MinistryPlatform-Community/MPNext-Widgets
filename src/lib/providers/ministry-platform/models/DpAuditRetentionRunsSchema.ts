import { z } from 'zod';

export const DpAuditRetentionRunsSchema = z.object({
  Audit_Retention_Run_ID: z.number().int(),
  Run_Date: z.iso.datetime(),
  Active_Erase_Policies: z.number().int(),
  Active_Retain_Policies: z.number().int(),
  Max_Minutes: z.number().int(),
  Policies_Run: z.number().int(),
  Duration_Minutes: z.number().int(),
  Deleted_Audits: z.number().int(),
  Deleted_Details: z.number().int(),
  Remaining_Audits: z.number().int(),
  Remaining_Details: z.number().int(),
});

export type DpAuditRetentionRunsInput = z.infer<typeof DpAuditRetentionRunsSchema>;
