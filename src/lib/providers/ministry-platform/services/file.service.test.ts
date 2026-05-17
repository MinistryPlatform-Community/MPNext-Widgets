import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FileService } from '@/lib/providers/ministry-platform/services/file.service';
import type { MinistryPlatformClient } from '@/lib/providers/ministry-platform/client';
import type { HttpClient } from '@/lib/providers/ministry-platform/utils/http-client';

/**
 * FileService Tests
 *
 * Tests for FileService - upload/download/metadata operations.
 * Covers FormData construction, query param mapping, and the
 * unauthenticated direct-fetch path for getFileContentByUniqueId.
 */

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('FileService', () => {
  let fileService: FileService;
  let mockClient: MinistryPlatformClient;
  let mockHttpClient: HttpClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();

    mockHttpClient = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      buildUrl: vi.fn(),
      postFormData: vi.fn(),
      putFormData: vi.fn(),
    } as unknown as HttpClient;

    mockClient = {
      ensureValidToken: vi.fn().mockResolvedValue(undefined),
      getHttpClient: vi.fn().mockReturnValue(mockHttpClient),
    } as unknown as MinistryPlatformClient;

    fileService = new FileService(mockClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getFilesByRecord', () => {
    it('should GET /files/<table>/<recordId> with empty query params by default', async () => {
      const files = [{ FileId: 1, FileName: 'a.jpg' }];
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(files);

      const result = await fileService.getFilesByRecord('Contacts', 123);

      expect(mockClient.ensureValidToken).toHaveBeenCalledTimes(1);
      expect(mockHttpClient.get).toHaveBeenCalledWith('/files/Contacts/123', {});
      expect(result).toEqual(files);
    });

    it('should include $default=true when defaultOnly is true', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await fileService.getFilesByRecord('Contacts', 123, true);

      expect(mockHttpClient.get).toHaveBeenCalledWith('/files/Contacts/123', {
        $default: 'true',
      });
    });

    it('should include $default=false when defaultOnly is false', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await fileService.getFilesByRecord('Contacts', 123, false);

      expect(mockHttpClient.get).toHaveBeenCalledWith('/files/Contacts/123', {
        $default: 'false',
      });
    });

    it('should propagate errors', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('GET /files/Contacts/123 failed: 404 Not Found')
      );

      await expect(fileService.getFilesByRecord('Contacts', 123)).rejects.toThrow(
        '404 Not Found'
      );
    });
  });

  describe('uploadFiles', () => {
    it('should POST FormData with files using file-N field names', async () => {
      const uploaded = [{ FileId: 1, FileName: 'a.jpg' }];
      (mockHttpClient.postFormData as ReturnType<typeof vi.fn>).mockResolvedValueOnce(uploaded);

      const file1 = new File(['a'], 'a.jpg');
      const file2 = new File(['b'], 'b.jpg');

      const result = await fileService.uploadFiles('Contacts', 123, [file1, file2]);

      expect(mockClient.ensureValidToken).toHaveBeenCalledTimes(1);
      const [endpoint, formData, queryParams] = (mockHttpClient.postFormData as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(endpoint).toBe('/files/Contacts/123');
      expect((formData as FormData).get('file-0')).toBeInstanceOf(File);
      expect((formData as FormData).get('file-1')).toBeInstanceOf(File);
      expect(queryParams).toEqual({});
      expect(result).toEqual(uploaded);
    });

    it('should include description, isDefaultImage, longestDimension in form data and query params', async () => {
      (mockHttpClient.postFormData as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      const file = new File(['a'], 'a.jpg');
      await fileService.uploadFiles('Events', 456, [file], {
        description: 'Banner image',
        isDefaultImage: true,
        longestDimension: 1024,
        userId: 99,
      });

      const [, formData, queryParams] = (mockHttpClient.postFormData as ReturnType<typeof vi.fn>).mock.calls[0];

      expect((formData as FormData).get('description')).toBe('Banner image');
      expect((formData as FormData).get('isDefaultImage')).toBe('true');
      expect((formData as FormData).get('longestDimension')).toBe('1024');

      expect(queryParams).toEqual({
        $description: 'Banner image',
        $default: 'true',
        $longestDimension: '1024',
        $userId: '99',
      });
    });

    it('should propagate errors', async () => {
      (mockHttpClient.postFormData as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('POST /files/Contacts/1 failed: 413 Payload Too Large')
      );

      await expect(
        fileService.uploadFiles('Contacts', 1, [new File(['x'], 'big.bin')])
      ).rejects.toThrow('413 Payload Too Large');
    });
  });

  describe('updateFile', () => {
    it('should PUT FormData without file for metadata-only update', async () => {
      const updated = { FileId: 1, FileName: 'a.jpg', Description: 'New' };
      (mockHttpClient.putFormData as ReturnType<typeof vi.fn>).mockResolvedValueOnce(updated);

      const result = await fileService.updateFile(1, undefined, {
        description: 'New',
      });

      const [endpoint, formData, queryParams] = (mockHttpClient.putFormData as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(endpoint).toBe('/files/1');
      // No 'file' entry since file was undefined
      expect((formData as FormData).get('file')).toBeNull();
      expect((formData as FormData).get('description')).toBe('New');
      expect(queryParams).toEqual({ $description: 'New' });
      expect(result).toEqual(updated);
    });

    it('should PUT FormData with file when provided', async () => {
      (mockHttpClient.putFormData as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        FileId: 1,
      });

      const file = new File(['updated'], 'updated.jpg', { type: 'image/jpeg' });
      await fileService.updateFile(1, file, {
        fileName: 'renamed.jpg',
        description: 'Updated photo',
        isDefaultImage: false,
        longestDimension: 800,
        userId: 42,
      });

      const [, formData, queryParams] = (mockHttpClient.putFormData as ReturnType<typeof vi.fn>).mock.calls[0];

      expect((formData as FormData).get('file')).toBeInstanceOf(File);
      expect((formData as FormData).get('fileName')).toBe('renamed.jpg');
      expect((formData as FormData).get('description')).toBe('Updated photo');
      expect((formData as FormData).get('isDefaultImage')).toBe('false');
      expect((formData as FormData).get('longestDimension')).toBe('800');

      expect(queryParams).toEqual({
        $fileName: 'renamed.jpg',
        $description: 'Updated photo',
        $default: 'false',
        $longestDimension: '800',
        $userId: '42',
      });
    });

    it('should propagate errors', async () => {
      (mockHttpClient.putFormData as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('PUT /files/1 failed: 404 Not Found')
      );

      await expect(fileService.updateFile(1)).rejects.toThrow('404 Not Found');
    });
  });

  describe('deleteFile', () => {
    it('should DELETE /files/<fileId> with empty query params when no userId', async () => {
      (mockHttpClient.delete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

      await fileService.deleteFile(1);

      expect(mockClient.ensureValidToken).toHaveBeenCalledTimes(1);
      expect(mockHttpClient.delete).toHaveBeenCalledWith('/files/1', {});
    });

    it('should include $userId when provided', async () => {
      (mockHttpClient.delete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

      await fileService.deleteFile(1, 123);

      expect(mockHttpClient.delete).toHaveBeenCalledWith('/files/1', {
        $userId: '123',
      });
    });

    it('should propagate errors', async () => {
      (mockHttpClient.delete as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('DELETE /files/1 failed: 403 Forbidden')
      );

      await expect(fileService.deleteFile(1)).rejects.toThrow('403 Forbidden');
    });
  });

  describe('getFileContentByUniqueId', () => {
    it('should fetch file content without Authorization header', async () => {
      (mockHttpClient.buildUrl as ReturnType<typeof vi.fn>).mockReturnValueOnce(
        'https://api.example.com/files/abc-123'
      );

      const blob = new Blob(['file content'], { type: 'image/jpeg' });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        blob: () => Promise.resolve(blob),
      });

      const result = await fileService.getFileContentByUniqueId('abc-123');

      // Should NOT call ensureValidToken (no auth needed)
      expect(mockClient.ensureValidToken).not.toHaveBeenCalled();

      // Should call buildUrl
      expect(mockHttpClient.buildUrl).toHaveBeenCalledWith('/files/abc-123', {});

      // Should call fetch with no auth headers
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/files/abc-123',
        { method: 'GET' }
      );
      expect(result).toBe(blob);
    });

    it('should include $thumbnail=true when thumbnail is true', async () => {
      (mockHttpClient.buildUrl as ReturnType<typeof vi.fn>).mockReturnValueOnce(
        'https://api.example.com/files/abc-123?$thumbnail=true'
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        blob: () => Promise.resolve(new Blob(['thumb'])),
      });

      await fileService.getFileContentByUniqueId('abc-123', true);

      expect(mockHttpClient.buildUrl).toHaveBeenCalledWith('/files/abc-123', {
        $thumbnail: 'true',
      });
    });

    it('should throw error on failed fetch', async () => {
      (mockHttpClient.buildUrl as ReturnType<typeof vi.fn>).mockReturnValueOnce(
        'https://api.example.com/files/missing'
      );

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await expect(
        fileService.getFileContentByUniqueId('missing')
      ).rejects.toThrow('GET /files/missing failed: 404 Not Found');
    });
  });

  describe('getFileMetadata', () => {
    it('should GET /files/<fileId>/metadata', async () => {
      const metadata = { FileId: 1, FileName: 'a.jpg', FileSize: 1024 };
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(metadata);

      const result = await fileService.getFileMetadata(1);

      expect(mockClient.ensureValidToken).toHaveBeenCalledTimes(1);
      expect(mockHttpClient.get).toHaveBeenCalledWith('/files/1/metadata');
      expect(result).toEqual(metadata);
    });

    it('should propagate errors', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('GET /files/1/metadata failed: 404 Not Found')
      );

      await expect(fileService.getFileMetadata(1)).rejects.toThrow('404 Not Found');
    });
  });

  describe('getFileMetadataByUniqueId', () => {
    it('should GET /files/<uniqueFileId>/metadata', async () => {
      const metadata = { FileId: 1, UniqueFileId: 'abc-123', FileName: 'a.jpg' };
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(metadata);

      const result = await fileService.getFileMetadataByUniqueId('abc-123');

      expect(mockClient.ensureValidToken).toHaveBeenCalledTimes(1);
      expect(mockHttpClient.get).toHaveBeenCalledWith('/files/abc-123/metadata');
      expect(result).toEqual(metadata);
    });

    it('should propagate errors', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('GET /files/abc-123/metadata failed: 404 Not Found')
      );

      await expect(
        fileService.getFileMetadataByUniqueId('abc-123')
      ).rejects.toThrow('404 Not Found');
    });
  });
});
