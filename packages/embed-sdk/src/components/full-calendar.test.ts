/**
 * Lifecycle tests for <next-full-calendar>
 * (packages/embed-sdk/src/components/full-calendar.ts)
 *
 * Pins the regression from .claude/TODO/20: toggling `show-toolbar` at runtime
 * while on a FullCalendar-backed view (`grid` / `week`) used to call
 * `render()` — which replaces `#nw-fc-mount` — and then
 * `calendarInstance.render()`, painting into the now-detached node. The widget
 * went completely blank with no throw and no `fullCalendarError` event, so the
 * only signals that catch it are the *measured* ones the TODO recorded:
 *
 *   - `#nw-fc-mount` child count (was 1 → 0)
 *   - shadow-root text length (was 610 → 0)
 *   - the live instance's element still being the in-DOM mount
 *
 * All three are asserted below, in both toggle directions, on both views.
 *
 * Also pins .claude/TODO/32: mounting `<next-full-calendar view="grid|week">`
 * used to construct *two* FullCalendars and leak one, because markup attributes
 * reach `attributeChangedCallback` during upgrade — before `connectedCallback`
 * — and both ran a full init. Every assertion here now counts live instances
 * globally, so a leaked orphan fails the suite wherever it is created.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "./full-calendar";

const HOST = "https://widgets.example.com";
const FC_SRC = "https://cdn.jsdelivr.net/npm/fullcalendar@6.1.21/index.global.min.js";

// ── A stand-in for the FullCalendar global ──────────────────────────────────
//
// Mirrors the two behaviours the bug depends on: the Calendar binds to the
// element it was constructed with (and never re-binds), and `render()` paints
// into exactly that element.

type FcOptions = { initialView: string; [k: string]: unknown };

class FakeCalendar {
  static instances: FakeCalendar[] = [];
  el: HTMLElement;
  options: FcOptions;
  view: string;
  destroyed = false;
  renderCount = 0;

  constructor(el: HTMLElement, options: FcOptions) {
    this.el = el;
    this.options = options;
    this.view = options.initialView;
    FakeCalendar.instances.push(this);
  }

  render(): void {
    this.renderCount++;
    // Two events' worth of content, so "did it actually paint?" is measurable
    // as rendered text and not just as a child count.
    this.el.innerHTML =
      `<div class="fc fc-view-harness" data-view="${this.view}">` +
      `<div class="fc-event">Sunday Service 9:00 AM</div>` +
      `<div class="fc-event">Youth Group 6:30 PM</div>` +
      `</div>`;
  }

  changeView(view: string): void {
    this.view = view;
    this.render();
  }

  destroy(): void {
    this.destroyed = true;
    this.el.innerHTML = "";
  }

  prev(): void {}
  next(): void {}
  today(): void {}
}

const liveInstances = () => FakeCalendar.instances.filter((i) => !i.destroyed);


// ── Harness ─────────────────────────────────────────────────────────────────

function eventsPayload() {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 19);
  return {
    events: [
      {
        Event_ID: 1,
        Event_Title: "Sunday Service",
        Event_Start_Date: iso(now),
        Event_End_Date: iso(new Date(now.getTime() + 3600_000)),
        Event_Type_ID: 1,
        Event_Type: "Service",
        Description: "Weekly gathering",
        Location_Name: "Main Auditorium",
        Congregation_Name: "Main Campus",
        Featured_On_Calendar: true,
      },
    ],
    isAdmin: false,
    filters: { campuses: [], ministries: [] },
  };
}

function mount(attrs = ""): HTMLElement {
  document.body.innerHTML = `<next-full-calendar api-host="${HOST}" ${attrs}></next-full-calendar>`;
  return document.body.firstElementChild as HTMLElement;
}

const shadow = (el: HTMLElement) => el.shadowRoot!;
const mountEl = (el: HTMLElement) => shadow(el).querySelector<HTMLElement>("#nw-fc-mount");
const textLength = (el: HTMLElement) => (shadow(el).textContent || "").trim().length;
const toolbar = (el: HTMLElement) => shadow(el).querySelector(".nw-fc-toolbar");

/** Let connectedCallback's await chain and any microtask queue drain. */
const settle = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

/** Live instances bound to the `#nw-fc-mount` currently in the shadow DOM. */
function attachedInstances(el: HTMLElement): FakeCalendar[] {
  const mnt = mountEl(el);
  return mnt ? liveInstances().filter((i) => i.el === mnt) : [];
}

/**
 * The invariant both bugs violated: exactly one live FullCalendar instance,
 * bound to the `#nw-fc-mount` that is actually in the shadow DOM, with content
 * in it.
 *
 * The live count is global, not per-mount: an instance bound to a mount node a
 * later `render()` threw away is a leak (TODO 32) and must fail here, not be
 * filtered out.
 */
function expectLiveCalendar(el: HTMLElement, expectToolbar: boolean) {
  const mnt = mountEl(el);
  expect(mnt).not.toBeNull();
  expect(mnt!.isConnected).toBe(true);
  // Exactly one live calendar in the whole page...
  expect(liveInstances()).toHaveLength(1);
  // ...and it is bound to the current mount, not an orphan left by render().
  expect(attachedInstances(el)).toHaveLength(1);
  // Measured signals from TODO 20 (text length 610 → 0, mount children 1 → 0).
  expect(mnt!.children.length).toBe(1);
  expect(mnt!.textContent).toContain("Sunday Service");
  expect(textLength(el)).toBeGreaterThan(0);
  expect(toolbar(el) === null).toBe(!expectToolbar);
}

describe("<next-full-calendar> view lifecycle", () => {
  beforeEach(() => {
    FakeCalendar.instances = [];
    // loadScript() early-resolves when a matching tag already exists, so this
    // stands in for the CDN without touching the network.
    document.head.innerHTML = `<script src="${FC_SRC}"></script><style>.fc-event { color: red; }</style>`;
    (window as unknown as { FullCalendar?: unknown }).FullCalendar = { Calendar: FakeCalendar };
    window.__nextSDKReady = Promise.resolve();
    window.__nextTokenProvider = {
      get: async () => "test-token",
      refresh: async () => "test-token",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => eventsPayload(),
            text: async () => JSON.stringify(eventsPayload()),
          }) as unknown as Response
      )
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    delete (window as unknown as { FullCalendar?: unknown }).FullCalendar;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // ── TODO 32: one init per mount, no orphan ────────────────────────────────

  for (const view of ["grid", "week"] as const) {
    it(`constructs exactly one FullCalendar for markup view="${view}"`, async () => {
      const el = mount(`view="${view}"`);
      await settle();

      // Constructed, not merely *live*: an orphan that is never destroyed shows
      // up as a second construction long before anything destroys it.
      expect(FakeCalendar.instances).toHaveLength(1);
      expect(liveInstances()).toHaveLength(1);
      expect(FakeCalendar.instances[0].el).toBe(mountEl(el));
      expect(FakeCalendar.instances[0].view).toBe(
        view === "grid" ? "dayGridMonth" : "timeGridWeek"
      );
      expectLiveCalendar(el, true);
    });

    it(`leaves nothing behind when a markup view="${view}" widget is removed`, async () => {
      const el = mount(`view="${view}"`);
      await settle();
      expect(FakeCalendar.instances).toHaveLength(1);

      el.remove();
      await settle();

      // disconnectedCallback destroys the *only* instance — with the double
      // init it could only ever reach the survivor, leaking the other.
      expect(liveInstances()).toHaveLength(0);
      expect(FakeCalendar.instances.every((i) => i.destroyed)).toBe(true);
    });
  }

  it("constructs exactly one FullCalendar for markup view + show-toolbar together", async () => {
    const el = mount('view="week" show-toolbar="false"');
    await settle();
    expect(FakeCalendar.instances).toHaveLength(1);
    expectLiveCalendar(el, false);
  });

  it("ignores attribute callbacks delivered before connectedCallback", async () => {
    // Exactly what a custom-element upgrade does: the element already carries
    // its attributes when the definition (and therefore the callback) arrives.
    const el = document.createElement("next-full-calendar");
    el.setAttribute("api-host", HOST);
    el.setAttribute("view", "grid");
    el.setAttribute("show-toolbar", "false");
    await settle();
    // Not connected yet: no shadow content, no calendar.
    expect(FakeCalendar.instances).toHaveLength(0);

    document.body.appendChild(el);
    await settle();
    expect(FakeCalendar.instances).toHaveLength(1);
    expectLiveCalendar(el, false);
  });

  it("re-initialises exactly once when a widget is removed and re-added", async () => {
    const el = mount('view="grid"');
    await settle();
    expect(FakeCalendar.instances).toHaveLength(1);

    el.remove();
    await settle();
    expect(liveInstances()).toHaveLength(0);

    document.body.appendChild(el);
    await settle();
    expect(FakeCalendar.instances).toHaveLength(2); // one per connection
    expect(liveInstances()).toHaveLength(1);
    expectLiveCalendar(el, true);
  });

  it("applies attributes changed during the async init pass", async () => {
    // The guard suppresses these callbacks; connectedCallback replays whatever
    // the final attribute values are once its own init pass is done, so a host
    // that flips an attribute mid-load does not lose the change.
    const el = mount('view="grid"');
    el.setAttribute("view", "week");
    el.setAttribute("show-toolbar", "false");
    await settle();

    expectLiveCalendar(el, false);
    expect(attachedInstances(el)[0].view).toBe("timeGridWeek");
  });

  // ── The regression itself ─────────────────────────────────────────────────

  for (const view of ["grid", "week"] as const) {
    it(`survives a show-toolbar toggle in both directions on view="${view}"`, async () => {
      const el = mount(`view="${view}"`);
      await settle();
      expectLiveCalendar(el, true);
      const firstInstance = attachedInstances(el)[0];
      const liveBefore = liveInstances().length;

      // on → off: this is the step that used to blank the widget.
      el.setAttribute("show-toolbar", "false");
      await settle();
      expectLiveCalendar(el, false);
      // The instance bound to the replaced mount was destroyed, not silently
      // orphaned, and a fresh one took its place on the new mount.
      expect(firstInstance.destroyed).toBe(true);
      expect(attachedInstances(el)[0]).not.toBe(firstInstance);
      // A toggle destroys as many calendars as it creates.
      expect(liveInstances().length).toBe(liveBefore);

      // off → on.
      el.setAttribute("show-toolbar", "true");
      await settle();
      expectLiveCalendar(el, true);
      expect(liveInstances().length).toBe(liveBefore);

      // And again, to prove it is not a one-shot recovery.
      el.setAttribute("show-toolbar", "false");
      await settle();
      expectLiveCalendar(el, false);
      expect(liveInstances().length).toBe(liveBefore);
    });

    it(`re-init after a show-toolbar toggle keeps view="${view}" on its FullCalendar view`, async () => {
      const el = mount(`view="${view}"`);
      await settle();
      const expected = view === "grid" ? "dayGridMonth" : "timeGridWeek";
      expect(attachedInstances(el)[0].view).toBe(expected);

      el.setAttribute("show-toolbar", "false");
      await settle();
      expect(attachedInstances(el)[0].view).toBe(expected);
      expect(mountEl(el)!.querySelector(".fc")!.getAttribute("data-view")).toBe(expected);
    });
  }

  it("renders correctly when show-toolbar=false is an initial attribute", async () => {
    const el = mount('view="grid" show-toolbar="false"');
    await settle();
    expectLiveCalendar(el, false);
  });

  it("does not stack duplicate FullCalendar stylesheets across re-inits", async () => {
    const el = mount('view="grid"');
    await settle();
    const count = () => shadow(el).querySelectorAll("style").length;
    const initial = count();
    expect(initial).toBeGreaterThan(0);

    for (let i = 0; i < 4; i++) {
      el.setAttribute("show-toolbar", i % 2 === 0 ? "false" : "true");
      await settle();
    }
    expect(count()).toBe(initial);
  });

  // ── switchView() must keep working ────────────────────────────────────────

  it("switches through all six views and back without orphaning a calendar", async () => {
    const el = mount('view="month"');
    await settle();
    // month is not FullCalendar-backed.
    expect(mountEl(el)).toBeNull();
    expect(liveInstances()).toHaveLength(0);

    const order = ["grid", "week", "list", "cards", "calendar", "month"] as const;
    for (const view of order) {
      el.setAttribute("view", view);
      await settle();
      if (view === "grid" || view === "week") {
        expectLiveCalendar(el, true);
      } else {
        expect(mountEl(el)).toBeNull();
        expect(liveInstances()).toHaveLength(0);
        expect(textLength(el)).toBeGreaterThan(0);
      }
    }
  });

  it("keeps switchView() working after a show-toolbar toggle", async () => {
    const el = mount('view="grid"');
    await settle();

    el.setAttribute("show-toolbar", "false");
    await settle();
    expectLiveCalendar(el, false);

    el.setAttribute("view", "week");
    await settle();
    expectLiveCalendar(el, false);
    expect(attachedInstances(el)[0].view).toBe("timeGridWeek");

    el.setAttribute("view", "cards");
    await settle();
    expect(mountEl(el)).toBeNull();
    expect(textLength(el)).toBeGreaterThan(0);

    el.setAttribute("view", "grid");
    await settle();
    expectLiveCalendar(el, false);
  });

  // ── Non-FullCalendar views are unaffected ─────────────────────────────────

  it("toggling show-toolbar on a cards view re-renders without a calendar", async () => {
    const el = mount('view="cards"');
    await settle();
    const before = textLength(el);
    expect(before).toBeGreaterThan(0);
    expect(toolbar(el)).not.toBeNull();

    el.setAttribute("show-toolbar", "false");
    await settle();
    expect(toolbar(el)).toBeNull();
    expect(textLength(el)).toBeGreaterThan(0);
    expect(liveInstances()).toHaveLength(0);
    expect(before).toBeGreaterThan(0);
  });

  // ── Guard: a toggle before the calendar exists must not construct one ─────

  it("does not construct a calendar when show-toolbar toggles while still loading", async () => {
    (window as unknown as { FullCalendar?: unknown }).FullCalendar = undefined;
    document.head.innerHTML = `<script src="${FC_SRC}"></script>`;
    const el = mount('view="grid"');
    await settle();
    // initCalendar() bailed out with an error state, no instance was made.
    expect(FakeCalendar.instances).toHaveLength(0);

    el.setAttribute("show-toolbar", "false");
    await settle();
    expect(FakeCalendar.instances).toHaveLength(0);
    // Still shows the error rather than a blank widget.
    expect(textLength(el)).toBeGreaterThan(0);
  });
});
