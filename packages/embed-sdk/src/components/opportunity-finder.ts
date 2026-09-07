import { MPNextWidget } from "../shared/base-widget";

interface OpportunitySearchResult {
  id: number;
  title: string;
  description: string | null;
  imageUrl: string | null;
  location: string | null;
  meetingDay: string | null;
  meetingTime: string | null;
  featured: boolean;
  attributes: string[];
}

interface FilterOption {
  id: number;
  name: string;
}

interface AttributeType {
  id: number;
  name: string;
  attributes: FilterOption[];
}

interface Configurations {
  congregations: FilterOption[];
  ministries: FilterOption[];
  genders: FilterOption[];
  attributeTypes: AttributeType[];
}

/**
 * `next-opportunity-finder` — public, filterable volunteer-opportunity search
 * rendering result cards that deep-link to an opportunity-details page.
 *
 * Migrated from the legacy `mpp-opportunity-finder` portal widget. The fixed
 * attribute filters (congregation, ministry, gender, minimum age, frequency,
 * program, event, keyword, attribute IDs) are all supported; congregation /
 * ministry / gender / age / frequency / attribute-type live behind an "Advanced
 * Search" toggle, matching the `next-event-finder` model this is built on.
 */
export class OpportunityFinderWidget extends MPNextWidget {
  private opportunities: OpportunitySearchResult[] = [];
  private config: Configurations = {
    congregations: [],
    ministries: [],
    genders: [],
    attributeTypes: [],
  };
  private loading = true;
  private error: string | null = null;
  private advancedOpen = false;

  // Filter state (seeded from attributes, mutated by the form).
  private keyword = "";
  private congregationId = "";
  private ministryId = "";
  private genderId = "";
  private minimumAge = "";
  private frequency = "";
  private attributeIds = new Set<string>();

  static get observedAttributes() {
    return [
      "api-host",
      "target-url",
      "id-parameter-name",
      "congregation-id",
      "ministry-id",
      "gender-id",
      "minimum-age",
      "frequency",
      "program-id",
      "event-id",
      "keyword",
      "attribute-ids",
      "show-attribute-filter",
    ];
  }

  attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null) {
    if (oldValue === newValue) return;
    if (this.opportunities.length || !this.loading) {
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

  private get showAttributeFilter(): boolean {
    return this.getAttribute("show-attribute-filter") !== "false";
  }

  private seedFromAttributes() {
    this.keyword = this.getAttribute("keyword") || "";
    this.congregationId = this.getAttribute("congregation-id") || "";
    this.ministryId = this.getAttribute("ministry-id") || "";
    this.genderId = this.getAttribute("gender-id") || "";
    this.minimumAge = this.getAttribute("minimum-age") || "";
    this.frequency = this.getAttribute("frequency") || "";
    const attrs = this.getAttribute("attribute-ids") || "";
    this.attributeIds = new Set(
      attrs.split(",").map((a) => a.trim()).filter(Boolean)
    );
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
    const res = await this.fetch(`/api/embed/opportunity-finder/config`);
    if (!res.ok) return;
    const data = await res.json();
    this.config = {
      congregations: data.congregations || [],
      ministries: data.ministries || [],
      genders: data.genders || [],
      attributeTypes: data.attributeTypes || [],
    };
  }

  private buildQuery(): string {
    const params = new URLSearchParams();
    if (this.keyword) params.set("keyword", this.keyword);
    if (this.congregationId) params.set("congregationId", this.congregationId);
    if (this.ministryId) params.set("ministryId", this.ministryId);
    if (this.genderId) params.set("genderId", this.genderId);
    if (this.minimumAge) params.set("minimumAge", this.minimumAge);
    if (this.frequency) params.set("frequency", this.frequency);
    if (this.attributeIds.size) {
      params.set("attributeIds", Array.from(this.attributeIds).join(","));
    }

    const programId = this.getAttribute("program-id");
    if (programId) params.set("programId", programId);
    const eventId = this.getAttribute("event-id");
    if (eventId) params.set("eventId", eventId);

    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }

  private async search() {
    this.loading = true;
    this.error = null;
    this.render();

    try {
      const res = await this.fetch(`/api/embed/opportunity-finder${this.buildQuery()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data: { opportunities: OpportunitySearchResult[] } = await res.json();
      this.opportunities = data.opportunities || [];
      this.emit("opportunitiesLoaded", { count: this.opportunities.length });
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Failed to load opportunities";
      this.emit("opportunityFinderError", { error: this.error });
    } finally {
      this.loading = false;
      this.render();
      this.attachListeners();
    }
  }

  // ── Detail link / selection ──

  private buildDetailUrl(opportunityId: number): string | null {
    const target = this.getAttribute("target-url");
    if (!target) return null;
    const idParam = this.getAttribute("id-parameter-name") || "id";
    try {
      const url = new URL(target, window.location.href);
      url.searchParams.set(idParam, String(opportunityId));
      return url.toString();
    } catch {
      const sep = target.includes("?") ? "&" : "?";
      return `${target}${sep}${idParam}=${opportunityId}`;
    }
  }

  // ── Listeners ──

  private attachListeners() {
    const form = this.root.querySelector<HTMLFormElement>("#of-form");
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

    this.root.querySelectorAll<HTMLElement>("[data-opportunity-id]").forEach((el) => {
      el.addEventListener("click", () => {
        const id = Number(el.getAttribute("data-opportunity-id"));
        this.emit("opportunitySelected", { opportunityId: id });
        const url = this.buildDetailUrl(id);
        if (url) window.location.href = url;
      });
    });
  }

  private readFormState() {
    const kw = this.root.querySelector<HTMLInputElement>("#of-keyword");
    if (kw) this.keyword = kw.value.trim();
    const cong = this.root.querySelector<HTMLSelectElement>("#of-congregation");
    if (cong) this.congregationId = cong.value;
    const min = this.root.querySelector<HTMLSelectElement>("#of-ministry");
    if (min) this.ministryId = min.value;
    const gender = this.root.querySelector<HTMLSelectElement>("#of-gender");
    if (gender) this.genderId = gender.value;
    const age = this.root.querySelector<HTMLInputElement>("#of-age");
    if (age) this.minimumAge = age.value.trim();
    const freq = this.root.querySelector<HTMLSelectElement>("#of-frequency");
    if (freq) this.frequency = freq.value;
    const attr = this.root.querySelector<HTMLSelectElement>("#of-attributes");
    if (attr) {
      this.attributeIds = new Set(
        Array.from(attr.selectedOptions).map((o) => o.value).filter(Boolean)
      );
    }
  }

  // ── Render ──

  render() {
    this.root.innerHTML = `
      <div class="nw-of">
        ${this.renderSearchForm()}
        <div class="nw-of-results">
          ${this.renderResults()}
        </div>
      </div>`;
  }

  private renderSearchForm(): string {
    const options = (list: FilterOption[], selected: string, placeholder: string): string =>
      [`<option value="">${this.escapeHtml(placeholder)}</option>`]
        .concat(
          list.map(
            (o) =>
              `<option value="${o.id}" ${String(o.id) === selected ? "selected" : ""}>${this.escapeHtml(o.name)}</option>`
          )
        )
        .join("");

    const attributeField =
      this.showAttributeFilter && this.config.attributeTypes.length
        ? `
          <div class="nw-of-field nw-of-field--wide">
            <label for="of-attributes">Attributes</label>
            <select id="of-attributes" class="nw-of-select" multiple size="5">
              ${this.config.attributeTypes
                .map(
                  (t) => `
                <optgroup label="${this.escapeAttr(t.name)}">
                  ${t.attributes
                    .map(
                      (a) =>
                        `<option value="${a.id}" ${this.attributeIds.has(String(a.id)) ? "selected" : ""}>${this.escapeHtml(a.name)}</option>`
                    )
                    .join("")}
                </optgroup>`
                )
                .join("")}
            </select>
          </div>`
        : "";

    return `
      <form id="of-form" class="nw-of-form">
        <div class="nw-of-search-row">
          <input
            id="of-keyword"
            type="text"
            class="nw-of-input"
            placeholder="Search opportunities…"
            value="${this.escapeAttr(this.keyword)}"
            aria-label="Search opportunities">
          <button type="submit" class="nw-of-btn">Search</button>
        </div>
        <a href="#" class="nw-of-advanced-link" data-action="toggle-advanced">
          ${this.advancedOpen ? "Hide Advanced Search" : "Advanced Search"}
        </a>
        <div class="nw-of-advanced" style="display:${this.advancedOpen ? "grid" : "none"}">
          <div class="nw-of-field">
            <label for="of-congregation">Congregation</label>
            <select id="of-congregation" class="nw-of-select">
              ${options(this.config.congregations, this.congregationId, "All Congregations")}
            </select>
          </div>
          <div class="nw-of-field">
            <label for="of-ministry">Ministry</label>
            <select id="of-ministry" class="nw-of-select">
              ${options(this.config.ministries, this.ministryId, "All Ministries")}
            </select>
          </div>
          <div class="nw-of-field">
            <label for="of-gender">Gender</label>
            <select id="of-gender" class="nw-of-select">
              ${options(this.config.genders, this.genderId, "Any Gender")}
            </select>
          </div>
          <div class="nw-of-field">
            <label for="of-age">Minimum Age</label>
            <input id="of-age" type="number" min="0" step="1" class="nw-of-input"
              value="${this.escapeAttr(this.minimumAge)}" placeholder="Any">
          </div>
          <div class="nw-of-field">
            <label for="of-frequency">Frequency</label>
            <select id="of-frequency" class="nw-of-select">
              <option value="" ${this.frequency === "" ? "selected" : ""}>All Opportunities</option>
              <option value="1" ${this.frequency === "1" ? "selected" : ""}>Ongoing</option>
              <option value="2" ${this.frequency === "2" ? "selected" : ""}>One Time</option>
            </select>
          </div>
          ${attributeField}
        </div>
      </form>`;
  }

  private renderResults(): string {
    if (this.loading) {
      return `<div class="nw-of-state">${this.spinnerSvg()}<span>Loading opportunities…</span></div>`;
    }
    if (this.error) {
      return `
        <div class="nw-of-state nw-of-error">
          <p>${this.escapeHtml(this.error)}</p>
          <button class="nw-of-btn" data-action="retry">Try Again</button>
        </div>`;
    }
    if (this.opportunities.length === 0) {
      return `<div class="nw-of-state nw-of-empty">No opportunities found.</div>`;
    }
    return `<div class="nw-of-grid">${this.opportunities.map((o) => this.renderCard(o)).join("")}</div>`;
  }

  private renderCard(o: OpportunitySearchResult): string {
    const hasLink = !!this.getAttribute("target-url");
    const img = o.imageUrl
      ? `<img class="nw-of-card-img" src="${this.escapeAttr(o.imageUrl)}" alt="" loading="lazy">`
      : `<div class="nw-of-card-img nw-of-card-img--placeholder">${this.handsSvg()}</div>`;
    const badge = o.featured ? `<span class="nw-of-badge">Featured</span>` : "";

    const subtitle = this.buildSubtitle(o);
    const subtitleHtml = subtitle
      ? `<div class="nw-of-card-sub">${this.escapeHtml(subtitle)}</div>`
      : "";
    const pills =
      o.attributes && o.attributes.length
        ? `<ul class="nw-of-pills">${o.attributes
            .map((a) => `<li>${this.escapeHtml(a)}</li>`)
            .join("")}</ul>`
        : "";
    const description = o.description
      ? `<div class="nw-of-card-desc">${this.escapeHtml(this.truncate(o.description, 160))}</div>`
      : "";

    return `
      <div class="nw-of-card" data-opportunity-id="${o.id}" role="${hasLink ? "link" : "article"}" ${hasLink ? 'tabindex="0"' : ""}>
        <div class="nw-of-card-imgwrap">${img}${badge}</div>
        <div class="nw-of-card-body">
          <h3 class="nw-of-card-title">${this.escapeHtml(o.title)}</h3>
          ${subtitleHtml}
          ${pills}
          ${description}
          ${hasLink ? `<span class="nw-of-card-cta">See Details &rarr;</span>` : ""}
        </div>
      </div>`;
  }

  /** Compose "Location · Mondays · 9:00 AM" style subtitle. */
  private buildSubtitle(o: OpportunitySearchResult): string {
    const day = this.formatMeetingDay(o.meetingDay);
    const time = this.formatMeetingTime(o);
    return [o.location, day, time].filter((p) => p && p.length).join(" · ");
  }

  private formatMeetingDay(meetingDay: string | null): string {
    if (!meetingDay) return "";
    const lower = meetingDay.toLowerCase();
    if (lower === "ongoing") return "Ongoing";
    return `${meetingDay}s`;
  }

  private formatMeetingTime(o: OpportunitySearchResult): string {
    if (!o.meetingTime) return "";
    if ((o.meetingDay ?? "").toLowerCase() === "ongoing") return "";
    const d = this.parseMpDate(o.meetingTime);
    if (!d) return "";
    // Skip midnight (no real time component on the opportunity).
    if (d.getHours() === 0 && d.getMinutes() === 0) return "";
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
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
    return `<svg class="nw-of-spinner" viewBox="0 0 24 24" fill="none" width="20" height="20">
      <circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
      <path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
    </svg>`;
  }

  private handsSvg(): string {
    return `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 11V7a2 2 0 0 1 4 0v4"/><path d="M11 9V5a2 2 0 0 1 4 0v6"/><path d="M15 11V7a2 2 0 0 1 4 0v8a6 6 0 0 1-6 6h-2a6 6 0 0 1-5.2-3l-2.3-4a2 2 0 0 1 3.5-2L7 11"/></svg>`;
  }

  private getStyles(): string {
    return `
      :host { all: initial; display: block; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color: #2D2926; }
      .nw-of { max-width: 1024px; margin: 0 auto; }

      .nw-of-form { background: white; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; margin-bottom: 20px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
      .nw-of-search-row { display: flex; gap: 8px; }
      .nw-of-input { flex: 1; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; font-family: inherit; color: #2D2926; outline: none; }
      .nw-of-input:focus { border-color: #004C97; box-shadow: 0 0 0 1px #004C97; }
      .nw-of-btn { padding: 10px 20px; background: #004C97; color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; white-space: nowrap; }
      .nw-of-btn:hover { background: #002855; }
      .nw-of-advanced-link { display: inline-block; margin-top: 12px; font-size: 13px; color: #004C97; text-decoration: none; cursor: pointer; font-weight: 600; }
      .nw-of-advanced-link:hover { text-decoration: underline; }
      .nw-of-advanced { margin-top: 16px; gap: 12px; grid-template-columns: repeat(2, 1fr); }
      .nw-of-field { display: flex; flex-direction: column; gap: 4px; }
      .nw-of-field--wide { grid-column: 1 / -1; }
      .nw-of-field label { font-size: 12px; font-weight: 600; color: #6b7280; }
      .nw-of-select { padding: 9px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; font-family: inherit; color: #2D2926; background: white; outline: none; cursor: pointer; }
      .nw-of-select:focus { border-color: #004C97; }
      select[multiple].nw-of-select { padding: 6px; cursor: default; }

      .nw-of-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
      .nw-of-card { background: white; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 1px 2px rgba(0,0,0,0.05); transition: border-color 0.15s, box-shadow 0.15s; }
      .nw-of-card[role="link"] { cursor: pointer; }
      .nw-of-card[role="link"]:hover { border-color: #004C97; box-shadow: 0 4px 10px rgba(0,0,0,0.08); }
      .nw-of-card[role="link"]:focus-visible { outline: 2px solid #004C97; outline-offset: 2px; }
      .nw-of-card-imgwrap { position: relative; }
      .nw-of-card-img { width: 100%; height: 160px; object-fit: cover; display: block; }
      .nw-of-card-img--placeholder { display: flex; align-items: center; justify-content: center; background: #f3f4f6; color: #9ca3af; height: 160px; }
      .nw-of-badge { position: absolute; top: 10px; left: 10px; background: #F1BE48; color: #2D2926; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 9999px; text-transform: uppercase; letter-spacing: 0.03em; }
      .nw-of-card-body { padding: 16px; display: flex; flex-direction: column; flex: 1; }
      .nw-of-card-title { font-size: 16px; font-weight: 700; color: #002855; margin: 0 0 6px; }
      .nw-of-card-sub { font-size: 13px; color: #004C97; font-weight: 600; margin-bottom: 8px; }
      .nw-of-pills { list-style: none; padding: 0; margin: 0 0 8px; display: flex; flex-wrap: wrap; gap: 6px; }
      .nw-of-pills li { background: #eef2f7; color: #002855; font-size: 11px; font-weight: 600; padding: 2px 9px; border-radius: 9999px; }
      .nw-of-card-desc { font-size: 13px; color: #474747; line-height: 1.5; flex: 1; }
      .nw-of-card-cta { margin-top: 12px; font-size: 13px; font-weight: 600; color: #004C97; }

      .nw-of-state { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 48px 16px; color: #6b7280; font-size: 15px; flex-direction: column; text-align: center; }
      .nw-of-spinner { animation: nw-of-spin 1s linear infinite; color: #004C97; }
      @keyframes nw-of-spin { to { transform: rotate(360deg); } }
      .nw-of-error p { color: #b91c1c; margin: 0; }

      @media (max-width: 1024px) { .nw-of-grid { grid-template-columns: repeat(2, 1fr); } }
      @media (max-width: 640px) {
        .nw-of-grid { grid-template-columns: 1fr; }
        .nw-of-advanced { grid-template-columns: 1fr; }
      }
    `;
  }
}

customElements.define("next-opportunity-finder", OpportunityFinderWidget);
