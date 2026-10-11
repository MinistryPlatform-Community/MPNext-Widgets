/**
 * Shared, standards-based form validation for ALL MPNext widgets.
 *
 * Replaces the browser's native `form.reportValidity()` popup bubble with an
 * inline, accessible pattern: a red required-star after the label, a red outline
 * (brand coral `#FF6D6A`) on invalid controls, and a friendly message rendered
 * below the field. Native HTML constraints (`required`, `type="email"`,
 * `pattern`, `maxlength`) remain the source of truth — we read them via the
 * Constraint Validation API and render our own UI. Every form already carries
 * `novalidate`, so the native popup simply never fires.
 *
 * Classes are prefix-neutral (`mpx-`) so each widget keeps its own `cf-`/`ed-`/
 * `nw-` styling; include {@link FORM_VALIDATION_STYLES} in the widget's
 * `injectStyles(...)` call.
 *
 * Usage:
 *   injectStyles(myStyles + FORM_VALIDATION_STYLES);
 *   // in markup: `<label>Email${requiredStar()}</label>`
 *   // on submit: if (!validateForm(form).valid) return;
 *   // once after render: bindLiveValidation(form);
 */

import { getLocaleSession, type Translator } from "../i18n";
import { escapeAttr, escapeHtml, renderAttrs } from "./html";

type ValidatableControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** Returns a friendly message string when the value is invalid, else null. */
export type CustomValidator = (value: string, form: HTMLFormElement) => string | null;

export interface ValidateOptions {
  /** CSS selector for the field wrapper that receives error state + the message. */
  wrapperSelector?: string;
  /** Friendly messages keyed by control `name` (overrides defaults). */
  messages?: Record<string, string>;
  /**
   * Per-field validators keyed by control `name`. Run in addition to native
   * constraints, so they can enforce formats (email/phone) even on optional
   * fields. Return a message to mark invalid, or null when valid.
   */
  customValidators?: Record<string, CustomValidator>;
  /** Focus + scroll the first invalid control into view (default true). */
  focusFirstInvalid?: boolean;
  /**
   * Translator for the built-in messages. Widgets pass their own `this.t` so a
   * form inside a `<div lang="es">` validates in Spanish even on an otherwise
   * English page; omitting it falls back to the page-wide locale.
   */
  t?: Translator;
}

const DEFAULT_WRAPPER_SELECTOR =
  ".cf-field, .ed-field, .nw-field, [data-mpx-field]";

/**
 * Red required marker for label markup. Visual only (`aria-hidden`): the
 * control's own `required` attribute conveys the requirement to assistive tech.
 */
export function requiredStar(): string {
  return ` <span class="mpx-req" aria-hidden="true">*</span>`;
}

// ── field(): a labelled control (C28, C29) ─────────────────────────────────

type FieldAttrValue = string | number | boolean | null | undefined;

export interface FieldOption {
  value: string;
  /** Visible text, already translated. Escaped by `field()`. */
  label: string;
  selected?: boolean;
  disabled?: boolean;
}

export interface FieldOptions {
  /** Control `name`; also the source of the stable `id`. */
  name: string;
  /** Visible label, already translated (`this.t("fields.email")`). Escaped by `field()`. */
  label: string;
  /**
   * An `<input>` type, or `"textarea"` / `"select"`. Default `"text"`.
   * `"tel"` implies `autocomplete="tel"` and `inputmode="tel"` (C29) unless
   * those are passed explicitly.
   */
  type?: string;
  required?: boolean;
  autocomplete?: string;
  inputmode?: string;
  /** Initial value (`value=` / textarea content / the matching `<option>`). */
  value?: string | number | null;
  placeholder?: string;
  /** `<option>`s for `type: "select"`. */
  options?: FieldOption[];
  /** Further attributes for the control: `maxlength`, `pattern`, `min`, `data-*`… */
  attrs?: Record<string, FieldAttrValue>;
  /**
   * Ids of help text that describes the control. The validation error node is
   * added to `aria-describedby` by `validateForm()` when — and only when — it
   * exists, so a never-rendered id is not referenced.
   */
  describedBy?: string | string[];
  /**
   * The widget's instance prefix (`this.instanceId`), so two widgets of the
   * same kind cannot mint the same id. Optional, but pass it.
   */
  idPrefix?: string;
  /** Wrapper class. Default `"nw-field"`. Keep the widget's own (`"cf-field"`). */
  wrapperClass?: string;
  /** Class on the control (`"cf-input"`). */
  inputClass?: string;
  /** Class on the `<label>`. */
  labelClass?: string;
}

/** A stable, id-safe slug of `name`, prefixed with the widget instance. */
export function fieldId(name: string, idPrefix?: string): string {
  const slug = name.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "field";
  return [idPrefix, "f", slug].filter(Boolean).join("-");
}

/**
 * A form control with a real accessible name: `<label for=id>` + the control,
 * inside a `[data-mpx-field]` wrapper that `validateForm()` recognises.
 *
 * - `requiredStar()` sits **inside** the label, so it is part of the click
 *   target; it is `aria-hidden`, and `required` conveys the requirement.
 * - The control carries `data-mpx-label`, so a missing value reads
 *   "{label} is required." instead of the anonymous "This field is required."
 * - `type: "tel"` gets `autocomplete="tel"` + `inputmode="tel"`.
 *
 * ```ts
 * field({ name: "mobile", label: this.t("fields.mobilePhone"), type: "tel",
 *         required: true, idPrefix: this.instanceId, wrapperClass: "cf-field",
 *         inputClass: "cf-input" })
 * ```
 */
export function field(opts: FieldOptions): string {
  const type = opts.type ?? "text";
  const id = fieldId(opts.name, opts.idPrefix);
  const describedBy = Array.isArray(opts.describedBy)
    ? opts.describedBy.filter(Boolean).join(" ")
    : (opts.describedBy ?? "");
  const isTel = type === "tel";

  const common = renderAttrs({
    id,
    name: opts.name,
    class: opts.inputClass || undefined,
    required: !!opts.required,
    autocomplete: opts.autocomplete ?? (isTel ? "tel" : undefined),
    inputmode: opts.inputmode ?? (isTel ? "tel" : undefined),
    placeholder: opts.placeholder,
    "aria-describedby": describedBy || undefined,
    "data-mpx-label": opts.label,
    ...opts.attrs,
  });

  const value = opts.value === null || opts.value === undefined ? "" : String(opts.value);
  let control: string;
  if (type === "textarea") {
    control = `<textarea${common}>${escapeHtml(value)}</textarea>`;
  } else if (type === "select") {
    const options = (opts.options ?? [])
      .map((o) => {
        const selected = o.selected ?? (value !== "" && o.value === value);
        return `<option${renderAttrs({ value: o.value, selected, disabled: !!o.disabled })}>${escapeHtml(o.label)}</option>`;
      })
      .join("");
    control = `<select${common}>${options}</select>`;
  } else {
    control = `<input${renderAttrs({ type })}${common}${renderAttrs({ value: value === "" ? undefined : value })}>`;
  }

  const labelClass = opts.labelClass ? ` class="${escapeAttr(opts.labelClass)}"` : "";
  const label = `<label for="${escapeAttr(id)}"${labelClass}>${escapeHtml(opts.label)}${opts.required ? requiredStar() : ""}</label>`;
  return `<div class="${escapeAttr(opts.wrapperClass ?? "nw-field")}" data-mpx-field>${label}${control}</div>`;
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/["\\\]]/g, "\\$&");
}

function isCandidate(el: Element): el is ValidatableControl {
  if (
    !(el instanceof HTMLInputElement) &&
    !(el instanceof HTMLSelectElement) &&
    !(el instanceof HTMLTextAreaElement)
  ) {
    return false;
  }
  if (!el.name) return false;
  if (el instanceof HTMLInputElement) {
    const t = el.type;
    if (t === "submit" || t === "button" || t === "reset" || t === "hidden") {
      return false;
    }
  }
  // `willValidate` is false for disabled / non-candidate controls.
  return el.willValidate;
}

/** All controls in `form` sharing this control's `name` (radio/checkbox groups). */
function sameNameControls(
  form: HTMLFormElement,
  el: ValidatableControl,
): ValidatableControl[] {
  const grouped =
    el instanceof HTMLInputElement && (el.type === "radio" || el.type === "checkbox");
  if (!grouped) return [el];
  return Array.from(
    form.querySelectorAll<ValidatableControl>(`[name="${cssEscape(el.name)}"]`),
  );
}

/** The selected/entered value of a control (the checked option for a group). */
function controlValue(form: HTMLFormElement, el: ValidatableControl): string {
  if (el instanceof HTMLInputElement && (el.type === "radio" || el.type === "checkbox")) {
    const checked = form.querySelector<HTMLInputElement>(
      `input[name="${cssEscape(el.name)}"]:checked`,
    );
    return checked ? checked.value : "";
  }
  return el.value ?? "";
}

function errorId(el: ValidatableControl): string {
  return `mpx-err-${el.name.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

/**
 * The translator for this validation pass.
 *
 * Widgets pass `this.t`; anything else (a demo page, a direct call) gets the
 * page-wide locale. Never `el.validationMessage` as a fallback — that string is
 * localised by the *browser*, to the browser's UI language, which is a
 * different language from the one the page is in more often than not.
 */
function translator(opts: ValidateOptions): Translator {
  return opts.t ?? getLocaleSession().translator();
}

function resolveMessage(el: ValidatableControl, opts: ValidateOptions): string {
  const custom = opts.messages?.[el.name];
  if (custom) return custom;
  const fromData = (el as HTMLElement).dataset?.errorMsg;
  if (fromData) return fromData;

  const t = translator(opts);
  const v = el.validity;
  if (v.valueMissing) {
    // `field()` stamps the visible label on the control, so the message can
    // say *which* field (C19 row 10). Hand-written markup has no stamp and
    // keeps the bare sentence.
    const label = (el as HTMLElement).dataset?.mpxLabel;
    return label
      ? t("validation.requiredField", { label })
      : t("validation.required");
  }
  if (v.typeMismatch && el instanceof HTMLInputElement && el.type === "email")
    return t("validation.email");
  if (v.typeMismatch && el instanceof HTMLInputElement && el.type === "url")
    return t("validation.url");
  // `title` is author-supplied copy describing the expected format, so it wins
  // over the generic message when present.
  if (v.patternMismatch) return el.title || t("validation.pattern");
  if (v.tooShort && el instanceof HTMLInputElement)
    return t("validation.tooShort", { min: el.minLength });
  if (v.tooLong && el instanceof HTMLInputElement)
    return t("validation.tooLong", { max: el.maxLength });
  if (v.rangeUnderflow || v.rangeOverflow) return t("validation.outOfRange");
  if (v.stepMismatch) return t("validation.invalidValue");
  return t("validation.generic");
}

/** Compute the error message for a single control, or null when it is valid. */
function computeError(
  form: HTMLFormElement,
  el: ValidatableControl,
  opts: ValidateOptions,
): string | null {
  const cv = opts.customValidators?.[el.name];
  if (cv) {
    const msg = cv(controlValue(form, el), form);
    if (msg) return msg;
  }
  if (el.willValidate && !el.checkValidity()) {
    return resolveMessage(el, opts);
  }
  return null;
}

function findMessageNode(scope: ParentNode | null, name: string): HTMLElement | null {
  if (!scope) return null;
  return scope.querySelector<HTMLElement>(
    `.mpx-field-error[data-mpx-error-for="${cssEscape(name)}"]`,
  );
}

function applyFieldError(
  form: HTMLFormElement,
  el: ValidatableControl,
  msg: string,
  opts: ValidateOptions,
): void {
  const wrapper = el.closest<HTMLElement>(
    opts.wrapperSelector || DEFAULT_WRAPPER_SELECTOR,
  );
  const id = errorId(el);
  const group = sameNameControls(form, el);

  for (const c of group) {
    c.classList.add("mpx-invalid");
    c.setAttribute("aria-invalid", "true");
    const describedBy = c.getAttribute("aria-describedby");
    if (!describedBy || !describedBy.split(/\s+/).includes(id)) {
      c.setAttribute("aria-describedby", describedBy ? `${describedBy} ${id}` : id);
    }
  }
  if (wrapper) wrapper.classList.add("mpx-invalid");

  let node = findMessageNode(wrapper ?? el.parentElement, el.name);
  if (!node) {
    node = document.createElement("span");
    node.className = "mpx-field-error";
    node.id = id;
    node.setAttribute("role", "alert");
    node.setAttribute("data-mpx-error-for", el.name);
    if (wrapper) wrapper.appendChild(node);
    else el.insertAdjacentElement("afterend", node);
  }
  node.textContent = msg;
}

/** Remove all error state (classes, aria, message) for a control or its group. */
export function clearFieldError(
  form: HTMLFormElement,
  el: ValidatableControl,
  opts: ValidateOptions = {},
): void {
  const wrapper = el.closest<HTMLElement>(
    opts.wrapperSelector || DEFAULT_WRAPPER_SELECTOR,
  );
  const id = errorId(el);
  for (const c of sameNameControls(form, el)) {
    c.classList.remove("mpx-invalid");
    c.removeAttribute("aria-invalid");
    const describedBy = c.getAttribute("aria-describedby");
    if (describedBy) {
      const next = describedBy
        .split(/\s+/)
        .filter((t) => t && t !== id)
        .join(" ");
      if (next) c.setAttribute("aria-describedby", next);
      else c.removeAttribute("aria-describedby");
    }
  }
  if (wrapper) wrapper.classList.remove("mpx-invalid");
  findMessageNode(wrapper ?? el.parentElement, el.name)?.remove();
}

/**
 * Validate every control in `form`, render inline error feedback, and return
 * whether the form is valid plus the first invalid control. Replaces
 * `form.reportValidity()` (no native popup). Focuses the first invalid control.
 */
export function validateForm(
  form: HTMLFormElement,
  opts: ValidateOptions = {},
): { valid: boolean; firstInvalid: ValidatableControl | null } {
  const seenGroups = new Set<string>();
  let firstInvalid: ValidatableControl | null = null;

  for (const el of Array.from(form.elements)) {
    if (!isCandidate(el)) continue;
    if (el instanceof HTMLInputElement && el.type === "radio") {
      if (seenGroups.has(el.name)) continue;
      seenGroups.add(el.name);
    }
    const err = computeError(form, el, opts);
    if (err) {
      applyFieldError(form, el, err, opts);
      if (!firstInvalid) firstInvalid = el;
    } else {
      clearFieldError(form, el, opts);
    }
  }

  if (firstInvalid && opts.focusFirstInvalid !== false) {
    try {
      firstInvalid.focus({ preventScroll: true });
      firstInvalid.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch {
      /* focus is best-effort */
    }
  }

  return { valid: !firstInvalid, firstInvalid };
}

/**
 * After the first submit, clear a field's error as soon as it becomes valid.
 * Never *adds* errors live (avoids nagging while typing). Idempotent per form.
 */
export function bindLiveValidation(
  form: HTMLFormElement,
  opts: ValidateOptions = {},
): void {
  if (form.dataset.mpxLiveBound) return;
  form.dataset.mpxLiveBound = "true";

  const handler = (e: Event) => {
    const el = e.target as Element | null;
    if (!el || !isCandidate(el)) return;
    if (!computeError(form, el, opts)) {
      clearFieldError(form, el, opts);
    }
  };

  form.addEventListener("input", handler);
  form.addEventListener("change", handler);
}

export const FORM_VALIDATION_STYLES = `
  .mpx-req { color: var(--_nw-color-error); font-weight: 700; }
  input.mpx-invalid,
  select.mpx-invalid,
  textarea.mpx-invalid {
    border-color: var(--_nw-color-error) !important;
    box-shadow: 0 0 0 2px rgba(255, 109, 106, 0.2) !important;
  }
  .mpx-field-error {
    display: block;
    font-size: 12px;
    line-height: 1.4;
    color: var(--_nw-color-error);
    margin-top: var(--_nw-space-1);
  }
`;
