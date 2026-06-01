import { MPNextWidget } from "../shared/base-widget";

interface EventSearchResult {
  id: number;
  title: string;
  description: string | null;
  imageUrl: string | null;
  location: string | null;
  startDate: string;
  endDate: string;
  featured: boolean;
}

interface FilterOption {
  id: number;
  name: string;
}

interface Configurations {
  congregations: FilterOption[];
  ministries: FilterOption[];
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * `next-event-finder` — public, filterable event search rendering result cards
 * that deep-link to an event-details page.
 *
 * Migrated from the legacy `mpp-event-finder` portal widget. Filters that the
 * legacy widget exposed as fixed attributes (congregation, ministry, month,
 * sign-up type, event type, featured, program, keyword, reduce-series) are all
 * supported; congregation/ministry/month/sign-up live behind an "Advanced
 * Search" toggle to match the legacy UX.
 */
export class EventFinderWidget extends MPNextWidget {
  private events: EventSearchResult[] = [];
  private config: Configurations = { congregations: [], ministries: [] };
  private loading = true;
  private error: string | null = null;
  private advancedOpen = false;

  // Filter state (seeded from attributes, mutated by the form).
  private keyword = "";
  private congregationId = "";
  private ministryId = "";
  private monthId = "";
  private signupType = "";

  static get observedAttributes() {
    return [
      "api-host",
      "target-url",
      "id-parameter-name",
      "congregation-id",
      "ministry-id",
      "month-id",
      "signup-type",
      "event-type-id",
      "featured",
      "program-id",
      "keyword",
      "reduce-series-to",
    ];
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null) {
    if (oldValue === newValue) return;
    // Re-seed and re-search when a filtering attribute changes after first load.
    if (this.events.length || !this.loading) {
      this.seedFromAttributes();
      this.search();
    }
  }

  connectedCallback() {
    this.injectStyles(this.getStyles());
    this.seedFromAttributes();
    this.render();
    this.init();
  }

  /** Public hook so demo pages can force a reload. */
  public retryLoad() {
    this.error = null;
    this.init();
  }

  private seedFromAttributes() {
    this.keyword = this.getAttribute("keyword") || "";
    this.congregationId = this.getAttribute("congregation-id") || "";
    this.ministryId = this.getAttribute("ministry-id") || "";
    this.monthId = this.getAttribute("month-id") || "";
    this.signupType = this.getAttribute("signup-type") || "";
  }

  private async init() {
    this.loading = true;
    this.error = null;
    this.render();

    try {
      await this.loadConfig();
    } catch {
      // Non-fatal: dropdowns just stay empty if config fails.
    }
    await this.search();
  }

  private async loadConfig() {
    const res = await this.fetch(`/api/embed/event-finder/config`);
    if (!res.ok) return;
    const data = await res.json();
    this.config = {
      congregations: data.congregations || [],
      ministries: data.ministries || [],
    };
  }

  private buildQuery(): string {
    const params = new URLSearchParams();
    if (this.keyword) params.set("keyword", this.keyword);
    if (this.congregationId) params.set("congregationId", this.congregationId);
    if (this.ministryId) params.set("ministryId", this.ministryId);
    if (this.monthId) params.set("monthId", this.monthId);
    if (this.signupType) params.set("signupType", this.signupType);

    const eventTypeId = this.getAttribute("event-type-id");
    if (eventTypeId) params.set("eventTypeId", eventTypeId);
    const programId = this.getAttribute("program-id");
    if (programId) params.set("programId", programId);
    const featured = this.getAttribute("featured");
    if (featured === "true") params.set("isFeatured", "true");
    const reduceSeriesTo = this.getAttribute("reduce-series-to");
    if (reduceSeriesTo) params.set("reduceSeriesTo", reduceSeriesTo);

    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }

  private async search() {
    this.loading = true;
    this.error = null;
    this.render();

    try {
      const res = await this.fetch(`/api/embed/event-finder${this.buildQuery()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data: { events: EventSearchResult[] } = await res.json();
      this.events = data.events || [];
      this.emit("eventsLoaded", { count: this.events.length });
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Failed to load events";
      this.emit("eventFinderError", { error: this.error });
    } finally {
      this.loading = false;
      this.render();
      this.attachListeners();
    }
  }

  // ── Detail link / selection ──

  private buildDetailUrl(eventId: number): string | null {
    const target = this.getAttribute("target-url");
    if (!target) return null;
    const idParam = this.getAttribute("id-parameter-name") || "id";
    try {
      const url = new URL(target, window.location.href);
      url.searchParams.set(idParam, String(eventId));
      return url.toString();
    } catch {
      const sep = target.includes("?") ? "&" : "?";
      return `${target}${sep}${idParam}=${eventId}`;
    }
  }

  // ── Listeners ──

  private attachListeners() {
    const form = this.root.querySelector<HTMLFormElement>("#ef-form");
    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        this.readFormState();
        this.search();
      });
    }

    const advancedLink = this.root.querySelector('[data-action="toggle-advanced"]');
    if (advancedLink) {
      advancedLink.addEventListener("click", (e) => {
        e.preventDefault();
        this.readFormState();
        this.advancedOpen = !this.advancedOpen;
        this.render();
        this.attachListeners();
      });
    }

    const retry = this.root.querySelector('[data-action="retry"]');
    if (retry) {
      retry.addEventListener("click", () => this.retryLoad());
    }

    // Card navigation / selection.
    this.root.querySelectorAll<HTMLElement>("[data-event-id]").forEach((el) => {
      el.addEventListener("click", () => {
        const id = Number(el.getAttribute("data-event-id"));
        this.emit("eventSelected", { eventId: id });
        const url = this.buildDetailUrl(id);
        if (url) window.location.href = url;
      });
    });
  }

  private readFormState() {
    const kw = this.root.querySelector<HTMLInputElement>("#ef-keyword");
    if (kw) this.keyword = kw.value.trim();
    const cong = this.root.querySelector<HTMLSelectElement>("#ef-congregation");
    if (cong) this.congregationId = cong.value;
    const min = this.root.querySelector<HTMLSelectElement>("#ef-ministry");
    if (min) this.ministryId = min.value;
    const month = this.root.querySelector<HTMLSelectElement>("#ef-month");
    if (month) this.monthId = month.value;
    const signup = this.root.querySelector<HTMLSelectElement>("#ef-signup");
    if (signup) this.signupType = signup.value;
  }

  // ── Render ──

  render() {
    this.root.innerHTML = `
      <div class="nw-ef">
        ${this.renderSearchForm()}
        <div class="nw-ef-results">
          ${this.renderResults()}
        </div>
      </div>`;
  }

  private renderSearchForm(): string {
    const options = (
      list: FilterOption[],
      selected: string,
      placeholder: string
    ): string =>
      [`<option value="">${this.escapeHtml(placeholder)}</option>`]
        .concat(
          list.map(
            (o) =>
              `<option value="${o.id}" ${String(o.id) === selected ? "selected" : ""}>${this.escapeHtml(o.name)}</option>`
          )
        )
        .join("");

    const monthOptions = [`<option value="">All Months</option>`]
      .concat(
        MONTHS.map(
          (m, i) =>
            `<option value="${i + 1}" ${this.monthId === String(i + 1) ? "selected" : ""}>${m}</option>`
        )
      )
      .join("");

    return `
      <form id="ef-form" class="nw-ef-form">
        <div class="nw-ef-search-row">
          <input
            id="ef-keyword"
            type="text"
            class="nw-ef-input"
            placeholder="Search events…"
            value="${this.escapeAttr(this.keyword)}"
            aria-label="Search events">
          <button type="submit" class="nw-ef-btn">Search</button>
        </div>
        <a href="#" class="nw-ef-advanced-link" data-action="toggle-advanced">
          ${this.advancedOpen ? "Hide Advanced Search" : "Advanced Search"}
        </a>
        <div class="nw-ef-advanced" style="display:${this.advancedOpen ? "grid" : "none"}">
          <div class="nw-ef-field">
            <label for="ef-congregation">Congregation</label>
            <select id="ef-congregation" class="nw-ef-select">
              ${options(this.config.congregations, this.congregationId, "All Congregations")}
            </select>
          </div>
          <div class="nw-ef-field">
            <label for="ef-ministry">Ministry</label>
            <select id="ef-ministry" class="nw-ef-select">
              ${options(this.config.ministries, this.ministryId, "All Ministries")}
            </select>
          </div>
          <div class="nw-ef-field">
            <label for="ef-month">Month</label>
            <select id="ef-month" class="nw-ef-select">${monthOptions}</select>
          </div>
          <div class="nw-ef-field">
            <label for="ef-signup">Sign-up Type</label>
            <select id="ef-signup" class="nw-ef-select">
              <option value="" ${this.signupType === "" ? "selected" : ""}>Both</option>
              <option value="1" ${this.signupType === "1" ? "selected" : ""}>Open Registration</option>
              <option value="2" ${this.signupType === "2" ? "selected" : ""}>Open Volunteer Opportunities</option>
            </select>
          </div>
        </div>
      </form>`;
  }

  private renderResults(): string {
    if (this.loading) {
      return `<div class="nw-ef-state">${this.spinnerSvg()}<span>Loading events…</span></div>`;
    }
    if (this.error) {
      return `
        <div class="nw-ef-state nw-ef-error">
          <p>${this.escapeHtml(this.error)}</p>
          <button class="nw-ef-btn" data-action="retry">Try Again</button>
        </div>`;
    }
    if (this.events.length === 0) {
      return `<div class="nw-ef-state nw-ef-empty">No events found.</div>`;
    }
    return `<div class="nw-ef-grid">${this.events.map((e) => this.renderCard(e)).join("")}</div>`;
  }

  private renderCard(e: EventSearchResult): string {
    const hasLink = !!this.getAttribute("target-url");
    const img = e.imageUrl
      ? `<img class="nw-ef-card-img" src="${this.escapeAttr(e.imageUrl)}" alt="" loading="lazy">`
      : `<div class="nw-ef-card-img nw-ef-card-img--placeholder">${this.calendarSvg()}</div>`;
    const badge = e.featured ? `<span class="nw-ef-badge">Featured</span>` : "";
    const dateRange = this.formatDateRange(e.startDate, e.endDate);
    const location = e.location
      ? `<div class="nw-ef-card-loc">${this.escapeHtml(e.location)}</div>`
      : "";
    const description = e.description
      ? `<div class="nw-ef-card-desc">${this.escapeHtml(this.truncate(e.description, 160))}</div>`
      : "";

    return `
      <div class="nw-ef-card" data-event-id="${e.id}" role="${hasLink ? "link" : "article"}" ${hasLink ? 'tabindex="0"' : ""}>
        <div class="nw-ef-card-imgwrap">${img}${badge}</div>
        <div class="nw-ef-card-body">
          <h3 class="nw-ef-card-title">${this.escapeHtml(e.title)}</h3>
          <div class="nw-ef-card-date">${this.escapeHtml(dateRange)}</div>
          ${location}
          ${description}
          ${hasLink ? `<span class="nw-ef-card-cta">See Details &rarr;</span>` : ""}
        </div>
      </div>`;
  }

  // ── Date / text helpers ──

  /** Parse the wall-clock components of an MP datetime without a TZ day-shift. */
  private parseMpDate(value: string): Date | null {
    if (!value) return null;
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    if (!m) {
      const fallback = new Date(value);
      return isNaN(fallback.getTime()) ? null : fallback;
    }
    return new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      m[4] ? Number(m[4]) : 0,
      m[5] ? Number(m[5]) : 0
    );
  }

  private formatDateRange(start: string, end: string): string {
    const s = this.parseMpDate(start);
    if (!s) return "";
    const e = this.parseMpDate(end);
    const dateFmt: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" };
    const timeFmt: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };

    const sDate = s.toLocaleDateString("en-US", dateFmt);
    const sTime = s.toLocaleTimeString("en-US", timeFmt);

    if (!e) return `${sDate}, ${sTime}`;

    const sameDay =
      s.getFullYear() === e.getFullYear() &&
      s.getMonth() === e.getMonth() &&
      s.getDate() === e.getDate();
    const eTime = e.toLocaleTimeString("en-US", timeFmt);

    if (sameDay) {
      return `${sDate}, ${sTime} – ${eTime}`;
    }
    const eDate = e.toLocaleDateString("en-US", dateFmt);
    return `${sDate}, ${sTime} – ${eDate}, ${eTime}`;
  }

  private truncate(text: string, max: number): string {
    const clean = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean;
  }

  private escapeHtml(text: string): string {
    const el = document.createElement("span");
    el.textContent = text;
    return el.innerHTML;
  }

  private escapeAttr(text: string): string {
    return this.escapeHtml(text).replace(/"/g, "&quot;");
  }

  private spinnerSvg(): string {
    return `<svg class="nw-ef-spinner" viewBox="0 0 24 24" fill="none" width="20" height="20">
      <circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
      <path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
    </svg>`;
  }

  private calendarSvg(): string {
    return `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
  }

  private getStyles(): string {
    return `
      :host { all: initial; display: block; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color: #2D2926; }
      .nw-ef { max-width: 1024px; margin: 0 auto; }

      .nw-ef-form { background: white; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; margin-bottom: 20px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
      .nw-ef-search-row { display: flex; gap: 8px; }
      .nw-ef-input { flex: 1; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; font-family: inherit; color: #2D2926; outline: none; }
      .nw-ef-input:focus { border-color: #004C97; box-shadow: 0 0 0 1px #004C97; }
      .nw-ef-btn { padding: 10px 20px; background: #004C97; color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; white-space: nowrap; }
      .nw-ef-btn:hover { background: #002855; }
      .nw-ef-advanced-link { display: inline-block; margin-top: 12px; font-size: 13px; color: #004C97; text-decoration: none; cursor: pointer; font-weight: 600; }
      .nw-ef-advanced-link:hover { text-decoration: underline; }
      .nw-ef-advanced { margin-top: 16px; gap: 12px; grid-template-columns: repeat(2, 1fr); }
      .nw-ef-field { display: flex; flex-direction: column; gap: 4px; }
      .nw-ef-field label { font-size: 12px; font-weight: 600; color: #6b7280; }
      .nw-ef-select { padding: 9px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; font-family: inherit; color: #2D2926; background: white; outline: none; cursor: pointer; }
      .nw-ef-select:focus { border-color: #004C97; }

      .nw-ef-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
      .nw-ef-card { background: white; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 1px 2px rgba(0,0,0,0.05); transition: border-color 0.15s, box-shadow 0.15s; }
      .nw-ef-card[role="link"] { cursor: pointer; }
      .nw-ef-card[role="link"]:hover { border-color: #004C97; box-shadow: 0 4px 10px rgba(0,0,0,0.08); }
      .nw-ef-card[role="link"]:focus-visible { outline: 2px solid #004C97; outline-offset: 2px; }
      .nw-ef-card-imgwrap { position: relative; }
      .nw-ef-card-img { width: 100%; height: 160px; object-fit: cover; display: block; }
      .nw-ef-card-img--placeholder { display: flex; align-items: center; justify-content: center; background: #f3f4f6; color: #9ca3af; }
      .nw-ef-badge { position: absolute; top: 10px; left: 10px; background: #F1BE48; color: #2D2926; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 9999px; text-transform: uppercase; letter-spacing: 0.03em; }
      .nw-ef-card-body { padding: 16px; display: flex; flex-direction: column; flex: 1; }
      .nw-ef-card-title { font-size: 16px; font-weight: 700; color: #002855; margin: 0 0 6px; }
      .nw-ef-card-date { font-size: 13px; color: #004C97; font-weight: 600; margin-bottom: 4px; }
      .nw-ef-card-loc { font-size: 13px; color: #6b7280; margin-bottom: 8px; }
      .nw-ef-card-desc { font-size: 13px; color: #474747; line-height: 1.5; flex: 1; }
      .nw-ef-card-cta { margin-top: 12px; font-size: 13px; font-weight: 600; color: #004C97; }

      .nw-ef-state { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 48px 16px; color: #6b7280; font-size: 15px; flex-direction: column; text-align: center; }
      .nw-ef-spinner { animation: nw-ef-spin 1s linear infinite; color: #004C97; }
      @keyframes nw-ef-spin { to { transform: rotate(360deg); } }
      .nw-ef-error p { color: #b91c1c; margin: 0; }

      @media (max-width: 1024px) { .nw-ef-grid { grid-template-columns: repeat(2, 1fr); } }
      @media (max-width: 640px) {
        .nw-ef-grid { grid-template-columns: 1fr; }
        .nw-ef-advanced { grid-template-columns: 1fr; }
      }
    `;
  }
}

customElements.define("next-event-finder", EventFinderWidget);
