import { MPNextWidget } from "../shared/base-widget";
import { loadScript } from "../shared/cdn-loader";
import { ALL_STYLES } from "./full-calendar-styles";
import {
  renderFilterChips,
  filterEvents,
  renderCardsGrid,
  type CalendarEvent,
  type CalendarFilter,
  type ActiveFilters,
} from "./full-calendar-cards";
import {
  renderMiniCalendar,
  buildEventCountMap,
  getDensityDotCount,
  type EventCountMap,
} from "./full-calendar-mini-cal";
import { renderDetailModal } from "./full-calendar-modal";
import { renderAgendaList } from "./full-calendar-list";

// ── Constants ──

const FC_VERSION = "6.1.15";
const FC_CDN_BASE = `https://cdn.jsdelivr.net/npm/fullcalendar@${FC_VERSION}`;
const CARDS_PAGE_SIZE = 12;

type ViewType = "month" | "grid" | "week" | "list" | "cards" | "calendar";

// ── Widget ──

export class FullCalendarWidget extends MPNextWidget {
  private calendarEl: HTMLElement | null = null;
  private calendarInstance: any = null;
  private loading = true;
  private error: string | null = null;
  private congregationId: string = "";
  private currentView: ViewType = "month";
  private showToolbar: boolean = true;
  private isAdmin: boolean = false;
  private allEvents: CalendarEvent[] = [];
  private eventCountsByDate: EventCountMap = {};
  private cardsPage: number = 1;
  private miniCalMonth: Date = new Date();
  private selectedDate: string | null = null;
  private filters: { campuses: CalendarFilter[]; ministries: CalendarFilter[] } = {
    campuses: [],
    ministries: [],
  };
  private activeFilters: ActiveFilters = {
    campusIds: new Set(),
    ministryNames: new Set(),
  };
  private fcLoaded = false;

  static get observedAttributes() {
    return ["api-host", "congregation-id", "view", "show-toolbar"];
  }

  async connectedCallback() {
    this.congregationId = this.getAttribute("congregation-id") || "";

    // Read view/toolbar attributes
    const viewAttr = this.getAttribute("view") as ViewType | null;
    if (viewAttr && ["month", "grid", "week", "list", "cards", "calendar"].includes(viewAttr)) {
      this.currentView = viewAttr;
    }
    const toolbarAttr = this.getAttribute("show-toolbar");
    if (toolbarAttr === "false") {
      this.showToolbar = false;
    }

    // Inject styles and show loading state
    this.injectStyles(ALL_STYLES);
    this.render();

    try {
      if (this.needsFullCalendar()) {
        await this.loadFullCalendar();
      }
      this.loading = false;
      this.render();

      if (this.needsFullCalendar()) {
        this.initCalendar();
      } else {
        await this.loadCardsData();
      }
    } catch (err) {
      console.error("FullCalendarWidget: Failed to initialize:", err);
      this.error = "Failed to load calendar. Please refresh the page.";
      this.loading = false;
      this.render();
      this.emit("fullCalendarError", {
        error: this.error,
        raw: err instanceof Error ? err.message : String(err),
      });
    }
  }

  disconnectedCallback() {
    this.destroyCalendar();
  }

  attributeChangedCallback(name: string, _old: string | null, next: string | null) {
    if (name === "congregation-id") {
      this.congregationId = next || "";
      if (this.calendarInstance) {
        this.calendarInstance.refetchEvents();
      }
      if (["month", "list", "cards", "calendar"].includes(this.currentView)) {
        this.loadCardsData();
      }
    } else if (name === "view") {
      const v = next as ViewType;
      if (v && ["month", "grid", "week", "list", "cards", "calendar"].includes(v)) {
        this.switchView(v);
      }
    } else if (name === "show-toolbar") {
      this.showToolbar = next !== "false";
      this.render();
      this.rebuildCurrentView();
    }
  }

  // ── View Helpers ──

  private needsFullCalendar(): boolean {
    return this.currentView === "week" || this.currentView === "grid";
  }

  private async loadFullCalendar(): Promise<void> {
    if (this.fcLoaded) return;
    await loadScript(`${FC_CDN_BASE}/index.global.min.js`);
    this.fcLoaded = true;
  }

  private destroyCalendar(): void {
    if (this.calendarInstance) {
      try {
        this.calendarInstance.destroy();
      } catch {
        // Ignore destroy errors
      }
      this.calendarInstance = null;
    }
  }

  // ── View Switching ──

  private async switchView(view: ViewType): Promise<void> {
    if (view === this.currentView) return;

    const wasFC = this.needsFullCalendar();
    this.currentView = view;
    const nowFC = this.needsFullCalendar();

    if (wasFC && !nowFC) {
      // Switching FROM FC to cards/calendar — destroy FC
      this.destroyCalendar();
      this.render();
      await this.loadCardsData();
    } else if (!wasFC && nowFC) {
      // Switching FROM cards/calendar to FC — need to load FC
      this.loading = true;
      this.render();
      try {
        await this.loadFullCalendar();
        this.loading = false;
        this.render();
        this.adoptCalendarStyles();
        this.initCalendar();
      } catch (err) {
        this.error = "Failed to load calendar library.";
        this.loading = false;
        this.render();
      }
    } else if (wasFC && nowFC) {
      // Switching between FC views
      const fcViewMap: Record<string, string> = {
        grid: "dayGridMonth",
        week: "timeGridWeek",
      };
      this.calendarInstance?.changeView(fcViewMap[view]);
      this.updateToolbarActiveState();
    } else {
      // Switching between cards/calendar
      this.render();
      this.renderCardsOrCalendarView();
    }

    this.emit("viewChanged", { view });
  }

  // ── Calendar CSS ──

  private adoptCalendarStyles(): void {
    const headStyles = document.querySelectorAll("head style");
    for (const style of headStyles) {
      const text = style.textContent || "";
      if (text.includes(".fc") || text.includes("fc-")) {
        const clone = style.cloneNode(true) as HTMLStyleElement;
        this.root.appendChild(clone);
      }
    }
  }

  // ── Calendar Initialization ──

  private initCalendar(): void {
    const FC = (window as any).FullCalendar;
    if (!FC) {
      this.error = "FullCalendar library not available.";
      this.render();
      return;
    }

    this.adoptCalendarStyles();

    this.calendarEl = this.root.querySelector<HTMLElement>("#nw-fc-mount");
    if (!this.calendarEl) return;

    const fcViewMap: Record<string, string> = {
      grid: "dayGridMonth",
      week: "timeGridWeek",
    };

    this.calendarInstance = new FC.Calendar(this.calendarEl, {
      initialView: fcViewMap[this.currentView] || "dayGridMonth",
      headerToolbar: false, // We use our own custom toolbar
      events: (
        info: { startStr: string; endStr: string },
        successCallback: (events: object[]) => void,
        failureCallback: (error: Error) => void
      ) => {
        this.fetchEvents(info.startStr, info.endStr)
          .then(successCallback)
          .catch(failureCallback);
      },
      eventClick: (info: { event: any }) => {
        const raw: CalendarEvent = info.event.extendedProps._raw;
        this.showEventModal(raw, info.event);
      },
      eventColor: "#004C97",
      height: "auto",
      nowIndicator: true,
      dayMaxEvents: 4,
      eventTimeFormat: {
        hour: "numeric",
        minute: "2-digit",
        meridiem: "short",
      },
      datesSet: (info: { view: { title: string } }) => {
        this.updateToolbarTitle(info.view.title);
      },
      dayCellDidMount: (info: { date: Date; el: HTMLElement }) => {
        // Only add density dots on week view; grid view already shows events
        if (this.currentView !== "grid") {
          this.addDensityDots(info.date, info.el);
        }
      },
    });

    this.calendarInstance.render();
  }

  // ── Density Dots on FC Month View ──

  private addDensityDots(date: Date, cell: HTMLElement): void {
    const key = this.toDateKey(date);
    const count = this.eventCountsByDate[key] || 0;
    const dotCount = getDensityDotCount(count);
    if (dotCount === 0) return;

    // Remove existing dots
    const existing = cell.querySelector(".nw-fc-density-dots");
    if (existing) existing.remove();

    const dotsDiv = document.createElement("div");
    dotsDiv.className = "nw-fc-density-dots";
    dotsDiv.style.cssText = "display:flex;gap:2px;justify-content:center;padding:2px 0;";

    for (let i = 0; i < dotCount; i++) {
      const dot = document.createElement("span");
      dot.className = "nw-fc-density-dot";
      dot.style.cssText =
        "width:5px;height:5px;border-radius:50%;background:#002855;display:inline-block;";
      dotsDiv.appendChild(dot);
    }

    // Find the day frame to append dots
    const frame = cell.querySelector(".fc-daygrid-day-frame");
    if (frame) {
      frame.appendChild(dotsDiv);
    }
  }

  // ── Data Fetching ──

  private async fetchEvents(start: string, end: string): Promise<object[]> {
    const params = new URLSearchParams({ start, end });
    if (this.congregationId) {
      params.set("congregationId", this.congregationId);
    }

    const res = await this.fetch(`/api/embed/full-calendar?${params}`);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const msg = body.error || `HTTP ${res.status}`;
      this.emit("fullCalendarError", { error: msg });
      throw new Error(msg);
    }

    const data = await res.json();
    const events: CalendarEvent[] = data.events || [];
    this.isAdmin = data.isAdmin || false;

    // Store filters if present
    if (data.filters) {
      this.filters = data.filters;
    }

    // Store events for density dots on FC views
    this.allEvents = events;
    this.eventCountsByDate = buildEventCountMap(events);

    this.emit("calendarLoaded", { count: events.length });

    return events.map((e) => ({
      id: String(e.Event_ID),
      title: e.Event_Title,
      start: e.Event_Start_Date,
      end: e.Event_End_Date,
      color: this.getEventColor(e.Event_Type_ID),
      extendedProps: {
        description: e.Description,
        location: e.Location_Name,
        congregation: e.Congregation_Name,
        eventType: e.Event_Type,
        featured: e.Featured_On_Calendar,
        _raw: e,
      },
    }));
  }

  private async loadCardsData(): Promise<void> {
    try {
      // Fetch current month + 2 months ahead
      const start = new Date();
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 3);

      const params = new URLSearchParams({
        start: start.toISOString(),
        end: end.toISOString(),
      });
      if (this.congregationId) {
        params.set("congregationId", this.congregationId);
      }

      const res = await this.fetch(`/api/embed/full-calendar?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      this.allEvents = data.events || [];
      this.isAdmin = data.isAdmin || false;
      if (data.filters) {
        this.filters = data.filters;
      }
      this.eventCountsByDate = buildEventCountMap(this.allEvents);

      this.emit("calendarLoaded", { count: this.allEvents.length });
      this.renderCardsOrCalendarView();
    } catch (err) {
      console.error("FullCalendarWidget: Failed to load cards data:", err);
      this.emit("fullCalendarError", {
        error: err instanceof Error ? err.message : "Failed to load events",
      });
    }
  }

  // ── Event Color Coding ──

  private getEventColor(typeId: number | null): string {
    const colors: Record<number, string> = {
      1: "#004C97",
      2: "#002855",
      3: "#F1BE48",
      4: "#009CDE",
      5: "#FF6D6A",
    };
    return colors[typeId ?? 0] || "#004C97";
  }

  // ── Event Modal ──

  private async showEventModal(raw: CalendarEvent, fcEvent?: any): Promise<void> {
    this.emit("eventSelected", {
      eventId: raw.Event_ID,
      title: raw.Event_Title,
    });

    // For admin users, fetch fresh detail with admin enrichment
    let event = raw;
    let isAdmin = this.isAdmin;

    if (this.isAdmin) {
      try {
        const res = await this.fetch(
          `/api/embed/full-calendar/${raw.Event_ID}`
        );
        if (res.ok) {
          const data = await res.json();
          event = data.event;
          isAdmin = data.isAdmin;
        }
      } catch {
        // Fall back to existing event data
      }
    }

    const fcEventObj = fcEvent
      ? { start: fcEvent.start, end: fcEvent.end }
      : {
          start: event.Event_Start_Date ? new Date(event.Event_Start_Date) : null,
          end: event.Event_End_Date ? new Date(event.Event_End_Date) : null,
        };

    // Remove existing modal if present
    const existing = this.root.querySelector(".nw-fc-modal-overlay");
    if (existing) existing.remove();

    const modal = renderDetailModal({
      event,
      fcEvent: fcEventObj,
      isAdmin,
      onClose: () => this.closeModal(),
      getEventColor: (typeId) => this.getEventColor(typeId),
    });

    this.root.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add("nw-fc-modal-visible"));
  }

  private closeModal(): void {
    const overlay = this.root.querySelector<HTMLElement>(".nw-fc-modal-overlay");
    if (overlay) {
      overlay.classList.remove("nw-fc-modal-visible");
      overlay.addEventListener("transitionend", () => overlay.remove(), { once: true });
    }
  }

  // ── Toolbar ──

  private renderToolbar(): string {
    if (!this.showToolbar) return "";

    const views: { key: ViewType; label: string }[] = [
      { key: "month", label: "Month" },
      { key: "grid", label: "Grid" },
      { key: "week", label: "Week" },
      { key: "list", label: "List" },
      { key: "cards", label: "Cards" },
      { key: "calendar", label: "Calendar" },
    ];

    const viewButtons = views
      .map(
        (v) =>
          `<button class="nw-fc-toolbar-btn${v.key === this.currentView ? " active" : ""}" data-view="${v.key}">${v.label}</button>`
      )
      .join("");

    return `
      <div class="nw-fc-toolbar">
        <div class="nw-fc-toolbar-left">
          <button class="nw-fc-toolbar-nav" data-action="prev" aria-label="Previous">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <button class="nw-fc-toolbar-nav" data-action="next" aria-label="Next">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
          <button class="nw-fc-toolbar-btn" data-action="today">Today</button>
        </div>
        <div class="nw-fc-toolbar-center" id="nw-fc-title"></div>
        <div class="nw-fc-toolbar-right">
          ${viewButtons}
        </div>
      </div>
    `;
  }

  private bindToolbarEvents(): void {
    const toolbar = this.root.querySelector(".nw-fc-toolbar");
    if (!toolbar) return;

    toolbar.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest("button");
      if (!btn) return;

      const action = btn.dataset.action;
      const view = btn.dataset.view as ViewType;

      if (action === "prev") this.handleToolbarPrev();
      else if (action === "next") this.handleToolbarNext();
      else if (action === "today") this.handleToolbarToday();
      else if (view) this.switchView(view);
    });
  }

  private handleToolbarPrev(): void {
    if (this.needsFullCalendar() && this.calendarInstance) {
      this.calendarInstance.prev();
    } else {
      this.miniCalMonth = new Date(
        this.miniCalMonth.getFullYear(),
        this.miniCalMonth.getMonth() - 1,
        1
      );
      this.renderCardsOrCalendarView();
    }
  }

  private handleToolbarNext(): void {
    if (this.needsFullCalendar() && this.calendarInstance) {
      this.calendarInstance.next();
    } else {
      this.miniCalMonth = new Date(
        this.miniCalMonth.getFullYear(),
        this.miniCalMonth.getMonth() + 1,
        1
      );
      this.renderCardsOrCalendarView();
    }
  }

  private handleToolbarToday(): void {
    if (this.needsFullCalendar() && this.calendarInstance) {
      this.calendarInstance.today();
    } else {
      this.miniCalMonth = new Date();
      this.selectedDate = null;
      this.renderCardsOrCalendarView();
    }
  }

  private updateToolbarTitle(title: string): void {
    const el = this.root.querySelector<HTMLElement>("#nw-fc-title");
    if (el) el.textContent = title;
  }

  private updateToolbarActiveState(): void {
    const btns = this.root.querySelectorAll<HTMLElement>(".nw-fc-toolbar-btn[data-view]");
    btns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.view === this.currentView);
    });
  }

  // ── Cards/Calendar View Rendering ──

  private renderCardsOrCalendarView(): void {
    const container = this.root.querySelector<HTMLElement>(".nw-fc-container");
    if (!container) return;

    // Clear mount point area
    const mount = container.querySelector("#nw-fc-cards-area");
    if (mount) mount.remove();

    const area = document.createElement("div");
    area.id = "nw-fc-cards-area";

    // Get filtered events
    const filtered = filterEvents(this.allEvents, this.activeFilters);

    // Further filter by selected date if applicable
    let displayEvents = filtered;
    if (this.selectedDate) {
      displayEvents = filtered.filter((e) => {
        const eventDate = e.Event_Start_Date.slice(0, 10);
        return eventDate === this.selectedDate;
      });
    }

    // Update title for cards views
    const title = this.miniCalMonth.toLocaleString("en-US", {
      month: "long",
      year: "numeric",
    });
    this.updateToolbarTitle(title);

    if (this.currentView === "month") {
      // Full-width mini calendar + card grid below
      const monthPanel = document.createElement("div");
      monthPanel.className = "nw-fc-month-layout";

      monthPanel.appendChild(
        renderMiniCalendar({
          currentMonth: this.miniCalMonth,
          eventsByDate: this.eventCountsByDate,
          selectedDate: this.selectedDate,
          onDateClick: (dateKey) => {
            this.selectedDate = this.selectedDate === dateKey ? null : dateKey;
            this.cardsPage = 1;
            this.renderCardsOrCalendarView();
          },
          onMonthChange: (newMonth) => {
            this.miniCalMonth = newMonth;
            this.renderCardsOrCalendarView();
          },
        })
      );

      if (this.filters.campuses.length > 0 || this.filters.ministries.length > 0) {
        monthPanel.appendChild(
          renderFilterChips(this.filters, this.activeFilters, (newFilters) => {
            this.activeFilters = newFilters;
            this.cardsPage = 1;
            this.renderCardsOrCalendarView();
          })
        );
      }

      monthPanel.appendChild(
        renderCardsGrid(
          displayEvents,
          this.cardsPage,
          (event) => this.showEventModal(event),
          () => {
            this.cardsPage++;
            this.renderCardsOrCalendarView();
          }
        )
      );

      area.appendChild(monthPanel);
    } else if (this.currentView === "list") {
      // Custom agenda list view — events grouped by date
      if (this.filters.campuses.length > 0 || this.filters.ministries.length > 0) {
        area.appendChild(
          renderFilterChips(this.filters, this.activeFilters, (newFilters) => {
            this.activeFilters = newFilters;
            this.renderCardsOrCalendarView();
          })
        );
      }

      area.appendChild(
        renderAgendaList(
          displayEvents,
          (event) => this.showEventModal(event),
          (typeId) => this.getEventColor(typeId)
        )
      );
    } else if (this.currentView === "cards") {
      // Filter chips + card grid
      if (this.filters.campuses.length > 0 || this.filters.ministries.length > 0) {
        area.appendChild(
          renderFilterChips(this.filters, this.activeFilters, (newFilters) => {
            this.activeFilters = newFilters;
            this.cardsPage = 1;
            this.renderCardsOrCalendarView();
          })
        );
      }

      area.appendChild(
        renderCardsGrid(
          displayEvents,
          this.cardsPage,
          (event) => this.showEventModal(event),
          () => {
            this.cardsPage++;
            this.renderCardsOrCalendarView();
          }
        )
      );
    } else if (this.currentView === "calendar") {
      // Split layout: mini calendar + cards
      const layout = document.createElement("div");
      layout.className = "nw-fc-split-layout";

      // Mini calendar panel
      const miniPanel = document.createElement("div");
      miniPanel.className = "nw-fc-mini-cal-panel";
      miniPanel.appendChild(
        renderMiniCalendar({
          currentMonth: this.miniCalMonth,
          eventsByDate: this.eventCountsByDate,
          selectedDate: this.selectedDate,
          onDateClick: (dateKey) => {
            this.selectedDate = this.selectedDate === dateKey ? null : dateKey;
            this.cardsPage = 1;
            this.renderCardsOrCalendarView();
          },
          onMonthChange: (newMonth) => {
            this.miniCalMonth = newMonth;
            this.renderCardsOrCalendarView();
          },
        })
      );
      layout.appendChild(miniPanel);

      // Cards panel with filters
      const cardsPanel = document.createElement("div");
      cardsPanel.className = "nw-fc-cards-panel";

      if (this.filters.campuses.length > 0 || this.filters.ministries.length > 0) {
        cardsPanel.appendChild(
          renderFilterChips(this.filters, this.activeFilters, (newFilters) => {
            this.activeFilters = newFilters;
            this.cardsPage = 1;
            this.renderCardsOrCalendarView();
          })
        );
      }

      cardsPanel.appendChild(
        renderCardsGrid(
          displayEvents,
          this.cardsPage,
          (event) => this.showEventModal(event),
          () => {
            this.cardsPage++;
            this.renderCardsOrCalendarView();
          }
        )
      );
      layout.appendChild(cardsPanel);

      area.appendChild(layout);
    }

    container.appendChild(area);
  }

  private rebuildCurrentView(): void {
    if (this.needsFullCalendar()) {
      if (this.calendarInstance) {
        this.calendarInstance.render();
      }
    } else {
      this.renderCardsOrCalendarView();
    }
  }

  // ── Utilities ──

  private toDateKey(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  // ── Render ──

  render(): void {
    const container = this.root.querySelector<HTMLElement>(".nw-fc-container");

    if (container) {
      container.innerHTML = this.renderInner();
    } else {
      const wrapper = document.createElement("div");
      wrapper.className = "nw-fc-container";
      wrapper.innerHTML = this.renderInner();
      this.root.appendChild(wrapper);
    }

    this.bindToolbarEvents();
  }

  private renderInner(): string {
    if (this.error) {
      return `
        ${this.renderToolbar()}
        <div class="nw-fc-state nw-fc-error">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <p>${this.escapeHtml(this.error)}</p>
        </div>
      `;
    }

    if (this.loading) {
      return `
        ${this.renderToolbar()}
        <div class="nw-fc-state nw-fc-loading">
          <div class="nw-fc-spinner"></div>
          <p>Loading calendar&hellip;</p>
        </div>
      `;
    }

    if (this.needsFullCalendar()) {
      return `
        ${this.renderToolbar()}
        <div id="nw-fc-mount" class="nw-fc-mount"></div>
      `;
    }

    // Cards/Calendar views — the card content is rendered separately via DOM manipulation
    return `
      ${this.renderToolbar()}
    `;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}

customElements.define("next-full-calendar", FullCalendarWidget);
