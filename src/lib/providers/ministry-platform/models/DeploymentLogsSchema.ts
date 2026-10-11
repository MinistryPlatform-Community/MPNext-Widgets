import { z } from 'zod';

export const DeploymentLogsSchema = z.object({
  Log_ID: z.number().int(),
  Log_Title: z.string().max(128),
  Log_Date: z.iso.datetime(),
  Log_Content: z.string().max(2147483647).nullable(),
  Log_Code: z.number().int().nullable(),
  Deployment_ID: z.number().int().nullable(),
});

export type DeploymentLogsInput = z.infer<typeof DeploymentLogsSchema>;
