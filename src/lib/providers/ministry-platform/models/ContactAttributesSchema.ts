import { z } from 'zod';

export const ContactAttributesSchema = z.object({
  Contact_Attribute_ID: z.number().int(),
  Contact_ID: z.number().int(),
  Attribute_ID: z.number().int(),
  Start_Date: z.iso.datetime(),
  End_Date: z.iso.datetime().nullable(),
  Notes: z.string().max(2000).nullable(),
});

export type ContactAttributesInput = z.infer<typeof ContactAttributesSchema>;
