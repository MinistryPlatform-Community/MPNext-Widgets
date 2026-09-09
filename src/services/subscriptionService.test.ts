import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SubscriptionService,
  isContactGuid,
  maskEmailForDisplay,
} from '@/services/subscriptionService';

const mockGetTableRecords = vi.fn();
const mockCreateTableRecords = vi.fn();
const mockUpdateTableRecords = vi.fn();

vi.mock('@/lib/providers/ministry-platform', () => {
  return {
    MPHelper: class {
      getTableRecords = mockGetTableRecords;
      createTableRecords = mockCreateTableRecords;
      updateTableRecords = mockUpdateTableRecords;
    },
  };
});

describe('SubscriptionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (SubscriptionService as any).instance = undefined;
  });

  describe('getInstance', () => {
    it('should return a singleton instance', async () => {
      const instance1 = await SubscriptionService.getInstance();
      const instance2 = await SubscriptionService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('getContactIdByUserGuid', () => {
    const guid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

    it('should look up dp_Users by GUID and return Contact_ID', async () => {
      mockGetTableRecords.mockResolvedValueOnce([{ User_ID: 1, Contact_ID: 100 }]);

      const service = await SubscriptionService.getInstance();
      const result = await service.getContactIdByUserGuid(guid);

      expect(mockGetTableRecords).toHaveBeenCalledWith({
        table: 'dp_Users',
        filter: `User_GUID = '${guid}'`,
        select: 'User_ID,Contact_ID',
        top: 1,
      });
      expect(result).toBe(100);
    });

    it('should return null when no user is found', async () => {
      mockGetTableRecords.mockResolvedValueOnce([]);

      const service = await SubscriptionService.getInstance();
      const result = await service.getContactIdByUserGuid(guid);

      expect(result).toBeNull();
    });

    it('should propagate MPHelper errors', async () => {
      mockGetTableRecords.mockRejectedValueOnce(new Error('user lookup failed'));

      const service = await SubscriptionService.getInstance();
      await expect(service.getContactIdByUserGuid(guid)).rejects.toThrow('user lookup failed');
    });
  });

  describe('getSubscriptions', () => {
    it('should merge publications with the contact subscription state', async () => {
      mockGetTableRecords
        // dp_Publications
        .mockResolvedValueOnce([
          { Publication_ID: 1, Title: 'Weekly Newsletter', Description: 'Updates', Online_Sort_Order: 1 },
          { Publication_ID: 2, Title: 'Events Digest', Description: null, Online_Sort_Order: 2 },
          { Publication_ID: 3, Title: 'Devotional', Description: null, Online_Sort_Order: null },
        ])
        // dp_Contact_Publications
        .mockResolvedValueOnce([
          { Contact_Publication_ID: 50, Publication_ID: 1, Unsubscribed: false },
          { Contact_Publication_ID: 51, Publication_ID: 2, Unsubscribed: true },
        ]);

      const service = await SubscriptionService.getInstance();
      const items = await service.getSubscriptions(100);

      expect(mockGetTableRecords).toHaveBeenCalledTimes(2);
      expect(mockGetTableRecords).toHaveBeenNthCalledWith(1, {
        table: 'dp_Publications',
        filter: 'Available_Online = 1 OR Available_Online IS NULL',
        select: 'Publication_ID,Title,Description,Online_Sort_Order',
      });
      expect(mockGetTableRecords).toHaveBeenNthCalledWith(2, {
        table: 'dp_Contact_Publications',
        filter: 'Contact_ID = 100',
        select: 'Contact_Publication_ID,Publication_ID,Unsubscribed',
      });

      // Pub 1 has a record with Unsubscribed=false → subscribed
      // Pub 2 has a record with Unsubscribed=true → not subscribed
      // Pub 3 has no record → not subscribed
      expect(items).toEqual([
        { Publication_ID: 1, Title: 'Weekly Newsletter', Description: 'Updates', Online_Sort_Order: 1, subscribed: true },
        { Publication_ID: 2, Title: 'Events Digest', Description: null, Online_Sort_Order: 2, subscribed: false },
        { Publication_ID: 3, Title: 'Devotional', Description: null, Online_Sort_Order: null, subscribed: false },
      ]);
    });

    it('should sort by Online_Sort_Order (nulls last) then by Title', async () => {
      mockGetTableRecords
        .mockResolvedValueOnce([
          { Publication_ID: 1, Title: 'Zeta', Description: null, Online_Sort_Order: null },
          { Publication_ID: 2, Title: 'Alpha', Description: null, Online_Sort_Order: null },
          { Publication_ID: 3, Title: 'Middle', Description: null, Online_Sort_Order: 5 },
          { Publication_ID: 4, Title: 'First', Description: null, Online_Sort_Order: 1 },
        ])
        .mockResolvedValueOnce([]);

      const service = await SubscriptionService.getInstance();
      const items = await service.getSubscriptions(100);

      expect(items.map((i) => i.Title)).toEqual(['First', 'Middle', 'Alpha', 'Zeta']);
    });

    it('should return [] when there are no publications', async () => {
      mockGetTableRecords.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      const service = await SubscriptionService.getInstance();
      const items = await service.getSubscriptions(100);

      expect(items).toEqual([]);
    });

    it('should propagate errors from MPHelper', async () => {
      mockGetTableRecords.mockRejectedValueOnce(new Error('pub fetch failed'));

      const service = await SubscriptionService.getInstance();
      await expect(service.getSubscriptions(100)).rejects.toThrow('pub fetch failed');
    });
  });

  describe('updateSubscriptions', () => {
    it('should create new contact_publication rows for newly subscribed publications', async () => {
      mockGetTableRecords
        // Available publications
        .mockResolvedValueOnce([
          { Publication_ID: 1 },
          { Publication_ID: 2 },
        ])
        // Existing dp_Contact_Publications (none)
        .mockResolvedValueOnce([]);

      mockCreateTableRecords.mockResolvedValueOnce([]);

      const service = await SubscriptionService.getInstance();
      const result = await service.updateSubscriptions(100, [1]);

      expect(result).toEqual({ success: true });
      expect(mockUpdateTableRecords).not.toHaveBeenCalled();
      expect(mockCreateTableRecords).toHaveBeenCalledTimes(1);
      expect(mockCreateTableRecords).toHaveBeenCalledWith(
        'dp_Contact_Publications',
        [
          { Contact_ID: 100, Publication_ID: 1, Unsubscribed: false },
        ]
      );
    });

    it('should update existing records when the subscribed state changes', async () => {
      mockGetTableRecords
        .mockResolvedValueOnce([
          { Publication_ID: 1 },
          { Publication_ID: 2 },
        ])
        .mockResolvedValueOnce([
          // Currently subscribed (Unsubscribed=false), user wants to unsubscribe
          { Contact_Publication_ID: 50, Publication_ID: 1, Unsubscribed: false },
          // Currently unsubscribed (Unsubscribed=true), user wants to subscribe
          { Contact_Publication_ID: 51, Publication_ID: 2, Unsubscribed: true },
        ]);

      mockUpdateTableRecords.mockResolvedValueOnce([]);

      const service = await SubscriptionService.getInstance();
      const result = await service.updateSubscriptions(100, [2]);

      expect(result).toEqual({ success: true });
      expect(mockCreateTableRecords).not.toHaveBeenCalled();
      expect(mockUpdateTableRecords).toHaveBeenCalledTimes(1);
      const [table, rows] = mockUpdateTableRecords.mock.calls[0];
      expect(table).toBe('dp_Contact_Publications');
      expect(rows).toEqual(
        expect.arrayContaining([
          { Contact_Publication_ID: 50, Unsubscribed: true },
          { Contact_Publication_ID: 51, Unsubscribed: false },
        ])
      );
      expect(rows).toHaveLength(2);
    });

    it('should be a no-op when current state already matches desired state', async () => {
      mockGetTableRecords
        .mockResolvedValueOnce([{ Publication_ID: 1 }])
        .mockResolvedValueOnce([
          { Contact_Publication_ID: 50, Publication_ID: 1, Unsubscribed: false },
        ]);

      const service = await SubscriptionService.getInstance();
      const result = await service.updateSubscriptions(100, [1]);

      expect(result).toEqual({ success: true });
      expect(mockUpdateTableRecords).not.toHaveBeenCalled();
      expect(mockCreateTableRecords).not.toHaveBeenCalled();
    });

    it('should ignore subscribed IDs that are not valid publications', async () => {
      mockGetTableRecords
        .mockResolvedValueOnce([{ Publication_ID: 1 }])
        .mockResolvedValueOnce([]);

      const service = await SubscriptionService.getInstance();
      await service.updateSubscriptions(100, [999]); // 999 isn't in available pubs

      expect(mockCreateTableRecords).not.toHaveBeenCalled();
      expect(mockUpdateTableRecords).not.toHaveBeenCalled();
    });

    it('should return error result when MPHelper throws', async () => {
      mockGetTableRecords.mockRejectedValueOnce(new Error('db down'));

      const service = await SubscriptionService.getInstance();
      const result = await service.updateSubscriptions(100, [1]);

      expect(result.success).toBe(false);
      expect(result.error).toBe('db down');
    });
  });
  // ── Anonymous, capability-addressed unsubscribe (C72) ─────────────────────

  describe('isContactGuid', () => {
    it('accepts a canonical GUID in either case', () => {
      expect(isContactGuid('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(true);
      expect(isContactGuid('3F2504E0-4F89-41D3-9A0C-0305E82C3301')).toBe(true);
    });

    it('rejects anything that is not GUID-shaped', () => {
      // Each of these is a filter-injection attempt or a broken link, and both
      // must be stopped before the value reaches an MP $filter string.
      for (const value of [
        "' OR 1=1 --",
        "3f2504e0-4f89-41d3-9a0c-0305e82c3301' OR '1'='1",
        '3f2504e0-4f89-41d3-9a0c-0305e82c330', // one hex digit short
        '3f2504e04f8941d39a0c0305e82c3301', // no hyphens
        '{3f2504e0-4f89-41d3-9a0c-0305e82c3301}', // braced form
        '00000000-0000-0000-0000-000000000000', // the nil sentinel
        '',
        null,
        undefined,
        42,
        {},
      ]) {
        expect(isContactGuid(value), `${JSON.stringify(value)} must be rejected`).toBe(false);
      }
    });
  });

  describe('maskEmailForDisplay', () => {
    it('keeps one character of the local part, one of the domain, and the TLD', () => {
      expect(maskEmailForDisplay('john.doe@gmail.com')).toBe('j•••@g•••.com');
    });

    it('never contains the full local part or the full domain label', () => {
      const masked = maskEmailForDisplay('john.doe@gmail.com')!;
      expect(masked).not.toContain('john');
      expect(masked).not.toContain('ohn.doe');
      expect(masked).not.toContain('gmail');
    });

    it('handles a multi-label domain by keeping only the last label', () => {
      expect(maskEmailForDisplay('a@mail.example.co.uk')).toBe('a•••@m•••.uk');
    });

    it('handles a dotless domain', () => {
      expect(maskEmailForDisplay('a@localhost')).toBe('a•••@l•••');
    });

    it('returns null for anything that is not an address', () => {
      for (const value of [null, undefined, '', 'nope', '@gmail.com', 'john@']) {
        expect(maskEmailForDisplay(value)).toBeNull();
      }
    });
  });

  describe('getContactByContactGuid', () => {
    const guid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

    it('reads Contacts by Contact_GUID and returns id, address and bulk flag', async () => {
      mockGetTableRecords.mockResolvedValueOnce([
        { Contact_ID: 98, Email_Address: 'j@g.com', Bulk_Email_Opt_Out: true },
      ]);

      const service = await SubscriptionService.getInstance();
      const result = await service.getContactByContactGuid(guid);

      expect(mockGetTableRecords).toHaveBeenCalledWith({
        table: 'Contacts',
        filter: `Contact_GUID = '${guid}'`,
        select: 'Contact_ID,Email_Address,Bulk_Email_Opt_Out',
        top: 1,
      });
      expect(result).toEqual({ contactId: 98, email: 'j@g.com', bulkEmailOptOut: true });
    });

    it('returns null for a well-formed GUID with no contact', async () => {
      mockGetTableRecords.mockResolvedValueOnce([]);
      const service = await SubscriptionService.getInstance();
      expect(await service.getContactByContactGuid(guid)).toBeNull();
    });

    it('normalises a null Bulk_Email_Opt_Out to false', async () => {
      mockGetTableRecords.mockResolvedValueOnce([
        { Contact_ID: 98, Email_Address: null, Bulk_Email_Opt_Out: null },
      ]);
      const service = await SubscriptionService.getInstance();
      const result = await service.getContactByContactGuid(guid);
      expect(result).toEqual({ contactId: 98, email: null, bulkEmailOptOut: false });
    });

    it('throws on a malformed GUID before any MP call', async () => {
      const service = await SubscriptionService.getInstance();
      await expect(service.getContactByContactGuid("' OR 1=1 --")).rejects.toThrow(
        /malformed Contact_GUID/
      );
      expect(mockGetTableRecords).not.toHaveBeenCalled();
    });
  });

  describe('unsubscribeByContactGuid — per-publication path', () => {
    const guid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    const expectedFilter = `Contact_ID_TABLE.Contact_GUID = '${guid}' AND dp_Contact_Publications.Publication_ID = 4`;

    it('qualifies every base-table column, because the filter traverses _TABLE', async () => {
      mockGetTableRecords.mockResolvedValueOnce([
        { Contact_Publication_ID: 3, Unsubscribed: false, Email_Address: 'j@g.com' },
      ]);
      mockUpdateTableRecords.mockResolvedValueOnce([]);

      const service = await SubscriptionService.getInstance();
      await service.unsubscribeByContactGuid({ contactGuid: guid, publicationId: 4 });

      expect(mockGetTableRecords).toHaveBeenCalledWith({
        table: 'dp_Contact_Publications',
        filter: expectedFilter,
        select:
          'dp_Contact_Publications.Contact_Publication_ID,dp_Contact_Publications.Unsubscribed,Contact_ID_TABLE.Email_Address AS Email_Address',
      });
    });

    it('writes EVERY matching row, not just the first (legacy bug 1)', async () => {
      mockGetTableRecords.mockResolvedValueOnce([
        { Contact_Publication_ID: 3, Unsubscribed: false, Email_Address: 'j@g.com' },
        { Contact_Publication_ID: 9, Unsubscribed: false, Email_Address: 'j@g.com' },
        { Contact_Publication_ID: 11, Unsubscribed: false, Email_Address: 'j@g.com' },
      ]);
      mockUpdateTableRecords.mockResolvedValueOnce([]);

      const service = await SubscriptionService.getInstance();
      const outcome = await service.unsubscribeByContactGuid({
        contactGuid: guid,
        publicationId: 4,
      });

      expect(mockUpdateTableRecords).toHaveBeenCalledTimes(1);
      expect(mockUpdateTableRecords).toHaveBeenCalledWith('dp_Contact_Publications', [
        { Contact_Publication_ID: 3, Unsubscribed: true },
        { Contact_Publication_ID: 9, Unsubscribed: true },
        { Contact_Publication_ID: 11, Unsubscribed: true },
      ]);
      expect(outcome).toEqual({
        matched: true,
        emailMasked: 'j•••@g•••.com',
        wasAlreadyOptedOut: false,
        changed: 3,
      });
    });

    it('creates no row when the contact was never subscribed', async () => {
      mockGetTableRecords.mockResolvedValueOnce([]);

      const service = await SubscriptionService.getInstance();
      const outcome = await service.unsubscribeByContactGuid({
        contactGuid: guid,
        publicationId: 4,
      });

      expect(mockCreateTableRecords).not.toHaveBeenCalled();
      expect(mockUpdateTableRecords).not.toHaveBeenCalled();
      expect(outcome).toEqual({
        matched: false,
        emailMasked: null,
        wasAlreadyOptedOut: false,
        changed: 0,
      });
    });

    it('reports wasAlreadyOptedOut and writes nothing when every row is already true', async () => {
      mockGetTableRecords.mockResolvedValueOnce([
        { Contact_Publication_ID: 3, Unsubscribed: true, Email_Address: 'j@g.com' },
      ]);

      const service = await SubscriptionService.getInstance();
      const outcome = await service.unsubscribeByContactGuid({
        contactGuid: guid,
        publicationId: 4,
      });

      expect(mockUpdateTableRecords).not.toHaveBeenCalled();
      expect(outcome.matched).toBe(true);
      expect(outcome.wasAlreadyOptedOut).toBe(true);
      expect(outcome.changed).toBe(0);
    });

    it('does not report wasAlreadyOptedOut when only some rows were opted out', async () => {
      mockGetTableRecords.mockResolvedValueOnce([
        { Contact_Publication_ID: 3, Unsubscribed: true, Email_Address: 'j@g.com' },
        { Contact_Publication_ID: 9, Unsubscribed: false, Email_Address: 'j@g.com' },
      ]);
      mockUpdateTableRecords.mockResolvedValueOnce([]);

      const service = await SubscriptionService.getInstance();
      const outcome = await service.unsubscribeByContactGuid({
        contactGuid: guid,
        publicationId: 4,
      });

      expect(outcome.wasAlreadyOptedOut).toBe(false);
      expect(mockUpdateTableRecords).toHaveBeenCalledWith('dp_Contact_Publications', [
        { Contact_Publication_ID: 9, Unsubscribed: true },
      ]);
    });

    it('never returns the unmasked address', async () => {
      mockGetTableRecords.mockResolvedValueOnce([
        { Contact_Publication_ID: 3, Unsubscribed: false, Email_Address: 'john.doe@gmail.com' },
      ]);
      mockUpdateTableRecords.mockResolvedValueOnce([]);

      const service = await SubscriptionService.getInstance();
      const outcome = await service.unsubscribeByContactGuid({
        contactGuid: guid,
        publicationId: 4,
      });

      expect(outcome.emailMasked).toBe('j•••@g•••.com');
      expect(JSON.stringify(outcome)).not.toContain('john.doe');
    });
  });

  describe('unsubscribeByContactGuid — bulk path', () => {
    const guid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

    it.each([[undefined], [null], [0]])(
      'treats publicationId %s as the bulk-email path',
      async (publicationId) => {
        mockGetTableRecords.mockResolvedValueOnce([
          { Contact_ID: 98, Email_Address: 'j@g.com', Bulk_Email_Opt_Out: false },
        ]);
        mockUpdateTableRecords.mockResolvedValueOnce([]);

        const service = await SubscriptionService.getInstance();
        await service.unsubscribeByContactGuid({
          contactGuid: guid,
          publicationId: publicationId as number | null | undefined,
        });

        expect(mockGetTableRecords).toHaveBeenCalledWith(
          expect.objectContaining({ table: 'Contacts' })
        );
        expect(mockUpdateTableRecords).toHaveBeenCalledWith('Contacts', [
          { Contact_ID: 98, Bulk_Email_Opt_Out: true },
        ]);
      }
    );

    it('writes only Contact_ID and Bulk_Email_Opt_Out — never a whole record', async () => {
      mockGetTableRecords.mockResolvedValueOnce([
        {
          Contact_ID: 98,
          Email_Address: 'j@g.com',
          Bulk_Email_Opt_Out: false,
        },
      ]);
      mockUpdateTableRecords.mockResolvedValueOnce([]);

      const service = await SubscriptionService.getInstance();
      await service.unsubscribeByContactGuid({ contactGuid: guid });

      const [, rows] = mockUpdateTableRecords.mock.calls[0];
      expect(Object.keys(rows[0]).sort()).toEqual(['Bulk_Email_Opt_Out', 'Contact_ID']);
    });

    it('is a no-op write when the contact is already opted out', async () => {
      mockGetTableRecords.mockResolvedValueOnce([
        { Contact_ID: 98, Email_Address: 'j@g.com', Bulk_Email_Opt_Out: true },
      ]);

      const service = await SubscriptionService.getInstance();
      const outcome = await service.unsubscribeByContactGuid({ contactGuid: guid });

      expect(mockUpdateTableRecords).not.toHaveBeenCalled();
      expect(outcome).toEqual({
        matched: true,
        emailMasked: 'j•••@g•••.com',
        wasAlreadyOptedOut: true,
        changed: 0,
      });
    });

    it('unknown GUID → matched false, zero writes, no address', async () => {
      mockGetTableRecords.mockResolvedValueOnce([]);

      const service = await SubscriptionService.getInstance();
      const outcome = await service.unsubscribeByContactGuid({ contactGuid: guid });

      expect(mockUpdateTableRecords).not.toHaveBeenCalled();
      expect(mockCreateTableRecords).not.toHaveBeenCalled();
      expect(outcome).toEqual({
        matched: false,
        emailMasked: null,
        wasAlreadyOptedOut: false,
        changed: 0,
      });
    });

    it('performs its one MP read even for an unknown GUID', async () => {
      // The unknown path must not short-circuit ahead of the read, or it becomes
      // measurably faster than the known one.
      mockGetTableRecords.mockResolvedValueOnce([]);
      const service = await SubscriptionService.getInstance();
      await service.unsubscribeByContactGuid({ contactGuid: guid });
      expect(mockGetTableRecords).toHaveBeenCalledTimes(1);
    });

    it('throws on a malformed GUID before any MP call', async () => {
      const service = await SubscriptionService.getInstance();
      await expect(
        service.unsubscribeByContactGuid({ contactGuid: 'not-a-guid' })
      ).rejects.toThrow(/malformed Contact_GUID/);
      expect(mockGetTableRecords).not.toHaveBeenCalled();
    });
  });

  describe('resubscribeByContactGuid', () => {
    const guid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

    it('only ever writes false on the publication path, across every matching row', async () => {
      mockGetTableRecords.mockResolvedValueOnce([
        { Contact_Publication_ID: 3, Unsubscribed: true, Email_Address: 'j@g.com' },
        { Contact_Publication_ID: 9, Unsubscribed: true, Email_Address: 'j@g.com' },
      ]);
      mockUpdateTableRecords.mockResolvedValueOnce([]);

      const service = await SubscriptionService.getInstance();
      await service.resubscribeByContactGuid({ contactGuid: guid, publicationId: 4 });

      expect(mockUpdateTableRecords).toHaveBeenCalledWith('dp_Contact_Publications', [
        { Contact_Publication_ID: 3, Unsubscribed: false },
        { Contact_Publication_ID: 9, Unsubscribed: false },
      ]);
    });

    it('only ever writes false on the bulk path', async () => {
      mockGetTableRecords.mockResolvedValueOnce([
        { Contact_ID: 98, Email_Address: 'j@g.com', Bulk_Email_Opt_Out: true },
      ]);
      mockUpdateTableRecords.mockResolvedValueOnce([]);

      const service = await SubscriptionService.getInstance();
      await service.resubscribeByContactGuid({ contactGuid: guid });

      expect(mockUpdateTableRecords).toHaveBeenCalledWith('Contacts', [
        { Contact_ID: 98, Bulk_Email_Opt_Out: false },
      ]);
    });

    it('creates no row when the contact has no subscription record', async () => {
      mockGetTableRecords.mockResolvedValueOnce([]);

      const service = await SubscriptionService.getInstance();
      const outcome = await service.resubscribeByContactGuid({
        contactGuid: guid,
        publicationId: 4,
      });

      expect(mockCreateTableRecords).not.toHaveBeenCalled();
      expect(outcome.matched).toBe(false);
    });

    it('propagates an MP write failure so the route can answer save_failed', async () => {
      mockGetTableRecords.mockResolvedValueOnce([
        { Contact_ID: 98, Email_Address: 'j@g.com', Bulk_Email_Opt_Out: false },
      ]);
      mockUpdateTableRecords.mockRejectedValueOnce(new Error('MP write rejected'));

      const service = await SubscriptionService.getInstance();
      await expect(
        service.unsubscribeByContactGuid({ contactGuid: guid })
      ).rejects.toThrow('MP write rejected');
    });
  });
  // ── Anonymous, email-verified opt-in (C70) ────────────────────────────────

  describe('getOnlinePublication', () => {
    it('requires Available_Online = 1 strictly', async () => {
      // No `OR Available_Online IS NULL`, and deliberately unlike
      // `getSubscriptions` in the same file: this one puts a stranger onto a
      // mailing list, so an unset flag must not read as consent to publish.
      mockGetTableRecords.mockResolvedValueOnce([
        { Publication_ID: 4, Title: 'Weekly Newsletter', Description: 'News', Congregation_ID: 7 },
      ]);

      const service = await SubscriptionService.getInstance();
      const publication = await service.getOnlinePublication(4);

      expect(mockGetTableRecords).toHaveBeenCalledWith({
        table: 'dp_Publications',
        filter: 'Publication_ID = 4 AND Available_Online = 1',
        select: 'Publication_ID,Title,Description,Congregation_ID',
        top: 1,
      });
      expect(publication).toEqual({
        Publication_ID: 4,
        Title: 'Weekly Newsletter',
        Description: 'News',
        Congregation_ID: 7,
      });
    });

    it('does not include the IS NULL clause getSubscriptions uses', async () => {
      mockGetTableRecords.mockResolvedValueOnce([]);
      const service = await SubscriptionService.getInstance();
      await service.getOnlinePublication(4);
      expect(mockGetTableRecords.mock.calls[0][0].filter).not.toContain('IS NULL');
    });

    it('returns null for a publication that is not online and for one that does not exist', async () => {
      // The same answer for both, so the id space cannot be probed for internal
      // publications. MP returns no row in either case because the flag is in
      // the filter.
      mockGetTableRecords.mockResolvedValue([]);
      const service = await SubscriptionService.getInstance();
      expect(await service.getOnlinePublication(1)).toBeNull();
      expect(await service.getOnlinePublication(9999)).toBeNull();
    });

    it('rejects a non-positive or non-integer id without touching MP', async () => {
      const service = await SubscriptionService.getInstance();
      for (const id of [0, -4, 1.5, Number.NaN]) {
        expect(await service.getOnlinePublication(id)).toBeNull();
      }
      expect(mockGetTableRecords).not.toHaveBeenCalled();
    });

    it('coerces MP string scalars and normalises a blank description to null', async () => {
      mockGetTableRecords.mockResolvedValueOnce([
        { Publication_ID: '4', Title: 'Weekly', Description: '   ', Congregation_ID: null },
      ]);
      const service = await SubscriptionService.getInstance();
      expect(await service.getOnlinePublication(4)).toEqual({
        Publication_ID: 4,
        Title: 'Weekly',
        Description: null,
        Congregation_ID: null,
      });
    });
  });

  describe('findContactIdByEmail', () => {
    it('matches on the address alone, excluding companies and the deceased', async () => {
      // Legacy required first name, last name *and* address to agree, so
      // "Bob Smith" signing up when MP holds "Robert Smith" at the same address
      // created a duplicate. A subscription is keyed to a mailbox.
      mockGetTableRecords.mockResolvedValueOnce([{ Contact_ID: 42 }]);

      const service = await SubscriptionService.getInstance();
      const id = await service.findContactIdByEmail('ada@example.com');

      expect(mockGetTableRecords).toHaveBeenCalledWith({
        table: 'Contacts',
        filter: "Email_Address = 'ada@example.com' AND Company = 0 AND Contact_Status_ID <> 3",
        select: 'Contact_ID',
        orderBy: 'Contact_ID',
        top: 1,
      });
      expect(id).toBe(42);
    });

    it('escapes a quote in the address rather than interpolating it raw', async () => {
      mockGetTableRecords.mockResolvedValueOnce([]);
      const service = await SubscriptionService.getInstance();
      await service.findContactIdByEmail("o'brien@example.com");
      expect(mockGetTableRecords.mock.calls[0][0].filter).toContain(
        "Email_Address = 'o''brien@example.com'"
      );
    });

    it('returns null for no match and for a blank address', async () => {
      mockGetTableRecords.mockResolvedValueOnce([]);
      const service = await SubscriptionService.getInstance();
      expect(await service.findContactIdByEmail('nobody@example.com')).toBeNull();
      expect(await service.findContactIdByEmail('   ')).toBeNull();
      expect(mockGetTableRecords).toHaveBeenCalledTimes(1);
    });
  });

  describe('subscribeEmailToPublication', () => {
    const PUBLICATION_ID = 4;

    /**
     * Route every read by table, rather than by call order.
     *
     * The create path makes seven MP calls across five tables, and a
     * `mockResolvedValueOnce` chain over that is unreadable and breaks on any
     * reordering — which would then look like a behaviour change.
     */
    function routeReads(overrides: {
      contacts?: unknown[];
      contactStatus?: unknown[];
      householdPosition?: unknown[];
      householdSource?: unknown[];
      publication?: unknown[];
      contactPublications?: unknown[];
    }) {
      mockGetTableRecords.mockImplementation(async (args: { table: string }) => {
        switch (args.table) {
          case 'Contacts':
            return overrides.contacts ?? [];
          case 'Contact_Statuses':
            return overrides.contactStatus ?? [{ Id: 1 }];
          case 'Household_Positions':
            return overrides.householdPosition ?? [{ Id: 1 }];
          case 'Household_Sources':
            return overrides.householdSource ?? [{ Id: 19 }];
          case 'dp_Publications':
            return (
              overrides.publication ?? [
                {
                  Publication_ID: PUBLICATION_ID,
                  Title: 'Weekly Newsletter',
                  Description: null,
                  Congregation_ID: 7,
                },
              ]
            );
          case 'dp_Contact_Publications':
            return overrides.contactPublications ?? [];
          default:
            throw new Error(`unexpected read of ${args.table}`);
        }
      });
      mockCreateTableRecords.mockImplementation(async (table: string) => {
        if (table === 'Contacts') return [{ Contact_ID: 501 }];
        if (table === 'Households') return [{ Household_ID: 601 }];
        return [{}];
      });
    }

    /** Every record passed to `createTableRecords` for one table. */
    function created(table: string): Record<string, unknown>[] {
      return mockCreateTableRecords.mock.calls
        .filter((call: unknown[]) => call[0] === table)
        .flatMap((call: unknown[]) => call[1] as Record<string, unknown>[]);
    }

    /** Every record passed to `updateTableRecords` for one table. */
    function updated(table: string): Record<string, unknown>[] {
      return mockUpdateTableRecords.mock.calls
        .filter((call: unknown[]) => call[0] === table)
        .flatMap((call: unknown[]) => call[1] as Record<string, unknown>[]);
    }

    const args = {
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      publicationId: PUBLICATION_ID,
    };

    it('creates the contact, the household, the association and the link', async () => {
      routeReads({});

      const service = await SubscriptionService.getInstance();
      const result = await service.subscribeEmailToPublication(args);

      expect(created('Contacts')).toEqual([
        {
          Company: false,
          Display_Name: 'Lovelace, Ada',
          First_Name: 'Ada',
          Last_Name: 'Lovelace',
          Nickname: 'Ada',
          Email_Address: 'ada@example.com',
          Contact_Status_ID: 1,
          Household_Position_ID: 1,
          Bulk_Email_Opt_Out: false,
          // The double opt-in is the evidence this column exists to record,
          // and legacy leaves it at its default.
          Email_Verified: true,
        },
      ]);
      expect(created('Households')).toEqual([
        {
          Household_Name: 'Lovelace',
          Bulk_Mail_Opt_Out: false,
          Household_Source_ID: 19,
          Congregation_ID: 7,
        },
      ]);
      expect(updated('Contacts')).toEqual([{ Contact_ID: 501, Household_ID: 601 }]);
      expect(created('dp_Contact_Publications')).toEqual([
        { Contact_ID: 501, Publication_ID: PUBLICATION_ID, Unsubscribed: false },
      ]);
      expect(result).toEqual({
        contactId: 501,
        contactCreated: true,
        alreadySubscribed: false,
      });
    });

    it('writes Contact_Status_ID, and no column named Status', async () => {
      // Legacy's `ContactManager.CreateContact` writes `Status`, and `Contacts`
      // has no such column (C83). It has stayed invisible because the underlying
      // default happens to be Active.
      routeReads({});
      const service = await SubscriptionService.getInstance();
      await service.subscribeEmailToPublication(args);

      const record = created('Contacts')[0];
      expect(record).toHaveProperty('Contact_Status_ID', 1);
      expect(record).not.toHaveProperty('Status');
    });

    it('writes no mobile phone and no underscore-prefixed column', async () => {
      routeReads({});
      const service = await SubscriptionService.getInstance();
      await service.subscribeEmailToPublication(args);

      for (const record of [...created('Contacts'), ...created('dp_Contact_Publications')]) {
        for (const key of Object.keys(record)) {
          // Underscore-prefixed columns are MP-managed — the MailChimp sync owns
          // `_Synced_List_Name` and `_Unsubscribe_Sync_Pending`.
          expect(key.startsWith('_')).toBe(false);
        }
      }
      expect(created('Contacts')[0]).not.toHaveProperty('Mobile_Phone');
      expect(created('Contacts')[0]).not.toHaveProperty('Texting_Opt_In_Type_ID');
    });

    it('never writes Contacts.Email_Address for an existing contact', async () => {
      // The D1 regression guard. Legacy's `UpdateContactEmail` on this
      // anonymous flow let a caller set any contact's address to one they
      // controlled — a password-reset takeover on an email-identified IdP.
      // "Restore parity" is the obvious way to reintroduce it.
      routeReads({ contacts: [{ Contact_ID: 42 }] });

      const service = await SubscriptionService.getInstance();
      await service.subscribeEmailToPublication({ ...args, email: 'ATTACKER@evil.example' });

      for (const record of updated('Contacts')) {
        expect(record).not.toHaveProperty('Email_Address');
      }
      expect(mockUpdateTableRecords).not.toHaveBeenCalledWith(
        'Contacts',
        expect.arrayContaining([expect.objectContaining({ Email_Address: expect.anything() })])
      );
    });

    it('creates nothing but the link when the address already has a contact', async () => {
      routeReads({ contacts: [{ Contact_ID: 42 }] });

      const service = await SubscriptionService.getInstance();
      const result = await service.subscribeEmailToPublication(args);

      expect(created('Contacts')).toEqual([]);
      expect(created('Households')).toEqual([]);
      expect(created('dp_Contact_Publications')).toEqual([
        { Contact_ID: 42, Publication_ID: PUBLICATION_ID, Unsubscribed: false },
      ]);
      expect(result).toEqual({
        contactId: 42,
        contactCreated: false,
        alreadySubscribed: false,
      });
    });

    it('lower-cases the address before resolving and writing it', async () => {
      routeReads({});
      const service = await SubscriptionService.getInstance();
      await service.subscribeEmailToPublication({ ...args, email: '  Ada@Example.COM ' });

      const reads = mockGetTableRecords.mock.calls
        .map((call: unknown[]) => call[0] as { table: string; filter: string })
        .filter((arg: { table: string }) => arg.table === 'Contacts');
      expect(reads[0].filter).toContain("Email_Address = 'ada@example.com'");
      expect(created('Contacts')[0].Email_Address).toBe('ada@example.com');
    });

    it('updates an unsubscribed row rather than creating a second one', async () => {
      routeReads({
        contacts: [{ Contact_ID: 42 }],
        contactPublications: [
          { Contact_Publication_ID: 900, Publication_ID: PUBLICATION_ID, Unsubscribed: true },
        ],
      });

      const service = await SubscriptionService.getInstance();
      const result = await service.subscribeEmailToPublication(args);

      expect(created('dp_Contact_Publications')).toEqual([]);
      expect(updated('dp_Contact_Publications')).toEqual([
        { Contact_Publication_ID: 900, Unsubscribed: false },
      ]);
      expect(result.alreadySubscribed).toBe(false);
    });

    it('updates every duplicate of the (contact, publication) pair', async () => {
      // Duplicates of that pair occur in the field, and C72 found legacy's
      // opt-out touched only the first one.
      routeReads({
        contacts: [{ Contact_ID: 42 }],
        contactPublications: [
          { Contact_Publication_ID: 900, Publication_ID: PUBLICATION_ID, Unsubscribed: true },
          { Contact_Publication_ID: 901, Publication_ID: PUBLICATION_ID, Unsubscribed: true },
        ],
      });

      const service = await SubscriptionService.getInstance();
      await service.subscribeEmailToPublication(args);

      expect(updated('dp_Contact_Publications')).toEqual([
        { Contact_Publication_ID: 900, Unsubscribed: false },
        { Contact_Publication_ID: 901, Unsubscribed: false },
      ]);
    });

    it('writes nothing at all when the contact is already subscribed', async () => {
      routeReads({
        contacts: [{ Contact_ID: 42 }],
        contactPublications: [
          { Contact_Publication_ID: 900, Publication_ID: PUBLICATION_ID, Unsubscribed: false },
        ],
      });

      const service = await SubscriptionService.getInstance();
      const result = await service.subscribeEmailToPublication(args);

      expect(mockCreateTableRecords).not.toHaveBeenCalled();
      expect(mockUpdateTableRecords).not.toHaveBeenCalled();
      expect(result.alreadySubscribed).toBe(true);
    });

    it('omits Congregation_ID when the publication has none', async () => {
      routeReads({
        publication: [
          {
            Publication_ID: PUBLICATION_ID,
            Title: 'Weekly Newsletter',
            Description: null,
            Congregation_ID: null,
          },
        ],
      });

      const service = await SubscriptionService.getInstance();
      await service.subscribeEmailToPublication(args);

      expect(created('Households')[0]).not.toHaveProperty('Congregation_ID');
    });

    it("omits Household_Source_ID when 'Website' does not resolve", async () => {
      // A domain missing the lookup row gets no source rather than being asked
      // to add one before the widget works.
      routeReads({ householdSource: [] });

      const service = await SubscriptionService.getInstance();
      await service.subscribeEmailToPublication(args);

      expect(created('Households')[0]).not.toHaveProperty('Household_Source_ID');
      expect(created('Households')[0]).toHaveProperty('Household_Name', 'Lovelace');
    });

    it('falls back to a household name when the form gave no surname', async () => {
      routeReads({});
      const service = await SubscriptionService.getInstance();
      await service.subscribeEmailToPublication({ ...args, lastName: '   ' });

      expect(created('Households')[0].Household_Name).toBe('Subscriber');
    });

    it('creates no Contacts row when a required lookup id does not resolve', async () => {
      // Better than inserting a null into a required column and letting MP
      // reject the batch with its own error text.
      routeReads({ contactStatus: [] });

      const service = await SubscriptionService.getInstance();
      await expect(service.subscribeEmailToPublication(args)).rejects.toThrow(
        /lookup did not resolve/
      );
      expect(mockCreateTableRecords).not.toHaveBeenCalled();
    });

    it('refuses a blank address without touching MP', async () => {
      routeReads({});
      const service = await SubscriptionService.getInstance();
      await expect(
        service.subscribeEmailToPublication({ ...args, email: '  ' })
      ).rejects.toThrow(/email is required/);
      expect(mockGetTableRecords).not.toHaveBeenCalled();
    });

    it('touches no Participants, Addresses or Feedback table', async () => {
      // A newsletter subscriber is not a participant, and legacy agrees. Noted
      // so nobody adds one by analogy with Plan Your Visit.
      routeReads({});
      const service = await SubscriptionService.getInstance();
      await service.subscribeEmailToPublication(args);

      const tables = [
        ...mockCreateTableRecords.mock.calls.map((call: unknown[]) => call[0]),
        ...mockUpdateTableRecords.mock.calls.map((call: unknown[]) => call[0]),
      ];
      expect(tables).toEqual(['Contacts', 'Households', 'dp_Contact_Publications', 'Contacts']);
      expect(tables).not.toContain('Participants');
      expect(tables).not.toContain('Addresses');
      expect(tables).not.toContain('Participant_Milestones');
    });

    it('propagates an MP write failure so the route can answer save_failed', async () => {
      routeReads({ contacts: [{ Contact_ID: 42 }] });
      mockCreateTableRecords.mockRejectedValueOnce(new Error('MP write rejected'));

      const service = await SubscriptionService.getInstance();
      await expect(service.subscribeEmailToPublication(args)).rejects.toThrow(
        'MP write rejected'
      );
    });
  });
});
