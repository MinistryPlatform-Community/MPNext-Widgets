import { MPNextWidget } from "../shared/base-widget";
import {
  buildGoogleCalendarUrl,
  buildIcsContent,
  buildOutlookUrl,
  buildYahooCalendarUrl,
  icsFileName,
  type CalendarEventInput,
} from "../shared/calendar-links";

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
  /** IANA zone of the MP domain. Optional: older API deployments omit it. */
  Time_Zone?: string | null;
}

// ── Constants ──────────────────────────────────────────────────────────────

const BRAND = {
  blue: "#004C97",
  navy: "#002855",
  green: "#86AD3F",
  red: "#FF6D6A",
  gold: "#F1BE48",
  lightBlue: "#009CDE",
  black: "#2D2926",
};

type ProviderId = "google" | "apple" | "outlook" | "office365" | "yahoo" | "ics";

interface Provider {
  id: ProviderId;
  label: string;
  /** Inline SVG markup for a 16x16 icon on a 24-unit viewBox. */
  icon: string;
  /**
   * Brand marks (Apple, Microsoft) are solid shapes and only read correctly
   * filled; the rest are line icons matching the widget's other SVGs.
   */
  filled?: boolean;
  /** ICS providers download a file; the rest open a URL in a new tab. */
  kind: "url" | "download";
}

/**
 * Apple Calendar, Outlook desktop and "everything else" all consume the same
 * `.ics` file — they are separate entries only because a visitor looking for
 * "Apple Calendar" will not recognise ".ics" as the thing that serves them.
 *
 * The five `label`s below are product names and read the same in every
 * language. Only the `ics` row is prose, so it is the one label resolved
 * through the catalogue — see `providerLabel`.
 */
const PROVIDERS: Record<ProviderId, Provider> = {
  google: {
    id: "google",
    label: "Google Calendar",
    kind: "url",
    icon: `<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>`,
  },
  apple: {
    id: "apple",
    label: "Apple Calendar",
    kind: "download",
    filled: true,
    icon: `<path d="M17.05 12.04c-.02-2.3 1.87-3.4 1.95-3.45-1.06-1.56-2.72-1.77-3.3-1.79-1.41-.14-2.75.83-3.47.83-.72 0-1.82-.81-3-.79-1.54.02-2.96.9-3.75 2.28-1.6 2.78-.41 6.9 1.15 9.16.76 1.1 1.67 2.33 2.87 2.29 1.15-.05 1.59-.74 2.98-.74 1.39 0 1.78.74 2.99.72 1.24-.02 2.03-1.13 2.79-2.23.87-1.27 1.23-2.5 1.25-2.56-.03-.01-2.4-.92-2.41-3.72zM14.6 5.2c.63-.76 1.05-1.82.94-2.87-.93.04-2.05.62-2.7 1.38-.58.67-1.09 1.75-.95 2.78 1.03.08 2.08-.53 2.71-1.29z"/>`,
  },
  outlook: {
    id: "outlook",
    label: "Outlook.com",
    kind: "url",
    icon: `<rect x="2" y="5" width="20" height="14" rx="2"/><polyline points="2.5 6.5 12 13 21.5 6.5"/>`,
  },
  office365: {
    id: "office365",
    label: "Microsoft 365",
    kind: "url",
    filled: true,
    icon: `<rect x="3" y="3" width="8" height="8"/><rect x="13" y="3" width="8" height="8"/><rect x="3" y="13" width="8" height="8"/><rect x="13" y="13" width="8" height="8"/>`,
  },
  yahoo: {
    id: "yahoo",
    label: "Yahoo Calendar",
    kind: "url",
    icon: `<polyline points="4 6 11 14 11 19"/><line x1="18" y1="6" x2="11" y2="14"/><circle cx="18" cy="17.5" r="1.2"/>`,
  },
  ics: {
    id: "ics",
    label: "Other (.ics file)",
    kind: "download",
    icon: `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>`,
  },
};

const DEFAULT_PROVIDERS: ProviderId[] = ["google", "apple", "outlook", "yahoo", "ics"];

// ── Helpers ────────────────────────────────────────────────────────────────

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

// ── Widget State ───────────────────────────────────────────────────────────

interface AddToCalendarState {
  loading: boolean;
  error: string | null;
  event: CalendarEventData | null;
  open: boolean;
}

// ── Web Component ──────────────────────────────────────────────────────────

export class AddToCalendarWidget extends MPNextWidget {
  private state: AddToCalendarState = {
    loading: true,
    error: null,
    event: null,
    open: false,
  };

  private eventId: number;
  private providers: ProviderId[];
  private onDocumentPointerDown = (e: Event) => {
    // `composedPath` rather than `contains`: a click inside our Shadow DOM is
    // retargeted to the host, so `e.target` alone cannot tell inside from out.
    if (!e.composedPath().includes(this)) this.close();
  };
  private onDocumentKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.state.open) {
      this.close();
      this.root.querySelector<HTMLButtonElement>(".atc-trigger")?.focus();
    }
  };

  constructor() {
    super();
    this.eventId = parseInt(this.getAttribute("event-id") || "0", 10);
    this.providers = this.parseProviders(this.getAttribute("providers"));
  }

  async connectedCallback() {
    this.injectStyles(this.getStyles());
    // Await the catalogue before the first paint so a Spanish visitor never
    // sees the loading line and the button label in English first.
    await this.initLocale();
    this.render();
    document.addEventListener("pointerdown", this.onDocumentPointerDown, true);
    document.addEventListener("keydown", this.onDocumentKeyDown);
    await this.loadEvent();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("pointerdown", this.onDocumentPointerDown, true);
    document.removeEventListener("keydown", this.onDocumentKeyDown);
  }

  /**
   * `providers="google,apple"` narrows the menu. Unknown ids are dropped, and
   * an empty result falls back to the default set rather than rendering a menu
   * with nothing in it.
   */
  private parseProviders(attr: string | null): ProviderId[] {
    if (!attr) return DEFAULT_PROVIDERS;
    const requested = attr
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s): s is ProviderId => s in PROVIDERS);
    return requested.length ? requested : DEFAULT_PROVIDERS;
  }

  // ── Data Loading ──────────────────────────────────────────────────────

  private async loadEvent(): Promise<void> {
    if (!this.eventId || this.eventId <= 0) {
      this.state.loading = false;
      // A misconfigured embed. The visitor reads a sentence about the link;
      // the detail a site owner needs goes to the console, not to the page.
      console.warn(
        "[mpnext] <next-add-to-calendar> needs a positive numeric event-id attribute.",
      );
      this.state.error = this.t("addToCalendar.notConfigured");
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
        throw new Error(this.errorText(body));
      }

      const eventData: CalendarEventData = await res.json();
      this.state.event = eventData;
      this.state.loading = false;
      this.render();
      this.emit("calendarEventLoaded", { eventId: eventData.Event_ID, title: eventData.Event_Title });
    } catch (err) {
      this.state.loading = false;
      // `errorText` has already produced a translated sentence; anything else
      // (a dropped connection) becomes the generic network message.
      this.state.error =
        err instanceof Error ? err.message : this.t("errors.network");
      this.render();
      this.emit("addToCalendarError", { error: this.state.error });
    }
  }

  // ── Calendar payload ──────────────────────────────────────────────────

  /**
   * The zone the MP wall-clock values are in. `time-zone` on the element wins,
   * then whatever the API reported for the domain. The last resort is the
   * visitor's own zone: wrong for a visitor browsing from another zone, but it
   * is the only guess available and it is correct for the common case.
   */
  private resolveTimeZone(event: CalendarEventData): string {
    const attr = this.getAttribute("time-zone");
    if (attr) return attr;
    if (event.Time_Zone) return event.Time_Zone;
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  }

  private toCalendarInput(event: CalendarEventData): CalendarEventInput {
    return {
      title: event.Event_Title,
      start: event.Event_Start_Date,
      end: event.Event_End_Date,
      timeZone: this.resolveTimeZone(event),
      description: event.Description,
      location: buildLocation(event) || null,
      uid: `next-event-${event.Event_ID}@mpnext.church`,
    };
  }

  private providerUrl(id: ProviderId, input: CalendarEventInput): string | null {
    switch (id) {
      case "google":
        return buildGoogleCalendarUrl(input);
      case "outlook":
        return buildOutlookUrl(input, "live");
      case "office365":
        return buildOutlookUrl(input, "office");
      case "yahoo":
        return buildYahooCalendarUrl(input);
      default:
        return null;
    }
  }

  private downloadIcs(input: CalendarEventInput): void {
    const blob = new Blob([buildIcsContent(input)], {
      type: "text/calendar;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = icsFileName(input.title);
    anchor.style.display = "none";
    // The anchor must live in the host document, not our Shadow DOM: a
    // programmatic click on a detached node does not trigger a download.
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  private selectProvider(id: ProviderId): void {
    if (!this.state.event) return;
    const input = this.toCalendarInput(this.state.event);

    try {
      if (PROVIDERS[id].kind === "download") {
        this.downloadIcs(input);
      } else {
        const url = this.providerUrl(id, input);
        if (url) window.open(url, "_blank", "noopener,noreferrer");
      }
      this.emit("calendarProviderSelected", {
        provider: id,
        eventId: this.state.event.Event_ID,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : this.t("addToCalendar.buildFailed");
      this.state.error = message;
      this.emit("addToCalendarError", { error: message });
      this.render();
      return;
    }

    this.close();
  }

  // ── Menu open/close ───────────────────────────────────────────────────

  private open(): void {
    if (this.state.open) return;
    this.state.open = true;
    this.render();
    this.root.querySelector<HTMLButtonElement>(".atc-option")?.focus();
  }

  private close(): void {
    if (!this.state.open) return;
    this.state.open = false;
    this.render();
  }

  private toggle(): void {
    if (this.state.open) this.close();
    else this.open();
  }

  /** The visitor-facing name of one provider row. */
  private providerLabel(provider: Provider): string {
    return provider.id === "ics"
      ? this.t("addToCalendar.otherIcs")
      : provider.label;
  }

  /** Roving focus through the menu with the arrow keys, wrapping at both ends. */
  private moveFocus(from: HTMLElement, delta: number): void {
    const options = Array.from(
      this.root.querySelectorAll<HTMLButtonElement>(".atc-option")
    );
    const index = options.indexOf(from as HTMLButtonElement);
    if (index === -1) return;
    const next = options[(index + delta + options.length) % options.length];
    next?.focus();
  }

  // ── Render ────────────────────────────────────────────────────────────

  render(): void {
    // Clear content area (keep styles)
    const existing = this.root.querySelector(".nw-atc-root");
    if (existing) existing.remove();

    const wrapper = document.createElement("div");
    wrapper.className = "nw-atc-root";

    if (this.state.loading) {
      wrapper.innerHTML = this.loadingTemplate();
    } else if (this.state.error) {
      wrapper.innerHTML = this.errorTemplate(this.state.error);
    } else if (this.state.event) {
      this.renderPicker(wrapper, this.state.event);
    }

    this.root.appendChild(wrapper);
  }

  private renderPicker(container: HTMLElement, event: CalendarEventData): void {
    const picker = document.createElement("div");
    picker.className = "atc-picker";

    const trigger = document.createElement("button");
    trigger.className = "atc-trigger";
    trigger.type = "button";
    trigger.setAttribute("aria-haspopup", "true");
    trigger.setAttribute("aria-expanded", String(this.state.open));
    trigger.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="18" rx="2"></rect>
        <line x1="16" y1="2" x2="16" y2="6"></line>
        <line x1="8" y1="2" x2="8" y2="6"></line>
        <line x1="3" y1="10" x2="21" y2="10"></line>
      </svg>
      <span>${this.escapeHtml(this.t("addToCalendar.trigger"))}</span>
      <svg class="atc-chevron" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    `;
    trigger.addEventListener("click", () => this.toggle());
    trigger.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this.open();
      }
    });
    picker.appendChild(trigger);

    if (this.state.open) {
      const menu = document.createElement("div");
      menu.className = "atc-menu";
      menu.setAttribute("role", "menu");
      menu.setAttribute(
        "aria-label",
        this.t("addToCalendar.menuLabel", { title: event.Event_Title })
      );

      for (const id of this.providers) {
        const provider = PROVIDERS[id];
        const option = document.createElement("button");
        option.className = "atc-option";
        option.type = "button";
        option.setAttribute("role", "menuitem");
        option.dataset.provider = id;
        const paint = provider.filled
          ? `fill="currentColor" stroke="none"`
          : `fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"`;
        option.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" ${paint} aria-hidden="true">${provider.icon}</svg>
          <span>${this.escapeHtml(this.providerLabel(provider))}</span>
        `;
        option.addEventListener("click", () => this.selectProvider(id));
        option.addEventListener("keydown", (e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            this.moveFocus(option, 1);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            this.moveFocus(option, -1);
          }
        });
        menu.appendChild(option);
      }

      picker.appendChild(menu);
    }

    container.appendChild(picker);
    container.appendChild(this.buildSummary(event));
  }

  /**
   * Title / date / location line under the button. The library used to swallow
   * this into its own dropdown header; showing it inline means the visitor can
   * confirm what they are about to add before opening the menu.
   */
  private buildSummary(event: CalendarEventData): HTMLElement {
    const summary = document.createElement("div");
    summary.className = "atc-summary";

    const title = document.createElement("div");
    title.className = "atc-summary-title";
    title.textContent = event.Event_Title;
    summary.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "atc-summary-meta";
    // No `timeZone`, as before: `fmt.dateRange` reads the MP wall clock
    // directly, so the displayed time stays the church's local time whatever
    // zone the visitor is in. It also collapses the repeated date on a
    // same-day event, which the three formatters this replaces did not.
    //
    // `weekdayMedium` carries the weekday *and* the year, matching what the
    // three deleted formatters produced. Both matter on a line confirming what
    // is about to land in the visitor's calendar: the weekday is how people
    // actually place an event, and the year rules out next April.
    meta.textContent = this.fmt.dateRange(
      event.Event_Start_Date,
      event.Event_End_Date,
      "weekdayMedium"
    );
    summary.appendChild(meta);

    const location = buildLocation(event);
    if (location) {
      const loc = document.createElement("div");
      loc.className = "atc-summary-location";
      loc.textContent = location;
      summary.appendChild(loc);
    }

    return summary;
  }

  // ── Template Helpers ──────────────────────────────────────────────────

  private loadingTemplate(): string {
    return `
      <div class="nw-atc-loading" aria-live="polite" aria-busy="true">
        <div class="nw-atc-spinner"></div>
        <span>${this.escapeHtml(this.t("addToCalendar.loading"))}</span>
      </div>
    `;
  }

  private errorTemplate(message: string): string {
    return `
      <div class="nw-atc-error" role="alert">
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

      .nw-atc-root {
        display: block;
      }

      /* ── Loading ── */
      .nw-atc-loading {
        display: flex;
        align-items: center;
        gap: 10px;
        color: #6b7280;
        font-size: 14px;
        padding: 12px 0;
      }

      .nw-atc-spinner {
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
      .nw-atc-error {
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

      .nw-atc-error svg {
        flex-shrink: 0;
      }

      /* ── Picker ── */
      .atc-picker {
        position: relative;
        display: inline-block;
      }

      .atc-trigger {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 10px 18px;
        background: ${BRAND.blue};
        color: #fff;
        border: none;
        border-radius: 9999px;
        font-family: inherit;
        font-size: 14px;
        font-weight: 600;
        line-height: 1;
        cursor: pointer;
        transition: background 0.2s ease;
      }

      .atc-trigger:hover {
        background: ${BRAND.navy};
      }

      .atc-trigger:focus-visible {
        outline: 2px solid ${BRAND.lightBlue};
        outline-offset: 2px;
      }

      .atc-trigger svg {
        flex-shrink: 0;
      }

      .atc-trigger[aria-expanded="true"] .atc-chevron {
        transform: rotate(180deg);
      }

      .atc-chevron {
        transition: transform 0.2s ease;
      }

      /* ── Menu ── */
      .atc-menu {
        position: absolute;
        top: calc(100% + 6px);
        left: 0;
        z-index: 50;
        min-width: 220px;
        padding: 6px;
        background: #fff;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.12);
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .atc-option {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        padding: 9px 12px;
        background: transparent;
        border: none;
        border-radius: 7px;
        font-family: inherit;
        font-size: 14px;
        color: ${BRAND.black};
        text-align: left;
        cursor: pointer;
      }

      .atc-option:hover,
      .atc-option:focus-visible {
        background: #f3f4f6;
        outline: none;
      }

      .atc-option:focus-visible {
        box-shadow: inset 0 0 0 2px ${BRAND.lightBlue};
      }

      .atc-option svg {
        flex-shrink: 0;
        color: ${BRAND.blue};
      }

      /* ── Summary ── */
      .atc-summary {
        margin-top: 12px;
        font-size: 13px;
        line-height: 1.5;
      }

      .atc-summary-title {
        font-size: 15px;
        font-weight: 600;
        color: ${BRAND.navy};
      }

      .atc-summary-meta {
        color: #4b5563;
        font-weight: 500;
      }

      .atc-summary-location {
        color: #6b7280;
      }
    `;
  }
}

customElements.define("next-add-to-calendar", AddToCalendarWidget);
