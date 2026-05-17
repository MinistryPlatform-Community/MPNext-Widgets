import { describe, it, expect } from 'vitest';
import {
  PublicationSchema,
  ContactSubscriptionSchema,
  SubscriptionItemSchema,
  SubscriptionListResponseSchema,
  SubscriptionUpdateSchema,
  SubscriptionUpdateResponseSchema,
  type Publication,
  type ContactSubscription,
  type SubscriptionItem,
} from './subscription';

/**
 * Tests for subscription schemas. All numeric IDs use `.int()` and should
 * reject floats.
 */

const validPublication: Publication = {
  Publication_ID: 10,
  Title: 'Weekly Newsletter',
  Description: 'A weekly update',
  Online_Sort_Order: 1,
};

const validContactSub: ContactSubscription = {
  Contact_Publication_ID: 100,
  Publication_ID: 10,
  Unsubscribed: false,
};

const validItem: SubscriptionItem = {
  Publication_ID: 10,
  Title: 'Weekly Newsletter',
  Description: 'A weekly update',
  Online_Sort_Order: 1,
  subscribed: true,
};

describe('PublicationSchema', () => {
  it('accepts a valid publication', () => {
    expect(PublicationSchema.safeParse(validPublication).success).toBe(true);
  });

  it('accepts omitted optional fields', () => {
    const result = PublicationSchema.safeParse({
      Publication_ID: 1,
      Title: 'X',
    });
    expect(result.success).toBe(true);
  });

  it('accepts null for nullable-optional fields', () => {
    const result = PublicationSchema.safeParse({
      Publication_ID: 1,
      Title: 'X',
      Description: null,
      Online_Sort_Order: null,
    });
    expect(result.success).toBe(true);
  });

  it('fails when Publication_ID is missing', () => {
    const result = PublicationSchema.safeParse({ Title: 'X' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'Publication_ID')).toBe(true);
    }
  });

  it('fails when Title is missing', () => {
    const result = PublicationSchema.safeParse({ Publication_ID: 1 });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer Publication_ID', () => {
    const result = PublicationSchema.safeParse({ Publication_ID: 1.5, Title: 'X' });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer Online_Sort_Order', () => {
    const result = PublicationSchema.safeParse({
      Publication_ID: 1,
      Title: 'X',
      Online_Sort_Order: 2.5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects string for Publication_ID', () => {
    const result = PublicationSchema.safeParse({ Publication_ID: '1', Title: 'X' });
    expect(result.success).toBe(false);
  });

  it('accepts negative integer for Online_Sort_Order (no positive constraint)', () => {
    const result = PublicationSchema.safeParse({
      Publication_ID: 1,
      Title: 'X',
      Online_Sort_Order: -5,
    });
    expect(result.success).toBe(true);
  });
});

describe('ContactSubscriptionSchema', () => {
  it('accepts a valid contact subscription', () => {
    expect(ContactSubscriptionSchema.safeParse(validContactSub).success).toBe(true);
  });

  it('accepts Unsubscribed=true', () => {
    const result = ContactSubscriptionSchema.safeParse({
      ...validContactSub,
      Unsubscribed: true,
    });
    expect(result.success).toBe(true);
  });

  it('fails when Contact_Publication_ID is missing', () => {
    const result = ContactSubscriptionSchema.safeParse({
      Publication_ID: 10,
      Unsubscribed: false,
    });
    expect(result.success).toBe(false);
  });

  it('fails when Unsubscribed is missing', () => {
    const result = ContactSubscriptionSchema.safeParse({
      Contact_Publication_ID: 100,
      Publication_ID: 10,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-boolean Unsubscribed', () => {
    const result = ContactSubscriptionSchema.safeParse({
      ...validContactSub,
      Unsubscribed: 'false',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer Publication_ID', () => {
    const result = ContactSubscriptionSchema.safeParse({
      ...validContactSub,
      Publication_ID: 1.1,
    });
    expect(result.success).toBe(false);
  });
});

describe('SubscriptionItemSchema', () => {
  it('accepts a valid item', () => {
    expect(SubscriptionItemSchema.safeParse(validItem).success).toBe(true);
  });

  it('accepts omitted optional fields', () => {
    const result = SubscriptionItemSchema.safeParse({
      Publication_ID: 10,
      Title: 'X',
      subscribed: false,
    });
    expect(result.success).toBe(true);
  });

  it('fails when subscribed is missing', () => {
    const result = SubscriptionItemSchema.safeParse({
      Publication_ID: 10,
      Title: 'X',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'subscribed')).toBe(true);
    }
  });

  it('rejects non-boolean subscribed', () => {
    const result = SubscriptionItemSchema.safeParse({ ...validItem, subscribed: 1 });
    expect(result.success).toBe(false);
  });
});

describe('SubscriptionListResponseSchema', () => {
  it('accepts a list of items', () => {
    const result = SubscriptionListResponseSchema.safeParse({
      subscriptions: [validItem],
    });
    expect(result.success).toBe(true);
  });

  it('accepts an empty list', () => {
    expect(
      SubscriptionListResponseSchema.safeParse({ subscriptions: [] }).success,
    ).toBe(true);
  });

  it('fails when subscriptions is missing', () => {
    const result = SubscriptionListResponseSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('fails when an item is invalid', () => {
    const result = SubscriptionListResponseSchema.safeParse({
      subscriptions: [{ ...validItem, subscribed: 'yes' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('SubscriptionUpdateSchema', () => {
  it('accepts an array of integer IDs', () => {
    const result = SubscriptionUpdateSchema.safeParse({ subscribedIds: [1, 2, 3] });
    expect(result.success).toBe(true);
  });

  it('accepts an empty array', () => {
    expect(SubscriptionUpdateSchema.safeParse({ subscribedIds: [] }).success).toBe(true);
  });

  it('fails when subscribedIds is missing', () => {
    const result = SubscriptionUpdateSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('fails when subscribedIds is not an array', () => {
    const result = SubscriptionUpdateSchema.safeParse({ subscribedIds: 5 });
    expect(result.success).toBe(false);
  });

  it('rejects floats in subscribedIds (int constraint)', () => {
    const result = SubscriptionUpdateSchema.safeParse({ subscribedIds: [1, 2.5] });
    expect(result.success).toBe(false);
  });

  it('rejects strings in subscribedIds', () => {
    const result = SubscriptionUpdateSchema.safeParse({ subscribedIds: [1, '2'] });
    expect(result.success).toBe(false);
  });
});

describe('SubscriptionUpdateResponseSchema', () => {
  it('accepts success=true without error', () => {
    const result = SubscriptionUpdateResponseSchema.safeParse({ success: true });
    expect(result.success).toBe(true);
  });

  it('accepts success=false with an error message', () => {
    const result = SubscriptionUpdateResponseSchema.safeParse({
      success: false,
      error: 'Something went wrong',
    });
    expect(result.success).toBe(true);
  });

  it('fails when success is missing', () => {
    const result = SubscriptionUpdateResponseSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects non-boolean success', () => {
    const result = SubscriptionUpdateResponseSchema.safeParse({ success: 'yes' });
    expect(result.success).toBe(false);
  });

  it('rejects non-string error', () => {
    const result = SubscriptionUpdateResponseSchema.safeParse({
      success: false,
      error: 500,
    });
    expect(result.success).toBe(false);
  });
});
