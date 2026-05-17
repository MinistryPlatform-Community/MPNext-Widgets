import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserService } from '@/services/userService';

const mockGetTableRecords = vi.fn();

vi.mock('@/lib/providers/ministry-platform', () => {
  return {
    MPHelper: class {
      getTableRecords = mockGetTableRecords;
    },
  };
});

describe('UserService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (UserService as any).instance = undefined;
  });

  describe('getInstance', () => {
    it('should return a singleton instance', async () => {
      const instance1 = await UserService.getInstance();
      const instance2 = await UserService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('getUserProfile', () => {
    const validGuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

    it('should fetch user profile by GUID using Contact_ID_TABLE select', async () => {
      const mockProfile = {
        User_ID: 1,
        User_GUID: validGuid,
        Contact_ID: 100,
        First_Name: 'John',
        Nickname: 'Johnny',
        Last_Name: 'Doe',
        Email_Address: 'john@example.com',
        Mobile_Phone: '555-1234',
        Image_GUID: 'img-guid-456',
      };
      mockGetTableRecords.mockResolvedValueOnce([mockProfile]);

      const service = await UserService.getInstance();
      const result = await service.getUserProfile(validGuid);

      expect(mockGetTableRecords).toHaveBeenCalledTimes(1);
      expect(mockGetTableRecords).toHaveBeenCalledWith({
        table: 'dp_Users',
        filter: `User_GUID = '${validGuid}'`,
        select: expect.stringContaining('Contact_ID_TABLE.First_Name'),
        top: 1,
      });
      expect(result).toEqual(mockProfile);
    });

    it('should request only the top 1 record', async () => {
      mockGetTableRecords.mockResolvedValueOnce([{ User_ID: 5 }]);

      const service = await UserService.getInstance();
      await service.getUserProfile(validGuid);

      const callArgs = mockGetTableRecords.mock.calls[0][0];
      expect(callArgs.top).toBe(1);
    });

    it('should embed the GUID inside single quotes in the filter', async () => {
      mockGetTableRecords.mockResolvedValueOnce([{ User_ID: 1 }]);

      const service = await UserService.getInstance();
      await service.getUserProfile(validGuid);

      const callArgs = mockGetTableRecords.mock.calls[0][0];
      expect(callArgs.filter).toBe(`User_GUID = '${validGuid}'`);
    });

    it('should return undefined when no records match', async () => {
      mockGetTableRecords.mockResolvedValueOnce([]);

      const service = await UserService.getInstance();
      const result = await service.getUserProfile(validGuid);

      expect(result).toBeUndefined();
    });

    it('should propagate errors from MPHelper', async () => {
      mockGetTableRecords.mockRejectedValueOnce(new Error('API error'));

      const service = await UserService.getInstance();
      await expect(service.getUserProfile(validGuid)).rejects.toThrow('API error');
    });
  });
});
