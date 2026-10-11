/**
 * Tests for `<next-checkout>` and `<next-checkout-complete>`.
 *
 * The load-bearing ones:
 *   - **C41** — a declined card is coral and keeps the Pay form; an error is
 *     coral, never the amber "processing" banner, and holds the form back
 *     (the card may have been charged); both widgets read one mapper.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAuthSession } from "../shared/auth-session";
import { __resetLocaleSession } from "../i18n";
import "./checkout";
import "./checkout-complete";

const HOST = "https://widgets.example.com";
const PAGE = "/checkout";
const GUID = "11111111-2222-4333-8444-555555555555";

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function makeJwt(): string {
  return `${b64url({ alg: "HS256" })}.${b64url({ sub: "public", exp: Math.floor(Date.now() / 1000) + 300 })}.sig`;
}
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function invoice(over: Record<string, unknown> = {}) {
  return {
    invoiceId: 6,
    invoiceGuid: GUID,
    invoiceDate: "2026-09-01T00:00:00",
    invoiceTotal: 40,
    amountPaid: 0,
    balanceDue: 40,
    depositDue: null,
    statusId: 1,
    status: "None Paid",
    canPay: true,
    payorContactId: 98,
    payor: {
      firstName: "Pat", lastName: "Payer", email: "pat@example.org", mobilePhone: null,
      addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null,
    },
    eventId: null,
    lineItems: [
      {
        invoiceDetailId: 1, itemName: "Camp", itemNote: null, recipientName: null,
        quantity: 1, lineTotal: 40, isSubItem: false, eventParticipantId: null, eventId: null,
      },
    ],
    ...over,
  };
}

type Handler = (url: string, init?: RequestInit) => Response | undefined;

function mockFetch(handler: Handler) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/embed/auth/config")) return jsonResponse({ mode: "legacy" });
    if (url.includes("/api/embed/session")) return jsonResponse({ token: makeJwt() });
    return handler(url, init) ?? jsonResponse({ error: "not_found", message: "x" }, 404);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const shadow = (el: Element) => (el as HTMLElement).shadowRoot!;
const text = (el: Element) => shadow(el).textContent ?? "";

async function mountCheckout(attrs = ""): Promise<HTMLElement> {
  document.body.innerHTML = `<next-checkout api-host="${HOST}" invoice-id="${GUID}" ${attrs}></next-checkout>`;
  const el = document.body.firstElementChild as HTMLElement;
  await vi.waitFor(() => {
    expect(shadow(el).querySelector(".nw-co-spinner")).toBeNull();
    expect(shadow(el).querySelector(".nw-co-body")).not.toBeNull();
  });
  return el;
}

function setup() {
  localStorage.clear();
  sessionStorage.clear();
  delete (window as unknown as { __nextAuthSession?: unknown }).__nextAuthSession;
  __resetLocaleSession();
  document.documentElement.removeAttribute("lang");
  window.__nextTokenProvider = {
    get: () => getAuthSession(HOST).getToken("checkout"),
    refresh: () => getAuthSession(HOST).refreshToken("checkout"),
  };
  window.__nextSDKReady = Promise.resolve();
}

describe("<next-checkout> payment outcome (C41)", () => {
  beforeEach(() => {
    setup();
    window.history.replaceState(null, "", `${PAGE}?token=resp-token`);
  });
  afterEach(() => {
    document.body.innerHTML = "";
    window.history.replaceState(null, "", PAGE);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function withOutcome(status: string) {
    return mockFetch((url) => {
      if (url.includes("/checkout/payment-response")) return jsonResponse({ invoiceId: 6, status });
      if (url.includes("/checkout/invoice")) return jsonResponse({ invoice: invoice() });
      return undefined;
    });
  }

  it("declined: coral banner, Pay form still on screen", async () => {
    withOutcome("declined");
    const el = await mountCheckout();
    const banner = shadow(el).querySelector(".nw-co-confirm");
    expect(banner).toHaveClass("nw-co-confirm--failed");
    expect(banner).toHaveAttribute("role", "alert");
    expect(text(el)).toContain("declined");
    expect(shadow(el).querySelector("#nw-co-pay-form")).not.toBeNull();
  });

  it("error: coral, never the 'processing' copy, and the form is held back", async () => {
    withOutcome("error");
    const el = await mountCheckout();
    expect(shadow(el).querySelector(".nw-co-confirm")).toHaveClass("nw-co-confirm--failed");
    expect(text(el)).not.toContain("being processed");
    expect(text(el)).toContain("could not record");
    expect(shadow(el).querySelector("#nw-co-pay-form")).toBeNull();
  });

  it("an unrecognised body is an error, not pending", async () => {
    withOutcome("something-new");
    const el = await mountCheckout();
    expect(shadow(el).querySelector(".nw-co-confirm--pending")).toBeNull();
    expect(shadow(el).querySelector(".nw-co-confirm--failed")).not.toBeNull();
  });

  it("received: green banner", async () => {
    withOutcome("received");
    const el = await mountCheckout();
    expect(shadow(el).querySelector(".nw-co-confirm")).toHaveClass("nw-co-confirm--success");
  });
});

describe("<next-checkout-complete> payment outcome (C41)", () => {
  beforeEach(() => {
    setup();
    window.history.replaceState(null, "", "/complete?token=resp-token");
  });
  afterEach(() => {
    document.body.innerHTML = "";
    window.history.replaceState(null, "", PAGE);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function mountComplete(status: string): Promise<HTMLElement> {
    mockFetch((url) =>
      url.includes("/checkout/payment-response") ? jsonResponse({ invoiceId: 6, status }) : undefined,
    );
    document.body.innerHTML = `<next-checkout-complete api-host="${HOST}"></next-checkout-complete>`;
    const el = document.body.firstElementChild as HTMLElement;
    await vi.waitFor(() => expect(shadow(el).querySelector(".nw-cc-title")).not.toBeNull());
    return el;
  }

  it("declined: its own title, coral, no Try Again", async () => {
    const el = await mountComplete("declined");
    expect(shadow(el).querySelector(".nw-cc-card")).toHaveClass("nw-cc-card--failed");
    expect(text(el)).toContain("Payment Declined");
    expect(shadow(el).querySelector('[data-action="retry"]')).toBeNull();
  });

  it("error: coral and distinguishable from pending", async () => {
    const el = await mountComplete("error");
    expect(shadow(el).querySelector(".nw-cc-card")).toHaveClass("nw-cc-card--failed");
    expect(text(el)).not.toContain("being processed");
  });

  it("pending: amber", async () => {
    const el = await mountComplete("pending");
    expect(shadow(el).querySelector(".nw-cc-card")).toHaveClass("nw-cc-card--pending");
  });
});
