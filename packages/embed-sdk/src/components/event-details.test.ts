/**
 * <next-event-details> (packages/embed-sdk/src/components/event-details.ts)
 *
 * C07: an anonymous page view must not ask for the user-scoped
 * `basic-contact` — that request 401'd by design, which made the shared fetch
 * refresh the token and 401 again, on every anonymous event view.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "./event-details";

const HOST = "https://widgets.example.com";

/** An unsigned JWT-shaped token with the given `sub` (the SDK never verifies). */
function token(sub: string): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, "");
  return [b64({ alg: "HS256", typ: "JWT" }), b64({ sub, ver: 2 }), "sig"].join(".");
}

const EVENT = {
  id: 215,
  eventId: 215,
  title: "Saturday Night Service",
  description: null,
  imageUrl: null,
  location: null,
  address: null,
  startDate: "2026-09-12T18:05:00",
  endDate: "2026-09-12T19:30:00",
  startDateUTC: null,
  endDateUTC: null,
  latitude: null,
  longitude: null,
  featured: false,
  registrationProductId: null,
  registrationPrice: null,
  registrationDepositPrice: null,
  meetingInstructions: null,
  primaryContactId: null,
  visibilityLevelId: 4,
  forceLogin: false,
  opportunityId: null,
  opportunityCount: 0,
  registrationActive: false,
  externalRegistrationUrl: null,
  locationAddressId: null,
  customFormId: null,
  customFormGuid: null,
  isRegistrationFull: false,
  isRegistrationOptionsFull: false,
  isFreeEvent: true,
  minorRegistration: false,
  allowEmail: false,
  showBuildingRoomInfo: false,
  isUserStaff: false,
  attributes: [],
  rooms: null,
  contacts: [],
};

let paths: string[] = [];
let currentToken = token("public");
const refresh = vi.fn(async () => currentToken);

function fakeFetch(url: string) {
  const path = new URL(url).pathname;
  paths.push(path);
  const json = (status: number, body: unknown) =>
    Promise.resolve({ ok: status < 400, status, json: async () => body } as unknown as Response);
  if (path === "/api/embed/event-details/basic-contact") {
    return currentToken === token("public")
      ? json(401, { error: "auth_required", message: "Sign in required" })
      : json(200, { contact: { contactId: 7, firstName: "Ann", lastName: "Lee" } });
  }
  if (/^\/api\/embed\/event-details\/\d+$/.test(path)) {
    return json(200, { event: { ...EVENT, id: Number(path.split("/").pop()) }, isUserStaff: false });
  }
  return json(200, {});
}

function mount(attrs = ""): HTMLElement {
  document.body.innerHTML = `<next-event-details api-host="${HOST}" ${attrs}></next-event-details>`;
  return document.body.firstElementChild as HTMLElement;
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

const basicContactCalls = () =>
  paths.filter((p) => p === "/api/embed/event-details/basic-contact").length;

beforeEach(() => {
  paths = [];
  refresh.mockClear();
  window.__nextSDKReady = Promise.resolve();
  window.__nextTokenProvider = { get: async () => currentToken, refresh };
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  document.body.innerHTML = "";
  currentToken = token("public");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("<next-event-details> anonymous load (C07)", () => {
  it("never requests basic-contact with a public token, so nothing 401s or refreshes", async () => {
    currentToken = token("public");
    const el = mount('event-id="215"');
    await settle();

    expect(paths).toContain("/api/embed/event-details/215");
    expect(basicContactCalls()).toBe(0);
    expect(refresh).not.toHaveBeenCalled();
    expect(el.shadowRoot!.textContent).toContain("Saturday Night Service");
  });

  it("still loads the contact once for a signed-in token", async () => {
    currentToken = token("4f1c2b7e-0000-0000-0000-000000000001");
    mount('event-id="215"');
    await settle();

    expect(basicContactCalls()).toBe(1);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("<next-event-details> reconfigure (C39 convention)", () => {
  it("loads when event-id is set after a first paint that had none", async () => {
    // The old guard only reacted to event-id once an event had loaded, so a
    // host that inserts the element and then configures it got stuck.
    const el = mount();
    await settle();
    expect(paths.filter((p) => /\/event-details\/\d+$/.test(p))).toHaveLength(0);

    el.setAttribute("event-id", "380");
    await settle();
    expect(paths).toContain("/api/embed/event-details/380");
  });

  it("does not reload for render-only attributes", async () => {
    const el = mount('event-id="215"');
    await settle();
    const before = paths.length;
    el.setAttribute("checkout-url", "/checkout");
    await settle();
    expect(paths.length).toBe(before);
  });
});

describe("<next-event-details> custom-form field ids", () => {
  it("prefixes custom-form ids with the instance id, so two forms on one page never collide", () => {
    const field = {
      formFieldId: 41, fieldLabel: "T-shirt size", fieldType: 1, required: true,
      fieldOrder: 1, fieldValues: [], dependsOn: null, dependsOnValue: null, isHidden: false,
    };
    type Internals = {
      event: unknown; customFields: unknown[]; instanceId: string;
      renderCustomFormSection(): string;
    };
    const render = () => {
      const el = document.createElement("next-event-details") as unknown as Internals;
      el.event = { ...EVENT, customFormId: 9 };
      el.customFields = [field];
      const html = el.renderCustomFormSection();
      const host = document.createElement("div");
      host.innerHTML = html;
      return { id: host.querySelector("input.cf-input")!.id, prefix: el.instanceId };
    };
    const a = render();
    const b = render();
    expect(a.id.startsWith(`${a.prefix}-`)).toBe(true);
    expect(b.id.startsWith(`${b.prefix}-`)).toBe(true);
    expect(a.id).not.toBe(b.id);
  });
});
