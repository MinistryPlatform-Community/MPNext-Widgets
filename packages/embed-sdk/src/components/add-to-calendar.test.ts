/**
 * Tests for <next-add-to-calendar> (packages/embed-sdk/src/components/add-to-calendar.ts)
 *
 * The widget used to hand rendering to the `add-to-calendar-button` CDN script,
 * so there was nothing local to assert. It now owns the menu, so these cover
 * the parts that were previously the library's:
 *   - the provider menu (open/close, keyboard, `providers` filtering)
 *   - URL handoff vs. .ics download per provider
 *   - which zone the MP wall-clock values are resolved against
 *   - the summary line rendering the church's wall clock, not the browser's
 *
 * The URL/ICS arithmetic itself lives in ../shared/calendar-links.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAuthSession } from "../shared/auth-session";
import "./add-to-calendar";

const HOST = "https://widgets.example.com";

const eventPayload = {
  Event_ID: 42,
  Event_Title: "Easter Service",
  Description: "<p>Easter celebration</p>",
  Event_Start_Date: "2026-04-05T10:00:00",
  Event_End_Date: "2026-04-05T11:30:00",
  Location_Name: "Main Auditorium",
  Address_Line_1: "123 Church St",
  City: "Springfield",
  State: "IL",
  Postal_Code: "62701",
  Time_Zone: "America/Chicago",
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

/** Routes the session mint plus the widget's own event fetch. */
function mockFetch(eventRoute: () => Response) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/embed/auth/config")) return jsonResponse({ mode: "legacy" });
    if (url.includes("/api/embed/session")) return jsonResponse({ token: makeJwt() });
    if (url.includes("/api/embed/add-to-calendar")) return eventRoute();
    return jsonResponse({ error: "not found" }, 404);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function mount(attrs = ""): HTMLElement {
  document.body.innerHTML = `<next-add-to-calendar api-host="${HOST}" event-id="42" ${attrs}></next-add-to-calendar>`;
  return document.body.firstElementChild as HTMLElement;
}
const shadow = (el: HTMLElement) => el.shadowRoot!;
const trigger = (el: HTMLElement) =>
  shadow(el).querySelector<HTMLButtonElement>(".atc-trigger");
const options = (el: HTMLElement) =>
  Array.from(shadow(el).querySelectorAll<HTMLButtonElement>(".atc-option"));

async function mountLoaded(attrs = ""): Promise<HTMLElement> {
  const el = mount(attrs);
  await vi.waitFor(() => expect(trigger(el)).not.toBeNull());
  return el;
}

describe("<next-add-to-calendar>", () => {
  let openSpy: ReturnType<typeof vi.spyOn>;
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete (window as unknown as { __nextAuthSession?: unknown }).__nextAuthSession;
    window.__nextTokenProvider = {
      get: () => getAuthSession(HOST).getToken("add-to-calendar"),
      refresh: () => getAuthSession(HOST).refreshToken("add-to-calendar"),
    };
    window.__nextSDKReady = Promise.resolve();
    mockFetch(() => jsonResponse(eventPayload));

    openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    // jsdom has no download plumbing; intercept the synthetic anchor click.
    clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    // jsdom's URL has no blob plumbing; stub only the two methods so the
    // global URL constructor the tests parse with stays intact.
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("loading and errors", () => {
    it("shows a spinner before the event resolves", async () => {
      // Hold the event request open, so the loading state is observable rather
      // than a race. Two things made the old synchronous assertion unreliable:
      // `connectedCallback` now awaits `initLocale()` before the first paint
      // (deliberate — the loading line carries copy, and painting it before the
      // catalogue resolves would show a Spanish visitor English first), and with
      // an immediately-resolving mock the spinner could come and go between
      // `waitFor` polls.
      let release!: (r: Response) => void;
      const pending = new Promise<Response>((resolve) => {
        release = resolve;
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url.includes("/api/embed/auth/config")) {
            return jsonResponse({ mode: "legacy" });
          }
          if (url.includes("/api/embed/session")) {
            return jsonResponse({ token: makeJwt() });
          }
          if (url.includes("/api/embed/add-to-calendar")) return pending;
          return jsonResponse({ error: "not_found" }, 404);
        }),
      );

      const el = mount();
      await vi.waitFor(() =>
        expect(shadow(el).querySelector(".nw-atc-spinner")).not.toBeNull(),
      );
      expect(trigger(el)).toBeNull();

      // Let it finish, so the pending promise does not leak into the next test.
      release(jsonResponse(eventPayload));
      await vi.waitFor(() => expect(trigger(el)).not.toBeNull());
    });

    it("errors without fetching when event-id is missing", async () => {
      const fetchSpy = mockFetch(() => jsonResponse(eventPayload));
      document.body.innerHTML = `<next-add-to-calendar api-host="${HOST}"></next-add-to-calendar>`;
      const el = document.body.firstElementChild as HTMLElement;

      await vi.waitFor(() =>
        expect(shadow(el).querySelector(".nw-atc-error")).not.toBeNull(),
      );
      // A congregant should never read an attribute name. The developer detail
      // goes to the console instead; the panel gets a translated sentence.
      expect(shadow(el).textContent).toContain(
        "This calendar link is not configured correctly.",
      );
      expect(shadow(el).textContent).not.toContain("event-id");
      expect(
        fetchSpy.mock.calls.filter(([u]) => String(u).includes("/add-to-calendar")),
      ).toHaveLength(0);
    });

    it("renders a translated sentence, not the server's English, on an API error", async () => {
      // Routes answer `{ error: "<code>", message: "<English>" }` and the
      // English half is debug-only. This route still answers with prose in
      // `error`, so the code is unmapped and `errorText` degrades to
      // `errors.generic` — the point being that nothing raw reaches the panel.
      mockFetch(() =>
        jsonResponse(
          { error: "event_not_found", message: "Event not found: 42" },
          404,
        ),
      );
      const el = mount();
      await vi.waitFor(() =>
        expect(shadow(el).querySelector(".nw-atc-error")).not.toBeNull(),
      );
      expect(shadow(el).textContent).toContain("We could not find that event.");
      expect(shadow(el).textContent).not.toContain("Event not found: 42");
    });

    it("emits calendarEventLoaded on success", async () => {
      const el = mount();
      const seen: unknown[] = [];
      el.addEventListener("calendarEventLoaded", (e) =>
        seen.push((e as CustomEvent).detail),
      );
      await vi.waitFor(() => expect(seen).toHaveLength(1));
      expect(seen[0]).toEqual({ eventId: 42, title: "Easter Service" });
    });
  });

  describe("the provider menu", () => {
    it("renders a closed trigger, no menu, until clicked", async () => {
      const el = await mountLoaded();
      expect(trigger(el)!.getAttribute("aria-expanded")).toBe("false");
      expect(shadow(el).querySelector(".atc-menu")).toBeNull();

      trigger(el)!.click();
      expect(trigger(el)!.getAttribute("aria-expanded")).toBe("true");
      expect(shadow(el).querySelector('[role="menu"]')).not.toBeNull();
    });

    it("offers the default provider set", async () => {
      const el = await mountLoaded();
      trigger(el)!.click();
      expect(options(el).map((o) => o.dataset.provider)).toEqual([
        "google",
        "apple",
        "outlook",
        "yahoo",
        "ics",
      ]);
    });

    it("narrows the set via the providers attribute, preserving order", async () => {
      const el = await mountLoaded(`providers="ics,google"`);
      trigger(el)!.click();
      expect(options(el).map((o) => o.dataset.provider)).toEqual(["ics", "google"]);
    });

    it("drops unknown provider ids", async () => {
      const el = await mountLoaded(`providers="google,notacalendar"`);
      trigger(el)!.click();
      expect(options(el).map((o) => o.dataset.provider)).toEqual(["google"]);
    });

    it("falls back to the default set when no id is recognised", async () => {
      const el = await mountLoaded(`providers="nope,alsonope"`);
      trigger(el)!.click();
      expect(options(el)).toHaveLength(5);
    });

    it("toggles shut on a second trigger click", async () => {
      const el = await mountLoaded();
      trigger(el)!.click();
      trigger(el)!.click();
      expect(shadow(el).querySelector(".atc-menu")).toBeNull();
    });

    it("closes on Escape", async () => {
      const el = await mountLoaded();
      trigger(el)!.click();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(shadow(el).querySelector(".atc-menu")).toBeNull();
    });

    it("closes on an outside pointerdown but not on an inside one", async () => {
      const el = await mountLoaded();
      trigger(el)!.click();

      // Inside: the event's composed path includes the host element.
      options(el)[0].dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, composed: true }),
      );
      expect(shadow(el).querySelector(".atc-menu")).not.toBeNull();

      document.body.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, composed: true }),
      );
      expect(shadow(el).querySelector(".atc-menu")).toBeNull();
    });

    it("wraps arrow-key focus at both ends of the menu", async () => {
      const el = await mountLoaded(`providers="google,apple,ics"`);
      trigger(el)!.click();
      const [google, apple, ics] = options(el);

      google.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      expect(shadow(el).activeElement).toBe(apple);

      google.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
      expect(shadow(el).activeElement).toBe(ics);
    });

    it("stops listening on the document once disconnected", async () => {
      const el = await mountLoaded();
      trigger(el)!.click();
      el.remove();
      // Would throw or re-render if the handlers were still bound to a
      // disconnected element.
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(shadow(el).querySelector(".atc-menu")).not.toBeNull();
    });
  });

  describe("provider handoff", () => {
    async function choose(el: HTMLElement, provider: string): Promise<void> {
      trigger(el)!.click();
      options(el).find((o) => o.dataset.provider === provider)!.click();
    }

    it("opens Google in a new tab with the UTC instant pair", async () => {
      const el = await mountLoaded();
      await choose(el, "google");

      expect(openSpy).toHaveBeenCalledTimes(1);
      const url = new URL(openSpy.mock.calls[0][0] as string);
      expect(url.host).toBe("calendar.google.com");
      // 10:00 CDT (UTC-5) → 15:00Z. A browser-local reading would differ.
      expect(url.searchParams.get("dates")).toBe(
        "20260405T150000Z/20260405T163000Z",
      );
      expect(openSpy.mock.calls[0][2]).toContain("noopener");
    });

    it("flattens the description HTML for the provider", async () => {
      const el = await mountLoaded();
      await choose(el, "google");
      const url = new URL(openSpy.mock.calls[0][0] as string);
      expect(url.searchParams.get("details")).toBe("Easter celebration");
    });

    it("sends the composed location string", async () => {
      const el = await mountLoaded();
      await choose(el, "google");
      const url = new URL(openSpy.mock.calls[0][0] as string);
      expect(url.searchParams.get("location")).toBe(
        "Main Auditorium, 123 Church St, Springfield, IL, 62701",
      );
    });

    it("routes outlook and office365 to their own hosts", async () => {
      const el = await mountLoaded(`providers="outlook,office365"`);
      await choose(el, "outlook");
      await choose(el, "office365");
      expect(new URL(openSpy.mock.calls[0][0] as string).host).toBe("outlook.live.com");
      expect(new URL(openSpy.mock.calls[1][0] as string).host).toBe("outlook.office.com");
    });

    it("downloads a file for apple and ics instead of opening a tab", async () => {
      const el = await mountLoaded();
      await choose(el, "apple");
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(openSpy).not.toHaveBeenCalled();

      await choose(el, "ics");
      expect(clickSpy).toHaveBeenCalledTimes(2);
    });

    it("emits calendarProviderSelected and closes the menu", async () => {
      const el = await mountLoaded();
      const seen: unknown[] = [];
      el.addEventListener("calendarProviderSelected", (e) =>
        seen.push((e as CustomEvent).detail),
      );

      await choose(el, "google");
      expect(seen).toEqual([{ provider: "google", eventId: 42 }]);
      expect(shadow(el).querySelector(".atc-menu")).toBeNull();
    });

    it("reports an unbuildable entry as an error rather than a blank tab", async () => {
      mockFetch(() => jsonResponse({ ...eventPayload, Event_Start_Date: "" }));
      const el = await mountLoaded();
      const errors: unknown[] = [];
      el.addEventListener("addToCalendarError", (e) =>
        errors.push((e as CustomEvent).detail),
      );

      await choose(el, "google");
      expect(openSpy).not.toHaveBeenCalled();
      expect(errors).toHaveLength(1);
      expect(shadow(el).querySelector(".nw-atc-error")).not.toBeNull();
    });
  });

  describe("timezone resolution", () => {
    it("uses the domain zone the API reported", async () => {
      mockFetch(() => jsonResponse({ ...eventPayload, Time_Zone: "America/New_York" }));
      const el = await mountLoaded();
      trigger(el)!.click();
      options(el)[0].click();

      // 10:00 EDT (UTC-4) → 14:00Z.
      expect(
        new URL(openSpy.mock.calls[0][0] as string).searchParams.get("dates"),
      ).toBe("20260405T140000Z/20260405T153000Z");
    });

    it("lets the time-zone attribute override the API", async () => {
      const el = await mountLoaded(`time-zone="UTC"`);
      trigger(el)!.click();
      options(el)[0].click();
      expect(
        new URL(openSpy.mock.calls[0][0] as string).searchParams.get("dates"),
      ).toBe("20260405T100000Z/20260405T113000Z");
    });

    it("falls back to the visitor's zone when the API omits one", async () => {
      mockFetch(() => jsonResponse({ ...eventPayload, Time_Zone: null }));
      const el = await mountLoaded();
      trigger(el)!.click();
      options(el)[0].click();

      // Whatever the test runner's zone is, the widget must still produce a
      // valid instant pair rather than NaN.
      expect(
        new URL(openSpy.mock.calls[0][0] as string).searchParams.get("dates"),
      ).toMatch(/^\d{8}T\d{6}Z\/\d{8}T\d{6}Z$/);
    });
  });

  describe("the summary line", () => {
    it("prints the MP wall clock, not a browser-local reinterpretation", async () => {
      const el = await mountLoaded();
      const meta = shadow(el).querySelector(".atc-summary-meta")!.textContent!;
      expect(meta).toContain("Sun, Apr 5, 2026");
      expect(meta).toContain("10:00 AM");
      expect(meta).toContain("11:30 AM");
    });

    it("spells out both dates for a multi-day event", async () => {
      mockFetch(() =>
        jsonResponse({
          ...eventPayload,
          Event_End_Date: "2026-04-07T16:00:00",
        }),
      );
      const el = await mountLoaded();
      const meta = shadow(el).querySelector(".atc-summary-meta")!.textContent!;
      expect(meta).toContain("Sun, Apr 5, 2026");
      expect(meta).toContain("Tue, Apr 7, 2026");
    });

    it("shows title and location", async () => {
      const el = await mountLoaded();
      expect(shadow(el).querySelector(".atc-summary-title")!.textContent).toBe(
        "Easter Service",
      );
      expect(shadow(el).querySelector(".atc-summary-location")!.textContent).toContain(
        "Main Auditorium",
      );
    });

    it("omits the location line when the event has no location", async () => {
      mockFetch(() =>
        jsonResponse({
          ...eventPayload,
          Location_Name: null,
          Address_Line_1: null,
          City: null,
          State: null,
          Postal_Code: null,
        }),
      );
      const el = await mountLoaded();
      expect(shadow(el).querySelector(".atc-summary-location")).toBeNull();
    });
  });

  it("loads no CDN script — the whole point of dropping add-to-calendar-button", async () => {
    await mountLoaded();
    expect(document.querySelector('script[src*="add-to-calendar"]')).toBeNull();
    expect(document.querySelector("add-to-calendar-button")).toBeNull();
  });
});
