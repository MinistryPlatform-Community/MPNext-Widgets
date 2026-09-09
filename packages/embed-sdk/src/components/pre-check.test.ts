/**
 * Tests for `<next-pre-check>` (packages/embed-sdk/src/components/pre-check.ts)
 *
 * Four of these are the load-bearing ones, and none is about markup:
 *
 *   - **401 paints the sign-in panel, not "Unable to Load"** — and it renders
 *     `[data-action="login"]` in `dual` and *no button at all* in `legacy`,
 *     where `AuthSession.login()` is not the live path. `[data-action="retry"]`
 *     must never appear in that state: it re-issues the same anonymous request
 *     and fails identically, which is a loop with no exit (C81/`CROSS-1`).
 *     Legacy rendered a dead "You need to log in" with no control whatsoever.
 *   - **`initLocale()` resolves before the first `render()`** — otherwise a
 *     Spanish visitor watches English swap to Spanish.
 *   - **`attributeChangedCallback` reloads on the first set** (`oldValue ===
 *     null`), which is the C39 regression several widgets in this repo already
 *     have.
 *   - **an empty day is the empty state, not the error state.** A Tuesday has
 *     no Sunday classes; painting that as a failure trains churches to ignore
 *     the error state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAuthSession } from "../shared/auth-session";
import { __resetLocaleSession } from "../i18n";
import "./pre-check";

const HOST = "https://widgets.example.com";
const PAGE = "/pre-check";

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

const ROW = {
  rowKey: "9|4|2|0|2|17",
  contactId: 9,
  participantName: "Check-me-in, Daddy",
  participantId: 4,
  eventId: 2,
  eventName: "Sample Check-in1",
  eventStart: "2018-06-12T17:00:00",
  groupId: 2,
  groupName: "Babies (Sample)",
  groupParticipantId: 17,
  roleName: "Group Leader",
  eventParticipantId: null,
  participationStatusId: null,
  isRegistered: false,
  isLocked: false,
};

const OK_BODY = {
  eventDate: "2018-06-12",
  timeZone: "America/New_York",
  householdId: 5,
  members: [{ contactId: 9, participantName: "Check-me-in, Daddy", rows: [ROW] }],
};

/** Routes config + session mint, and hands `/api/embed/pre-check` to `handler`. */
function mockFetch(
  handler: (url: string, init?: RequestInit) => Response,
  mode: "legacy" | "dual" | "hardened" = "legacy",
) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/embed/auth/config")) return jsonResponse({ mode });
    if (url.includes("/api/embed/session")) return jsonResponse({ token: makeJwt() });
    if (url.includes("/api/embed/pre-check")) return handler(url, init);
    return jsonResponse({ error: "not_found" }, 404);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function preCheckCalls(fn: ReturnType<typeof mockFetch>): string[] {
  return fn.mock.calls
    .map(([input]) => String(input))
    .filter((u) => u.includes("/api/embed/pre-check"));
}

function mount(attrs = ""): HTMLElement {
  document.body.innerHTML = `<next-pre-check api-host="${HOST}" ${attrs}></next-pre-check>`;
  return document.body.firstElementChild as HTMLElement;
}

const shadow = (el: HTMLElement) => el.shadowRoot!;
const text = (el: HTMLElement) => shadow(el).textContent ?? "";
const loginBtn = (el: HTMLElement) =>
  shadow(el).querySelector<HTMLButtonElement>('[data-action="login"]');
const retryBtn = (el: HTMLElement) =>
  shadow(el).querySelector<HTMLButtonElement>('[data-action="retry"]');

/**
 * Mount and wait for the loading state to be replaced by something terminal.
 *
 * Waits for `.pc-head` to *exist* as well as for `.pc-working` to be gone. The
 * shadow root is also empty before the first paint, so waiting only on the
 * spinner's absence returns immediately and leaves the widget's GET in flight
 * into the next test — which is exactly the trap `unsubscribe.test.ts`
 * documents.
 */
async function mountSettled(attrs = ""): Promise<HTMLElement> {
  const el = mount(attrs);
  await vi.waitFor(() => {
    expect(shadow(el).querySelector(".pc-head")).not.toBeNull();
    expect(shadow(el).querySelector(".pc-working")).toBeNull();
  });
  return el;
}

describe("<next-pre-check>", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete (window as unknown as { __nextAuthSession?: unknown }).__nextAuthSession;
    __resetLocaleSession();
    document.documentElement.removeAttribute("lang");
    window.history.replaceState(null, "", PAGE);
    window.__nextTokenProvider = {
      get: () => getAuthSession(HOST).getToken("pre-check"),
      refresh: () => getAuthSession(HOST).refreshToken("pre-check"),
    };
    window.__nextSDKReady = Promise.resolve();
    mockFetch(() => jsonResponse(OK_BODY));
  });

  afterEach(() => {
    document.body.innerHTML = "";
    window.history.replaceState(null, "", PAGE);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // ── Localisation ─────────────────────────────────────────────────────────

  describe("localisation", () => {
    it("resolves the catalogue before the first render", async () => {
      const order: string[] = [];
      const proto = Object.getPrototypeOf(
        document.createElement("next-pre-check"),
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
      expect(order.indexOf("initLocale")).toBeLessThan(order.indexOf("render"));
      renderSpy.mockRestore();
      initSpy.mockRestore();
    });

    it("renders the Spanish title on a Spanish page", async () => {
      document.documentElement.setAttribute("lang", "es");
      const el = await mountSettled();
      expect(shadow(el).querySelector(".pc-title")?.textContent).toBe(
        "Registro anticipado",
      );
    });

    it("renders the Portuguese title on a pt-BR page", async () => {
      document.documentElement.setAttribute("lang", "pt-BR");
      const el = await mountSettled();
      expect(shadow(el).querySelector(".pc-title")?.textContent).toBe("Pré-check-in");
    });
  });

  // ── Lifecycle ────────────────────────────────────────────────────────────

  describe("lifecycle", () => {
    it("calls super.disconnectedCallback(), so the locale listener is released", () => {
      // The base class unsubscribes the locale listener and disconnects the
      // `lang` MutationObserver there; six components define their own
      // `disconnectedCallback` and each must call super.
      const el = mount();
      const proto = Object.getPrototypeOf(Object.getPrototypeOf(el)) as {
        disconnectedCallback: () => void;
      };
      const superSpy = vi.spyOn(proto, "disconnectedCallback");

      el.remove();

      expect(superSpy).toHaveBeenCalled();
      superSpy.mockRestore();
    });

    it("does not paint after disconnect", async () => {
      let release: ((r: Response) => void) | null = null;
      mockFetch(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }) as unknown as Response,
      );

      const el = mount();
      await vi.waitFor(() => expect(release).not.toBeNull());
      el.remove();
      release!(jsonResponse(OK_BODY));

      await Promise.resolve();
      // Nothing should have replaced the pre-disconnect markup.
      expect(shadow(el).querySelector(".pc-members")).toBeNull();
    });
  });

  // ── C39: attributeChangedCallback ────────────────────────────────────────

  describe("attribute plumbing (C39)", () => {
    it("reloads when event-date is set on a mounted widget with oldValue === null", async () => {
      const fn = mockFetch(() => jsonResponse(OK_BODY));
      const el = await mountSettled();
      const before = preCheckCalls(fn).length;

      // The C39 shape exactly: the attribute was absent, so `oldValue` is
      // `null`. A guard of `oldValue !== null` — which several widgets in this
      // repo have — would swallow this.
      el.setAttribute("event-date", "2025-05-18");

      await vi.waitFor(() =>
        expect(preCheckCalls(fn).length).toBeGreaterThan(before),
      );
      expect(preCheckCalls(fn).at(-1)).toContain("eventDate=2025-05-18");
    });

    it("reloads when event-date changes from one value to another", async () => {
      const fn = mockFetch(() => jsonResponse(OK_BODY));
      const el = await mountSettled('event-date="2018-06-12"');
      const before = preCheckCalls(fn).length;

      el.setAttribute("event-date", "2025-05-18");

      await vi.waitFor(() =>
        expect(preCheckCalls(fn).length).toBeGreaterThan(before),
      );
      expect(preCheckCalls(fn).at(-1)).toContain("eventDate=2025-05-18");
    });

    it("does not reload when the attribute is set to the value it already has", async () => {
      const fn = mockFetch(() => jsonResponse(OK_BODY));
      const el = await mountSettled('event-date="2018-06-12"');
      const before = preCheckCalls(fn).length;

      el.setAttribute("event-date", "2018-06-12");
      await Promise.resolve();

      expect(preCheckCalls(fn).length).toBe(before);
    });
  });

  // ── The date input to the route ──────────────────────────────────────────

  describe("date resolution", () => {
    it("sends no eventDate when no attribute is set, letting the server decide", async () => {
      // The server resolves today in the *domain's* zone. Legacy used
      // `new Date().toISOString()` in the browser, so a visitor west of UTC in
      // the evening asked for tomorrow.
      const fn = mockFetch(() => jsonResponse(OK_BODY));
      await mountSettled();
      expect(preCheckCalls(fn)[0]).not.toContain("eventDate");
    });

    it("sends the event-date attribute when it is a wall-clock date", async () => {
      const fn = mockFetch(() => jsonResponse(OK_BODY));
      await mountSettled('event-date="2018-06-12"');
      expect(preCheckCalls(fn)[0]).toContain("eventDate=2018-06-12");
    });

    it("ignores a malformed event-date rather than erroring", async () => {
      const fn = mockFetch(() => jsonResponse(OK_BODY));
      for (const bad of ["2018-6-12", "12/06/2018", "2018-06-12T00:00:00Z", "today"]) {
        document.body.innerHTML = "";
        const el = mount(`event-date="${bad}"`);
        await vi.waitFor(() => expect(shadow(el).querySelector(".pc-working")).toBeNull());
      }
      // A bad *attribute* should degrade to "today", not to an error panel.
      for (const url of preCheckCalls(fn)) {
        expect(url).not.toContain("eventDate");
      }
    });

    it("ignores the host page's ?eventDate= by default", async () => {
      window.history.replaceState(null, "", `${PAGE}?eventDate=2018-06-12`);
      const fn = mockFetch(() => jsonResponse(OK_BODY));
      await mountSettled();
      // Silently obeying an arbitrary URL parameter is a surprise on a shared
      // CMS page, where `?eventDate=` may belong to something else.
      expect(preCheckCalls(fn)[0]).not.toContain("eventDate");
    });

    it("honours ?eventDate= when read-query-string opts in", async () => {
      window.history.replaceState(null, "", `${PAGE}?eventDate=2018-06-12`);
      const fn = mockFetch(() => jsonResponse(OK_BODY));
      await mountSettled('read-query-string="true"');
      expect(preCheckCalls(fn)[0]).toContain("eventDate=2018-06-12");
    });

    it("prefers the attribute over the query string", async () => {
      window.history.replaceState(null, "", `${PAGE}?eventDate=2025-05-18`);
      const fn = mockFetch(() => jsonResponse(OK_BODY));
      await mountSettled('read-query-string="true" event-date="2018-06-12"');
      expect(preCheckCalls(fn)[0]).toContain("eventDate=2018-06-12");
    });
  });

  // ── Signed out (C81 / CROSS-1) ───────────────────────────────────────────

  describe("signed out", () => {
    it("paints the sign-in panel on a 401, never Unable to Load", async () => {
      mockFetch(
        () => jsonResponse({ error: "auth_required", message: "Authentication required." }, 401),
        "dual",
      );
      const el = await mountSettled();

      expect(text(el)).toContain("Sign in to check your family in.");
      expect(text(el)).not.toContain("Unable to Load");
    });

    it("renders a Sign In button in dual mode", async () => {
      mockFetch(() => jsonResponse({ error: "auth_required", message: "x" }, 401), "dual");
      const el = await mountSettled();
      await vi.waitFor(() => expect(loginBtn(el)).not.toBeNull());
      expect(loginBtn(el)!.textContent).toBe("Sign In");
    });

    it("renders NO button in legacy mode, and names the page's own sign-in link", async () => {
      // `AuthSession.login()` is not the live path in `legacy` — the host page
      // signs in through `<mpp-user-login>` / `next-user-menu`. A button here
      // would silently do nothing on every customer we have today.
      mockFetch(() => jsonResponse({ error: "auth_required", message: "x" }, 401), "legacy");
      const el = await mountSettled();

      expect(loginBtn(el)).toBeNull();
      expect(text(el)).toContain("sign-in link on this page");
    });

    it("never renders Try Again in the signed-out state", async () => {
      for (const mode of ["legacy", "dual", "hardened"] as const) {
        document.body.innerHTML = "";
        delete (window as unknown as { __nextAuthSession?: unknown }).__nextAuthSession;
        mockFetch(() => jsonResponse({ error: "auth_required", message: "x" }, 401), mode);
        const el = await mountSettled();
        // Re-issuing the same anonymous request fails identically: a loop with
        // no exit, which is exactly what C81 filed.
        expect(retryBtn(el), mode).toBeNull();
      }
    });

    it("emits loginRequired when the Sign In button is pressed", async () => {
      mockFetch(() => jsonResponse({ error: "auth_required", message: "x" }, 401), "dual");
      const el = await mountSettled();
      await vi.waitFor(() => expect(loginBtn(el)).not.toBeNull());

      const seen: unknown[] = [];
      el.addEventListener("loginRequired", (e) => seen.push((e as CustomEvent).detail));
      loginBtn(el)!.click();

      expect(seen).toEqual([{ wid: "pre-check" }]);
    });
  });

  // ── States ───────────────────────────────────────────────────────────────

  describe("states", () => {
    it("renders one section per member with a row per event", async () => {
      const el = await mountSettled('event-date="2018-06-12"');

      expect(shadow(el).querySelectorAll(".pc-member")).toHaveLength(1);
      expect(shadow(el).querySelector(".pc-member-name")?.textContent).toBe(
        "Check-me-in, Daddy",
      );
      expect(shadow(el).querySelectorAll(".pc-row")).toHaveLength(1);
      expect(text(el)).toContain("Sample Check-in1");
      expect(text(el)).toContain("Babies (Sample)");
      expect(text(el)).toContain("Group Leader");
    });

    it("puts the server's rowKey in the checkbox value", async () => {
      const el = await mountSettled('event-date="2018-06-12"');
      const box = shadow(el).querySelector<HTMLInputElement>('input[type="checkbox"]');
      expect(box!.value).toBe("9|4|2|0|2|17");
    });

    it("formats the time as wall clock, with no zone shift", async () => {
      // `eventStart` is already in the congregation's zone and carries no zone
      // marker. `fmt.time` parses the calendar parts into a local `Date` and
      // formats with no `timeZone`, so 17:00 stays 5 PM whatever the runner's
      // zone is. Applying the response's `timeZone` here would shift it.
      const el = await mountSettled('event-date="2018-06-12"');
      expect(shadow(el).querySelector(".pc-when")?.textContent).toBe("5:00 PM");
    });

    it("renders a locked row checked, disabled and badged", async () => {
      mockFetch(() =>
        jsonResponse({
          ...OK_BODY,
          members: [
            {
              contactId: 9,
              participantName: "Check-me-in, Daddy",
              rows: [
                {
                  ...ROW,
                  eventParticipantId: 900,
                  participationStatusId: 3,
                  isRegistered: false,
                  isLocked: true,
                },
              ],
            },
          ],
        }),
      );
      const el = await mountSettled('event-date="2018-06-12"');
      const box = shadow(el).querySelector<HTMLInputElement>('input[type="checkbox"]');

      expect(box!.checked).toBe(true);
      expect(box!.disabled).toBe(true);
      expect(text(el)).toContain("Already checked in");
    });

    it("renders the empty state, not the error state, for a day with no events", async () => {
      mockFetch(() => jsonResponse({ ...OK_BODY, eventDate: "2025-05-20", members: [] }));
      const el = await mountSettled('event-date="2025-05-20"');

      expect(text(el)).toContain("There are no check-in events on");
      expect(text(el)).not.toContain("Unable to Load");
      expect(retryBtn(el)).toBeNull();
    });

    it("renders the household message when the account has no household", async () => {
      mockFetch(() =>
        jsonResponse({ error: "household_not_found", message: "no household" }, 404),
      );
      const el = await mountSettled();
      expect(text(el)).toContain("We could not find your household.");
    });

    it("renders the catalogue sentence and a retry for a 500", async () => {
      mockFetch(() => jsonResponse({ error: "internal_error", message: "MP exploded" }, 500));
      const el = await mountSettled();

      expect(text(el)).toContain("Unable to Load");
      expect(retryBtn(el)).not.toBeNull();
      // The server's English `message` is logged, never rendered.
      expect(text(el)).not.toContain("MP exploded");
    });

    it("renders the catalogue sentence for precheck_unavailable", async () => {
      mockFetch(() =>
        jsonResponse(
          { error: "precheck_unavailable", message: "proc is not installed" },
          503,
        ),
      );
      const el = await mountSettled();

      expect(text(el)).toContain("Check-in is not set up for this site yet.");
      expect(text(el)).not.toContain("proc is not installed");
    });
  });

  // ── The date picker ──────────────────────────────────────────────────────

  describe("allow-date-picker", () => {
    it("renders no date input by default", async () => {
      const el = await mountSettled('event-date="2018-06-12"');
      expect(shadow(el).querySelector("#pc-date")).toBeNull();
    });

    it("renders a date input, seeded with the active date, when opted in", async () => {
      const el = await mountSettled('event-date="2018-06-12" allow-date-picker="true"');
      const input = shadow(el).querySelector<HTMLInputElement>("#pc-date");
      expect(input).not.toBeNull();
      expect(input!.value).toBe("2018-06-12");
    });

    it("reloads for the chosen day", async () => {
      const fn = mockFetch(() => jsonResponse(OK_BODY));
      const el = await mountSettled('event-date="2018-06-12" allow-date-picker="true"');
      const before = preCheckCalls(fn).length;

      const input = shadow(el).querySelector<HTMLInputElement>("#pc-date")!;
      input.value = "2025-05-18";
      input.dispatchEvent(new Event("change"));

      await vi.waitFor(() => expect(preCheckCalls(fn).length).toBeGreaterThan(before));
      expect(preCheckCalls(fn).at(-1)).toContain("eventDate=2025-05-18");
    });
  });

  // ── Events ───────────────────────────────────────────────────────────────

  describe("events", () => {
    it("emits preCheckLoaded with counts and the domain zone", async () => {
      const seen: Record<string, unknown>[] = [];
      document.body.innerHTML = "";
      const el = mount('event-date="2018-06-12"');
      el.addEventListener("preCheckLoaded", (e) =>
        seen.push((e as CustomEvent).detail as Record<string, unknown>),
      );

      await vi.waitFor(() => expect(seen).toHaveLength(1));
      expect(seen[0]).toEqual({
        eventDate: "2018-06-12",
        timeZone: "America/New_York",
        memberCount: 1,
        rowCount: 1,
      });
    });

    it("emits preCheckError with the machine code", async () => {
      mockFetch(() => jsonResponse({ error: "internal_error", message: "x" }, 500));
      const seen: Record<string, unknown>[] = [];
      document.body.innerHTML = "";
      const el = mount();
      el.addEventListener("preCheckError", (e) =>
        seen.push((e as CustomEvent).detail as Record<string, unknown>),
      );

      await vi.waitFor(() => expect(seen).toHaveLength(1));
      expect(seen[0]).toEqual({ code: "internal_error", status: 500 });
    });
  });
});

/**
 * The write half of `<next-pre-check>`.
 *
 * The one that matters is **"the POST body contains no ids"**. Legacy encoded a
 * six-part composite into each checkbox `name` and posted it back for its
 * server to `int.Parse` unchecked; the whole redesign rests on the body being
 * a date plus opaque row keys the server itself issued. A future "let's just
 * send the contactId, it's right there" would be caught here.
 */
describe("<next-pre-check> saving", () => {
  /** Bodies posted to `/api/embed/pre-check`. */
  function postedBodies(fn: ReturnType<typeof mockFetch>): Record<string, unknown>[] {
    return fn.mock.calls
      .filter(
        ([input, init]) =>
          String(input).includes("/api/embed/pre-check") &&
          (init as RequestInit | undefined)?.method === "POST",
      )
      .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
  }

  /** GET the list, POST through `onSave`. */
  function mockSave(
    onSave: (body: Record<string, unknown>) => Response,
    listBody: unknown = OK_BODY,
  ) {
    return mockFetch((url, init) => {
      if ((init as RequestInit | undefined)?.method === "POST") {
        const body = JSON.parse(String((init as RequestInit).body));
        return onSave(body as Record<string, unknown>);
      }
      return jsonResponse(listBody);
    });
  }

  const saveBtn = (el: HTMLElement) =>
    el.shadowRoot!.querySelector<HTMLButtonElement>('[data-action="save"]');

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete (window as unknown as { __nextAuthSession?: unknown }).__nextAuthSession;
    __resetLocaleSession();
    document.documentElement.removeAttribute("lang");
    window.history.replaceState(null, "", PAGE);
    window.__nextTokenProvider = {
      get: () => getAuthSession(HOST).getToken("pre-check"),
      refresh: () => getAuthSession(HOST).refreshToken("pre-check"),
    };
    window.__nextSDKReady = Promise.resolve();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    window.history.replaceState(null, "", PAGE);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders a submit control on the list", async () => {
    mockSave(() => jsonResponse({ registered: 1, cancelled: 0, locked: [] }));
    const el = await mountSettled('event-date="2018-06-12"');
    expect(saveBtn(el)).not.toBeNull();
  });

  it("posts ONLY { eventDate, selected } — no ids of any kind", async () => {
    const fn = mockSave(() => jsonResponse({ registered: 1, cancelled: 0, locked: [] }));
    const el = await mountSettled('event-date="2018-06-12"');

    el.shadowRoot!.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked = true;
    saveBtn(el)!.click();

    await vi.waitFor(() => expect(postedBodies(fn)).toHaveLength(1));
    const body = postedBodies(fn)[0]!;

    expect(Object.keys(body).sort()).toEqual(["eventDate", "selected"]);
    expect(body.eventDate).toBe("2018-06-12");
    expect(body.selected).toEqual(["9|4|2|0|2|17"]);
    // The four legacy accepted and wrote blind.
    expect(body).not.toHaveProperty("contactId");
    expect(body).not.toHaveProperty("participantId");
    expect(body).not.toHaveProperty("eventId");
    expect(body).not.toHaveProperty("eventParticipantId");
    expect(body).not.toHaveProperty("householdId");
  });

  it("sends the server's rowKey verbatim, not a reconstructed one", async () => {
    const fn = mockSave(() => jsonResponse({ registered: 1, cancelled: 0, locked: [] }));
    const el = await mountSettled('event-date="2018-06-12"');

    el.shadowRoot!.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked = true;
    saveBtn(el)!.click();

    await vi.waitFor(() => expect(postedBodies(fn)).toHaveLength(1));
    expect(postedBodies(fn)[0]!.selected).toEqual([ROW.rowKey]);
  });

  it("omits an unticked row — absence is how a cancellation is expressed", async () => {
    const fn = mockSave(() => jsonResponse({ registered: 0, cancelled: 1, locked: [] }));
    const el = await mountSettled('event-date="2018-06-12"');

    el.shadowRoot!.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked = false;
    saveBtn(el)!.click();

    await vi.waitFor(() => expect(postedBodies(fn)).toHaveLength(1));
    expect(postedBodies(fn)[0]!.selected).toEqual([]);
  });

  it("never sends a locked row, in either direction", async () => {
    // The server refuses to write it anyway; including it would make the body
    // claim something the widget did not offer the visitor.
    const fn = mockSave(
      () => jsonResponse({ registered: 0, cancelled: 0, locked: [ROW.rowKey] }),
      {
        ...OK_BODY,
        members: [
          {
            contactId: 9,
            participantName: "Check-me-in, Daddy",
            rows: [
              { ...ROW, eventParticipantId: 800, participationStatusId: 3, isLocked: true },
            ],
          },
        ],
      },
    );
    const el = await mountSettled('event-date="2018-06-12"');

    saveBtn(el)!.click();

    await vi.waitFor(() => expect(postedBodies(fn)).toHaveLength(1));
    expect(postedBodies(fn)[0]!.selected).toEqual([]);
  });

  it("disables the control and says Saving… while in flight", async () => {
    let release: ((r: Response) => void) | null = null;
    mockSave(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }) as unknown as Response,
    );
    const el = await mountSettled('event-date="2018-06-12"');

    saveBtn(el)!.click();

    await vi.waitFor(() => expect(saveBtn(el)!.disabled).toBe(true));
    expect(saveBtn(el)!.textContent).toBe("Saving…");

    // The control disables synchronously, before the request leaves — so the
    // POST may still be behind the token provider's own await when the
    // assertion above passes. Wait for the handler before releasing it, or the
    // pending fetch leaks into the next test.
    await vi.waitFor(() => expect(release).not.toBeNull());
    release!(jsonResponse({ registered: 1, cancelled: 0, locked: [] }));
  });

  it("reports the saved count and reloads from the server", async () => {
    const fn = mockSave(() => jsonResponse({ registered: 2, cancelled: 0, locked: [] }));
    const el = await mountSettled('event-date="2018-06-12"');
    const getsBefore = preCheckCalls(fn).length;

    saveBtn(el)!.click();

    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector(".pc-notice--ok")).not.toBeNull(),
    );
    expect(el.shadowRoot!.textContent).toContain("2 people are checked in for");
    // Never leave the old checkbox state on screen — the server is the truth.
    expect(preCheckCalls(fn).length).toBeGreaterThan(getsBefore + 1);
  });

  it("uses the singular branch for one person", async () => {
    mockSave(() => jsonResponse({ registered: 1, cancelled: 0, locked: [] }));
    const el = await mountSettled('event-date="2018-06-12"');

    saveBtn(el)!.click();

    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector(".pc-notice--ok")).not.toBeNull(),
    );
    expect(el.shadowRoot!.textContent).toContain("1 person is checked in for");
  });

  it("says so when the save checked nobody in", async () => {
    mockSave(() => jsonResponse({ registered: 0, cancelled: 0, locked: [] }));
    const el = await mountSettled('event-date="2018-06-12"');

    saveBtn(el)!.click();

    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector(".pc-notice--ok")).not.toBeNull(),
    );
    expect(el.shadowRoot!.textContent).toContain("Nobody is checked in for");
  });

  it("adds the cancellation note when something was cancelled", async () => {
    mockSave(() => jsonResponse({ registered: 1, cancelled: 2, locked: [] }));
    const el = await mountSettled('event-date="2018-06-12"');

    saveBtn(el)!.click();

    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector(".pc-notice--ok")).not.toBeNull(),
    );
    expect(el.shadowRoot!.textContent).toContain("Anyone you unchecked has been removed.");
  });

  it("renders the stale-selection message and reloads on a 403", async () => {
    const fn = mockSave(() =>
      jsonResponse(
        { error: "invalid_pre_check_selection", message: "unrecognised rows" },
        403,
      ),
    );
    const el = await mountSettled('event-date="2018-06-12"');
    const getsBefore = preCheckCalls(fn).length;

    saveBtn(el)!.click();

    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector(".pc-notice--warn")).not.toBeNull(),
    );
    expect(el.shadowRoot!.textContent).toContain("This page is out of date.");
    // The server's English message is logged, never rendered.
    expect(el.shadowRoot!.textContent).not.toContain("unrecognised rows");
    // And the list is refreshed behind it.
    await vi.waitFor(() =>
      expect(preCheckCalls(fn).length).toBeGreaterThan(getsBefore + 1),
    );
  });

  it("paints the sign-in panel when the save 401s", async () => {
    mockSave(() => jsonResponse({ error: "auth_required", message: "x" }, 401));
    const el = await mountSettled('event-date="2018-06-12"');

    saveBtn(el)!.click();

    await vi.waitFor(() =>
      expect(el.shadowRoot!.textContent).toContain("sign-in link on this page"),
    );
    expect(el.shadowRoot!.querySelector('[data-action="retry"]')).toBeNull();
  });

  it("renders the error state with the catalogue sentence on a 500", async () => {
    mockSave(() => jsonResponse({ error: "save_failed", message: "MP exploded" }, 500));
    const el = await mountSettled('event-date="2018-06-12"');

    saveBtn(el)!.click();

    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector('[data-action="retry"]')).not.toBeNull(),
    );
    expect(el.shadowRoot!.textContent).toContain(
      "We could not save your changes. Please try again.",
    );
    expect(el.shadowRoot!.textContent).not.toContain("MP exploded");
  });

  it("renders the catalogue sentence for pre_check_closed", async () => {
    mockSave(() => jsonResponse({ error: "pre_check_closed", message: "out of window" }, 409));
    const el = await mountSettled('event-date="2018-06-12"');

    saveBtn(el)!.click();

    await vi.waitFor(() =>
      expect(el.shadowRoot!.textContent).toContain("Check-in is not open for that date."),
    );
  });

  it("emits preCheckSaved with the counts", async () => {
    mockSave(() => jsonResponse({ registered: 2, cancelled: 1, locked: ["9|4|2|800|2|17"] }));
    const el = await mountSettled('event-date="2018-06-12"');

    const seen: Record<string, unknown>[] = [];
    el.addEventListener("preCheckSaved", (e) =>
      seen.push((e as CustomEvent).detail as Record<string, unknown>),
    );

    saveBtn(el)!.click();

    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toEqual({
      eventDate: "2018-06-12",
      registered: 2,
      cancelled: 1,
      locked: ["9|4|2|800|2|17"],
    });
  });

  it("select all ticks every changeable row, leaving locked ones alone", async () => {
    const fn = mockSave(() => jsonResponse({ registered: 1, cancelled: 0, locked: [] }), {
      ...OK_BODY,
      members: [
        {
          contactId: 9,
          participantName: "Check-me-in, Daddy",
          rows: [
            ROW,
            {
              ...ROW,
              rowKey: "9|4|3|800|2|17",
              eventId: 3,
              eventParticipantId: 800,
              participationStatusId: 3,
              isLocked: true,
            },
          ],
        },
      ],
    });
    const el = await mountSettled('event-date="2018-06-12"');

    el.shadowRoot!.querySelector<HTMLButtonElement>('[data-action="select-all"]')!.click();
    saveBtn(el)!.click();

    await vi.waitFor(() => expect(postedBodies(fn)).toHaveLength(1));
    // The locked row is neither ticked nor sent.
    expect(postedBodies(fn)[0]!.selected).toEqual([ROW.rowKey]);
  });

  it("clear all unticks every changeable row", async () => {
    const fn = mockSave(() => jsonResponse({ registered: 0, cancelled: 1, locked: [] }), {
      ...OK_BODY,
      members: [
        {
          contactId: 9,
          participantName: "Check-me-in, Daddy",
          rows: [{ ...ROW, eventParticipantId: 500, participationStatusId: 2, isRegistered: true }],
        },
      ],
    });
    const el = await mountSettled('event-date="2018-06-12"');

    expect(
      el.shadowRoot!.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked,
    ).toBe(true);

    el.shadowRoot!.querySelector<HTMLButtonElement>('[data-action="clear-all"]')!.click();
    saveBtn(el)!.click();

    await vi.waitFor(() => expect(postedBodies(fn)).toHaveLength(1));
    expect(postedBodies(fn)[0]!.selected).toEqual([]);
  });

  it("does not post twice when the control is pressed twice", async () => {
    let release: ((r: Response) => void) | null = null;
    const fn = mockSave(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }) as unknown as Response,
    );
    const el = await mountSettled('event-date="2018-06-12"');

    saveBtn(el)!.click();
    await vi.waitFor(() => expect(release).not.toBeNull());
    saveBtn(el)!.click();

    expect(postedBodies(fn)).toHaveLength(1);
    release!(jsonResponse({ registered: 1, cancelled: 0, locked: [] }));
  });

  it("renders no submit control in the empty state", async () => {
    // Nothing to submit, so nothing that implies a write.
    mockSave(
      () => jsonResponse({ registered: 0, cancelled: 0, locked: [] }),
      { ...OK_BODY, members: [] },
    );
    const el = await mountSettled('event-date="2025-05-20"');
    expect(saveBtn(el)).toBeNull();
  });
});
