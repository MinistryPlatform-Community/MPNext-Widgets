import { describe, it, expect } from 'vitest';
import * as types from './index';

/**
 * Sanity check that `index.ts` re-exports every Zod schema from the
 * individual files. If any module is dropped from the barrel file,
 * these assertions will fail.
 */

describe('@mpnext/types barrel re-exports', () => {
  const expectedSchemas = [
    // add-to-calendar
    'CalendarEventDataSchema',
    // full-calendar
    'CalendarEventSchema',
    'CalendarFilterSchema',
    'CalendarEventsResponseSchema',
    'CalendarEventDetailResponseSchema',
    // invoices
    'InvoiceListItemSchema',
    'InvoiceListResponseSchema',
    'InvoiceLineItemSchema',
    'InvoiceDetailResponseSchema',
    // profile
    'ProfileUpdateSchema',
    'ChangePasswordSchema',
    // subscription
    'PublicationSchema',
    'ContactSubscriptionSchema',
    'SubscriptionItemSchema',
    'SubscriptionListResponseSchema',
    'SubscriptionUpdateSchema',
    'SubscriptionUpdateResponseSchema',
  ] as const;

  for (const name of expectedSchemas) {
    it(`re-exports ${name}`, () => {
      const exported = (types as Record<string, unknown>)[name];
      expect(exported).toBeDefined();
      // Each Zod schema exposes a .safeParse method.
      expect(typeof (exported as { safeParse?: unknown }).safeParse).toBe('function');
    });
  }
});
