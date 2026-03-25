import { z } from 'zod';

export const BookCheckoutsSchema = z.object({
  Book_Checkout_ID: z.number().int(),
  Book_ID: z.number().int(),
  Contact_ID: z.number().int(),
  Checkout_Date: z.iso.datetime(),
  Due_Date: z.iso.datetime().nullable(),
  Date_Returned: z.iso.datetime().nullable(),
  Notes: z.string().max(2147483647).nullable(),
  Is_Returned: z.number().int(),
});

export type BookCheckoutsInput = z.infer<typeof BookCheckoutsSchema>;
