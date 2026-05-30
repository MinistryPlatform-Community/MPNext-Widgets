import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockGetTableRecords, mockGetFilesByRecord, mockGetDomainInfo } = vi.hoisted(() => ({
  mockGetTableRecords: vi.fn(),
  mockGetFilesByRecord: vi.fn(),
  mockGetDomainInfo: vi.fn(),
}));

vi.mock('@/lib/providers/ministry-platform', () => {
  return {
    MPHelper: class {
      getTableRecords = mockGetTableRecords;
      getFilesByRecord = mockGetFilesByRecord;
      getDomainInfo = mockGetDomainInfo;
    },
  };
});

import { FullCalendarService } from '@/services/fullCalendarService';
import { DomainTimezoneService } from '@/services/domainTimezoneService';

describe('FullCalendarService', () => {
  beforeEach(() => {
    // mockReset (not clearAllMocks) so mockResolvedValueOnce queues drain.
    mockGetTableRecords.mockReset();
    mockGetFilesByRecord.mockReset();
    mockGetDomainInfo.mockReset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (FullCalendarService as any).instance = undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (DomainTimezoneService as any).instance = null;
    // Default: getFilesByRecord returns no images
    mockGetFilesByRecord.mockResolvedValue([]);
    // Default domain: Eastern. Individual tests may override before exercising.
    mockGetDomainInfo.mockResolvedValue({ TimeZoneName: 'America/New_York' });
  });

  describe('getInstance', () => {
    it('should return a singleton instance', async () => {
      const instance1 = await FullCalendarService.getInstance();
      const instance2 = await FullCalendarService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('checkCalendarAdmin', () => {
    const guid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const prevAdminGroups = process.env.CALENDAR_ADMIN_GROUP_IDS;

    beforeEach(() => {
      // Admin groups are tenant-configured (no hardcoded default); set explicitly.
      process.env.CALENDAR_ADMIN_GROUP_IDS = '22';
    });

    afterEach(() => {
      if (prevAdminGroups === undefined) {
        delete process.env.CALENDAR_ADMIN_GROUP_IDS;
      } else {
        process.env.CALENDAR_ADMIN_GROUP_IDS = prevAdminGroups;
      }
    });

    it('should return true when the user is in an admin group', async () => {
      mockGetTableRecords
        .mockResolvedValueOnce([{ User_ID: 1, User_GUID: guid, Contact_ID: 100 }])
        .mockResolvedValueOnce([{ User_ID: 1, User_Group_ID: 22 }]);

      const service = await FullCalendarService.getInstance();
      const result = await service.checkCalendarAdmin(guid);

      expect(result).toBe(true);
      expect(mockGetTableRecords).toHaveBeenNthCalledWith(1, {
        table: 'dp_Users',
        select: 'User_ID,User_GUID,Contact_ID',
        filter: `User_GUID = '${guid}'`,
        top: 1,
      });
      expect(mockGetTableRecords).toHaveBeenNthCalledWith(2, {
        table: 'dp_User_User_Groups',
        select: 'User_ID,User_Group_ID',
        filter: 'User_ID = 1 AND User_Group_ID IN (22)',
        top: 1,
      });
    });

    it('should return false when the user is not in any admin group', async () => {
      mockGetTableRecords
        .mockResolvedValueOnce([{ User_ID: 1, User_GUID: guid, Contact_ID: 100 }])
        .mockResolvedValueOnce([]);

      const service = await FullCalendarService.getInstance();
      const result = await service.checkCalendarAdmin(guid);

      expect(result).toBe(false);
    });

    it('should fail closed (return false) when CALENDAR_ADMIN_GROUP_IDS is unset', async () => {
      delete process.env.CALENDAR_ADMIN_GROUP_IDS;
      mockGetTableRecords.mockResolvedValueOnce([
        { User_ID: 1, User_GUID: guid, Contact_ID: 100 },
      ]);

      const service = await FullCalendarService.getInstance();
      const result = await service.checkCalendarAdmin(guid);

      expect(result).toBe(false);
      // User lookup happens, but no group query is issued when unconfigured.
      expect(mockGetTableRecords).toHaveBeenCalledTimes(1);
    });

    it('should return false when the user GUID does not resolve', async () => {
      mockGetTableRecords.mockResolvedValueOnce([]);

      const service = await FullCalendarService.getInstance();
      const result = await service.checkCalendarAdmin(guid);

      expect(result).toBe(false);
      expect(mockGetTableRecords).toHaveBeenCalledTimes(1);
    });

    it('should swallow errors and return false', async () => {
      mockGetTableRecords.mockRejectedValueOnce(new Error('boom'));

      const service = await FullCalendarService.getInstance();
      const result = await service.checkCalendarAdmin(guid);

      expect(result).toBe(false);
    });
  });

  describe('getEvents', () => {
    const start = '2026-05-01T00:00:00Z';
    const end = '2026-05-31T23:59:59Z';

    const baseEvent = {
      Event_ID: 1,
      Event_Title: 'Sunday Service',
      Event_Start_Date: '2026-05-04 10:00:00',
      Event_End_Date: '2026-05-04 11:30:00',
      Event_Type_ID: 5,
      Congregation_ID: 1,
      Location_ID: 10,
      Description: 'Weekly service',
      Featured_On_Calendar: true,
      Registration_Active: false,
      External_Registration_URL: null,
      Online_Registration_Product: null,
      Program_ID: 50,
      Primary_Contact: 200,
      Participants_Expected: null,
    };

    it('should return empty result with admin=false when no events match', async () => {
      // Events query → []
      mockGetTableRecords.mockResolvedValueOnce([]);

      const service = await FullCalendarService.getInstance();
      const result = await service.getEvents(start, end);

      expect(result).toEqual({
        events: [],
        isAdmin: false,
        filters: { campuses: [], ministries: [] },
      });

      const eventsCall = mockGetTableRecords.mock.calls[0][0];
      expect(eventsCall.table).toBe('Events');
      // Should include date filter, cancelled, visibility
      expect(eventsCall.filter).toContain('Event_Start_Date >=');
      expect(eventsCall.filter).toContain('Cancelled = 0');
      expect(eventsCall.filter).toContain('Visibility_Level_ID = 4');
      expect(eventsCall.orderBy).toBe('Event_Start_Date ASC');
    });

    it('should append congregation filter when congregationId is given', async () => {
      mockGetTableRecords.mockResolvedValueOnce([]);

      const service = await FullCalendarService.getInstance();
      await service.getEvents(start, end, 7);

      const eventsCall = mockGetTableRecords.mock.calls[0][0];
      expect(eventsCall.filter).toContain('Congregation_ID = 7');
    });

    it('should enrich events with lookups, registration URL, and detail URL', async () => {
      mockGetTableRecords
        // Events
        .mockResolvedValueOnce([
          {
            ...baseEvent,
            Registration_Active: true,
            External_Registration_URL: 'https://external.example.com/reg',
          },
        ])
        // Event_Types
        .mockResolvedValueOnce([{ Event_Type_ID: 5, Event_Type: 'Worship' }])
        // Congregations
        .mockResolvedValueOnce([{ Congregation_ID: 1, Congregation_Name: 'Main Campus' }])
        // Locations
        .mockResolvedValueOnce([{ Location_ID: 10, Location_Name: 'Auditorium' }])
        // Programs
        .mockResolvedValueOnce([
          { Program_ID: 50, Program_Name: 'Worship Program', Ministry_ID: 200 },
        ])
        // Ministries (nested in getProgramMap)
        .mockResolvedValueOnce([
          { Ministry_ID: 200, Ministry_Name: 'Worship Ministry', Available_Online: true },
        ]);

      const service = await FullCalendarService.getInstance();
      const result = await service.getEvents(start, end);

      expect(result.events).toHaveLength(1);
      const ev = result.events[0];
      expect(ev.Event_Type).toBe('Worship');
      expect(ev.Congregation_Name).toBe('Main Campus');
      expect(ev.Location_Name).toBe('Auditorium');
      expect(ev.Program_Name).toBe('Worship Program');
      expect(ev.Ministry_Name).toBe('Worship Ministry');
      expect(ev.Registration_URL).toBe('https://external.example.com/reg');
      expect(ev.MP_Detail_URL).toContain('/mp/308/1');
      // No user GUID → not admin
      expect(result.isAdmin).toBe(false);
      // Filter data extracted
      expect(result.filters.campuses).toEqual([{ id: 1, name: 'Main Campus' }]);
      expect(result.filters.ministries).toEqual([{ id: 200, name: 'Worship Ministry' }]);
    });

    it('should derive Registration_URL from online product when no external URL is set', async () => {
      mockGetTableRecords
        .mockResolvedValueOnce([
          {
            ...baseEvent,
            Event_Type_ID: null,
            Congregation_ID: null,
            Location_ID: null,
            Program_ID: null,
            Registration_Active: true,
            External_Registration_URL: null,
            Online_Registration_Product: 999,
          },
        ]);

      const service = await FullCalendarService.getInstance();
      const result = await service.getEvents(start, end);

      // Only the Events query happens — all foreign-key sets are empty so no lookups
      expect(result.events).toHaveLength(1);
      expect(result.events[0].Registration_URL).toContain('/portal/event_detail.aspx?id=1');
    });

    it('should return null Registration_URL when Registration_Active is false', async () => {
      mockGetTableRecords.mockResolvedValueOnce([
        {
          ...baseEvent,
          Event_Type_ID: null,
          Congregation_ID: null,
          Location_ID: null,
          Program_ID: null,
          Registration_Active: false,
        },
      ]);

      const service = await FullCalendarService.getInstance();
      const result = await service.getEvents(start, end);

      expect(result.events[0].Registration_URL).toBeNull();
    });

    it('should propagate errors from the main Events query', async () => {
      mockGetTableRecords.mockRejectedValueOnce(new Error('events failed'));

      const service = await FullCalendarService.getInstance();
      await expect(service.getEvents(start, end)).rejects.toThrow('events failed');
    });

    it('builds the $filter literal as MP-TZ wall-clock (Recipe E — no UTC shift)', async () => {
      mockGetTableRecords.mockResolvedValueOnce([]);

      const service = await FullCalendarService.getInstance();
      await service.getEvents('2026-05-01T00:00:00Z', '2026-05-31T23:59:59Z');

      const filter = mockGetTableRecords.mock.calls[0][0].filter as string;
      // 2026-05-01T00:00:00Z → 2026-04-30 20:00:00 in America/New_York (EDT, UTC-4)
      expect(filter).toContain(`Event_Start_Date >= '2026-04-30 20:00:00'`);
      expect(filter).toContain(`Event_End_Date <= '2026-05-31 19:59:59'`);
    });

    it('regression: repeating the same getEvents call produces the same filter (no drift)', async () => {
      mockGetTableRecords.mockResolvedValue([]);

      const service = await FullCalendarService.getInstance();
      await service.getEvents('2026-05-01T00:00:00Z', '2026-05-31T23:59:59Z');
      await service.getEvents('2026-05-01T00:00:00Z', '2026-05-31T23:59:59Z');
      await service.getEvents('2026-05-01T00:00:00Z', '2026-05-31T23:59:59Z');

      // The filter substring under inspection must be stable across calls,
      // regardless of how many times getDomainInfo is hit or what TZ the
      // node process is running in.
      const filters = mockGetTableRecords.mock.calls.map((c) => c[0].filter as string);
      expect(filters[0]).toContain(`Event_Start_Date >= '2026-04-30 20:00:00'`);
      expect(filters[1]).toBe(filters[0]);
      expect(filters[2]).toBe(filters[0]);
    });
  });

  describe('getEventDetail', () => {
    const baseEvent = {
      Event_ID: 42,
      Event_Title: 'Easter Service',
      Event_Start_Date: '2026-04-05 10:00:00',
      Event_End_Date: '2026-04-05 11:30:00',
      Event_Type_ID: 5,
      Congregation_ID: 1,
      Location_ID: 10,
      Description: 'Easter celebration',
      Featured_On_Calendar: true,
      Registration_Active: false,
      External_Registration_URL: null,
      Online_Registration_Product: null,
      Program_ID: 50,
      Primary_Contact: 200,
      Participants_Expected: 100,
    };

    it('should throw when the event is not found', async () => {
      mockGetTableRecords.mockResolvedValueOnce([]);

      const service = await FullCalendarService.getInstance();
      await expect(service.getEventDetail(42)).rejects.toThrow('Event not found');
    });

    it('should return enriched event without admin-only fields when not admin', async () => {
      mockGetTableRecords
        .mockResolvedValueOnce([baseEvent]) // Events
        .mockResolvedValueOnce([{ Event_Type_ID: 5, Event_Type: 'Worship' }])
        .mockResolvedValueOnce([{ Congregation_ID: 1, Congregation_Name: 'Main' }])
        .mockResolvedValueOnce([{ Location_ID: 10, Location_Name: 'Hall' }])
        .mockResolvedValueOnce([
          { Program_ID: 50, Program_Name: 'Worship', Ministry_ID: null },
        ]);

      const service = await FullCalendarService.getInstance();
      const result = await service.getEventDetail(42);

      expect(result.isAdmin).toBe(false);
      expect(result.event.Event_ID).toBe(42);
      expect(result.event.Event_Type).toBe('Worship');
      expect(result.event.Congregation_Name).toBe('Main');
      expect(result.event.Location_Name).toBe('Hall');
      expect(result.event.Program_Name).toBe('Worship');
      expect(result.event.Ministry_Name).toBeNull();
      // Admin-only fields should be null
      expect(result.event.Primary_Contact_Name).toBeNull();
      expect(result.event.Primary_Contact_Email).toBeNull();
      expect(result.event.Participant_Count).toBeNull();
      expect(result.event.Registration_Product_Name).toBeNull();
    });

    it('should issue the Events query with Event_ID + Visibility_Level_ID filter', async () => {
      mockGetTableRecords.mockResolvedValueOnce([]);

      const service = await FullCalendarService.getInstance();
      await expect(service.getEventDetail(42)).rejects.toThrow('Event not found');

      const eventsCall = mockGetTableRecords.mock.calls[0][0];
      expect(eventsCall.table).toBe('Events');
      expect(eventsCall.filter).toBe('Event_ID = 42 AND Visibility_Level_ID = 4');
      expect(eventsCall.top).toBe(1);
    });
  });
});
