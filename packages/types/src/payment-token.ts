import { z } from "zod";

/**
 * Payment hand-off token contract, shared by next-checkout (builds the request
 * token), next-pay (the sandbox gateway: unpacks the request, builds a
 * response), and the payment-response/notify processing. Mirrors the legacy
 * JWT payload built by CheckoutService + parsed by PaymentTranslator.
 *
 * The tokens are HS256-signed with PAYMENT_JWT_SIGNING_KEY. Swapping in a real
 * payment vendor means pointing the checkout `payment-processor-url` at the
 * vendor and sharing this signing key — the field contract stays the same.
 */

export const PaymentRequestTokenSchema = z.object({
  invoiceId: z.string(), // Invoice_GUID
  amount: z.number(),
  payorContactId: z.number().nullable(),
  returnUrl: z.string(),
  paymentNotifyUrl: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: z.string().nullable(),
  mobilePhone: z.string().nullable(),
  addressStreet: z.string().nullable(),
  addressStreet2: z.string().nullable(),
  addressCity: z.string().nullable(),
  addressState: z.string().nullable(),
  addressZip: z.string().nullable(),
  addressCountry: z.string().nullable(),
  fundId: z.number().nullable(),
  /**
   * Single-use id (C43). Open in the KV store from issue until the first
   * successful submit; a spent or unknown `jti` cannot be unpacked or paid.
   */
  jti: z.string(),
});
export type PaymentRequestToken = z.infer<typeof PaymentRequestTokenSchema>;

/** "CREDIT_DEBIT" → Payment_Type_ID 4, otherwise ACH/EFT → 5. */
export const PaymentResponseTokenSchema = z.object({
  invoiceId: z.string(),
  amount: z.number(),
  transactionSuccess: z.boolean(),
  transactionCode: z.string(),
  type: z.string(), // "CREDIT_DEBIT" | "ACH"
  itemNumber: z.string().nullable().optional(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  mobilePhone: z.string().nullable().optional(),
  addressStreet: z.string().nullable().optional(),
  addressStreet2: z.string().nullable().optional(),
  addressCity: z.string().nullable().optional(),
  addressState: z.string().nullable().optional(),
  addressZip: z.string().nullable().optional(),
});
export type PaymentResponseToken = z.infer<typeof PaymentResponseTokenSchema>;

// ── Payment outcome (C41) ───────────────────────────────────────────────

/**
 * The single discriminant every payment-recording endpoint answers with
 * (`checkout/payment-response`, `payment/notify`). It replaced a pair of
 * booleans (`success`, `paymentReceived`) that invited each widget to invent
 * its own branch — and one of them reported a declined card as "processing".
 *
 * - `received` — recorded in MP (or already recorded: an idempotent replay).
 * - `pending`  — the processor accepted it but has not settled it. Reserved
 *   for a vendor that reports that state; the sandbox never does.
 * - `declined` — the processor refused the transaction. Nothing was recorded;
 *   the payer can retry with another card.
 * - `error`    — an infrastructure fault on our side or MP's. Must never be
 *   rendered as pending: the payer needs to know it did not go through.
 */
export const PaymentOutcomeStatusSchema = z.enum([
  "received",
  "pending",
  "declined",
  "error",
]);
export type PaymentOutcomeStatus = z.infer<typeof PaymentOutcomeStatusSchema>;

export const PaymentOutcomeSchema = z.object({
  invoiceId: z.number().nullable(),
  status: PaymentOutcomeStatusSchema,
});
export type PaymentOutcome = z.infer<typeof PaymentOutcomeSchema>;

// ── Checkout invoice display ────────────────────────────────────────────

export const CheckoutLineItemSchema = z.object({
  invoiceDetailId: z.number(),
  itemName: z.string().nullable(),
  itemNote: z.string().nullable(),
  recipientName: z.string().nullable(),
  quantity: z.number(),
  lineTotal: z.number(),
  isSubItem: z.boolean(),
  eventParticipantId: z.number().nullable(),
});
export type CheckoutLineItem = z.infer<typeof CheckoutLineItemSchema>;

export const CheckoutInvoiceSchema = z.object({
  invoiceId: z.number(),
  invoiceGuid: z.string(),
  invoiceDate: z.string(),
  invoiceTotal: z.number(),
  amountPaid: z.number(),
  balanceDue: z.number(),
  depositDue: z.number().nullable(),
  statusId: z.number(),
  status: z.string(),
  canPay: z.boolean(),
  payorContactId: z.number().nullable(),
  payor: z.object({
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    email: z.string().nullable(),
    mobilePhone: z.string().nullable(),
    addressLine1: z.string().nullable(),
    addressLine2: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    postalCode: z.string().nullable(),
  }),
  lineItems: z.array(CheckoutLineItemSchema),
});
export type CheckoutInvoice = z.infer<typeof CheckoutInvoiceSchema>;
