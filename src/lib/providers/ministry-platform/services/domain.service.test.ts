import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DomainService } from '@/lib/providers/ministry-platform/services/domain.service';
import type { MinistryPlatformClient } from '@/lib/providers/ministry-platform/client';
import type { HttpClient } from '@/lib/providers/ministry-platform/utils/http-client';

/**
 * DomainService Tests
 *
 * Tests the thin DomainService wrapper that fetches domain info and global filters.
 */

describe('DomainService', () => {
  let domainService: DomainService;
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

    domainService = new DomainService(mockClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getDomainInfo', () => {
    it('should call GET /domain', async () => {
      const domain = { DisplayName: 'Test', TimeZoneName: 'UTC', CultureName: 'en-US' };
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(domain);

      const result = await domainService.getDomainInfo();

      expect(mockClient.ensureValidToken).toHaveBeenCalledTimes(1);
      expect(mockHttpClient.get).toHaveBeenCalledWith('/domain');
      expect(result).toEqual(domain);
    });

    it('should propagate errors', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('GET /domain failed: 401 Unauthorized')
      );

      await expect(domainService.getDomainInfo()).rejects.toThrow('401 Unauthorized');
    });

    it('should propagate token errors', async () => {
      (mockClient.ensureValidToken as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Token refresh failed')
      );

      await expect(domainService.getDomainInfo()).rejects.toThrow('Token refresh failed');
    });
  });

  describe('getGlobalFilters', () => {
    it('should call GET /domain/filters with no params', async () => {
      const filters = [
        { Key: 1, Value: 'Filter 1' },
        { Key: 2, Value: 'Filter 2' },
      ];
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(filters);

      const result = await domainService.getGlobalFilters();

      expect(mockClient.ensureValidToken).toHaveBeenCalledTimes(1);
      expect(mockHttpClient.get).toHaveBeenCalledWith('/domain/filters', undefined);
      expect(result).toEqual(filters);
    });

    it('should pass user ID and permission flag as query params', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await domainService.getGlobalFilters({ $userId: 123, $ignorePermissions: true });

      expect(mockHttpClient.get).toHaveBeenCalledWith('/domain/filters', {
        $userId: 123,
        $ignorePermissions: true,
      });
    });

    it('should propagate errors', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('GET /domain/filters failed: 500 Internal Server Error')
      );

      await expect(domainService.getGlobalFilters()).rejects.toThrow(
        '500 Internal Server Error'
      );
    });
  });
});
