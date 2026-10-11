/**
 * Tests for `<next-my-invoices>`.
 *
 *   - **C44** — "Pay" is a real `<a href>` to `checkout-url?id=<Invoice_GUID>`;
 *     no `mpp-*` tag is ever injected; no `checkout-url`, no Pay affordance.
 *   - **C45** — every row is a real `<button>`, the Pay link sits beside it
 *     (never inside), and the keyboard path reaches payment.
 *   - **C46** — a signed-out visitor gets the sign-in state, never "Unable to
 *     Load" + Try Again; a button only in `dual`/`hardened`.
 *   - **C60** — the filter attributes reach the route, `keyword` seeds the
 *     search, free registrations are badged and toggleable, and an attribute
 *     change after first paint reloads (W0 reconfigure).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAuthSession } from "../shared/auth-session";
import { __resetLocaleSession } from "../i18n";
import "./my-invoices";

const HOST = "https://widgets.example.com";

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function jwt(sub: string): string {
  return `${b64url({ alg: "HS256" })}.${b64url({ sub, exp: Math.floor(Date.now() / 1000) + 300 })}.sig`;
}
function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 300, status, json: async () => body } as unknown as Response;
}

const INVOICES = [
  {
    Invoice_ID: 3, Invoice_Date: "2026-09-01T00:00:00", Invoice_Total: 40, Invoice_Status_ID: 1,
    Invoice_Status: "None Paid", Notes: null, Currency: null,
    Invoice_GUID: "aaaaaaaa-0000-4000-8000-000000000003", Product_Summary: "Summer Retreat",
  },
  {
    Invoice_ID: 4, Invoice_Date: "2026-08-01T00:00:00", Invoice_Total: 0, Invoice_Status_ID: 3,
    Invoice_Status: "Paid in Full", Notes: null, Currency: null,
    Invoice_GUID: "aaaaaaaa-0000-4000-8000-000000000004", Product_Summary: "Free Event Registration",
  },
];

function mockFetch(opts: { sub?: string; status?: number; mode?: string } = {}) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/auth/config")) return jsonResponse({ mode: opts.mode ?? "legacy" });
    if (url.includes("/api/embed/session")) return jsonResponse({ token: jwt(opts.sub ?? "user-guid") });
    if (/\/api\/embed\/invoices\/\d+/.test(url)) {
      return jsonResponse({ invoice: INVOICES[0], lineItems: [] });
    }
    if (url.includes("/api/embed/invoices")) {
      return opts.status
        ? jsonResponse({ error: "auth_required", message: "sign in" }, opts.status)
        : jsonResponse({ invoices: INVOICES });
    }
    return jsonResponse({}, 404);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const shadow = (el: Element) => (el as HTMLElement).shadowRoot!;

async function mount(attrs = ""): Promise<HTMLElement> {
  document.body.innerHTML = `<next-my-invoices api-host="${HOST}" ${attrs}></next-my-invoices>`;
  const el = document.body.firstElementChild as HTMLElement;
  await vi.waitFor(() => expect(shadow(el).querySelector(".spinner")).toBeNull());
  await vi.waitFor(() => expect(shadow(el).querySelector(".title")).not.toBeNull());
  return el;
}

describe("<next-my-invoices>", () => {
  beforeEach(() => {
    localStorage.clear();
    delete (window as unknown as { __nextAuthSession?: unknown }).__nextAuthSession;
    __resetLocaleSession();
    window.__nextTokenProvider = {
      get: () => getAuthSession(HOST).getToken("my-invoices"),
      refresh: () => getAuthSession(HOST).refreshToken("my-invoices"),
    };
    window.__nextSDKReady = Promise.resolve();
  });
  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("C44/C45: rows are buttons and Pay is an anchor to checkout-url?id=<GUID>", async () => {
    mockFetch();
    const el = await mount('checkout-url="https://church.example/checkout"');
    const rows = shadow(el).querySelectorAll("button[data-invoice-id]");
    expect(rows).toHaveLength(2);
    const pay = shadow(el).querySelector<HTMLAnchorElement>("a.row-pay")!;
    expect(new URL(pay.href).searchParams.get("id")).toBe(INVOICES[0].Invoice_GUID);
    // Beside the row button, never inside it.
    expect(pay.closest("button")).toBeNull();
    // Only the payable invoice gets one.
    expect(shadow(el).querySelectorAll("a.row-pay")).toHaveLength(1);
    expect(document.querySelector("mpp-checkout")).toBeNull();
    expect(shadow(el).innerHTML).not.toContain("mpp-");
  });

  it("C45: a row opens the detail view, whose Pay Now is a link too", async () => {
    mockFetch();
    const el = await mount('checkout-url="/checkout"');
    shadow(el).querySelector<HTMLButtonElement>('button[data-invoice-id="3"]')!.click();
    await vi.waitFor(() => expect(shadow(el).querySelector("a.pay-btn")).not.toBeNull());
    const payNow = shadow(el).querySelector<HTMLAnchorElement>("a.pay-btn")!;
    expect(payNow.getAttribute("href")).toContain(`id=${INVOICES[0].Invoice_GUID}`);
    expect(shadow(el).activeElement).toHaveAttribute("data-action", "back");
  });

  it("C44: with no checkout-url there is no Pay affordance at all", async () => {
    mockFetch();
    const el = await mount();
    expect(shadow(el).querySelector("a.row-pay")).toBeNull();
  });

  it("C46: signed out renders the sign-in state, not Unable to Load + Try Again", async () => {
    mockFetch({ sub: "public", status: 401 });
    const el = await mount();
    await vi.waitFor(() => expect(shadow(el).textContent).toContain("Sign in to see your invoices"));
    expect(shadow(el).querySelector('[data-action="retry"]')).toBeNull();
    // legacy mode: copy only, no button
    expect(shadow(el).querySelector('[data-action="login"]')).toBeNull();
  });

  it("C46: in dual mode the sign-in state has a button", async () => {
    mockFetch({ sub: "public", status: 401, mode: "dual" });
    const el = await mount();
    await vi.waitFor(() =>
      expect(shadow(el).querySelector('[data-action="login"]')).not.toBeNull(),
    );
  });

  it("C60: filter attributes reach the route; keyword seeds the search", async () => {
    const fn = mockFetch();
    const el = await mount('congregation-id="4" month-id="10" invoice-status-id="1" keyword="Summer"');
    const listCall = fn.mock.calls.map(([u]) => String(u)).find((u) => /\/api\/embed\/invoices\?/.test(u))!;
    const q = new URL(listCall).searchParams;
    expect(q.get("congregationId")).toBe("4");
    expect(q.get("monthId")).toBe("10");
    expect(q.get("invoiceStatusId")).toBe("1");
    expect(shadow(el).querySelector<HTMLInputElement>("#invoice-search")!.value).toBe("Summer");
    expect(shadow(el).querySelectorAll("button[data-invoice-id]")).toHaveLength(1);
  });

  it("C60: a free registration is badged, and the toggle hides it", async () => {
    mockFetch();
    const el = await mount();
    expect(shadow(el).querySelector(".badge-free")).toHaveTextContent("Free");
    expect(shadow(el).textContent).not.toContain("$0.00");
    const toggle = shadow(el).querySelector<HTMLInputElement>("#invoice-show-free")!;
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    expect(shadow(el).querySelectorAll("button[data-invoice-id]")).toHaveLength(1);
  });

  it("C60: show-free-events=false is legacy's default; hide-free-events-checkbox hides the toggle", async () => {
    mockFetch();
    const el = await mount('show-free-events="false" hide-free-events-checkbox');
    expect(shadow(el).querySelectorAll("button[data-invoice-id]")).toHaveLength(1);
    expect(shadow(el).querySelector("#invoice-show-free")).toBeNull();
  });

  it("C60: changing an attribute after first paint reloads (W0 reconfigure)", async () => {
    const fn = mockFetch();
    const el = await mount();
    const before = fn.mock.calls.filter(([u]) => /\/api\/embed\/invoices(\?|$)/.test(String(u))).length;
    el.setAttribute("invoice-status-id", "2");
    await vi.waitFor(() => {
      const calls = fn.mock.calls.map(([u]) => String(u)).filter((u) => /\/api\/embed\/invoices(\?|$)/.test(u));
      expect(calls.length).toBe(before + 1);
      expect(calls.at(-1)).toContain("invoiceStatusId=2");
    });
  });
});
