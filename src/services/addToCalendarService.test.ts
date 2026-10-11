import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AddToCalendarService } from '@/services/addToCalendarService';

const mockGetTableRecords = vi.fn();
const mockGetMpTimezone = vi.fn<() => Promise<string>>();

vi.mock('@/lib/providers/ministry-platform', () => {
  return {
    MPHelper: class {
      getTableRecords = mockGetTableRecords;
    },
  };
});

// `domainTimezoneService.ts` instantiates its own singleton (and an MPHelper
// with it) at module scope, which runs before the MPHelper mock's factory has
// initialised `mockGetTableRecords`. Mocking the module keeps this suite about
// the MP reads it is actually testing.
vi.mock('@/services/domainTimezoneService', () => {
  return {
    DomainTimezoneService: {
      getInstance: () => ({ getMpTimezone: mockGetMpTimezone }),
    },
  };
});

describe('AddToCalendarService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMpTimezone.mockResolvedValue('America/Chicago');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (AddToCalendarService as any).instance = undefined;
  });

  describe('getInstance', () => {
    it('should return a singleton instance', async () => {
      const instance1 = await AddToCalendarService.getInstance();
      const instance2 = await AddToCalendarService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('getEventForCalendar', () => {
    const baseEvent = {
      Event_ID: 42,
      Event_Title: 'Easter Service',
      Description: 'Easter celebration',
      Event_Start_Date: '2026-04-05T10:00:00',
      Event_End_Date: '2026-04-05T11:30:00',
      Location_ID: null as number | null,
    };

    it('should return null when the event does not exist', async () => {
      mockGetTableRecords.mockResolvedValueOnce([]);

      const service = await AddToCalendarService.getInstance();
      const result = await service.getEventForCalendar(42);

      expect(result).toBeNull();
      expect(mockGetTableRecords).toHaveBeenCalledTimes(1);
      expect(mockGetTableRecords).toHaveBeenCalledWith({
        table: 'Events',
        select:
          'Event_ID,Event_Title,Description,Event_Start_Date,Event_End_Date,Location_ID',
        filter: '(Event_ID = 42) AND Cancelled = 0 AND Visibility_Level_ID = 4',
        top: 1,
      });
    });

    // C06: the route is public, so the read itself must refuse non-public and
    // cancelled rows. MP evaluates the $filter, so the unit-level contract is:
    // the predicate is always sent, and an empty result is null (→ route 404).
    it.each([
      ['a Visibility_Level_ID = 2 (staff only) id', 759],
      ['a cancelled id', 760],
    ])('returns null for %s because MP filters it out', async (_label, id) => {
      mockGetTableRecords.mockResolvedValueOnce([]);

      const service = await AddToCalendarService.getInstance();
      const result = await service.getEventForCalendar(id);

      expect(result).toBeNull();
      const filter = mockGetTableRecords.mock.calls[0][0].filter as string;
      expect(filter).toContain(`Event_ID = ${id}`);
      expect(filter).toContain('Visibility_Level_ID = 4');
      expect(filter).toContain('Cancelled = 0');
      // No follow-up Location/Address read for a refused event.
      expect(mockGetTableRecords).toHaveBeenCalledTimes(1);
    });

    it('should return event data with null location/address when Location_ID is null', async () => {
      mockGetTableRecords.mockResolvedValueOnce([{ ...baseEvent, Location_ID: null }]);

      const service = await AddToCalendarService.getInstance();
      const result = await service.getEventForCalendar(42);

      expect(mockGetTableRecords).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        Event_ID: 42,
        Event_Title: 'Easter Service',
        Description: 'Easter celebration',
        Event_Start_Date: '2026-04-05T10:00:00',
        Event_End_Date: '2026-04-05T11:30:00',
        Location_Name: null,
        Address_Line_1: null,
        City: null,
        State: null,
        Postal_Code: null,
        Time_Zone: 'America/Chicago',
      });
    });

    it('should resolve location but skip address when Address_ID is null', async () => {
      mockGetTableRecords
        .mockResolvedValueOnce([{ ...baseEvent, Location_ID: 7 }])
        .mockResolvedValueOnce([
          { Location_ID: 7, Location_Name: 'Main Auditorium', Address_ID: null },
        ]);

      const service = await AddToCalendarService.getInstance();
      const result = await service.getEventForCalendar(42);

      expect(mockGetTableRecords).toHaveBeenCalledTimes(2);
      expect(mockGetTableRecords).toHaveBeenNthCalledWith(2, {
        table: 'Locations',
        select: 'Location_ID,Location_Name,Address_ID',
        filter: 'Location_ID = 7',
        top: 1,
      });
      expect(result?.Location_Name).toBe('Main Auditorium');
      expect(result?.Address_Line_1).toBeNull();
      expect(result?.City).toBeNull();
    });

    it('should resolve full location + address when present', async () => {
      mockGetTableRecords
        .mockResolvedValueOnce([{ ...baseEvent, Location_ID: 7 }])
        .mockResolvedValueOnce([
          { Location_ID: 7, Location_Name: 'Main Auditorium', Address_ID: 99 },
        ])
        .mockResolvedValueOnce([
          {
            Address_ID: 99,
            Address_Line_1: '123 Church St',
            City: 'Springfield',
            'State/Region': 'IL',
            Postal_Code: '62701',
          },
        ]);

      const service = await AddToCalendarService.getInstance();
      const result = await service.getEventForCalendar(42);

      expect(mockGetTableRecords).toHaveBeenCalledTimes(3);
      expect(mockGetTableRecords).toHaveBeenNthCalledWith(3, {
        table: 'Addresses',
        select: 'Address_ID,Address_Line_1,City,[State/Region],Postal_Code',
        filter: 'Address_ID = 99',
        top: 1,
      });
      expect(result).toEqual({
        Event_ID: 42,
        Event_Title: 'Easter Service',
        Description: 'Easter celebration',
        Event_Start_Date: '2026-04-05T10:00:00',
        Event_End_Date: '2026-04-05T11:30:00',
        Location_Name: 'Main Auditorium',
        Address_Line_1: '123 Church St',
        City: 'Springfield',
        State: 'IL',
        Postal_Code: '62701',
        Time_Zone: 'America/Chicago',
      });
    });

    it('should keep location info when address lookup returns no rows', async () => {
      mockGetTableRecords
        .mockResolvedValueOnce([{ ...baseEvent, Location_ID: 7 }])
        .mockResolvedValueOnce([
          { Location_ID: 7, Location_Name: 'Main Auditorium', Address_ID: 99 },
        ])
        .mockResolvedValueOnce([]);

      const service = await AddToCalendarService.getInstance();
      const result = await service.getEventForCalendar(42);

      expect(result?.Location_Name).toBe('Main Auditorium');
      expect(result?.Address_Line_1).toBeNull();
      expect(result?.City).toBeNull();
      expect(result?.State).toBeNull();
      expect(result?.Postal_Code).toBeNull();
    });

    it('should ship the MP domain timezone so the widget need not guess', async () => {
      mockGetMpTimezone.mockResolvedValueOnce('America/New_York');
      mockGetTableRecords.mockResolvedValueOnce([{ ...baseEvent, Location_ID: null }]);

      const service = await AddToCalendarService.getInstance();
      const result = await service.getEventForCalendar(42);

      expect(result?.Time_Zone).toBe('America/New_York');
    });

    it('should return a null timezone rather than fail when the domain lookup throws', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockGetMpTimezone.mockRejectedValueOnce(new Error('domain unavailable'));
      mockGetTableRecords.mockResolvedValueOnce([{ ...baseEvent, Location_ID: null }]);

      const service = await AddToCalendarService.getInstance();
      const result = await service.getEventForCalendar(42);

      expect(result?.Time_Zone).toBeNull();
      expect(result?.Event_Title).toBe('Easter Service');
      warn.mockRestore();
    });

    it('should propagate errors from MPHelper on the initial event query', async () => {
      mockGetTableRecords.mockRejectedValueOnce(new Error('boom'));

      const service = await AddToCalendarService.getInstance();
      await expect(service.getEventForCalendar(42)).rejects.toThrow('boom');
    });
  });
});
