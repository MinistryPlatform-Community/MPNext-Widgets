import { z } from 'zod';

export const ProgramGroupsSchema = z.object({
  Program_Group_ID: z.number().int(),
  Program_ID: z.number().int(),
  Group_ID: z.number().int(),
  Room_ID: z.number().int().nullable(),
  Start_Date: z.iso.datetime(),
  End_Date: z.iso.datetime().nullable(),
});

export type ProgramGroupsInput = z.infer<typeof ProgramGroupsSchema>;
