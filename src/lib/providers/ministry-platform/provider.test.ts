import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * MinistryPlatformProvider Tests
 *
 * Tests for the singleton provider that orchestrates all Ministry Platform services.
 * Tests cover:
 * - Singleton invariant (getInstance returns same instance)
 * - Delegation to TableService, ProcedureService, MetadataService, DomainService,
 *   CommunicationService, and FileService
 */

const {
  mockGetTableRecords,
  mockCreateTableRecords,
  mockUpdateTableRecords,
  mockDeleteTableRecords,
  mockGetDomainInfo,
  mockGetGlobalFilters,
  mockRefreshMetadata,
  mockGetTables,
  mockGetProcedures,
  mockExecuteProcedure,
  mockExecuteProcedureWithBody,
  mockCreateCommunication,
  mockSendMessage,
  mockGetFilesByRecord,
  mockUploadFiles,
  mockUpdateFile,
  mockDeleteFile,
  mockGetFileContentByUniqueId,
  mockGetFileMetadata,
  mockGetFileMetadataByUniqueId,
} = vi.hoisted(() => ({
  mockGetTableRecords: vi.fn(),
  mockCreateTableRecords: vi.fn(),
  mockUpdateTableRecords: vi.fn(),
  mockDeleteTableRecords: vi.fn(),
  mockGetDomainInfo: vi.fn(),
  mockGetGlobalFilters: vi.fn(),
  mockRefreshMetadata: vi.fn(),
  mockGetTables: vi.fn(),
  mockGetProcedures: vi.fn(),
  mockExecuteProcedure: vi.fn(),
  mockExecuteProcedureWithBody: vi.fn(),
  mockCreateCommunication: vi.fn(),
  mockSendMessage: vi.fn(),
  mockGetFilesByRecord: vi.fn(),
  mockUploadFiles: vi.fn(),
  mockUpdateFile: vi.fn(),
  mockDeleteFile: vi.fn(),
  mockGetFileContentByUniqueId: vi.fn(),
  mockGetFileMetadata: vi.fn(),
  mockGetFileMetadataByUniqueId: vi.fn(),
}));

vi.mock('./client', () => ({
  MinistryPlatformClient: class {
    constructor() {}
  },
}));

vi.mock('./services', () => ({
  TableService: class {
    getTableRecords = mockGetTableRecords;
    createTableRecords = mockCreateTableRecords;
    updateTableRecords = mockUpdateTableRecords;
    deleteTableRecords = mockDeleteTableRecords;
  },
  ProcedureService: class {
    getProcedures = mockGetProcedures;
    executeProcedure = mockExecuteProcedure;
    executeProcedureWithBody = mockExecuteProcedureWithBody;
  },
  CommunicationService: class {
    createCommunication = mockCreateCommunication;
    sendMessage = mockSendMessage;
  },
  MetadataService: class {
    refreshMetadata = mockRefreshMetadata;
    getTables = mockGetTables;
  },
  DomainService: class {
    getDomainInfo = mockGetDomainInfo;
    getGlobalFilters = mockGetGlobalFilters;
  },
  FileService: class {
    getFilesByRecord = mockGetFilesByRecord;
    uploadFiles = mockUploadFiles;
    updateFile = mockUpdateFile;
    deleteFile = mockDeleteFile;
    getFileContentByUniqueId = mockGetFileContentByUniqueId;
    getFileMetadata = mockGetFileMetadata;
    getFileMetadataByUniqueId = mockGetFileMetadataByUniqueId;
  },
}));

import { MinistryPlatformProvider } from './provider';

describe('MinistryPlatformProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset singleton between tests so we can re-test initialization wiring
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (MinistryPlatformProvider as any).instance = undefined;
  });

  describe('getInstance', () => {
    it('should return a singleton instance', () => {
      const instance1 = MinistryPlatformProvider.getInstance();
      const instance2 = MinistryPlatformProvider.getInstance();
      expect(instance1).toBe(instance2);
    });

    it('should lazily create instance on first call', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((MinistryPlatformProvider as any).instance).toBeUndefined();
      const instance = MinistryPlatformProvider.getInstance();
      expect(instance).toBeDefined();
    });
  });

  describe('Table operations', () => {
    it('should delegate getTableRecords to TableService', async () => {
      const mockRecords = [{ id: 1, name: 'Test' }];
      mockGetTableRecords.mockResolvedValueOnce(mockRecords);

      const provider = MinistryPlatformProvider.getInstance();
      const result = await provider.getTableRecords('Contacts', { $filter: 'Active=1' });

      expect(mockGetTableRecords).toHaveBeenCalledWith('Contacts', { $filter: 'Active=1' });
      expect(result).toEqual(mockRecords);
    });

    it('should delegate createTableRecords to TableService', async () => {
      const records = [{ First_Name: 'John' }];
      mockCreateTableRecords.mockResolvedValueOnce(records);

      const provider = MinistryPlatformProvider.getInstance();
      await provider.createTableRecords('Contacts', records);

      expect(mockCreateTableRecords).toHaveBeenCalledWith('Contacts', records, undefined);
    });

    it('should delegate updateTableRecords to TableService', async () => {
      const records = [{ Contact_ID: 1, First_Name: 'Jane' }];
      mockUpdateTableRecords.mockResolvedValueOnce(records);

      const provider = MinistryPlatformProvider.getInstance();
      await provider.updateTableRecords('Contacts', records);

      expect(mockUpdateTableRecords).toHaveBeenCalledWith('Contacts', records, undefined);
    });

    it('should delegate deleteTableRecords to TableService', async () => {
      mockDeleteTableRecords.mockResolvedValueOnce([]);

      const provider = MinistryPlatformProvider.getInstance();
      await provider.deleteTableRecords('Contacts', [1, 2]);

      expect(mockDeleteTableRecords).toHaveBeenCalledWith('Contacts', [1, 2], undefined);
    });
  });

  describe('Procedure operations', () => {
    it('should delegate getProcedures to ProcedureService', async () => {
      mockGetProcedures.mockResolvedValueOnce([]);

      const provider = MinistryPlatformProvider.getInstance();
      await provider.getProcedures('contact');

      expect(mockGetProcedures).toHaveBeenCalledWith('contact');
    });

    it('should delegate executeProcedure to ProcedureService', async () => {
      mockExecuteProcedure.mockResolvedValueOnce([[{ result: 1 }]]);

      const provider = MinistryPlatformProvider.getInstance();
      await provider.executeProcedure('sp_test', { '@Param1': 'value' });

      expect(mockExecuteProcedure).toHaveBeenCalledWith('sp_test', { '@Param1': 'value' });
    });

    it('should delegate executeProcedureWithBody to ProcedureService', async () => {
      mockExecuteProcedureWithBody.mockResolvedValueOnce([[{ result: 1 }]]);

      const provider = MinistryPlatformProvider.getInstance();
      await provider.executeProcedureWithBody('sp_test', { '@Param1': 'value' });

      expect(mockExecuteProcedureWithBody).toHaveBeenCalledWith('sp_test', { '@Param1': 'value' });
    });
  });

  describe('Domain operations', () => {
    it('should delegate getDomainInfo to DomainService', async () => {
      const mockDomain = { DisplayName: 'Test', TimeZoneName: 'UTC', CultureName: 'en-US' };
      mockGetDomainInfo.mockResolvedValueOnce(mockDomain);

      const provider = MinistryPlatformProvider.getInstance();
      const result = await provider.getDomainInfo();

      expect(result).toEqual(mockDomain);
    });

    it('should delegate getGlobalFilters to DomainService', async () => {
      const filters = [{ Key: 1, Value: 'Filter' }];
      mockGetGlobalFilters.mockResolvedValueOnce(filters);

      const provider = MinistryPlatformProvider.getInstance();
      const result = await provider.getGlobalFilters({ $userId: 1 });

      expect(mockGetGlobalFilters).toHaveBeenCalledWith({ $userId: 1 });
      expect(result).toEqual(filters);
    });
  });

  describe('Metadata operations', () => {
    it('should delegate getTables to MetadataService', async () => {
      const mockTables = [{ Table_ID: 1, Table_Name: 'Contacts', Display_Name: 'Contacts' }];
      mockGetTables.mockResolvedValueOnce(mockTables);

      const provider = MinistryPlatformProvider.getInstance();
      const result = await provider.getTables('Contacts');

      expect(mockGetTables).toHaveBeenCalledWith('Contacts');
      expect(result).toEqual(mockTables);
    });

    it('should delegate refreshMetadata to MetadataService', async () => {
      mockRefreshMetadata.mockResolvedValueOnce(undefined);

      const provider = MinistryPlatformProvider.getInstance();
      await provider.refreshMetadata();

      expect(mockRefreshMetadata).toHaveBeenCalled();
    });
  });

  describe('Communication operations', () => {
    it('should delegate createCommunication to CommunicationService', async () => {
      const comm = { CommunicationId: 1 };
      mockCreateCommunication.mockResolvedValueOnce(comm);

      const provider = MinistryPlatformProvider.getInstance();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await provider.createCommunication({ Subject: 'Test' } as any);

      expect(mockCreateCommunication).toHaveBeenCalledWith({ Subject: 'Test' }, undefined);
    });

    it('should delegate sendMessage to CommunicationService', async () => {
      mockSendMessage.mockResolvedValueOnce({ CommunicationId: 2 });

      const provider = MinistryPlatformProvider.getInstance();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await provider.sendMessage({ Subject: 'Test' } as any);

      expect(mockSendMessage).toHaveBeenCalledWith({ Subject: 'Test' }, undefined);
    });
  });

  describe('File operations', () => {
    it('should delegate getFilesByRecord to FileService', async () => {
      mockGetFilesByRecord.mockResolvedValueOnce([]);

      const provider = MinistryPlatformProvider.getInstance();
      await provider.getFilesByRecord('Contacts', 1, true);

      expect(mockGetFilesByRecord).toHaveBeenCalledWith('Contacts', 1, true);
    });

    it('should delegate uploadFiles to FileService', async () => {
      const file = new File(['x'], 'test.txt');
      mockUploadFiles.mockResolvedValueOnce([]);

      const provider = MinistryPlatformProvider.getInstance();
      await provider.uploadFiles('Contacts', 1, [file]);

      expect(mockUploadFiles).toHaveBeenCalledWith('Contacts', 1, [file], undefined);
    });

    it('should delegate updateFile to FileService', async () => {
      mockUpdateFile.mockResolvedValueOnce({ FileId: 1 });

      const provider = MinistryPlatformProvider.getInstance();
      await provider.updateFile(1);

      expect(mockUpdateFile).toHaveBeenCalledWith(1, undefined, undefined);
    });

    it('should delegate deleteFile to FileService', async () => {
      mockDeleteFile.mockResolvedValueOnce(undefined);

      const provider = MinistryPlatformProvider.getInstance();
      await provider.deleteFile(1, 123);

      expect(mockDeleteFile).toHaveBeenCalledWith(1, 123);
    });

    it('should delegate getFileContentByUniqueId to FileService', async () => {
      const blob = new Blob(['data']);
      mockGetFileContentByUniqueId.mockResolvedValueOnce(blob);

      const provider = MinistryPlatformProvider.getInstance();
      const result = await provider.getFileContentByUniqueId('abc-123', true);

      expect(mockGetFileContentByUniqueId).toHaveBeenCalledWith('abc-123', true);
      expect(result).toBe(blob);
    });

    it('should delegate getFileMetadata to FileService', async () => {
      mockGetFileMetadata.mockResolvedValueOnce({ FileId: 1 });

      const provider = MinistryPlatformProvider.getInstance();
      await provider.getFileMetadata(1);

      expect(mockGetFileMetadata).toHaveBeenCalledWith(1);
    });

    it('should delegate getFileMetadataByUniqueId to FileService', async () => {
      mockGetFileMetadataByUniqueId.mockResolvedValueOnce({ FileId: 1 });

      const provider = MinistryPlatformProvider.getInstance();
      await provider.getFileMetadataByUniqueId('abc-123');

      expect(mockGetFileMetadataByUniqueId).toHaveBeenCalledWith('abc-123');
    });
  });
});
