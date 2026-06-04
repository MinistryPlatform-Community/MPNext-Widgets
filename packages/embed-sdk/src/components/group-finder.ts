import { MPNextWidget } from "../shared/base-widget";
import {
  validateForm,
  bindLiveValidation,
  requiredStar,
  FORM_VALIDATION_STYLES,
} from "../shared/form-validation";

interface GroupCard {
  id: number;
  title: string;
  description: string | null;
  imageUrl: string | null;
  noImageText: string | null;
  location: string | null;
  meetingDay: string | null;
  meetingTime: string | null;
  startDate: string | null;
  isFull: boolean;
  meetsOnline: boolean;
  totalParticipantsCount: number;
  targetSize: number | null;
}

interface FilterOption {
  id: number;
  name: string;
}

interface Configurations {
  congregations: FilterOption[];
  parentGroups: FilterOption[];
  groupFocuses: FilterOption[];
  lifeStages: FilterOption[];
}

const MEETING_DAYS: { value: number; label: string }[] = [
  { value: 1, label: "Sunday" },
  { value: 2, label: "Monday" },
  { value: 3, label: "Tuesday" },
  { value: 4, label: "Wednesday" },
  { value: 5, label: "Thursday" },
  { value: 6, label: "Friday" },
  { value: 7, label: "Saturday" },
];

const MEETING_TIMES: { value: string; label: string }[] = [
  { value: "morning", label: "Morning" },
  { value: "lunchtime", label: "Lunchtime" },
  { value: "afternoon", label: "Afternoon" },
  { value: "evening", label: "Evening" },
];

/**
 * `next-group-finder` — public, filterable group search rendering result cards
 * that deep-link to a group-details page, with an optional authenticated
 * "Suggest a Group" form.
 *
 * Migrated from the legacy `mpp-group-finder` portal widget. Filters the legacy
 * widget exposed as fixed attributes (congregation, ministry, parent group,
 * group focus, life stage, group type, keyword, meeting days/times, meets
 * online, show-full / show-future / count-inquiries) are all supported;
 * congregation/parent-group/city/focus/life-stage/day/time/online live behind
 * an "Advanced Search" toggle to match the legacy UX.
 */
export class GroupFinderWidget extends MPNextWidget {
  private groups: GroupCard[] = [];
  private config: Configurations = {
    congregations: [],
    parentGroups: [],
    groupFocuses: [],
    lifeStages: [],
  };
  private loading = true;
  private error: string | null = null;
  private advancedOpen = false;

  // Suggest-a-group view state.
  private suggestOpen = false;
  private suggestMessage: { type: string; text: string } | null = null;

  // Filter state (seeded from attributes, mutated by the form).
  private keyword = "";
  private congregationId = "";
  private parentGroupId = "";
  private cityPostalCode = "";
  private groupFocusId = "";
  private lifeStageId = "";
  private meetingDays: string[] = [];
  private meetingTimes: string[] = [];
  private meetsOnline = false;

  static get observedAttributes() {
    return [
      "api-host",
      "target-url",
      "id-parameter-name",
      "congregation-id",
      "ministry-id",
      "parent-group-id",
      "group-focus-id",
      "life-stage-id",
      "group-type-id",
      "keyword",
      "meeting-days",
      "meeting-times",
      "meets-online",
      "show-full-groups",
      "show-future-groups",
      "count-group-inquiries",
      "show-suggest-a-group-button",
    ];
  }

  attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null) {
    if (oldValue === newValue) return;
    if (this.groups.length || !this.loading) {
      this.seedFromAttributes();
      this.search();
    }
  }

  connectedCallback() {
    this.injectStyles(this.getStyles() + FORM_VALIDATION_STYLES);
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
    this.parentGroupId = this.getAttribute("parent-group-id") || "";
    this.groupFocusId = this.getAttribute("group-focus-id") || "";
    this.lifeStageId = this.getAttribute("life-stage-id") || "";
    this.meetsOnline = this.getAttribute("meets-online") === "true";
    this.meetingDays = this.csvAttr("meeting-days");
    this.meetingTimes = this.csvAttr("meeting-times");
  }

  private csvAttr(name: string): string[] {
    const raw = this.getAttribute(name);
    if (!raw) return [];
    return raw.split(",").map((v) => v.trim()).filter(Boolean);
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
    const res = await this.fetch(`/api/embed/group-finder/config`);
    if (!res.ok) return;
    const data = await res.json();
    this.config = {
      congregations: data.congregations || [],
      parentGroups: data.parentGroups || [],
      groupFocuses: data.groupFocuses || [],
      lifeStages: data.lifeStages || [],
    };
  }

  private buildQuery(): string {
    const params = new URLSearchParams();
    if (this.keyword) params.set("keyword", this.keyword);
    if (this.congregationId) params.set("congregationId", this.congregationId);
    if (this.parentGroupId) params.set("parentGroupId", this.parentGroupId);
    if (this.cityPostalCode) params.set("cityPostalCode", this.cityPostalCode);
    if (this.groupFocusId) params.set("groupFocusId", this.groupFocusId);
    if (this.lifeStageId) params.set("lifeStageId", this.lifeStageId);
    if (this.meetsOnline) params.set("meetsOnline", "true");
    for (const d of this.meetingDays) params.append("meetingDays", d);
    for (const t of this.meetingTimes) params.append("meetingTimes", t);

    const ministryId = this.getAttribute("ministry-id");
    if (ministryId) params.set("ministryId", ministryId);
    const groupTypeId = this.getAttribute("group-type-id");
    if (groupTypeId) params.set("groupTypeId", groupTypeId);
    if (this.getAttribute("show-full-groups") === "true") params.set("showFullGroups", "true");
    if (this.getAttribute("show-future-groups") === "true") params.set("showFutureGroups", "true");
    if (this.getAttribute("count-group-inquiries") === "true") params.set("countGroupInquiries", "true");

    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }

  private async search() {
    this.loading = true;
    this.error = null;
    this.render();

    try {
      const res = await this.fetch(`/api/embed/group-finder${this.buildQuery()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data: { groups: GroupCard[] } = await res.json();
      this.groups = data.groups || [];
      this.emit("groupsLoaded", { count: this.groups.length });
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Failed to load groups";
      this.emit("groupFinderError", { error: this.error });
    } finally {
      this.loading = false;
      this.render();
      this.attachListeners();
    }
  }

  // ── Detail link / selection ──

  private buildDetailUrl(groupId: number): string | null {
    const target = this.getAttribute("target-url");
    if (!target) return null;
    const idParam = this.getAttribute("id-parameter-name") || "id";
    try {
      const url = new URL(target, window.location.href);
      url.searchParams.set(idParam, String(groupId));
      return url.toString();
    } catch {
      const sep = target.includes("?") ? "&" : "?";
      return `${target}${sep}${idParam}=${groupId}`;
    }
  }

  // ── Listeners ──

  private attachListeners() {
    if (this.suggestOpen) {
      this.attachSuggestListeners();
      return;
    }

    const form = this.root.querySelector<HTMLFormElement>("#gf-form");
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
    if (retry) retry.addEventListener("click", () => this.retryLoad());

    const suggestBtn = this.root.querySelector('[data-action="open-suggest"]');
    if (suggestBtn) {
      suggestBtn.addEventListener("click", (e) => {
        e.preventDefault();
        this.suggestOpen = true;
        this.suggestMessage = null;
        this.render();
        this.attachListeners();
      });
    }

    // Card navigation / selection.
    this.root.querySelectorAll<HTMLElement>("[data-group-id]").forEach((el) => {
      el.addEventListener("click", () => {
        const id = Number(el.getAttribute("data-group-id"));
        this.emit("groupSelected", { groupId: id });
        const url = this.buildDetailUrl(id);
        if (url) window.location.href = url;
      });
    });
  }

  private attachSuggestListeners() {
    const back = this.root.querySelector('[data-action="suggest-back"]');
    if (back) {
      back.addEventListener("click", (e) => {
        e.preventDefault();
        this.suggestOpen = false;
        this.render();
        this.attachListeners();
      });
    }

    const form = this.root.querySelector<HTMLFormElement>("#gf-suggest-form");
    if (form) {
      bindLiveValidation(form);
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        this.submitSuggestion(form);
      });
    }
  }

  private readFormState() {
    const root = this.root;
    const get = (sel: string) => root.querySelector<HTMLInputElement | HTMLSelectElement>(sel);
    const kw = get("#gf-keyword");
    if (kw) this.keyword = kw.value.trim();
    const cong = get("#gf-congregation");
    if (cong) this.congregationId = cong.value;
    const parent = get("#gf-parent");
    if (parent) this.parentGroupId = parent.value;
    const city = get("#gf-city");
    if (city) this.cityPostalCode = city.value.trim();
    const focus = get("#gf-focus");
    if (focus) this.groupFocusId = focus.value;
    const life = get("#gf-life");
    if (life) this.lifeStageId = life.value;
    const online = root.querySelector<HTMLInputElement>("#gf-online");
    if (online) this.meetsOnline = online.checked;

    this.meetingDays = Array.from(
      root.querySelectorAll<HTMLInputElement>('input[name="meetingDays"]:checked')
    ).map((el) => el.value);
    this.meetingTimes = Array.from(
      root.querySelectorAll<HTMLInputElement>('input[name="meetingTimes"]:checked')
    ).map((el) => el.value);
  }

  // ── Suggest a group ──

  private async submitSuggestion(form: HTMLFormElement) {
    if (!validateForm(form).valid) {
      this.setSuggestMessage("danger", "Please complete the required fields.");
      return;
    }
    const fd = new FormData(form);
    const num = (key: string): number | null => {
      const v = String(fd.get(key) || "").trim();
      return v ? Number(v) : null;
    };
    const payload = {
      groupName: String(fd.get("groupName") || "").trim(),
      description: String(fd.get("description") || "").trim(),
      newGroupCongregationId: num("newGroupCongregationId"),
      newGroupGroupFocusId: num("newGroupGroupFocusId"),
      newGroupLifeStageId: num("newGroupLifeStageId"),
      newGroupMeetingDayId: num("newGroupMeetingDayId"),
      newGroupMeetingTime: String(fd.get("newGroupMeetingTime") || "").trim() || null,
    };

    const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    try {
      const res = await this.fetch(`/api/embed/group-finder/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data: { success: boolean; message?: string } = await res
        .json()
        .catch(() => ({ success: false }));

      if (res.status === 401) {
        this.setSuggestMessage("warning", "Please sign in to suggest a group.");
        this.emit("loginRequired");
        if (submitBtn) submitBtn.disabled = false;
        return;
      }
      if (!data.success) {
        this.setSuggestMessage("danger", data.message || "Unable to submit your suggestion.");
        if (submitBtn) submitBtn.disabled = false;
        return;
      }

      form.reset();
      this.emit("groupSuggested", {});
      this.setSuggestMessage("success", "Thanks! Your group suggestion has been submitted.");
      if (submitBtn) submitBtn.disabled = false;
    } catch (err) {
      this.setSuggestMessage("danger", err instanceof Error ? err.message : "Submission failed.");
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  private setSuggestMessage(type: string, text: string) {
    this.suggestMessage = { type, text };
    const el = this.root.querySelector<HTMLElement>("#gf-suggest-message");
    if (el) {
      el.className = `gf-message gf-message--${type}`;
      el.textContent = text;
      el.style.display = "";
    } else {
      this.render();
      this.attachListeners();
    }
  }

  // ── Render ──

  render() {
    if (this.suggestOpen) {
      this.root.innerHTML = `<div class="nw-gf">${this.renderSuggestForm()}</div>`;
      return;
    }
    this.root.innerHTML = `
      <div class="nw-gf">
        ${this.renderSearchForm()}
        <div class="nw-gf-results">
          ${this.renderResults()}
        </div>
        ${this.renderSuggestButton()}
      </div>`;
  }

  private optionList(list: FilterOption[], selected: string, placeholder: string): string {
    return [`<option value="">${this.escapeHtml(placeholder)}</option>`]
      .concat(
        list.map(
          (o) =>
            `<option value="${o.id}" ${String(o.id) === selected ? "selected" : ""}>${this.escapeHtml(o.name)}</option>`
        )
      )
      .join("");
  }

  private renderSearchForm(): string {
    const dayChecks = MEETING_DAYS.map(
      (d) =>
        `<label class="nw-gf-check"><input type="checkbox" name="meetingDays" value="${d.value}" ${this.meetingDays.includes(String(d.value)) ? "checked" : ""}> ${d.label}</label>`
    ).join("");
    const timeChecks = MEETING_TIMES.map(
      (t) =>
        `<label class="nw-gf-check"><input type="checkbox" name="meetingTimes" value="${t.value}" ${this.meetingTimes.includes(t.value) ? "checked" : ""}> ${t.label}</label>`
    ).join("");

    return `
      <form id="gf-form" class="nw-gf-form">
        <div class="nw-gf-search-row">
          <input
            id="gf-keyword"
            type="text"
            class="nw-gf-input"
            placeholder="Search groups…"
            value="${this.escapeAttr(this.keyword)}"
            aria-label="Search groups">
          <button type="submit" class="nw-gf-btn">Search</button>
        </div>
        <a href="#" class="nw-gf-advanced-link" data-action="toggle-advanced">
          ${this.advancedOpen ? "Hide Advanced Search" : "Advanced Search"}
        </a>
        <div class="nw-gf-advanced" style="display:${this.advancedOpen ? "grid" : "none"}">
          <div class="nw-gf-field">
            <label for="gf-congregation">Congregation</label>
            <select id="gf-congregation" class="nw-gf-select">
              ${this.optionList(this.config.congregations, this.congregationId, "All Congregations")}
            </select>
          </div>
          <div class="nw-gf-field">
            <label for="gf-parent">Neighborhood</label>
            <select id="gf-parent" class="nw-gf-select">
              ${this.optionList(this.config.parentGroups, this.parentGroupId, "All Neighborhoods")}
            </select>
          </div>
          <div class="nw-gf-field">
            <label for="gf-city">City or Postal Code</label>
            <input id="gf-city" type="text" class="nw-gf-input" value="${this.escapeAttr(this.cityPostalCode)}">
          </div>
          <div class="nw-gf-field">
            <label for="gf-focus">Group Focus</label>
            <select id="gf-focus" class="nw-gf-select">
              ${this.optionList(this.config.groupFocuses, this.groupFocusId, "All Focuses")}
            </select>
          </div>
          <div class="nw-gf-field">
            <label for="gf-life">Life Stage</label>
            <select id="gf-life" class="nw-gf-select">
              ${this.optionList(this.config.lifeStages, this.lifeStageId, "All Life Stages")}
            </select>
          </div>
          <div class="nw-gf-field nw-gf-field--full">
            <label>Meeting Days</label>
            <div class="nw-gf-checks">${dayChecks}</div>
          </div>
          <div class="nw-gf-field nw-gf-field--full">
            <label>Meeting Times</label>
            <div class="nw-gf-checks">${timeChecks}</div>
          </div>
          <div class="nw-gf-field">
            <label class="nw-gf-check"><input type="checkbox" id="gf-online" ${this.meetsOnline ? "checked" : ""}> Meets Online</label>
          </div>
        </div>
      </form>`;
  }

  private renderResults(): string {
    if (this.loading) {
      return `<div class="nw-gf-state">${this.spinnerSvg()}<span>Loading groups…</span></div>`;
    }
    if (this.error) {
      return `
        <div class="nw-gf-state nw-gf-error">
          <p>${this.escapeHtml(this.error)}</p>
          <button class="nw-gf-btn" data-action="retry">Try Again</button>
        </div>`;
    }
    if (this.groups.length === 0) {
      return `<div class="nw-gf-state nw-gf-empty">No groups found.</div>`;
    }
    const grid = `<div class="nw-gf-grid">${this.groups.map((g) => this.renderCard(g)).join("")}</div>`;
    // Mirror the legacy "showing first results" hint when many groups match.
    const more =
      this.groups.length > 20
        ? `<div class="nw-gf-more">Showing the first results — refine your search to narrow them down.</div>`
        : "";
    return grid + more;
  }

  private renderCard(g: GroupCard): string {
    const hasLink = !!this.getAttribute("target-url");
    const img = g.imageUrl
      ? `<img class="nw-gf-card-img" src="${this.escapeAttr(g.imageUrl)}" alt="" loading="lazy">`
      : `<div class="nw-gf-card-img nw-gf-card-img--placeholder">${this.escapeHtml(g.noImageText || "Group")}</div>`;

    const badges: string[] = [];
    if (g.isFull) badges.push(`<span class="nw-gf-badge nw-gf-badge--full">Full</span>`);
    if (g.meetsOnline) badges.push(`<span class="nw-gf-badge nw-gf-badge--online">Meets Online</span>`);

    const subtitles: string[] = [];
    if (g.location) subtitles.push(this.escapeHtml(g.location));
    const dayTime = [g.meetingDay, this.formatMeetingTime(g.meetingTime)]
      .filter(Boolean)
      .join(" · ");
    if (dayTime) subtitles.push(this.escapeHtml(dayTime));
    const start = this.formatStart(g.startDate);
    if (start) subtitles.push(this.escapeHtml(start));
    const capacity = this.capacityLabel(g);
    if (capacity) subtitles.push(this.escapeHtml(capacity));

    const subtitleHtml = subtitles
      .map((s) => `<div class="nw-gf-card-sub">${s}</div>`)
      .join("");
    const description = g.description
      ? `<div class="nw-gf-card-desc">${this.escapeHtml(this.truncate(g.description, 160))}</div>`
      : "";

    return `
      <div class="nw-gf-card" data-group-id="${g.id}" role="${hasLink ? "link" : "article"}" ${hasLink ? 'tabindex="0"' : ""}>
        <div class="nw-gf-card-imgwrap">${img}<div class="nw-gf-badges">${badges.join("")}</div></div>
        <div class="nw-gf-card-body">
          <h3 class="nw-gf-card-title">${this.escapeHtml(g.title)}</h3>
          ${subtitleHtml}
          ${description}
          ${hasLink ? `<span class="nw-gf-card-cta">See Details &rarr;</span>` : ""}
        </div>
      </div>`;
  }

  private capacityLabel(g: GroupCard): string {
    if (g.isFull || (g.targetSize != null && g.totalParticipantsCount >= g.targetSize)) {
      return "Full";
    }
    if (g.targetSize != null && g.totalParticipantsCount < g.targetSize) {
      return `${g.totalParticipantsCount} of ${g.targetSize}`;
    }
    return "";
  }

  private renderSuggestButton(): string {
    if (this.getAttribute("show-suggest-a-group-button") !== "true") return "";
    if (this.loading || this.error) return "";
    return `
      <div class="nw-gf-suggest-cta">
        <button type="button" class="nw-gf-btn nw-gf-btn--secondary" data-action="open-suggest">Suggest a Group</button>
      </div>`;
  }

  private renderSuggestForm(): string {
    const message = this.suggestMessage
      ? `<div id="gf-suggest-message" class="gf-message gf-message--${this.escapeAttr(this.suggestMessage.type)}">${this.escapeHtml(this.suggestMessage.text)}</div>`
      : `<div id="gf-suggest-message" class="gf-message" style="display:none"></div>`;

    const dayOptions = [`<option value="">Any Day</option>`]
      .concat(MEETING_DAYS.map((d) => `<option value="${d.value}">${d.label}</option>`))
      .join("");

    return `
      <a href="#" class="nw-gf-advanced-link" data-action="suggest-back">&larr; Back to results</a>
      <h2 class="nw-gf-suggest-title">Suggest a Group</h2>
      ${message}
      <form id="gf-suggest-form" class="nw-gf-suggest" novalidate>
        <div class="nw-gf-field">
          <label for="gf-s-name">Group Name${requiredStar()}</label>
          <input id="gf-s-name" class="nw-gf-input" name="groupName" required>
        </div>
        <div class="nw-gf-field">
          <label for="gf-s-desc">Description${requiredStar()}</label>
          <textarea id="gf-s-desc" class="nw-gf-input" name="description" required></textarea>
        </div>
        <div class="nw-gf-field">
          <label for="gf-s-cong">Congregation${requiredStar()}</label>
          <select id="gf-s-cong" class="nw-gf-select" name="newGroupCongregationId" required>
            ${this.optionList(this.config.congregations, "", "Select a congregation")}
          </select>
        </div>
        <div class="nw-gf-field">
          <label for="gf-s-focus">Group Focus</label>
          <select id="gf-s-focus" class="nw-gf-select" name="newGroupGroupFocusId">
            ${this.optionList(this.config.groupFocuses, "", "None")}
          </select>
        </div>
        <div class="nw-gf-field">
          <label for="gf-s-life">Life Stage</label>
          <select id="gf-s-life" class="nw-gf-select" name="newGroupLifeStageId">
            ${this.optionList(this.config.lifeStages, "", "None")}
          </select>
        </div>
        <div class="nw-gf-field">
          <label for="gf-s-day">Meeting Day</label>
          <select id="gf-s-day" class="nw-gf-select" name="newGroupMeetingDayId">${dayOptions}</select>
        </div>
        <div class="nw-gf-field">
          <label for="gf-s-time">Meeting Time</label>
          <input id="gf-s-time" class="nw-gf-input" type="time" name="newGroupMeetingTime">
        </div>
        <div class="nw-gf-suggest-actions">
          <button type="submit" class="nw-gf-btn">Submit Suggestion</button>
        </div>
      </form>`;
  }

  // ── Date / text helpers ──

  private parseMpDate(value: string | null): Date | null {
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

  private formatStart(value: string | null): string {
    const d = this.parseMpDate(value);
    if (!d) return "";
    if (d.getTime() < Date.now()) return "Already meeting";
    return `Starts ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  }

  /** Format an MP time-of-day string ("18:30:00" or "1900-01-01T18:30:00"). */
  private formatMeetingTime(value: string | null): string {
    if (!value) return "";
    const m = value.match(/(\d{2}):(\d{2})/);
    if (!m) return "";
    const d = new Date(1900, 0, 1, Number(m[1]), Number(m[2]));
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
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
    return `<svg class="nw-gf-spinner" viewBox="0 0 24 24" fill="none" width="20" height="20">
      <circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
      <path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
    </svg>`;
  }

  private getStyles(): string {
    return `
      :host { all: initial; display: block; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color: #2D2926; }
      .nw-gf { max-width: 1024px; margin: 0 auto; }

      .nw-gf-form { background: white; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; margin-bottom: 20px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
      .nw-gf-search-row { display: flex; gap: 8px; }
      .nw-gf-input { flex: 1; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; font-family: inherit; color: #2D2926; outline: none; }
      .nw-gf-input:focus { border-color: #004C97; box-shadow: 0 0 0 1px #004C97; }
      textarea.nw-gf-input { min-height: 80px; resize: vertical; }
      .nw-gf-btn { padding: 10px 20px; background: #004C97; color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; white-space: nowrap; }
      .nw-gf-btn:hover { background: #002855; }
      .nw-gf-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .nw-gf-btn--secondary { background: #009CDE; }
      .nw-gf-btn--secondary:hover { background: #007bb0; }
      .nw-gf-advanced-link { display: inline-block; margin-top: 12px; font-size: 13px; color: #004C97; text-decoration: none; cursor: pointer; font-weight: 600; }
      .nw-gf-advanced-link:hover { text-decoration: underline; }
      .nw-gf-advanced { margin-top: 16px; gap: 12px; grid-template-columns: repeat(2, 1fr); }
      .nw-gf-field { display: flex; flex-direction: column; gap: 4px; }
      .nw-gf-field--full { grid-column: 1 / -1; }
      .nw-gf-field label { font-size: 12px; font-weight: 600; color: #6b7280; }
      .nw-gf-select { padding: 9px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; font-family: inherit; color: #2D2926; background: white; outline: none; cursor: pointer; }
      .nw-gf-select:focus { border-color: #004C97; }
      .nw-gf-checks { display: flex; flex-wrap: wrap; gap: 8px 16px; }
      .nw-gf-check { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: #2D2926; font-weight: 500; }
      .nw-gf-check input { width: auto; }

      .nw-gf-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
      .nw-gf-card { background: white; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 1px 2px rgba(0,0,0,0.05); transition: border-color 0.15s, box-shadow 0.15s; }
      .nw-gf-card[role="link"] { cursor: pointer; }
      .nw-gf-card[role="link"]:hover { border-color: #004C97; box-shadow: 0 4px 10px rgba(0,0,0,0.08); }
      .nw-gf-card[role="link"]:focus-visible { outline: 2px solid #004C97; outline-offset: 2px; }
      .nw-gf-card-imgwrap { position: relative; }
      .nw-gf-card-img { width: 100%; height: 160px; object-fit: cover; display: block; }
      .nw-gf-card-img--placeholder { display: flex; align-items: center; justify-content: center; background: #f3f4f6; color: #6b7280; font-weight: 600; font-size: 14px; text-align: center; padding: 8px; }
      .nw-gf-badges { position: absolute; top: 10px; left: 10px; display: flex; flex-wrap: wrap; gap: 6px; }
      .nw-gf-badge { font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 9999px; text-transform: uppercase; letter-spacing: 0.03em; }
      .nw-gf-badge--full { background: #FF6D6A; color: white; }
      .nw-gf-badge--online { background: #009CDE; color: white; }
      .nw-gf-card-body { padding: 16px; display: flex; flex-direction: column; flex: 1; }
      .nw-gf-card-title { font-size: 16px; font-weight: 700; color: #002855; margin: 0 0 6px; }
      .nw-gf-card-sub { font-size: 13px; color: #004C97; font-weight: 600; margin-bottom: 2px; }
      .nw-gf-card-desc { font-size: 13px; color: #474747; line-height: 1.5; flex: 1; margin-top: 6px; }
      .nw-gf-card-cta { margin-top: 12px; font-size: 13px; font-weight: 600; color: #004C97; }

      .nw-gf-more { text-align: center; color: #6b7280; font-size: 13px; margin-top: 16px; }
      .nw-gf-suggest-cta { text-align: center; margin-top: 24px; }

      .nw-gf-suggest-title { font-size: 22px; font-weight: 800; color: #002855; margin: 12px 0 16px; }
      .nw-gf-suggest { background: white; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; display: flex; flex-direction: column; gap: 14px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
      .nw-gf-suggest-actions { margin-top: 4px; }

      .gf-message { padding: 12px 16px; border-radius: 8px; font-size: 14px; margin-bottom: 16px; }
      .gf-message--success { background: #ecf6e0; color: #4d6b1f; }
      .gf-message--warning { background: #fdf6e3; color: #8a6d3b; }
      .gf-message--danger { background: #ffe9e9; color: #b91c1c; }

      .nw-gf-state { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 48px 16px; color: #6b7280; font-size: 15px; flex-direction: column; text-align: center; }
      .nw-gf-spinner { animation: nw-gf-spin 1s linear infinite; color: #004C97; }
      @keyframes nw-gf-spin { to { transform: rotate(360deg); } }
      .nw-gf-error p { color: #b91c1c; margin: 0; }

      @media (max-width: 1024px) { .nw-gf-grid { grid-template-columns: repeat(2, 1fr); } }
      @media (max-width: 640px) {
        .nw-gf-grid { grid-template-columns: 1fr; }
        .nw-gf-advanced { grid-template-columns: 1fr; }
      }
    `;
  }
}

customElements.define("next-group-finder", GroupFinderWidget);
