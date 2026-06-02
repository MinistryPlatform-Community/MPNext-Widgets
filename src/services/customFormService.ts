import { MPHelper } from "@/lib/providers/ministry-platform";
import { getEnv } from "@/lib/env";
import { ConfigSettingsService } from "@/services/configSettingsService";
import { DomainTimezoneService } from "@/services/domainTimezoneService";
import type {
  CustomFormField,
  CustomFormHeader,
  CustomFormDefinition,
} from "@mpnext/types";

/**
 * Single source for custom-form data, shared by the standalone `next-custom-form`
 * widget and the embedded custom form in `next-event-details`. Reads the form
 * header + field definitions, and persists responses (Form_Responses +
 * Form_Response_Answers). Mirrors the legacy CustomFormManager.
 */

interface FormRow {
  Form_ID: number;
  Form_GUID: string | null;
  Form_Title: string | null;
  Instructions: string | null;
  Complete_Message: string | null;
  Get_Contact_Info: boolean | number | null;
  Get_Address_Info: boolean | number | null;
  Force_Login: boolean | number | null;
  Standalone_Form_Use_Only: boolean | number | null;
  End_Date: string | null;
}

interface FormFieldRow {
  Form_Field_ID: number;
  Field_Label: string | null;
  Alternate_Label: string | null;
  Field_Type_ID: number;
  Required: boolean | number | null;
  Field_Order: number | null;
  Field_Values: string | null;
  Depends_On: number | null;
  Depends_On_Value: string | null;
  Is_Hidden: boolean | number | null;
}

export interface SaveFormResponseArgs {
  formId: number;
  contactId?: number | null;
  eventId?: number | null;
  eventParticipantId?: number | null;
  ipAddress?: string | null;
  answers: { fieldId: number; response: string }[];
  contact?: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
  } | null;
  address?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    zip?: string;
  } | null;
}

const FORM_SELECT =
  "Form_ID,Form_GUID,Form_Title,Instructions,Complete_Message,Get_Contact_Info,Get_Address_Info,Force_Login,Standalone_Form_Use_Only,End_Date";

export class CustomFormService {
  private static instance: CustomFormService;
  private mp: MPHelper | null = null;
  private mpBaseUrl = "";

  private constructor() {
    const raw = getEnv("MINISTRY_PLATFORM_BASE_URL").replace(/\/$/, "");
    this.mpBaseUrl = raw;
    this.initialize();
  }

  public static async getInstance(): Promise<CustomFormService> {
    if (!CustomFormService.instance) {
      CustomFormService.instance = new CustomFormService();
      await CustomFormService.instance.initialize();
    }
    return CustomFormService.instance;
  }

  private async initialize(): Promise<void> {
    this.mp = new MPHelper();
  }

  // ── Read ─────────────────────────────────────────────────────────────

  private async readForm(filter: string): Promise<FormRow | null> {
    const rows = await this.mp!.getTableRecords<FormRow>({
      table: "Forms",
      select: FORM_SELECT,
      filter,
      top: 1,
    });
    return rows[0] ?? null;
  }

  private async toHeader(row: FormRow): Promise<CustomFormHeader> {
    const tz = DomainTimezoneService.getInstance();
    const now = await tz.toMpSqlDatetime(new Date().toISOString());
    const isExpired = !!row.End_Date && row.End_Date < now;

    const config = await ConfigSettingsService.getInstance();
    const [filesResult, googleMapsApiKey] = await Promise.all([
      this.mp!
        .getFilesByRecord({ table: "Forms", recordId: row.Form_ID, defaultOnly: true })
        .catch(() => [] as Awaited<ReturnType<MPHelper["getFilesByRecord"]>>),
      config.getGoogleMapsApiKey(),
    ]);

    let imageUrl: string | null = null;
    if (filesResult.length > 0 && filesResult[0].IsImage) {
      imageUrl = `${this.mpBaseUrl}/files/${filesResult[0].UniqueFileId}`;
    }

    return {
      formId: row.Form_ID,
      formGuid: row.Form_GUID,
      title: row.Form_Title,
      instructions: row.Instructions,
      completeMessage: row.Complete_Message,
      getContactInfo: Boolean(row.Get_Contact_Info),
      getAddressInfo: Boolean(row.Get_Address_Info),
      forceLogin: Boolean(row.Force_Login),
      // Forms has no Product_ID column in MP (no FK link between Forms and
      // Products); paid-form → product association is not available here.
      productId: null,
      standaloneOnly: Boolean(row.Standalone_Form_Use_Only),
      isExpired,
      imageUrl,
      googleMapsApiKey,
    };
  }

  public async getForm(opts: {
    formId?: number;
    formGuid?: string;
  }): Promise<CustomFormHeader | null> {
    let row: FormRow | null = null;
    if (opts.formId) {
      row = await this.readForm(`Form_ID = ${opts.formId}`);
    } else if (opts.formGuid) {
      row = await this.readForm(`Form_GUID = '${opts.formGuid.replace(/'/g, "''")}'`);
    }
    return row ? this.toHeader(row) : null;
  }

  public async getFormFields(formId: number): Promise<CustomFormField[]> {
    const rows = await this.mp!.getTableRecords<FormFieldRow>({
      table: "Form_Fields",
      select:
        "Form_Field_ID,Field_Label,Alternate_Label,Field_Type_ID,Required,Field_Order,Field_Values,Depends_On,Depends_On_Value,Is_Hidden",
      filter: `Form_ID = ${formId}`,
      orderBy: "Field_Order",
    });

    return rows.map((r) => ({
      formFieldId: r.Form_Field_ID,
      fieldLabel: String(r.Alternate_Label || r.Field_Label || ""),
      fieldType: Number(r.Field_Type_ID),
      required: Boolean(r.Required),
      fieldOrder: Number(r.Field_Order ?? 0),
      fieldValues: (r.Field_Values ?? "")
        .split(/\r?\n/)
        .map((v) => v.trim())
        .filter(Boolean),
      dependsOn: r.Depends_On ?? null,
      dependsOnValue: r.Depends_On_Value ?? null,
      isHidden: Boolean(r.Is_Hidden),
    }));
  }

  /** Consolidated header + fields for one form (by id or guid). */
  public async getDefinition(opts: {
    formId?: number;
    formGuid?: string;
  }): Promise<CustomFormDefinition | null> {
    const header = await this.getForm(opts);
    if (!header) return null;
    const fields = await this.getFormFields(header.formId);
    return { header, fields };
  }

  // ── Write (single save, reused by event registration + standalone form) ──

  public async saveFormResponse(args: SaveFormResponseArgs): Promise<number | null> {
    if (!args.answers || args.answers.length === 0) return null;

    const tz = DomainTimezoneService.getInstance();
    const now = await tz.toMpSqlDatetime(new Date().toISOString());

    const responseRecord: Record<string, unknown> = {
      Form_ID: args.formId,
      Response_Date: now,
    };
    if (args.contactId) responseRecord.Contact_ID = args.contactId;
    if (args.eventId) responseRecord.Event_ID = args.eventId;
    if (args.eventParticipantId) responseRecord.Event_Participant_ID = args.eventParticipantId;
    if (args.ipAddress) responseRecord.IP_Address = args.ipAddress;
    if (args.contact) {
      if (args.contact.firstName) responseRecord.First_Name = args.contact.firstName;
      if (args.contact.lastName) responseRecord.Last_Name = args.contact.lastName;
      if (args.contact.email) responseRecord.Email_Address = args.contact.email;
      if (args.contact.phone) responseRecord.Phone_Number = args.contact.phone;
    }
    if (args.address) {
      if (args.address.line1) responseRecord.Address_Line_1 = args.address.line1;
      if (args.address.line2) responseRecord.Address_Line_2 = args.address.line2;
      if (args.address.city) responseRecord.Address_City = args.address.city;
      if (args.address.state) responseRecord.Address_State = args.address.state;
      if (args.address.zip) responseRecord.Address_Zip = args.address.zip;
    }

    const created = (await this.mp!.createTableRecords("Form_Responses", [
      responseRecord,
    ])) as Array<{ Form_Response_ID?: number }>;
    const formResponseId = created[0]?.Form_Response_ID;
    if (!formResponseId) return null;

    const answerRecords: Record<string, unknown>[] = args.answers.map((a) => {
      const rec: Record<string, unknown> = {
        Form_Response_ID: formResponseId,
        Form_Field_ID: a.fieldId,
        Response: a.response,
      };
      if (args.eventParticipantId) rec.Event_Participant_ID = args.eventParticipantId;
      return rec;
    });
    await this.mp!.createTableRecords("Form_Response_Answers", answerRecords);

    return formResponseId;
  }

  /**
   * Extract `mp_customform_{id}` answer fields from a flat form payload.
   * Shared by the standalone submit route and event registration.
   */
  public extractAnswers(
    payload: Record<string, string>,
  ): { fieldId: number; response: string }[] {
    return Object.keys(payload)
      .filter((k) => k.startsWith("mp_customform_") && k !== "mp_customformformid")
      .map((k) => ({
        fieldId: Number(k.replace("mp_customform_", "")),
        response: payload[k],
      }))
      .filter((a) => !Number.isNaN(a.fieldId) && a.response != null && a.response !== "");
  }
}
