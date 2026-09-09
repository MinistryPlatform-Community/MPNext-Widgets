import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PrayerFeedbackService, type PendingFeedback } from '@/services/prayerFeedbackService';

/**
 * `prayerFeedbackService` — the MP boundary for C69.
 *
 * The assertions worth reading twice are the ones that guard a *deliberate*
 * choice against a future "simplification":
 *
 *  - the nine-column `Feedback_Entries` write, with `Approved: false` present
 *    and false (the interlock behind public visibility);
 *  - `Date_Submitted` in MP's wall-clock `YYYY-MM-DD HH:mm:ss` shape, which is
 *    what catches a reviewer swapping `DomainTimezoneService` back for
 *    `.toISOString()`;
 *  - `Description` surviving all 2000 characters, where legacy cut at 1000;
 *  - `backfillContactEmail` writing **only** into an empty `Email_Address`,
 *    where legacy overwrote unconditionally;
 *  - the removal-type default excluded by *both* predicates — the name half is
 *    the one a refactor would quietly drop;
 *  - `Contact_Status_ID` rather than legacy's non-existent `Status` column (C83).
 */

const mockGetTableRecords = vi.fn();
const mockCreateTableRecords = vi.fn();
const mockUpdateTableRecords = vi.fn();

vi.mock('@/lib/providers/ministry-platform', () => ({
  MPHelper: class {
    getTableRecords = mockGetTableRecords;
    createTableRecords = mockCreateTableRecords;
    updateTableRecords = mockUpdateTableRecords;
  },
}));

/**
 * `domainTimezoneService.ts` builds its own singleton — and an `MPHelper` with
 * it — at module scope, which runs before the mock factory above has
 * initialised `mockGetTableRecords`. Mocking the module is the established
 * pattern here (`addToCalendarService.test.ts` does the same); the stand-in
 * still produces MP's wall-clock shape, so the `Date_Submitted` assertion below
 * fails exactly as intended if the service ever reaches for `.toISOString()`
 * instead — the spy would go uncalled and a `T` and `Z` would appear.
 */
const mockToMpSqlDatetime = vi.fn(async (value: Date | string) =>
  new Date(value).toISOString().replace('T', ' ').slice(0, 19)
);

vi.mock('@/services/domainTimezoneService', () => ({
  DomainTimezoneService: {
    getInstance: () => ({ toMpSqlDatetime: mockToMpSqlDatetime }),
  },
}));

const mockGetMembers = vi.fn();

vi.mock('@/services/householdService', () => ({
  HouseholdService: {
    getInstance: async () => ({ getMembers: mockGetMembers }),
  },
}));

/** MP's five stock `Feedback_Types` rows. */
const STOCK_TYPES = [
  { Feedback_Type_ID: 1, Feedback_Type: 'Prayer Request', Description: null },
  { Feedback_Type_ID: 2, Feedback_Type: 'Praise Report', Description: null },
  { Feedback_Type_ID: 3, Feedback_Type: 'Comments', Description: 'General comments' },
  { Feedback_Type_ID: 4, Feedback_Type: 'Raving Fan', Description: null },
  { Feedback_Type_ID: 5, Feedback_Type: 'User Removal Request', Description: null },
];

const BASE: PendingFeedback = {
  contactId: 42,
  firstName: 'Doug',
  lastName: 'Smith',
  email: 'doug@example.com',
  mobilePhone: null,
  feedbackTypeId: 1,
  summary: 'Please pray for my family',
  description: 'We are going through a hard season.',
  isPrivate: false,
  programId: null,
};

/** A `getTableRecords` fake that answers by table (and, for Contacts, by filter). */
function routeReads(handlers: {
  feedbackTypes?: unknown[];
  contacts?: (filter: string) => unknown[];
  users?: unknown[];
  lookups?: Record<string, unknown[]>;
}) {
  mockGetTableRecords.mockImplementation(
    async (args: { table: string; filter?: string }) => {
      if (args.table === 'Feedback_Types') return handlers.feedbackTypes ?? STOCK_TYPES;
      if (args.table === 'Contacts') return handlers.contacts?.(args.filter ?? '') ?? [];
      if (args.table === 'dp_Users') return handlers.users ?? [];
      return handlers.lookups?.[args.table] ?? [];
    }
  );
}

/** Lookup rows for the three `getIdByValue` calls a contact-create makes. */
const LOOKUPS = {
  Household_Sources: [{ Id: 19 }],
  Contact_Statuses: [{ Id: 1 }],
  Household_Positions: [{ Id: 1 }],
};

/** The `getTableRecords` args of the first read against `table`. */
function readArgs(table: string): { table: string; filter?: string } {
  const call = mockGetTableRecords.mock.calls.find((c) => c[0].table === table);
  if (!call) throw new Error(`No getTableRecords call for ${table}`);
  return call[0] as { table: string; filter?: string };
}

function created(table: string): Record<string, unknown> {
  const call = mockCreateTableRecords.mock.calls.find((c) => c[0] === table);
  if (!call) throw new Error(`No createTableRecords call for ${table}`);
  return (call[1] as Record<string, unknown>[])[0];
}

describe('PrayerFeedbackService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (PrayerFeedbackService as any).instance = undefined;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockCreateTableRecords.mockImplementation(async (table: string) => {
      if (table === 'Households') return [{ Household_ID: 900 }];
      if (table === 'Contacts') return [{ Contact_ID: 901 }];
      if (table === 'Feedback_Entries') return [{ Feedback_Entry_ID: 555 }];
      return [];
    });
    mockUpdateTableRecords.mockResolvedValue([]);
    mockGetMembers.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is a singleton', async () => {
    routeReads({});
    expect(await PrayerFeedbackService.getInstance()).toBe(
      await PrayerFeedbackService.getInstance()
    );
  });

  // ── Feedback types ─────────────────────────────────────────────────────────

  describe('getFeedbackTypes', () => {
    it('excludes the removal type by id when no allowlist is given', async () => {
      routeReads({});
      const service = await PrayerFeedbackService.getInstance();
      const types = await service.getFeedbackTypes();

      expect(types.map((t) => t.id)).toEqual([1, 2, 3, 4]);
      expect(types.some((t) => t.id === 5)).toBe(false);
    });

    it('excludes it by name when the id differs on this domain', async () => {
      // The assertion that proves the `/removal/i` half is wired. A church that
      // renumbered or re-seeded `Feedback_Types` must still not be offering a
      // data-erasure channel to website visitors by default.
      routeReads({
        feedbackTypes: [
          { Feedback_Type_ID: 1, Feedback_Type: 'Prayer Request', Description: null },
          { Feedback_Type_ID: 9, Feedback_Type: 'User Removal Request', Description: null },
        ],
      });
      const service = await PrayerFeedbackService.getInstance();
      const types = await service.getFeedbackTypes();

      expect(types.map((t) => t.id)).toEqual([1]);
    });

    it('honours an explicit allowlist and caches the table read', async () => {
      routeReads({});
      const service = await PrayerFeedbackService.getInstance();

      const first = await service.getFeedbackTypes([1, 2]);
      const second = await service.getFeedbackTypes([1, 2]);

      expect(first.map((t) => t.id)).toEqual([1, 2]);
      expect(second).toEqual(first);
      const typeReads = mockGetTableRecords.mock.calls.filter(
        (c) => c[0].table === 'Feedback_Types'
      );
      expect(typeReads).toHaveLength(1);
    });

    it('ships the removal type when a church lists it, and warns once', async () => {
      // An explicit configuration is a deliberate choice and not ours to
      // override; only the *default* has to be safe. The warning exists so a
      // copy-pasted snippet gets noticed.
      routeReads({});
      const service = await PrayerFeedbackService.getInstance();

      const types = await service.getFeedbackTypes([1, 2, 5]);
      await service.getFeedbackTypes([1, 2, 5]);

      expect(types.map((t) => t.id)).toEqual([1, 2, 5]);
      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(vi.mocked(console.warn).mock.calls[0][0]).toContain('User Removal Request');
    });

    it('drops an unknown id from an allowlist rather than inventing an option', async () => {
      routeReads({});
      const service = await PrayerFeedbackService.getInstance();
      expect((await service.getFeedbackTypes([1, 77])).map((t) => t.id)).toEqual([1]);
    });
  });

  describe('isKnownFeedbackType', () => {
    it('is true for a real id and false for a bogus one', async () => {
      routeReads({});
      const service = await PrayerFeedbackService.getInstance();
      expect(await service.isKnownFeedbackType(3)).toBe(true);
      expect(await service.isKnownFeedbackType(77)).toBe(false);
    });

    it('reports the removal type as known — it is a real FK', async () => {
      // `isKnownFeedbackType` is the FK guard, not the policy guard. The default
      // list is where the removal type is withheld; pretending the id does not
      // exist would make an explicitly-configured form fail with the wrong code.
      routeReads({});
      const service = await PrayerFeedbackService.getInstance();
      expect(await service.isKnownFeedbackType(5)).toBe(true);
    });
  });

  // ── Identity ───────────────────────────────────────────────────────────────

  describe('findContact', () => {
    it('matches on last name AND (first OR nickname) AND email', async () => {
      routeReads({ contacts: () => [{ Contact_ID: 42 }] });
      const service = await PrayerFeedbackService.getInstance();

      expect(await service.findContact('Doug', 'Smith', 'doug@example.com')).toBe(42);
      expect(readArgs('Contacts').filter).toBe(
        "Contacts.Last_Name LIKE 'Smith' AND (Contacts.First_Name LIKE 'Doug' OR Contacts.Nickname LIKE 'Doug') AND Contacts.Email_Address LIKE 'doug@example.com'"
      );
    });

    it("escapes a quote rather than corrupting the filter", async () => {
      routeReads({ contacts: () => [] });
      const service = await PrayerFeedbackService.getInstance();

      await service.findContact("Sha'ron", "O'Brien", "o'brien@example.com");
      const filter = readArgs('Contacts').filter ?? '';
      expect(filter).toContain("Contacts.Last_Name LIKE 'O''Brien'");
      expect(filter).toContain("Contacts.Nickname LIKE 'Sha''ron'");
      expect(filter).toContain("LIKE 'o''brien@example.com'");
    });

    it('returns null without querying when a part is missing', async () => {
      routeReads({ contacts: () => [{ Contact_ID: 42 }] });
      const service = await PrayerFeedbackService.getInstance();

      expect(await service.findContact('Doug', '', 'doug@example.com')).toBeNull();
      expect(mockGetTableRecords).not.toHaveBeenCalled();
    });
  });

  describe('getContactIdByUserGuid', () => {
    it('resolves dp_Users to a contact id', async () => {
      routeReads({ users: [{ Contact_ID: 77 }] });
      const service = await PrayerFeedbackService.getInstance();
      expect(await service.getContactIdByUserGuid('a-guid')).toBe(77);
    });

    it('returns null for an unknown GUID', async () => {
      routeReads({ users: [] });
      const service = await PrayerFeedbackService.getInstance();
      expect(await service.getContactIdByUserGuid('a-guid')).toBeNull();
    });
  });

  describe('isInSameHousehold', () => {
    it('is true within one household', async () => {
      routeReads({
        contacts: (filter) => [
          { Contact_ID: 1, Household_ID: filter.includes('= 1') ? 10 : 10 },
        ],
      });
      const service = await PrayerFeedbackService.getInstance();
      expect(await service.isInSameHousehold(1, 2)).toBe(true);
    });

    it('is false across households', async () => {
      routeReads({
        contacts: (filter) => [{ Household_ID: filter.includes('= 1') ? 10 : 20 }],
      });
      const service = await PrayerFeedbackService.getInstance();
      expect(await service.isInSameHousehold(1, 2)).toBe(false);
    });

    it('is false when either contact has no household', async () => {
      // `null === null` must not read as "related": two contacts with no
      // household are strangers, and treating them as kin would let a
      // householdless account file against any other householdless contact.
      routeReads({
        contacts: (filter) => [{ Household_ID: filter.includes('= 1') ? null : 20 }],
      });
      const service = await PrayerFeedbackService.getInstance();
      expect(await service.isInSameHousehold(1, 2)).toBe(false);
    });

    it('needs no query when the target is the caller', async () => {
      routeReads({ contacts: () => [] });
      const service = await PrayerFeedbackService.getInstance();
      expect(await service.isInSameHousehold(7, 7)).toBe(true);
      expect(mockGetTableRecords).not.toHaveBeenCalled();
    });
  });

  describe('getSubmitterOptions', () => {
    it('returns self plus the household, without the caller repeated', async () => {
      routeReads({
        contacts: () => [
          {
            Contact_ID: 1,
            First_Name: 'Doug',
            Last_Name: 'Smith',
            Display_Name: 'Smith, Doug',
            Email_Address: 'doug@example.com',
            Household_ID: 10,
          },
        ],
      });
      mockGetMembers.mockResolvedValue([
        { contactId: 1, displayName: 'Smith, Doug', emailAddress: 'doug@example.com' },
        { contactId: 2, displayName: 'Smith, Marie', emailAddress: null },
      ]);

      const service = await PrayerFeedbackService.getInstance();
      const options = await service.getSubmitterOptions(1);

      expect(options.self).toEqual({
        contactId: 1,
        displayName: 'Smith, Doug',
        hasEmail: true,
      });
      expect(options.household).toEqual([
        { contactId: 2, displayName: 'Smith, Marie', hasEmail: false },
      ]);
    });

    it('reports hasEmail rather than the address itself', async () => {
      // The widget only needs a yes/no to decide whether to show the email
      // field; shipping a household's addresses to the browser to answer that
      // would be a disclosure the flow does not require.
      routeReads({
        contacts: () => [
          { Contact_ID: 1, Display_Name: 'Smith, Doug', Email_Address: null, Household_ID: 10 },
        ],
      });
      mockGetMembers.mockResolvedValue([]);

      const service = await PrayerFeedbackService.getInstance();
      const options = await service.getSubmitterOptions(1);

      expect(options.self.hasEmail).toBe(false);
      expect(JSON.stringify(options)).not.toContain('@');
    });

    it('skips the member query for a contact with no household', async () => {
      routeReads({
        contacts: () => [{ Contact_ID: 1, Display_Name: 'Smith, Doug', Household_ID: null }],
      });
      const service = await PrayerFeedbackService.getInstance();
      const options = await service.getSubmitterOptions(1);

      expect(options.household).toEqual([]);
      expect(mockGetMembers).not.toHaveBeenCalled();
    });
  });

  // ── The write ──────────────────────────────────────────────────────────────

  describe('createFeedbackEntry', () => {
    beforeEach(() => {
      routeReads({ contacts: () => [], lookups: LOOKUPS });
    });

    it('writes exactly the nine columns, with Approved and Ongoing_Need false', async () => {
      const service = await PrayerFeedbackService.getInstance();
      const result = await service.createFeedbackEntry({ ...BASE, programId: 12 });

      const entry = created('Feedback_Entries');
      expect(Object.keys(entry).sort()).toEqual([
        'Approved',
        'Contact_ID',
        'Date_Submitted',
        'Description',
        'Entry_Title',
        'Feedback_Type_ID',
        'Ongoing_Need',
        'Program_ID',
        'Visibility_Level_ID',
      ]);
      expect(entry.Approved).toBe(false);
      expect(entry.Ongoing_Need).toBe(false);
      expect(entry.Contact_ID).toBe(42);
      expect(entry.Entry_Title).toBe('Please pray for my family');
      expect(result).toMatchObject({
        feedbackEntryId: 555,
        contactId: 42,
        contactCreated: false,
      });
    });

    it('never writes a staff triage field', async () => {
      const service = await PrayerFeedbackService.getInstance();
      await service.createFeedbackEntry(BASE);

      const entry = created('Feedback_Entries');
      for (const column of ['Assigned_To', 'Care_Outcome_ID', 'Outcome_Date', 'Care_Case_ID']) {
        expect(entry).not.toHaveProperty(column);
      }
    });

    it('maps Private to Staff Only and everything else to Public', async () => {
      const service = await PrayerFeedbackService.getInstance();

      await service.createFeedbackEntry({ ...BASE, isPrivate: true });
      expect(created('Feedback_Entries').Visibility_Level_ID).toBe(2);

      mockCreateTableRecords.mockClear();
      await service.createFeedbackEntry({ ...BASE, isPrivate: false });
      expect(created('Feedback_Entries').Visibility_Level_ID).toBe(4);
    });

    it('omits Program_ID entirely when it is absent or not positive', async () => {
      const service = await PrayerFeedbackService.getInstance();

      for (const programId of [null, 0, -1]) {
        mockCreateTableRecords.mockClear();
        await service.createFeedbackEntry({ ...BASE, programId });
        expect(created('Feedback_Entries')).not.toHaveProperty('Program_ID');
      }
    });

    it('sends Date_Submitted as MP wall clock, not an ISO instant', async () => {
      // The regression guard for a reviewer "simplifying"
      // `DomainTimezoneService.toMpSqlDatetime` back to `.toISOString()`, which
      // shifts an evening submission into the next day in any negative-offset
      // zone — and so into the wrong day's prayer queue.
      const service = await PrayerFeedbackService.getInstance();
      await service.createFeedbackEntry(BASE);

      expect(mockToMpSqlDatetime).toHaveBeenCalledTimes(1);
      const submitted = created('Feedback_Entries').Date_Submitted as string;
      expect(submitted).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      expect(submitted).not.toContain('T');
      expect(submitted).not.toContain('Z');
    });

    it('keeps all 2000 description characters and caps the title at 50', async () => {
      const service = await PrayerFeedbackService.getInstance();
      await service.createFeedbackEntry({
        ...BASE,
        summary: 'S'.repeat(80),
        description: 'D'.repeat(2000),
      });

      const entry = created('Feedback_Entries');
      expect((entry.Description as string).length).toBe(2000);
      expect((entry.Entry_Title as string).length).toBe(50);
    });

    it('omits Description when there is none', async () => {
      const service = await PrayerFeedbackService.getInstance();
      await service.createFeedbackEntry({ ...BASE, description: null });
      expect(created('Feedback_Entries')).not.toHaveProperty('Description');
    });

    it('writes no Households or Contacts row when a contact id is supplied', async () => {
      const service = await PrayerFeedbackService.getInstance();
      await service.createFeedbackEntry(BASE);

      const tables = mockCreateTableRecords.mock.calls.map((c) => c[0]);
      expect(tables).toEqual(['Feedback_Entries']);
    });

    it('matches an existing contact rather than creating one', async () => {
      routeReads({ contacts: () => [{ Contact_ID: 314 }], lookups: LOOKUPS });
      const service = await PrayerFeedbackService.getInstance();

      const result = await service.createFeedbackEntry({ ...BASE, contactId: null });

      expect(result.contactId).toBe(314);
      expect(result.contactCreated).toBe(false);
      expect(mockCreateTableRecords.mock.calls.map((c) => c[0])).toEqual(['Feedback_Entries']);
    });

    it('creates Household then Contact then the entry when nothing matches', async () => {
      const service = await PrayerFeedbackService.getInstance();
      const result = await service.createFeedbackEntry({ ...BASE, contactId: null });

      expect(mockCreateTableRecords.mock.calls.map((c) => c[0])).toEqual([
        'Households',
        'Contacts',
        'Feedback_Entries',
      ]);
      expect(result).toMatchObject({
        feedbackEntryId: 555,
        contactId: 901,
        contactCreated: true,
      });
      expect(created('Feedback_Entries').Contact_ID).toBe(901);
    });

    it('writes Contact_Status_ID, never legacy’s non-existent Status column', async () => {
      // C83. Legacy's `ContactManager.CreateContact` writes `{"Status", …}` and
      // `Contacts` has no such column; the real one is `Contact_Status_ID`.
      const service = await PrayerFeedbackService.getInstance();
      await service.createFeedbackEntry({ ...BASE, contactId: null });

      const contact = created('Contacts');
      expect(contact).toHaveProperty('Contact_Status_ID', 1);
      expect(contact).not.toHaveProperty('Status');
    });

    it('gives the new contact a household position and the household a source', async () => {
      // Both are corrections to legacy, which sets neither — leaving the new
      // contact orphaned from household tooling and the household
      // indistinguishable from a staff-entered one.
      const service = await PrayerFeedbackService.getInstance();
      await service.createFeedbackEntry({ ...BASE, contactId: null });

      expect(created('Contacts')).toHaveProperty('Household_Position_ID', 1);
      expect(created('Households')).toHaveProperty('Household_Source_ID', 19);
    });

    it('omits Household_Source_ID on a domain that has no such value', async () => {
      routeReads({
        contacts: () => [],
        lookups: { ...LOOKUPS, Household_Sources: [] },
      });
      const service = await PrayerFeedbackService.getInstance();
      await service.createFeedbackEntry({ ...BASE, contactId: null });

      expect(created('Households')).not.toHaveProperty('Household_Source_ID');
    });

    it('names the new contact and household the way staff expect', async () => {
      const service = await PrayerFeedbackService.getInstance();
      await service.createFeedbackEntry({
        ...BASE,
        contactId: null,
        mobilePhone: '555-0100',
      });

      const contact = created('Contacts');
      expect(contact.Display_Name).toBe('Smith, Doug');
      expect(contact.Nickname).toBe('Doug');
      expect(contact.First_Name).toBe('Doug');
      expect(contact.Last_Name).toBe('Smith');
      expect(contact.Email_Address).toBe('doug@example.com');
      expect(contact.Mobile_Phone).toBe('555-0100');
      expect(contact.Company).toBe(false);
      expect(created('Households').Household_Name).toBe('Smith');
    });

    it('falls back to the email local part for a household with no surname', async () => {
      const service = await PrayerFeedbackService.getInstance();
      await service.createFeedbackEntry({ ...BASE, contactId: null, lastName: '' });
      expect(created('Households').Household_Name).toBe('doug');
    });

    it('throws when MP returns no entry id', async () => {
      mockCreateTableRecords.mockResolvedValue([]);
      const service = await PrayerFeedbackService.getInstance();
      await expect(service.createFeedbackEntry(BASE)).rejects.toThrow(
        'Failed to create feedback entry.'
      );
    });
  });

  // ── Email backfill ─────────────────────────────────────────────────────────

  describe('backfillContactEmail', () => {
    it('writes when the contact has no address on file', async () => {
      routeReads({ contacts: () => [{ Contact_ID: 42, Email_Address: null }] });
      const service = await PrayerFeedbackService.getInstance();

      await service.backfillContactEmail(42, 'doug@example.com');

      expect(mockUpdateTableRecords).toHaveBeenCalledWith('Contacts', [
        { Contact_ID: 42, Email_Address: 'doug@example.com' },
      ]);
    });

    it('leaves a populated address alone', async () => {
      // The named divergence from legacy, which overwrote unconditionally: a
      // typo in a public prayer form must not silently break a member's giving
      // statements and every other email MP sends them.
      routeReads({ contacts: () => [{ Contact_ID: 42, Email_Address: 'real@example.com' }] });
      const service = await PrayerFeedbackService.getInstance();

      await service.backfillContactEmail(42, 'typo@example.com');

      expect(mockUpdateTableRecords).not.toHaveBeenCalled();
    });

    it('treats whitespace as empty', async () => {
      routeReads({ contacts: () => [{ Contact_ID: 42, Email_Address: '   ' }] });
      const service = await PrayerFeedbackService.getInstance();

      await service.backfillContactEmail(42, 'doug@example.com');

      expect(mockUpdateTableRecords).toHaveBeenCalled();
    });

    it('never throws — the entry is already saved by the time it runs', async () => {
      routeReads({ contacts: () => [{ Contact_ID: 42, Email_Address: null }] });
      mockUpdateTableRecords.mockRejectedValue(new Error('MP is down'));
      const service = await PrayerFeedbackService.getInstance();

      await expect(service.backfillContactEmail(42, 'doug@example.com')).resolves.toBeUndefined();
    });
  });

  describe('getContactSummary', () => {
    it('returns the name and address', async () => {
      routeReads({
        contacts: () => [
          {
            Contact_ID: 42,
            First_Name: 'Doug',
            Last_Name: 'Smith',
            Display_Name: 'Smith, Doug',
            Email_Address: 'doug@example.com',
          },
        ],
      });
      const service = await PrayerFeedbackService.getInstance();

      expect(await service.getContactSummary(42)).toEqual({
        contactId: 42,
        firstName: 'Doug',
        lastName: 'Smith',
        displayName: 'Smith, Doug',
        email: 'doug@example.com',
      });
    });

    it('returns null for an unknown contact', async () => {
      routeReads({ contacts: () => [] });
      const service = await PrayerFeedbackService.getInstance();
      expect(await service.getContactSummary(42)).toBeNull();
    });
  });
});
