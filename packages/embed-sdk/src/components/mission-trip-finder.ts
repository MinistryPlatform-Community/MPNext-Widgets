import { MPNextWidget, WidgetError } from "../shared/base-widget";
import { parseWallClock } from "../i18n";

/**
 * One card from `GET /api/embed/mission-trips`.
 *
 * Mirrors `MissionTripCard` in `@mpnext/types`; this package does not import
 * that workspace package, matching the convention every other widget follows.
 * Every date is an MP wall-clock string, passed through verbatim.
 */
interface MissionTripCard {
  pledgeCampaignId: number;
  campaignName: string;
  description: string | null;
  imageUrl: string | null;
  congregationName: string | null;
  programName: string | null;
  ministryName: string | null;
  eventId: number | null;
  eventStartDate: string | null;
  eventEndDate: string | null;
  registrationStart: string | null;
  registrationEnd: string | null;
  /** `null` or `0` both mean uncapped. */
  maximumRegistrants: number | null;
  currentRegistrants: number;
  isFull: boolean;
}

/**
 * `next-mission-trip-finder` (C76) — the public mission-trip search.
 *
 * Replaces the legacy `mpp-mission-trip-finder`. Structurally this is
 * `next-opportunity-finder`: filters, cards, link out. Three things are
 * deliberately different.
 *
 * **Cards are real links.** `next-opportunity-finder` renders a `div` with
 * `role="link"` and a click handler, which is `C05` / `C10` / `C22` — the same
 * accessibility defect filed three times. An `<a href>` is focusable, opens in
 * a new tab on middle-click, and is announced as a link with no `tabindex`
 * bookkeeping. The link is also the honest representation: a card *is* a URL to
 * the details page.
 *
 * **Dates carry the year** (`C09`). A trip is planned a year out; "Jun 4 – Jun
 * 11" on a finder listing next year's trips alongside this year's is ambiguous
 * exactly when it matters.
 *
 * **A full trip says so.** Legacy had only the `showfulltrips` filter — and it
 * was inverted (`>=` where it meant `<`), so asking to hide full trips returned
 * the full ones. The filter is corrected server-side; the badge is new, because
 * a listed trip with no seats has to say so on the card rather than only in
 * whether it appears at all.
 *
 * The details page is `next-pledge-campaign`: `api_MPPW_GetPledgeCampaign`
 * declares `@IsMissionTrip` and never reads it, so `mpp-mission-trip` and
 * `mpp-pledge-campaign` were already the same widget. `id-parameter-name`
 * is the seam — the finder writes `?<name>=<campaignId>` and the campaign
 * widget reads it with its attribute of the same name. Both default to `id`.
 */
export class MissionTripFinderWidget extends MPNextWidget {
  private trips: MissionTripCard[] = [];
  private loading = true;
  private error: string | null = null;

  /** Search box state, seeded from the `keyword` attribute. */
  private keyword = "";

  static get observedAttributes() {
    return [
      "api-host",
      "campaign-type-id",
      "target",
      "id-parameter-name",
      "congregation-id",
      "ministry-id",
      "program-id",
      "keyword",
      "show-full-trips",
      "max-results",
    ];
  }

  attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null) {
    if (oldValue === newValue) return;
    // Only re-query once the first load has happened; the initial attribute
    // sets arrive before `connectedCallback` and would double-fetch.
    if (this.trips.length || !this.loading) {
      this.seedFromAttributes();
      void this.search();
    }
  }

  connectedCallback() {
    this.injectStyles(this.getStyles());
    this.seedFromAttributes();
    // Await the catalogue before the first paint so a Spanish visitor never
    // sees English swap to Spanish; the fetch hides inside the loading state
    // this widget already paints while it queries the API.
    void this.initLocale().then(() => {
      this.render();
      void this.search();
    });
  }

  /** Public hook so demo pages can force a reload. */
  public retryLoad() {
    this.error = null;
    void this.search();
  }

  // ── Attributes ──────────────────────────────────────────────────────────

  private seedFromAttributes() {
    this.keyword = this.getAttribute("keyword") || "";
  }

  private get campaignTypeId(): string {
    return (this.getAttribute("campaign-type-id") || "").trim();
  }

  private get target(): string {
    return (this.getAttribute("target") || "").trim();
  }

  private get idParam(): string {
    return this.getAttribute("id-parameter-name") || "id";
  }

  /**
   * Defaults to `true`, matching legacy's documented meaning. The server
   * applies the filter; sending it explicitly keeps the default in one place.
   */
  private get showFullTrips(): boolean {
    return this.getAttribute("show-full-trips") !== "false";
  }

  private get maxResults(): string {
    const raw = (this.getAttribute("max-results") || "").trim();
    if (!raw) return "100";
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? String(n) : "100";
  }

  // ── Load ────────────────────────────────────────────────────────────────

  private buildQuery(): string {
    const params = new URLSearchParams();
    if (this.campaignTypeId) params.set("campaignTypeId", this.campaignTypeId);
    if (this.keyword) params.set("keyword", this.keyword);

    for (const [attr, param] of [
      ["congregation-id", "congregationId"],
      ["ministry-id", "ministryId"],
      ["program-id", "programId"],
    ] as const) {
      const value = (this.getAttribute(attr) || "").trim();
      if (value) params.set(param, value);
    }

    params.set("showFullTrips", this.showFullTrips ? "true" : "false");
    params.set("maxResults", this.maxResults);
    return `?${params.toString()}`;
  }

  private async search() {
    this.loading = true;
    this.error = null;
    this.render();

    try {
      const res = await this.fetch(`/api/embed/mission-trips${this.buildQuery()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // `errorText` renders the machine code's catalogue sentence; the
        // server's English `message` is never shown to a visitor.
        throw new WidgetError(this.errorText(body));
      }
      const data: { trips?: MissionTripCard[] } = await res.json();
      this.trips = data.trips || [];
      this.emit("missionTripsLoaded", { count: this.trips.length });
    } catch (err) {
      this.error = this.caughtText(err, "errors.network");
      this.trips = [];
      this.emit("missionTripFinderError", { error: this.error });
    } finally {
      this.loading = false;
      this.render();
    }
  }

  // ── Links ───────────────────────────────────────────────────────────────

  /**
   * `<target>?<id-parameter-name>=<pledgeCampaignId>`, or `null` when the page
   * author set no target — in which case the card renders as an article rather
   * than as a link to nowhere.
   */
  private buildDetailUrl(campaignId: number): string | null {
    const target = this.target;
    if (!target) return null;
    try {
      const url = new URL(target, window.location.href);
      url.searchParams.set(this.idParam, String(campaignId));
      return url.toString();
    } catch {
      const sep = target.includes("?") ? "&" : "?";
      return `${target}${sep}${this.idParam}=${campaignId}`;
    }
  }

  // ── Listeners ───────────────────────────────────────────────────────────

  private attachListeners() {
    const form = this.root.querySelector<HTMLFormElement>("#mtf-form");
    form?.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = this.root.querySelector<HTMLInputElement>("#mtf-keyword");
      if (input) this.keyword = input.value.trim();
      void this.search();
    });

    this.root
      .querySelector('[data-action="retry"]')
      ?.addEventListener("click", () => this.retryLoad());

    // Announce the selection without touching navigation: the anchor's own
    // default does that, on click and on Enter alike.
    this.root.querySelectorAll<HTMLElement>("[data-campaign-id]").forEach((el) => {
      el.addEventListener("click", () => {
        this.emit("missionTripSelected", {
          campaignId: Number(el.getAttribute("data-campaign-id")),
        });
      });
    });
  }

  // ── Render ──────────────────────────────────────────────────────────────

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
      <section class="mtf">
        <h2 class="mtf-title">${this.escapeHtml(this.t("missionTripFinder.title"))}</h2>
        ${this.renderSearchForm()}
        <div class="mtf-results">${this.renderResults()}</div>
      </section>`;
  }

  private renderSearchForm(): string {
    return `
      <form id="mtf-form" class="mtf-form">
        <input
          id="mtf-keyword"
          type="search"
          class="mtf-input"
          value="${this.escapeAttr(this.keyword)}"
          placeholder="${this.escapeAttr(this.t("missionTripFinder.searchPlaceholder"))}"
          aria-label="${this.escapeAttr(this.t("missionTripFinder.searchLabel"))}">
        <button type="submit" class="mtf-btn">${this.escapeHtml(this.t("common.search"))}</button>
      </form>`;
  }

  private renderResults(): string {
    if (this.loading) {
      return `<div class="mtf-state">${this.spinnerSvg()}<span>${this.escapeHtml(this.t("missionTripFinder.loading"))}</span></div>`;
    }
    if (this.error) {
      return `
        <div class="mtf-state mtf-error">
          <p>${this.escapeHtml(this.error)}</p>
          <button class="mtf-btn" data-action="retry">${this.escapeHtml(this.t("common.retry"))}</button>
        </div>`;
    }
    if (this.trips.length === 0) {
      return `<div class="mtf-state mtf-empty">${this.escapeHtml(this.t("missionTripFinder.empty"))}</div>`;
    }
    const count = this.t("missionTripFinder.resultsCount", { count: this.trips.length });
    return `
      <p class="mtf-count" role="status">${this.escapeHtml(count)}</p>
      <div class="mtf-grid">${this.trips.map((t) => this.renderCard(t)).join("")}</div>`;
  }

  private renderCard(trip: MissionTripCard): string {
    const href = this.buildDetailUrl(trip.pledgeCampaignId);

    const img = trip.imageUrl
      ? `<img class="mtf-card-img" src="${this.escapeAttr(trip.imageUrl)}" alt="" loading="lazy">`
      : `<div class="mtf-card-img mtf-card-img--placeholder">${this.globeSvg()}</div>`;

    const badge = trip.isFull
      ? `<span class="mtf-badge mtf-badge--full">${this.escapeHtml(this.t("missionTripFinder.full"))}</span>`
      : "";

    // Congregation / program / ministry are MP-authored names and are never
    // translated — the documented limit of a file-based catalogue.
    const subtitle = [trip.congregationName, trip.programName, trip.ministryName]
      .filter((p): p is string => !!p && p.trim().length > 0)
      .join(" · ");
    const subtitleHtml = subtitle
      ? `<p class="mtf-card-sub">${this.escapeHtml(subtitle)}</p>`
      : "";

    const dates = this.tripDates(trip);
    const datesHtml = dates
      ? `<p class="mtf-card-dates">${this.escapeHtml(dates)}</p>`
      : "";

    const registration = this.registrationLine(trip);
    const registrationHtml = registration
      ? `<p class="mtf-card-reg">${this.escapeHtml(registration)}</p>`
      : "";

    const spots = this.spotsLine(trip);
    const spotsHtml = spots ? `<p class="mtf-card-spots">${this.escapeHtml(spots)}</p>` : "";

    const description = trip.description
      ? `<p class="mtf-card-desc">${this.escapeHtml(this.truncate(trip.description, 160))}</p>`
      : "";

    const body = `
      <div class="mtf-card-imgwrap">${img}${badge}</div>
      <div class="mtf-card-body">
        <h3 class="mtf-card-title">${this.escapeHtml(trip.campaignName)}</h3>
        ${subtitleHtml}
        ${datesHtml}
        ${registrationHtml}
        ${spotsHtml}
        ${description}
        ${href ? `<span class="mtf-card-cta">${this.escapeHtml(this.t("common.seeDetails"))} &rarr;</span>` : ""}
      </div>`;

    // A real anchor, not a `role="link"` div — keyboard-activatable for free.
    return href
      ? `<a class="mtf-card" href="${this.escapeAttr(href)}" data-campaign-id="${trip.pledgeCampaignId}">${body}</a>`
      : `<article class="mtf-card" data-campaign-id="${trip.pledgeCampaignId}">${body}</article>`;
  }

  // ── Card text ───────────────────────────────────────────────────────────

  /**
   * The trip's own dates, always with the year (`C09`).
   *
   * `dateRangeCompact` writes the shared parts once ("Jun 4 – 11, 2027") and
   * falls back to two full dates where `Intl.formatRange` is unavailable.
   */
  private tripDates(trip: MissionTripCard): string {
    if (!trip.eventStartDate) return "";
    const range = trip.eventEndDate
      ? this.fmt.dateRangeCompact(trip.eventStartDate, trip.eventEndDate, "medium")
      : this.fmt.date(trip.eventStartDate, "medium");
    if (!range) return "";
    return this.t("missionTripFinder.tripDates", { dates: range });
  }

  /**
   * One line about the registration window, in the order a visitor cares
   * about: not open yet, closed, closing on a date, or simply open.
   */
  private registrationLine(trip: MissionTripCard): string {
    const today = this.startOfToday();
    const start = parseWallClock(trip.registrationStart);
    const end = parseWallClock(trip.registrationEnd);

    if (start && this.startOfDay(start).getTime() > today) {
      return this.t("missionTripFinder.registrationOpens", {
        date: this.fmt.date(start, "medium"),
      });
    }
    if (end && this.startOfDay(end).getTime() < today) {
      return this.t("missionTripFinder.registrationClosed");
    }
    if (end) {
      return this.t("missionTripFinder.registrationCloses", {
        date: this.fmt.date(end, "medium"),
      });
    }
    return this.t("missionTripFinder.openForRegistration");
  }

  /** Seats remaining, for a capped trip that still has some. */
  private spotsLine(trip: MissionTripCard): string {
    const max = trip.maximumRegistrants ?? 0;
    if (max <= 0 || trip.isFull) return "";
    const left = max - (trip.currentRegistrants ?? 0);
    if (left <= 0) return "";
    return this.t("missionTripFinder.spotsLeft", { count: left });
  }

  private startOfDay(d: Date): Date {
    const copy = new Date(d);
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  private startOfToday(): number {
    return this.startOfDay(new Date()).getTime();
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

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
    return `<svg class="mtf-spinner" viewBox="0 0 24 24" fill="none" width="20" height="20">
      <circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
      <path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
    </svg>`;
  }

  private globeSvg(): string {
    return `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
  }

  private getStyles(): string {
    return `
      :host { all: initial; display: block; font-family: var(--_nw-font-family); color: var(--_nw-color-text); }
      .mtf { max-width: 1024px; margin: 0 auto; }
      .mtf-title { font-size: 22px; font-weight: var(--_nw-font-weight-heading); color: var(--_nw-color-secondary); margin: 0 0 var(--_nw-space-4); }

      .mtf-form { display: flex; gap: var(--_nw-space-2); background: var(--_nw-color-surface); border: var(--_nw-border-width) solid var(--_nw-color-border); border-radius: var(--_nw-radius-lg); padding: var(--_nw-space-4); margin-bottom: var(--_nw-space-5); box-shadow: var(--_nw-shadow); }
      .mtf-input { flex: 1; padding: 10px var(--_nw-space-3); border: var(--_nw-border-width) solid var(--_nw-color-border-strong); border-radius: var(--_nw-radius); font-size: var(--_nw-font-size-base); font-family: inherit; color: var(--_nw-color-text); outline: none; }
      .mtf-input:focus { border-color: var(--_nw-color-primary); box-shadow: 0 0 0 1px var(--_nw-color-primary); }
      .mtf-btn { padding: 10px var(--_nw-space-5); background: var(--_nw-button-bg); color: var(--_nw-button-fg); border: none; border-radius: var(--_nw-button-radius); font-size: var(--_nw-font-size-base); font-weight: 600; cursor: pointer; font-family: inherit; white-space: nowrap; }
      .mtf-btn:hover { background: var(--_nw-button-bg-hover); }

      .mtf-count { font-size: 13px; color: var(--_nw-color-muted); margin: 0 0 var(--_nw-space-3); }
      .mtf-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--_nw-space-4); }

      .mtf-card { background: var(--_nw-color-surface); border: var(--_nw-border-width) solid var(--_nw-color-border); border-radius: var(--_nw-radius-lg); overflow: hidden; display: flex; flex-direction: column; box-shadow: var(--_nw-shadow); transition: border-color 0.15s, box-shadow 0.15s; text-decoration: none; color: inherit; }
      a.mtf-card:hover { border-color: var(--_nw-color-primary); box-shadow: var(--_nw-shadow-hover); }
      a.mtf-card:focus-visible { outline: 2px solid var(--_nw-color-primary); outline-offset: 2px; }
      .mtf-card-imgwrap { position: relative; }
      .mtf-card-img { width: 100%; height: 160px; object-fit: cover; display: block; }
      .mtf-card-img--placeholder { display: flex; align-items: center; justify-content: center; background: var(--_nw-color-surface-muted); color: #9ca3af; height: 160px; }
      .mtf-badge { position: absolute; top: 10px; left: 10px; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 9999px; text-transform: uppercase; letter-spacing: 0.03em; }
      .mtf-badge--full { background: var(--_nw-color-error); color: white; }

      .mtf-card-body { padding: var(--_nw-space-4); display: flex; flex-direction: column; flex: 1; }
      .mtf-card-title { font-size: 16px; font-weight: var(--_nw-font-weight-heading); color: var(--_nw-color-secondary); margin: 0 0 6px; }
      .mtf-card-sub { font-size: 13px; color: var(--_nw-color-primary); font-weight: 600; margin: 0 0 var(--_nw-space-2); }
      .mtf-card-dates { font-size: 13px; color: var(--_nw-color-text); margin: 0 0 var(--_nw-space-1); font-weight: 600; }
      .mtf-card-reg { font-size: 12px; color: var(--_nw-color-muted); margin: 0 0 var(--_nw-space-1); }
      .mtf-card-spots { font-size: 12px; color: #5a7a1a; font-weight: 600; margin: 0 0 var(--_nw-space-2); }
      .mtf-card-desc { font-size: 13px; color: var(--_nw-color-text-subtle); line-height: var(--_nw-line-height); flex: 1; margin: 0; }
      .mtf-card-cta { margin-top: var(--_nw-space-3); font-size: 13px; font-weight: 600; color: var(--_nw-color-primary); }

      .mtf-state { display: flex; align-items: center; justify-content: center; gap: var(--_nw-space-3); padding: 48px var(--_nw-space-4); color: var(--_nw-color-muted); font-size: 15px; flex-direction: column; text-align: center; }
      .mtf-spinner { animation: mtf-spin 1s linear infinite; color: var(--_nw-color-primary); }
      @keyframes mtf-spin { to { transform: rotate(360deg); } }
      .mtf-error p { color: var(--_nw-color-error-text); margin: 0; }

      @media (max-width: 1024px) { .mtf-grid { grid-template-columns: repeat(2, 1fr); } }
      @media (max-width: 640px) { .mtf-grid { grid-template-columns: 1fr; } }
    `;
  }
}

customElements.define("next-mission-trip-finder", MissionTripFinderWidget);
