import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubscriptionService } from '@/services/subscriptionService';

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
        filter: '(Available_Online = 1 OR Available_Online IS NULL) AND (Congregation_ID = 1 OR Congregation_ID = 10)',
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

    it('should accept custom congregation IDs in the filter', async () => {
      mockGetTableRecords.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      const service = await SubscriptionService.getInstance();
      await service.getSubscriptions(100, [3, 7]);

      expect(mockGetTableRecords).toHaveBeenNthCalledWith(1, {
        table: 'dp_Publications',
        filter: '(Available_Online = 1 OR Available_Online IS NULL) AND (Congregation_ID = 3 OR Congregation_ID = 7)',
        select: 'Publication_ID,Title,Description,Online_Sort_Order',
      });
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

    it('should ignore subscribed IDs that are not valid publications for these congregations', async () => {
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
});
