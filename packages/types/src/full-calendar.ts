import { z } from "zod";

export const CalendarEventSchema = z.object({
  Event_ID: z.number(),
  Event_Title: z.string(),
  Event_Start_Date: z.string(),
  Event_End_Date: z.string(),
  Event_Type_ID: z.number().nullable(),
  Event_Type: z.string().nullable(),
  Congregation_ID: z.number().nullable(),
  Congregation_Name: z.string().nullable(),
  Location_Name: z.string().nullable(),
  Description: z.string().nullable(),
  Featured_On_Calendar: z.boolean(),
  Registration_URL: z.string().nullable(),
  Image_URL: z.string().nullable(),
  Program_ID: z.number().nullable(),
  Program_Name: z.string().nullable(),
  Ministry_Name: z.string().nullable(),
  Primary_Contact_Name: z.string().nullable(),
  Primary_Contact_Email: z.string().nullable(),
  Primary_Contact_Phone: z.string().nullable(),
  Participants_Expected: z.number().nullable(),
  Participant_Count: z.number().nullable(),
  Registration_Product_Name: z.string().nullable(),
  MP_Detail_URL: z.string().nullable(),
});
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

export const CalendarFilterSchema = z.object({
  id: z.number(),
  name: z.string(),
});
export type CalendarFilter = z.infer<typeof CalendarFilterSchema>;

export const CalendarEventsResponseSchema = z.object({
  events: z.array(CalendarEventSchema),
  isAdmin: z.boolean(),
  filters: z.object({
    campuses: z.array(CalendarFilterSchema),
    ministries: z.array(CalendarFilterSchema),
  }),
});
export type CalendarEventsResponse = z.infer<typeof CalendarEventsResponseSchema>;

export const CalendarEventDetailResponseSchema = z.object({
  event: CalendarEventSchema,
  isAdmin: z.boolean(),
});
export type CalendarEventDetailResponse = z.infer<typeof CalendarEventDetailResponseSchema>;
