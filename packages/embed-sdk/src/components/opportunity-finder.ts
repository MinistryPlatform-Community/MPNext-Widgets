import { MPNextWidget, WidgetError } from "../shared/base-widget";
import { parseWallClock } from "../i18n";
import { cardLink, bindCardSelect, CARD_LINK_STYLES } from "../shared/card-link";

interface OpportunitySearchResult {
  id: number;
  title: string;
  description: string | null;
  imageUrl: string | null;
  location: string | null;
  meetingDay: string | null;
  meetingTime: string | null;
  /** MP-authored commitment text ("1 hour"); rendered as written. */
  ribbonText: string | null;
  attributes: string[];
}

/** `DATENAME(dw, …)` output on an English-language MP SQL server; index 0 = Sunday. */
const ENGLISH_WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

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

  connectedCallback() {
    this.injectStyles(this.getStyles() + CARD_LINK_STYLES);
    this.seedFromAttributes();
    // Await the catalogue before the first paint so a Spanish visitor never
    // sees English swap to Spanish; the fetch hides inside the loading state
    // this widget already paints while it queries the API.
    void this.initLocale().then(() => {
      this.render();
      this.painted = true;
      this.init();
    });
  }

  /**
   * C39: an attribute change after first paint re-seeds the filters and
   * searches again (base `attributeChangedCallback` → `reconfigure()`). The
   * old guard (`opportunities.length || !loading`) dropped a change made while
   * the first search was in flight.
   */
  protected override reload(): void {
    this.seedFromAttributes();
    void this.search();
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
        const data = await res.json().catch(() => ({}));
        throw new WidgetError(this.errorText(data));
      }
      const data: { opportunities: OpportunitySearchResult[] } = await res.json();
      this.opportunities = data.opportunities || [];
      this.emit("opportunitiesLoaded", { count: this.opportunities.length });
    } catch (err) {
      // `errorText` has already produced a translated sentence; a thrown
      // non-Error (a dropped connection) becomes the generic network message
      // rather than leaking English.
      this.error = this.caughtText(err, "errors.network");
      this.emit("opportunityFinderError", { error: this.error });
    } finally {
      this.loading = false;
      this.render();
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
      });
    }

    const retry = this.root.querySelector('[data-action="retry"]');
    if (retry) {
      retry.addEventListener("click", () => this.retryLoad());
    }

    // Emit only; the card's own anchor navigates (C22).
    bindCardSelect(this.root, ".nw-of-card", (card) => {
      this.emit("opportunitySelected", { opportunityId: Number(card.dataset.opportunityId) });
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

  /**
   * Paint, then re-bind the listeners the new markup needs. One method, so
   * every re-render re-binds: the base class re-renders through `render()`
   * alone on a page-wide locale or label-override change, and a paint that
   * left the binding to its caller came back with dead buttons.
   */
  render(): void {
    this.paintMarkup();
    this.attachListeners();
  }

  private paintMarkup(): void {
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
            <label for="of-attributes">${this.escapeHtml(this.t("opportunityFinder.attributes"))}</label>
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
            placeholder="${this.escapeAttr(this.t("opportunityFinder.searchPlaceholder"))}"
            value="${this.escapeAttr(this.keyword)}"
            aria-label="${this.escapeAttr(this.t("opportunityFinder.searchLabel"))}">
          <button type="submit" class="nw-of-btn">${this.escapeHtml(this.t("common.search"))}</button>
        </div>
        <a href="#" class="nw-of-advanced-link" data-action="toggle-advanced">
          ${this.escapeHtml(this.t(this.advancedOpen ? "opportunityFinder.hideAdvanced" : "opportunityFinder.showAdvanced"))}
        </a>
        <div class="nw-of-advanced" style="display:${this.advancedOpen ? "grid" : "none"}">
          <div class="nw-of-field">
            <label for="of-congregation">${this.escapeHtml(this.t("fields.congregation"))}</label>
            <select id="of-congregation" class="nw-of-select">
              ${options(this.config.congregations, this.congregationId, this.t("opportunityFinder.allCongregations"))}
            </select>
          </div>
          <div class="nw-of-field">
            <label for="of-ministry">${this.escapeHtml(this.t("fields.ministry"))}</label>
            <select id="of-ministry" class="nw-of-select">
              ${options(this.config.ministries, this.ministryId, this.t("opportunityFinder.allMinistries"))}
            </select>
          </div>
          <div class="nw-of-field">
            <label for="of-gender">${this.escapeHtml(this.t("fields.gender"))}</label>
            <select id="of-gender" class="nw-of-select">
              ${options(this.config.genders, this.genderId, this.t("opportunityFinder.anyGender"))}
            </select>
          </div>
          <div class="nw-of-field">
            <label for="of-age">${this.escapeHtml(this.t("opportunityFinder.minimumAge"))}</label>
            <input id="of-age" type="number" min="0" step="1" class="nw-of-input"
              value="${this.escapeAttr(this.minimumAge)}" placeholder="${this.escapeAttr(this.t("opportunityFinder.anyAge"))}">
          </div>
          <div class="nw-of-field">
            <label for="of-frequency">${this.escapeHtml(this.t("opportunityFinder.frequency"))}</label>
            <select id="of-frequency" class="nw-of-select">
              <option value="" ${this.frequency === "" ? "selected" : ""}>${this.escapeHtml(this.t("opportunityFinder.allOpportunities"))}</option>
              <option value="1" ${this.frequency === "1" ? "selected" : ""}>${this.escapeHtml(this.t("opportunityFinder.ongoing"))}</option>
              <option value="2" ${this.frequency === "2" ? "selected" : ""}>${this.escapeHtml(this.t("opportunityFinder.oneTime"))}</option>
            </select>
          </div>
          ${attributeField}
        </div>
      </form>`;
  }

  private renderResults(): string {
    if (this.loading) {
      return `<div class="nw-of-state">${this.spinnerSvg()}<span>${this.escapeHtml(this.t("opportunityFinder.loading"))}</span></div>`;
    }
    if (this.error) {
      return `
        <div class="nw-of-state nw-of-error">
          <p>${this.escapeHtml(this.error)}</p>
          <button class="nw-of-btn" data-action="retry">${this.escapeHtml(this.t("common.retry"))}</button>
        </div>`;
    }
    if (this.opportunities.length === 0) {
      return `<div class="nw-of-state nw-of-empty">${this.escapeHtml(this.t("opportunityFinder.empty"))}</div>`;
    }
    return `<div class="nw-of-grid">${this.opportunities.map((o) => this.renderCard(o)).join("")}</div>`;
  }

  private renderCard(o: OpportunitySearchResult): string {
    const href = this.buildDetailUrl(o.id);
    const img = o.imageUrl
      ? `<img class="nw-of-card-img" src="${this.escapeAttr(o.imageUrl)}" alt="" loading="lazy">`
      : `<div class="nw-of-card-img nw-of-card-img--placeholder">${this.handsSvg()}</div>`;
    // C25: the old "Featured" badge read a column the proc never returns, so it
    // was unreachable. The slot now shows the proc's `RibbonText` ("1 hour"),
    // the commitment size a volunteer wants before clicking. MP-authored copy.
    const badge = o.ribbonText
      ? `<span class="nw-of-badge">${this.escapeHtml(o.ribbonText)}</span>`
      : "";

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

    // C22: a real `<a href>` when `target-url` is set (Enter, middle-click,
    // copy-link and the accessible name all come from the browser), else a
    // plain `role="article"`. Never `role="link"` + `tabindex` on a div again.
    const body = `
        <div class="nw-of-card-imgwrap">${img}${badge}</div>
        <div class="nw-of-card-body">
          <h3 class="nw-of-card-title">${this.escapeHtml(o.title)}</h3>
          ${subtitleHtml}
          ${pills}
          ${description}
          ${href ? `<span class="nw-of-card-cta">${this.escapeHtml(this.t("common.seeDetails"))} &rarr;</span>` : ""}
        </div>`;
    return cardLink({
      href,
      className: "nw-of-card",
      body,
      attrs: { "data-opportunity-id": o.id },
    });
  }

  /** Compose "Location · Fri, Dec 31, 2027" / "Location · Ongoing" subtitle. */
  private buildSubtitle(o: OpportunitySearchResult): string {
    return [o.location, this.formatWhen(o)].filter((p) => p && p.length).join(" · ");
  }

  /**
   * When the opportunity happens, decided from the **data**, not the day string
   * (C25). The proc's `MeetingDay` is `DATENAME(dw, Opportunity_Date)`: for a
   * dated one-time opportunity it is that date's weekday, *not* a recurrence,
   * and pluralising it ("Fridays") told volunteers a single Friday two years
   * out was a weekly slot.
   *
   * - "Ongoing" → translated "Ongoing".
   * - A real date → that date, with its weekday and year (`weekdayMedium`),
   *   plus the time only when it is not midnight (a date-only opportunity
   *   stores midnight; legacy printed a meaningless "12:00 AM").
   * - A weekday with no date (not produced by the stock proc, kept for
   *   customised ones) → "Every Friday", the weekday localised by `Intl`.
   */
  private formatWhen(o: OpportunitySearchResult): string {
    const day = (o.meetingDay ?? "").trim();
    if (day.toLowerCase() === "ongoing") return this.t("opportunityFinder.ongoing");
    // `parseWallClock`: calendar-parts parse into a local Date, so MP's wall
    // clock survives and `fmt` formats it with no time zone.
    const d = o.meetingTime ? parseWallClock(o.meetingTime) : null;
    if (d) {
      const date = this.fmt.date(d, "weekdayMedium");
      if (d.getHours() === 0 && d.getMinutes() === 0) return date;
      return this.t("opportunityFinder.dateAtTime", { date, time: this.fmt.time(d) });
    }
    if (!day) return "";
    return this.t("opportunityFinder.everyWeekday", { day: this.localWeekday(day) });
  }

  /** MP's English weekday name in the widget's locale; MP's text if unknown. */
  private localWeekday(englishDay: string): string {
    const index = ENGLISH_WEEKDAYS.indexOf(englishDay.toLowerCase());
    return index < 0 ? englishDay : this.fmt.weekdayNames("long")[index];
  }

  // ── Date / text helpers ──

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
      :host { all: initial; display: block; font-family: var(--_nw-font-family); color: var(--_nw-color-text); }
      .nw-of { max-width: 1024px; margin: 0 auto; }

      .nw-of-form { background: var(--_nw-color-surface); border: var(--_nw-border-width) solid var(--_nw-color-border); border-radius: var(--_nw-radius-lg); padding: var(--_nw-space-4); margin-bottom: var(--_nw-space-5); box-shadow: var(--_nw-shadow); }
      .nw-of-search-row { display: flex; gap: var(--_nw-space-2); }
      .nw-of-input { flex: 1; padding: 10px var(--_nw-space-3); border: var(--_nw-border-width) solid var(--_nw-color-border-strong); border-radius: var(--_nw-radius); font-size: var(--_nw-font-size-base); font-family: inherit; color: var(--_nw-color-text); outline: none; }
      .nw-of-input:focus { border-color: var(--_nw-color-primary); box-shadow: 0 0 0 1px var(--_nw-color-primary); }
      .nw-of-btn { padding: 10px var(--_nw-space-5); background: var(--_nw-button-bg); color: var(--_nw-button-fg); border: none; border-radius: var(--_nw-button-radius); font-size: var(--_nw-font-size-base); font-weight: 600; cursor: pointer; font-family: inherit; white-space: nowrap; }
      .nw-of-btn:hover { background: var(--_nw-button-bg-hover); }
      .nw-of-advanced-link { display: inline-block; margin-top: var(--_nw-space-3); font-size: 13px; color: var(--_nw-color-primary); text-decoration: none; cursor: pointer; font-weight: 600; }
      .nw-of-advanced-link:hover { text-decoration: underline; }
      .nw-of-advanced { margin-top: var(--_nw-space-4); gap: var(--_nw-space-3); grid-template-columns: repeat(2, 1fr); }
      .nw-of-field { display: flex; flex-direction: column; gap: var(--_nw-space-1); }
      .nw-of-field--wide { grid-column: 1 / -1; }
      .nw-of-field label { font-size: 12px; font-weight: 600; color: var(--_nw-color-muted); }
      .nw-of-select { padding: 9px var(--_nw-space-3); border: var(--_nw-border-width) solid var(--_nw-color-border-strong); border-radius: var(--_nw-radius); font-size: var(--_nw-font-size-base); font-family: inherit; color: var(--_nw-color-text); background: var(--_nw-color-surface); outline: none; cursor: pointer; }
      .nw-of-select:focus { border-color: var(--_nw-color-primary); }
      select[multiple].nw-of-select { padding: 6px; cursor: default; }

      .nw-of-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--_nw-space-4); }
      .nw-of-card { background: var(--_nw-color-surface); border: var(--_nw-border-width) solid var(--_nw-color-border); border-radius: var(--_nw-radius-lg); overflow: hidden; display: flex; flex-direction: column; box-shadow: var(--_nw-shadow); transition: border-color 0.15s, box-shadow 0.15s; }
      a.nw-of-card { cursor: pointer; }
      a.nw-of-card:hover { border-color: var(--_nw-color-primary); box-shadow: var(--_nw-shadow-hover); }
      .nw-of-card-imgwrap { position: relative; }
      .nw-of-card-img { width: 100%; height: 160px; object-fit: cover; display: block; }
      .nw-of-card-img--placeholder { display: flex; align-items: center; justify-content: center; background: var(--_nw-color-surface-muted); color: #9ca3af; height: 160px; }
      .nw-of-badge { position: absolute; top: 10px; left: 10px; background: var(--_nw-color-accent); color: var(--_nw-color-text); font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 9999px; text-transform: uppercase; letter-spacing: 0.03em; }
      .nw-of-card-body { padding: var(--_nw-space-4); display: flex; flex-direction: column; flex: 1; }
      .nw-of-card-title { font-size: 16px; font-weight: var(--_nw-font-weight-heading); color: var(--_nw-color-secondary); margin: 0 0 6px; }
      .nw-of-card-sub { font-size: 13px; color: var(--_nw-color-primary); font-weight: 600; margin-bottom: var(--_nw-space-2); }
      .nw-of-pills { list-style: none; padding: 0; margin: 0 0 var(--_nw-space-2); display: flex; flex-wrap: wrap; gap: 6px; }
      .nw-of-pills li { background: #eef2f7; color: var(--_nw-color-secondary); font-size: 11px; font-weight: 600; padding: 2px 9px; border-radius: 9999px; }
      .nw-of-card-desc { font-size: 13px; color: var(--_nw-color-text-subtle); line-height: var(--_nw-line-height); flex: 1; }
      .nw-of-card-cta { margin-top: var(--_nw-space-3); font-size: 13px; font-weight: 600; color: var(--_nw-color-primary); }

      .nw-of-state { display: flex; align-items: center; justify-content: center; gap: var(--_nw-space-3); padding: 48px var(--_nw-space-4); color: var(--_nw-color-muted); font-size: 15px; flex-direction: column; text-align: center; }
      .nw-of-spinner { animation: nw-of-spin 1s linear infinite; color: var(--_nw-color-primary); }
      @keyframes nw-of-spin { to { transform: rotate(360deg); } }
      .nw-of-error p { color: var(--_nw-color-error-text); margin: 0; }

      @media (max-width: 1024px) { .nw-of-grid { grid-template-columns: repeat(2, 1fr); } }
      @media (max-width: 640px) {
        .nw-of-grid { grid-template-columns: 1fr; }
        .nw-of-advanced { grid-template-columns: 1fr; }
      }
    `;
  }
}

customElements.define("next-opportunity-finder", OpportunityFinderWidget);
