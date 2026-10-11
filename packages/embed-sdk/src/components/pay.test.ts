/**
 * Tests for `<next-pay>` (the sandbox gateway) — C48 format validation.
 *
 * `13/99` and CVV `abc` used to submit. The pure checks are tested directly;
 * the widget test proves they are wired into `form-validation.ts` (no native
 * popup, an `aria-invalid` control, and no request sent), and that the card
 * fields carry the `cc-*` autocomplete tokens browser card-fill needs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAuthSession } from "../shared/auth-session";
import { __resetLocaleSession } from "../i18n";
import { isValidCardNumber, checkExpiry, isValidCvv } from "./pay";

const HOST = "https://widgets.example.com";

describe("card format checks", () => {
  it("accepts Luhn-valid 13–19 digit numbers, with spaces or dashes", () => {
    expect(isValidCardNumber("4111 1111 1111 1111")).toBe(true);
    expect(isValidCardNumber("4111-1111-1111-1111")).toBe(true);
    expect(isValidCardNumber("4222222222222")).toBe(true); // 13 digits
  });

  it("rejects bad checksums, lengths and characters", () => {
    expect(isValidCardNumber("4111 1111 1111 1112")).toBe(false);
    expect(isValidCardNumber("411111111111")).toBe(false); // 12
    expect(isValidCardNumber("41111111111111111111")).toBe(false); // 20
    expect(isValidCardNumber("4111 1111 abcd 1111")).toBe(false);
  });

  it("validates MM/YY expiry, month range and not past", () => {
    const now = new Date(2026, 9, 11); // October 2026
    expect(checkExpiry("10/26", now)).toBe("ok"); // current month still good
    expect(checkExpiry("1/2030", now)).toBe("ok");
    expect(checkExpiry("09/26", now)).toBe("expired");
    expect(checkExpiry("13/99", now)).toBe("invalid");
    expect(checkExpiry("00/30", now)).toBe("invalid");
    expect(checkExpiry("1230", now)).toBe("invalid");
  });

  it("accepts a 3–4 digit CVV only", () => {
    expect(isValidCvv("123")).toBe(true);
    expect(isValidCvv("1234")).toBe(true);
    expect(isValidCvv("abc")).toBe(false);
    expect(isValidCvv("12")).toBe(false);
  });
});

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 300, status, json: async () => body } as unknown as Response;
}

describe("<next-pay> wiring", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    localStorage.clear();
    delete (window as unknown as { __nextAuthSession?: unknown }).__nextAuthSession;
    __resetLocaleSession();
    window.history.replaceState(null, "", "/pay?token=req");
    window.__nextTokenProvider = {
      get: () => getAuthSession(HOST).getToken("pay"),
      refresh: () => getAuthSession(HOST).refreshToken("pay"),
    };
    window.__nextSDKReady = Promise.resolve();
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/auth/config")) return jsonResponse({ mode: "legacy" });
      if (url.includes("/api/embed/session")) {
        return jsonResponse({
          token: `${b64url({ alg: "HS256" })}.${b64url({ sub: "public", exp: Date.now() / 1000 + 300 })}.s`,
        });
      }
      if (url.includes("/pay/unpack")) {
        return jsonResponse({
          request: { invoiceId: "inv", amount: 10, returnUrl: "/checkout", firstName: "Pat", lastName: "Payer", email: null },
        });
      }
      return jsonResponse({ token: "resp" });
    });
    vi.stubGlobal("fetch", fetchMock);
    await import("./pay");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function mount(): Promise<ShadowRoot> {
    document.body.innerHTML = `<next-pay api-host="${HOST}"></next-pay>`;
    const el = document.body.firstElementChild as HTMLElement;
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("#nw-pay-form")).not.toBeNull());
    return el.shadowRoot!;
  }

  it("labels every card field and gives it its cc-* autocomplete token", async () => {
    const root = await mount();
    for (const [name, token] of [
      ["name-on-card", "cc-name"],
      ["card-number", "cc-number"],
      ["expiry", "cc-exp"],
      ["cvv", "cc-csc"],
    ]) {
      const input = root.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
      expect(input).toHaveAttribute("autocomplete", token);
      expect(root.querySelector(`label[for="${input.id}"]`)).not.toBeNull();
    }
    expect(root.querySelector('[name="cvv"]')).toHaveAttribute("inputmode", "numeric");
  });

  it("refuses 13/99 and CVV abc without sending anything", async () => {
    const root = await mount();
    const set = (name: string, value: string) => {
      root.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value = value;
    };
    set("card-number", "4111 1111 1111 1111");
    set("expiry", "13/99");
    set("cvv", "abc");
    root.querySelector<HTMLFormElement>("#nw-pay-form")!.requestSubmit();

    await vi.waitFor(() =>
      expect(root.querySelector('[name="expiry"]')).toHaveAttribute("aria-invalid", "true"),
    );
    expect(root.querySelector('[name="cvv"]')).toHaveAttribute("aria-invalid", "true");
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/pay/response"))).toBe(false);
  });
});
