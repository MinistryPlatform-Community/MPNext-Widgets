import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AddToCalendarService } from '@/services/addToCalendarService';

const mockGetTableRecords = vi.fn();

vi.mock('@/lib/providers/ministry-platform', () => {
  return {
    MPHelper: class {
      getTableRecords = mockGetTableRecords;
    },
  };
});

describe('AddToCalendarService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
        filter: 'Event_ID = 42',
        top: 1,
      });
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
        select: 'Address_ID,Address_Line_1,City,State/Region,Postal_Code',
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

    it('should propagate errors from MPHelper on the initial event query', async () => {
      mockGetTableRecords.mockRejectedValueOnce(new Error('boom'));

      const service = await AddToCalendarService.getInstance();
      await expect(service.getEventForCalendar(42)).rejects.toThrow('boom');
    });
  });
});
