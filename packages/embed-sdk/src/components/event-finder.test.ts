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
