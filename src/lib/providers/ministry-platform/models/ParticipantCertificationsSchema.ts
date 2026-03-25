import { z } from 'zod';

export const ParticipantCertificationsSchema = z.object({
  Participant_Certification_ID: z.number().int(),
  Participant_ID: z.number().int(),
  Certification_Type_ID: z.number().int(),
  Certification_Submitted: z.iso.datetime(),
  Certification_Completed: z.iso.datetime().nullable(),
  Passed: z.boolean().nullable(),
  Certification_Expires: z.iso.datetime().nullable(),
  Certification_GUID: z.guid(),
  Notes: z.string().max(500).nullable(),
});

export type ParticipantCertificationsInput = z.infer<typeof ParticipantCertificationsSchema>;
