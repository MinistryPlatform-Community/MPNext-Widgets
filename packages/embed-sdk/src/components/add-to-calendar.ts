import { MPNextWidget } from "../shared/base-widget";
import { loadScript } from "../shared/cdn-loader";

// ── Local types (mirrors @mpnext/types without importing) ───────────────
interface CalendarEventData {
  Event_ID: number;
  Event_Title: string;
  Description: string | null;
  Event_Start_Date: string;
  Event_End_Date: string;
  Location_Name: string | null;
  Address_Line_1: string | null;
  City: string | null;
  State: string | null;
  Postal_Code: string | null;
}

// ── Constants ──────────────────────────────────────────────────────────────

const ATCB_CDN_URL =
  "https://cdn.jsdelivr.net/npm/add-to-calendar-button@2/dist/atcb.min.js";

const BRAND = {
  blue: "#004C97",
  navy: "#002855",
  green: "#86AD3F",
  red: "#FF6D6A",
  gold: "#F1BE48",
  lightBlue: "#009CDE",
  black: "#2D2926",
};

// ── Helpers ────────────────────────────────────────────────────────────────

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/**
 * Parse an ISO datetime string and return { date: "YYYY-MM-DD", time: "HH:MM" }
 * without any timezone conversion — the raw values from MP are local time.
 */
function parseDateTime(isoString: string): { date: string; time: string } {
  const d = new Date(isoString);
  // Use UTC getters so we don't get browser TZ offset applied on top.
  // MP datetimes are stored without timezone info so we treat them as-is.
  const year = d.getUTCFullYear();
  const month = pad2(d.getUTCMonth() + 1);
  const day = pad2(d.getUTCDate());
  const hours = pad2(d.getUTCHours());
  const minutes = pad2(d.getUTCMinutes());
  return { date: `${year}-${month}-${day}`, time: `${hours}:${minutes}` };
}

/**
 * Build a human-readable location string from CalendarEventData.
 */
function buildLocation(event: CalendarEventData): string {
  const parts: string[] = [];
  if (event.Location_Name) parts.push(event.Location_Name);
  if (event.Address_Line_1) parts.push(event.Address_Line_1);

  const cityState: string[] = [];
  if (event.City) cityState.push(event.City);
  if (event.State) cityState.push(event.State);
  if (cityState.length) parts.push(cityState.join(", "));

  if (event.Postal_Code) parts.push(event.Postal_Code);
  return parts.join(", ");
}

/**
 * Generate ICS file content for a calendar event.
 */
function buildIcsContent(event: CalendarEventData): string {
  const start = parseDateTime(event.Event_Start_Date);
  const end = parseDateTime(event.Event_End_Date);

  const dtStart = `${start.date.replace(/-/g, "")}T${start.time.replace(":", "")}00`;
  const dtEnd = `${end.date.replace(/-/g, "")}T${end.time.replace(":", "")}00`;

  const uid = `next-event-${event.Event_ID}-${Date.now()}@mpnext.church`;
  const now = new Date();
  const dtStamp = `${now.getUTCFullYear()}${pad2(now.getUTCMonth() + 1)}${pad2(now.getUTCDate())}T${pad2(now.getUTCHours())}${pad2(now.getUTCMinutes())}${pad2(now.getUTCSeconds())}Z`;

  const location = buildLocation(event);
  const description = (event.Description || "").replace(/\n/g, "\\n");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//MPNext//Add to Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART;TZID=America/Chicago:${dtStart}`,
    `DTEND;TZID=America/Chicago:${dtEnd}`,
    `SUMMARY:${event.Event_Title}`,
    ...(description ? [`DESCRIPTION:${description}`] : []),
    ...(location ? [`LOCATION:${location}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

// ── Widget State ───────────────────────────────────────────────────────────

interface AddToCalendarState {
  loading: boolean;
  error: string | null;
  event: CalendarEventData | null;
  cdnLoaded: boolean;
}

// ── Web Component ──────────────────────────────────────────────────────────

export class AddToCalendarWidget extends MPNextWidget {
  private state: AddToCalendarState = {
    loading: true,
    error: null,
    event: null,
    cdnLoaded: false,
  };

  private eventId: number;

  constructor() {
    super();
    this.eventId = parseInt(this.getAttribute("event-id") || "0", 10);
  }

  async connectedCallback() {
    this.injectStyles(this.getStyles());
    this.renderLoading();
    await this.loadEvent();
  }

  // ── Data Loading ──────────────────────────────────────────────────────

  private async loadEvent(): Promise<void> {
    if (!this.eventId || this.eventId <= 0) {
      this.state.loading = false;
      this.state.error = "Missing or invalid event-id attribute.";
      this.render();
      this.emit("addToCalendarError", { error: this.state.error });
      return;
    }

    try {
      const res = await this.fetch(
        `/api/embed/add-to-calendar?eventId=${this.eventId}`
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body.error || `Failed to load event (HTTP ${res.status})`
        );
      }

      const eventData: CalendarEventData = await res.json();
      this.state.event = eventData;
      this.state.loading = false;

      // Try loading the CDN script concurrently with rendering the fallback
      try {
        await loadScript(ATCB_CDN_URL);
        this.state.cdnLoaded = true;
      } catch {
        // CDN failed — use ICS fallback
        this.state.cdnLoaded = false;
      }

      this.render();
      this.emit("calendarEventLoaded", { eventId: eventData.Event_ID, title: eventData.Event_Title });
    } catch (err) {
      this.state.loading = false;
      this.state.error =
        err instanceof Error ? err.message : "Failed to load event.";
      this.render();
      this.emit("addToCalendarError", { error: this.state.error });
    }
  }

  // ── Render ────────────────────────────────────────────────────────────

  render(): void {
    // Clear content area (keep styles)
    const existing = this.root.querySelector(".nw-atcb-root");
    if (existing) existing.remove();

    const wrapper = document.createElement("div");
    wrapper.className = "nw-atcb-root";

    if (this.state.loading) {
      wrapper.innerHTML = this.loadingTemplate();
    } else if (this.state.error) {
      wrapper.innerHTML = this.errorTemplate(this.state.error);
    } else if (this.state.event) {
      if (this.state.cdnLoaded) {
        this.renderAtcbButton(wrapper, this.state.event);
      } else {
        wrapper.appendChild(this.buildIcsFallback(this.state.event));
      }
    }

    this.root.appendChild(wrapper);
  }

  private renderLoading(): void {
    const existing = this.root.querySelector(".nw-atcb-root");
    if (existing) existing.remove();

    const wrapper = document.createElement("div");
    wrapper.className = "nw-atcb-root";
    wrapper.innerHTML = this.loadingTemplate();
    this.root.appendChild(wrapper);
  }

  /**
   * Create an <add-to-calendar-button> element programmatically so it works
   * inside Shadow DOM. The library v2 registers the custom element globally and
   * processes elements appended after load.
   */
  private renderAtcbButton(container: HTMLElement, event: CalendarEventData): void {
    const start = parseDateTime(event.Event_Start_Date);
    const end = parseDateTime(event.Event_End_Date);
    const location = buildLocation(event);

    const btn = document.createElement("add-to-calendar-button");
    btn.setAttribute("name", event.Event_Title);
    btn.setAttribute("startDate", start.date);
    btn.setAttribute("endDate", end.date);
    btn.setAttribute("startTime", start.time);
    btn.setAttribute("endTime", end.time);
    btn.setAttribute("timeZone", "America/Chicago");
    btn.setAttribute("options", "'Apple','Google','iCal','Outlook.com'");
    btn.setAttribute("buttonStyle", "flat");
    btn.setAttribute("lightMode", "bodyScheme");
    if (location) btn.setAttribute("location", location);
    if (event.Description) btn.setAttribute("description", event.Description);

    container.appendChild(btn);
  }

  /**
   * Fallback: render a download button that generates an .ics file on click.
   */
  private buildIcsFallback(event: CalendarEventData): HTMLElement {
    const start = parseDateTime(event.Event_Start_Date);
    const end = parseDateTime(event.Event_End_Date);

    const container = document.createElement("div");
    container.className = "ics-fallback";

    const header = document.createElement("div");
    header.className = "ics-header";
    header.innerHTML = `
      <span class="ics-icon" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
          <line x1="16" y1="2" x2="16" y2="6"></line>
          <line x1="8" y1="2" x2="8" y2="6"></line>
          <line x1="3" y1="10" x2="21" y2="10"></line>
        </svg>
      </span>
      <span class="ics-title">${this.escapeHtml(event.Event_Title)}</span>
    `;

    const meta = document.createElement("div");
    meta.className = "ics-meta";

    const dateText = start.date === end.date
      ? `${this.formatDateLabel(start.date)} &bull; ${this.formatTime(start.time)} &ndash; ${this.formatTime(end.time)}`
      : `${this.formatDateLabel(start.date)} ${this.formatTime(start.time)} &ndash; ${this.formatDateLabel(end.date)} ${this.formatTime(end.time)}`;
    meta.innerHTML = `<span class="ics-date">${dateText}</span>`;

    const location = buildLocation(event);
    if (location) {
      const loc = document.createElement("span");
      loc.className = "ics-location";
      loc.textContent = location;
      meta.appendChild(loc);
    }

    const btn = document.createElement("button");
    btn.className = "ics-download-btn";
    btn.type = "button";
    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
      Add to Calendar (.ics)
    `;

    btn.addEventListener("click", () => {
      this.downloadIcs(event);
    });

    container.appendChild(header);
    container.appendChild(meta);
    container.appendChild(btn);
    return container;
  }

  private downloadIcs(event: CalendarEventData): void {
    const icsContent = buildIcsContent(event);
    const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const filename = event.Event_Title.replace(/[^a-z0-9]/gi, "-").toLowerCase() + ".ics";

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ── Template Helpers ──────────────────────────────────────────────────

  private loadingTemplate(): string {
    return `
      <div class="nw-atcb-loading" aria-live="polite" aria-busy="true">
        <div class="nw-atcb-spinner"></div>
        <span>Loading event&hellip;</span>
      </div>
    `;
  }

  private errorTemplate(message: string): string {
    return `
      <div class="nw-atcb-error" role="alert">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <span>${this.escapeHtml(message)}</span>
      </div>
    `;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  private formatDateLabel(yyyyMmDd: string): string {
    const [year, month, day] = yyyyMmDd.split("-").map(Number);
    const d = new Date(year, month - 1, day);
    return d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  private formatTime(hhmm: string): string {
    const [hours, minutes] = hhmm.split(":").map(Number);
    const ampm = hours >= 12 ? "PM" : "AM";
    const h = hours % 12 || 12;
    return `${h}:${pad2(minutes)} ${ampm}`;
  }

  // ── Styles ────────────────────────────────────────────────────────────

  private getStyles(): string {
    return `
      :host {
        display: block;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
        color: ${BRAND.black};
        box-sizing: border-box;
      }

      *, *::before, *::after {
        box-sizing: inherit;
      }

      .nw-atcb-root {
        display: block;
      }

      /* ── Loading ── */
      .nw-atcb-loading {
        display: flex;
        align-items: center;
        gap: 10px;
        color: #6b7280;
        font-size: 14px;
        padding: 12px 0;
      }

      .nw-atcb-spinner {
        width: 18px;
        height: 18px;
        border: 2px solid #e5e7eb;
        border-top-color: ${BRAND.blue};
        border-radius: 50%;
        animation: nw-spin 0.7s linear infinite;
        flex-shrink: 0;
      }

      @keyframes nw-spin {
        to { transform: rotate(360deg); }
      }

      /* ── Error ── */
      .nw-atcb-error {
        display: flex;
        align-items: center;
        gap: 8px;
        background: #fff1f1;
        color: ${BRAND.red};
        border: 1px solid ${BRAND.red};
        border-radius: 8px;
        padding: 12px 16px;
        font-size: 14px;
      }

      .nw-atcb-error svg {
        flex-shrink: 0;
      }

      /* ── ICS Fallback ── */
      .ics-fallback {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 16px 20px;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        background: #fff;
        max-width: 480px;
      }

      .ics-header {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .ics-icon {
        color: ${BRAND.blue};
        flex-shrink: 0;
        display: flex;
        align-items: center;
      }

      .ics-title {
        font-size: 16px;
        font-weight: 600;
        color: ${BRAND.navy};
        line-height: 1.3;
      }

      .ics-meta {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 13px;
        color: #4b5563;
        padding-left: 30px;
      }

      .ics-date {
        font-weight: 500;
      }

      .ics-location {
        color: #6b7280;
      }

      .ics-download-btn {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin-top: 4px;
        padding: 10px 18px;
        background: ${BRAND.blue};
        color: #fff;
        border: none;
        border-radius: 9999px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.2s ease;
        align-self: flex-start;
        line-height: 1;
      }

      .ics-download-btn:hover {
        background: ${BRAND.navy};
      }

      .ics-download-btn:focus-visible {
        outline: 2px solid ${BRAND.lightBlue};
        outline-offset: 2px;
      }

      .ics-download-btn svg {
        flex-shrink: 0;
      }

      /* ── add-to-calendar-button overrides (light DOM, rendered in our Shadow) ── */
      add-to-calendar-button {
        --btn-background: ${BRAND.blue};
        --btn-hover-background: ${BRAND.navy};
        --btn-text: #ffffff;
        --btn-shadow: none;
        --btn-border: none;
        --btn-border-radius: 9999px;
        --font: ui-sans-serif, system-ui, sans-serif;
      }
    `;
  }
}

customElements.define("next-add-to-calendar", AddToCalendarWidget);
