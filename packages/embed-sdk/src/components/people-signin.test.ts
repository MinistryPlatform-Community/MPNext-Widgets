/**
 * C53 / C81: the W6 auth-only widgets render the shared signed-out state.
 *
 * A 401 from the data route, reached with a *public* token, must paint the
 * widget's own prompt through `renderSignInRequired()` — a Sign In button in
 * `dual`/`hardened`, the page-link sentence in `legacy` — and never the
 * "Unable to Load" / Try Again error state, whose button re-runs the same
 * failing request forever.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAuthSession } from "../shared/auth-session";
import { __resetLocaleSession } from "../i18n";
import "./profile";
import "./my-household";
import "./subscriptions";
import "./online-directory";

const HOST = "https://widgets.example.com";

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function makeJwt(sub: string): string {
  return `${b64url({ alg: "HS256" })}.${b64url({ sub, exp: Math.floor(Date.now() / 1000) + 300 })}.sig`;
}
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    blob: async () => new Blob(),
  } as unknown as Response;
}

function mockFetch(mode: "legacy" | "dual", sub: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/embed/auth/config")) return jsonResponse({ mode });
      if (url.includes("/api/embed/session")) return jsonResponse({ token: makeJwt(sub) });
      return jsonResponse({ error: "auth_required", message: "Authentication required" }, 401);
    }),
  );
}

const CASES = [
  { tag: "next-profile", wid: "profile", prompt: "Please sign in to view your profile." },
  { tag: "next-my-household", wid: "my-household", prompt: "Please sign in to see your household details." },
  { tag: "next-subscriptions", wid: "subscriptions", prompt: "Please sign in to view your subscriptions." },
  { tag: "next-online-directory", wid: "online-directory", prompt: "Please sign in to view the directory." },
];

const shadow = (el: HTMLElement) => el.shadowRoot!;

async function mount(tag: string): Promise<HTMLElement> {
  document.body.innerHTML = `<${tag} api-host="${HOST}"></${tag}>`;
  const el = document.body.firstElementChild as HTMLElement;
  await vi.waitFor(() => expect(shadow(el).querySelector("[data-nw-signin], [data-action=retry]")).not.toBeNull());
  return el;
}

describe("people & account widgets: signed-out state (C53 / C81)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete (window as unknown as { __nextAuthSession?: unknown }).__nextAuthSession;
    __resetLocaleSession();
    document.documentElement.removeAttribute("lang");
    window.__nextTokenProvider = {
      get: () => getAuthSession(HOST).getToken("test"),
      refresh: () => getAuthSession(HOST).refreshToken("test"),
    };
    window.__nextSDKReady = Promise.resolve();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(CASES)("$tag: dual mode shows its prompt and a Sign In button, no Try Again", async ({ tag, wid, prompt }) => {
    mockFetch("dual", "public");
    const el = await mount(tag);
    expect(shadow(el).textContent).toContain(prompt);
    expect(shadow(el).querySelector("[data-action=retry]")).toBeNull();
    expect(shadow(el).textContent).not.toContain("Unable to Load");

    const seen: unknown[] = [];
    el.addEventListener("loginRequired", (e) => {
      e.preventDefault(); // jsdom cannot navigate
      seen.push((e as CustomEvent).detail);
    });
    shadow(el).querySelector<HTMLButtonElement>('[data-action="login"]')!.click();
    expect(seen).toEqual([{ wid }]);
  });

  it.each(CASES)("$tag: legacy mode names the page's sign-in link and draws no button", async ({ tag, prompt }) => {
    mockFetch("legacy", "public");
    const el = await mount(tag);
    expect(shadow(el).textContent).toContain(prompt);
    expect(shadow(el).textContent).toContain("Use the sign-in link on this page.");
    expect(shadow(el).querySelector('[data-action="login"]')).toBeNull();
    expect(shadow(el).querySelector("[data-action=retry]")).toBeNull();
  });

  it.each(CASES)("$tag: a 401 to a signed-in visitor is an error, not a sign-in loop", async ({ tag }) => {
    mockFetch("dual", "user-guid");
    const el = await mount(tag);
    expect(shadow(el).querySelector("[data-nw-signin]")).toBeNull();
    expect(shadow(el).querySelector("[data-action=retry]")).not.toBeNull();
  });
});
