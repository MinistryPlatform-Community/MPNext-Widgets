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
 *
 * ## Merge values are HTML-escaped, with no opt-out
 *
 * A template `Body` is HTML and the values substituted into it are not: they
 * are congregant-authored text (a prayer request), a person's name, or a URL.
 * The legacy .NET widget substituted them raw, which made every one of these
 * templates a stored-XSS vector into a staff mailbox — type a `<script>` into a
 * public prayer form and it renders in whatever reads the notification.
 *
 * So substitution escapes, and there is deliberately **no flag to turn it off**.
 * An opt-out would be reached for the first time someone wanted bold text in a
 * merge value and would silently re-open the hole for every other caller. A
 * template that needs markup puts the markup in the template, which is where
 * the church authors it anyway. Escaping is also correct inside an attribute —
 * `&` → `&amp;` in an `href` is what HTML requires — so URLs pass through
 * unharmed.
 */

/** Where a rendered template is sent. */
export interface TemplateRecipient {
  email: string;
  /** Display name for the `To:` header. May be empty. */
  name: string;
}

/** `[Token_Name]` → replacement, matched case-insensitively. */
export type TemplateMergeData = Record<string, string>;

export interface SendTemplateOptions {
  /**
   * Used when the template row carries no `From_Contact`. Lets a caller that
   * knows a sensible sender (a congregation's own contact, say) supply one,
   * without this service inventing a global default.
   */
  fromContactId?: number;
}

/**
 * Base class for the failures a caller may want to distinguish. Routes branch
 * on these rather than string-matching a message, so a church misconfiguration
 * (`template_not_configured`) is not reported as a transient send failure
 * (`email_send_failed`).
 */
export class MessageTemplateError extends Error {}

/** The configured template id does not exist in the table it should be in. */
export class TemplateNotFoundError extends MessageTemplateError {
  constructor(public readonly templateId: number, table: string) {
    super(`Template ${templateId} not found in ${table}.`);
    this.name = "TemplateNotFoundError";
  }
}

/** The template has no `From_Contact`, and no fallback was supplied. */
export class NoFromAddressError extends MessageTemplateError {
  constructor(public readonly templateId: number) {
    super(`Template ${templateId} has no valid From contact.`);
    this.name = "NoFromAddressError";
  }
}

/** MP accepted the request but the send itself failed. */
export class TemplateSendFailedError extends MessageTemplateError {
  constructor(cause: unknown) {
    super(`Sending a template message failed: ${String(cause)}`);
    this.name = "TemplateSendFailedError";
    this.cause = cause;
  }
}

/** No recipient address to send to. */
export class NoRecipientError extends MessageTemplateError {
  constructor() {
    super("No recipient email address.");
    this.name = "NoRecipientError";
  }
}

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

/**
 * Escape a merge value for insertion into an HTML template body.
 *
 * `&` first, or the escapes introduced by the later replacements get
 * double-escaped. Quotes are included because a value may land inside an
 * attribute (`href="[MPP_Verify_Email_URL]"`), where an unescaped `"` ends the
 * attribute and everything after it becomes markup.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Substitute one `[key]` merge token, case-insensitively. */
function replaceToken(text: string, key: string, value: string): string {
  if (!text) return text;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // `$` in the replacement is a backreference to the regex engine (`$&`, `$1`),
  // so a merge value containing one would corrupt the output. `$$` is the
  // literal.
  const safeValue = value.replace(/\$/g, "$$$$");
  return text.replace(new RegExp(`\\[${escaped}\\]`, "gi"), safeValue);
}

/**
 * Render a template's subject and body against merge data, without sending.
 *
 * **The body is escaped and the subject is not**, because they are different
 * media: a template `Body` is HTML, while an email `Subject` is a plain-text
 * header. Escaping the subject too would be the obvious-looking mistake — it
 * puts a literal `&amp;` in the subject line of every email about "Doug &
 * Marie", which the recipient sees.
 *
 * Exported so the substitution rules can be tested directly, and so a caller
 * that wants to preview church-authored copy does not have to send an email to
 * see it.
 */
export function renderTemplate(
  template: { subject: string; body: string },
  merge: TemplateMergeData
): { subject: string; body: string } {
  let subject = template.subject;
  let body = template.body;
  for (const [key, value] of Object.entries(merge)) {
    subject = replaceToken(subject, key, value);
    body = replaceToken(body, key, escapeHtml(value));
  }
  return { subject, body };
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
    to: TemplateRecipient | TemplateRecipient[],
    merge: TemplateMergeData,
    options: SendTemplateOptions = {}
  ): Promise<void> {
    const template = await this.getMessageTemplate(templateId);
    if (!template) throw new TemplateNotFoundError(templateId, "dp_Communications");
    await this.renderAndSend(templateId, template, to, merge, options);
  }

  /** Render and send a `dp_Communication_Templates` template. */
  public async sendCommunicationTemplate(
    templateId: number,
    to: TemplateRecipient | TemplateRecipient[],
    merge: TemplateMergeData,
    options: SendTemplateOptions = {}
  ): Promise<void> {
    const template = await this.getCommunicationTemplate(templateId);
    if (!template) throw new TemplateNotFoundError(templateId, "dp_Communication_Templates");
    await this.renderAndSend(templateId, template, to, merge, options);
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
    templateId: number,
    template: MessageTemplate,
    to: TemplateRecipient | TemplateRecipient[],
    merge: TemplateMergeData,
    options: SendTemplateOptions
  ): Promise<void> {
    const recipients = (Array.isArray(to) ? to : [to]).filter((r) => Boolean(r.email));
    if (recipients.length === 0) throw new NoRecipientError();

    const from = await this.resolveFromAddress(templateId, template.fromContactId, options);
    const { subject, body } = renderTemplate(template, merge);

    try {
      await this.mp!.sendMessage({
        FromAddress: from,
        ToAddresses: recipients.map((r) => ({ DisplayName: r.name, Address: r.email })),
        Subject: subject,
        Body: body,
      });
    } catch (error) {
      // Distinguished from the misconfiguration errors above so a route can
      // answer `email_send_failed` (transient, worth retrying) rather than
      // `template_not_configured` (the church must fix something).
      throw new TemplateSendFailedError(error);
    }
  }

  /**
   * The From address is the template's own From contact, falling back to a
   * caller-supplied `fromContactId`.
   *
   * There is deliberately no *global* default sender: an email that appears to
   * come from the wrong person is worse than an email that does not send, and
   * the failure points straight at the template the church needs to fix. A
   * per-call fallback is a different thing — the caller knows a specific
   * sensible sender for that one flow (a congregation's own contact, say) and
   * is stating it explicitly at the call site.
   */
  private async resolveFromAddress(
    templateId: number,
    fromContactId: number | null,
    options: SendTemplateOptions
  ): Promise<{ DisplayName: string; Address: string }> {
    const candidates = [fromContactId, options.fromContactId ?? null];
    for (const candidate of candidates) {
      if (candidate == null) continue;
      const contact = await this.getContactById(candidate);
      if (contact?.Email_Address) {
        const name = `${contact.First_Name ?? ""} ${contact.Last_Name ?? ""}`.trim();
        return { DisplayName: name || contact.Email_Address, Address: contact.Email_Address };
      }
    }
    throw new NoFromAddressError(templateId);
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
