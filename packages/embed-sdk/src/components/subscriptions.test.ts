/**
 * Tests for `<next-subscriptions>`.
 *
 *   - C55: the bulk-email toggle round-trips `Bulk_Email_Opt_Out`, saves per
 *     toggle with no submit button, reverts on failure, and follows a
 *     `next-profile` save on the same page.
 *   - C61: `congregation-id` scopes the read *and* the diff the save is made
 *     against, and a late set re-scopes (C39).
 *   - per-publication saving is unchanged (regression guard).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAuthSession } from "../shared/auth-session";
import { __resetLocaleSession } from "../i18n";
import "./subscriptions";

const HOST = "https://widgets.example.com";

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function makeJwt(): string {
  return `${b64url({ alg: "HS256" })}.${b64url({ sub: "user-guid", exp: Math.floor(Date.now() / 1000) + 300 })}.sig`;
}
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const PUBS = [
  { Publication_ID: 3, Title: "Weekly Pastor Newsletter", Description: null, Online_Sort_Order: 1, subscribed: true },
  { Publication_ID: 4, Title: "Weekly Newsletter", Description: "News", Online_Sort_Order: 2, subscribed: false },
];

interface Opts {
  bulkEmailOptOut?: boolean;
  putFails?: boolean;
}

let gets: string[] = [];
let puts: Record<string, unknown>[] = [];

function mockFetch(opts: Opts = {}) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/embed/auth/config")) return jsonResponse({ mode: "dual" });
    if (url.includes("/api/embed/session")) return jsonResponse({ token: makeJwt() });
    if (url.includes("/api/embed/subscriptions")) {
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        puts.push(body);
        if (opts.putFails) return jsonResponse({ success: false, error: "db down" }, 500);
        return jsonResponse({ success: true, ...("bulkEmailOptOut" in body ? { bulkEmailOptOut: body.bulkEmailOptOut } : {}) });
      }
      gets.push(url);
      return jsonResponse({
        subscriptions: PUBS.map((p) => ({ ...p })),
        ...(opts.bulkEmailOptOut === undefined ? {} : { bulkEmailOptOut: opts.bulkEmailOptOut }),
      });
    }
    return jsonResponse({ error: "not_found" }, 404);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const shadow = (el: HTMLElement) => el.shadowRoot!;
const bulkBox = (el: HTMLElement) => shadow(el).querySelector<HTMLInputElement>("#sub-bulk-email");

async function mountSettled(attrs = ""): Promise<HTMLElement> {
  document.body.innerHTML = `<next-subscriptions api-host="${HOST}" ${attrs}></next-subscriptions>`;
  const el = document.body.firstElementChild as HTMLElement;
  await vi.waitFor(() => expect(shadow(el).querySelector(".sub-list")).not.toBeNull());
  return el;
}

function toggle(box: HTMLInputElement, checked: boolean) {
  box.checked = checked;
  box.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("<next-subscriptions>", () => {
  beforeEach(() => {
    gets = [];
    puts = [];
    localStorage.clear();
    sessionStorage.clear();
    delete (window as unknown as { __nextAuthSession?: unknown }).__nextAuthSession;
    __resetLocaleSession();
    document.documentElement.removeAttribute("lang");
    window.__nextTokenProvider = {
      get: () => getAuthSession(HOST).getToken("subscriptions"),
      refresh: () => getAuthSession(HOST).refreshToken("subscriptions"),
    };
    window.__nextSDKReady = Promise.resolve();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("bulk email opt-out (C55)", () => {
    it("draws the toggle below the list, checked when the contact is not opted out", async () => {
      mockFetch({ bulkEmailOptOut: false });
      const el = await mountSettled();
      const box = bulkBox(el)!;
      expect(box).not.toBeNull();
      expect(box.checked).toBe(true);
      expect(shadow(el).textContent).toContain("Send me general church emails");
      // Separated from the publication rows, so it cannot read as a publication.
      expect(box.closest(".sub-list")).toBeNull();
    });

    it("saves on change with no submit button, sending only the flag", async () => {
      mockFetch({ bulkEmailOptOut: false });
      const el = await mountSettled();
      toggle(bulkBox(el)!, false);

      await vi.waitFor(() => expect(puts).toHaveLength(1));
      expect(puts[0]).toEqual({ bulkEmailOptOut: true });
      await vi.waitFor(() => expect(shadow(el).textContent).toContain("You won't receive bulk email"));
      expect(bulkBox(el)!.checked).toBe(false);
      expect(shadow(el).querySelector('button[type="submit"]')).toBeNull();
    });

    it("turns bulk email back on", async () => {
      mockFetch({ bulkEmailOptOut: true });
      const el = await mountSettled();
      expect(bulkBox(el)!.checked).toBe(false);
      toggle(bulkBox(el)!, true);
      await vi.waitFor(() => expect(puts).toEqual([{ bulkEmailOptOut: false }]));
      await vi.waitFor(() => expect(bulkBox(el)!.checked).toBe(true));
    });

    it("reverts the toggle when the save fails", async () => {
      mockFetch({ bulkEmailOptOut: false, putFails: true });
      const el = await mountSettled();
      toggle(bulkBox(el)!, false);
      await vi.waitFor(() => expect(shadow(el).querySelector(".message--error")).not.toBeNull());
      expect(bulkBox(el)!.checked).toBe(true);
    });

    it("draws no toggle when the server does not send the flag", async () => {
      mockFetch();
      const el = await mountSettled();
      expect(bulkBox(el)).toBeNull();
    });

    it("follows a next-profile save on the same page", async () => {
      mockFetch({ bulkEmailOptOut: false });
      const el = await mountSettled();
      document.dispatchEvent(new CustomEvent("profileSaved", { detail: { Bulk_Email_Opt_Out: true } }));
      expect(bulkBox(el)!.checked).toBe(false);
    });
  });

  it("still saves a publication per toggle (regression guard)", async () => {
    mockFetch({ bulkEmailOptOut: false });
    const el = await mountSettled();
    toggle(shadow(el).querySelector<HTMLInputElement>('.sub-check[data-id="4"]')!, true);
    await vi.waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ subscribedIds: [3, 4], congregationId: null });
  });

  describe("congregation-id (C61)", () => {
    it("scopes the read and sends the same scope with every publication save", async () => {
      mockFetch({ bulkEmailOptOut: false });
      const el = await mountSettled('congregation-id="3"');
      expect(gets.at(-1)).toContain("/api/embed/subscriptions?congregationId=3");

      toggle(shadow(el).querySelector<HTMLInputElement>('.sub-check[data-id="4"]')!, true);
      await vi.waitFor(() => expect(puts).toHaveLength(1));
      expect(puts[0]).toEqual({ subscribedIds: [3, 4], congregationId: 3 });
    });

    it("is unscoped without the attribute, and ignores a non-numeric value", async () => {
      mockFetch();
      await mountSettled('congregation-id="north"');
      expect(gets.at(-1)).not.toContain("congregationId");
    });

    it("re-scopes when the attribute is set after the first paint (C39)", async () => {
      mockFetch();
      const el = await mountSettled();
      expect(gets).toHaveLength(1);
      el.setAttribute("congregation-id", "7");
      await vi.waitFor(() => expect(gets).toHaveLength(2));
      expect(gets[1]).toContain("congregationId=7");
    });
  });
});
