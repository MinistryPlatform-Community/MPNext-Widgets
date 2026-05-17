import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MetadataService } from '@/lib/providers/ministry-platform/services/metadata.service';
import type { MinistryPlatformClient } from '@/lib/providers/ministry-platform/client';
import type { HttpClient } from '@/lib/providers/ministry-platform/utils/http-client';

/**
 * MetadataService Tests
 *
 * Tests for the MetadataService that handles schema metadata operations.
 * Tests cover:
 * - refreshMetadata triggers cache refresh
 * - getTables (with and without search)
 * - Error propagation
 * - Token validation before each operation
 */

describe('MetadataService', () => {
  let metadataService: MetadataService;
  let mockClient: MinistryPlatformClient;
  let mockHttpClient: HttpClient;

  beforeEach(() => {
    vi.clearAllMocks();

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

    metadataService = new MetadataService(mockClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('refreshMetadata', () => {
    it('should call GET /refreshMetadata', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

      await metadataService.refreshMetadata();

      expect(mockClient.ensureValidToken).toHaveBeenCalledTimes(1);
      expect(mockHttpClient.get).toHaveBeenCalledWith('/refreshMetadata');
    });

    it('should propagate errors', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('GET /refreshMetadata failed: 403 Forbidden')
      );

      await expect(metadataService.refreshMetadata()).rejects.toThrow(
        '403 Forbidden'
      );
    });

    it('should propagate token errors', async () => {
      (mockClient.ensureValidToken as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Token refresh failed')
      );

      await expect(metadataService.refreshMetadata()).rejects.toThrow(
        'Token refresh failed'
      );
    });
  });

  describe('getTables', () => {
    it('should fetch all tables when no search term provided', async () => {
      const mockTables = [
        { Table_ID: 1, Table_Name: 'Contacts', Display_Name: 'Contacts' },
        { Table_ID: 2, Table_Name: 'Events', Display_Name: 'Events' },
      ];

      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockTables);

      const result = await metadataService.getTables();

      expect(mockClient.ensureValidToken).toHaveBeenCalledTimes(1);
      expect(mockHttpClient.get).toHaveBeenCalledWith('/tables', undefined);
      expect(result).toEqual(mockTables);
    });

    it('should pass search term as $search query parameter', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await metadataService.getTables('contact');

      expect(mockHttpClient.get).toHaveBeenCalledWith('/tables', { $search: 'contact' });
    });

    it('should return empty array when no tables match search', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      const result = await metadataService.getTables('NonExistentSearch');

      expect(result).toEqual([]);
    });

    it('should propagate errors', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('GET /tables failed: 500 Internal Server Error')
      );

      await expect(metadataService.getTables()).rejects.toThrow(
        '500 Internal Server Error'
      );
    });

    it('should propagate token errors', async () => {
      (mockClient.ensureValidToken as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Token refresh failed')
      );

      await expect(metadataService.getTables()).rejects.toThrow(
        'Token refresh failed'
      );
    });
  });

  describe('Token Validation', () => {
    it('should ensure valid token before each operation', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await metadataService.refreshMetadata();
      await metadataService.getTables();
      await metadataService.getTables('contact');

      expect(mockClient.ensureValidToken).toHaveBeenCalledTimes(3);
    });
  });
});
