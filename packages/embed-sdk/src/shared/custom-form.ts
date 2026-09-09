/**
 * Shared custom-form rendering + behavior — the single implementation used by
 * BOTH the standalone `next-custom-form` widget and the embedded custom form
 * inside `next-event-details`. Mirrors the legacy CustomFormBuilder.
 *
 * Field inputs are named `mp_customform_{Form_Field_ID}` (the server strips this
 * prefix when persisting Form_Response_Answers). Render output uses the `cf-`
 * class prefix; host widgets inject {@link CUSTOM_FORM_STYLES}.
 *
 * ## Localisation
 *
 * Only the two strings this module *authors* are translated — a dropdown's
 * empty option and the file-upload note. Everything else on a rendered field
 * (`fieldLabel`, the option values, an Instructions block's body) is MP-authored
 * content from the church's own form definition, which a file-based catalogue
 * cannot reach; it renders exactly as MP supplies it.
 */

import { getLocaleSession, type Translator } from "../i18n";
import { requiredStar } from "./form-validation";

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

export const CUSTOM_FORM_FIELD_TYPE = {
  TextBox: 1,
  Textarea: 2,
  Date: 3,
  VerticalRadio: 4,
  Dropdown: 5,
  Instructions: 6,
  HorizontalRadio: 7,
  Checkbox: 8,
  FileUpload: 9,
} as const;

const FT = CUSTOM_FORM_FIELD_TYPE;

function escapeHtml(text: string): string {
  const el = document.createElement("span");
  el.textContent = text ?? "";
  return el.innerHTML;
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;");
}

/**
 * Render the custom-form fields (and the hidden form-id input). Returns markup
 * to drop inside a host `<form>`. Dependent fields render hidden + disabled;
 * call {@link bindCustomFormDependsOn} after insertion to wire reveal logic.
 */
export function renderCustomFormFields(
  fields: CustomFormField[],
  opts: { formId?: number | null; t?: Translator } = {},
): string {
  // A widget passes its own `this.t`, so a form inside a `<div lang="es">`
  // renders in Spanish on an otherwise English page; omitted, it falls back to
  // the page-wide locale. Same contract as `form-validation.ts`.
  const t = opts.t ?? getLocaleSession().translator();
  const sorted = [...fields].sort((a, b) => a.fieldOrder - b.fieldOrder);
  const formIdInput =
    opts.formId != null
      ? `<input type="hidden" name="mp_customformformid" value="${escapeAttr(String(opts.formId))}">`
      : "";
  const body = sorted
    .filter((f) => !f.isHidden)
    .map((f) => renderField(f, t))
    .join("");
  return `${formIdInput}${body}`;
}

function renderField(f: CustomFormField, t: Translator): string {
  const name = `mp_customform_${f.formFieldId}`;
  const req = f.required ? "required" : "";
  const label = `${escapeHtml(f.fieldLabel)}${f.required ? requiredStar() : ""}`;
  const isDependent = f.dependsOn != null && f.dependsOnValue != null;
  const isParent = f.fieldType === FT.VerticalRadio || f.fieldType === FT.HorizontalRadio;
  const parentAttr = isParent ? `data-customform-parent="true"` : "";
  const wrapStyle = isDependent ? `style="display:none"` : "";
  const dep = isDependent ? "disabled" : "";
  const dataAttrs = isDependent
    ? `data-depends-on="${f.dependsOn}" data-depends-on-value="${escapeAttr(f.dependsOnValue || "")}"`
    : "";
  const wrapOpen = `<div class="cf-field" data-field-id="${f.formFieldId}" ${dataAttrs} ${wrapStyle}>`;

  switch (f.fieldType) {
    case FT.Instructions:
      return `${wrapOpen}<p class="cf-instructions">${escapeHtml(f.fieldLabel)}</p></div>`;

    case FT.Checkbox:
      return `${wrapOpen}<label class="cf-checkbox"><input type="checkbox" name="${name}" value="true" ${req} ${dep}> ${label}</label></div>`;

    case FT.Textarea:
      return `${wrapOpen}<label>${label}</label><textarea class="cf-input" name="${name}" maxlength="30000" ${req} ${dep}></textarea></div>`;

    case FT.Date:
      return `${wrapOpen}<label>${label}</label><input class="cf-input" type="date" name="${name}" ${req} ${dep}></div>`;

    case FT.Dropdown: {
      const opts = [
        `<option value="">${escapeHtml(t("customForm.selectOption"))}</option>`,
      ]
        .concat(
          (f.fieldValues || []).map(
            (v) => `<option value="${escapeAttr(v)}">${escapeHtml(v)}</option>`,
          ),
        )
        .join("");
      return `${wrapOpen}<label>${label}</label><select class="cf-input" name="${name}" ${req} ${dep}>${opts}</select></div>`;
    }

    case FT.VerticalRadio:
    case FT.HorizontalRadio: {
      const dir = f.fieldType === FT.HorizontalRadio ? "cf-radio-h" : "cf-radio-v";
      const opts = (f.fieldValues || [])
        .map(
          (v) =>
            `<label class="cf-radio"><input type="radio" name="${name}" value="${escapeAttr(v)}" ${parentAttr} ${req} ${dep}> ${escapeHtml(v)}</label>`,
        )
        .join("");
      return `${wrapOpen}<label>${label}</label><div class="${dir}">${opts}</div></div>`;
    }

    case FT.FileUpload:
      // Rendered for parity; file bytes are not submitted in this version.
      return `${wrapOpen}<label>${label}</label><input class="cf-input" type="file" name="${name}_file" ${dep}><small class="cf-note">${escapeHtml(t("customForm.fileUploadUnsupported"))}</small></div>`;

    case FT.TextBox:
    default:
      return `${wrapOpen}<label>${label}</label><input class="cf-input" type="text" name="${name}" maxlength="250" ${req} ${dep}></div>`;
  }
}

/**
 * Wire depends-on behavior within `root`: dependent fields show only when their
 * parent radio's selected value matches `dependsOnValue`. Idempotent; safe to
 * call after each render.
 */
export function bindCustomFormDependsOn(
  root: ParentNode,
  fields: CustomFormField[],
): void {
  const apply = () => applyDependsOn(root, fields);
  root.querySelectorAll<HTMLInputElement>('input[data-customform-parent="true"]').forEach((el) => {
    el.addEventListener("change", apply);
  });
  apply();
}

export function applyDependsOn(root: ParentNode, fields: CustomFormField[]): void {
  for (const field of fields) {
    if (field.dependsOn == null || field.dependsOnValue == null) continue;
    const wrapper = root.querySelector<HTMLElement>(`[data-field-id="${field.formFieldId}"]`);
    if (!wrapper) continue;
    const parentChecked = root.querySelector<HTMLInputElement>(
      `input[name="mp_customform_${field.dependsOn}"]:checked`,
    );
    const show = !!parentChecked && parentChecked.value === field.dependsOnValue;
    wrapper.style.display = show ? "" : "none";
    wrapper
      .querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        "input, select, textarea",
      )
      .forEach((el) => (el.disabled = !show));
  }
}

export const CUSTOM_FORM_STYLES = `
  .cf-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
  .cf-field > label { font-size: 13px; font-weight: 600; color: #6b7280; }
  .cf-input { padding: 9px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; font-family: inherit; color: #2D2926; background: white; outline: none; }
  .cf-input:focus { border-color: #004C97; box-shadow: 0 0 0 1px #004C97; }
  textarea.cf-input { min-height: 80px; resize: vertical; }
  .cf-checkbox { display: flex; align-items: center; gap: 8px; font-size: 14px; }
  .cf-checkbox input, .cf-radio input { width: auto; }
  .cf-radio-v { display: flex; flex-direction: column; gap: 6px; }
  .cf-radio-h { display: flex; flex-wrap: wrap; gap: 16px; }
  .cf-radio { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 400; color: #2D2926; }
  .cf-instructions { font-size: 14px; color: #474747; margin: 0; }
  .cf-note { color: #6b7280; font-size: 12px; }
`;
