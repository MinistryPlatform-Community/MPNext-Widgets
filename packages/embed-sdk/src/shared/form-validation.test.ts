/**
 * `field()` and the labelled "required" message (C28, C29, C19 row 10).
 *
 * C28 was 13 of 14 controls on plan-your-visit and 20 of 27 on custom-form
 * with no accessible name: sibling `<label>`s with no `for`. So the
 * load-bearing assertion is `control.labels`, which only a correct `for`/`id`
 * pair produces.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { tEnglish } from "../i18n";
import { field, fieldId, validateForm, FORM_VALIDATION_STYLES } from "./form-validation";

function mountForm(html: string): HTMLFormElement {
  document.body.innerHTML = `<form novalidate>${html}</form>`;
  return document.querySelector("form")!;
}

describe("field()", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("gives the control an accessible name through <label for>", () => {
    const form = mountForm(field({ name: "first_name", label: "First Name", idPrefix: "nw1" }));
    const input = form.querySelector("input")!;
    expect(input.id).toBe("nw1-f-first_name");
    expect(input.labels).toHaveLength(1);
    expect(input.labels![0].textContent).toBe("First Name");
    expect(input.type).toBe("text");
  });

  it("keeps the required star inside the label, aria-hidden", () => {
    const form = mountForm(field({ name: "email", label: "Email", type: "email", required: true }));
    const label = form.querySelector("label")!;
    const star = label.querySelector(".mpx-req")!;
    expect(star).not.toBeNull();
    expect(star.getAttribute("aria-hidden")).toBe("true");
    expect(form.querySelector("input")!.required).toBe(true);
  });

  it("type=tel implies autocomplete=tel and inputmode=tel (C29)", () => {
    const input = mountForm(field({ name: "mobile", label: "Mobile", type: "tel" })).querySelector("input")!;
    expect(input.type).toBe("tel");
    expect(input.getAttribute("autocomplete")).toBe("tel");
    expect(input.getAttribute("inputmode")).toBe("tel");
  });

  it("lets an explicit autocomplete override the tel default", () => {
    const input = mountForm(
      field({ name: "work", label: "Work", type: "tel", autocomplete: "work tel" }),
    ).querySelector("input")!;
    expect(input.getAttribute("autocomplete")).toBe("work tel");
  });

  it("cannot collide across two widget instances", () => {
    expect(fieldId("email", "nw1")).not.toBe(fieldId("email", "nw2"));
    expect(fieldId("Contact[Email] 2", "nw3")).toBe("nw3-f-Contact-Email-2");
  });

  it("wires describedBy to help text ids", () => {
    const input = mountForm(
      `<p id="hint">Ten digits</p>${field({ name: "phone", label: "Phone", describedBy: ["hint", ""] })}`,
    ).querySelector("input")!;
    expect(input.getAttribute("aria-describedby")).toBe("hint");
  });

  it("renders a textarea and a select with the same label wiring", () => {
    const form = mountForm(
      field({ name: "notes", label: "Notes", type: "textarea", value: "<hi>" }) +
        field({
          name: "campus",
          label: "Campus",
          type: "select",
          value: "2",
          options: [
            { value: "", label: "Choose…" },
            { value: "1", label: "North" },
            { value: "2", label: "South" },
          ],
        }),
    );
    const textarea = form.querySelector("textarea")!;
    expect(textarea.labels).toHaveLength(1);
    expect(textarea.value).toBe("<hi>");
    const select = form.querySelector("select")!;
    expect(select.labels).toHaveLength(1);
    expect(select.value).toBe("2");
  });

  it("escapes the label, value and attributes", () => {
    const form = mountForm(
      field({
        name: "x",
        label: "<img src=x onerror=alert(1)>",
        value: '"><script>',
        attrs: { maxlength: 5, "data-x": '"q"' },
      }),
    );
    expect(form.querySelector("img")).toBeNull();
    expect(form.querySelector("script")).toBeNull();
    const input = form.querySelector("input")!;
    expect(input.value).toBe('"><script>');
    expect(input.maxLength).toBe(5);
    expect(input.dataset.x).toBe('"q"');
  });

  it("is a wrapper validateForm() recognises", () => {
    const form = mountForm(field({ name: "city", label: "City", required: true }));
    const { valid } = validateForm(form, { t: tEnglish, focusFirstInvalid: false });
    expect(valid).toBe(false);
    expect(form.querySelector("[data-mpx-field]")!.classList.contains("mpx-invalid")).toBe(true);
  });
});

describe("validation.required with a {label} slot (C19 row 10)", () => {
  it("names the field when the control came from field()", () => {
    const form = mountForm(field({ name: "city", label: "City", required: true }));
    validateForm(form, { t: tEnglish, focusFirstInvalid: false });
    const error = form.querySelector(".mpx-field-error")!;
    expect(error.textContent).toBe("City is required.");
    // ...and the control points at the message that now exists.
    expect(form.querySelector("input")!.getAttribute("aria-describedby")).toContain(error.id);
  });

  it("keeps the bare sentence for hand-written markup", () => {
    const form = mountForm(`<div data-mpx-field><input name="city" required></div>`);
    validateForm(form, { t: tEnglish, focusFirstInvalid: false });
    expect(form.querySelector(".mpx-field-error")!.textContent).toBe("This field is required.");
  });
});

describe("FORM_VALIDATION_STYLES", () => {
  it("still styles the star and the error node", () => {
    expect(FORM_VALIDATION_STYLES).toContain(".mpx-req");
    expect(FORM_VALIDATION_STYLES).toContain(".mpx-field-error");
  });
});
