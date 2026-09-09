/**
 * Tests for `<next-subscribe-to-publication>` (C70).
 *
 * The load-bearing ones, none of which is about markup:
 *
 *   - the server's English `message` must appear **nowhere** in the shadow
 *     root. A congregant reading "No Available_Online publication has that id"
 *     in any language is the failure the machine-code contract exists to
 *     prevent.
 *   - `initLocale()` must resolve before the first `render()`, or a Spanish
 *     visitor watches English swap under them.
 *   - a URL carrying the handle goes straight to the verifying state, never
 *     paints the form, and the handle is stripped from the address bar before
 *     anything awaits.
 *   - failed validation must reach the network zero times.
 *   - the three link states must differ in **affordance**: expired and invalid
 *     offer a fresh sign-up, used offers none.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAuthSession } from "../shared/auth-session";
import { __resetLocaleSession } from "../i18n";
import "./subscribe-to-publication";

const HOST = "https://widgets.example.com";
/** Same-origin with jsdom's document URL: `history.replaceState` refuses others. */
const PAGE = "/newsletter";

const PUBLICATION = {
  Publication_ID: 4,
  Title: "Weekly Newsletter",
  Description: "Church news every Thursday",
};

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
  publication?: Response;
  send?: (body: Record<string, unknown>) => Response;
  verify?: (body: Record<string, unknown>) => Response;
}

function mockFetch(routes: FetchRoutes = {}) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

    if (url.includes("/api/embed/auth/config")) return jsonResponse({ mode: "legacy" });
    if (url.includes("/api/embed/session")) return jsonResponse({ token: makeJwt() });
    if (url.includes("/subscribe-to-publication/publication")) {
      return routes.publication ?? jsonResponse({ publication: PUBLICATION });
    }
    if (url.includes("/subscribe-to-publication/send-verification")) {
      return routes.send ? routes.send(body) : jsonResponse({ ok: true }, 202);
    }
    if (url.includes("/subscribe-to-publication/verify")) {
      return routes.verify
        ? routes.verify(body)
        : jsonResponse({
            subscribed: true,
            publicationTitle: "Weekly Newsletter",
            email: "ada@example.com",
            alreadySubscribed: false,
          });
    }
    return jsonResponse({ error: "not_found" }, 404);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function calls(fn: ReturnType<typeof mockFetch>, fragment: string) {
  return fn.mock.calls.filter(([input]) => String(input).includes(fragment));
}

function postedTo(fn: ReturnType<typeof mockFetch>, fragment: string) {
  return calls(fn, fragment)
    .filter(([, init]) => Boolean((init as RequestInit | undefined)?.body))
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);
}

function setLocation(search: string): void {
  window.history.replaceState(null, "", `${PAGE}${search}`);
}

const ATTRS = 'publication-id="4" verification-email-template-id="5125"';

function mount(attrs = ATTRS): HTMLElement {
  document.body.innerHTML = `<next-subscribe-to-publication api-host="${HOST}" ${attrs}></next-subscribe-to-publication>`;
  return document.body.firstElementChild as HTMLElement;
}

const shadow = (el: HTMLElement) => el.shadowRoot!;
const text = (el: HTMLElement) => shadow(el).textContent ?? "";
const form = (el: HTMLElement) => shadow(el).querySelector<HTMLFormElement>("form.sp-form");
const field = (el: HTMLElement, name: string) =>
  shadow(el).querySelector<HTMLInputElement>(`[name="${name}"]`);
const headline = (el: HTMLElement) =>
  shadow(el).querySelector(".sp-headline")?.textContent ?? "";

async function mountWithForm(attrs = ATTRS): Promise<HTMLElement> {
  const el = mount(attrs);
  await vi.waitFor(() => expect(form(el)).not.toBeNull());
  return el;
}

async function mountSettled(attrs = ATTRS): Promise<HTMLElement> {
  const el = mount(attrs);
  await vi.waitFor(() => expect(headline(el)).not.toBe(""));
  return el;
}

/** Fill the three fields and submit. */
async function submit(el: HTMLElement, email = "Ada@Example.com"): Promise<void> {
  field(el, "firstName")!.value = "Ada";
  field(el, "lastName")!.value = "Lovelace";
  field(el, "email")!.value = email;
  form(el)!.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
}

describe("<next-subscribe-to-publication>", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete (window as unknown as { __nextAuthSession?: unknown }).__nextAuthSession;
    __resetLocaleSession();
    document.documentElement.removeAttribute("lang");
    window.history.replaceState(null, "", PAGE);
    window.__nextTokenProvider = {
      get: () => getAuthSession(HOST).getToken("subscribe-to-publication"),
      refresh: () => getAuthSession(HOST).refreshToken("subscribe-to-publication"),
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

  it("registers as next-subscribe-to-publication", () => {
    expect(customElements.get("next-subscribe-to-publication")).toBeTruthy();
  });

  describe("localisation ordering", () => {
    it("resolves the catalogue before the first render", async () => {
      const order: string[] = [];
      const proto = Object.getPrototypeOf(
        document.createElement("next-subscribe-to-publication")
      ) as { render: () => void; initLocale: () => Promise<void> };

      const renderSpy = vi.spyOn(proto, "render").mockImplementation(() => {
        order.push("render");
      });
      const initSpy = vi
        .spyOn(proto as unknown as { initLocale: () => Promise<void> }, "initLocale")
        .mockImplementation(async () => {
          order.push("initLocale");
        });

      mount();
      await vi.waitFor(() => expect(order).toContain("render"));

      expect(order[0]).toBe("initLocale");
      renderSpy.mockRestore();
      initSpy.mockRestore();
    });

    it("renders Spanish under <html lang=es> with no English leak", async () => {
      document.documentElement.setAttribute("lang", "es");
      const el = await mountWithForm();

      expect(text(el)).toContain("Suscríbase a Weekly Newsletter");
      expect(text(el)).not.toContain("Subscribe to");
      expect(text(el)).not.toContain("First Name");
    });
  });

  describe("the form", () => {
    it("names the publication and renders its MP-authored description", async () => {
      const el = await mountWithForm();

      expect(shadow(el).querySelector(".sp-title")?.textContent).toBe(
        "Subscribe to Weekly Newsletter"
      );
      // Church-authored content, rendered as written — never translated.
      expect(text(el)).toContain("Church news every Thursday");
    });

    it("gives every control a real label[for]", async () => {
      // C28 is open against two widgets for exactly this; there must not be a
      // third.
      const el = await mountWithForm();
      for (const name of ["firstName", "lastName", "email"]) {
        const input = field(el, name)!;
        expect(input.id).not.toBe("");
        expect(shadow(el).querySelector(`label[for="${input.id}"]`)).not.toBeNull();
      }
    });

    it("caps the name and address fields at their MP column lengths", async () => {
      const el = await mountWithForm();
      expect(field(el, "firstName")!.getAttribute("maxlength")).toBe("50");
      expect(field(el, "lastName")!.getAttribute("maxlength")).toBe("50");
      expect(field(el, "email")!.getAttribute("maxlength")).toBe("254");
      expect(field(el, "email")!.type).toBe("email");
    });

    it("collects no phone number", async () => {
      // A newsletter opt-in needs a mailbox. Writing `Mobile_Phone` from an
      // anonymous form interacts with texting consent in ways a subscription
      // form has no business deciding.
      const el = await mountWithForm();
      expect(field(el, "mobilePhone")).toBeNull();
    });
  });

  describe("submitting", () => {
    it("posts the trimmed, lower-cased submission and shows the sent state", async () => {
      const fn = mockFetch();
      const el = await mountWithForm();
      await submit(el);

      await vi.waitFor(() =>
        expect(headline(el)).toBe("Check your email")
      );

      const [body] = postedTo(fn, "/send-verification");
      expect(body).toMatchObject({
        publicationId: 4,
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.com",
        verificationEmailTemplateId: 5125,
        verifyParamName: "nextwidgets_verify",
      });
      expect(String(body.returnUrl)).toContain("/newsletter");
    });

    it("names the submitted address in the sent state", async () => {
      const el = await mountWithForm();
      await submit(el);
      await vi.waitFor(() => expect(text(el)).toContain("ada@example.com"));
      expect(text(el)).toContain("Weekly Newsletter");
      expect(form(el)).toBeNull();
    });

    it("sends no contactId, whatever the host page does", async () => {
      const fn = mockFetch();
      const el = await mountWithForm();
      await submit(el);
      await vi.waitFor(() => expect(postedTo(fn, "/send-verification")).toHaveLength(1));

      expect(postedTo(fn, "/send-verification")[0]).not.toHaveProperty("contactId");
    });

    it("emits verificationSent with the address", async () => {
      const el = await mountWithForm();
      const seen: unknown[] = [];
      el.addEventListener("verificationSent", (e) => seen.push((e as CustomEvent).detail));

      await submit(el);
      await vi.waitFor(() => expect(seen).toHaveLength(1));
      expect(seen[0]).toEqual({ email: "ada@example.com" });
    });

    it("issues no request when a required field is empty", async () => {
      const fn = mockFetch();
      const el = await mountWithForm();

      field(el, "firstName")!.value = "Ada";
      field(el, "email")!.value = "";
      form(el)!.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));

      await vi.waitFor(() =>
        expect(
          shadow(el).querySelector<HTMLElement>('[data-role="form-message"]')?.hidden
        ).toBe(false)
      );
      expect(calls(fn, "/send-verification")).toHaveLength(0);
    });

    it("does not open a native validation popup", async () => {
      // The shared validator, never `reportValidity`: its popup is unstyleable,
      // escapes the shadow root and is not announced.
      const el = await mountWithForm();
      const spy = vi.spyOn(HTMLFormElement.prototype, "reportValidity");

      form(el)!.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("the verification landing", () => {
    it("goes straight to verifying and never paints the form", async () => {
      setLocation("?nextwidgets_verify=handle-123");
      const el = mount();

      await vi.waitFor(() => expect(headline(el)).not.toBe(""));
      expect(form(el)).toBeNull();
      expect(headline(el)).toBe("You're subscribed");
    });

    it("strips the handle from the address bar", async () => {
      // It must not survive in history, in the host page's analytics, or in a
      // later `Referer`.
      setLocation("?nextwidgets_verify=handle-123&page=2");
      mount();

      await vi.waitFor(() =>
        expect(new URL(window.location.href).searchParams.get("nextwidgets_verify")).toBeNull()
      );
      // A legitimate parameter the host page owns survives.
      expect(new URL(window.location.href).searchParams.get("page")).toBe("2");
    });

    it("POSTs the handle rather than putting it in a URL", async () => {
      const fn = mockFetch();
      setLocation("?nextwidgets_verify=handle-123");
      mount();

      await vi.waitFor(() => expect(calls(fn, "/subscribe-to-publication/verify")).toHaveLength(1));
      const [url, init] = calls(fn, "/subscribe-to-publication/verify")[0];
      expect((init as RequestInit).method).toBe("POST");
      expect(String(url)).not.toContain("handle-123");
      expect(postedTo(fn, "/subscribe-to-publication/verify")[0]).toEqual({
        token: "handle-123",
      });
    });

    it("honours a custom verify-param-name", async () => {
      const fn = mockFetch();
      setLocation("?confirm_me=handle-9");
      mount(`${ATTRS} verify-param-name="confirm_me"`);

      await vi.waitFor(() => expect(calls(fn, "/subscribe-to-publication/verify")).toHaveLength(1));
      expect(postedTo(fn, "/subscribe-to-publication/verify")[0]).toEqual({
        token: "handle-9",
      });
    });

    it("names the publication and the address in the verified state", async () => {
      setLocation("?nextwidgets_verify=handle-123");
      const el = await mountSettled();

      expect(text(el)).toContain("Weekly Newsletter");
      expect(text(el)).toContain("ada@example.com");
    });

    it("emits subscribed with alreadySubscribed", async () => {
      mockFetch({
        verify: () =>
          jsonResponse({
            subscribed: true,
            publicationTitle: "Weekly Newsletter",
            email: "ada@example.com",
            alreadySubscribed: true,
          }),
      });
      setLocation("?nextwidgets_verify=handle-123");
      const el = mount();
      const seen: unknown[] = [];
      el.addEventListener("subscribed", (e) => seen.push((e as CustomEvent).detail));

      await vi.waitFor(() => expect(seen).toHaveLength(1));
      expect(seen[0]).toEqual({
        publicationId: 4,
        email: "ada@example.com",
        alreadySubscribed: true,
      });
    });

    it("shows one success sentence whether or not they were already subscribed", async () => {
      mockFetch({
        verify: () =>
          jsonResponse({
            subscribed: true,
            publicationTitle: "Weekly Newsletter",
            email: "ada@example.com",
            alreadySubscribed: true,
          }),
      });
      setLocation("?nextwidgets_verify=handle-123");
      const el = await mountSettled();

      expect(headline(el)).toBe("You're subscribed");
      expect(text(el)).not.toMatch(/already/i);
    });
  });

  describe("the three link states differ in affordance", () => {
    async function landOn(code: string, status: number): Promise<HTMLElement> {
      mockFetch({
        verify: () => jsonResponse({ error: code, message: `English debug for ${code}` }, status),
      });
      setLocation("?nextwidgets_verify=handle-123");
      return mountSettled();
    }

    it("expired offers a fresh sign-up", async () => {
      const el = await landOn("verification_expired", 410);

      expect(headline(el)).toBe(
        "That confirmation link has expired. Sign up again to get a new one."
      );
      expect(shadow(el).querySelector('[data-action="sign-up-again"]')).not.toBeNull();
    });

    it("invalid offers a fresh sign-up, with different copy", async () => {
      const el = await landOn("verification_invalid", 400);

      expect(headline(el)).toBe("That confirmation link isn't valid. Please sign up again.");
      expect(shadow(el).querySelector('[data-action="sign-up-again"]')).not.toBeNull();
    });

    it("used offers neither a sign-up nor a retry, and reads as reassurance", async () => {
      // The likeliest cause is a second click on a link that already worked, so
      // signing up again would be pointless and retrying would fail
      // identically. It must not read as an error.
      const el = await landOn("verification_used", 409);

      expect(headline(el)).toBe("You're all set — this link has already been confirmed.");
      expect(shadow(el).querySelector('[data-action="sign-up-again"]')).toBeNull();
      expect(shadow(el).querySelector('[data-action="retry"]')).toBeNull();
      expect(shadow(el).querySelector(".sp-headline--warn")).toBeNull();
    });

    it("a store outage offers a retry that re-POSTs the same handle", async () => {
      // `internal_error` on this hop is a store failure in which the record was
      // *not* burned, so the same handle is still redeemable.
      const fn = mockFetch({
        verify: () => jsonResponse({ error: "internal_error", message: "Internal server error" }, 500),
      });
      setLocation("?nextwidgets_verify=handle-123");
      const el = await mountSettled();

      const retry = shadow(el).querySelector<HTMLButtonElement>('[data-action="retry"]');
      expect(retry).not.toBeNull();
      retry!.click();

      await vi.waitFor(() =>
        expect(postedTo(fn, "/subscribe-to-publication/verify")).toHaveLength(2)
      );
      expect(postedTo(fn, "/subscribe-to-publication/verify")[1]).toEqual({
        token: "handle-123",
      });
    });

    it("sign up again drops back to the form", async () => {
      const el = await landOn("verification_expired", 410);
      shadow(el).querySelector<HTMLButtonElement>('[data-action="sign-up-again"]')!.click();

      await vi.waitFor(() => expect(form(el)).not.toBeNull());
    });

    it("emits subscribeFailed with the machine code", async () => {
      mockFetch({
        verify: () => jsonResponse({ error: "verification_expired", message: "x" }, 410),
      });
      setLocation("?nextwidgets_verify=handle-123");
      const el = mount();
      const seen: unknown[] = [];
      el.addEventListener("subscribeFailed", (e) => seen.push((e as CustomEvent).detail));

      await vi.waitFor(() => expect(seen).toHaveLength(1));
      expect(seen[0]).toEqual({ code: "verification_expired" });
    });
  });

  describe("the server's English never reaches the page", () => {
    it("renders the catalogue sentence, not the response message", async () => {
      mockFetch({
        verify: () =>
          jsonResponse(
            { error: "verification_expired", message: "The confirmation handle has expired." },
            410
          ),
      });
      setLocation("?nextwidgets_verify=handle-123");
      const el = await mountSettled();

      expect(text(el)).not.toContain("The confirmation handle has expired.");
      expect(text(el)).not.toContain("handle");
    });

    it("degrades an unmapped code to the generic sentence", async () => {
      mockFetch({
        verify: () =>
          jsonResponse({ error: "some_future_code", message: "Nobody has translated this." }, 500),
      });
      setLocation("?nextwidgets_verify=handle-123");
      const el = await mountSettled();

      expect(text(el)).toContain("Something went wrong. Please try again.");
      expect(text(el)).not.toContain("Nobody has translated this.");
    });

    it("shows a Spanish sentence for an English server message", async () => {
      document.documentElement.setAttribute("lang", "es");
      mockFetch({
        verify: () =>
          jsonResponse({ error: "verification_used", message: "Already redeemed." }, 409),
      });
      setLocation("?nextwidgets_verify=handle-123");
      const el = await mountSettled();

      expect(text(el)).toContain("Todo está listo");
      expect(text(el)).not.toContain("Already redeemed.");
    });
  });

  describe("host misconfiguration", () => {
    it("shows the not-available state for a publication that is not online", async () => {
      mockFetch({
        publication: jsonResponse(
          { error: "publication_not_found", message: "No Available_Online publication has that id." },
          404
        ),
      });
      const el = await mountSettled();

      expect(headline(el)).toBe("This publication isn't available for online sign-up.");
      expect(text(el)).not.toContain("Available_Online");
      expect(form(el)).toBeNull();
    });

    it("shows the same state when publication-id is missing, without fetching", async () => {
      const fn = mockFetch();
      const el = await mountSettled('verification-email-template-id="5125"');

      expect(headline(el)).toBe("This publication isn't available for online sign-up.");
      expect(calls(fn, "/subscribe-to-publication/publication")).toHaveLength(0);
    });

    it("offers a retry when the read fails for another reason", async () => {
      mockFetch({
        publication: jsonResponse({ error: "internal_error", message: "Internal server error" }, 500),
      });
      const el = await mountSettled();

      expect(shadow(el).querySelector('[data-action="retry"]')).not.toBeNull();
      expect(text(el)).toContain("Something went wrong. Please try again.");
    });
  });

  describe("my-subscriptions-url", () => {
    it("renders the manage link on the verified state when set", async () => {
      setLocation("?nextwidgets_verify=handle-123");
      const el = await mountSettled(`${ATTRS} my-subscriptions-url="/preferences"`);

      const link = shadow(el).querySelector<HTMLAnchorElement>(".sp-link");
      expect(link).not.toBeNull();
      expect(link!.getAttribute("href")).toBe("/preferences");
      expect(link!.textContent).toBe("Manage all your email preferences");
    });

    it("renders no link when unset", async () => {
      setLocation("?nextwidgets_verify=handle-123");
      const el = await mountSettled();
      expect(shadow(el).querySelector(".sp-link")).toBeNull();
    });

    it("renders it on the already-used state too, where it is the only way out", async () => {
      mockFetch({
        verify: () => jsonResponse({ error: "verification_used", message: "x" }, 409),
      });
      setLocation("?nextwidgets_verify=handle-123");
      const el = await mountSettled(`${ATTRS} my-subscriptions-url="/preferences"`);

      expect(shadow(el).querySelector(".sp-link")).not.toBeNull();
    });
  });

  describe("attribute changes", () => {
    it("re-renders when publication-id is set on a mounted element", async () => {
      // CROSS-4 / C39: no `oldValue !== null` guard, which is what makes several
      // widgets in this repo ignore the first set.
      const fn = mockFetch({
        publication: jsonResponse({
          publication: { Publication_ID: 9, Title: "Youth Update", Description: null },
        }),
      });
      const el = await mountWithForm();

      el.setAttribute("publication-id", "9");
      await vi.waitFor(() =>
        expect(shadow(el).querySelector(".sp-title")?.textContent).toBe(
          "Subscribe to Youth Update"
        )
      );
      expect(
        calls(fn, "/subscribe-to-publication/publication").some(([url]) =>
          String(url).includes("publicationId=9")
        )
      ).toBe(true);
    });

    it("does nothing on the first attribute set, before the first paint", async () => {
      const el = document.createElement("next-subscribe-to-publication");
      el.setAttribute("publication-id", "4");
      expect(el.shadowRoot?.innerHTML ?? "").toBe("");
    });
  });

  describe("lifecycle", () => {
    it("cleans up the locale subscription on disconnect", async () => {
      // Six components define a `disconnectedCallback`, and each one that
      // forgets `super` leaks a locale subscription and a MutationObserver.
      const el = await mountWithForm();
      const proto = Object.getPrototypeOf(Object.getPrototypeOf(el)) as {
        disconnectedCallback: () => void;
      };
      const spy = vi.spyOn(proto, "disconnectedCallback");

      el.remove();
      expect(spy).toHaveBeenCalled();
    });
  });
});
