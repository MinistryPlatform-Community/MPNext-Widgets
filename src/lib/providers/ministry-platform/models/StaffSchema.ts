import { z } from 'zod';

export const StaffSchema = z.object({
  Staff_ID: z.number().int(),
  Contact_ID: z.number().int(),
  Title: z.string().max(50),
  Start_Date: z.iso.datetime(),
  End_Date: z.iso.datetime().nullable(),
  Show_Online: z.boolean(),
  Online_Order: z.unknown(),
  Facebook_URL: z.url().nullable(),
});

export type StaffInput = z.infer<typeof StaffSchema>;
