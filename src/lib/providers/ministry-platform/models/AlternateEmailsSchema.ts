import { z } from 'zod';

export const AlternateEmailsSchema = z.object({
  Alternate_Email_ID: z.number().int(),
  Contact_ID: z.number().int(),
  Alternate_Email_Type_ID: z.number().int(),
  Email_Address: z.email().nullable(),
});

export type AlternateEmailsInput = z.infer<typeof AlternateEmailsSchema>;
