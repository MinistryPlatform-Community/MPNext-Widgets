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

function resolveMessage(el: ValidatableControl, opts: ValidateOptions): string {
  const custom = opts.messages?.[el.name];
  if (custom) return custom;
  const fromData = (el as HTMLElement).dataset?.errorMsg;
  if (fromData) return fromData;

  const v = el.validity;
  if (v.valueMissing) return "This field is required.";
  if (v.typeMismatch && el instanceof HTMLInputElement && el.type === "email")
    return "Enter a valid email address.";
  if (v.typeMismatch && el instanceof HTMLInputElement && el.type === "url")
    return "Enter a valid URL.";
  if (v.patternMismatch) return el.title || "Please match the requested format.";
  if (v.tooShort && el instanceof HTMLInputElement)
    return `Please use at least ${el.minLength} characters.`;
  if (v.tooLong && el instanceof HTMLInputElement)
    return `Please use ${el.maxLength} characters or fewer.`;
  if (v.rangeUnderflow || v.rangeOverflow) return "Value is out of range.";
  if (v.stepMismatch) return "Please enter a valid value.";
  return el.validationMessage || "Please correct this field.";
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
  .mpx-req { color: #FF6D6A; font-weight: 700; }
  input.mpx-invalid,
  select.mpx-invalid,
  textarea.mpx-invalid {
    border-color: #FF6D6A !important;
    box-shadow: 0 0 0 2px rgba(255, 109, 106, 0.2) !important;
  }
  .mpx-field-error {
    display: block;
    font-size: 12px;
    line-height: 1.4;
    color: #FF6D6A;
    margin-top: 4px;
  }
`;
