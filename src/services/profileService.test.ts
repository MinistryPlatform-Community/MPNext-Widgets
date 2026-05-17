import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProfileService } from '@/services/profileService';

const mockGetTableRecords = vi.fn();
const mockUpdateTableRecords = vi.fn();
const mockGetFilesByRecord = vi.fn();
const mockUpdateFile = vi.fn();
const mockUploadFiles = vi.fn();
const mockGetFileContentByUniqueId = vi.fn();

vi.mock('@/lib/providers/ministry-platform', () => {
  return {
    MPHelper: class {
      getTableRecords = mockGetTableRecords;
      updateTableRecords = mockUpdateTableRecords;
      getFilesByRecord = mockGetFilesByRecord;
      updateFile = mockUpdateFile;
      uploadFiles = mockUploadFiles;
      getFileContentByUniqueId = mockGetFileContentByUniqueId;
    },
  };
});

describe('ProfileService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ProfileService as any).instance = undefined;
  });

  describe('getInstance', () => {
    it('should return a singleton instance', async () => {
      const instance1 = await ProfileService.getInstance();
      const instance2 = await ProfileService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('getProfileByUserGuid', () => {
    const guid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

    it('should resolve User_GUID → Contact_ID then fetch the contact record', async () => {
      mockGetTableRecords
        .mockResolvedValueOnce([{ User_ID: 1, Contact_ID: 100 }])
        .mockResolvedValueOnce([
          {
            Contact_ID: 100,
            Contact_GUID: 'c-guid',
            First_Name: 'Jane',
            Last_Name: 'Smith',
            Email_Address: 'jane@example.com',
          },
        ]);

      const service = await ProfileService.getInstance();
      const result = await service.getProfileByUserGuid(guid);

      expect(mockGetTableRecords).toHaveBeenCalledTimes(2);
      expect(mockGetTableRecords).toHaveBeenNthCalledWith(1, {
        table: 'dp_Users',
        filter: `User_GUID = '${guid}'`,
        select: 'User_ID,Contact_ID',
        top: 1,
      });
      expect(mockGetTableRecords).toHaveBeenNthCalledWith(2, {
        table: 'Contacts',
        filter: 'Contact_ID = 100',
        select: expect.stringContaining('Contact_ID,Contact_GUID'),
        top: 1,
      });
      expect(result).toMatchObject({
        Contact_ID: 100,
        First_Name: 'Jane',
        Prefix: null,
        Suffix: null,
        Gender: null,
        Marital_Status: null,
      });
    });

    it('should return null when no dp_Users record matches', async () => {
      mockGetTableRecords.mockResolvedValueOnce([]);

      const service = await ProfileService.getInstance();
      const result = await service.getProfileByUserGuid(guid);

      expect(result).toBeNull();
      expect(mockGetTableRecords).toHaveBeenCalledTimes(1);
    });

    it('should return null when contact record is missing', async () => {
      mockGetTableRecords
        .mockResolvedValueOnce([{ User_ID: 1, Contact_ID: 100 }])
        .mockResolvedValueOnce([]);

      const service = await ProfileService.getInstance();
      const result = await service.getProfileByUserGuid(guid);

      expect(result).toBeNull();
    });

    it('should propagate MPHelper errors', async () => {
      mockGetTableRecords.mockRejectedValueOnce(new Error('mp error'));

      const service = await ProfileService.getInstance();
      await expect(service.getProfileByUserGuid(guid)).rejects.toThrow('mp error');
    });
  });

  describe('getLookups', () => {
    it('should fetch all four lookup tables in parallel and shape into LookupOption arrays', async () => {
      mockGetTableRecords
        .mockResolvedValueOnce([{ Prefix_ID: 1, Prefix: 'Mr.' }])
        .mockResolvedValueOnce([{ Suffix_ID: 1, Suffix: 'Jr.' }])
        .mockResolvedValueOnce([{ Gender_ID: 1, Gender: 'Male' }])
        .mockResolvedValueOnce([{ Marital_Status_ID: 1, Marital_Status: 'Married' }]);

      const service = await ProfileService.getInstance();
      const result = await service.getLookups();

      expect(mockGetTableRecords).toHaveBeenCalledTimes(4);
      expect(result).toEqual({
        prefixes: [{ id: 1, label: 'Mr.' }],
        suffixes: [{ id: 1, label: 'Jr.' }],
        genders: [{ id: 1, label: 'Male' }],
        maritalStatuses: [{ id: 1, label: 'Married' }],
      });
    });

    it('should cache lookups across calls', async () => {
      mockGetTableRecords
        .mockResolvedValueOnce([{ Prefix_ID: 1, Prefix: 'Mr.' }])
        .mockResolvedValueOnce([{ Suffix_ID: 1, Suffix: 'Jr.' }])
        .mockResolvedValueOnce([{ Gender_ID: 1, Gender: 'Male' }])
        .mockResolvedValueOnce([{ Marital_Status_ID: 1, Marital_Status: 'Married' }]);

      const service = await ProfileService.getInstance();
      const first = await service.getLookups();
      const second = await service.getLookups();

      expect(first).toBe(second);
      // No additional MP calls on the second invocation
      expect(mockGetTableRecords).toHaveBeenCalledTimes(4);
    });
  });

  describe('getProfilePhoto', () => {
    it('should return the uniqueFileId of the default image', async () => {
      mockGetFilesByRecord.mockResolvedValueOnce([
        { FileId: 5, UniqueFileId: 'unique-abc' },
      ]);

      const service = await ProfileService.getInstance();
      const result = await service.getProfilePhoto(100);

      expect(mockGetFilesByRecord).toHaveBeenCalledWith({
        table: 'Contacts',
        recordId: 100,
        defaultOnly: true,
      });
      expect(result).toEqual({ uniqueFileId: 'unique-abc' });
    });

    it('should return null when there is no default image', async () => {
      mockGetFilesByRecord.mockResolvedValueOnce([]);

      const service = await ProfileService.getInstance();
      const result = await service.getProfilePhoto(100);

      expect(result).toBeNull();
    });

    it('should return null when MPHelper throws', async () => {
      mockGetFilesByRecord.mockRejectedValueOnce(new Error('boom'));

      const service = await ProfileService.getInstance();
      const result = await service.getProfilePhoto(100);

      expect(result).toBeNull();
    });
  });

  describe('uploadProfilePhoto', () => {
    const fakeFile = new File(['xyz'], 'photo.jpg', { type: 'image/jpeg' });

    it('should update the existing default image when one exists', async () => {
      mockGetFilesByRecord.mockResolvedValueOnce([
        { FileId: 9, UniqueFileId: 'existing-id' },
      ]);
      mockUpdateFile.mockResolvedValueOnce({ FileId: 9, UniqueFileId: 'existing-id' });

      const service = await ProfileService.getInstance();
      const result = await service.uploadProfilePhoto(100, fakeFile);

      expect(mockUpdateFile).toHaveBeenCalledWith({
        fileId: 9,
        file: fakeFile,
        updateParams: { isDefaultImage: true },
      });
      expect(mockUploadFiles).not.toHaveBeenCalled();
      expect(result).toEqual({ FileId: 9, UniqueFileId: 'existing-id' });
    });

    it('should upload a new default image when none exists', async () => {
      mockGetFilesByRecord.mockResolvedValueOnce([]);
      mockUploadFiles.mockResolvedValueOnce([
        { FileId: 11, UniqueFileId: 'new-id' },
      ]);

      const service = await ProfileService.getInstance();
      const result = await service.uploadProfilePhoto(100, fakeFile);

      expect(mockUploadFiles).toHaveBeenCalledWith({
        table: 'Contacts',
        recordId: 100,
        files: [fakeFile],
        uploadParams: { isDefaultImage: true },
      });
      expect(mockUpdateFile).not.toHaveBeenCalled();
      expect(result).toEqual({ FileId: 11, UniqueFileId: 'new-id' });
    });
  });

  describe('getProfilePhotoContent', () => {
    it('should delegate to MPHelper.getFileContentByUniqueId', async () => {
      const blob = new Blob(['x']);
      mockGetFileContentByUniqueId.mockResolvedValueOnce(blob);

      const service = await ProfileService.getInstance();
      const result = await service.getProfilePhotoContent('uid-1', true);

      expect(mockGetFileContentByUniqueId).toHaveBeenCalledWith({
        uniqueFileId: 'uid-1',
        thumbnail: true,
      });
      expect(result).toBe(blob);
    });
  });

  describe('updateProfile', () => {
    it('should update the contact record and return success', async () => {
      mockUpdateTableRecords.mockResolvedValueOnce([]);

      const service = await ProfileService.getInstance();
      const result = await service.updateProfile(100, {
        First_Name: 'Jane',
        Last_Name: 'Doe',
      });

      expect(mockUpdateTableRecords).toHaveBeenCalledWith('Contacts', [
        { Contact_ID: 100, First_Name: 'Jane', Last_Name: 'Doe' },
      ]);
      expect(result).toEqual({ success: true });
    });

    it('should return an error result when MPHelper throws', async () => {
      mockUpdateTableRecords.mockRejectedValueOnce(new Error('update failed'));

      const service = await ProfileService.getInstance();
      const result = await service.updateProfile(100, { First_Name: 'Jane' });

      expect(result).toEqual({ success: false, error: 'update failed' });
    });
  });
});
