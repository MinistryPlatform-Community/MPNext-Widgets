import { z } from 'zod';

export const WaitStatsBaselineSchema = z.object({
  WaitType: z.string().max(60),
  WaitingTasksCount: z.number().int(),
  WaitTimeMS: z.number().int(),
  MaxWaitTimeMS: z.number().int(),
  SignalWaitTimeMS: z.number().int(),
  SnapshotDT: z.iso.datetime(),
});

export type WaitStatsBaselineInput = z.infer<typeof WaitStatsBaselineSchema>;
