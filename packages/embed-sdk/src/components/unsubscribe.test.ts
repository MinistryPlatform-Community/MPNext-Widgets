/**
 * Tests for `<next-unsubscribe>` (packages/embed-sdk/src/components/unsubscribe.ts)
 *
 * Three of these are the load-bearing ones and none of them is about markup:
 *
 *   - `initLocale()` must resolve **before** the first `render()`. This widget
 *     paints one sentence and stops, so an English-then-Spanish swap would be
 *     the entire visible experience.
 *   - `bad-link` must reach the network **zero** times. That is what keeps "this
 *     link is broken" separable from "this GUID matched nothing", which the
 *     server answers identically to success on purpose.
 *   - the capability must leave the address bar immediately, or a
 *     never-expiring `Contact_GUID` survives in browser history, in whatever
 *     the host page's analytics reads from `location.search`, and in the
 *     `Referer` of any later same-page navigation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAuthSession } from "../shared/auth-session";
import { __resetLocaleSession } from "../i18n";
import "./unsubscribe";

const HOST = "https://widgets.example.com";
// Same-origin with jsdom's own document URL: `history.replaceState` refuses a
// cross-origin target, and the widget strips the capability with exactly that.
const PAGE = "/unsubscribe";
const CG = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

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

const OK_BODY = {
  success: true,
  scope: "publication" as const,
  publicationId: 4,
  email: "j•••@g•••.com",
  canUndo: true,
};

/** Routes the config + session mint, and hands unsubscribe POSTs to `handler`. */
function mockFetch(handler: (body: Record<string, unknown>) => Response) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/embed/auth/config")) return jsonResponse({ mode: "legacy" });
    if (url.includes("/api/embed/session")) return jsonResponse({ token: makeJwt() });
    if (url.includes("/api/embed/unsubscribe")) {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      return handler(body as Record<string, unknown>);
    }
    return jsonResponse({ error: "not_found" }, 404);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

/** POST bodies the widget sent to /api/embed/unsubscribe. */
function postedBodies(fn: ReturnType<typeof mockFetch>): Record<string, unknown>[] {
  return fn.mock.calls
    .filter(([input]) => String(input).includes("/api/embed/unsubscribe"))
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
}

function setLocation(search: string): void {
  window.history.replaceState(null, "", `${PAGE}${search}`);
}

function mount(attrs = ""): HTMLElement {
  document.body.innerHTML = `<next-unsubscribe api-host="${HOST}" ${attrs}></next-unsubscribe>`;
  return document.body.firstElementChild as HTMLElement;
}
const shadow = (el: HTMLElement) => el.shadowRoot!;
const text = (el: HTMLElement) => shadow(el).textContent ?? "";
const headline = (el: HTMLElement) => shadow(el).querySelector(".headline")?.textContent ?? "";
const undoBtn = (el: HTMLElement) => shadow(el).querySelector<HTMLButtonElement>('[data-action="undo"]');
const manageLink = (el: HTMLElement) => shadow(el).querySelector<HTMLAnchorElement>("a.manage");

/**
 * Mount and wait for a terminal state.
 *
 * Waits for `.headline`, which every terminal state renders, rather than for
 * `.working` to disappear — the shadow root is *also* empty before the first
 * paint, so waiting on its absence returns immediately and leaves the widget's
 * POST in flight into the next test.
 */
async function mountSettled(search: string, attrs = ""): Promise<HTMLElement> {
  setLocation(search);
  const el = mount(attrs);
  await vi.waitFor(() => expect(shadow(el).querySelector(".headline")).not.toBeNull());
  return el;
}

describe("<next-unsubscribe>", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete (window as unknown as { __nextAuthSession?: unknown }).__nextAuthSession;
    __resetLocaleSession();
    document.documentElement.removeAttribute("lang");
    window.__nextTokenProvider = {
      get: () => getAuthSession(HOST).getToken("unsubscribe"),
      refresh: () => getAuthSession(HOST).refreshToken("unsubscribe"),
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

  describe("localisation ordering", () => {
    it("resolves the catalogue before the first render", async () => {
      const order: string[] = [];
      const proto = Object.getPrototypeOf(
        document.createElement("next-unsubscribe"),
      ) as {
        render: () => void;
        initLocale: () => Promise<void>;
      };

      const renderSpy = vi.spyOn(proto, "render").mockImplementation(function (
        this: unknown,
      ) {
        order.push("render");
      });
      const initSpy = vi
        .spyOn(proto as unknown as { initLocale: () => Promise<void> }, "initLocale")
        .mockImplementation(async () => {
          order.push("initLocale");
        });

      setLocation(`?cg=${CG}&pubid=4`);
      mount();
      await vi.waitFor(() => expect(order).toContain("render"));

      // The first render must not precede the catalogue resolving.
      expect(order[0]).toBe("initLocale");
      expect(order.indexOf("initLocale")).toBeLessThan(order.indexOf("render"));
      renderSpy.mockRestore();
      initSpy.mockRestore();
    });

    it("renders the Spanish headline on a Spanish page", async () => {
      document.documentElement.setAttribute("lang", "es");
      const el = await mountSettled(`?cg=${CG}&pubid=4`);
      expect(headline(el)).toBe("Su suscripción ha sido cancelada.");
      expect(el.getAttribute("lang")).toBe("es");
    });

    it("renders the Brazilian Portuguese bulk headline", async () => {
      document.documentElement.setAttribute("lang", "pt-BR");
      mockFetch(() =>
        jsonResponse({ ...OK_BODY, scope: "bulk", publicationId: null }),
      );
      const el = await mountSettled(`?cg=${CG}`);
      expect(headline(el)).toBe(
        "Você foi excluído do nosso serviço de notificações por e-mail.",
      );
    });
  });

  describe("bad-link", () => {
    it("renders badLink with zero fetches when no capability is present", async () => {
      const fn = mockFetch(() => jsonResponse(OK_BODY));
      setLocation("");
      const el = mount();
      await vi.waitFor(() => expect(headline(el)).not.toBe(""));

      expect(headline(el)).toContain("This unsubscribe link is incomplete");
      expect(postedBodies(fn)).toEqual([]);
    });

    it("renders badLink with zero fetches for a malformed cg", async () => {
      const fn = mockFetch(() => jsonResponse(OK_BODY));
      setLocation("?cg=not-a-guid&pubid=4");
      const el = mount();
      await vi.waitFor(() => expect(headline(el)).not.toBe(""));

      expect(headline(el)).toContain("This unsubscribe link is incomplete");
      expect(postedBodies(fn)).toEqual([]);
    });

    it("refuses the nil GUID", async () => {
      const fn = mockFetch(() => jsonResponse(OK_BODY));
      setLocation("?cg=00000000-0000-0000-0000-000000000000");
      const el = mount();
      await vi.waitFor(() => expect(headline(el)).not.toBe(""));
      expect(postedBodies(fn)).toEqual([]);
    });

    it("offers the manage link, which is the useful escape hatch", async () => {
      setLocation("");
      const el = mount('my-subscriptions-url="https://church.example.org/prefs"');
      await vi.waitFor(() => expect(headline(el)).not.toBe(""));
      expect(manageLink(el)?.getAttribute("href")).toBe(
        "https://church.example.org/prefs",
      );
    });
  });

  describe("the POST", () => {
    it("carries cg, pubid and action", async () => {
      const fn = mockFetch(() => jsonResponse(OK_BODY));
      await mountSettled(`?cg=${CG}&pubid=4`);
      expect(postedBodies(fn)).toEqual([{ cg: CG, pubid: 4, action: "unsubscribe" }]);
    });

    it("omits pubid entirely on the bulk path", async () => {
      const fn = mockFetch(() =>
        jsonResponse({ ...OK_BODY, scope: "bulk", publicationId: null }),
      );
      await mountSettled(`?cg=${CG}`);
      expect(postedBodies(fn)).toEqual([{ cg: CG, action: "unsubscribe" }]);
    });

    it("treats pubid=0 as the bulk path", async () => {
      const fn = mockFetch(() =>
        jsonResponse({ ...OK_BODY, scope: "bulk", publicationId: null }),
      );
      await mountSettled(`?cg=${CG}&pubid=0`);
      expect(postedBodies(fn)).toEqual([{ cg: CG, action: "unsubscribe" }]);
    });

    it("honours cg-param and pubid-param overrides", async () => {
      const fn = mockFetch(() => jsonResponse(OK_BODY));
      await mountSettled(
        `?contact=${CG}&publication=4`,
        'cg-param="contact" pubid-param="publication"',
      );
      expect(postedBodies(fn)).toEqual([{ cg: CG, pubid: 4, action: "unsubscribe" }]);
    });

    it("sends a sealed t as `token`, and prefers it over a cg beside it", async () => {
      // The server decides precedence, but the widget must forward both so the
      // route can fall back to `cg` when the token has expired.
      const fn = mockFetch(() => jsonResponse(OK_BODY));
      await mountSettled(`?t=sealed.jwt.value&cg=${CG}&pubid=4`);
      expect(postedBodies(fn)).toEqual([
        { token: "sealed.jwt.value", pubid: 4, action: "unsubscribe" },
      ]);
    });

    it("honours token-param", async () => {
      const fn = mockFetch(() => jsonResponse(OK_BODY));
      await mountSettled("?ticket=sealed.jwt.value", 'token-param="ticket"');
      expect(postedBodies(fn)).toEqual([
        { token: "sealed.jwt.value", action: "unsubscribe" },
      ]);
    });

    it("renders link_expired from the catalogue when the server rejects the token", async () => {
      mockFetch(() =>
        jsonResponse(
          { error: "link_expired", message: "That unsubscribe link is no longer valid." },
          422,
        ),
      );
      const el = await mountSettled("?t=stale.jwt.value");
      expect(headline(el)).toBe(
        "That link is no longer valid. Please use the unsubscribe link in a recent email, or manage your preferences below.",
      );
    });

    it("ignores MP's dg parameter rather than treating the link as broken", async () => {
      const fn = mockFetch(() => jsonResponse(OK_BODY));
      const el = await mountSettled(
        `?dg=9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d&cg=${CG}&pubid=4`,
      );
      expect(postedBodies(fn)).toHaveLength(1);
      expect(headline(el)).toBe("You have been unsubscribed.");
    });
  });

  describe("stripping the capability from the address bar", () => {
    it("removes cg, pubid and t, and keeps everything else", async () => {
      await mountSettled(`?utm_source=news&cg=${CG}&pubid=4&t=abc`);
      const url = new URL(window.location.href);
      expect(url.searchParams.get("cg")).toBeNull();
      expect(url.searchParams.get("pubid")).toBeNull();
      expect(url.searchParams.get("t")).toBeNull();
      expect(url.searchParams.get("utm_source")).toBe("news");
      expect(window.location.href).not.toContain(CG);
    });

    it("strips before the first fetch resolves, not after", async () => {
      // A GUID that survives until the POST returns is a GUID an analytics
      // snippet reading location.search has already seen.
      let release!: (r: Response) => void;
      const pending = new Promise<Response>((resolve) => {
        release = resolve;
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url.includes("/api/embed/auth/config")) return jsonResponse({ mode: "legacy" });
          if (url.includes("/api/embed/session")) return jsonResponse({ token: makeJwt() });
          if (url.includes("/api/embed/unsubscribe")) return pending;
          return jsonResponse({ error: "not_found" }, 404);
        }),
      );

      setLocation(`?cg=${CG}&pubid=4`);
      mount();
      expect(window.location.href).not.toContain(CG);
      release(jsonResponse(OK_BODY));
    });

    it("keeps the capability in a private field so Undo still works", async () => {
      const fn = mockFetch(() => jsonResponse(OK_BODY));
      const el = await mountSettled(`?cg=${CG}&pubid=4`);
      undoBtn(el)!.click();
      await vi.waitFor(() => expect(postedBodies(fn)).toHaveLength(2));
      expect(postedBodies(fn)[1]).toEqual({ cg: CG, pubid: 4, action: "resubscribe" });
    });
  });

  describe("done and done-final", () => {
    it("shows the publication headline, the masked address and Undo", async () => {
      const el = await mountSettled(`?cg=${CG}&pubid=4`);
      expect(headline(el)).toBe("You have been unsubscribed.");
      expect(text(el)).toContain("j•••@g•••.com");
      expect(undoBtn(el)).not.toBeNull();
    });

    it("shows the bulk headline on the bulk path", async () => {
      mockFetch(() => jsonResponse({ ...OK_BODY, scope: "bulk", publicationId: null }));
      const el = await mountSettled(`?cg=${CG}`);
      expect(headline(el)).toBe("You have been removed from bulk email.");
    });

    it("renders no Undo when canUndo is false", async () => {
      // Covers "already opted out" and "unknown GUID" — indistinguishable by
      // design, so there is nothing here that could tell them apart.
      mockFetch(() => jsonResponse({ ...OK_BODY, canUndo: false, email: null }));
      const el = await mountSettled(`?cg=${CG}&pubid=4`);
      expect(headline(el)).toBe("You have been unsubscribed.");
      expect(undoBtn(el)).toBeNull();
    });

    it("drops the address line with show-email=false", async () => {
      const el = await mountSettled(`?cg=${CG}&pubid=4`, 'show-email="false"');
      expect(text(el)).not.toContain("j•••@g•••.com");
      expect(headline(el)).toBe("You have been unsubscribed.");
    });

    it("shows no address line when the server sent none", async () => {
      mockFetch(() => jsonResponse({ ...OK_BODY, email: null }));
      const el = await mountSettled(`?cg=${CG}&pubid=4`);
      expect(shadow(el).querySelector(".email")).toBeNull();
    });

    it("announces the transition through a polite status region", async () => {
      const el = await mountSettled(`?cg=${CG}&pubid=4`);
      const region = shadow(el).querySelector(".status")!;
      expect(region).toHaveAttribute("role", "status");
      expect(region).toHaveAttribute("aria-live", "polite");
      expect(region).toHaveAttribute("aria-label", "Email Preferences");
    });

    it("emits unsubscribed with the scope and publication id", async () => {
      const events: unknown[] = [];
      setLocation(`?cg=${CG}&pubid=4`);
      const el = mount();
      el.addEventListener("unsubscribed", (e) => events.push((e as CustomEvent).detail));
      await vi.waitFor(() => expect(events).toHaveLength(1));
      expect(events[0]).toEqual({ scope: "publication", publicationId: 4 });
    });
  });

  describe("undo", () => {
    it("hides the button and shows the undone headline", async () => {
      const el = await mountSettled(`?cg=${CG}&pubid=4`);
      undoBtn(el)!.click();
      await vi.waitFor(() =>
        expect(headline(el)).toBe("You have been re-subscribed."),
      );
      expect(undoBtn(el)).toBeNull();
    });

    it("emits resubscribed", async () => {
      const events: unknown[] = [];
      const el = await mountSettled(`?cg=${CG}&pubid=4`);
      el.addEventListener("resubscribed", (e) => events.push((e as CustomEvent).detail));
      undoBtn(el)!.click();
      await vi.waitFor(() => expect(events).toHaveLength(1));
      expect(events[0]).toEqual({ scope: "publication", publicationId: 4 });
    });

    it("keeps the manage link after an undo", async () => {
      const el = await mountSettled(
        `?cg=${CG}&pubid=4`,
        'my-subscriptions-url="https://church.example.org/prefs"',
      );
      undoBtn(el)!.click();
      await vi.waitFor(() =>
        expect(headline(el)).toBe("You have been re-subscribed."),
      );
      expect(manageLink(el)).not.toBeNull();
    });

    it("keeps the unsubscribe headline when the undo itself fails", async () => {
      // The visitor is still unsubscribed; losing the confirmation because the
      // *undo* failed would leave them told nothing.
      mockFetch((body) =>
        body.action === "resubscribe"
          ? jsonResponse({ error: "save_failed", message: "MP said no" }, 500)
          : jsonResponse(OK_BODY),
      );
      const el = await mountSettled(`?cg=${CG}&pubid=4`);
      undoBtn(el)!.click();
      await vi.waitFor(() =>
        expect(shadow(el).querySelector(".inline-error")).not.toBeNull(),
      );
      expect(headline(el)).toBe("You have been unsubscribed.");
      expect(shadow(el).querySelector(".inline-error")!.textContent).toBe(
        "Unable to undo unsubscribe.",
      );
    });
  });

  describe("errors", () => {
    it("renders the catalogue sentence for the code and a retry button", async () => {
      mockFetch(() =>
        jsonResponse({ error: "rate_limited", message: "Too many requests." }, 429),
      );
      const el = await mountSettled(`?cg=${CG}&pubid=4`);
      expect(headline(el)).toBe(
        "Too many requests. Please wait a moment and try again.",
      );
      expect(shadow(el).querySelector('[data-action="retry"]')).not.toBeNull();
    });

    it("never renders the server's English message", async () => {
      mockFetch(() =>
        jsonResponse(
          { error: "save_failed", message: "MinistryPlatform rejected the subscription update." },
          500,
        ),
      );
      const el = await mountSettled(`?cg=${CG}&pubid=4`);
      expect(text(el)).not.toContain("MinistryPlatform rejected");
      expect(headline(el)).toBe("We could not save your changes. Please try again.");
    });

    it("retries with the same capability", async () => {
      let fail = true;
      const fn = mockFetch(() =>
        fail
          ? jsonResponse({ error: "internal_error", message: "boom" }, 500)
          : jsonResponse(OK_BODY),
      );
      const el = await mountSettled(`?cg=${CG}&pubid=4`);
      fail = false;
      shadow(el).querySelector<HTMLButtonElement>('[data-action="retry"]')!.click();
      await vi.waitFor(() =>
        expect(headline(el)).toBe("You have been unsubscribed."),
      );
      expect(postedBodies(fn)[1]).toEqual({ cg: CG, pubid: 4, action: "unsubscribe" });
    });

    it("emits unsubscribeError", async () => {
      mockFetch(() => jsonResponse({ error: "internal_error", message: "boom" }, 500));
      const events: unknown[] = [];
      setLocation(`?cg=${CG}&pubid=4`);
      const el = mount();
      el.addEventListener("unsubscribeError", (e) =>
        events.push((e as CustomEvent).detail),
      );
      await vi.waitFor(() => expect(events).toHaveLength(1));
      expect(events[0]).toMatchObject({ action: "unsubscribe" });
    });
  });

  describe("my-subscriptions-url", () => {
    it("renders an https link", async () => {
      const el = await mountSettled(
        `?cg=${CG}&pubid=4`,
        'my-subscriptions-url="https://church.example.org/prefs"',
      );
      expect(manageLink(el)?.getAttribute("href")).toBe(
        "https://church.example.org/prefs",
      );
    });

    it("renders nothing when unset, as legacy hid its button", async () => {
      const el = await mountSettled(`?cg=${CG}&pubid=4`);
      expect(manageLink(el)).toBeNull();
    });

    it("drops a javascript: URL and warns exactly once", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const el = await mountSettled(
        `?cg=${CG}&pubid=4`,
        'my-subscriptions-url="javascript:alert(1)"',
      );
      // Rendered at least twice (working, then done) — the warning must not be.
      expect(manageLink(el)).toBeNull();
      const ours = warn.mock.calls.filter((c) =>
        String(c[0]).includes("my-subscriptions-url"),
      );
      expect(ours).toHaveLength(1);
    });
  });

  describe("lifecycle", () => {
    it("calls super.disconnectedCallback, so the locale listener is released", async () => {
      const el = await mountSettled(`?cg=${CG}&pubid=4`);
      const proto = Object.getPrototypeOf(Object.getPrototypeOf(el)) as {
        disconnectedCallback: () => void;
      };
      const superSpy = vi.spyOn(proto, "disconnectedCallback");
      el.remove();
      expect(superSpy).toHaveBeenCalledTimes(1);
      superSpy.mockRestore();
    });

    it("does not paint into a detached shadow root", async () => {
      let release!: (r: Response) => void;
      const pending = new Promise<Response>((resolve) => {
        release = resolve;
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url.includes("/api/embed/auth/config")) return jsonResponse({ mode: "legacy" });
          if (url.includes("/api/embed/session")) return jsonResponse({ token: makeJwt() });
          if (url.includes("/api/embed/unsubscribe")) return pending;
          return jsonResponse({ error: "not_found" }, 404);
        }),
      );

      setLocation(`?cg=${CG}&pubid=4`);
      const el = mount();
      await vi.waitFor(() => expect(shadow(el).querySelector(".working")).not.toBeNull());
      el.remove();
      release(jsonResponse(OK_BODY));
      await Promise.resolve();
      // Still the loading state: the response arrived after the element left.
      expect(shadow(el).querySelector(".working")).not.toBeNull();
    });
  });
});
