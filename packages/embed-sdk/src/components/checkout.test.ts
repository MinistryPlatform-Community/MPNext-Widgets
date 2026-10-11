/**
 * Tests for `<next-checkout>` and `<next-checkout-complete>`.
 *
 * The load-bearing ones:
 *   - **C41** — a declined card is coral and keeps the Pay form; an error is
 *     coral, never the amber "processing" banner, and holds the form back
 *     (the card may have been charged); both widgets read one mapper.
 *   - **C43** — the other-amount cap, and next-pay's designed "already used"
 *     state (no Try Again: it would fail identically).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAuthSession } from "../shared/auth-session";
import { __resetLocaleSession, getLocaleSession } from "../i18n";
import "./checkout";
import "./checkout-complete";
import "./pay";

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

describe("single-use and overpay (C43)", () => {
  beforeEach(() => {
    setup();
    window.history.replaceState(null, "", PAGE);
  });
  afterEach(() => {
    document.body.innerHTML = "";
    window.history.replaceState(null, "", PAGE);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("next-checkout caps 'other amount' at the balance and never asks for a token", async () => {
    const fn = mockFetch((url) =>
      url.includes("/checkout/invoice") ? jsonResponse({ invoice: invoice() }) : undefined,
    );
    const el = await mountCheckout('payment-processor-url="https://pay.example.com/pay"');
    const other = shadow(el).querySelector<HTMLInputElement>('input[value="other"]')!;
    other.checked = true;
    other.dispatchEvent(new Event("change"));
    const input = shadow(el).querySelector<HTMLInputElement>("#nw-other-amount")!;
    input.value = "999999";
    input.dispatchEvent(new Event("input"));
    shadow(el).querySelector<HTMLFormElement>("#nw-co-pay-form")!.requestSubmit();

    await vi.waitFor(() => expect(text(el)).toContain("cannot be more than the balance due"));
    expect(fn.mock.calls.some(([u]) => String(u).includes("payment-token"))).toBe(false);
  });

  it("next-checkout hides a deposit that is not less than the balance", async () => {
    mockFetch((url) =>
      url.includes("/checkout/invoice")
        ? jsonResponse({ invoice: invoice({ depositDue: 50, balanceDue: 40 }) })
        : undefined,
    );
    const el = await mountCheckout();
    expect(shadow(el).querySelector('input[value="deposit"]')).toBeNull();
  });

  it("next-pay renders the designed 'already used' state, with no Try Again", async () => {
    window.history.replaceState(null, "", "/pay?token=spent");
    mockFetch((url) =>
      url.includes("/pay/unpack")
        ? jsonResponse({ error: "verification_used", message: "used" }, 409)
        : undefined,
    );
    document.body.innerHTML = `<next-pay api-host="${HOST}"></next-pay>`;
    const el = document.body.firstElementChild as HTMLElement;
    await vi.waitFor(() => expect(shadow(el).querySelector(".nw-pay-link")).not.toBeNull());
    expect(text(el)).toContain("already been used");
    expect(shadow(el).querySelector('[data-action="retry"]')).toBeNull();
    expect(shadow(el).querySelector("#nw-pay-form")).toBeNull();
  });
});

describe("<next-checkout> Make Changes link (C49)", () => {
  beforeEach(() => {
    setup();
    window.history.replaceState(null, "", PAGE);
  });
  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function changesHref(attrs: string, over: Record<string, unknown>): Promise<string | null> {
    mockFetch((url) =>
      url.includes("/checkout/invoice") ? jsonResponse({ invoice: invoice(over) }) : undefined,
    );
    const el = await mountCheckout(attrs);
    const a = shadow(el).querySelector<HTMLAnchorElement>(".nw-co-changes");
    expect(a).toHaveTextContent("Make Changes");
    return a?.getAttribute("href") ?? null;
  }

  it("carries the event id and invoice GUID, keeping an existing query", async () => {
    const href = await changesHref('back-to-event-url="https://church.example/events?src=pay"', {
      eventId: 16,
    });
    const url = new URL(href!);
    expect(url.searchParams.get("src")).toBe("pay");
    expect(url.searchParams.get("id")).toBe("16");
    expect(url.searchParams.get("invoiceid")).toBe(GUID);
  });

  it("follows the destination's id parameter name", async () => {
    const href = await changesHref(
      'back-to-event-url="https://church.example/event" back-to-event-id-parameter-name="eventId"',
      { eventId: 16 },
    );
    expect(new URL(href!).searchParams.get("eventId")).toBe("16");
  });

  it("falls back to the bare URL for a non-event invoice", async () => {
    const href = await changesHref('back-to-event-url="/events"', { eventId: null });
    expect(href).toBe("/events");
  });
});

describe("<next-checkout> nothing-to-pay wording (C47)", () => {
  beforeEach(() => {
    setup();
    window.history.replaceState(null, "", PAGE);
  });
  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function mountWith(over: Record<string, unknown>): Promise<HTMLElement> {
    mockFetch((url) =>
      url.includes("/checkout/invoice") ? jsonResponse({ invoice: invoice(over) }) : undefined,
    );
    return mountCheckout();
  }

  it("a zero-total invoice reads 'registration is complete', never 'Paid in full'", async () => {
    const el = await mountWith({
      invoiceTotal: 0, amountPaid: 0, balanceDue: 0, canPay: false, status: "None Paid",
    });
    expect(text(el)).toContain("Your registration is complete.");
    expect(text(el)).not.toContain("Paid in full");
    expect(text(el)).not.toContain("None Paid");
  });

  it("money paid and no balance reads 'Paid in full'", async () => {
    const el = await mountWith({
      amountPaid: 40, balanceDue: 0, canPay: false, status: "Paid in Full",
    });
    expect(shadow(el).querySelector(".nw-co-status--paid")).toHaveTextContent("Paid in full");
  });

  it("otherwise MP's own status, as written", async () => {
    const el = await mountWith({ canPay: false, status: "Cancelled", statusId: 7 });
    expect(shadow(el).querySelector(".nw-co-status--closed")).toHaveTextContent("Cancelled");
  });
});


// ── A page-wide language change must not leave the buttons dead ───────────
//
// The base class re-renders through `render()` alone on a locale change.
// These widgets used to bind their listeners in a separate call after each
// internal render, so the switch repainted the markup with nothing bound —
// and, the other way round, a bind left at a call site after the fix would
// bind twice and fire the payment request twice.

describe("payment widgets: locale switch keeps listeners bound, once", () => {
  beforeEach(() => {
    setup();
    window.history.replaceState(null, "", PAGE);
  });
  afterEach(() => {
    document.body.innerHTML = "";
    window.history.replaceState(null, "", PAGE);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function switchTo(el: HTMLElement, code: string) {
    await getLocaleSession().setLocale(code);
    await vi.waitFor(() => expect(el).toHaveAttribute("lang", code));
  }

  const count = (fn: ReturnType<typeof mockFetch>, part: string) =>
    fn.mock.calls.filter(([u]) => String(u).includes(part)).length;

  it("next-checkout: Pay still requests exactly one payment token after a switch to Spanish and back", async () => {
    const fn = mockFetch((url) => {
      if (url.includes("/checkout/invoice")) return jsonResponse({ invoice: invoice() });
      if (url.includes("/checkout/payment-token")) return jsonResponse({ token: "req-token" });
      return undefined;
    });
    const el = await mountCheckout('payment-processor-url="https://pay.example.com/pay"');
    await switchTo(el, "es");
    await switchTo(el, "en");

    shadow(el).querySelector<HTMLButtonElement>('[data-action="pay"]')!.click();
    await vi.waitFor(() => expect(count(fn, "/checkout/payment-token")).toBe(1));
    await new Promise((r) => setTimeout(r, 10));
    expect(count(fn, "/checkout/payment-token")).toBe(1);
  });

  it("next-checkout: the pay-choice radios still repaint after a switch", async () => {
    mockFetch((url) =>
      url.includes("/checkout/invoice") ? jsonResponse({ invoice: invoice() }) : undefined,
    );
    const el = await mountCheckout();
    await switchTo(el, "es");

    const other = shadow(el).querySelector<HTMLInputElement>('input[value="other"]')!;
    other.checked = true;
    other.dispatchEvent(new Event("change"));
    expect(shadow(el).querySelector("#nw-other-amount")).not.toBeNull();
  });

  it("next-checkout-complete: Try Again still re-asks once after a switch", async () => {
    window.history.replaceState(null, "", "/complete?token=resp-token");
    let first = true;
    const fn = mockFetch((url) => {
      if (!url.includes("/checkout/payment-response")) return undefined;
      if (first) {
        first = false;
        throw new TypeError("network down");
      }
      return jsonResponse({ invoiceId: 6, status: "received" });
    });
    document.body.innerHTML = `<next-checkout-complete api-host="${HOST}"></next-checkout-complete>`;
    const el = document.body.firstElementChild as HTMLElement;
    await vi.waitFor(() => expect(shadow(el).querySelector('[data-action="retry"]')).not.toBeNull());
    await switchTo(el, "es");

    shadow(el).querySelector<HTMLButtonElement>('[data-action="retry"]')!.click();
    await vi.waitFor(() => expect(count(fn, "/checkout/payment-response")).toBe(2));
    await new Promise((r) => setTimeout(r, 10));
    expect(count(fn, "/checkout/payment-response")).toBe(2);
  });

  describe("next-pay", () => {
    async function mountPay() {
      window.history.replaceState(null, "", "/pay?token=req");
      const fn = mockFetch((url) => {
        if (url.includes("/pay/unpack")) {
          return jsonResponse({
            request: { invoiceId: "inv", amount: 10, returnUrl: "/checkout", firstName: "Pat", lastName: "Payer", email: null },
          });
        }
        if (url.includes("/pay/response")) return jsonResponse({ token: "resp" });
        return undefined;
      });
      document.body.innerHTML = `<next-pay api-host="${HOST}"></next-pay>`;
      const el = document.body.firstElementChild as HTMLElement;
      await vi.waitFor(() => expect(shadow(el).querySelector("#nw-pay-form")).not.toBeNull());
      return { el, fn };
    }

    function fillCard(el: HTMLElement) {
      const set = (name: string, value: string) => {
        shadow(el).querySelector<HTMLInputElement>(`[name="${name}"]`)!.value = value;
      };
      set("card-number", "4111 1111 1111 1111");
      set("expiry", "12/99");
      set("cvv", "123");
    }

    it("the Pay form still submits exactly once after a switch to Spanish", async () => {
      const { el, fn } = await mountPay();
      await switchTo(el, "es");
      fillCard(el);

      shadow(el).querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
      await vi.waitFor(() => expect(count(fn, "/pay/response")).toBe(1));
      await new Promise((r) => setTimeout(r, 10));
      expect(count(fn, "/pay/response")).toBe(1);
    });

    it("keeps its double-submit guard: a second submit while in flight sends nothing", async () => {
      const { el, fn } = await mountPay();
      fillCard(el);

      shadow(el).querySelector<HTMLFormElement>("#nw-pay-form")!.requestSubmit();
      // The in-flight paint: button disabled, and its form bound again. Refill
      // it, so validation alone cannot be what stops the second submit.
      expect(shadow(el).querySelector('button[type="submit"]')).toBeDisabled();
      fillCard(el);
      shadow(el).querySelector<HTMLFormElement>("#nw-pay-form")!.requestSubmit();

      await vi.waitFor(() => expect(count(fn, "/pay/response")).toBe(1));
      await new Promise((r) => setTimeout(r, 10));
      expect(count(fn, "/pay/response")).toBe(1);
    });
  });
});
