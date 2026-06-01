import { MPHelper } from "@/lib/providers/ministry-platform";

/**
 * Reads custom-form field definitions so the event-details widget can render
 * MP custom registration forms. Mirrors the legacy CustomFormApiService.GetForm
 * shape consumed by CustomFormBuilder.js.
 */
export interface CustomFormField {
  formFieldId: number;
  fieldLabel: string;
  fieldType: number;
  required: boolean;
  fieldOrder: number;
  fieldValues: string[];
  dependsOn: number | null;
  dependsOnValue: string | null;
  isHidden: boolean;
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

export class CustomFormService {
  private static instance: CustomFormService;
  private mp: MPHelper | null = null;

  private constructor() {
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
}
