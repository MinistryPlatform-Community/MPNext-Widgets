import { z } from "zod";

// ── Response Schemas ──

export const GroupAddressSchema = z.object({
  addressLine1: z.string().nullable(),
  addressLine2: z.string().nullable(),
  city: z.string().nullable(),
  stateRegion: z.string().nullable(),
  postalCode: z.string().nullable(),
});
export type GroupAddress = z.infer<typeof GroupAddressSchema>;

export const GroupSchema = z.object({
  groupId: z.number(),
  groupName: z.string(),
  description: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  availableOnline: z.boolean(),
  meetingDay: z.string().nullable(),
  meetingTime: z.string().nullable(),
  meetsOnline: z.boolean(),
  isUserLeader: z.boolean(),
  volunteerGroup: z.boolean(),
  groupRoleId: z.number().nullable(),
  congregationId: z.number().nullable(),
  primaryContactId: z.number().nullable(),
  imageUrl: z.string().nullable(),
  location: GroupAddressSchema.nullable(),
});
export type Group = z.infer<typeof GroupSchema>;

export const MyGroupsResponseSchema = z.object({
  groups: z.array(GroupSchema),
  cloudUrlPrefix: z.string().nullable(),
});
export type MyGroupsResponse = z.infer<typeof MyGroupsResponseSchema>;
