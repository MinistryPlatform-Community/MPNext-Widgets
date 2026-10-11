/**
 * C02 / C03 (client half): the non-FullCalendar views of <next-full-calendar>
 * fetch the range they claim to show, refetch on every month change, cache
 * per range, and list exactly the month the toolbar names.
 *
 * Before C02 the `month` / `calendar` / `cards` / `list` views fetched one fixed
 * "this month + 3" window on connect and never again, so `›` to December showed
 * nothing (MP had eight public services) while the cards below still listed
 * September under a "December 2026" header.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { monthGridRange, rollingRange, eventOverlapsDays } from "./full-calendar";

const HOST = "https://widgets.example.com";

type Fixture = { Event_ID: number; Event_Title: string; Event_Start_Date: string; Event_End_Date: string };

/** "Today" for the whole suite: Thursday 15 October 2026, local time. */
const NOW = new Date(2026, 9, 15, 12, 0, 0);

const FIXTURES: Fixture[] = [
  { Event_ID: 1, Event_Title: "October Picnic", Event_Start_Date: "2026-10-10T12:00:00", Event_End_Date: "2026-10-10T14:00:00" },
  // C03's fixture: straddles the October/November boundary.
  { Event_ID: 2, Event_Title: "Fall Retreat", Event_Start_Date: "2026-10-30T09:00:00", Event_End_Date: "2026-11-02T17:00:00" },
  { Event_ID: 3, Event_Title: "November Supper", Event_Start_Date: "2026-11-12T18:00:00", Event_End_Date: "2026-11-12T20:00:00" },
  { Event_ID: 4, Event_Title: "Christmas Eve Service", Event_Start_Date: "2026-12-24T19:00:00", Event_End_Date: "2026-12-24T20:30:00" },
  { Event_ID: 5, Event_Title: "September Kickoff", Event_Start_Date: "2026-09-13T10:00:00", Event_End_Date: "2026-09-13T11:00:00" },
];

const fullEvent = (f: Fixture) => ({
  ...f,
  Event_Type_ID: 1,
  Event_Type: "Service",
  Description: null,
  Location_Name: null,
  Congregation_ID: null,
  Congregation_Name: null,
  Ministry_Name: null,
  Featured_On_Calendar: false,
  Image_URL: null,
});

/** Requested ranges, in order. */
let requests: { start: Date; end: Date }[] = [];
/** Ranges starting at this instant answer 503 until cleared. */
let failStart: number | null = null;

function fakeFetch(url: string) {
  const u = new URL(url);
  const start = new Date(u.searchParams.get("start")!);
  const end = new Date(u.searchParams.get("end")!);
  requests.push({ start, end });
  if (failStart !== null && start.getTime() === failStart) {
    return Promise.resolve({
      ok: false,
      status: 503,
      json: async () => ({ error: "mp_unavailable", message: "down" }),
    } as unknown as Response);
  }
  // Overlap, as the server now selects (C03).
  const events = FIXTURES.filter(
    (f) => new Date(f.Event_Start_Date) < end && new Date(f.Event_End_Date) >= start,
  ).map(fullEvent);
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ({ events, isAdmin: false, filters: { campuses: [], ministries: [] } }),
  } as unknown as Response);
}

function mount(attrs = ""): HTMLElement {
  document.body.innerHTML = `<next-full-calendar api-host="${HOST}" ${attrs}></next-full-calendar>`;
  return document.body.firstElementChild as HTMLElement;
}

const shadow = (el: HTMLElement) => el.shadowRoot!;
const title = (el: HTMLElement) => shadow(el).querySelector("#nw-fc-title")?.textContent;
const cardTitles = (el: HTMLElement) =>
  Array.from(shadow(el).querySelectorAll(".nw-fc-card-title")).map((n) => n.textContent);
const click = (el: HTMLElement, sel: string) =>
  shadow(el).querySelector<HTMLElement>(sel)!.click();
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};
const requested = (month: Date) => {
  const { start, end } = monthGridRange(month);
  return requests.filter((r) => r.start.getTime() === start.getTime() && r.end.getTime() === end.getTime()).length;
};

describe("full-calendar range helpers", () => {
  it("pads a month to the whole weeks the mini calendar draws", () => {
    // November 2026: the 1st is a Sunday, the 30th a Monday.
    const { start, end } = monthGridRange(new Date(2026, 10, 1));
    expect(start).toEqual(new Date(2026, 10, 1));
    expect(end).toEqual(new Date(2026, 11, 6)); // exclusive: through Sat Dec 5
    // October 2026: the 1st is a Thursday → starts Sun Sep 27.
    const oct = monthGridRange(new Date(2026, 9, 20));
    expect(oct.start).toEqual(new Date(2026, 8, 27));
    expect(oct.end).toEqual(new Date(2026, 10, 1)); // Oct 31 is a Saturday
  });

  it("rolls from today's midnight forward three months", () => {
    const { start, end } = rollingRange(NOW);
    expect(start).toEqual(new Date(2026, 9, 15));
    expect(end).toEqual(new Date(2027, 0, 15));
  });

  it("matches days by overlap, so a multi-day event lists on each day it occupies", () => {
    const retreat = FIXTURES[1];
    expect(eventOverlapsDays(retreat, "2026-10-01", "2026-10-31")).toBe(true);
    expect(eventOverlapsDays(retreat, "2026-11-01", "2026-11-30")).toBe(true);
    expect(eventOverlapsDays(retreat, "2026-11-02", "2026-11-02")).toBe(true);
    expect(eventOverlapsDays(retreat, "2026-11-03", "2026-11-30")).toBe(false);
    expect(eventOverlapsDays(retreat, "2026-09-01", "2026-10-29")).toBe(false);
  });
});

describe("<next-full-calendar> month navigation (C02)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    requests = [];
    failStart = null;
    window.__nextSDKReady = Promise.resolve();
    window.__nextTokenProvider = { get: async () => "test-token", refresh: async () => "test-token" };
    vi.stubGlobal("fetch", vi.fn(fakeFetch));
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("first paint fetches the displayed month's padded range and lists only that month", async () => {
    const el = mount('view="month"');
    await settle();

    expect(requested(NOW)).toBe(1);
    expect(title(el)).toBe("October 2026");
    // The retreat starts in October; September's kickoff is outside.
    expect(cardTitles(el)).toEqual(["October Picnic", "Fall Retreat"]);
  });

  it("› fetches December and shows December's events under a December header", async () => {
    const el = mount('view="month"');
    await settle();

    click(el, '[data-action="next"]');
    await settle();
    click(el, '[data-action="next"]');
    await settle();

    expect(requested(new Date(2026, 11, 1))).toBeGreaterThanOrEqual(1);
    expect(title(el)).toBe("December 2026");
    expect(cardTitles(el)).toEqual(["Christmas Eve Service"]);
  });

  it("lists a boundary-straddling retreat in both of its months", async () => {
    const el = mount('view="month"');
    await settle();
    expect(cardTitles(el)).toContain("Fall Retreat");

    click(el, '[data-action="next"]');
    await settle();
    expect(title(el)).toBe("November 2026");
    expect(cardTitles(el)).toEqual(["Fall Retreat", "November Supper"]);
  });

  it("‹ reaches past months too", async () => {
    const el = mount('view="calendar"');
    await settle();
    click(el, '[data-action="prev"]');
    await settle();
    expect(title(el)).toBe("September 2026");
    expect(cardTitles(el)).toEqual(["September Kickoff"]);
  });

  it("the mini calendar's own month arrows refetch as well", async () => {
    const el = mount('view="month"');
    await settle();
    click(el, ".nw-fc-mini-cal-nav:last-of-type");
    await settle();
    expect(title(el)).toBe("November 2026");
    expect(cardTitles(el)).toEqual(["Fall Retreat", "November Supper"]);
  });

  it("caches per range: paging away and back does not refetch, and neighbours are prefetched", async () => {
    const el = mount('view="month"');
    await settle();
    // Prefetch: September and November are already requested.
    expect(requested(new Date(2026, 8, 1))).toBe(1);
    expect(requested(new Date(2026, 10, 1))).toBe(1);

    click(el, '[data-action="next"]');
    await settle();
    click(el, '[data-action="prev"]');
    await settle();

    expect(requested(NOW)).toBe(1);
    expect(requested(new Date(2026, 10, 1))).toBe(1);
    expect(title(el)).toBe("October 2026");
  });

  it("says so when a month is genuinely empty", async () => {
    const el = mount('view="month"');
    await settle();
    for (let i = 0; i < 3; i++) {
      click(el, '[data-action="next"]');
      await settle();
    }
    expect(title(el)).toBe("January 2027");
    expect(shadow(el).querySelector(".nw-fc-cards-empty")?.textContent).toBe(
      "No events in January 2027.",
    );
  });

  it("Today returns to the current month", async () => {
    const el = mount('view="month"');
    await settle();
    click(el, '[data-action="next"]');
    await settle();
    click(el, '[data-action="today"]');
    await settle();
    expect(title(el)).toBe("October 2026");
  });

  it("a failed month shows an error with Try Again, which refetches", async () => {
    failStart = monthGridRange(new Date(2027, 0, 1)).start.getTime();
    const el = mount('view="month"');
    await settle();
    for (let i = 0; i < 3; i++) {
      click(el, '[data-action="next"]');
      await settle();
    }
    expect(title(el)).toBe("January 2027");
    expect(shadow(el).querySelector('[role="alert"]')).not.toBeNull();
    // An error, not a misleading "No events in January".
    expect(shadow(el).querySelector(".nw-fc-cards-empty")).toBeNull();

    failStart = null;
    const before = requests.length;
    click(el, '[data-action="retry-cards"]');
    await settle();
    expect(requests.length).toBeGreaterThan(before);
    expect(shadow(el).querySelector('[role="alert"]')).toBeNull();
    expect(shadow(el).querySelector(".nw-fc-cards-empty")?.textContent).toBe(
      "No events in January 2027.",
    );
  });

  describe('cards-scope="rolling"', () => {
    it("lists from today forward, with no month navigation and an Upcoming title", async () => {
      const el = mount('view="cards" cards-scope="rolling"');
      await settle();

      const r = rollingRange(NOW);
      expect(requests[0].start).toEqual(r.start);
      expect(requests[0].end).toEqual(r.end);
      expect(shadow(el).querySelector('[data-action="next"]')).toBeNull();
      expect(shadow(el).querySelector('[data-action="prev"]')).toBeNull();
      expect(title(el)).toBe("Upcoming events");
      expect(cardTitles(el)).toEqual(["Fall Retreat", "November Supper", "Christmas Eve Service"]);
    });

    it("does not apply to the month view, whose cards sit under a mini calendar", async () => {
      const el = mount('view="month" cards-scope="rolling"');
      await settle();
      expect(title(el)).toBe("October 2026");
      expect(shadow(el).querySelector('[data-action="next"]')).not.toBeNull();
    });

    it("reconfigures when set after first paint (W0 reconfigure convention)", async () => {
      const el = mount('view="cards"');
      await settle();
      expect(title(el)).toBe("October 2026");

      el.setAttribute("cards-scope", "rolling");
      await settle();
      expect(title(el)).toBe("Upcoming events");
      expect(cardTitles(el)).toContain("Christmas Eve Service");
    });
  });
});
