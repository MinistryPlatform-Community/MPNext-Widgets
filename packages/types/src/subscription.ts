import { z } from "zod";

// ── Publication (available subscription) ─────────────────────

export const PublicationSchema = z.object({
  Publication_ID: z.number().int(),
  Title: z.string(),
  Description: z.string().nullable().optional(),
  Online_Sort_Order: z.number().int().nullable().optional(),
});

export type Publication = z.infer<typeof PublicationSchema>;

// ── Contact subscription state ───────────────────────────────

export const ContactSubscriptionSchema = z.object({
  Contact_Publication_ID: z.number().int(),
  Publication_ID: z.number().int(),
  Unsubscribed: z.boolean(),
});

export type ContactSubscription = z.infer<typeof ContactSubscriptionSchema>;

// ── Combined item for the widget ─────────────────────────────

export const SubscriptionItemSchema = z.object({
  Publication_ID: z.number().int(),
  Title: z.string(),
  Description: z.string().nullable().optional(),
  Online_Sort_Order: z.number().int().nullable().optional(),
  subscribed: z.boolean(),
});

export type SubscriptionItem = z.infer<typeof SubscriptionItemSchema>;

// ── API response ─────────────────────────────────────────────

export const SubscriptionListResponseSchema = z.object({
  subscriptions: z.array(SubscriptionItemSchema),
});

export type SubscriptionListResponse = z.infer<typeof SubscriptionListResponseSchema>;

// ── Update request ───────────────────────────────────────────

export const SubscriptionUpdateSchema = z.object({
  /** Publication IDs the user wants to be subscribed to */
  subscribedIds: z.array(z.number().int()),
});

export type SubscriptionUpdateRequest = z.infer<typeof SubscriptionUpdateSchema>;

export const SubscriptionUpdateResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});

export type SubscriptionUpdateResponse = z.infer<typeof SubscriptionUpdateResponseSchema>;
