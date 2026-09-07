import { z } from "zod";

// ── Address ──

export const HouseholdAddressSchema = z.object({
  addressId: z.number().nullable().optional(),
  addressLine1: z.string(),
  addressLine2: z.string().nullable().optional(),
  city: z.string(),
  stateRegion: z.string(),
  postalCode: z.string(),
  country: z.string().nullable().optional(),
  countryCode: z.string().nullable().optional(),
});
export type HouseholdAddress = z.infer<typeof HouseholdAddressSchema>;

// ── Member ──

export const HouseholdMemberSchema = z.object({
  contactId: z.number(),
  firstName: z.string(),
  middleName: z.string().nullable(),
  lastName: z.string(),
  displayName: z.string().nullable(),
  nickName: z.string().nullable(),
  prefixId: z.number().nullable(),
  suffixId: z.number().nullable(),
  suffixName: z.string().nullable(),
  emailAddress: z.string().nullable(),
  mobilePhoneNumber: z.string().nullable(),
  workPhoneNumber: z.string().nullable(),
  householdId: z.number().nullable(),
  householdPositionId: z.number().nullable(),
  householdPositionName: z.string().nullable(),
  dateOfBirth: z.string().nullable(),
  genderId: z.number().nullable(),
  maritalStatusId: z.number().nullable(),
  bulkEmailOptOut: z.boolean(),
  emailUnlisted: z.boolean(),
  doNotText: z.boolean(),
  mobilePhoneUnlisted: z.boolean(),
  removeFromDirectory: z.boolean(),
  congregationId: z.number().nullable(),
  imageUrl: z.string().nullable(),
});
export type HouseholdMember = z.infer<typeof HouseholdMemberSchema>;

// ── Household ──

export const HouseholdInfoSchema = z.object({
  householdId: z.number(),
  name: z.string(),
  homePhone: z.string().nullable(),
  congregationId: z.number().nullable(),
  congregationName: z.string().nullable(),
  address: HouseholdAddressSchema.nullable(),
  alternativeAddress: HouseholdAddressSchema.nullable(),
  alternativeAddressStart: z.string().nullable(),
  alternativeAddressEnd: z.string().nullable(),
  alternativeAddressRepeatAnnually: z.boolean(),
  homePhoneUnlisted: z.boolean(),
  homeAddressUnlisted: z.boolean(),
});
export type HouseholdInfo = z.infer<typeof HouseholdInfoSchema>;

// ── Lookups ──

export const LookupOptionSchema = z.object({
  id: z.number(),
  label: z.string(),
});
// Local alias only — the public `LookupOption` type is exported from ./profile
// (identical { id, label } shape). Kept un-exported to avoid a barrel collision.
type LookupOption = z.infer<typeof LookupOptionSchema>;

export const CountryOptionSchema = z.object({
  code: z.string(),
  name: z.string(),
});
export type CountryOption = z.infer<typeof CountryOptionSchema>;

export const HouseholdLookupsSchema = z.object({
  prefixes: z.array(LookupOptionSchema),
  suffixes: z.array(LookupOptionSchema),
  genders: z.array(LookupOptionSchema),
  maritalStatuses: z.array(LookupOptionSchema),
  householdPositions: z.array(LookupOptionSchema),
  congregations: z.array(LookupOptionSchema),
  countries: z.array(CountryOptionSchema),
});
export type HouseholdLookups = z.infer<typeof HouseholdLookupsSchema>;

// ── Response ──

export const HouseholdResponseSchema = z.object({
  household: HouseholdInfoSchema.nullable(),
  members: z.array(HouseholdMemberSchema),
  isHeadOfHousehold: z.boolean(),
  lookups: HouseholdLookupsSchema,
  googleMapsApiKey: z.string().nullable(),
});
export type HouseholdResponse = z.infer<typeof HouseholdResponseSchema>;

// ── Update requests ──

export const UpdateHouseholdRequestSchema = z.object({
  name: z.string().min(1, "Household name is required"),
  homePhone: z.string().nullable().optional(),
  congregationId: z.number().nullable().optional(),
  address: HouseholdAddressSchema.nullable().optional(),
  alternativeAddress: HouseholdAddressSchema.nullable().optional(),
  alternativeAddressStart: z.string().nullable().optional(),
  alternativeAddressEnd: z.string().nullable().optional(),
  alternativeAddressRepeatAnnually: z.boolean().optional(),
  homePhoneUnlisted: z.boolean().optional(),
  homeAddressUnlisted: z.boolean().optional(),
});
export type UpdateHouseholdRequest = z.infer<typeof UpdateHouseholdRequestSchema>;

export const UpdateHouseholdMemberRequestSchema = z.object({
  contactId: z.number().optional(),
  firstName: z.string().min(1, "First name is required"),
  middleName: z.string().nullable().optional(),
  lastName: z.string().min(1, "Last name is required"),
  nickName: z.string().nullable().optional(),
  prefixId: z.number().nullable().optional(),
  suffixId: z.number().nullable().optional(),
  emailAddress: z.string().nullable().optional(),
  mobilePhoneNumber: z.string().nullable().optional(),
  workPhoneNumber: z.string().nullable().optional(),
  householdPositionId: z.number().nullable().optional(),
  dateOfBirth: z.string().nullable().optional(),
  genderId: z.number().nullable().optional(),
  maritalStatusId: z.number().nullable().optional(),
  bulkEmailOptOut: z.boolean().optional(),
  emailUnlisted: z.boolean().optional(),
  doNotText: z.boolean().optional(),
  mobilePhoneUnlisted: z.boolean().optional(),
  removeFromDirectory: z.boolean().optional(),
});
export type UpdateHouseholdMemberRequest = z.infer<typeof UpdateHouseholdMemberRequestSchema>;
