import { MPHelper } from "@/lib/providers/ministry-platform";
import { getEnv, getEnvOptional } from "@/lib/env";
import { DomainTimezoneService } from "@/services/domainTimezoneService";
import { EventDetailsService } from "@/services/eventDetailsService";
import { ProductsService } from "@/services/productsService";
import { CustomFormService } from "@/services/customFormService";
import type { Product } from "@mpnext/types";

/**
 * Write orchestration for event registration, migrated from the legacy
 * EventsService.SaveRegistration / CheckoutService.DeleteEventRegistration.
 *
 * Scope: builds the invoice (Invoices + Invoice_Detail), event participant
 * (Event_Participants), and custom-form responses (Form_Response +
 * Form_Response_Answers), then returns the Invoice_GUID. Actual PAYMENT
 * collection is intentionally out of scope (the legacy widget likewise only
 * builds the invoice and redirects the browser to a separate checkout widget).
 *
 * The purchaser/recipient contact + address are serialized into the
 * Invoices.Notes / Event_Participants.Notes "Label: value" block, matching the
 * legacy format so EventDetailsService can parse them back on reload.
 */

// MP status IDs (from legacy EventParticipant / InvoiceStatus enums).
const PARTICIPATION_REGISTERED = 2;
const PARTICIPATION_CANCELLED = 5;
const PARTICIPATION_AWAITING_PAYMENT = 21;
const INVOICE_NONE_PAID = 1;
const INVOICE_PAID_IN_FULL = 3;
const INVOICE_CANCELLED = 7;

interface AttendeeFields {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  isMinor: boolean;
  minorFirstName: string;
  minorLastName: string;
  minorDateOfBirth: string;
  parentFirstName: string;
  parentLastName: string;
  parentEmail: string;
  parentPhone: string;
}

interface InvoiceLine {
  recipientContactId: number | null;
  recipientName: string;
  itemName: string;
  itemNote: string;
  quantity: number;
  lineTotal: number;
  productId: number | null;
  productOptionPriceId: number | null;
  depositRequested: boolean;
  invoiceDetailId: number | null;
}

interface InvoiceRow {
  Invoice_ID: number;
  Invoice_GUID: string;
}

export class RegistrationService {
  private static instance: RegistrationService;
  private mp: MPHelper | null = null;
  private defaultParticipantTypeId: number;

  private constructor() {
    // Tenant-specific default; legacy reads config `defaultParticipantType`.
    const raw = getEnvOptional("MPPW_DEFAULT_PARTICIPANT_TYPE_ID");
    this.defaultParticipantTypeId = raw ? parseInt(raw, 10) : 1;
    this.initialize();
  }

  public static async getInstance(): Promise<RegistrationService> {
    if (!RegistrationService.instance) {
      RegistrationService.instance = new RegistrationService();
      await RegistrationService.instance.initialize();
    }
    return RegistrationService.instance;
  }

  private async initialize(): Promise<void> {
    this.mp = new MPHelper();
    // Touch env early so misconfiguration fails fast and predictably.
    getEnv("MINISTRY_PLATFORM_BASE_URL");
  }

  // ───────────────────────────────────────────────────────────────────────
  // Save registration
  // ───────────────────────────────────────────────────────────────────────

  public async saveRegistration(
    payload: Record<string, string>,
    userId: number | null
  ): Promise<{ success: boolean; guid: string | null; message?: string }> {
    const eventId = Number(payload.EventId);
    if (!eventId) throw new Error("Missing EventId");

    const details = await EventDetailsService.getInstance();
    const products = await ProductsService.getInstance();

    const event = await details.getEventById(eventId, false);
    if (event.isRegistrationFull) {
      return { success: false, guid: null, message: "registrationFullMessage" };
    }

    const attendee = this.readAttendeeFields(payload);
    const productId =
      event.registrationProductId ??
      (payload.ProductId ? Number(payload.ProductId) : null);

    // Resolve the attendee contact + participant (authenticated path provides
    // ContactId; otherwise best-effort match, else create).
    const attendeeContactId = await this.resolveContactId(payload, attendee);
    const participantId = await this.resolveParticipantId(attendeeContactId, userId);

    // Purchaser is the parent for a minor registration, else the attendee.
    const parentContactId = attendee.isMinor
      ? Number(payload.CurrentUserContactId) || attendeeContactId
      : attendeeContactId;

    // Build invoice line items from the selected product options + promos.
    let product: Product | null = null;
    if (productId) {
      product = await products.getProduct(
        productId,
        eventId,
        payload.EventParticipantId ? Number(payload.EventParticipantId) : null
      );
    }
    const lines = await this.buildInvoiceLines(
      payload,
      product,
      attendee,
      attendeeContactId
    );
    const total = this.calculateInvoiceTotal(lines);
    const isFree = total <= 0;

    // Event participant (created first so the form response + invoice details
    // can both reference Event_Participant_ID).
    const notes = this.buildNotes(attendee);
    const eventParticipantId = await this.createEventParticipant({
      eventId,
      participantId,
      status: isFree ? PARTICIPATION_REGISTERED : PARTICIPATION_AWAITING_PAYMENT,
      notes,
    });

    // Custom-form response, linked to the participant so it round-trips on
    // reload (EventDetailsService reads Form_Responses by Event_Participant_ID).
    const formResponseId = await this.saveFormResponse(
      payload,
      event.customFormId,
      attendeeContactId,
      eventId,
      eventParticipantId
    );

    // Stamp the participant id onto the line items.
    for (const line of lines) line.recipientContactId ??= attendeeContactId;

    // Invoice: add to an existing one (multi-person) or create new.
    const existingGuid = payload.InvoiceId?.trim();
    let invoiceGuid: string | null;
    if (existingGuid) {
      invoiceGuid = await this.addToExistingInvoice(
        existingGuid,
        lines,
        eventParticipantId
      );
    } else {
      invoiceGuid = await this.createInvoice({
        purchaserContactId: parentContactId,
        total,
        statusId: isFree ? INVOICE_PAID_IN_FULL : INVOICE_NONE_PAID,
        notes,
        formResponseId,
        lines,
        eventParticipantId,
      });
    }

    return { success: true, guid: invoiceGuid };
  }

  // ── Field reading ──

  private readAttendeeFields(p: Record<string, string>): AttendeeFields {
    return {
      firstName: p.FirstName ?? "",
      lastName: p.LastName ?? "",
      email: p.EmailAddress ?? "",
      phone: p.MobilePhoneNumber ?? "",
      addressLine1: p.AddressLine1 ?? "",
      addressLine2: p.AddressLine2 ?? "",
      city: p.City ?? "",
      state: p.StateRegion ?? "",
      postalCode: p.PostalCode ?? "",
      isMinor: p.IsMinorRegistration === "true",
      minorFirstName: p.attendeeFirstName ?? "",
      minorLastName: p.attendeeLastName ?? "",
      minorDateOfBirth: p.attendeeDateOfBirth ?? "",
      parentFirstName: p.parentFirstName ?? "",
      parentLastName: p.parentLastName ?? "",
      parentEmail: p.parentEmailAddress ?? "",
      parentPhone: p.parentMobilePhoneNumber ?? "",
    };
  }

  /**
   * Serialize contact + address into the legacy "Label: value\r\n" Notes block.
   * Mirrors BasicContact.ToString / ApiHelper note format so the values can be
   * parsed back by EventDetailsService.getEventParticipantsByInvoice.
   */
  private buildNotes(a: AttendeeFields): string {
    const lines: string[] = [];
    const first = a.isMinor ? a.parentFirstName : a.firstName;
    const last = a.isMinor ? a.parentLastName : a.lastName;
    const email = a.isMinor ? a.parentEmail : a.email;
    const phone = a.isMinor ? a.parentPhone : a.phone;

    lines.push(`First Name: ${first}`);
    lines.push(`Last Name: ${last}`);
    lines.push(`Phone: ${phone}`);
    lines.push(`Email: ${email}`);
    lines.push(`Address Line 1: ${a.addressLine1}`);
    lines.push(`Address Line 2: ${a.addressLine2}`);
    lines.push(`City: ${a.city}`);
    lines.push(`State: ${a.state}`);
    lines.push(`Postal Code: ${a.postalCode}`);
    if (a.isMinor) {
      lines.push(`Minor First Name: ${a.minorFirstName}`);
      lines.push(`Minor Last Name: ${a.minorLastName}`);
      lines.push(`Minor Date of Birth: ${a.minorDateOfBirth}`);
    }
    return lines.join("\r\n") + "\r\n";
  }

  // ── Contact / participant resolution ──

  private async resolveContactId(
    payload: Record<string, string>,
    attendee: AttendeeFields
  ): Promise<number> {
    const provided = payload.ContactId?.trim();
    if (provided && provided !== "Blank Form" && !Number.isNaN(Number(provided))) {
      return Number(provided);
    }

    // Best-effort fuzzy match (legacy ContactManager.FindContact).
    const first = this.sqlEscape(attendee.isMinor ? attendee.parentFirstName : attendee.firstName);
    const last = this.sqlEscape(attendee.isMinor ? attendee.parentLastName : attendee.lastName);
    const email = this.sqlEscape(attendee.isMinor ? attendee.parentEmail : attendee.email);
    const phone = this.sqlEscape(attendee.isMinor ? attendee.parentPhone : attendee.phone);

    if (last && (email || phone)) {
      const conds: string[] = [`Last_Name = '${last}'`];
      if (first) conds.push(`(First_Name = '${first}' OR Nickname = '${first}')`);
      const contactConds: string[] = [];
      if (email) contactConds.push(`Email_Address = '${email}'`);
      if (phone) contactConds.push(`Mobile_Phone = '${phone}'`);
      if (contactConds.length) conds.push(`(${contactConds.join(" OR ")})`);

      const matches = await this.mp!.getTableRecords<{ Contact_ID: number }>({
        table: "Contacts",
        select: "Contact_ID",
        filter: conds.join(" AND "),
        top: 1,
      });
      if (matches[0]) return matches[0].Contact_ID;
    }

    // No match: create a new contact. Tenant-specific required fields
    // (household, congregation) make full anonymous creation tenant-dependent;
    // create a minimal Contact and let MP apply its defaults.
    const display = `${last}, ${first}`.replace(/^, |, $/g, "").trim() || "Web Registrant";
    const contactRecord: Record<string, unknown> = {
      Display_Name: display,
      First_Name: attendee.isMinor ? attendee.parentFirstName : attendee.firstName,
      Last_Name: attendee.isMinor ? attendee.parentLastName : attendee.lastName,
      Email_Address: attendee.isMinor ? attendee.parentEmail : attendee.email,
      Mobile_Phone: attendee.isMinor ? attendee.parentPhone : attendee.phone,
      Contact_Status_ID: 1,
      Company: false,
    };
    const created = (await this.mp!.createTableRecords("Contacts", [contactRecord])) as Array<{
      Contact_ID?: number;
    }>;
    if (!created[0]?.Contact_ID) {
      throw new Error("Unable to resolve or create a contact for registration.");
    }
    return created[0].Contact_ID;
  }

  private async resolveParticipantId(
    contactId: number,
    userId: number | null
  ): Promise<number> {
    const existing = await this.mp!.getTableRecords<{ Participant_ID: number }>({
      table: "Participants",
      select: "Participant_ID",
      filter: `Contact_ID = ${contactId}`,
      top: 1,
    });
    if (existing[0]?.Participant_ID) return existing[0].Participant_ID;

    const tz = DomainTimezoneService.getInstance();
    const now = await tz.toMpSqlDatetime(new Date().toISOString());
    const participantRecord: Record<string, unknown> = {
      Contact_ID: contactId,
      Participant_Type_ID: this.defaultParticipantTypeId,
      Participant_Start_Date: now,
      Notes: "Created by Web Widget",
    };
    const created = (await this.mp!.createTableRecords(
      "Participants",
      [participantRecord],
      userId ? { $userId: userId } : undefined
    )) as Array<{ Participant_ID?: number }>;
    if (!created[0]?.Participant_ID) {
      throw new Error("Unable to create participant for registration.");
    }
    return created[0].Participant_ID;
  }

  // ── Invoice line items ──

  private async buildInvoiceLines(
    payload: Record<string, string>,
    product: Product | null,
    attendee: AttendeeFields,
    contactId: number
  ): Promise<InvoiceLine[]> {
    const lines: InvoiceLine[] = [];
    if (!product) return lines;

    const recipientName = `${attendee.firstName} ${attendee.lastName}`.trim().slice(0, 75);
    const depositRequested = payload.DepositRequested === "deposit";

    // Base product row.
    lines.push({
      recipientContactId: contactId,
      recipientName,
      itemName: product.productName ?? "Registration",
      itemNote: "",
      quantity: 1,
      lineTotal: product.basePrice,
      productId: product.productId,
      productOptionPriceId: null,
      depositRequested,
      invoiceDetailId: this.parseDetailId(payload[`product-invoice-detail_${product.productId}`]),
    });

    // Option rows (radios + checkboxes), looked up against the product schema.
    for (const group of product.optionGroups) {
      const radioVal = payload[`product-radio_${group.optionGroupId}`];
      for (const price of group.optionPrices) {
        const isRadioSelected =
          group.mutuallyExclusive && radioVal === String(price.optionPriceId);
        const checkboxKey = `product-checkbox_${group.optionGroupId}_${price.optionPriceId}`;
        const isCheckboxSelected =
          !group.mutuallyExclusive && payload[checkboxKey] != null;
        if (!isRadioSelected && !isCheckboxSelected) continue;

        const qty = Math.max(
          1,
          Number(payload[`product-qty_${group.optionGroupId}_${price.optionPriceId}`]) || 1
        );
        const note = payload[`product-note_${group.optionGroupId}_${price.optionPriceId}`] ?? "";
        lines.push({
          recipientContactId: contactId,
          recipientName,
          itemName: price.optionTitle ?? "Option",
          itemNote: note,
          quantity: qty,
          lineTotal: price.optionPrice * qty,
          productId: product.productId,
          productOptionPriceId: price.optionPriceId,
          depositRequested: false,
          invoiceDetailId: this.parseDetailId(
            payload[`product-option-invoice-detail_${group.optionGroupId}_${price.optionPriceId}`]
          ),
        });
      }
    }

    // Promo rows: re-validate server-side (never trust the client amount).
    const products = await ProductsService.getInstance();
    for (const key of Object.keys(payload)) {
      if (!key.startsWith("promo_")) continue;
      const code = payload[key];
      if (!code) continue;
      const promo = await products.validPromoCode(product.productId, code, true);
      if (!promo.isValidPromoCode || promo.promoCodePrice === 0) continue;
      lines.push({
        recipientContactId: contactId,
        recipientName,
        itemName: promo.optionTitle ?? "Promo Code",
        itemNote: `Promo Code: ${code}`,
        quantity: 1,
        lineTotal: promo.promoCodePrice,
        productId: product.productId,
        productOptionPriceId: promo.optionPriceId,
        depositRequested: false,
        invoiceDetailId: null,
      });
    }

    return lines;
  }

  private calculateInvoiceTotal(lines: InvoiceLine[]): number {
    const sum = lines.reduce((acc, l) => acc + l.lineTotal, 0);
    return Math.max(0, Number(sum.toFixed(2)));
  }

  // ── Writes ──

  private async createEventParticipant(args: {
    eventId: number;
    participantId: number;
    status: number;
    notes: string;
  }): Promise<number> {
    const participantRecord: Record<string, unknown> = {
      Participation_Status_ID: args.status,
      Event_ID: args.eventId,
      Participant_ID: args.participantId,
      Notes: args.notes,
    };
    const created = (await this.mp!.createTableRecords("Event_Participants", [
      participantRecord,
    ])) as Array<{ Event_Participant_ID?: number }>;
    if (!created[0]?.Event_Participant_ID) {
      throw new Error("Failed to create event participant.");
    }
    return created[0].Event_Participant_ID;
  }

  private async createInvoice(args: {
    purchaserContactId: number;
    total: number;
    statusId: number;
    notes: string;
    formResponseId: number | null;
    lines: InvoiceLine[];
    eventParticipantId: number;
  }): Promise<string> {
    const tz = DomainTimezoneService.getInstance();
    const now = await tz.toMpSqlDatetime(new Date().toISOString());

    const invoiceRecord: Record<string, unknown> = {
      Purchaser_Contact_ID: args.purchaserContactId,
      Invoice_Total: args.total,
      Invoice_Status_ID: args.statusId,
      Invoice_Date: now,
      Notes: args.notes,
      Currency: "USD",
      Invoice_Source: 1,
    };
    if (args.formResponseId) invoiceRecord.Form_Response_ID = args.formResponseId;

    const created = (await this.mp!.createTableRecords("Invoices", [
      invoiceRecord,
    ])) as unknown as InvoiceRow[];
    const invoice = created[0];
    if (!invoice?.Invoice_ID || !invoice?.Invoice_GUID) {
      throw new Error("Failed to create invoice.");
    }

    await this.createInvoiceDetails(invoice.Invoice_ID, args.lines, args.eventParticipantId);
    return invoice.Invoice_GUID;
  }

  private async addToExistingInvoice(
    invoiceGuid: string,
    lines: InvoiceLine[],
    eventParticipantId: number
  ): Promise<string> {
    const guid = this.sqlEscape(invoiceGuid);
    const invoices = await this.mp!.getTableRecords<{
      Invoice_ID: number;
      Invoice_GUID: string;
      Invoice_Total: number;
      Invoice_Status_ID: number;
    }>({
      table: "Invoices",
      select: "Invoice_ID,Invoice_GUID,Invoice_Total,Invoice_Status_ID",
      filter: `Invoice_GUID = '${guid}'`,
      top: 1,
    });
    const invoice = invoices[0];
    if (!invoice) throw new Error("Existing invoice not found.");
    if (invoice.Invoice_Status_ID === INVOICE_CANCELLED) {
      throw new Error("INVOICE-EXPIRED");
    }

    await this.createInvoiceDetails(invoice.Invoice_ID, lines, eventParticipantId);

    const added = this.calculateInvoiceTotal(lines);
    const newTotal = Number(((invoice.Invoice_Total ?? 0) + added).toFixed(2));
    await this.mp!.updateTableRecords("Invoices", [
      { Invoice_ID: invoice.Invoice_ID, Invoice_Total: newTotal },
    ]);

    return invoice.Invoice_GUID;
  }

  private async createInvoiceDetails(
    invoiceId: number,
    lines: InvoiceLine[],
    eventParticipantId: number
  ): Promise<void> {
    if (lines.length === 0) return;
    const records = lines.map((l) => {
      const rec: Record<string, unknown> = {
        Invoice_ID: invoiceId,
        Recipient_Contact_ID: l.recipientContactId,
        Recipient_Name: l.recipientName,
        Item_Name: l.itemName,
        Item_Quantity: l.quantity,
        Item_Note: l.itemNote,
        Line_Total: l.lineTotal,
        Event_Participant_ID: eventParticipantId,
      };
      if (l.productId) rec.Product_ID = l.productId;
      if (l.productOptionPriceId) rec.Product_Option_Price_ID = l.productOptionPriceId;
      if (l.depositRequested) rec.Deposit_Requested = true;
      return rec;
    });
    await this.mp!.createTableRecords("Invoice_Detail", records);
  }

  // ── Custom form ──

  /**
   * Persist the custom-form answers from the registration payload. Delegates to
   * the shared CustomFormService so the standalone form widget and event
   * registration use one implementation; the Event_Participant_ID links the
   * response so it round-trips on reload.
   */
  private async saveFormResponse(
    payload: Record<string, string>,
    formId: number | null,
    contactId: number,
    eventId: number,
    eventParticipantId: number
  ): Promise<number | null> {
    if (!formId) return null;
    const forms = await CustomFormService.getInstance();
    const answers = forms.extractAnswers(payload);
    if (answers.length === 0) return null;
    return forms.saveFormResponse({
      formId,
      contactId,
      eventId,
      eventParticipantId,
      answers,
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // Delete registration (remove a participant from an in-progress invoice)
  // ───────────────────────────────────────────────────────────────────────

  public async deleteEventRegistration(
    invoiceDetailId: number,
    mpContactId?: number
  ): Promise<{ success: boolean; message?: string }> {
    // Find the invoice + the participant this detail belongs to.
    const detail = await this.mp!.getTableRecords<{
      Invoice_Detail_ID: number;
      Invoice_ID: number;
      Event_Participant_ID: number | null;
      Line_Total: number;
    }>({
      table: "Invoice_Detail",
      select: "Invoice_Detail_ID,Invoice_ID,Event_Participant_ID,Line_Total",
      filter: `Invoice_Detail_ID = ${invoiceDetailId}`,
      top: 1,
    });
    const row = detail[0];
    if (!row) return { success: false, message: "Invoice detail not found." };

    const invoices = await this.mp!.getTableRecords<{
      Invoice_ID: number;
      Invoice_Total: number;
      Invoice_Status_ID: number;
      Purchaser_Contact_ID: number | null;
    }>({
      table: "Invoices",
      select: "Invoice_ID,Invoice_Total,Invoice_Status_ID,Purchaser_Contact_ID",
      filter: `Invoice_ID = ${row.Invoice_ID}`,
      top: 1,
    });
    const invoice = invoices[0];
    if (!invoice) return { success: false, message: "Invoice not found." };
    if (invoice.Invoice_Status_ID === INVOICE_CANCELLED) {
      return { success: false, message: "INVOICE-EXPIRED" };
    }
    // When the caller is authenticated, only let them modify their own invoice.
    if (mpContactId && invoice.Purchaser_Contact_ID && invoice.Purchaser_Contact_ID !== mpContactId) {
      return { success: false, message: "Not authorized to modify this registration." };
    }

    const participantId = row.Event_Participant_ID;

    // Collect all detail rows for this participant on the invoice.
    const participantDetails = participantId
      ? await this.mp!.getTableRecords<{ Invoice_Detail_ID: number; Line_Total: number }>({
          table: "Invoice_Detail",
          select: "Invoice_Detail_ID,Line_Total",
          filter: `Invoice_ID = ${row.Invoice_ID} AND Event_Participant_ID = ${participantId}`,
        })
      : [row];

    const detailIds = participantDetails.map((d) => d.Invoice_Detail_ID);
    const removedTotal = participantDetails.reduce((acc, d) => acc + (d.Line_Total ?? 0), 0);

    // Delete details, then the participant; leftover invoice gets retotaled or
    // removed when empty (mirrors CheckoutService.DeleteEventRegistration).
    await this.mp!.deleteTableRecords("Invoice_Detail", detailIds);

    if (participantId) {
      // Detach custom-form responses, then delete the participant.
      await this.deleteFormResponsesForParticipant(participantId);
      await this.mp!.deleteTableRecords("Event_Participants", [participantId]);
    }

    const remaining = await this.mp!.getTableRecords<{ Invoice_Detail_ID: number }>({
      table: "Invoice_Detail",
      select: "Invoice_Detail_ID",
      filter: `Invoice_ID = ${row.Invoice_ID}`,
      top: 1,
    });

    if (remaining.length === 0) {
      await this.mp!.deleteTableRecords("Invoices", [row.Invoice_ID]);
    } else {
      const newTotal = Math.max(0, Number(((invoice.Invoice_Total ?? 0) - removedTotal).toFixed(2)));
      await this.mp!.updateTableRecords("Invoices", [
        { Invoice_ID: row.Invoice_ID, Invoice_Total: newTotal },
      ]);
    }

    return { success: true };
  }

  private async deleteFormResponsesForParticipant(eventParticipantId: number): Promise<void> {
    try {
      const responses = await this.mp!.getTableRecords<{ Form_Response_ID: number }>({
        table: "Form_Responses",
        select: "Form_Response_ID",
        filter: `Event_Participant_ID = ${eventParticipantId}`,
      });
      for (const r of responses) {
        const answers = await this.mp!.getTableRecords<{ Form_Response_Answer_ID: number }>({
          table: "Form_Response_Answers",
          select: "Form_Response_Answer_ID",
          filter: `Form_Response_ID = ${r.Form_Response_ID}`,
        });
        if (answers.length) {
          await this.mp!.deleteTableRecords(
            "Form_Response_Answers",
            answers.map((a) => a.Form_Response_Answer_ID)
          );
        }
      }
      if (responses.length) {
        await this.mp!.deleteTableRecords(
          "Form_Responses",
          responses.map((r) => r.Form_Response_ID)
        );
      }
    } catch (err) {
      // Non-fatal: the participant/invoice cleanup is the primary operation.
      console.warn("RegistrationService: form response cleanup failed:", err);
    }
  }

  // ── utils ──

  private parseDetailId(value: string | undefined): number | null {
    if (!value) return null;
    const n = Number(value);
    return Number.isNaN(n) || n <= 0 ? null : n;
  }

  private sqlEscape(value: string): string {
    return (value ?? "").replace(/'/g, "''");
  }

  // Re-exported constant for the delete route's status checks/tests.
  public static readonly PARTICIPATION_CANCELLED = PARTICIPATION_CANCELLED;
}
