import { z } from "zod";

export interface ProfileData {
  Contact_ID: number;
  Contact_GUID: string;
  Prefix_ID: number | null;
  First_Name: string;
  Middle_Name: string | null;
  Last_Name: string;
  Nickname: string | null;
  Suffix_ID: number | null;
  Gender_ID: number | null;
  Date_of_Birth: string | null;
  Marital_Status_ID: number | null;
  Mobile_Phone: string | null;
  Company_Phone: string | null;
  Email_Address: string | null;
  Do_Not_Text: boolean;
  Bulk_Email_Opt_Out: boolean;
  // Joined table display values
  Prefix: string | null;
  Suffix: string | null;
  Gender: string | null;
  Marital_Status: string | null;
}

export interface LookupOption {
  id: number;
  label: string;
}

export interface ProfileLookups {
  prefixes: LookupOption[];
  suffixes: LookupOption[];
  genders: LookupOption[];
  maritalStatuses: LookupOption[];
}

export interface ProfileGetResponse {
  profile: ProfileData;
  lookups: ProfileLookups;
}

export const ProfileUpdateSchema = z.object({
  Prefix_ID: z.number().nullable().optional(),
  First_Name: z.string().min(1, "First name is required").optional(),
  Middle_Name: z.string().nullable().optional(),
  Last_Name: z.string().min(1, "Last name is required").optional(),
  Nickname: z.string().nullable().optional(),
  Suffix_ID: z.number().nullable().optional(),
  Gender_ID: z.number().nullable().optional(),
  Date_of_Birth: z.string().nullable().optional(),
  Marital_Status_ID: z.number().nullable().optional(),
  Mobile_Phone: z.string().nullable().optional(),
  Company_Phone: z.string().nullable().optional(),
  Email_Address: z.string().email("Invalid email address").optional(),
  Do_Not_Text: z.boolean().optional(),
  Bulk_Email_Opt_Out: z.boolean().optional(),
});

export type ProfileUpdateRequest = z.infer<typeof ProfileUpdateSchema>;

export interface ProfileUpdateResponse {
  success: boolean;
  error?: string;
}

export const ChangePasswordSchema = z
  .object({
    oldPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, "New password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm your new password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type ChangePasswordRequest = z.infer<typeof ChangePasswordSchema>;

export interface ChangePasswordResponse {
  success: boolean;
  error?: string;
}
