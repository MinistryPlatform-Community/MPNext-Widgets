/**
 * Tests for `<next-prayer-feedback>` (C69).
 *
 * The load-bearing ones, none of which is about markup:
 *
 *   - the server's English `message` must appear **nowhere** in the shadow root.
 *     That is the whole point of the machine-code error contract: a Spanish
 *     congregant must never read "Missing formId or formGuid".
 *   - `initLocale()` must resolve before the first `render()`, or a Spanish
 *     visitor watches English swap under them.
 *   - the phone field must carry no `pattern`. C24 is the cautionary tale: MP's
 *     *display* mask `xxx-xxx-xxxx` used as a validation pattern made
 *     `next-plan-your-visit` unsubmittable.
 *   - failed validation must reach the network zero times.
 *   - with no `feedback-type-ids`, no option matching `/removal/i` may render.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAuthSession } from "../shared/auth-session";
import { __resetLocaleSession } from "../i18n";
import "./prayer-feedback";

const HOST = "https://widgets.example.com";
/** Same-origin with jsdom's document URL: `history.replaceState` refuses others. */
const PAGE = "/prayer";

const TYPES = [
  { id: 1, name: "Prayer Request", description: null },
  { id: 2, name: "Praise Report", description: null },
  { id: 3, name: "Comments", description: null },
];

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function makeJwt(): string {
  return `${b64url({ alg: "HS256" })}.${b64url({ exp: Math.floor(Date.now() / 1000) + 300 })}.sig`;
}
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

interface FetchRoutes {
  types?: Response;
  submitter?: Response;
  submit?: (body: Record<string, unknown>) => Response;
  verify?: (body: Record<string, unknown>) => Response;
}

/** Routes the config + session mint, then the widget's own three endpoints. */
function mockFetch(routes: FetchRoutes = {}) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

    if (url.includes("/api/embed/auth/config")) return jsonResponse({ mode: "legacy" });
    if (url.includes("/api/embed/session")) return jsonResponse({ token: makeJwt() });
    if (url.includes("/prayer-feedback/types")) {
      return routes.types ?? jsonResponse({ types: TYPES });
    }
    if (url.includes("/prayer-feedback/submitter")) {
      // 401 is the normal answer for a signed-out visitor, not an error.
      return routes.submitter ?? jsonResponse({ error: "auth_required" }, 401);
    }
    if (url.includes("/prayer-feedback/submit")) {
      return routes.submit
        ? routes.submit(body)
        : jsonResponse({ status: "verification_sent" });
    }
    if (url.includes("/prayer-feedback/verify")) {
      return routes.verify
        ? routes.verify(body)
        : jsonResponse({ status: "verified", feedbackEntryId: 555 });
    }
    return jsonResponse({ error: "not_found" }, 404);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function calls(fn: ReturnType<typeof mockFetch>, fragment: string) {
  return fn.mock.calls.filter(([input]) => String(input).includes(fragment));
}

/**
 * The JSON bodies posted to a URL containing `fragment`.
 *
 * Bodyless calls are skipped: `/prayer-feedback/submit` is a substring of
 * `/prayer-feedback/submitter`, and that one is a GET.
 */
function postedTo(fn: ReturnType<typeof mockFetch>, fragment: string) {
  return calls(fn, fragment)
    .filter(([, init]) => Boolean((init as RequestInit | undefined)?.body))
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);
}

function setLocation(search: string): void {
  window.history.replaceState(null, "", `${PAGE}${search}`);
}

function mount(attrs = ""): HTMLElement {
  document.body.innerHTML = `<next-prayer-feedback api-host="${HOST}" ${attrs}></next-prayer-feedback>`;
  return document.body.firstElementChild as HTMLElement;
}

const shadow = (el: HTMLElement) => el.shadowRoot!;
const text = (el: HTMLElement) => shadow(el).textContent ?? "";
const form = (el: HTMLElement) => shadow(el).querySelector<HTMLFormElement>("form.pf-form");
const field = (el: HTMLElement, name: string) =>
  shadow(el).querySelector<HTMLInputElement>(`[name="${name}"]`);
const headline = (el: HTMLElement) =>
  shadow(el).querySelector(".pf-headline")?.textContent ?? "";

/** Mount inside an optional locale wrapper and wait for the form to paint. */
async function mountWithForm(attrs = ""): Promise<HTMLElement> {
  const el = mount(attrs);
  await vi.waitFor(() => expect(form(el)).not.toBeNull());
  return el;
}

/** Mount and wait for a terminal (non-form) headline. */
async function mountSettled(attrs = ""): Promise<HTMLElement> {
  const el = mount(attrs);
  await vi.waitFor(() => expect(headline(el)).not.toBe(""));
  return el;
}

const TEMPLATE = 'verification-email-template-id="5125"';

describe("<next-prayer-feedback>", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete (window as unknown as { __nextAuthSession?: unknown }).__nextAuthSession;
    __resetLocaleSession();
    document.documentElement.removeAttribute("lang");
    window.history.replaceState(null, "", PAGE);
    window.__nextTokenProvider = {
      get: () => getAuthSession(HOST).getToken("prayer-feedback"),
      refresh: () => getAuthSession(HOST).refreshToken("prayer-feedback"),
    };
    window.__nextSDKReady = Promise.resolve();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockFetch();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    window.history.replaceState(null, "", PAGE);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("registers as next-prayer-feedback", () => {
    expect(customElements.get("next-prayer-feedback")).toBeTruthy();
  });

  describe("localisation ordering", () => {
    it("resolves the catalogue before the first render", async () => {
      const order: string[] = [];
      const proto = Object.getPrototypeOf(
        document.createElement("next-prayer-feedback")
      ) as { render: () => void; initLocale: () => Promise<void> };

      const renderSpy = vi.spyOn(proto, "render").mockImplementation(() => {
        order.push("render");
      });
      const initSpy = vi
        .spyOn(proto as unknown as { initLocale: () => Promise<void> }, "initLocale")
        .mockImplementation(async () => {
          order.push("initLocale");
        });

      mount(TEMPLATE);
      await vi.waitFor(() => expect(order).toContain("render"));

      expect(order[0]).toBe("initLocale");
      expect(order.indexOf("initLocale")).toBeLessThan(order.indexOf("render"));
      renderSpy.mockRestore();
      initSpy.mockRestore();
    });

    it("never paints the English heading on a Spanish page", async () => {
      // Mounted inside `<div lang="es">`, the widget must be Spanish at *every*
      // tick — the assertion that an English-then-Spanish swap is impossible.
      document.body.innerHTML = `<div lang="es"><next-prayer-feedback api-host="${HOST}" ${TEMPLATE}></next-prayer-feedback></div>`;
      const el = document.querySelector("next-prayer-feedback") as HTMLElement;

      const seen: string[] = [];
      const stop = setInterval(() => {
        const heading = shadow(el)?.querySelector(".pf-title")?.textContent;
        if (heading) seen.push(heading);
      }, 0);

      await vi.waitFor(() => expect(form(el)).not.toBeNull());
      clearInterval(stop);

      expect(shadow(el).querySelector(".pf-title")?.textContent).toBe(
        "Oración y comentarios"
      );
      expect(seen).not.toContain("Prayer & Feedback");
      expect(el.getAttribute("lang")).toBe("es");
    });

    it("renders the Brazilian Portuguese heading", async () => {
      document.documentElement.setAttribute("lang", "pt-BR");
      const el = await mountWithForm(TEMPLATE);
      expect(shadow(el).querySelector(".pf-title")?.textContent).toBe(
        "Oração e comentários"
      );
    });
  });

  describe("the anonymous form", () => {
    it("requires first name, last name and email", async () => {
      const el = await mountWithForm(TEMPLATE);

      for (const name of ["firstName", "lastName", "email"]) {
        expect(field(el, name)).toHaveAttribute("required");
      }
      expect(field(el, "email")).toHaveAttribute("type", "email");
    });

    it("renders the phone as type=tel with no pattern (the C24 guard)", async () => {
      // MP's *display* mask `xxx-xxx-xxxx` pressed into service as a validation
      // pattern is what made `next-plan-your-visit` unsubmittable.
      const el = await mountWithForm(TEMPLATE);
      const phone = field(el, "mobilePhone");

      expect(phone).toHaveAttribute("type", "tel");
      expect(phone).not.toHaveAttribute("pattern");
      expect(phone).not.toHaveAttribute("required");
    });

    it("gives every control a real label[for]", async () => {
      // C28 is open against `next-plan-your-visit` and `next-custom-form` for
      // exactly this; there must not be a third.
      const el = await mountWithForm(TEMPLATE);
      const root = shadow(el);

      for (const id of [
        "pf-first-name",
        "pf-last-name",
        "pf-email",
        "pf-mobile-phone",
        "pf-type",
        "pf-summary",
        "pf-details",
      ]) {
        expect(root.querySelector(`label[for="${id}"]`), id).not.toBeNull();
        expect(root.querySelector(`#${id}`), id).not.toBeNull();
      }
    });

    it("shows a sign-in affordance but never a sign-in gate", async () => {
      const el = await mountWithForm(TEMPLATE);
      expect(shadow(el).querySelector('[data-action="sign-in"]')).not.toBeNull();
      // The form is right there regardless: the whole point is that a stranger
      // can use it.
      expect(field(el, "summary")).not.toBeNull();
    });

    it("caps the summary at 50 and the details at 2000", async () => {
      const el = await mountWithForm(TEMPLATE);
      expect(field(el, "summary")).toHaveAttribute("maxlength", "50");
      expect(shadow(el).querySelector('[name="description"]')).toHaveAttribute(
        "maxlength",
        "2000"
      );
    });

    it("sends no request when a required field is empty", async () => {
      const fn = mockFetch();
      const el = await mountWithForm(TEMPLATE);

      form(el)!.requestSubmit();
      await vi.waitFor(() =>
        expect(shadow(el).querySelector(".mpx-field-error")).not.toBeNull()
      );

      expect(postedTo(fn, "/prayer-feedback/submit")).toEqual([]);
      expect(shadow(el).querySelector('[data-role="form-message"]')?.textContent).toBe(
        "Please complete the required fields."
      );
    });

    it("posts the whole submission and reports verification_sent", async () => {
      const fn = mockFetch();
      const el = await mountWithForm(
        `${TEMPLATE} program-id="12" acknowledgement-email-template-id="6000"`
      );

      field(el, "firstName")!.value = "Doug";
      field(el, "lastName")!.value = "Smith";
      field(el, "email")!.value = "doug@example.com";
      shadow(el).querySelector<HTMLSelectElement>('[name="feedbackTypeId"]')!.value = "1";
      field(el, "summary")!.value = "Please pray for my family";

      form(el)!.requestSubmit();
      await vi.waitFor(() => expect(headline(el)).not.toBe(""));

      const [body] = postedTo(fn, "/prayer-feedback/submit");
      expect(body).toMatchObject({
        feedbackTypeId: 1,
        summary: "Please pray for my family",
        firstName: "Doug",
        lastName: "Smith",
        email: "doug@example.com",
        programId: 12,
        acknowledgementEmailTemplateId: 6000,
        verificationEmailTemplateId: 5125,
        verifyParamName: "mpp-verify-id",
        isPrivate: false,
      });
      expect(String(body.returnUrl)).toContain(PAGE);
      expect(headline(el)).toBe(
        "Check your email and follow the link to confirm your request."
      );
    });

    it("emits verificationSent with the address it confirmed", async () => {
      const el = await mountWithForm(TEMPLATE);
      const events: unknown[] = [];
      el.addEventListener("verificationSent", (e) =>
        events.push((e as CustomEvent).detail)
      );

      field(el, "firstName")!.value = "Doug";
      field(el, "lastName")!.value = "Smith";
      field(el, "email")!.value = "doug@example.com";
      shadow(el).querySelector<HTMLSelectElement>('[name="feedbackTypeId"]')!.value = "2";
      field(el, "summary")!.value = "Thank you";

      form(el)!.requestSubmit();
      await vi.waitFor(() => expect(events).toHaveLength(1));
      expect(events[0]).toEqual({ email: "doug@example.com" });
    });
  });

  describe("the Feedback Type dropdown", () => {
    it("renders only the options the server returned", async () => {
      const el = await mountWithForm(TEMPLATE);
      const values = [
        ...shadow(el).querySelectorAll<HTMLOptionElement>('[name="feedbackTypeId"] option'),
      ].map((o) => o.value);

      // The empty placeholder plus the three real types, and nothing invented.
      expect(values).toEqual(["", "1", "2", "3"]);
    });

    it("never renders a removal option when no allowlist is configured", async () => {
      // The server excludes it; this asserts the widget adds nothing back.
      const el = await mountWithForm(TEMPLATE);
      const labels = [
        ...shadow(el).querySelectorAll<HTMLOptionElement>('[name="feedbackTypeId"] option'),
      ].map((o) => o.textContent ?? "");

      expect(labels.some((label) => /removal/i.test(label))).toBe(false);
    });

    it("passes a configured allowlist through as ?ids=", async () => {
      const fn = mockFetch();
      await mountWithForm(`${TEMPLATE} feedback-type-ids="1,2"`);
      expect(String(calls(fn, "/prayer-feedback/types")[0][0])).toContain("ids=1,2");
    });

    it("drops a non-numeric allowlist entry rather than sending the whole list", async () => {
      // The server would answer `invalid_request` for the list, which would take
      // the working ids down with the typo.
      const fn = mockFetch();
      await mountWithForm(`${TEMPLATE} feedback-type-ids="1,abc,3"`);

      expect(String(calls(fn, "/prayer-feedback/types")[0][0])).toContain("ids=1,3");
      expect(console.warn).toHaveBeenCalled();
    });

    it("echoes the allowlist in the submission", async () => {
      const fn = mockFetch();
      const el = await mountWithForm(`${TEMPLATE} feedback-type-ids="1,2"`);

      field(el, "firstName")!.value = "Doug";
      field(el, "lastName")!.value = "Smith";
      field(el, "email")!.value = "doug@example.com";
      shadow(el).querySelector<HTMLSelectElement>('[name="feedbackTypeId"]')!.value = "1";
      field(el, "summary")!.value = "Pray";
      form(el)!.requestSubmit();

      await vi.waitFor(() =>
        expect(postedTo(fn, "/prayer-feedback/submit")).toHaveLength(1)
      );
      expect(postedTo(fn, "/prayer-feedback/submit")[0].allowedTypeIds).toEqual([1, 2]);
    });
  });

  describe("the Private option", () => {
    it("is unticked by default", async () => {
      const el = await mountWithForm(TEMPLATE);
      const box = shadow(el).querySelector<HTMLInputElement>('[name="isPrivate"]');
      expect(box).not.toBeNull();
      expect(box!.checked).toBe(false);
    });

    it("pre-ticks with default-private", async () => {
      const el = await mountWithForm(`${TEMPLATE} default-private="true"`);
      expect(
        shadow(el).querySelector<HTMLInputElement>('[name="isPrivate"]')!.checked
      ).toBe(true);
    });

    it("hides the checkbox but still posts the forced value", async () => {
      const fn = mockFetch();
      const el = await mountWithForm(
        `${TEMPLATE} default-private="true" hide-private-option="true"`
      );

      expect(shadow(el).querySelector('[name="isPrivate"]')).toBeNull();

      field(el, "firstName")!.value = "Doug";
      field(el, "lastName")!.value = "Smith";
      field(el, "email")!.value = "doug@example.com";
      shadow(el).querySelector<HTMLSelectElement>('[name="feedbackTypeId"]')!.value = "1";
      field(el, "summary")!.value = "Pray";
      form(el)!.requestSubmit();

      await vi.waitFor(() =>
        expect(postedTo(fn, "/prayer-feedback/submit")).toHaveLength(1)
      );
      expect(postedTo(fn, "/prayer-feedback/submit")[0].isPrivate).toBe(true);
    });
  });

  describe("the signed-in form", () => {
    const SUBMITTER = {
      self: { contactId: 100, displayName: "Smith, Doug", hasEmail: true },
      household: [
        { contactId: 200, displayName: "Smith, Marie", hasEmail: false },
      ],
    };

    it("renders the household picker and hides the identity fields", async () => {
      mockFetch({ submitter: jsonResponse(SUBMITTER) });
      const el = await mountWithForm(TEMPLATE);

      const picker = shadow(el).querySelector<HTMLSelectElement>('[name="onBehalfOf"]');
      expect(picker).not.toBeNull();
      expect([...picker!.options].map((o) => o.textContent)).toEqual([
        "Smith, Doug",
        "Smith, Marie",
        "Someone else",
      ]);
      // The signed-in submitter has an address on file, so nothing is collected.
      expect(field(el, "firstName")!.disabled).toBe(true);
      expect(field(el, "email")!.disabled).toBe(true);
      expect(shadow(el).querySelector('[data-action="sign-in"]')).toBeNull();
    });

    it("re-shows the email field for a member with none on file", async () => {
      // Legacy's `ShowHideEmailContainer`, and the value the server backfills.
      mockFetch({ submitter: jsonResponse(SUBMITTER) });
      const el = await mountWithForm(TEMPLATE);

      const picker = shadow(el).querySelector<HTMLSelectElement>('[name="onBehalfOf"]')!;
      picker.value = "200";
      picker.dispatchEvent(new Event("change"));

      expect(field(el, "email")!.disabled).toBe(false);
      expect(field(el, "email")).toHaveAttribute("required");
      // Still not the names — that member's name is already on their record.
      expect(field(el, "firstName")!.disabled).toBe(true);
    });

    it("re-shows every identity field for the blank-form option", async () => {
      mockFetch({ submitter: jsonResponse(SUBMITTER) });
      const el = await mountWithForm(TEMPLATE);

      const picker = shadow(el).querySelector<HTMLSelectElement>('[name="onBehalfOf"]')!;
      picker.value = "";
      picker.dispatchEvent(new Event("change"));

      for (const name of ["firstName", "lastName", "email"]) {
        expect(field(el, name)!.disabled).toBe(false);
        expect(field(el, name), name).toHaveAttribute("required");
      }
      expect(field(el, "mobilePhone")!.disabled).toBe(false);
    });

    it("hides the blank-form option with no verification template", async () => {
      // Filing for someone outside the household takes the emailed round-trip,
      // so offering it without a template would fail at submit.
      mockFetch({ submitter: jsonResponse(SUBMITTER) });
      const el = await mountWithForm("");

      const picker = shadow(el).querySelector<HTMLSelectElement>('[name="onBehalfOf"]')!;
      expect([...picker.options].map((o) => o.value)).toEqual(["100", "200"]);
    });

    it("posts onBehalfOfContactId and no identity fields", async () => {
      const fn = mockFetch({
        submitter: jsonResponse(SUBMITTER),
        submit: () => jsonResponse({ status: "submitted", feedbackEntryId: 555 }),
      });
      const el = await mountWithForm(TEMPLATE);

      shadow(el).querySelector<HTMLSelectElement>('[name="feedbackTypeId"]')!.value = "1";
      field(el, "summary")!.value = "Pray for me";
      form(el)!.requestSubmit();

      await vi.waitFor(() => expect(headline(el)).not.toBe(""));
      const [body] = postedTo(fn, "/prayer-feedback/submit");

      expect(body.onBehalfOfContactId).toBe(100);
      // A `disabled` control is excluded from FormData, so a value typed before
      // switching the picker never travels with a household submission.
      expect(body).not.toHaveProperty("firstName");
      expect(body).not.toHaveProperty("email");
      expect(body).not.toHaveProperty("returnUrl");
      expect(headline(el)).toBe("Your request has been submitted. Thank you!");
    });

    it("emits feedbackSubmitted with the new entry id", async () => {
      mockFetch({
        submitter: jsonResponse(SUBMITTER),
        submit: () => jsonResponse({ status: "submitted", feedbackEntryId: 777 }),
      });
      const el = await mountWithForm(TEMPLATE);
      const events: unknown[] = [];
      el.addEventListener("feedbackSubmitted", (e) =>
        events.push((e as CustomEvent).detail)
      );

      shadow(el).querySelector<HTMLSelectElement>('[name="feedbackTypeId"]')!.value = "1";
      field(el, "summary")!.value = "Pray";
      form(el)!.requestSubmit();

      await vi.waitFor(() => expect(events).toHaveLength(1));
      expect(events[0]).toEqual({ feedbackEntryId: 777 });
    });
  });

  describe("the unconfigured notice", () => {
    it("renders notConfigured and no submit button for an anonymous visitor", async () => {
      // A misconfigured page must fail visibly at load, not after a visitor has
      // typed 2000 characters.
      const el = await mountSettled("");

      expect(headline(el)).toBe(
        "This form is not fully configured. Please contact the church."
      );
      expect(shadow(el).querySelector('[data-role="submit"]')).toBeNull();
      expect(form(el)).toBeNull();
    });

    it("does not appear for a signed-in submitter, who needs no template", async () => {
      mockFetch({
        submitter: jsonResponse({
          self: { contactId: 100, displayName: "Smith, Doug", hasEmail: true },
          household: [],
        }),
      });
      const el = await mountWithForm("");
      expect(text(el)).not.toContain("not fully configured");
    });
  });

  describe("the verification landing", () => {
    it("redeems the handle, never renders the form, and strips the URL", async () => {
      const fn = mockFetch();
      setLocation("?mpp-verify-id=abc123&page=2");
      const el = await mountSettled(TEMPLATE);

      expect(postedTo(fn, "/prayer-feedback/verify")).toEqual([{ token: "abc123" }]);
      expect(headline(el)).toBe("Your request has been submitted. Thank you!");
      expect(form(el)).toBeNull();
      // The handle must leave the address bar; unrelated parameters stay.
      expect(window.location.search).not.toContain("mpp-verify-id");
      expect(window.location.search).toContain("page=2");
    });

    it("honours verify-param-name", async () => {
      const fn = mockFetch();
      setLocation("?confirm=xyz");
      await mountSettled(`${TEMPLATE} verify-param-name="confirm"`);
      expect(postedTo(fn, "/prayer-feedback/verify")).toEqual([{ token: "xyz" }]);
    });

    it("emits feedbackVerified with the entry id", async () => {
      setLocation("?mpp-verify-id=abc123");
      const el = mount(TEMPLATE);
      const events: unknown[] = [];
      el.addEventListener("feedbackVerified", (e) =>
        events.push((e as CustomEvent).detail)
      );
      await vi.waitFor(() => expect(events).toHaveLength(1));
      expect(events[0]).toEqual({ feedbackEntryId: 555 });
    });

    it("fetches the type list zero times on the landing path", async () => {
      const fn = mockFetch();
      setLocation("?mpp-verify-id=abc123");
      await mountSettled(TEMPLATE);
      expect(calls(fn, "/prayer-feedback/types")).toEqual([]);
    });
  });

  describe("error rendering", () => {
    it("renders the catalogue sentence and never the server's English message", async () => {
      // **The single most important assertion in this file.** The English
      // `message` is a debug aid the server logs; a congregant must never read
      // it, in any language.
      setLocation("?mpp-verify-id=spent");
      mockFetch({
        verify: () =>
          jsonResponse(
            {
              error: "verification_used",
              message: "The verification handle has already been redeemed.",
            },
            409
          ),
      });
      const el = await mountSettled(TEMPLATE);

      expect(headline(el)).toBe("This link has already been used.");
      expect(text(el)).not.toContain("verification handle");
      expect(shadow(el).innerHTML).not.toContain("already been redeemed");
    });

    it("renders each verification outcome in its own words", async () => {
      const cases: [string, number, string][] = [
        ["verification_expired", 410, "This link has expired. Please submit the form again."],
        ["verification_invalid", 400, "This link is not valid. Please submit the form again."],
      ];

      for (const [code, status, sentence] of cases) {
        __resetLocaleSession();
        setLocation("?mpp-verify-id=whatever");
        mockFetch({ verify: () => jsonResponse({ error: code, message: "x" }, status) });
        const el = await mountSettled(TEMPLATE);
        expect(headline(el), code).toBe(sentence);
        document.body.innerHTML = "";
      }
    });

    it("renders a Spanish sentence for a machine code on a Spanish page", async () => {
      document.documentElement.setAttribute("lang", "es");
      setLocation("?mpp-verify-id=spent");
      mockFetch({
        verify: () =>
          jsonResponse({ error: "verification_used", message: "Already redeemed." }, 409),
      });
      const el = await mountSettled(TEMPLATE);

      expect(headline(el)).toBe("Este enlace ya se ha utilizado.");
      expect(text(el)).not.toContain("Already redeemed");
    });

    it("degrades an unknown code to the generic sentence", async () => {
      setLocation("?mpp-verify-id=x");
      mockFetch({
        verify: () =>
          jsonResponse({ error: "some_new_code", message: "Internal detail." }, 500),
      });
      const el = await mountSettled(TEMPLATE);

      expect(headline(el)).toBe("Something went wrong. Please try again.");
      expect(text(el)).not.toContain("Internal detail");
    });

    it("offers a retry after a failed type load", async () => {
      mockFetch({ types: jsonResponse({ error: "internal_error", message: "boom" }, 500) });
      const el = await mountSettled(TEMPLATE);

      expect(shadow(el).querySelector('[data-action="retry"]')).not.toBeNull();
      expect(text(el)).not.toContain("boom");
    });

    it("emits feedbackError on a failed submission", async () => {
      mockFetch({
        submit: () =>
          jsonResponse({ error: "feedback_save_failed", message: "MP said no." }, 500),
      });
      const el = await mountWithForm(TEMPLATE);
      const events: unknown[] = [];
      el.addEventListener("feedbackError", (e) => events.push((e as CustomEvent).detail));

      field(el, "firstName")!.value = "Doug";
      field(el, "lastName")!.value = "Smith";
      field(el, "email")!.value = "doug@example.com";
      shadow(el).querySelector<HTMLSelectElement>('[name="feedbackTypeId"]')!.value = "1";
      field(el, "summary")!.value = "Pray";
      form(el)!.requestSubmit();

      await vi.waitFor(() => expect(events).toHaveLength(1));
      expect(events[0]).toEqual({
        error: "We could not submit your request. Please try again.",
      });
    });
  });

  describe("the character counter", () => {
    it("stays silent until the limit is close", async () => {
      const el = await mountWithForm(TEMPLATE);
      const details = shadow(el).querySelector<HTMLTextAreaElement>('[name="description"]')!;
      const counter = shadow(el).querySelector('[data-role="counter"]')!;

      expect(counter.textContent).toBe("");

      details.value = "D".repeat(1900);
      details.dispatchEvent(new Event("input"));
      expect(counter.textContent).toBe("100 characters left");
    });

    it("pluralises at one", async () => {
      const el = await mountWithForm(TEMPLATE);
      const details = shadow(el).querySelector<HTMLTextAreaElement>('[name="description"]')!;
      const counter = shadow(el).querySelector('[data-role="counter"]')!;

      details.value = "D".repeat(1999);
      details.dispatchEvent(new Event("input"));
      expect(counter.textContent).toBe("1 character left");
    });

    it("pluralises in Spanish, including the shared other branch", async () => {
      document.documentElement.setAttribute("lang", "es");
      const el = await mountWithForm(TEMPLATE);
      const details = shadow(el).querySelector<HTMLTextAreaElement>('[name="description"]')!;
      const counter = shadow(el).querySelector('[data-role="counter"]')!;

      details.value = "D".repeat(1999);
      details.dispatchEvent(new Event("input"));
      expect(counter.textContent).toBe("queda 1 carácter");

      details.value = "D".repeat(1990);
      details.dispatchEvent(new Event("input"));
      expect(counter.textContent).toBe("quedan 10 caracteres");
    });
  });

  describe("cleanup", () => {
    it("calls super.disconnectedCallback so the locale listener is released", async () => {
      // Six components define their own `disconnectedCallback`; without the
      // super call each mount leaks a locale subscription and a
      // MutationObserver.
      const el = await mountWithForm(TEMPLATE);
      const proto = Object.getPrototypeOf(Object.getPrototypeOf(el)) as {
        disconnectedCallback: () => void;
      };
      const spy = vi.spyOn(proto, "disconnectedCallback");

      el.remove();
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });
});
