import { MPHelper } from "@/lib/providers/ministry-platform";

/**
 * Render a MinistryPlatform message template and send it.
 *
 * MP's REST layer has **no "send from template" call**. The only way to send
 * church-authored copy is to read the template row yourself, substitute its
 * merge tokens, and post the result to the communications endpoint. That was
 * implemented inline in `planYourVisitService.ts`; it is extracted here because
 * four widgets need it — `next-plan-your-visit` (verification + church
 * notification), `next-prayer-feedback` (acknowledgement, C69),
 * `next-subscribe-to-publication` (verification, C70), and it is already wanted
 * by C11 (group inquiry/sign-up) and C66 (checkout receipt). Four hand-rolled
 * copies of a token-substituting email sender is how a fleet of widgets ends up
 * with four different bugs in the same feature.
 *
 * ## The two template tables are not interchangeable
 *
 * MP stores church-authored email copy in two places with different column
 * names, and a widget's configured id refers to exactly one of them:
 *
 * | Table | Subject | Body | Configured as |
 * |---|---|---|---|
 * | `dp_Communications` | `Subject` | `Body` | "message template" ids |
 * | `dp_Communication_Templates` | `Subject_Text` | `Body_HTML` | "communication template" ids |
 *
 * So this service exposes **two named methods rather than one call with a
 * flag** — the caller always knows which kind of id it was handed, and a flag
 * would only create a way to get it wrong. Reading the wrong table yields "not
 * found" for an id that exists, which is a confusing failure to debug.
 *
 * ## Merge tokens
 *
 * MP's convention is `[Token_Name]`, matched case-insensitively, which is why
 * substitution is a regex over an escaped key rather than a string replace.
 * Tokens absent from the template are simply not substituted; tokens in the
 * template with no supplied value are left as-is, exactly as MP's own send
 * pipeline leaves them.
 */

/** Where a rendered template is sent. */
export interface TemplateRecipient {
  email: string;
  /** Display name for the `To:` header. May be empty. */
  name: string;
}

/** `[Token_Name]` → replacement, matched case-insensitively. */
export type TemplateMergeData = Record<string, string>;

interface MessageTemplate {
  subject: string;
  body: string;
  fromContactId: number | null;
}

interface ContactRow {
  Contact_ID: number | string;
  First_Name: string | null;
  Last_Name: string | null;
  Email_Address: string | null;
}

function toNumberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

/** Substitute one `[key]` merge token, case-insensitively. */
function replaceToken(text: string, key: string, value: string): string {
  if (!text) return text;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`\\[${escaped}\\]`, "gi"), value);
}

export class MessageTemplateService {
  private static instance: MessageTemplateService;
  private mp: MPHelper | null = null;

  private constructor() {
    this.initialize();
  }

  public static async getInstance(): Promise<MessageTemplateService> {
    if (!MessageTemplateService.instance) {
      MessageTemplateService.instance = new MessageTemplateService();
      await MessageTemplateService.instance.initialize();
    }
    return MessageTemplateService.instance;
  }

  private async initialize(): Promise<void> {
    this.mp = new MPHelper();
  }

  /**
   * Render and send a `dp_Communications` message template.
   *
   * Throws when the template id does not exist, or when the template has no
   * usable From contact — both are church misconfiguration, and failing loudly
   * is right: silently not sending an acknowledgement email looks identical to
   * a working widget from the outside. Callers for whom the email is
   * best-effort (a church notification, say) should `.catch()` explicitly, so
   * that choice is visible at the call site.
   */
  public async sendMessageTemplate(
    templateId: number,
    to: TemplateRecipient,
    merge: TemplateMergeData
  ): Promise<void> {
    const template = await this.getMessageTemplate(templateId);
    if (!template) throw new Error(`Email template ${templateId} not found.`);
    await this.renderAndSend(template, to, merge);
  }

  /** Render and send a `dp_Communication_Templates` template. */
  public async sendCommunicationTemplate(
    templateId: number,
    to: TemplateRecipient,
    merge: TemplateMergeData
  ): Promise<void> {
    const template = await this.getCommunicationTemplate(templateId);
    if (!template) throw new Error(`Communication template ${templateId} not found.`);
    await this.renderAndSend(template, to, merge);
  }

  /** Read a `dp_Communications` message template. */
  private async getMessageTemplate(id: number): Promise<MessageTemplate | null> {
    const rows = await this.mp!.getTableRecords<{
      Subject: string | null;
      Body: string | null;
      From_Contact: number | string | null;
    }>({
      table: "dp_Communications",
      select: "Subject, Body, From_Contact",
      filter: `Communication_ID = ${id}`,
      top: 1,
    });
    const r = rows[0];
    if (!r) return null;
    return {
      subject: r.Subject ?? "",
      body: r.Body ?? "",
      fromContactId: toNumberOrNull(r.From_Contact),
    };
  }

  /** Read a `dp_Communication_Templates` template. */
  private async getCommunicationTemplate(id: number): Promise<MessageTemplate | null> {
    const rows = await this.mp!.getTableRecords<{
      Subject_Text: string | null;
      Body_HTML: string | null;
      From_Contact: number | string | null;
    }>({
      table: "dp_Communication_Templates",
      select: "Subject_Text, Body_HTML, From_Contact",
      filter: `Communication_Template_ID = ${id}`,
      top: 1,
    });
    const r = rows[0];
    if (!r) return null;
    return {
      subject: r.Subject_Text ?? "",
      body: r.Body_HTML ?? "",
      fromContactId: toNumberOrNull(r.From_Contact),
    };
  }

  private async renderAndSend(
    template: MessageTemplate,
    to: TemplateRecipient,
    merge: TemplateMergeData
  ): Promise<void> {
    if (!to.email) throw new Error("No recipient email address.");

    const from = await this.resolveFromAddress(template.fromContactId);

    let subject = template.subject;
    let body = template.body;
    for (const [key, value] of Object.entries(merge)) {
      subject = replaceToken(subject, key, value);
      body = replaceToken(body, key, value);
    }

    await this.mp!.sendMessage({
      FromAddress: from,
      ToAddresses: [{ DisplayName: to.name, Address: to.email }],
      Subject: subject,
      Body: body,
    });
  }

  /**
   * The From address is the template's own From contact. There is deliberately
   * no fallback to a configured default: an email that appears to come from the
   * wrong person is worse than an email that does not send, and the failure
   * points straight at the template the church needs to fix.
   */
  private async resolveFromAddress(
    fromContactId: number | null
  ): Promise<{ DisplayName: string; Address: string }> {
    if (fromContactId != null) {
      const contact = await this.getContactById(fromContactId);
      if (contact?.Email_Address) {
        const name = `${contact.First_Name ?? ""} ${contact.Last_Name ?? ""}`.trim();
        return { DisplayName: name || contact.Email_Address, Address: contact.Email_Address };
      }
    }
    throw new Error("Email template has no valid From contact.");
  }

  private async getContactById(contactId: number): Promise<ContactRow | null> {
    const rows = await this.mp!.getTableRecords<ContactRow>({
      table: "Contacts",
      select: "Contact_ID,First_Name,Last_Name,Email_Address",
      filter: `Contact_ID = ${contactId}`,
      top: 1,
    });
    return rows[0] ?? null;
  }
}
