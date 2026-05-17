import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CommunicationService } from '@/lib/providers/ministry-platform/services/communication.service';
import type { MinistryPlatformClient } from '@/lib/providers/ministry-platform/client';
import type { HttpClient } from '@/lib/providers/ministry-platform/utils/http-client';
import type { CommunicationInfo, MessageInfo } from '@/lib/providers/ministry-platform/types';

/**
 * CommunicationService Tests
 *
 * Tests the CommunicationService logic for routing between JSON POST and
 * multipart FormData POST based on whether attachments are present.
 */

describe('CommunicationService', () => {
  let communicationService: CommunicationService;
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

    communicationService = new CommunicationService(mockClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const sampleCommunication: CommunicationInfo = {
    AuthorUserId: 1,
    Subject: 'Test',
    Body: '<p>Body</p>',
    StartDate: '2024-01-01',
    FromContactId: 123,
    ReplyToContactId: 123,
    FromAddress: { DisplayName: 'Sender', Address: 'sender@example.com' },
    ReplyToAddress: { DisplayName: 'Sender', Address: 'sender@example.com' },
    CommunicationType: 'Email',
    Contacts: [456],
    IsBulkEmail: false,
    SendToContactParents: false,
  };

  const sampleMessage: MessageInfo = {
    FromAddress: { DisplayName: 'Sender', Address: 'sender@example.com' },
    ToAddresses: [{ DisplayName: 'Recipient', Address: 'r@example.com' }],
    Subject: 'Test',
    Body: '<p>Body</p>',
  };

  describe('createCommunication', () => {
    it('should POST JSON when no attachments', async () => {
      const created = { CommunicationId: 1 };
      (mockHttpClient.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(created);

      const result = await communicationService.createCommunication(sampleCommunication);

      expect(mockClient.ensureValidToken).toHaveBeenCalledTimes(1);
      expect(mockHttpClient.post).toHaveBeenCalledWith('/communications', {
        ...sampleCommunication,
      });
      expect(mockHttpClient.postFormData).not.toHaveBeenCalled();
      expect(result).toEqual(created);
    });

    it('should POST FormData when attachments are provided', async () => {
      const created = { CommunicationId: 1 };
      (mockHttpClient.postFormData as ReturnType<typeof vi.fn>).mockResolvedValueOnce(created);

      const file = new File(['data'], 'doc.pdf', { type: 'application/pdf' });

      const result = await communicationService.createCommunication(sampleCommunication, [file]);

      expect(mockClient.ensureValidToken).toHaveBeenCalledTimes(1);
      expect(mockHttpClient.postFormData).toHaveBeenCalledTimes(1);
      expect(mockHttpClient.post).not.toHaveBeenCalled();

      const [endpoint, formData] = (mockHttpClient.postFormData as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(endpoint).toBe('/communications');
      expect(formData).toBeInstanceOf(FormData);
      // Verify JSON payload is in 'communication' field
      const commJson = (formData as FormData).get('communication');
      expect(commJson).toBe(JSON.stringify(sampleCommunication));
      // Verify the file is attached as file-0
      expect((formData as FormData).get('file-0')).toBeInstanceOf(File);

      expect(result).toEqual(created);
    });

    it('should POST JSON when attachments array is empty', async () => {
      (mockHttpClient.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ CommunicationId: 1 });

      await communicationService.createCommunication(sampleCommunication, []);

      expect(mockHttpClient.post).toHaveBeenCalled();
      expect(mockHttpClient.postFormData).not.toHaveBeenCalled();
    });

    it('should attach multiple files with sequential field names', async () => {
      (mockHttpClient.postFormData as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ CommunicationId: 1 });

      const file1 = new File(['a'], 'a.pdf');
      const file2 = new File(['b'], 'b.pdf');
      const file3 = new File(['c'], 'c.pdf');

      await communicationService.createCommunication(sampleCommunication, [file1, file2, file3]);

      const [, formData] = (mockHttpClient.postFormData as ReturnType<typeof vi.fn>).mock.calls[0];
      expect((formData as FormData).get('file-0')).toBeInstanceOf(File);
      expect((formData as FormData).get('file-1')).toBeInstanceOf(File);
      expect((formData as FormData).get('file-2')).toBeInstanceOf(File);
    });

    it('should propagate errors', async () => {
      (mockHttpClient.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('POST /communications failed: 400 Bad Request')
      );

      await expect(
        communicationService.createCommunication(sampleCommunication)
      ).rejects.toThrow('400 Bad Request');
    });
  });

  describe('sendMessage', () => {
    it('should POST JSON when no attachments', async () => {
      const sent = { CommunicationId: 1 };
      (mockHttpClient.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(sent);

      const result = await communicationService.sendMessage(sampleMessage);

      expect(mockClient.ensureValidToken).toHaveBeenCalledTimes(1);
      expect(mockHttpClient.post).toHaveBeenCalledWith('/messages', { ...sampleMessage });
      expect(mockHttpClient.postFormData).not.toHaveBeenCalled();
      expect(result).toEqual(sent);
    });

    it('should POST FormData when attachments are provided', async () => {
      const sent = { CommunicationId: 2 };
      (mockHttpClient.postFormData as ReturnType<typeof vi.fn>).mockResolvedValueOnce(sent);

      const file = new File(['data'], 'report.xlsx');

      const result = await communicationService.sendMessage(sampleMessage, [file]);

      expect(mockHttpClient.postFormData).toHaveBeenCalledTimes(1);
      expect(mockHttpClient.post).not.toHaveBeenCalled();

      const [endpoint, formData] = (mockHttpClient.postFormData as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(endpoint).toBe('/messages');
      // Verify JSON payload is in 'message' field
      const msgJson = (formData as FormData).get('message');
      expect(msgJson).toBe(JSON.stringify(sampleMessage));
      expect((formData as FormData).get('file-0')).toBeInstanceOf(File);

      expect(result).toEqual(sent);
    });

    it('should propagate errors', async () => {
      (mockHttpClient.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('POST /messages failed: 500 Internal Server Error')
      );

      await expect(communicationService.sendMessage(sampleMessage)).rejects.toThrow(
        '500 Internal Server Error'
      );
    });
  });
});
