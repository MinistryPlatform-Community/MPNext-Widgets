import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageTemplateService } from '@/services/messageTemplateService';

const mockGetTableRecords = vi.fn();
const mockSendMessage = vi.fn();

vi.mock('@/lib/providers/ministry-platform', () => {
  return {
    MPHelper: class {
      getTableRecords = mockGetTableRecords;
      sendMessage = mockSendMessage;
    },
  };
});

/**
 * Queue the two reads every send performs, in order: the template row, then the
 * From contact. Written as a helper because getting the order wrong is the
 * easiest way to write a test that passes for the wrong reason.
 */
function queueTemplateThenFromContact(
  template: Record<string, unknown>,
  contact: Record<string, unknown> | null = {
    Contact_ID: 7,
    First_Name: 'Grace',
    Last_Name: 'Okafor',
    Email_Address: 'grace@church.example',
  }
) {
  mockGetTableRecords.mockResolvedValueOnce([template]);
  mockGetTableRecords.mockResolvedValueOnce(contact ? [contact] : []);
}

describe('MessageTemplateService', () => {
  beforeEach(() => {
    // `mockReset`, not `clearAllMocks`: a test that throws part-way through a
    // send leaves its unconsumed `mockResolvedValueOnce` queued, and
    // `clearAllMocks` does not drain that queue — the stale row then becomes
    // the *next* test's template and every assertion after it is off by one.
    mockGetTableRecords.mockReset();
    mockSendMessage.mockReset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (MessageTemplateService as any).instance = undefined;
  });

  it('returns a singleton instance', async () => {
    const a = await MessageTemplateService.getInstance();
    const b = await MessageTemplateService.getInstance();
    expect(a).toBe(b);
  });

  describe('sendMessageTemplate — dp_Communications', () => {
    it('reads the message template by Communication_ID and sends it', async () => {
      queueTemplateThenFromContact({
        Subject: 'Welcome',
        Body: '<p>Hello</p>',
        From_Contact: 7,
      });

      const service = await MessageTemplateService.getInstance();
      await service.sendMessageTemplate(42, { email: 'v@example.com', name: 'Visitor' }, {});

      expect(mockGetTableRecords).toHaveBeenNthCalledWith(1, {
        table: 'dp_Communications',
        select: 'Subject, Body, From_Contact',
        filter: 'Communication_ID = 42',
        top: 1,
      });
      expect(mockSendMessage).toHaveBeenCalledWith({
        FromAddress: { DisplayName: 'Grace Okafor', Address: 'grace@church.example' },
        ToAddresses: [{ DisplayName: 'Visitor', Address: 'v@example.com' }],
        Subject: 'Welcome',
        Body: '<p>Hello</p>',
      });
    });

    it('throws when the template id does not exist', async () => {
      mockGetTableRecords.mockResolvedValueOnce([]);

      const service = await MessageTemplateService.getInstance();
      await expect(
        service.sendMessageTemplate(999, { email: 'v@example.com', name: 'V' }, {})
      ).rejects.toThrow('Email template 999 not found.');
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  describe('sendCommunicationTemplate — dp_Communication_Templates', () => {
    it('reads the other table, with its other column names', async () => {
      queueTemplateThenFromContact({
        Subject_Text: 'Visit',
        Body_HTML: '<p>See you</p>',
        From_Contact: 7,
      });

      const service = await MessageTemplateService.getInstance();
      await service.sendCommunicationTemplate(11, { email: 'v@example.com', name: 'V' }, {});

      expect(mockGetTableRecords).toHaveBeenNthCalledWith(1, {
        table: 'dp_Communication_Templates',
        select: 'Subject_Text, Body_HTML, From_Contact',
        filter: 'Communication_Template_ID = 11',
        top: 1,
      });
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ Subject: 'Visit', Body: '<p>See you</p>' })
      );
    });

    it('throws when the template id does not exist', async () => {
      mockGetTableRecords.mockResolvedValueOnce([]);

      const service = await MessageTemplateService.getInstance();
      await expect(
        service.sendCommunicationTemplate(999, { email: 'v@example.com', name: 'V' }, {})
      ).rejects.toThrow('Communication template 999 not found.');
    });
  });

  describe('merge tokens', () => {
    it('substitutes [Token] in both subject and body, case-insensitively', async () => {
      queueTemplateThenFromContact({
        Subject: 'Hi [First_Name]',
        Body: '<a href="[MPP_Verify_Email_URL]">Confirm</a>, [first_name]',
        From_Contact: 7,
      });

      const service = await MessageTemplateService.getInstance();
      await service.sendMessageTemplate(1, { email: 'v@example.com', name: 'V' }, {
        First_Name: 'Ana',
        mpp_verify_email_url: 'https://church.example/verify?t=abc',
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          Subject: 'Hi Ana',
          Body: '<a href="https://church.example/verify?t=abc">Confirm</a>, Ana',
        })
      );
    });

    it('replaces every occurrence of a token', async () => {
      queueTemplateThenFromContact({
        Subject: '[N] and [N]',
        Body: '[N]',
        From_Contact: 7,
      });

      const service = await MessageTemplateService.getInstance();
      await service.sendMessageTemplate(1, { email: 'v@example.com', name: 'V' }, { N: 'x' });

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ Subject: 'x and x', Body: 'x' })
      );
    });

    it('leaves a token the caller supplied no value for untouched', async () => {
      queueTemplateThenFromContact({
        Subject: 'Hi [Unknown_Token]',
        Body: 'body',
        From_Contact: 7,
      });

      const service = await MessageTemplateService.getInstance();
      await service.sendMessageTemplate(1, { email: 'v@example.com', name: 'V' }, {});

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ Subject: 'Hi [Unknown_Token]' })
      );
    });

    it('treats a key with regex metacharacters as a literal', async () => {
      // A naive `new RegExp(key)` would make `a.c` match `abc`.
      queueTemplateThenFromContact({
        Subject: '[a.c] [abc]',
        Body: 'b',
        From_Contact: 7,
      });

      const service = await MessageTemplateService.getInstance();
      await service.sendMessageTemplate(1, { email: 'v@example.com', name: 'V' }, { 'a.c': 'HIT' });

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ Subject: 'HIT [abc]' })
      );
    });
  });

  describe('From address resolution', () => {
    it('throws when the template has no From contact', async () => {
      mockGetTableRecords.mockResolvedValueOnce([
        { Subject: 's', Body: 'b', From_Contact: null },
      ]);

      const service = await MessageTemplateService.getInstance();
      await expect(
        service.sendMessageTemplate(1, { email: 'v@example.com', name: 'V' }, {})
      ).rejects.toThrow('Email template has no valid From contact.');
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('throws when the From contact has no email address', async () => {
      queueTemplateThenFromContact(
        { Subject: 's', Body: 'b', From_Contact: 7 },
        { Contact_ID: 7, First_Name: 'A', Last_Name: 'B', Email_Address: null }
      );

      const service = await MessageTemplateService.getInstance();
      await expect(
        service.sendMessageTemplate(1, { email: 'v@example.com', name: 'V' }, {})
      ).rejects.toThrow('Email template has no valid From contact.');
    });

    it('falls back to the address as display name when the contact is unnamed', async () => {
      queueTemplateThenFromContact(
        { Subject: 's', Body: 'b', From_Contact: 7 },
        { Contact_ID: 7, First_Name: null, Last_Name: null, Email_Address: 'office@church.example' }
      );

      const service = await MessageTemplateService.getInstance();
      await service.sendMessageTemplate(1, { email: 'v@example.com', name: 'V' }, {});

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          FromAddress: { DisplayName: 'office@church.example', Address: 'office@church.example' },
        })
      );
    });

    it('accepts a From_Contact that MP returned as a string', async () => {
      queueTemplateThenFromContact({ Subject: 's', Body: 'b', From_Contact: '7' });

      const service = await MessageTemplateService.getInstance();
      await service.sendMessageTemplate(1, { email: 'v@example.com', name: 'V' }, {});

      expect(mockGetTableRecords).toHaveBeenNthCalledWith(2, {
        table: 'Contacts',
        select: 'Contact_ID,First_Name,Last_Name,Email_Address',
        filter: 'Contact_ID = 7',
        top: 1,
      });
      expect(mockSendMessage).toHaveBeenCalled();
    });
  });

  it('refuses to send with no recipient address', async () => {
    queueTemplateThenFromContact({ Subject: 's', Body: 'b', From_Contact: 7 });

    const service = await MessageTemplateService.getInstance();
    await expect(
      service.sendMessageTemplate(1, { email: '', name: 'V' }, {})
    ).rejects.toThrow('No recipient email address.');
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('tolerates a template row with null subject and body', async () => {
    queueTemplateThenFromContact({ Subject: null, Body: null, From_Contact: 7 });

    const service = await MessageTemplateService.getInstance();
    await service.sendMessageTemplate(1, { email: 'v@example.com', name: 'V' }, { A: 'b' });

    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ Subject: '', Body: '' })
    );
  });
});
