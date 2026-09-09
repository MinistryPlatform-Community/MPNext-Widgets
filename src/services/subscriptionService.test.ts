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
});
