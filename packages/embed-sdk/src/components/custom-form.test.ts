/**
 * Tests for `<next-custom-form>` and the shared MP field renderer it uses.
 *
 * Load-bearing:
 *   - C28: every control has an accessible name (20 of 27 had none).
 *   - C29: the contact phone is `type="tel"`; MP fields whose *label* reads
 *     like a phone stay text, because `Form_Field_Types` has no phone type.
 *   - Parity guard: the nine `Form_Field_Types` keep their names, input types
 *     and limits, because those decide what `Form_Response_Answers` stores.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAuthSession } from "../shared/auth-session";
import { __resetLocaleSession } from "../i18n";
import { renderCustomFormFields, type CustomFormField } from "../shared/custom-form";
import "./custom-form";

const HOST = "https://widgets.example.com";

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function makeJwt(sub = "public"): string {
  return `${b64url({ alg: "HS256" })}.${b64url({ sub, exp: Math.floor(Date.now() / 1000) + 300 })}.sig`;
}
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const f = (
  formFieldId: number,
  fieldType: number,
  fieldLabel: string,
  extra: Partial<CustomFormField> = {}
): CustomFormField => ({
  formFieldId,
  fieldLabel,
  fieldType,
  required: false,
  fieldOrder: formFieldId,
  fieldValues: [],
  dependsOn: null,
  dependsOnValue: null,
  isHidden: false,
  ...extra,
});

/** One field of each of MP's nine `Form_Field_Types`. */
const ALL_TYPES: CustomFormField[] = [
  f(1, 1, "Reference 1: Phone Number", { required: true }),
  f(2, 2, "Tell us about yourself"),
  f(3, 3, "Start date"),
  f(4, 4, "Shirt size", { fieldValues: ["S", "M", "L"], required: true }),
  f(5, 5, "Campus", { fieldValues: ["North", "South"] }),
  f(6, 6, "Please read the following."),
  f(7, 7, "Attending?", { fieldValues: ["Yes", "No"] }),
  f(8, 8, "I agree", { required: true }),
  f(9, 9, "Upload a photo"),
  f(10, 1, "Why not?", { dependsOn: 7, dependsOnValue: "No" }),
];

const HEADER = {
  formId: 6,
  formGuid: "2bb08341-5140-42e8-9b61-37c4950b1933",
  title: "Volunteer - Lead",
  instructions: null,
  completeMessage: null,
  getContactInfo: true,
  getAddressInfo: true,
  forceLogin: false,
  productId: null,
  standaloneOnly: false,
  isExpired: false,
  imageUrl: null,
  googleMapsApiKey: null,
};

const SELF = {
  contactId: 2,
  firstName: "Chris",
  lastName: "Kehayias",
  emailAddress: "chris@example.com",
  mobilePhoneNumber: "321-555-0100",
  addressLine1: "1 Main St",
  city: "Melbourne",
  stateRegion: "FL",
  postalCode: "32901",
};
const MEMBERS = [
  { contactId: 5, firstName: "Sarah", lastName: "Kehayias", nickName: null, emailAddress: null, mobilePhoneNumber: "321-555-0101" },
  { contactId: 2, firstName: "Chris", lastName: "Kehayias", nickName: null, emailAddress: "chris@example.com", mobilePhoneNumber: "321-555-0100" },
];

function mockFetch(opts: { signedIn?: boolean } = {}) {
  const fn = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    void _init;
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/embed/auth/config")) return jsonResponse({ mode: "legacy" });
    if (url.includes("/api/embed/session")) return jsonResponse({ token: makeJwt() });
    if (url.includes("/event-details/basic-contact")) {
      return opts.signedIn ? jsonResponse({ contact: SELF }) : jsonResponse({ error: "auth_required" }, 401);
    }
    if (url.includes("/api/embed/household")) return jsonResponse({ members: MEMBERS });
    if (url.includes("/api/embed/custom-form/submit")) return jsonResponse({ success: true });
    if (url.includes("/api/embed/custom-form")) return jsonResponse({ header: HEADER, fields: ALL_TYPES });
    return jsonResponse({ error: "not_found" }, 404);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const shadow = (el: HTMLElement) => el.shadowRoot!;
const form = (el: HTMLElement) => shadow(el).querySelector<HTMLFormElement>("#cf-form");

/** Controls with no accessible name (labels, aria-label or aria-labelledby). */
function unnamed(root: ParentNode): string[] {
  return Array.from(
    root.querySelectorAll<HTMLInputElement>("input:not([type=hidden]), select, textarea")
  )
    .filter((c) => {
      if (c.labels && c.labels.length) return false;
      if (c.getAttribute("aria-label")) return false;
      if (c.getAttribute("aria-labelledby")) return false;
      return true;
    })
    .map((c) => c.name);
}

async function mount(): Promise<HTMLElement> {
  document.body.innerHTML = `<next-custom-form api-host="${HOST}" form-id="6"></next-custom-form>`;
  const el = document.body.firstElementChild as HTMLElement;
  await vi.waitFor(() => expect(form(el)).not.toBeNull());
  return el;
}

describe("<next-custom-form>", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete (window as unknown as { __nextAuthSession?: unknown }).__nextAuthSession;
    __resetLocaleSession();
    window.__nextTokenProvider = {
      get: () => getAuthSession(HOST).getToken("custom-form"),
      refresh: () => getAuthSession(HOST).refreshToken("custom-form"),
    };
    window.__nextSDKReady = Promise.resolve();
    Element.prototype.scrollIntoView = vi.fn();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("reconfigure (C39)", () => {
    it("loads the form when form-id is set after a first load that had none", async () => {
      mockFetch();
      document.body.innerHTML = `<next-custom-form api-host="${HOST}"></next-custom-form>`;
      const el = document.body.firstElementChild as HTMLElement;
      await vi.waitFor(() => expect(shadow(el).textContent).toContain("No form specified."));
      el.setAttribute("form-id", "6");
      await vi.waitFor(() => expect(form(el)).not.toBeNull());
    });

    it("honours a form-id set while the first load is still in flight", async () => {
      const fn = mockFetch();
      document.body.innerHTML = `<next-custom-form api-host="${HOST}" form-guid="nope"></next-custom-form>`;
      const el = document.body.firstElementChild as HTMLElement;
      await vi.waitFor(() => expect(fn.mock.calls.some(([u]) => String(u).includes("formGuid=nope"))).toBe(true));
      el.setAttribute("form-id", "6");
      await vi.waitFor(() =>
        expect(fn.mock.calls.some(([u]) => String(u).includes("custom-form?formId=6"))).toBe(true)
      );
      await vi.waitFor(() => expect(form(el)).not.toBeNull());
    });
  });

  describe("Who is this form for? (C26)", () => {
    const posted = (fn: ReturnType<typeof mockFetch>) =>
      fn.mock.calls
        .filter(([u, init]) => String(u).includes("/custom-form/submit") && init?.body)
        .map(([, init]) => JSON.parse(String(init!.body)) as Record<string, string>);
    const ctl = (el: HTMLElement, name: string) =>
      shadow(el).querySelector<HTMLInputElement | HTMLSelectElement>(`#cf-form [name="${name}"]`)!;
    function answerRequired(el: HTMLElement) {
      (shadow(el).querySelector('[name="mp_customform_1"]') as HTMLInputElement).value = "x";
      (shadow(el).querySelector('[name="mp_customform_4"][value="M"]') as HTMLInputElement).checked = true;
      (shadow(el).querySelector('[name="mp_customform_8"]') as HTMLInputElement).checked = true;
    }

    it("renders no picker for an anonymous visitor, and posts no ContactId", async () => {
      const fn = mockFetch();
      const el = await mount();
      expect(ctl(el, "ContactId")).toBeNull();
      answerRequired(el);
      ctl(el, "FirstName").value = "Ada";
      ctl(el, "LastName").value = "Lovelace";
      ctl(el, "EmailAddress").value = "ada@example.com";
      ["AddressLine1", "City", "StateRegion", "PostalCode"].forEach((n) => (ctl(el, n).value = "x"));
      shadow(el).querySelector<HTMLButtonElement>(".cf-submit")!.click();
      await vi.waitFor(() => expect(posted(fn)).toHaveLength(1));
      expect(posted(fn)[0]).not.toHaveProperty("ContactId");
    });

    it("lists the signed-in user first, then the household, then Someone else", async () => {
      mockFetch({ signedIn: true });
      const el = await mount();
      await vi.waitFor(() => expect(ctl(el, "ContactId")).not.toBeNull());
      const select = ctl(el, "ContactId") as HTMLSelectElement;
      expect(Array.from(select.options).map((o) => [o.value, o.textContent])).toEqual([
        ["2", "Chris Kehayias"],
        ["5", "Sarah Kehayias"],
        ["", "Someone else (blank form)"],
      ]);
      expect(select.value).toBe("2");
      expect(select.labels?.[0]?.textContent).toContain("Who is this form for?");
    });

    it("fills the contact block from the chosen member and posts their ContactId", async () => {
      const fn = mockFetch({ signedIn: true });
      const el = await mount();
      await vi.waitFor(() => expect(ctl(el, "ContactId")).not.toBeNull());
      const select = ctl(el, "ContactId") as HTMLSelectElement;
      select.value = "5";
      select.dispatchEvent(new Event("change", { bubbles: true }));

      expect(ctl(el, "FirstName").value).toBe("Sarah");
      expect((ctl(el, "FirstName") as HTMLInputElement).readOnly).toBe(true);
      // Sarah has no email on file: the field stays editable.
      expect(ctl(el, "EmailAddress").value).toBe("");
      expect((ctl(el, "EmailAddress") as HTMLInputElement).readOnly).toBe(false);
      expect(ctl(el, "AddressLine1").value).toBe("1 Main St");

      ctl(el, "EmailAddress").value = "sarah@example.com";
      answerRequired(el);
      shadow(el).querySelector<HTMLButtonElement>(".cf-submit")!.click();
      await vi.waitFor(() => expect(posted(fn)).toHaveLength(1));
      expect(posted(fn)[0]).toMatchObject({ ContactId: "5", FirstName: "Sarah" });
      await vi.waitFor(() =>
        expect(shadow(el).querySelector(".cf-submitted-for")?.textContent).toBe("Submitted for Sarah Kehayias.")
      );
    });

    it("clears and unlocks the block for Someone else, posting an empty ContactId", async () => {
      const fn = mockFetch({ signedIn: true });
      const el = await mount();
      await vi.waitFor(() => expect(ctl(el, "ContactId")).not.toBeNull());
      const select = ctl(el, "ContactId") as HTMLSelectElement;
      select.value = "";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      expect(ctl(el, "FirstName").value).toBe("");
      expect((ctl(el, "FirstName") as HTMLInputElement).readOnly).toBe(false);

      ctl(el, "FirstName").value = "Grandma";
      ctl(el, "LastName").value = "Smith";
      ctl(el, "EmailAddress").value = "g@example.com";
      answerRequired(el);
      shadow(el).querySelector<HTMLButtonElement>(".cf-submit")!.click();
      await vi.waitFor(() => expect(posted(fn)).toHaveLength(1));
      expect(posted(fn)[0]).toMatchObject({ ContactId: "", FirstName: "Grandma" });
    });
  });

  describe("accessible names (C28) and tel (C29)", () => {
    it("names every control: contact, address and all nine field types", async () => {
      mockFetch();
      const el = await mount();
      expect(unnamed(form(el)!)).toEqual([]);
    });

    it("renders the contact phone as tel, but an MP field labelled 'Phone Number' as text", async () => {
      mockFetch();
      const el = await mount();
      const phone = shadow(el).querySelector<HTMLInputElement>('[name="MobilePhoneNumber"]')!;
      expect(phone.type).toBe("tel");
      expect(phone).toHaveAttribute("autocomplete", "tel");
      expect(shadow(el).querySelector<HTMLInputElement>('[name="mp_customform_1"]')!.type).toBe("text");
    });

    it("names the missing field in the required message", async () => {
      mockFetch();
      const el = await mount();
      shadow(el).querySelector<HTMLButtonElement>(".cf-submit")!.click();
      await vi.waitFor(() =>
        expect(shadow(el).querySelector('[data-mpx-error-for="FirstName"]')?.textContent).toBe(
          "First Name is required."
        )
      );
    });
  });
});

describe("renderCustomFormFields (parity guard)", () => {
  function render(fields = ALL_TYPES, idPrefix?: string) {
    const host = document.createElement("form");
    host.innerHTML = renderCustomFormFields(fields, { formId: 6, idPrefix });
    return host;
  }

  it("keeps every field's name, type and limits", () => {
    const host = render();
    const shape = (name: string) => {
      const els = host.querySelectorAll<HTMLInputElement>(`[name="${name}"]`);
      const el = els[0];
      return { tag: el.tagName.toLowerCase(), type: el.getAttribute("type"), count: els.length, maxlength: el.getAttribute("maxlength"), required: el.required };
    };
    expect(shape("mp_customformformid")).toMatchObject({ tag: "input", type: "hidden" });
    expect(shape("mp_customform_1")).toEqual({ tag: "input", type: "text", count: 1, maxlength: "250", required: true });
    expect(shape("mp_customform_2")).toEqual({ tag: "textarea", type: null, count: 1, maxlength: "30000", required: false });
    expect(shape("mp_customform_3")).toMatchObject({ tag: "input", type: "date" });
    expect(shape("mp_customform_4")).toMatchObject({ tag: "input", type: "radio", count: 3, required: true });
    expect(shape("mp_customform_5")).toMatchObject({ tag: "select", count: 1 });
    expect(host.querySelector('[data-field-id="6"] .cf-instructions')).not.toBeNull();
    expect(shape("mp_customform_7")).toMatchObject({ tag: "input", type: "radio", count: 2 });
    expect(shape("mp_customform_8")).toMatchObject({ tag: "input", type: "checkbox", required: true });
    expect(shape("mp_customform_9_file")).toMatchObject({ tag: "input", type: "file" });
    expect(host.querySelectorAll("select option")).toHaveLength(3);
  });

  it("stores the same answers: FormData carries the same keys and values", () => {
    const host = render();
    (host.querySelector('[name="mp_customform_1"]') as HTMLInputElement).value = "321-555-0100";
    (host.querySelector('[name="mp_customform_4"][value="M"]') as HTMLInputElement).checked = true;
    (host.querySelector('[name="mp_customform_5"]') as HTMLSelectElement).value = "South";
    (host.querySelector('[name="mp_customform_8"]') as HTMLInputElement).checked = true;
    const entries = Object.fromEntries(
      Array.from(new FormData(host).entries()).filter(([, v]) => typeof v === "string" && v !== "")
    );
    expect(entries).toEqual({
      mp_customformformid: "6",
      mp_customform_1: "321-555-0100",
      mp_customform_4: "M",
      mp_customform_5: "South",
      mp_customform_8: "true",
    });
  });

  it("keeps a dependent field hidden and disabled behind its wrapper", () => {
    const host = render();
    const wrapper = host.querySelector<HTMLElement>('[data-field-id="10"]')!;
    expect(wrapper.style.display).toBe("none");
    expect(wrapper.getAttribute("data-depends-on")).toBe("7");
    expect(host.querySelector<HTMLInputElement>('[name="mp_customform_10"]')!.disabled).toBe(true);
  });

  it("gives radio groups a radiogroup name and prefixes ids per instance", () => {
    const host = render(ALL_TYPES, "nw9");
    const group = host.querySelector('[data-field-id="4"] [role="radiogroup"]')!;
    const labelId = group.getAttribute("aria-labelledby")!;
    expect(host.querySelector(`#${labelId}`)!.textContent).toContain("Shirt size");
    expect(host.querySelector("#nw9-f-mp_customform_1")).not.toBeNull();
  });
});
