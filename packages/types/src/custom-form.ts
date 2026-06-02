import { z } from "zod";

/**
 * Custom-form types, shared by the standalone `next-custom-form` widget and the
 * embedded custom form inside `next-event-details`. Mirrors the legacy
 * Forms / Form_Fields / Form_Responses model.
 */

/** Field-type ids (MP `Form_Fields.Field_Type_ID`). */
export const CUSTOM_FORM_FIELD_TYPE = {
  TextBox: 1,
  Textarea: 2,
  Date: 3,
  VerticalRadio: 4,
  Dropdown: 5,
  Instructions: 6,
  HorizontalRadio: 7,
  Checkbox: 8,
  FileUpload: 9,
} as const;

export const CustomFormFieldSchema = z.object({
  formFieldId: z.number(),
  fieldLabel: z.string(),
  fieldType: z.number(),
  required: z.boolean(),
  fieldOrder: z.number(),
  fieldValues: z.array(z.string()),
  dependsOn: z.number().nullable(),
  dependsOnValue: z.string().nullable(),
  isHidden: z.boolean(),
});
export type CustomFormField = z.infer<typeof CustomFormFieldSchema>;

export const CustomFormHeaderSchema = z.object({
  formId: z.number(),
  formGuid: z.string().nullable(),
  title: z.string().nullable(),
  instructions: z.string().nullable(),
  completeMessage: z.string().nullable(),
  getContactInfo: z.boolean(),
  getAddressInfo: z.boolean(),
  forceLogin: z.boolean(),
  productId: z.number().nullable(),
  standaloneOnly: z.boolean(),
  isExpired: z.boolean(),
  imageUrl: z.string().nullable(),
});
export type CustomFormHeader = z.infer<typeof CustomFormHeaderSchema>;

export const CustomFormDefinitionSchema = z.object({
  header: CustomFormHeaderSchema,
  fields: z.array(CustomFormFieldSchema),
});
export type CustomFormDefinition = z.infer<typeof CustomFormDefinitionSchema>;

export const CustomFormSubmitResponseSchema = z.object({
  success: z.boolean(),
  formResponseId: z.number().nullable().optional(),
  /** Set when the form has a Product_ID and checkout is requested. */
  invoiceGuid: z.string().nullable().optional(),
  message: z.string().optional(),
});
export type CustomFormSubmitResponse = z.infer<typeof CustomFormSubmitResponseSchema>;
