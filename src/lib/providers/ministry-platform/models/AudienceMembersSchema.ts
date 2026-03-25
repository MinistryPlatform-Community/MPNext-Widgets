import { z } from 'zod';

export const AudienceMembersSchema = z.object({
  Audience_Member_ID: z.number().int(),
  Audience_ID: z.number().int(),
  Contact_ID: z.number().int(),
  Start_Date: z.iso.datetime(),
  End_Date: z.iso.datetime().nullable(),
  Forced_Filter: z.boolean(),
  Active: z.boolean(),
  Last_Update_Date: z.iso.datetime(),
});

export type AudienceMembersInput = z.infer<typeof AudienceMembersSchema>;
