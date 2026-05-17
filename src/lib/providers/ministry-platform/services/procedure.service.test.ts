import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProcedureService } from '@/lib/providers/ministry-platform/services/procedure.service';
import type { MinistryPlatformClient } from '@/lib/providers/ministry-platform/client';
import type { HttpClient } from '@/lib/providers/ministry-platform/utils/http-client';

/**
 * ProcedureService Tests
 *
 * Tests for the ProcedureService that handles stored procedure operations.
 * Tests cover:
 * - Listing available procedures (with optional search)
 * - Executing procedure via GET (query params)
 * - Executing procedure via POST (body params)
 * - Error propagation
 * - Token validation before each operation
 */

describe('ProcedureService', () => {
  let procedureService: ProcedureService;
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

    procedureService = new ProcedureService(mockClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getProcedures', () => {
    it('should fetch all procedures when no search term provided', async () => {
      const mockProcedures = [
        { Name: 'api_Get_Contact_Info', Parameters: [] },
        { Name: 'api_Update_Contact', Parameters: [] },
      ];

      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockProcedures);

      const result = await procedureService.getProcedures();

      expect(mockClient.ensureValidToken).toHaveBeenCalledTimes(1);
      expect(mockHttpClient.get).toHaveBeenCalledWith('/procs', undefined);
      expect(result).toEqual(mockProcedures);
    });

    it('should pass search term as $search query parameter', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await procedureService.getProcedures('contact');

      expect(mockHttpClient.get).toHaveBeenCalledWith('/procs', { $search: 'contact' });
    });

    it('should propagate errors', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('GET /procs failed: 401 Unauthorized')
      );

      await expect(procedureService.getProcedures()).rejects.toThrow(
        '401 Unauthorized'
      );
    });

    it('should propagate token errors', async () => {
      (mockClient.ensureValidToken as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Token refresh failed')
      );

      await expect(procedureService.getProcedures()).rejects.toThrow(
        'Token refresh failed'
      );
    });
  });

  describe('executeProcedure', () => {
    it('should execute procedure with GET and pass parameters as query string', async () => {
      const procedureResult = [[{ Contact_ID: 1, Display_Name: 'John Doe' }]];
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(procedureResult);

      const result = await procedureService.executeProcedure(
        'api_Get_Contact_Info',
        { ContactID: 1 }
      );

      expect(mockClient.ensureValidToken).toHaveBeenCalledTimes(1);
      expect(mockHttpClient.get).toHaveBeenCalledWith(
        '/procs/api_Get_Contact_Info',
        { ContactID: 1 }
      );
      expect(result).toEqual(procedureResult);
    });

    it('should execute procedure without parameters', async () => {
      const procedureResult = [[{ Count: 100 }]];
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(procedureResult);

      const result = await procedureService.executeProcedure('api_Get_Stats');

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        '/procs/api_Get_Stats',
        undefined
      );
      expect(result).toEqual(procedureResult);
    });

    it('should URL-encode procedure names with special characters', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce([[]]);

      await procedureService.executeProcedure('api_Special Procedure');

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        '/procs/api_Special%20Procedure',
        undefined
      );
    });

    it('should propagate procedure execution errors', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('GET /procs/NonExistent failed: 404 Not Found')
      );

      await expect(
        procedureService.executeProcedure('NonExistent')
      ).rejects.toThrow('404 Not Found');
    });

    it('should propagate token errors', async () => {
      (mockClient.ensureValidToken as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Token refresh failed')
      );

      await expect(
        procedureService.executeProcedure('api_Test')
      ).rejects.toThrow('Token refresh failed');
    });
  });

  describe('executeProcedureWithBody', () => {
    it('should execute procedure with POST and body parameters', async () => {
      const procedureResult = [[{ Success: true }]];
      (mockHttpClient.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(procedureResult);

      const parameters = {
        ContactID: 1,
        Notes: 'Test notes',
        Date: '2024-01-01',
      };

      const result = await procedureService.executeProcedureWithBody(
        'api_Create_Contact_Log',
        parameters
      );

      expect(mockClient.ensureValidToken).toHaveBeenCalledTimes(1);
      expect(mockHttpClient.post).toHaveBeenCalledWith(
        '/procs/api_Create_Contact_Log',
        parameters
      );
      expect(result).toEqual(procedureResult);
    });

    it('should send empty object body when no parameters', async () => {
      (mockHttpClient.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce([[]]);

      await procedureService.executeProcedureWithBody('api_NoParams', {});

      expect(mockHttpClient.post).toHaveBeenCalledWith('/procs/api_NoParams', {});
    });

    it('should propagate execution errors', async () => {
      (mockHttpClient.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('POST /procs/api_Test failed: 500 Internal Server Error')
      );

      await expect(
        procedureService.executeProcedureWithBody('api_Test', { Foo: 'bar' })
      ).rejects.toThrow('500 Internal Server Error');
    });

    it('should propagate token errors', async () => {
      (mockClient.ensureValidToken as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Token refresh failed')
      );

      await expect(
        procedureService.executeProcedureWithBody('api_Test', {})
      ).rejects.toThrow('Token refresh failed');
    });
  });

  describe('Token Validation', () => {
    it('should ensure valid token before each operation', async () => {
      (mockHttpClient.get as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (mockHttpClient.post as ReturnType<typeof vi.fn>).mockResolvedValue([[]]);

      await procedureService.getProcedures();
      await procedureService.executeProcedure('api_Test');
      await procedureService.executeProcedureWithBody('api_Test', {});

      expect(mockClient.ensureValidToken).toHaveBeenCalledTimes(3);
    });
  });
});
