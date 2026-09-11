/**
 * Tests for `<next-contact-attributes>` (C52).
 *
 * The load-bearing ones, none of which is about markup:
 *
 *   - **signed out is a prompt, not an error.** A 401 renders a heading and a
 *     Sign In button; the `C13`/`C30`/`C46` family of bugs was every widget in
 *     this catalogue answering "something went wrong" to "you are not signed
 *     in".
 *   - **the server's English `message` appears nowhere in the shadow root.** An
 *     `invalid_attribute` reaches the visitor as the catalogue's sentence, in
 *     their language, and "One or more attributes are not available online"
 *     never does.
 *   - **`initLocale()` resolves before the first `render()`**, or a Spanish
 *     visitor watches English swap to Spanish.
 *   - **the PUT carries the complete set**, not a delta — the whole reason D2
 *     exists.
 *   - Submit tracks a real diff in both directions, so toggling back to the
 *     loaded set re-disables it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAuthSession } from "../shared/auth-session";
import { __resetLocaleSession } from "../i18n";
import "./contact-attributes";

const HOST = "https://widgets.example.com";
const PAGE = "/about-me";

/** Two online types, in the order the server already sorted them. */
function payload(selectedIds: number[] = []) {
  const pick = (id: number) => selectedIds.includes(id);
  return {
    types: [
      {
        attributeTypeId: 3,
        attributeTypeName: "Spiritual Gifts",
        attributes: [
          { attributeId: 14, attributeName: "Administration", selected: pick(14) },
          { attributeId: 11, attributeName: "Teaching", selected: pick(11) },
        ],
      },
      {
        attributeTypeId: 2,
        attributeTypeName: "Occupation",
        attributes: [
          { attributeId: 6, attributeName: "Carpenter", selected: pick(6) },
          { attributeId: 8, attributeName: "Doctor", selected: pick(8) },
        ],
      },
    ],
  };
}

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

interface Routes {
  get?: Response;
  put?: (body: Record<string, unknown>) => Response;
}

function mockFetch(routes: Routes = {}) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

    if (url.includes("/api/embed/auth/config")) return jsonResponse({ mode: "legacy" });
    if (url.includes("/api/embed/session")) return jsonResponse({ token: makeJwt() });
    if (url.includes("/api/embed/contact-attributes")) {
      if ((init?.method ?? "GET") === "PUT") {
        return routes.put ? routes.put(body) : jsonResponse(payload([...(body.attributeIds as number[])]));
      }
      return routes.get ?? jsonResponse(payload());
    }
    return jsonResponse({ error: "not_found" }, 404);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function putBodies(fn: ReturnType<typeof mockFetch>): Record<string, unknown>[] {
  return fn.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === "PUT")
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);
}

function mount(attrs = ""): HTMLElement {
  document.body.innerHTML = `<next-contact-attributes api-host="${HOST}" ${attrs}></next-contact-attributes>`;
  return document.body.firstElementChild as HTMLElement;
}

const shadow = (el: HTMLElement) => el.shadowRoot!;
const text = (el: HTMLElement) => shadow(el).textContent ?? "";
const heading = (el: HTMLElement) => shadow(el).querySelector("h2")?.textContent?.trim() ?? "";
const button = (el: HTMLElement, action: string) =>
  shadow(el).querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
const checkbox = (el: HTMLElement, id: number) =>
  shadow(el).querySelector<HTMLInputElement>(`.ca-check[data-id="${id}"]`);

/** Tick or untick a box the way a visitor does. */
function toggle(el: HTMLElement, id: number, checked: boolean): void {
  const input = checkbox(el, id)!;
  input.checked = checked;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function mountSettled(attrs = ""): Promise<HTMLElement> {
  const el = mount(attrs);
  await vi.waitFor(() => expect(heading(el)).not.toBe(""));
  // The heading paints in the loading state too; wait for the load to land.
  await vi.waitFor(() =>
    expect(shadow(el).querySelector(".ca-loading")).toBeNull()
  );
  return el;
}

describe("<next-contact-attributes>", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete (window as unknown as { __nextAuthSession?: unknown }).__nextAuthSession;
    __resetLocaleSession();
    document.documentElement.removeAttribute("lang");
    window.history.replaceState(null, "", PAGE);
    window.__nextTokenProvider = {
      get: () => getAuthSession(HOST).getToken("contact-attributes"),
      refresh: () => getAuthSession(HOST).refreshToken("contact-attributes"),
    };
    window.__nextSDKReady = Promise.resolve();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockFetch();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("registers as next-contact-attributes", () => {
    expect(customElements.get("next-contact-attributes")).toBeTruthy();
  });

  describe("localisation ordering", () => {
    it("resolves the catalogue before the first render", async () => {
      const order: string[] = [];
      const proto = Object.getPrototypeOf(
        document.createElement("next-contact-attributes")
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

    it("renders Spanish under <html lang=es>, with MP names left alone", async () => {
      document.documentElement.setAttribute("lang", "es");
      const el = await mountSettled();

      expect(heading(el)).toBe("Acerca de mí");
      expect(text(el)).not.toContain("About Me");
      // Type and attribute names are MP-authored and are never translated.
      expect(text(el)).toContain("Spiritual Gifts");
    });
  });

  describe("signed out", () => {
    it("renders the sign-in prompt, not an error", async () => {
      mockFetch({ get: jsonResponse({ error: "auth_required" }, 401) });
      const el = await mountSettled();

      expect(text(el)).toContain("Please sign in to view your skills and talents.");
      expect(button(el, "login")).not.toBeNull();
      expect(button(el, "retry")).toBeNull();
      expect(text(el)).not.toContain("Something went wrong");
    });

    it("asks the SDK for a login when the button is used", async () => {
      mockFetch({ get: jsonResponse({ error: "auth_required" }, 401) });
      const el = await mountSettled();

      const seen: unknown[] = [];
      el.addEventListener("loginRequired", (e) => seen.push((e as CustomEvent).detail));
      button(el, "login")!.click();

      expect(seen).toEqual([{ wid: "contact-attributes" }]);
    });
  });

  describe("not configured", () => {
    it("renders the explanatory state for an empty types array", async () => {
      mockFetch({ get: jsonResponse({ types: [] }) });
      const el = await mountSettled();

      expect(text(el)).toContain("has not made any attributes available online yet");
      expect(shadow(el).querySelectorAll("fieldset")).toHaveLength(0);
      expect(button(el, "edit")).toBeNull();
    });
  });

  describe("the empty state (D5)", () => {
    it("opens in edit mode with no Cancel and a disabled Submit", async () => {
      const el = await mountSettled();

      expect(shadow(el).querySelectorAll(".ca-check")).toHaveLength(4);
      expect(button(el, "cancel")).toBeNull();
      expect(button(el, "submit")).toBeDisabled();
      // The heading and intro are D5's fix: legacy showed a wall of unchecked
      // boxes and two dead buttons with no explanation.
      expect(heading(el)).toBe("About Me");
      expect(text(el)).toContain("You have not selected any attributes yet");
    });

    it("enables Submit as soon as something is ticked", async () => {
      const el = await mountSettled();

      toggle(el, 6, true);

      expect(button(el, "submit")).toBeEnabled();
    });
  });

  describe("view and edit", () => {
    it("shows only the types with a selected attribute, plus Edit", async () => {
      mockFetch({ get: jsonResponse(payload([6])) });
      const el = await mountSettled();

      expect(text(el)).toContain("Occupation");
      expect(text(el)).toContain("Carpenter");
      // A type with nothing selected is omitted in view mode (legacy parity).
      expect(text(el)).not.toContain("Spiritual Gifts");
      expect(button(el, "edit")).not.toBeNull();
      expect(shadow(el).querySelectorAll(".ca-check")).toHaveLength(0);
    });

    it("Edit opens the full grid pre-checked from the loaded set", async () => {
      mockFetch({ get: jsonResponse(payload([6])) });
      const el = await mountSettled();

      button(el, "edit")!.click();

      expect(shadow(el).querySelectorAll(".ca-check")).toHaveLength(4);
      expect(checkbox(el, 6)!.checked).toBe(true);
      expect(checkbox(el, 8)!.checked).toBe(false);
      expect(button(el, "submit")).toBeDisabled();
    });

    it("re-disables Submit when the visitor toggles back to the loaded set", async () => {
      mockFetch({ get: jsonResponse(payload([6])) });
      const el = await mountSettled();
      button(el, "edit")!.click();

      toggle(el, 8, true);
      expect(button(el, "submit")).toBeEnabled();

      toggle(el, 8, false);
      expect(button(el, "submit")).toBeDisabled();
    });

    it("Cancel restores the loaded set and discards the edits", async () => {
      mockFetch({ get: jsonResponse(payload([6])) });
      const el = await mountSettled();
      button(el, "edit")!.click();

      toggle(el, 6, false);
      toggle(el, 11, true);
      button(el, "cancel")!.click();

      expect(text(el)).toContain("Carpenter");
      expect(text(el)).not.toContain("Teaching");
      button(el, "edit")!.click();
      expect(checkbox(el, 6)!.checked).toBe(true);
      expect(checkbox(el, 11)!.checked).toBe(false);
    });
  });

  describe("saving", () => {
    it("PUTs the complete desired set, not a delta", async () => {
      const fn = mockFetch({ get: jsonResponse(payload([6])) });
      const el = await mountSettled();
      button(el, "edit")!.click();

      toggle(el, 11, true);
      shadow(el)
        .querySelector<HTMLFormElement>("#ca-form")!
        .dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));

      await vi.waitFor(() => expect(putBodies(fn)).toHaveLength(1));
      // D2's fix: the server diffs this against the database, so two open tabs
      // cannot silently reinstate what the other removed.
      expect(putBodies(fn)[0].attributeIds).toEqual([6, 11]);
    });

    it("re-renders from the returned payload and confirms with role=status", async () => {
      const el = await mountSettled();

      toggle(el, 8, true);
      shadow(el)
        .querySelector<HTMLFormElement>("#ca-form")!
        .dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));

      await vi.waitFor(() =>
        expect(shadow(el).querySelector('[role="status"]')).not.toBeNull()
      );
      expect(shadow(el).querySelector('[role="status"]')!.textContent).toContain(
        "Your changes have been saved."
      );
      // Straight into view mode, from the server's truth.
      expect(button(el, "edit")).not.toBeNull();
      expect(text(el)).toContain("Doctor");
    });
  });

  describe("errors", () => {
    it("renders invalid_attribute's sentence and never the server's English", async () => {
      const fn = mockFetch({
        get: jsonResponse(payload([6])),
        put: () =>
          jsonResponse(
            {
              error: "invalid_attribute",
              message: "One or more attributes are not available online",
            },
            400
          ),
      });
      const el = await mountSettled();
      button(el, "edit")!.click();
      toggle(el, 11, true);
      shadow(el)
        .querySelector<HTMLFormElement>("#ca-form")!
        .dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));

      await vi.waitFor(() =>
        expect(shadow(el).querySelector('[role="alert"]')).not.toBeNull()
      );
      expect(text(el)).toContain("Some of those options are no longer available");
      expect(text(el)).not.toContain("not available online");
      expect(putBodies(fn)).toHaveLength(1);

      // The edits survive the failure, so a retry is one click away.
      expect(checkbox(el, 11)!.checked).toBe(true);
    });

    it("offers a retry when the load fails", async () => {
      mockFetch({ get: jsonResponse({ error: "internal_error", message: "boom" }, 500) });
      const el = await mountSettled();

      expect(shadow(el).querySelector('[role="alert"]')).not.toBeNull();
      expect(text(el)).not.toContain("boom");
      expect(button(el, "retry")).not.toBeNull();
    });
  });

  describe("accessibility", () => {
    it("emits an h2, a fieldset/legend per type, and a label per checkbox", async () => {
      const el = await mountSettled();

      expect(shadow(el).querySelector("h2")).not.toBeNull();

      const fieldsets = shadow(el).querySelectorAll("fieldset");
      expect(fieldsets).toHaveLength(2);
      for (const fieldset of fieldsets) {
        expect(fieldset.querySelector("legend")?.textContent?.trim()).toBeTruthy();
      }

      for (const input of shadow(el).querySelectorAll<HTMLInputElement>(".ca-check")) {
        const label = shadow(el).querySelector(`label[for="${input.id}"]`);
        expect(label, `no label for ${input.id}`).not.toBeNull();
        expect(label!.textContent?.trim()).toBeTruthy();
      }
    });
  });
});
