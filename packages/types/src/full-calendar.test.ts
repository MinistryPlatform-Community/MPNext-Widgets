import { describe, it, expect } from 'vitest';
import {
  CalendarEventSchema,
  CalendarFilterSchema,
  CalendarEventsResponseSchema,
  CalendarEventDetailResponseSchema,
  type CalendarEvent,
  type CalendarFilter,
} from './full-calendar';

/**
 * Tests for full-calendar schemas (CalendarEventSchema, CalendarFilterSchema,
 * CalendarEventsResponseSchema, CalendarEventDetailResponseSchema).
 */

const validEvent: CalendarEvent = {
  Event_ID: 100,
  Event_Title: 'Youth Group',
  Event_Start_Date: '2026-05-18T18:00:00',
  Event_End_Date: '2026-05-18T20:00:00',
  Event_Type_ID: 5,
  Event_Type: 'Youth Ministry',
  Congregation_ID: 1,
  Congregation_Name: 'Main Campus',
  Location_Name: 'Youth Building',
  Description: 'Weekly youth gathering',
  Featured_On_Calendar: true,
  Registration_URL: 'https://example.com/register',
  Image_URL: 'https://example.com/image.png',
  Program_ID: 9,
  Program_Name: 'Students',
  Ministry_Name: 'Youth Ministry',
  Primary_Contact_Name: 'Jane Doe',
  Primary_Contact_Email: 'jane@example.com',
  Primary_Contact_Phone: '555-1234',
  Participants_Expected: 50,
  Participant_Count: 42,
  Registration_Product_Name: 'Youth Registration',
  MP_Detail_URL: 'https://mp.example.com/events/100',
};

const validFilter: CalendarFilter = { id: 1, name: 'Main Campus' };

describe('CalendarEventSchema', () => {
  describe('happy path', () => {
    it('accepts a fully populated event', () => {
      const result = CalendarEventSchema.safeParse(validEvent);
      expect(result.success).toBe(true);
    });

    it('accepts null for all nullable fields', () => {
      const result = CalendarEventSchema.safeParse({
        ...validEvent,
        Event_Type_ID: null,
        Event_Type: null,
        Congregation_ID: null,
        Congregation_Name: null,
        Location_Name: null,
        Description: null,
        Registration_URL: null,
        Image_URL: null,
        Program_ID: null,
        Program_Name: null,
        Ministry_Name: null,
        Primary_Contact_Name: null,
        Primary_Contact_Email: null,
        Primary_Contact_Phone: null,
        Participants_Expected: null,
        Participant_Count: null,
        Registration_Product_Name: null,
        MP_Detail_URL: null,
      });
      expect(result.success).toBe(true);
    });

    it('accepts false for Featured_On_Calendar', () => {
      const result = CalendarEventSchema.safeParse({
        ...validEvent,
        Featured_On_Calendar: false,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('required fields', () => {
    const required: Array<keyof CalendarEvent> = [
      'Event_ID',
      'Event_Title',
      'Event_Start_Date',
      'Event_End_Date',
      'Featured_On_Calendar',
    ];

    for (const field of required) {
      it(`fails when "${field}" is omitted`, () => {
        const partial = { ...validEvent };
        delete (partial as Record<string, unknown>)[field];
        const result = CalendarEventSchema.safeParse(partial);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues.some((i) => i.path[0] === field)).toBe(true);
        }
      });
    }
  });

  describe('type validation', () => {
    it('rejects string for Event_ID', () => {
      const result = CalendarEventSchema.safeParse({ ...validEvent, Event_ID: 'abc' });
      expect(result.success).toBe(false);
    });

    it('rejects string for Featured_On_Calendar', () => {
      const result = CalendarEventSchema.safeParse({
        ...validEvent,
        Featured_On_Calendar: 'true',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['Featured_On_Calendar']);
      }
    });

    it('rejects number where string expected (Event_Title)', () => {
      const result = CalendarEventSchema.safeParse({ ...validEvent, Event_Title: 99 });
      expect(result.success).toBe(false);
    });

    it('rejects string where number-or-null expected (Event_Type_ID)', () => {
      const result = CalendarEventSchema.safeParse({
        ...validEvent,
        Event_Type_ID: 'five',
      });
      expect(result.success).toBe(false);
    });

    it('rejects undefined for nullable Featured_On_Calendar', () => {
      const result = CalendarEventSchema.safeParse({
        ...validEvent,
        Featured_On_Calendar: undefined,
      });
      expect(result.success).toBe(false);
    });
  });
});

describe('CalendarFilterSchema', () => {
  it('accepts a valid filter', () => {
    expect(CalendarFilterSchema.safeParse(validFilter).success).toBe(true);
  });

  it('fails when id is missing', () => {
    const result = CalendarFilterSchema.safeParse({ name: 'No ID' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'id')).toBe(true);
    }
  });

  it('fails when name is missing', () => {
    const result = CalendarFilterSchema.safeParse({ id: 1 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'name')).toBe(true);
    }
  });

  it('rejects non-numeric id', () => {
    const result = CalendarFilterSchema.safeParse({ id: '1', name: 'X' });
    expect(result.success).toBe(false);
  });

  it('rejects non-string name', () => {
    const result = CalendarFilterSchema.safeParse({ id: 1, name: 2 });
    expect(result.success).toBe(false);
  });
});

describe('CalendarEventsResponseSchema', () => {
  it('accepts a valid response with events and filters', () => {
    const result = CalendarEventsResponseSchema.safeParse({
      events: [validEvent],
      isAdmin: false,
      filters: {
        campuses: [validFilter],
        ministries: [{ id: 2, name: 'Worship' }],
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty events and filter arrays', () => {
    const result = CalendarEventsResponseSchema.safeParse({
      events: [],
      isAdmin: true,
      filters: { campuses: [], ministries: [] },
    });
    expect(result.success).toBe(true);
  });

  it('fails when filters object is missing', () => {
    const result = CalendarEventsResponseSchema.safeParse({
      events: [],
      isAdmin: false,
    });
    expect(result.success).toBe(false);
  });

  it('fails when an event in the array is invalid', () => {
    const result = CalendarEventsResponseSchema.safeParse({
      events: [{ ...validEvent, Event_ID: 'bad' }],
      isAdmin: false,
      filters: { campuses: [], ministries: [] },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('events');
    }
  });

  it('fails when isAdmin is not a boolean', () => {
    const result = CalendarEventsResponseSchema.safeParse({
      events: [],
      isAdmin: 'yes',
      filters: { campuses: [], ministries: [] },
    });
    expect(result.success).toBe(false);
  });
});

describe('CalendarEventDetailResponseSchema', () => {
  it('accepts a valid detail response', () => {
    const result = CalendarEventDetailResponseSchema.safeParse({
      event: validEvent,
      isAdmin: true,
    });
    expect(result.success).toBe(true);
  });

  it('fails when event is missing', () => {
    const result = CalendarEventDetailResponseSchema.safeParse({ isAdmin: false });
    expect(result.success).toBe(false);
  });

  it('fails when event is invalid', () => {
    const result = CalendarEventDetailResponseSchema.safeParse({
      event: { ...validEvent, Event_Title: 42 },
      isAdmin: false,
    });
    expect(result.success).toBe(false);
  });
});
