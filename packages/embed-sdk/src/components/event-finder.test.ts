/**
 * <next-event-finder> (packages/embed-sdk/src/components/event-finder.ts)
 *
 * C05: result cards are real links (Enter, Ctrl-click, copyable href).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "./event-finder";

const HOST = "https://widgets.example.com";

const EVENTS = [
  {
    id: 215,
    title: "Saturday Night Service",
    description: null,
    imageUrl: null,
    location: "Main Congregation",
    startDate: "2026-09-12T18:05:00",
    endDate: "2026-09-12T19:30:00",
    featured: true,
  },
  {
    id: 380,
    title: "Sunday 10AM Worship Service",
    description: null,
    imageUrl: null,
    location: "Main Campus",
    startDate: "2027-01-03T10:00:00",
    endDate: "2027-01-03T11:30:00",
    featured: false,
  },
];

/** Search URLs the widget requested, in order. */
let searches: URL[] = [];

function fakeFetch(url: string) {
  const u = new URL(url);
  if (u.pathname.endsWith("/config")) {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ congregations: [{ id: 1, name: "Main" }], ministries: [] }),
    } as unknown as Response);
  }
  searches.push(u);
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ({ events: EVENTS }),
  } as unknown as Response);
}

function mount(attrs = ""): HTMLElement {
  document.body.innerHTML = `<next-event-finder api-host="${HOST}" ${attrs}></next-event-finder>`;
  return document.body.firstElementChild as HTMLElement;
}

const shadow = (el: HTMLElement) => el.shadowRoot!;
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  searches = [];
  window.__nextSDKReady = Promise.resolve();
  window.__nextTokenProvider = { get: async () => "test-token", refresh: async () => "test-token" };
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("<next-event-finder> result cards (C05)", () => {
  it("renders each card as a real link to the detail page", async () => {
    const el = mount('target-url="/events/details" id-parameter-name="eventId"');
    await settle();

    const cards = shadow(el).querySelectorAll<HTMLAnchorElement>("a.nw-ef-card");
    expect(cards).toHaveLength(2);
    const href = new URL(cards[0].href);
    expect(href.pathname).toBe("/events/details");
    expect(href.searchParams.get("eventId")).toBe("215");
    // No emulated link semantics left behind.
    expect(shadow(el).querySelector('[role="link"]')).toBeNull();
    expect(cards[0]).not.toHaveAttribute("tabindex");
  });

  it("falls back to role=article with no href when target-url is not set", async () => {
    const el = mount();
    await settle();
    expect(shadow(el).querySelector("a.nw-ef-card")).toBeNull();
    expect(shadow(el).querySelectorAll('.nw-ef-card[role="article"]')).toHaveLength(2);
  });

  it("emits eventSelected and leaves navigation (including Ctrl-click) to the browser", async () => {
    const el = mount('target-url="/events/details"');
    await settle();
    const selected: unknown[] = [];
    el.addEventListener("eventSelected", (e) => selected.push((e as CustomEvent).detail));
    // Record whether the widget cancelled each click, then cancel it ourselves
    // so jsdom does not attempt the (unimplemented) cross-document navigation.
    const cancelledByWidget: boolean[] = [];
    document.addEventListener("click", (e) => {
      cancelledByWidget.push(e.defaultPrevented);
      e.preventDefault();
    });

    const card = shadow(el).querySelector<HTMLAnchorElement>("a.nw-ef-card")!;
    card.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }));
    card.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true, cancelable: true, ctrlKey: true }),
    );

    expect(selected).toEqual([{ eventId: 215 }, { eventId: 215 }]);
    // Neither click is cancelled, so the anchor's own navigation runs.
    expect(cancelledByWidget).toEqual([false, false]);
  });
});

describe("<next-event-finder> card dates (C09)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 8, 12, 0, 0)); // 8 Sep 2026
  });
  afterEach(() => vi.useRealTimers());

  const dates = (el: HTMLElement) =>
    Array.from(shadow(el).querySelectorAll(".nw-ef-card-date")).map((n) =>
      (n.textContent || "").replace(/[ -   ]/g, " "),
    );

  it("omits the year for this year's events and shows it for next year's", async () => {
    const el = mount();
    await settle();
    const [sep, jan] = dates(el);
    expect(sep).toContain("Sat, Sep 12,");
    expect(sep).not.toContain("2026");
    expect(jan).toContain("Sun, Jan 3, 2027");
  });
});

describe("<next-event-finder> Featured filter (C04)", () => {
  const featuredBox = (el: HTMLElement) =>
    shadow(el).querySelector<HTMLInputElement>("#ef-featured")!;
  const submit = (el: HTMLElement) =>
    shadow(el)
      .querySelector<HTMLFormElement>("#ef-form")!
      .dispatchEvent(new Event("submit", { cancelable: true }));

  it("renders a labelled Featured checkbox in the Advanced panel", async () => {
    const el = mount();
    await settle();
    const box = featuredBox(el);
    expect(box).toBeInTheDocument();
    expect(box.type).toBe("checkbox");
    expect(box.checked).toBe(false);
    expect(shadow(el).querySelector('label[for="ef-featured"]')?.textContent).toContain("Featured");
    expect(searches[0].searchParams.has("isFeatured")).toBe(false);
  });

  it("lets a visitor tick it and search featured events only", async () => {
    const el = mount();
    await settle();
    featuredBox(el).checked = true;
    submit(el);
    await settle();
    expect(searches.at(-1)!.searchParams.get("isFeatured")).toBe("true");
    expect(featuredBox(el).checked).toBe(true);
  });

  it('treats featured="true" as a default the visitor can undo, and shows it', async () => {
    const el = mount('featured="true"');
    await settle();
    expect(searches[0].searchParams.get("isFeatured")).toBe("true");
    // The pre-set filter is visible rather than hidden behind "Advanced Search".
    const panel = shadow(el).querySelector<HTMLElement>(".nw-ef-advanced")!;
    expect(panel.style.display).toBe("grid");
    expect(featuredBox(el).checked).toBe(true);

    featuredBox(el).checked = false;
    submit(el);
    await settle();
    expect(searches.at(-1)!.searchParams.has("isFeatured")).toBe(false);
  });

  it("re-searches when an attribute is set after the first paint (W0 reconfigure)", async () => {
    const el = mount();
    await settle();
    const before = searches.length;
    el.setAttribute("featured", "true");
    await settle();
    expect(searches.length).toBe(before + 1);
    expect(searches.at(-1)!.searchParams.get("isFeatured")).toBe("true");
  });
});
