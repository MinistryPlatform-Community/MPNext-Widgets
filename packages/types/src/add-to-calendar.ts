import { z } from "zod";

export const CalendarEventDataSchema = z.object({
  Event_ID: z.number(),
  Event_Title: z.string(),
  Description: z.string().nullable(),
  Event_Start_Date: z.string(),
  Event_End_Date: z.string(),
  Location_Name: z.string().nullable(),
  Address_Line_1: z.string().nullable(),
  City: z.string().nullable(),
  State: z.string().nullable(),
  Postal_Code: z.string().nullable(),
  /**
   * IANA timezone of the MP domain -- the zone the wall-clock
   * `Event_Start_Date` / `Event_End_Date` values above are expressed in.
   * Optional so a client built against an older payload still validates.
   */
  Time_Zone: z.string().nullable().optional(),
});

export type CalendarEventData = z.infer<typeof CalendarEventDataSchema>;
