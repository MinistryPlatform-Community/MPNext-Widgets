import { describe, it, expect } from 'vitest';
import { CalendarEventDataSchema, type CalendarEventData } from './add-to-calendar';

/**
 * Tests for CalendarEventDataSchema -- the shape returned by the
 * add-to-calendar widget API.
 */

const validEvent: CalendarEventData = {
  Event_ID: 12345,
  Event_Title: 'Sunday Worship',
  Description: 'Weekly worship service',
  Event_Start_Date: '2026-05-17T09:00:00',
  Event_End_Date: '2026-05-17T10:30:00',
  Location_Name: 'Main Sanctuary',
  Address_Line_1: '123 Church Lane',
  City: 'Anywhere',
  State: 'TX',
  Postal_Code: '75001',
};

describe('CalendarEventDataSchema', () => {
  describe('happy path', () => {
    it('accepts a fully populated event', () => {
      const result = CalendarEventDataSchema.safeParse(validEvent);
      expect(result.success).toBe(true);
    });

    it('accepts null for all nullable fields', () => {
      const result = CalendarEventDataSchema.safeParse({
        ...validEvent,
        Description: null,
        Location_Name: null,
        Address_Line_1: null,
        City: null,
        State: null,
        Postal_Code: null,
      });
      expect(result.success).toBe(true);
    });

    it('does not throw when calling .parse on valid input', () => {
      expect(() => CalendarEventDataSchema.parse(validEvent)).not.toThrow();
    });
  });

  describe('required fields', () => {
    const requiredFields: Array<keyof CalendarEventData> = [
      'Event_ID',
      'Event_Title',
      'Description',
      'Event_Start_Date',
      'Event_End_Date',
      'Location_Name',
      'Address_Line_1',
      'City',
      'State',
      'Postal_Code',
    ];

    for (const field of requiredFields) {
      it(`fails when "${field}" is omitted`, () => {
        const partial = { ...validEvent };
        delete (partial as Record<string, unknown>)[field];
        const result = CalendarEventDataSchema.safeParse(partial);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues.some((i) => i.path[0] === field)).toBe(true);
        }
      });
    }
  });

  describe('type validation', () => {
    it('rejects a string Event_ID', () => {
      const result = CalendarEventDataSchema.safeParse({
        ...validEvent,
        Event_ID: '12345',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['Event_ID']);
      }
    });

    it('rejects a number Event_Title', () => {
      const result = CalendarEventDataSchema.safeParse({
        ...validEvent,
        Event_Title: 42,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['Event_Title']);
      }
    });

    it('rejects undefined for a nullable string (nullable != optional)', () => {
      const result = CalendarEventDataSchema.safeParse({
        ...validEvent,
        Description: undefined,
      });
      expect(result.success).toBe(false);
    });

    it('rejects boolean for a string field', () => {
      const result = CalendarEventDataSchema.safeParse({
        ...validEvent,
        City: true,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('accepts an empty string for Event_Title (no min constraint)', () => {
      const result = CalendarEventDataSchema.safeParse({
        ...validEvent,
        Event_Title: '',
      });
      expect(result.success).toBe(true);
    });

    it('accepts negative Event_ID (no positive constraint)', () => {
      const result = CalendarEventDataSchema.safeParse({
        ...validEvent,
        Event_ID: -1,
      });
      expect(result.success).toBe(true);
    });

    it('accepts zero Event_ID', () => {
      const result = CalendarEventDataSchema.safeParse({
        ...validEvent,
        Event_ID: 0,
      });
      expect(result.success).toBe(true);
    });

    it('accepts very long strings', () => {
      const longString = 'x'.repeat(10_000);
      const result = CalendarEventDataSchema.safeParse({
        ...validEvent,
        Event_Title: longString,
        Description: longString,
      });
      expect(result.success).toBe(true);
    });
  });
});
