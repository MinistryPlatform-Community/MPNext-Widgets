import { z } from 'zod';

export const PersonnelBenefitsSchema = z.object({
  Personnel_Benefit_ID: z.number().int(),
  Personnel_ID: z.number().int(),
  Benefit_Type_ID: z.number().int(),
  Start_Date: z.iso.datetime().nullable(),
  Expiration_Date: z.iso.datetime().nullable(),
  Benefit_Notes: z.string().max(2000).nullable(),
});

export type PersonnelBenefitsInput = z.infer<typeof PersonnelBenefitsSchema>;
