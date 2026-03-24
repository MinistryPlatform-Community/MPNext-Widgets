import { z } from "zod";

// ── Response Schemas ──

export const InvoiceListItemSchema = z.object({
  Invoice_ID: z.number(),
  Invoice_Date: z.string(),
  Invoice_Total: z.number(),
  Invoice_Status_ID: z.number(),
  Invoice_Status: z.string(),
  Notes: z.string().nullable().optional(),
  Currency: z.string().nullable().optional(),
  Invoice_GUID: z.string(),
  Product_Summary: z.string().nullable().optional(),
});
export type InvoiceListItem = z.infer<typeof InvoiceListItemSchema>;

export const InvoiceListResponseSchema = z.object({
  invoices: z.array(InvoiceListItemSchema),
});
export type InvoiceListResponse = z.infer<typeof InvoiceListResponseSchema>;

export const InvoiceLineItemSchema = z.object({
  Invoice_Detail_ID: z.number(),
  Product_Name: z.string(),
  Description: z.string().nullable().optional(),
  Item_Quantity: z.number(),
  Line_Total: z.number(),
  Item_Note: z.string().nullable().optional(),
  Recipient_Name: z.string().nullable().optional(),
});
export type InvoiceLineItem = z.infer<typeof InvoiceLineItemSchema>;

export const InvoiceDetailResponseSchema = z.object({
  invoice: InvoiceListItemSchema,
  lineItems: z.array(InvoiceLineItemSchema),
});
export type InvoiceDetailResponse = z.infer<typeof InvoiceDetailResponseSchema>;
