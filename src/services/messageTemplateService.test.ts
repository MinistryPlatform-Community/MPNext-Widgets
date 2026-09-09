import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  MessageTemplateService,
  MessageTemplateError,
  NoFromAddressError,
  NoRecipientError,
  TemplateNotFoundError,
  TemplateSendFailedError,
  renderTemplate,
} from '@/services/messageTemplateService';

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
      ).rejects.toThrow(TemplateNotFoundError);
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
      ).rejects.toThrow(TemplateNotFoundError);
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
      ).rejects.toThrow(NoFromAddressError);
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
      ).rejects.toThrow(NoFromAddressError);
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
    ).rejects.toThrow(NoRecipientError);
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

  describe('HTML escaping of merge values', () => {
    it('escapes a merge value in the body — the stored-XSS case legacy shipped', async () => {
      queueTemplateThenFromContact({
        Subject: 'Prayer request',
        Body: '<div>[Summary]</div>',
        From_Contact: 7,
      });

      const service = await MessageTemplateService.getInstance();
      await service.sendMessageTemplate(1, { email: 'staff@church.example', name: 'S' }, {
        Summary: '<script>fetch("//evil")</script>',
      });

      const body = mockSendMessage.mock.calls[0][0].Body as string;
      expect(body).toBe('<div>&lt;script&gt;fetch(&quot;//evil&quot;)&lt;/script&gt;</div>');
      expect(body).not.toContain('<script>');
    });

    it('escapes a quote so a value cannot break out of an attribute', async () => {
      queueTemplateThenFromContact({
        Subject: 's',
        Body: '<a href="[Url]">go</a>',
        From_Contact: 7,
      });

      const service = await MessageTemplateService.getInstance();
      await service.sendMessageTemplate(1, { email: 'v@example.com', name: 'V' }, {
        Url: '" onmouseover="alert(1)',
      });

      const body = mockSendMessage.mock.calls[0][0].Body as string;
      expect(body).toBe('<a href="&quot; onmouseover=&quot;alert(1)">go</a>');
    });

    it('does NOT escape the subject, which is a plain-text header', async () => {
      // Escaping here would put a literal "&amp;" in the subject line, which
      // the recipient sees. The body of the same send is still escaped.
      queueTemplateThenFromContact({
        Subject: 'Gift from [Name]',
        Body: '<p>[Name]</p>',
        From_Contact: 7,
      });

      const service = await MessageTemplateService.getInstance();
      await service.sendMessageTemplate(1, { email: 'v@example.com', name: 'V' }, {
        Name: 'Doug & Marie',
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          Subject: 'Gift from Doug & Marie',
          Body: '<p>Doug &amp; Marie</p>',
        })
      );
    });

    it('escapes & first, so escapes are not double-escaped', async () => {
      queueTemplateThenFromContact({ Subject: 's', Body: '[V]', From_Contact: 7 });

      const service = await MessageTemplateService.getInstance();
      await service.sendMessageTemplate(1, { email: 'v@example.com', name: 'V' }, {
        V: '<b>&amp;</b>',
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ Body: '&lt;b&gt;&amp;amp;&lt;/b&gt;' })
      );
    });

    it('inserts a $ in a merge value literally, not as a regex backreference', async () => {
      // `String.replace` reads `$&` in the replacement as "the whole match", so
      // an unescaped value containing one would echo the token instead.
      queueTemplateThenFromContact({ Subject: '[Amt]', Body: '[Amt]', From_Contact: 7 });

      const service = await MessageTemplateService.getInstance();
      await service.sendMessageTemplate(1, { email: 'v@example.com', name: 'V' }, {
        Amt: '$&100 $1',
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          Subject: '$&100 $1',
          // The body additionally escapes the `&`, per the rule above.
          Body: '$&amp;100 $1',
        })
      );
    });
  });

  describe('renderTemplate — exported for preview and direct testing', () => {
    it('renders without sending', () => {
      const out = renderTemplate({ subject: 'Hi [N]', body: '<p>[N]</p>' }, { N: 'A & B' });
      expect(out).toEqual({ subject: 'Hi A & B', body: '<p>A &amp; B</p>' });
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('is a no-op on empty subject and body', () => {
      expect(renderTemplate({ subject: '', body: '' }, { N: 'x' })).toEqual({
        subject: '',
        body: '',
      });
    });
  });

  describe('multiple recipients', () => {
    it('sends one message addressed to every recipient', async () => {
      queueTemplateThenFromContact({ Subject: 's', Body: 'b', From_Contact: 7 });

      const service = await MessageTemplateService.getInstance();
      await service.sendMessageTemplate(
        1,
        [
          { email: 'a@example.com', name: 'A' },
          { email: 'b@example.com', name: 'B' },
        ],
        {}
      );

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0][0].ToAddresses).toEqual([
        { DisplayName: 'A', Address: 'a@example.com' },
        { DisplayName: 'B', Address: 'b@example.com' },
      ]);
    });

    it('drops recipients with no address', async () => {
      queueTemplateThenFromContact({ Subject: 's', Body: 'b', From_Contact: 7 });

      const service = await MessageTemplateService.getInstance();
      await service.sendMessageTemplate(
        1,
        [
          { email: '', name: 'A' },
          { email: 'b@example.com', name: 'B' },
        ],
        {}
      );

      expect(mockSendMessage.mock.calls[0][0].ToAddresses).toEqual([
        { DisplayName: 'B', Address: 'b@example.com' },
      ]);
    });

    it('throws when every recipient lacks an address', async () => {
      queueTemplateThenFromContact({ Subject: 's', Body: 'b', From_Contact: 7 });

      const service = await MessageTemplateService.getInstance();
      await expect(
        service.sendMessageTemplate(1, [{ email: '', name: 'A' }], {})
      ).rejects.toThrow(NoRecipientError);
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  describe('fromContactId fallback', () => {
    it('uses the caller fallback when the template has no From_Contact', async () => {
      mockGetTableRecords.mockResolvedValueOnce([
        { Subject: 's', Body: 'b', From_Contact: null },
      ]);
      mockGetTableRecords.mockResolvedValueOnce([
        {
          Contact_ID: 99,
          First_Name: 'Office',
          Last_Name: null,
          Email_Address: 'office@church.example',
        },
      ]);

      const service = await MessageTemplateService.getInstance();
      await service.sendMessageTemplate(
        1,
        { email: 'v@example.com', name: 'V' },
        {},
        { fromContactId: 99 }
      );

      expect(mockGetTableRecords).toHaveBeenNthCalledWith(2, {
        table: 'Contacts',
        select: 'Contact_ID,First_Name,Last_Name,Email_Address',
        filter: 'Contact_ID = 99',
        top: 1,
      });
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          FromAddress: { DisplayName: 'Office', Address: 'office@church.example' },
        })
      );
    });

    it("prefers the template's own From_Contact over the fallback", async () => {
      queueTemplateThenFromContact({ Subject: 's', Body: 'b', From_Contact: 7 });

      const service = await MessageTemplateService.getInstance();
      await service.sendMessageTemplate(
        1,
        { email: 'v@example.com', name: 'V' },
        {},
        { fromContactId: 99 }
      );

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          FromAddress: { DisplayName: 'Grace Okafor', Address: 'grace@church.example' },
        })
      );
    });

    it('falls through to the fallback when the template contact has no email', async () => {
      mockGetTableRecords.mockResolvedValueOnce([
        { Subject: 's', Body: 'b', From_Contact: 7 },
      ]);
      mockGetTableRecords.mockResolvedValueOnce([
        { Contact_ID: 7, First_Name: 'No', Last_Name: 'Mail', Email_Address: null },
      ]);
      mockGetTableRecords.mockResolvedValueOnce([
        {
          Contact_ID: 99,
          First_Name: null,
          Last_Name: null,
          Email_Address: 'office@church.example',
        },
      ]);

      const service = await MessageTemplateService.getInstance();
      await service.sendMessageTemplate(
        1,
        { email: 'v@example.com', name: 'V' },
        {},
        { fromContactId: 99 }
      );

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          FromAddress: { DisplayName: 'office@church.example', Address: 'office@church.example' },
        })
      );
    });
  });

  describe('error taxonomy', () => {
    it('wraps a send failure as TemplateSendFailedError, not a config error', async () => {
      queueTemplateThenFromContact({ Subject: 's', Body: 'b', From_Contact: 7 });
      mockSendMessage.mockRejectedValueOnce(new Error('MP 503'));

      const service = await MessageTemplateService.getInstance();
      await expect(
        service.sendMessageTemplate(1, { email: 'v@example.com', name: 'V' }, {})
      ).rejects.toThrow(TemplateSendFailedError);
    });

    it('every error is a MessageTemplateError, so a route can catch one class', async () => {
      mockGetTableRecords.mockResolvedValueOnce([]);

      const service = await MessageTemplateService.getInstance();
      await expect(
        service.sendMessageTemplate(1, { email: 'v@example.com', name: 'V' }, {})
      ).rejects.toThrow(MessageTemplateError);
    });

    it('names the template id and table on a not-found error', async () => {
      mockGetTableRecords.mockResolvedValueOnce([]);

      const service = await MessageTemplateService.getInstance();
      const err = await service
        .sendMessageTemplate(404, { email: 'v@example.com', name: 'V' }, {})
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(TemplateNotFoundError);
      expect((err as TemplateNotFoundError).templateId).toBe(404);
      expect((err as Error).message).toContain('dp_Communications');
    });
  });
});
