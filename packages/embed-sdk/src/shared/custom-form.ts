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
import { fieldId, requiredStar } from "./form-validation";

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
  opts: { formId?: number | null; t?: Translator; idPrefix?: string } = {},
): string {
  // A widget passes its own `this.t`, so a form inside a `<div lang="es">`
  // renders in Spanish on an otherwise English page; omitted, it falls back to
  // the page-wide locale. Same contract as `form-validation.ts`.
  const t = opts.t ?? getLocaleSession().translator();
  // Pass `this.instanceId` so two forms on one page cannot mint the same id.
  const idPrefix = opts.idPrefix || "cf";
  const sorted = [...fields].sort((a, b) => a.fieldOrder - b.fieldOrder);
  const formIdInput =
    opts.formId != null
      ? `<input type="hidden" name="mp_customformformid" value="${escapeAttr(String(opts.formId))}">`
      : "";
  const body = sorted
    .filter((f) => !f.isHidden)
    .map((f) => renderField(f, t, idPrefix))
    .join("");
  return `${formIdInput}${body}`;
}

/**
 * One MP form field.
 *
 * ## Accessible names (C28)
 *
 * Every control has one, using the same id scheme as `field()` (`fieldId`):
 * - single controls (text, textarea, date, dropdown, file) get
 *   `<label for=id>`;
 * - a checkbox stays wrapped in its `<label>`;
 * - a radio group becomes `role="radiogroup"`, named by its label text
 *   (`aria-labelledby`), and each radio stays wrapped in its option's label.
 *
 * Each control also carries `data-mpx-label`, so "required" names the field.
 *
 * The wrapper, names, types, `maxlength` and depends-on attributes are
 * **unchanged**, because these nine field types are at exact parity with
 * legacy, storage included. That is why this is not a straight `field()` call:
 * `field()` owns its wrapper, and the depends-on wiring needs `data-field-id` on
 * this one.
 *
 * Phone-ness is never guessed from an MP label (C29). `Form_Field_Types` has no
 * phone type, and legacy renders "Reference 1: Phone Number" as text too.
 */
function renderField(f: CustomFormField, t: Translator, idPrefix: string): string {
  const name = `mp_customform_${f.formFieldId}`;
  const id = fieldId(name, idPrefix);
  const req = f.required ? "required" : "";
  const label = `${escapeHtml(f.fieldLabel)}${f.required ? requiredStar() : ""}`;
  const named = `id="${escapeAttr(id)}" data-mpx-label="${escapeAttr(f.fieldLabel)}"`;
  const labelFor = `<label for="${escapeAttr(id)}">${label}</label>`;
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
      return `${wrapOpen}<label class="cf-checkbox"><input type="checkbox" ${named} name="${name}" value="true" ${req} ${dep}> ${label}</label></div>`;

    case FT.Textarea:
      return `${wrapOpen}${labelFor}<textarea class="cf-input" ${named} name="${name}" maxlength="30000" ${req} ${dep}></textarea></div>`;

    case FT.Date:
      return `${wrapOpen}${labelFor}<input class="cf-input" type="date" ${named} name="${name}" ${req} ${dep}></div>`;

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
      return `${wrapOpen}${labelFor}<select class="cf-input" ${named} name="${name}" ${req} ${dep}>${opts}</select></div>`;
    }

    case FT.VerticalRadio:
    case FT.HorizontalRadio: {
      const dir = f.fieldType === FT.HorizontalRadio ? "cf-radio-h" : "cf-radio-v";
      const groupLabelId = `${id}-label`;
      const mpxLabel = `data-mpx-label="${escapeAttr(f.fieldLabel)}"`;
      const opts = (f.fieldValues || [])
        .map(
          (v) =>
            `<label class="cf-radio"><input type="radio" name="${name}" value="${escapeAttr(v)}" ${mpxLabel} ${parentAttr} ${req} ${dep}> ${escapeHtml(v)}</label>`,
        )
        .join("");
      return `${wrapOpen}<span class="cf-group-label" id="${escapeAttr(groupLabelId)}">${label}</span><div class="${dir}" role="radiogroup" aria-labelledby="${escapeAttr(groupLabelId)}"${f.required ? ` aria-required="true"` : ""}>${opts}</div></div>`;
    }

    case FT.FileUpload: {
      // Rendered for parity; file bytes are not submitted in this version.
      const fileId = fieldId(`${name}_file`, idPrefix);
      return `${wrapOpen}<label for="${escapeAttr(fileId)}">${label}</label><input class="cf-input" type="file" id="${escapeAttr(fileId)}" data-mpx-label="${escapeAttr(f.fieldLabel)}" name="${name}_file" ${dep}><small class="cf-note">${escapeHtml(t("customForm.fileUploadUnsupported"))}</small></div>`;
    }

    case FT.TextBox:
    default:
      return `${wrapOpen}${labelFor}<input class="cf-input" type="text" ${named} name="${name}" maxlength="250" ${req} ${dep}></div>`;
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
  .cf-field { display: flex; flex-direction: column; gap: var(--_nw-space-1); margin-bottom: var(--_nw-space-3); }
  .cf-field > label, .cf-field > .cf-group-label { font-size: 13px; font-weight: 600; color: var(--_nw-color-muted); }
  .cf-input { padding: 9px var(--_nw-space-3); border: var(--_nw-border-width) solid var(--_nw-color-border-strong); border-radius: var(--_nw-radius); font-size: var(--_nw-font-size-base); font-family: inherit; color: var(--_nw-color-text); background: var(--_nw-color-surface); outline: none; }
  .cf-input:focus { border-color: var(--_nw-color-primary); box-shadow: 0 0 0 1px var(--_nw-color-primary); }
  textarea.cf-input { min-height: 80px; resize: vertical; }
  .cf-checkbox { display: flex; align-items: center; gap: var(--_nw-space-2); font-size: var(--_nw-font-size-base); }
  .cf-checkbox input, .cf-radio input { width: auto; }
  .cf-radio-v { display: flex; flex-direction: column; gap: 6px; }
  .cf-radio-h { display: flex; flex-wrap: wrap; gap: var(--_nw-space-4); }
  .cf-radio { display: inline-flex; align-items: center; gap: 6px; font-size: var(--_nw-font-size-base); font-weight: 400; color: var(--_nw-color-text); }
  .cf-instructions { font-size: var(--_nw-font-size-base); color: var(--_nw-color-text-subtle); margin: 0; }
  .cf-note { color: var(--_nw-color-muted); font-size: 12px; }
`;
