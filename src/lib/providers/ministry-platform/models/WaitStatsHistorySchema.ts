import { z } from 'zod';

export const WaitStatsHistorySchema = z.object({
  WaitStatsID: z.number().int(),
  SnapshotDT: z.iso.datetime(),
  WaitType: z.string().max(60),
  WaitingTasksCount: z.number().int(),
  WaitTimeMS: z.number().int(),
  MaxWaitTimeMS: z.number().int(),
  SignalWaitTimeMS: z.number().int(),
  ResourceWaitTimeMS: z.number().int().nullable(),
  SnapshotHour: z.number().int().nullable(),
  SnapshotDay: z.iso.datetime().nullable(),
  SnapshotISOYear: z.number().int().nullable(),
  SnapshotWeek: z.number().int().nullable(),
  SnapshotMonth: z.number().int().nullable(),
  SnapshotYear: z.number().int().nullable(),
});

export type WaitStatsHistoryInput = z.infer<typeof WaitStatsHistorySchema>;
