import { MPHelper } from "@/lib/providers/ministry-platform";
import { getEnv } from "@/lib/env";
import { ProductsService } from "./productsService";
import type {
  EventDetail,
  EventRoom,
  EventContact,
  BasicContact,
  ExistingInvoice,
  ExistingParticipant,
  SelectedProductOption,
  FormResponseAnswer,
  AvailabilityResponse,
  SoldOutProduct,
} from "@mpnext/types";

/**
 * Backend for the `next-event-details` widget. Migrated from the legacy .NET
 * `EventDetailsService`, which wraps a mix of stored procedures
 * (`api_MPPW_GetEventById`, `api_MPPW_GetContactInfo`, `api_MPPW_GetInvoice`)
 * and direct table reads for enrichment.
 */

interface DpUserRecord {
  User_ID: number;
  User_GUID: string;
  Contact_ID: number;
}

interface ContactInfoRow {
  EnableUserTimeZone: boolean | number | null;
  DomainTimeZoneId: number | string | null;
  ContactId: number | string | null;
  HouseholdPositionId: number | string | null;
  ImageUrl: string | null;
  HouseholdId: number | string | null;
  IsStaff: boolean | number | null;
  DonorId: number | string | null;
  StatementMethodId: number | string | null;
}

interface ContactsRow {
  Contact_ID: number | string;
  First_Name: string | null;
  Last_Name: string | null;
  Email_Address: string | null;
  Mobile_Phone: string | null;
  Household_ID: number | string | null;
}

interface EventByIdRow {
  Id: number | string | null;
  ImageUrl: string | null;
  Title: string | null;
  Description: string | null;
  Location: string | null;
  StartDate: string | null;
  EndDate: string | null;
  StartDateUTC: string | null;
  EndDateUTC: string | null;
  Featured: boolean | number | null;
  RegistrationProductId: number | string | null;
  RegistrationPrice: number | string | null;
  RegistrationDepositPrice: number | string | null;
  MeetingInstructions: string | null;
  Primary_Contact: number | string | null;
  Latitude: number | string | null;
  Longitude: number | string | null;
  Visibility_Level_ID: number | string | null;
  Force_Login: boolean | number | null;
  Opportunity_ID: number | string | null;
  Registration_Active: boolean | number | null;
  OpportunityCount: number | string | null;
  ExternalRegistrationUrl: string | null;
  LocationAddressId: number | string | null;
  Registration_Form: number | string | null;
  Form_GUID: string | null;
  IsFreeEvent: boolean | number | null;
  Minor_Registration: boolean | number | null;
  Allow_Email: boolean | number | null;
  Show_Building_Room_Info: boolean | number | null;
  Participants_Expected: number | string | null;
  RegisteredParticipantCount: number | string | null;
}

interface EventRoomRow {
  BuildingName: string | null;
  RoomName: string | null;
  RoomNumber: string | null;
  Cancelled: boolean | number | null;
}

interface AddressRow {
  Address_ID: number | string;
  Address_Line_1: string | null;
  Address_Line_2: string | null;
  City: string | null;
  "State/Region": string | null;
  Postal_Code: string | null;
}

interface EventContactRow {
  Contact_ID: number | string;
  Display_Name: string | null;
  Email_Address: string | null;
}

interface InvoiceHeaderRow {
  Invoice_Status_ID: number | string | null;
  Amount_Paid: number | string | null;
  Invoice_Total: number | string | null;
  Notes: string | null;
  Form_Response_ID: number | string | null;
  Form_ID: number | string | null;
  Form_GUID: string | null;
}

interface InvoiceDetailRow {
  Invoice_Detail_ID: number | string;
  Sub_Item: boolean | number | null;
  Item_Name: string | null;
  Item_Note: string | null;
  Line_Total: number | string | null;
  Item_Quantity: number | string | null;
  Product_ID: number | string | null;
  Recipient_Name: string | null;
  Deposit_Requested: boolean | number | null;
  Event_ID: number | string | null;
  Can_Cancel_Free_Event: boolean | number | null;
  Program_ID: number | string | null;
  Event_Participant_ID: number | string | null;
  Participation_Status_ID: number | string | null;
  Product_Option_Price_ID: number | string | null;
  Group_Participant_ID: number | string | null;
}

interface EventParticipantRow {
  Event_Participant_ID: number | string;
  Participant_ID: number | string | null;
  Notes: string | null;
  Group_ID: number | string | null;
  Group_Participant_ID: number | string | null;
}

interface FormResponseRow {
  Form_Response_ID: number | string;
}

interface FormResponseAnswerRow {
  Form_Field_ID: number | string;
  Form_Response_ID: number | string | null;
  Response: string | null;
}

interface EventExpectedRow {
  Participants_Expected: number | string | null;
}

interface EventParticipantCountRow {
  Event_Participant_ID: number | string;
}

interface InvoiceDetailIdRow {
  Invoice_Detail_ID: number | string;
}

// ── Status constants (mirror the legacy enum literals) ──
const INVOICE_STATUS_SOME_PAID = 2;
const INVOICE_STATUS_PAID_IN_FULL = 3;
const INVOICE_STATUS_CANCELLED = 7;
const PARTICIPATION_STATUS_ABANDONED = 20;

function toNumberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

function toNumber(
  value: number | string | null | undefined,
  fallback = 0
): number {
  const n = toNumberOrNull(value);
  return n === null ? fallback : n;
}

export class EventDetailsService {
  private static instance: EventDetailsService;
  private mp: MPHelper | null = null;
  private imageBaseUrl = "";

  private constructor() {
    const raw = getEnv("MINISTRY_PLATFORM_BASE_URL").replace(/\/$/, "");
    this.imageBaseUrl = `${raw}/files/`;
    this.initialize();
  }

  public static async getInstance(): Promise<EventDetailsService> {
    if (!EventDetailsService.instance) {
      EventDetailsService.instance = new EventDetailsService();
      await EventDetailsService.instance.initialize();
    }
    return EventDetailsService.instance;
  }

  private async initialize(): Promise<void> {
    this.mp = new MPHelper();
  }

  // ── User identity ──

  public async getUserByGuid(
    guid: string
  ): Promise<{ User_ID: number; Contact_ID: number } | null> {
    const users = await this.mp!.getTableRecords<DpUserRecord>({
      table: "dp_Users",
      select: "User_ID,User_GUID,Contact_ID",
      filter: `User_GUID = '${guid}'`,
      top: 1,
    });

    if (!users[0]) {
      console.error("EventDetailsService: No dp_Users record for GUID:", guid);
      return null;
    }

    return { User_ID: users[0].User_ID, Contact_ID: users[0].Contact_ID };
  }

  // ── Contact info (staff flag, household) ──

  public async getContactInfo(
    userId: number
  ): Promise<{ contactId: number | null; householdId: number | null; isStaff: boolean }> {
    const result = await this.mp!.executeProcedure("api_MPPW_GetContactInfo", {
      "@ImageBaseUrl": this.imageBaseUrl,
      "@UserId": userId,
    });

    const row = ((result[0] as ContactInfoRow[] | undefined) ?? [])[0];
    if (!row) {
      return { contactId: null, householdId: null, isStaff: false };
    }

    return {
      contactId: toNumberOrNull(row.ContactId),
      householdId: toNumberOrNull(row.HouseholdId),
      isStaff: Boolean(row.IsStaff),
    };
  }

  public async getBasicContact(userId: number): Promise<BasicContact | null> {
    const info = await this.getContactInfo(userId);
    if (info.contactId == null) return null;

    const rows = await this.mp!.getTableRecords<ContactsRow>({
      table: "Contacts",
      select:
        "Contact_ID,First_Name,Last_Name,Email_Address,Mobile_Phone,Household_ID",
      filter: `Contact_ID = ${info.contactId}`,
      top: 1,
    });

    const c = rows[0];
    if (!c) return null;

    return {
      contactId: toNumber(c.Contact_ID),
      firstName: c.First_Name ?? null,
      lastName: c.Last_Name ?? null,
      emailAddress: c.Email_Address ?? null,
      mobilePhoneNumber: c.Mobile_Phone ?? null,
      householdId: toNumberOrNull(c.Household_ID),
    };
  }

  // ── Single event detail ──

  public async getEventById(
    eventId: number,
    isStaff: boolean
  ): Promise<EventDetail> {
    const result = await this.mp!.executeProcedure("api_MPPW_GetEventById", {
      "@ImageBaseUrl": this.imageBaseUrl,
      "@EventId": eventId,
      "@IsStaffUser": isStaff,
    });

    const row = ((result[0] as EventByIdRow[] | undefined) ?? [])[0];
    if (!row) {
      throw new Error("Event not found");
    }

    const participantsExpected = toNumberOrNull(row.Participants_Expected);
    const registeredCount = toNumber(row.RegisteredParticipantCount);
    const isRegistrationFull =
      participantsExpected != null && participantsExpected !== 0
        ? registeredCount >= participantsExpected
        : false;

    const registrationProductId = toNumberOrNull(row.RegistrationProductId);
    const locationAddressId = toNumberOrNull(row.LocationAddressId);
    const primaryContactId = toNumberOrNull(row.Primary_Contact);

    // Independent enrichment reads run concurrently.
    const [rooms, address, contacts, isRegistrationOptionsFull] = await Promise.all([
      this.getEventRooms(eventId),
      locationAddressId != null
        ? this.getAddressLine(locationAddressId)
        : Promise.resolve(null),
      primaryContactId != null
        ? this.getEventContacts(primaryContactId)
        : Promise.resolve([] as EventContact[]),
      registrationProductId != null && !isRegistrationFull
        ? this.computeRegistrationOptionsFull(registrationProductId, eventId)
        : Promise.resolve(false),
    ]);

    const id = toNumber(row.Id);

    return {
      id,
      eventId: id,
      imageUrl: row.ImageUrl ?? null,
      title: String(row.Title ?? ""),
      description: row.Description ?? null,
      location: row.Location ?? null,
      // MP returns wall-clock datetimes; pass through verbatim (no Z-shift).
      startDate: String(row.StartDate ?? ""),
      endDate: String(row.EndDate ?? ""),
      startDateUTC: row.StartDateUTC ?? null,
      endDateUTC: row.EndDateUTC ?? null,
      featured: Boolean(row.Featured),
      registrationProductId,
      registrationPrice: toNumberOrNull(row.RegistrationPrice),
      registrationDepositPrice: toNumberOrNull(row.RegistrationDepositPrice),
      meetingInstructions: row.MeetingInstructions ?? null,
      primaryContactId,
      latitude: toNumberOrNull(row.Latitude),
      longitude: toNumberOrNull(row.Longitude),
      visibilityLevelId: toNumber(row.Visibility_Level_ID),
      forceLogin: Boolean(row.Force_Login),
      opportunityId: toNumberOrNull(row.Opportunity_ID),
      registrationActive: Boolean(row.Registration_Active),
      opportunityCount: toNumber(row.OpportunityCount),
      externalRegistrationUrl: row.ExternalRegistrationUrl ?? null,
      locationAddressId,
      customFormId: toNumberOrNull(row.Registration_Form),
      customFormGuid: row.Form_GUID ?? null,
      isFreeEvent: Boolean(row.IsFreeEvent),
      minorRegistration: Boolean(row.Minor_Registration),
      allowEmail: Boolean(row.Allow_Email),
      showBuildingRoomInfo: Boolean(row.Show_Building_Room_Info),
      isRegistrationFull,
      isRegistrationOptionsFull,
      isUserStaff: isStaff,
      address,
      attributes: [],
      rooms,
      contacts,
    };
  }

  private async getEventRooms(eventId: number): Promise<EventRoom[]> {
    // FK-joined columns must qualify the base table to avoid MP ambiguous-column 500s.
    const rows = await this.mp!.getTableRecords<EventRoomRow>({
      table: "Event_Rooms",
      select:
        "Room_ID_Table_Building_ID_Table.Building_Name AS BuildingName, Room_ID_Table.Room_Name AS RoomName, Room_ID_Table.Room_Number AS RoomNumber, Event_Rooms.Cancelled AS Cancelled",
      filter: `Event_Rooms.Event_ID = ${eventId}`,
    });

    return rows
      .filter((r) => Boolean(r.Cancelled) !== true)
      .map((r) => {
        const buildingName = r.BuildingName?.trim() || null;
        const roomName = r.RoomName?.trim() || null;
        const roomNumber = r.RoomNumber?.trim() || null;

        let roomInfo: string | null = null;
        if (buildingName || roomName || roomNumber) {
          const left = [buildingName, roomName].filter(Boolean).join(" - ");
          roomInfo = roomNumber
            ? left
              ? `${left} (${roomNumber})`
              : `(${roomNumber})`
            : left || null;
        }

        return {
          buildingName,
          roomName,
          roomNumber,
          cancelled: Boolean(r.Cancelled),
          roomInfo,
        };
      });
  }

  private async getAddressLine(addressId: number): Promise<string | null> {
    const rows = await this.mp!.getTableRecords<AddressRow>({
      table: "Addresses",
      // [State/Region] must be bracketed — the slash is MP's FK-traversal
      // operator, so an unbracketed State/Region is read as columns State→Region.
      select:
        "Address_ID,Address_Line_1,Address_Line_2,City,[State/Region],Postal_Code",
      filter: `Address_ID = ${addressId}`,
      top: 1,
    });
    const a = rows[0];
    if (!a) return null;

    const cityStateZip = [
      a.City ? `${a.City},` : null,
      a["State/Region"],
      a.Postal_Code,
    ]
      .filter((p) => p != null && String(p).trim().length > 0)
      .join(" ")
      .trim();

    const parts = [
      a.Address_Line_1,
      a.Address_Line_2,
      cityStateZip.length > 0 ? cityStateZip : null,
    ].filter((p): p is string => p != null && String(p).trim().length > 0);

    return parts.length > 0 ? parts.join(", ") : null;
  }

  private async getEventContacts(contactId: number): Promise<EventContact[]> {
    const rows = await this.mp!.getTableRecords<EventContactRow>({
      table: "Contacts",
      select: "Contact_ID,Display_Name,Email_Address",
      filter: `Contact_ID = ${contactId}`,
      top: 1,
    });
    const c = rows[0];
    if (!c) return [];

    return [
      {
        displayName: c.Display_Name ?? null,
        imageUrl: null,
        emailAddress: c.Email_Address ?? null,
      },
    ];
  }

  private async computeRegistrationOptionsFull(
    productId: number,
    eventId: number
  ): Promise<boolean> {
    const products = await ProductsService.getInstance();
    const product = await products.getProduct(productId, eventId);
    if (!product) return false;

    const relevantGroups = product.optionGroups.filter(
      (g) => g.required && !g.optionPrices.every((p) => p.isHidden)
    );
    if (relevantGroups.length === 0) return false;

    return relevantGroups.every((g) => {
      const visibleOptions = g.optionPrices.filter((p) => !p.isHidden);
      if (visibleOptions.length === 0) return false;
      return visibleOptions.every(
        (p) => p.maxQty != null && p.qtyOnHand <= 0
      );
    });
  }

  // ── Existing invoice / participants ──

  public async getEventParticipantsByInvoice(
    invoiceGuid: string,
    mpContactId?: number
  ): Promise<ExistingInvoice> {
    const params: Record<string, string | number | null> = {
      "@InvoiceGuid": invoiceGuid,
    };
    if (mpContactId != null && mpContactId > 0) {
      params["@MpLoggedInContactId"] = mpContactId;
    }

    const result = await this.mp!.executeProcedure("api_MPPW_GetInvoice", params);

    const header = ((result[0] as InvoiceHeaderRow[] | undefined) ?? [])[0];
    const details = (result[1] as InvoiceDetailRow[] | undefined) ?? [];

    const invoiceStatusId = toNumberOrNull(header?.Invoice_Status_ID);
    const anyAbandoned = details.some(
      (d) => toNumberOrNull(d.Participation_Status_ID) === PARTICIPATION_STATUS_ABANDONED
    );

    const isInvoiceExpired =
      !header ||
      invoiceStatusId === INVOICE_STATUS_CANCELLED ||
      anyAbandoned;

    if (isInvoiceExpired) {
      return {
        isInvoiceExpired: true,
        isSomePaymentExists: false,
        expiredMessageKey: "registrationExpiredMessage",
        participants: [],
      };
    }

    const invoiceTotal = toNumber(header.Invoice_Total);
    const amountPaid = toNumber(header.Amount_Paid);
    const isSomePaymentExists =
      (invoiceTotal > 0 && amountPaid > 0) ||
      invoiceStatusId === INVOICE_STATUS_SOME_PAID ||
      invoiceStatusId === INVOICE_STATUS_PAID_IN_FULL;

    // Group detail rows by Event_Participant_ID (skip rows with no participant).
    const groups = new Map<number, InvoiceDetailRow[]>();
    for (const d of details) {
      const epId = toNumberOrNull(d.Event_Participant_ID);
      if (epId == null) continue;
      const list = groups.get(epId);
      if (list) list.push(d);
      else groups.set(epId, [d]);
    }

    const participants = await Promise.all(
      Array.from(groups.entries()).map(([epId, rows]) =>
        this.buildParticipant(epId, rows)
      )
    );

    return {
      isInvoiceExpired: false,
      isSomePaymentExists,
      expiredMessageKey: null,
      participants,
    };
  }

  private async buildParticipant(
    eventParticipantId: number,
    detailRows: InvoiceDetailRow[]
  ): Promise<ExistingParticipant> {
    const [epRows, formResponses] = await Promise.all([
      this.mp!.getTableRecords<EventParticipantRow>({
        table: "Event_Participants",
        select:
          "Event_Participant_ID,Participant_ID,Notes,Group_ID,Group_Participant_ID",
        filter: `Event_Participant_ID = ${eventParticipantId}`,
        top: 1,
      }),
      this.getFormResponses(eventParticipantId),
    ]);

    const ep = epRows[0];
    const notes = ep?.Notes ?? "";
    const parsed = this.parseNotes(notes);

    const minorFirstName =
      parsed["Minor First Name"] ?? parsed["Attendee First Name"] ?? null;
    const minorLastName =
      parsed["Minor Last Name"] ?? parsed["Attendee Last Name"] ?? null;
    const minorDateOfBirth =
      parsed["Minor Date of Birth"] ?? parsed["Date of Birth"] ?? null;
    const isMinorRegistration = Boolean(
      minorFirstName || minorLastName || minorDateOfBirth
    );

    // Base item (Sub_Item false) first, then sub items.
    const sortedRows = [...detailRows].sort(
      (a, b) => Number(Boolean(a.Sub_Item)) - Number(Boolean(b.Sub_Item))
    );

    const selectedProductOptions: SelectedProductOption[] = sortedRows.map((d) => {
      const lineTotal = toNumber(d.Line_Total);
      const itemNote = d.Item_Note ?? "";
      const isPromoCode =
        lineTotal < 0 && itemNote.trimStart().startsWith("Promo Code:");
      const promoCode = isPromoCode
        ? itemNote.replace(/^\s*Promo Code:\s*/i, "").trim() || null
        : null;
      return {
        productId: toNumberOrNull(d.Product_ID),
        productOptionId: toNumberOrNull(d.Product_Option_Price_ID),
        quantity: toNumber(d.Item_Quantity),
        isPromoCode,
        promoCode,
        invoiceDetailId: toNumberOrNull(d.Invoice_Detail_ID),
      };
    });

    const lineTotal = detailRows.reduce(
      (sum, d) => sum + toNumber(d.Line_Total),
      0
    );

    return {
      eventParticipantId,
      contactId: null,
      householdId: null,
      firstName: parsed["First Name"] ?? null,
      lastName: parsed["Last Name"] ?? null,
      email: parsed["Email"] ?? null,
      phone: parsed["Phone"] ?? null,
      addressLine1: parsed["Address Line 1"] ?? null,
      addressLine2: parsed["Address Line 2"] ?? null,
      city: parsed["City"] ?? null,
      state: parsed["State"] ?? parsed["State/Region"] ?? null,
      zip: parsed["Postal Code"] ?? parsed["Zip"] ?? null,
      lineTotal,
      isMinorRegistration,
      minorFirstName,
      minorLastName,
      minorDateOfBirth,
      selectedProductOptions,
      formResponses,
    };
  }

  /**
   * Parse a `Label: value\r\n` block (the participant Notes field) into a
   * label→value map. Value is the remainder of the line after the first colon.
   */
  private parseNotes(notes: string): Record<string, string> {
    const map: Record<string, string> = {};
    if (!notes) return map;
    const lines = notes.split(/\r?\n/);
    for (const line of lines) {
      const idx = line.indexOf(":");
      if (idx <= 0) continue;
      const label = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (label && value) {
        map[label] = value;
      }
    }
    return map;
  }

  private async getFormResponses(
    eventParticipantId: number
  ): Promise<FormResponseAnswer[]> {
    // Resolve the participant's Form_Response_ID first, then read its answers.
    // (The direct Form_Response_Answers FK path through the event participant is
    // ambiguous in MP, so we take the two-step route the legacy code falls back
    // to.)
    try {
      const responses = await this.mp!.getTableRecords<FormResponseRow>({
        table: "Form_Responses",
        select: "Form_Response_ID",
        filter: `Event_Participant_ID = ${eventParticipantId}`,
      });
      const responseIds = responses
        .map((r) => toNumberOrNull(r.Form_Response_ID))
        .filter((id): id is number => id != null);
      if (responseIds.length === 0) return [];

      const answers = await this.mp!.getTableRecords<FormResponseAnswerRow>({
        table: "Form_Response_Answers",
        select: "Form_Field_ID,Form_Response_ID,Response",
        filter: `Form_Response_ID IN (${responseIds.join(",")})`,
      });

      return answers.map((a) => ({
        Form_Field_ID: toNumber(a.Form_Field_ID),
        Form_Response_ID: toNumberOrNull(a.Form_Response_ID),
        Response: a.Response ?? null,
      }));
    } catch (err) {
      console.warn("EventDetailsService: form responses fetch failed:", err);
      return [];
    }
  }

  // ── Registration checks ──

  public async hasRegistered(
    eventId: number,
    contactId: number
  ): Promise<boolean> {
    const rows = await this.mp!.getTableRecords<EventParticipantCountRow>({
      table: "Event_Participants",
      select: "Event_Participants.Event_Participant_ID",
      filter: `Event_ID = ${eventId} AND Participant_ID_Table_Contact_ID_Table.Contact_ID = ${contactId} AND Participation_Status_ID = 2`,
      top: 1,
    });
    return rows.length > 0;
  }

  public async checkPendingEventAvailability(eventId: number): Promise<boolean> {
    const eventRows = await this.mp!.getTableRecords<EventExpectedRow>({
      table: "Events",
      select: "Participants_Expected",
      filter: `Event_ID = ${eventId}`,
      top: 1,
    });
    const expected = toNumberOrNull(eventRows[0]?.Participants_Expected ?? null);

    const participants = await this.mp!.getTableRecords<EventParticipantCountRow>({
      table: "Event_Participants",
      select: "Event_Participant_ID",
      filter: `Event_ID = ${eventId} AND Participation_Status_ID IN (2,3,4,21)`,
    });
    const participantCount = participants.length;

    return expected == null || expected > participantCount;
  }

  public async checkAvailability(
    eventId: number,
    selectedOptions: { optionPriceId: number; qty: number }[]
  ): Promise<AvailabilityResponse> {
    const event = await this.getEventById(eventId, false);
    const isEventAvailable = !event.isRegistrationFull;

    const soldOut: SoldOutProduct[] = [];

    if (event.registrationProductId != null) {
      const products = await ProductsService.getInstance();
      const product = await products.getProduct(
        event.registrationProductId,
        eventId
      );
      if (product) {
        const optionMap = new Map<
          number,
          { optionPriceId: number; optionTitle: string | null; qtyOnHand: number }
        >();
        for (const g of product.optionGroups) {
          for (const p of g.optionPrices) {
            optionMap.set(p.optionPriceId, {
              optionPriceId: p.optionPriceId,
              optionTitle: p.optionTitle,
              qtyOnHand: p.qtyOnHand,
            });
          }
        }

        for (const sel of selectedOptions) {
          const option = optionMap.get(sel.optionPriceId);
          if (option && option.qtyOnHand < sel.qty) {
            soldOut.push({
              optionPrice: {
                optionPriceId: option.optionPriceId,
                optionTitle: option.optionTitle,
              },
            });
          }
        }
      }
    }

    return {
      isSuccessful: isEventAvailable && soldOut.length === 0,
      status: isEventAvailable ? (soldOut.length > 0 ? 409 : 200) : 409,
      soldOutProducts: soldOut,
    };
  }

  public async getBaseInvoiceDetailId(
    eventParticipantId: number
  ): Promise<number> {
    const rows = await this.mp!.getTableRecords<InvoiceDetailIdRow>({
      table: "Invoice_Detail",
      select: "Invoice_Detail_ID",
      filter: `Event_Participant_ID = ${eventParticipantId}`,
      top: 1,
    });
    return rows[0] ? toNumber(rows[0].Invoice_Detail_ID) : 0;
  }
}
