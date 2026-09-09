import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PreCheckService, groupByMember } from '@/services/preCheckService';
import { buildPreCheckRowKey } from '@mpnext/types';

/**
 * `preCheckService` — the MP read boundary for C78.
 *
 * Four of these assertions guard a *deliberate* choice against a plausible
 * future "simplification", and they are the ones worth reading twice:
 *
 *  - **the proc parameter is the bare `YYYY-MM-DD` string.** `@EventDate` is a
 *    `datetime` and the proc `CAST(… AS date)`s both sides, so the wall-clock
 *    date is exactly right. The moment someone wraps it in `new Date(...)` this
 *    fails — which is the legacy day-shift bug, caught.
 *  - **nullable columns map to `null`, never `0`.** Legacy's
 *    `(int)…ToObject<long>()` yielded `0` for a null and then had to
 *    special-case `participantId == 0` to recover the distinction it had just
 *    destroyed.
 *  - **`isAvailable` probes with the proc's exact name.** `/procs?$search=` is
 *    an exact-name match on a live MP domain, not a substring search: a probe
 *    for `"PreCheck"` returns `[]` even where the proc is installed, so a
 *    friendlier term here would make the widget permanently dark.
 *  - **`resolveDefaultEventDate` uses the domain zone**, not the process zone —
 *    asserted with a mocked zone far from the runner's.
 */

const mockGetTableRecords = vi.fn();
const mockExecuteProcedure = vi.fn();
const mockGetProcedures = vi.fn();

vi.mock('@/lib/providers/ministry-platform', () => ({
  MPHelper: class {
    getTableRecords = mockGetTableRecords;
    executeProcedure = mockExecuteProcedure;
    getProcedures = mockGetProcedures;
    createTableRecords = vi.fn();
    updateTableRecords = vi.fn();
  },
}));

/**
 * `domainTimezoneService.ts` builds its own singleton — and an `MPHelper` with
 * it — at module scope, before the factory above has initialised the spies.
 * Mocking the module is the established pattern here (`addToCalendarService`,
 * `prayerFeedbackService` both do it).
 */
const mockGetMpTimezone = vi.fn(async () => 'America/New_York');

vi.mock('@/services/domainTimezoneService', () => ({
  DomainTimezoneService: {
    getInstance: () => ({ getMpTimezone: mockGetMpTimezone }),
  },
}));

/** One row exactly as the live proc returns it, padding and all. */
const RAW_ROW = {
  Contact_ID: 9,
  Participant_Record: 4,
  Display_Name: 'Check-me-in, Daddy ',
  Event_ID: 2,
  Event_Title: 'Sample Check-in1 ',
  Event_Start_Date: '2018-06-12T17:00:00',
  Prohibit_Guests: false,
  Group_Participant_ID: 17,
  Group_ID: 2,
  Group_Name: 'Babies (Sample)',
  Role_Title: 'Group Leader',
  Event_Participant_ID: null,
  Participation_Status_ID: null,
};

async function service() {
  return PreCheckService.getInstance();
}

describe('PreCheckService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMpTimezone.mockResolvedValue('America/New_York');
    mockGetProcedures.mockResolvedValue([{ Name: 'api_MPPW_GetPreCheckEvents' }]);
    mockExecuteProcedure.mockResolvedValue([[]]);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getPreCheckRows', () => {
    it('calls the proc with @HouseholdID and a bare YYYY-MM-DD @EventDate', async () => {
      const svc = await service();
      await svc.getPreCheckRows(5, '2018-06-12');

      expect(mockExecuteProcedure).toHaveBeenCalledWith('api_MPPW_GetPreCheckEvents', {
        '@HouseholdID': 5,
        '@EventDate': '2018-06-12',
      });

      // The regression that matters: no `T`, no `Z`, no offset. A `Date` or an
      // ISO instant here is the legacy day-shift.
      const sent = mockExecuteProcedure.mock.calls[0]![1]['@EventDate'];
      expect(typeof sent).toBe('string');
      expect(sent).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('maps a full row, trimming MP padding', async () => {
      mockExecuteProcedure.mockResolvedValue([[RAW_ROW]]);
      const svc = await service();
      const [row] = await svc.getPreCheckRows(5, '2018-06-12');

      expect(row).toMatchObject({
        contactId: 9,
        participantName: 'Check-me-in, Daddy',
        participantId: 4,
        eventId: 2,
        eventName: 'Sample Check-in1',
        eventStart: '2018-06-12T17:00:00',
        groupId: 2,
        groupName: 'Babies (Sample)',
        groupParticipantId: 17,
        roleName: 'Group Leader',
        eventParticipantId: null,
        participationStatusId: null,
        isRegistered: false,
        isLocked: false,
      });
    });

    it('maps nullable columns to null, never 0', async () => {
      mockExecuteProcedure.mockResolvedValue([
        [
          {
            ...RAW_ROW,
            Participant_Record: null,
            Group_ID: null,
            Group_Name: null,
            Group_Participant_ID: null,
            Role_Title: null,
            Event_Participant_ID: null,
            Participation_Status_ID: null,
          },
        ],
      ]);

      const svc = await service();
      const [row] = await svc.getPreCheckRows(5, '2018-06-12');

      // Legacy's `(int)…ToObject<long>()` produced 0 for every one of these.
      expect(row!.participantId).toBeNull();
      expect(row!.groupId).toBeNull();
      expect(row!.groupParticipantId).toBeNull();
      expect(row!.eventParticipantId).toBeNull();
      expect(row!.participationStatusId).toBeNull();
      expect(row!.groupName).toBeNull();
      expect(row!.roleName).toBeNull();
    });

    it('coerces MP string-typed ids to numbers', async () => {
      // MP's REST layer returns integer columns as strings in some responses.
      mockExecuteProcedure.mockResolvedValue([
        [{ ...RAW_ROW, Contact_ID: '9', Participant_Record: '4', Event_ID: '2' }],
      ]);

      const svc = await service();
      const [row] = await svc.getPreCheckRows(5, '2018-06-12');

      expect(row!.contactId).toBe(9);
      expect(row!.participantId).toBe(4);
      expect(row!.eventId).toBe(2);
    });

    it('sets isRegistered only for status 2', async () => {
      for (const [status, registered] of [
        [1, false],
        [2, true],
        [3, false],
        [4, false],
        [5, false],
      ] as const) {
        mockExecuteProcedure.mockResolvedValue([
          [{ ...RAW_ROW, Event_Participant_ID: 900, Participation_Status_ID: status }],
        ]);
        const svc = await service();
        const [row] = await svc.getPreCheckRows(5, '2018-06-12');
        expect(row!.isRegistered, `status ${status}`).toBe(registered);
      }
    });

    it('sets isLocked only for Attended (3) and Confirmed (4)', async () => {
      for (const [status, locked] of [
        [1, false],
        [2, false],
        [3, true],
        [4, true],
        [5, false],
        [20, false],
      ] as const) {
        mockExecuteProcedure.mockResolvedValue([
          [{ ...RAW_ROW, Event_Participant_ID: 900, Participation_Status_ID: status }],
        ]);
        const svc = await service();
        const [row] = await svc.getPreCheckRows(5, '2018-06-12');
        expect(row!.isLocked, `status ${status}`).toBe(locked);
      }
    });

    it('builds a canonical rowKey with 0 standing in for each null', async () => {
      mockExecuteProcedure.mockResolvedValue([
        [{ ...RAW_ROW, Participant_Record: null, Event_Participant_ID: null }],
      ]);
      const svc = await service();
      const [row] = await svc.getPreCheckRows(5, '2018-06-12');

      // contactId|participantId|eventId|eventParticipantId|groupId|groupParticipantId
      expect(row!.rowKey).toBe('9|0|2|0|2|17');
      expect(row!.rowKey).toBe(
        buildPreCheckRowKey({
          contactId: 9,
          participantId: null,
          eventId: 2,
          eventParticipantId: null,
          groupId: 2,
          groupParticipantId: 17,
        })
      );
    });

    it('is stable across two reads of the same data', async () => {
      mockExecuteProcedure.mockResolvedValue([[RAW_ROW]]);
      const svc = await service();
      const first = await svc.getPreCheckRows(5, '2018-06-12');
      const second = await svc.getPreCheckRows(5, '2018-06-12');
      expect(first[0]!.rowKey).toBe(second[0]!.rowKey);
    });

    it('returns [] when the proc yields no rows', async () => {
      // Normal, not an error: a Tuesday has no Sunday classes, and MP's
      // `Search_Results = 3` rule legitimately hides a whole household.
      mockExecuteProcedure.mockResolvedValue([[]]);
      const svc = await service();
      expect(await svc.getPreCheckRows(5, '2025-05-18')).toEqual([]);
    });

    it('returns [] when the proc yields no result set at all', async () => {
      mockExecuteProcedure.mockResolvedValue([]);
      const svc = await service();
      expect(await svc.getPreCheckRows(5, '2025-05-18')).toEqual([]);
    });
  });

  describe('isAvailable', () => {
    it('probes with the proc\'s exact name', async () => {
      const svc = await service();
      svc['available'] = undefined;

      expect(await svc.isAvailable()).toBe(true);

      // `/procs?$search=` is an exact-name match on a live domain. A partial
      // term ("PreCheck", "api_MPPW") returns [] even where the proc exists, so
      // this assertion is the difference between a working widget and one that
      // reports `precheck_unavailable` on every church.
      expect(mockGetProcedures).toHaveBeenCalledWith('api_MPPW_GetPreCheckEvents');
    });

    it('reports false when the domain does not have the proc', async () => {
      mockGetProcedures.mockResolvedValue([]);
      const svc = await service();
      svc['available'] = undefined;
      expect(await svc.isAvailable()).toBe(false);
    });

    it('caches the answer, positive or negative', async () => {
      mockGetProcedures.mockResolvedValue([]);
      const svc = await service();
      svc['available'] = undefined;

      await svc.isAvailable();
      await svc.isAvailable();

      expect(mockGetProcedures).toHaveBeenCalledTimes(1);
    });

    it('fails open, and does not cache, when /procs itself errors', async () => {
      mockGetProcedures.mockRejectedValue(new Error('502 Bad Gateway'));
      const svc = await service();
      svc['available'] = undefined;

      // A transport blip must degrade to "try the call and see", not to a hard
      // `precheck_unavailable` on a domain where the widget works…
      expect(await svc.isAvailable()).toBe(true);

      // …and it must not pin that answer for the process lifetime.
      mockGetProcedures.mockResolvedValue([]);
      expect(await svc.isAvailable()).toBe(false);
    });
  });

  describe('resolveDefaultEventDate', () => {
    it('returns YYYY-MM-DD in the MP domain zone, not the process zone', async () => {
      // 2025-05-19T02:30:00Z is still 2025-05-18 in New York. A service that
      // reached for `new Date().toISOString().slice(0, 10)` — legacy's bug —
      // would answer 2025-05-19 here.
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-05-19T02:30:00Z'));
      try {
        const svc = await service();
        expect(await svc.resolveDefaultEventDate()).toBe('2025-05-18');
      } finally {
        vi.useRealTimers();
      }
    });

    it('follows the domain zone when it changes', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-05-19T02:30:00Z'));
      try {
        mockGetMpTimezone.mockResolvedValue('Pacific/Auckland');
        const svc = await service();
        // Same instant, 2025-05-19 14:30 in Auckland.
        expect(await svc.resolveDefaultEventDate()).toBe('2025-05-19');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('buildQrPayload', () => {
    it('emits the exact legacy payload with a M/d/yyyy short date', async () => {
      const svc = await service();
      expect(svc.buildQrPayload(5, '2025-05-18')).toBe('pre|5/18/2025|5');
    });

    it('strips leading zeros from both month and day', async () => {
      const svc = await service();
      expect(svc.buildQrPayload(5, '2025-11-05')).toBe('pre|11/5/2025|5');
      expect(svc.buildQrPayload(12, '2025-01-01')).toBe('pre|1/1/2025|12');
      expect(svc.buildQrPayload(7, '2025-12-31')).toBe('pre|12/31/2025|7');
    });

    it('does not depend on the process locale', async () => {
      // `toLocaleDateString` would emit 18/05/2025 under a en-GB process
      // locale and every scan would fail with nothing in any log to explain it.
      const svc = await service();
      const payload = svc.buildQrPayload(5, '2025-05-18');
      expect(payload.split('|')[1]).toBe('5/18/2025');
    });
  });

  describe('groupByMember', () => {
    const row = (contactId: number, name: string, eventId: number) => ({
      rowKey: `${contactId}|1|${eventId}|0|0|0`,
      contactId,
      participantName: name,
      participantId: 1,
      eventId,
      eventName: 'Service',
      eventStart: '2025-05-18T09:00:00',
      groupId: null,
      groupName: null,
      groupParticipantId: null,
      roleName: null,
      eventParticipantId: null,
      participationStatusId: null,
      isRegistered: false,
      isLocked: false,
    });

    it('groups rows under one entry per member', () => {
      const members = groupByMember([
        row(9, 'Daddy', 1),
        row(9, 'Daddy', 2),
        row(11, 'Mommy', 1),
      ]);

      expect(members).toHaveLength(2);
      expect(members[0]!.contactId).toBe(9);
      expect(members[0]!.rows).toHaveLength(2);
      expect(members[1]!.contactId).toBe(11);
    });

    it('does not duplicate a member when rows are not contact-ordered', () => {
      // The whole reason grouping moved to the server: legacy grouped by
      // watching `contactId` change between consecutive rows, so this input
      // produced *three* sections and rendered "Daddy" twice.
      const members = groupByMember([
        row(9, 'Daddy', 1),
        row(11, 'Mommy', 1),
        row(9, 'Daddy', 2),
      ]);

      expect(members).toHaveLength(2);
      expect(members.map((m) => m.contactId)).toEqual([9, 11]);
      expect(members[0]!.rows).toHaveLength(2);
    });

    it('returns [] for no rows', () => {
      expect(groupByMember([])).toEqual([]);
    });
  });
});
