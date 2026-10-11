import { z } from 'zod';

export const StatisticsLogsSchema = z.object({
  Log_ID: z.number().int(),
  Log_Date: z.iso.datetime(),
  Table_Name: z.string().max(75),
  Duration: z.number().int().nullable(),
  Sample_Percent: z.unknown().nullable(),
});

export type StatisticsLogsInput = z.infer<typeof StatisticsLogsSchema>;
