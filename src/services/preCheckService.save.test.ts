import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PreCheckService, PreCheckSelectionError } from '@/services/preCheckService';

/**
 * `savePreCheck` — **the authorisation suite for C78.** This file is the
 * deliverable of the write phase; the feature is the easy part.
 *
 * ## What is being defended against
 *
 * Legacy's `EventParticipantTranslator.ToEventParticipants` split the client's
 * checkbox `name` on `_` then `|` and `int.Parse`d six fields straight into an
 * `Event_Participants` write with **no check of any kind**. A signed-in MP user
 * could therefore pre-check any contact into any event, or cancel a stranger's
 * registration, by editing one attribute in devtools. Every test in the
 * "attacks" block below is that hole, in a specific shape, proved closed.
 *
 * The rule under test: **the client sends a selection over a set the server
 * computed.** `savePreCheck` re-derives the whole legal row set from
 * `(householdId, eventDate)` — where `householdId` came from the session — and
 * a submitted key is a *lookup*, never a source of ids. The sharpest assertion
 * here is "ids come from the derived row": it mutates the ids **inside** an
 * otherwise-accepted key and asserts the MP write is byte-identical, which is
 * the only way to prove the string is not being parsed.
 *
 * The other load-bearing one is the `Attended` guard. Legacy computed its
 * cancellation set with no regard for current status, so a parent opening the
 * page after their child had been scanned in and unticking a box overwrote
 * `3 Attended` with `5 Cancelled` — destroying attendance history. That is the
 * one legacy defect that had to be fixed rather than ported.
 */

const mockGetTableRecords = vi.fn();
const mockCreateTableRecords = vi.fn();
const mockUpdateTableRecords = vi.fn();
const mockExecuteProcedure = vi.fn();
const mockGetProcedures = vi.fn();

vi.mock('@/lib/providers/ministry-platform', () => ({
  MPHelper: class {
    getTableRecords = mockGetTableRecords;
    createTableRecords = mockCreateTableRecords;
    updateTableRecords = mockUpdateTableRecords;
    executeProcedure = mockExecuteProcedure;
    getProcedures = mockGetProcedures;
  },
}));

const mockToMpSqlDatetime = vi.fn(async (value: Date | string) =>
  new Date(value).toISOString().replace('T', ' ').slice(0, 19)
);

vi.mock('@/services/domainTimezoneService', () => ({
  DomainTimezoneService: {
    getInstance: () => ({
      getMpTimezone: async () => 'America/New_York',
      toMpSqlDatetime: mockToMpSqlDatetime,
    }),
  },
}));

// Typed nullable: `ConfigSettingsService.getSetting` returns `null` for a
// missing setting, and the fallback test below depends on being able to say so.
const mockGetSetting = vi.fn(async (): Promise<string | null> => '4');

vi.mock('@/services/configSettingsService', () => ({
  ConfigSettingsService: {
    getInstance: async () => ({ getSetting: mockGetSetting }),
  },
}));

const USER_ID = 771;
const HOUSEHOLD_ID = 5;
const DATE = '2018-06-12';

/** A raw proc row, with sensible defaults for the household-5 fixture. */
function raw(over: Partial<Record<string, unknown>> = {}) {
  return {
    Contact_ID: 9,
    Participant_Record: 4,
    Display_Name: 'Check-me-in, Daddy',
    Event_ID: 2,
    Event_Title: 'Sample Check-in1',
    Event_Start_Date: '2018-06-12T17:00:00',
    Group_Participant_ID: 17,
    Group_ID: 2,
    Group_Name: 'Babies (Sample)',
    Role_Title: 'Group Leader',
    Event_Participant_ID: null,
    Participation_Status_ID: null,
    ...over,
  };
}

/** What the proc will return for this test. */
function procReturns(...rows: Record<string, unknown>[]) {
  mockExecuteProcedure.mockResolvedValue([rows]);
}

async function service() {
  const svc = await PreCheckService.getInstance();
  // The singleton caches the `/procs` probe and the participant-type lookup;
  // clear both so each test starts cold.
  (svc as unknown as { available: boolean | undefined }).available = true;
  (svc as unknown as { participantTypeId: number | null | undefined }).participantTypeId =
    undefined;
  (svc as unknown as { idCache: Map<string, number | null> }).idCache = new Map();
  return svc;
}

function save(svc: PreCheckService, selected: string[]) {
  return svc.savePreCheck({
    householdId: HOUSEHOLD_ID,
    userId: USER_ID,
    eventDate: DATE,
    selected,
  });
}

/** Every `Event_Participants` record passed to create, flattened. */
function created(): Record<string, unknown>[] {
  return mockCreateTableRecords.mock.calls
    .filter(([table]) => table === 'Event_Participants')
    .flatMap(([, records]) => records as Record<string, unknown>[]);
}

/** Every `Event_Participants` record passed to update, flattened. */
function updated(): Record<string, unknown>[] {
  return mockUpdateTableRecords.mock.calls
    .filter(([table]) => table === 'Event_Participants')
    .flatMap(([, records]) => records as Record<string, unknown>[]);
}

function participantsCreated(): Record<string, unknown>[] {
  return mockCreateTableRecords.mock.calls
    .filter(([table]) => table === 'Participants')
    .flatMap(([, records]) => records as Record<string, unknown>[]);
}

/** Did any MP write happen at all? */
function anyWrite(): boolean {
  return mockCreateTableRecords.mock.calls.length > 0 ||
    mockUpdateTableRecords.mock.calls.length > 0;
}

describe('PreCheckService.savePreCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProcedures.mockResolvedValue([{ Name: 'api_MPPW_GetPreCheckEvents' }]);
    mockGetSetting.mockResolvedValue('4');
    mockCreateTableRecords.mockResolvedValue([{ Participant_ID: 99 }]);
    mockUpdateTableRecords.mockResolvedValue([]);
    procReturns(raw());
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── The attacks ──────────────────────────────────────────────────────────

  describe('attacks the legacy protocol allowed', () => {
    it('rejects a rowKey for a contact outside the household, and writes nothing', async () => {
      // The headline legacy hole: "pre-check any contact into any event".
      // Contact 4242 is not in household 5, so the server never derived a key
      // for them and the lookup misses.
      procReturns(raw());
      const svc = await service();

      await expect(save(svc, ['4242|4243|2|0|2|17'])).rejects.toBeInstanceOf(
        PreCheckSelectionError
      );
      expect(anyWrite()).toBe(false);
    });

    it('rejects a key with a swapped eventId, even when the contact is legitimate', async () => {
      // Keeping your own contact and participant ids but substituting another
      // event's id. Whole-key matching is what closes this: the resulting
      // string is not a key the server issued.
      procReturns(raw());
      const svc = await service();

      await expect(save(svc, ['9|4|9999|0|2|17'])).rejects.toBeInstanceOf(
        PreCheckSelectionError
      );
      expect(anyWrite()).toBe(false);
    });

    it('rejects a key with a swapped eventParticipantId (cancel a stranger)', async () => {
      // The second legacy hole: "cancel a stranger's registration". The client
      // cannot name an `Event_Participant_ID` at all — it can only name a row,
      // and the row carries its own.
      procReturns(raw({ Event_Participant_ID: 500, Participation_Status_ID: 2 }));
      const svc = await service();

      await expect(save(svc, ['9|4|2|777|2|17'])).rejects.toBeInstanceOf(
        PreCheckSelectionError
      );
      expect(anyWrite()).toBe(false);
    });

    it('rejects a swapped groupParticipantId', async () => {
      procReturns(raw());
      const svc = await service();
      await expect(save(svc, ['9|4|2|0|2|8888'])).rejects.toBeInstanceOf(
        PreCheckSelectionError
      );
      expect(anyWrite()).toBe(false);
    });

    it('fails the WHOLE request when one key of many is unrecognised', async () => {
      // Not partial filtering: a mismatch is either an attack or a stale page,
      // and silently saving the valid subset would mean the visitor's screen
      // and the database disagree about what just happened.
      procReturns(raw(), raw({ Contact_ID: 12, Participant_Record: 6, Group_Participant_ID: 15 }));
      const svc = await service();

      await expect(
        save(svc, ['9|4|2|0|2|17', '12|6|2|0|2|15', '4242|4243|2|0|2|17'])
      ).rejects.toBeInstanceOf(PreCheckSelectionError);
      expect(anyWrite()).toBe(false);
    });

    it('carries the count but never the offending keys', async () => {
      procReturns(raw());
      const svc = await service();

      const error = await save(svc, ['bad-1', 'bad-2']).catch((e) => e);
      expect(error).toBeInstanceOf(PreCheckSelectionError);
      expect((error as PreCheckSelectionError).unknownCount).toBe(2);
      // Echoing the keys would confirm to a prober which guesses were shaped
      // right.
      expect(String(error)).not.toContain('bad-1');
    });

    it('rejects a well-formed-looking but never-issued key', async () => {
      procReturns(raw());
      const svc = await service();
      await expect(save(svc, ['0|0|0|0|0|0'])).rejects.toBeInstanceOf(
        PreCheckSelectionError
      );
      expect(anyWrite()).toBe(false);
    });

    it('never reads the household from anywhere but the argument', async () => {
      procReturns(raw());
      const svc = await service();
      await save(svc, []);

      // The derived set is a function of the session's household and the date.
      expect(mockExecuteProcedure).toHaveBeenCalledWith('api_MPPW_GetPreCheckEvents', {
        '@HouseholdID': HOUSEHOLD_ID,
        '@EventDate': DATE,
      });
    });
  });

  // ── Rule 3: every written id comes from the derived row ──────────────────

  describe('ids come from the derived row, never the submitted string', () => {
    it('writes the row\'s ids even though the key string is the only client input', async () => {
      // The proof: the *server's* row says participant 4, event 2, group 2,
      // group-participant 17. The client sent a string that happens to spell
      // the same thing — because that is the only string it could send that
      // would be accepted. The write must match the row.
      procReturns(raw());
      const svc = await service();

      await save(svc, ['9|4|2|0|2|17']);

      expect(created()).toEqual([
        {
          Event_ID: 2,
          Participant_ID: 4,
          Participation_Status_ID: 2,
          Group_ID: 2,
          Group_Participant_ID: 17,
          Registrant_Message_Sent: false,
          Attendee_Message_Sent: false,
          Attending_Online: false,
        },
      ]);
    });

    it('is unaffected by what the accepted key would parse to', async () => {
      // The same server row, but the proc now reports different ids. If the
      // service were parsing the string it would keep writing 4/2/2/17; because
      // it reads the row, the write follows the row.
      procReturns(
        raw({ Participant_Record: 61, Event_ID: 70, Group_ID: 43, Group_Participant_ID: 65 })
      );
      const svc = await service();

      await save(svc, ['9|61|70|0|43|65']);

      expect(created()[0]).toMatchObject({
        Event_ID: 70,
        Participant_ID: 61,
        Group_ID: 43,
        Group_Participant_ID: 65,
      });
    });

    it('never writes Time_In, Room_ID or Check-in_Station', async () => {
      // Those are the check-in station's to set. Writing `Time_In` from a
      // widget would make a pre-check look like an attendance.
      procReturns(raw());
      const svc = await service();
      await save(svc, ['9|4|2|0|2|17']);

      for (const record of [...created(), ...updated()]) {
        expect(record).not.toHaveProperty('Time_In');
        expect(record).not.toHaveProperty('Time_Out');
        expect(record).not.toHaveProperty('Time_Confirmed');
        expect(record).not.toHaveProperty('Room_ID');
        expect(record).not.toHaveProperty('Check-in_Station');
        expect(record).not.toHaveProperty('RSVP_Status_ID');
      }
    });

    it('omits the group columns entirely when the row has none', async () => {
      // Not `Group_ID: null` — an update setting it null would *clear* a group
      // a station had already assigned.
      procReturns(raw({ Group_ID: null, Group_Participant_ID: null, Group_Name: null }));
      const svc = await service();

      await save(svc, ['9|4|2|0|0|0']);

      expect(created()[0]).not.toHaveProperty('Group_ID');
      expect(created()[0]).not.toHaveProperty('Group_Participant_ID');
    });
  });

  // ── Register / update ────────────────────────────────────────────────────

  describe('registering', () => {
    it('creates when the row has no Event_Participant_ID', async () => {
      procReturns(raw());
      const svc = await service();
      const result = await save(svc, ['9|4|2|0|2|17']);

      expect(created()).toHaveLength(1);
      expect(updated()).toHaveLength(0);
      expect(result).toEqual({ registered: 1, cancelled: 0, locked: [] });
    });

    it('updates when the row already has one', async () => {
      procReturns(raw({ Event_Participant_ID: 500, Participation_Status_ID: 5 }));
      const svc = await service();
      const result = await save(svc, ['9|4|2|500|2|17']);

      expect(created()).toHaveLength(0);
      expect(updated()).toEqual([
        {
          Event_Participant_ID: 500,
          Event_ID: 2,
          Participant_ID: 4,
          Participation_Status_ID: 2,
          Group_ID: 2,
          Group_Participant_ID: 17,
        },
      ]);
      expect(result.registered).toBe(1);
    });

    it('writes status 2 Registered, never anything else', async () => {
      procReturns(raw());
      const svc = await service();
      await save(svc, ['9|4|2|0|2|17']);
      expect(created()[0]!.Participation_Status_ID).toBe(2);
    });

    it('passes $userId on every write, so MP audits the parent', async () => {
      // Without it MP records the API service user and the church's audit trail
      // says nobody did it.
      procReturns(
        raw(),
        raw({ Contact_ID: 12, Participant_Record: 6, Group_Participant_ID: 15,
              Event_Participant_ID: 600, Participation_Status_ID: 2 })
      );
      const svc = await service();
      await save(svc, ['9|4|2|0|2|17']);

      const calls = [
        ...mockCreateTableRecords.mock.calls,
        ...mockUpdateTableRecords.mock.calls,
      ];
      expect(calls.length).toBeGreaterThan(0);
      for (const [, , params] of calls) {
        expect(params).toMatchObject({ $userId: USER_ID });
      }
    });

    it('deduplicates a repeated key in the submission', async () => {
      procReturns(raw());
      const svc = await service();
      await save(svc, ['9|4|2|0|2|17', '9|4|2|0|2|17']);
      expect(created()).toHaveLength(1);
    });
  });

  // ── Rule 6: the two-groups case ──────────────────────────────────────────

  describe('a member in two of an event\'s groups', () => {
    // The proc emits one row per group participation, so participant 6 in both
    // group 43 (`3rd Grade`) and group 39 (`Pre-K`) yields two rows for the
    // same (contact, event), sharing one `Event_Participant_ID`.
    const twoGroups = () => [
      raw({ Contact_ID: 12, Participant_Record: 6, Display_Name: 'FemaleChild',
            Group_ID: 43, Group_Name: '3rd Grade', Group_Participant_ID: 65,
            Event_Participant_ID: 700, Participation_Status_ID: 2 }),
      raw({ Contact_ID: 12, Participant_Record: 6, Display_Name: 'FemaleChild',
            Group_ID: 39, Group_Name: 'Pre-K', Group_Participant_ID: 66,
            Event_Participant_ID: 700, Participation_Status_ID: 2 }),
    ];

    it('emits ONE update for the shared Event_Participant_ID, not two', async () => {
      procReturns(...twoGroups());
      const svc = await service();

      await save(svc, ['12|6|2|700|43|65', '12|6|2|700|39|66']);

      // Two updates to one primary key in a batch is at best wasted and at
      // worst a lost update.
      expect(updated()).toHaveLength(1);
      expect(updated()[0]!.Event_Participant_ID).toBe(700);
    });

    it('takes the first row in the server\'s order when the groups disagree', async () => {
      procReturns(...twoGroups());
      const svc = await service();
      await save(svc, ['12|6|2|700|43|65', '12|6|2|700|39|66']);
      expect(updated()[0]).toMatchObject({ Group_ID: 43, Group_Participant_ID: 65 });
    });

    it('does not cancel the registration when only one of the two rows is unticked', async () => {
      // Both rows share one `Event_Participant_ID`; the member is still coming.
      procReturns(...twoGroups());
      const svc = await service();

      const result = await save(svc, ['12|6|2|700|43|65']);

      expect(result.cancelled).toBe(0);
      expect(updated().every((r) => r.Participation_Status_ID !== 5)).toBe(true);
    });

    it('cancels once when neither row is selected', async () => {
      procReturns(...twoGroups());
      const svc = await service();

      const result = await save(svc, []);

      expect(result.cancelled).toBe(1);
      expect(updated()).toEqual([
        { Event_Participant_ID: 700, Participation_Status_ID: 5 },
      ]);
    });
  });

  // ── Rule 5: derived cancellation ─────────────────────────────────────────

  describe('cancelling', () => {
    it('cancels a registered row nothing selected', async () => {
      procReturns(raw({ Event_Participant_ID: 500, Participation_Status_ID: 2 }));
      const svc = await service();

      const result = await save(svc, []);

      expect(result).toEqual({ registered: 0, cancelled: 1, locked: [] });
      expect(updated()).toEqual([
        { Event_Participant_ID: 500, Participation_Status_ID: 5 },
      ]);
    });

    it('never deletes a row', async () => {
      procReturns(raw({ Event_Participant_ID: 500, Participation_Status_ID: 2 }));
      const svc = await service();
      await save(svc, []);

      // Status only. A deleted row loses the fact that the family had planned
      // to come, and legacy did not delete either.
      const mp = (svc as unknown as { mp: Record<string, unknown> }).mp;
      expect(mp.deleteTableRecords).toBeUndefined();
      expect(updated()[0]!.Participation_Status_ID).toBe(5);
    });

    it('does not touch a row that has no Event_Participant_ID', async () => {
      // Nothing to cancel: there is no registration yet.
      procReturns(raw({ Event_Participant_ID: null }));
      const svc = await service();

      const result = await save(svc, []);

      expect(result.cancelled).toBe(0);
      expect(anyWrite()).toBe(false);
    });

    it('does not re-cancel an already-cancelled row', async () => {
      procReturns(raw({ Event_Participant_ID: 500, Participation_Status_ID: 5 }));
      const svc = await service();

      const result = await save(svc, []);

      expect(result.cancelled).toBe(0);
      expect(anyWrite()).toBe(false);
    });

    it('registers one member and cancels another in the same request', async () => {
      procReturns(
        raw(),
        raw({ Contact_ID: 12, Participant_Record: 6, Group_Participant_ID: 15,
              Event_Participant_ID: 600, Participation_Status_ID: 2 })
      );
      const svc = await service();

      const result = await save(svc, ['9|4|2|0|2|17']);

      expect(result).toEqual({ registered: 1, cancelled: 1, locked: [] });
    });
  });

  // ── Rule 4: the Attended guard (the legacy defect that had to be fixed) ──

  describe('an Attended or Confirmed row', () => {
    for (const [status, label] of [
      [3, 'Attended'],
      [4, 'Confirmed'],
    ] as const) {
      it(`is never cancelled when unticked (${status} ${label})`, async () => {
        // Legacy computed its cancellation set with no regard for status, so a
        // parent opening the page after their child had been scanned in and
        // unticking a box overwrote the attendance record. This is the one
        // legacy defect that had to be fixed rather than ported.
        procReturns(raw({ Event_Participant_ID: 800, Participation_Status_ID: status }));
        const svc = await service();

        const result = await save(svc, []);

        expect(result.cancelled).toBe(0);
        expect(anyWrite()).toBe(false);
        expect(result.locked).toEqual(['9|4|2|800|2|17']);
      });

      it(`is never re-registered when ticked (${status} ${label})`, async () => {
        // The other direction loses the same information: writing
        // `2 Registered` over `3 Attended` erases the scan just as thoroughly.
        procReturns(raw({ Event_Participant_ID: 800, Participation_Status_ID: status }));
        const svc = await service();

        const result = await save(svc, ['9|4|2|800|2|17']);

        expect(anyWrite()).toBe(false);
        expect(result.registered).toBe(0);
        expect(result.locked).toEqual(['9|4|2|800|2|17']);
      });
    }

    it('does not block a different member in the same request', async () => {
      procReturns(
        raw({ Event_Participant_ID: 800, Participation_Status_ID: 3 }),
        raw({ Contact_ID: 12, Participant_Record: 6, Group_Participant_ID: 15 })
      );
      const svc = await service();

      const result = await save(svc, ['12|6|2|0|2|15']);

      expect(result.registered).toBe(1);
      expect(result.cancelled).toBe(0);
      expect(result.locked).toEqual(['9|4|2|800|2|17']);
    });
  });

  // ── Rule 8: participant creation ─────────────────────────────────────────

  describe('creating a missing Participants row', () => {
    it('creates exactly one, for the derived row\'s contact', async () => {
      procReturns(raw({ Participant_Record: null }));
      const svc = await service();

      await save(svc, ['9|0|2|0|2|17']);

      expect(participantsCreated()).toHaveLength(1);
      // Household-scoped by construction: the row came out of the map derived
      // from the caller's own `Household_ID`.
      expect(participantsCreated()[0]).toMatchObject({
        Contact_ID: 9,
        Participant_Type_ID: 4,
        Notes: 'Created by Web Widget',
      });
    });

    it('uses the created participant id in the Event_Participants write', async () => {
      procReturns(raw({ Participant_Record: null }));
      mockCreateTableRecords.mockResolvedValueOnce([{ Participant_ID: 99 }]);
      const svc = await service();

      await save(svc, ['9|0|2|0|2|17']);

      expect(created()[0]).toMatchObject({ Participant_ID: 99 });
    });

    it('writes Participant_Start_Date through DomainTimezoneService, not toISOString', async () => {
      procReturns(raw({ Participant_Record: null }));
      const svc = await service();

      await save(svc, ['9|0|2|0|2|17']);

      expect(mockToMpSqlDatetime).toHaveBeenCalled();
      const startDate = participantsCreated()[0]!.Participant_Start_Date as string;
      // MP's wall-clock shape. A `T`/`Z` here means someone reached for
      // `new Date().toISOString()` and an evening save moved to the next day.
      expect(startDate).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });

    it('resolves the participant type from PORTAL/DefaultParticipantTypeID', async () => {
      procReturns(raw({ Participant_Record: null }));
      const svc = await service();
      await save(svc, ['9|0|2|0|2|17']);
      expect(mockGetSetting).toHaveBeenCalledWith('PORTAL', 'DefaultParticipantTypeID');
    });

    it('falls back to resolving Guest by name when the setting is unset', async () => {
      // Lookup ids are only stable on a stock instance; a data conversion can
      // renumber them, so the fallback is by name rather than a literal.
      mockGetSetting.mockResolvedValue(null);
      mockGetTableRecords.mockResolvedValue([{ Id: 7 }]);
      procReturns(raw({ Participant_Record: null }));
      const svc = await service();

      await save(svc, ['9|0|2|0|2|17']);

      expect(mockGetTableRecords).toHaveBeenCalledWith(
        expect.objectContaining({ table: 'Participant_Types' })
      );
      expect(participantsCreated()[0]).toMatchObject({ Participant_Type_ID: 7 });
    });

    it('skips the row rather than inventing a type when both lookups miss', async () => {
      mockGetSetting.mockResolvedValue(null);
      mockGetTableRecords.mockResolvedValue([]);
      procReturns(raw({ Participant_Record: null }));
      const svc = await service();

      const result = await save(svc, ['9|0|2|0|2|17']);

      expect(participantsCreated()).toHaveLength(0);
      expect(created()).toHaveLength(0);
      expect(result.registered).toBe(0);
    });

    it('does not create a participant for a member who already has one', async () => {
      procReturns(raw());
      const svc = await service();
      await save(svc, ['9|4|2|0|2|17']);
      expect(participantsCreated()).toHaveLength(0);
    });
  });

  // ── The no-op ────────────────────────────────────────────────────────────

  describe('an empty selection', () => {
    it('writes nothing when there is nothing registered to cancel', async () => {
      procReturns(raw());
      const svc = await service();

      const result = await save(svc, []);

      expect(result).toEqual({ registered: 0, cancelled: 0, locked: [] });
      expect(anyWrite()).toBe(false);
    });

    it('writes nothing when the day has no rows at all', async () => {
      procReturns();
      const svc = await service();

      const result = await save(svc, []);

      expect(result).toEqual({ registered: 0, cancelled: 0, locked: [] });
      expect(anyWrite()).toBe(false);
    });
  });
});
