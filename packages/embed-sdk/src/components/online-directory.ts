import { MPNextWidget } from "../shared/base-widget";
import {
  validateForm,
  bindLiveValidation,
  requiredStar,
  FORM_VALIDATION_STYLES,
} from "../shared/form-validation";

interface FilterOption {
  id: number;
  name: string;
}

interface DirectoryConfig {
  congregations: FilterOption[];
  minimumSearchLength: number;
  searchInputTimeout: number;
  householdPrefix: string;
}

interface DirectoryMember {
  contactId: number;
  displayName: string;
  householdPosition: string | null;
  householdId: number | null;
  householdName: string | null;
  congregationId: number | null;
  contactImageUrl: string | null;
  mobilePhone: string | null;
  homePhone: string | null;
  canEmail: boolean;
  dateOfBirthShort: string | null;
  dateOfBirthMonthDay: string | null;
  address: string | null;
}

type AccessState = "checking" | "login" | "denied" | "ok" | "error";

/**
 * `next-online-directory` — authenticated member directory search.
 *
 * Ported from the legacy `mpp-online-directory` portal widget. Requires a
 * signed-in user whose participant type / member status grant directory access
 * (gated server-side). Supports debounced keyword search, congregation filter,
 * a "filter by family" household chip, and member cards with phone, birthday
 * (ICS), map, family, and a compose-email action (the recipient address stays
 * server-side). Visibility toggles mirror the legacy hide-* attributes.
 */
export class OnlineDirectoryWidget extends MPNextWidget {
  private config: DirectoryConfig = {
    congregations: [],
    minimumSearchLength: 3,
    searchInputTimeout: 1000,
    householdPrefix: "hh ",
  };
  private members: DirectoryMember[] = [];
  private access: AccessState = "checking";
  private error: string | null = null;

  private keyword = "";
  private congregationId = "";
  private householdFilter: { id: number; name: string } | null = null;

  private composeFor: number | null = null;
  private emailSentFor = new Set<number>();

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private searching = false;

  static get observedAttributes() {
    return [
      "api-host",
      "congregation-id",
      "keyword",
      "hide-address",
      "hide-email",
      "hide-family-link",
      "hide-birthday-icon",
    ];
  }

  attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null) {
    if (oldValue === newValue) return;
    if (this.access === "ok") {
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

  /** Public hook so demo pages can force a reload (e.g. after sign-in). */
  public retryLoad() {
    this.error = null;
    this.init();
  }

  // ── Attribute helpers ──

  private boolAttr(name: string): boolean {
    return (this.getAttribute(name) || "").toLowerCase() === "true";
  }
  private get hideAddress(): boolean {
    return this.boolAttr("hide-address");
  }
  private get hideEmail(): boolean {
    return this.boolAttr("hide-email");
  }
  private get hideFamilyLink(): boolean {
    return this.boolAttr("hide-family-link");
  }
  private get hideBirthdayIcon(): boolean {
    return this.boolAttr("hide-birthday-icon");
  }

  private seedFromAttributes() {
    this.keyword = this.getAttribute("keyword") || "";
    this.congregationId = this.getAttribute("congregation-id") || "";
  }

  // ── Init / access ──

  private async init() {
    this.access = "checking";
    this.error = null;
    this.render();

    try {
      const res = await this.fetch(`/api/embed/online-directory/access`);
      if (res.status === 401) {
        this.access = "login";
        this.render();
        this.attachShellListeners();
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: { canAccess: boolean } = await res.json();
      if (!data.canAccess) {
        this.access = "denied";
        this.render();
        return;
      }
    } catch (err) {
      this.access = "error";
      this.error = err instanceof Error ? err.message : "Unable to load the directory.";
      this.render();
      this.attachShellListeners();
      this.emit("directoryError", { error: this.error });
      return;
    }

    // Access granted — load config, build the form, show the prompt.
    try {
      await this.loadConfig();
    } catch {
      /* dropdown stays empty if config fails */
    }
    this.access = "ok";
    this.emit("directoryReady", {});
    this.render();
    this.attachFormListeners();

    // Initial state: prompt for a search (or run one if attributes seeded it).
    if (this.keyword.trim().length >= this.config.minimumSearchLength) {
      this.search();
    } else {
      this.showResultsMessage("info", `Enter at least ${this.config.minimumSearchLength} characters to search the directory.`);
    }
  }

  private async loadConfig() {
    const res = await this.fetch(`/api/embed/online-directory/config`);
    if (!res.ok) return;
    const data: DirectoryConfig = await res.json();
    this.config = {
      congregations: data.congregations || [],
      minimumSearchLength: data.minimumSearchLength ?? 3,
      searchInputTimeout: data.searchInputTimeout ?? 1000,
      householdPrefix: data.householdPrefix || "hh ",
    };
  }

  // ── Search ──

  private readFormState() {
    const kw = this.root.querySelector<HTMLInputElement>("#od-keyword");
    if (kw) this.keyword = kw.value;
    const cong = this.root.querySelector<HTMLSelectElement>("#od-congregation");
    if (cong) this.congregationId = cong.value;
  }

  private async search() {
    this.readFormState();
    const keyword = this.keyword.trim();

    // Typing past a household chip clears it.
    if (this.householdFilter && !keyword.startsWith(this.config.householdPrefix)) {
      this.householdFilter = null;
    }

    if (keyword.length < this.config.minimumSearchLength) {
      this.members = [];
      this.updateChip();
      this.showResultsMessage("info", `Enter at least ${this.config.minimumSearchLength} characters to search the directory.`);
      return;
    }

    this.searching = true;
    this.showResultsMessage("loading", "");

    try {
      const params = new URLSearchParams({ keyword });
      if (this.congregationId) params.set("congregationId", this.congregationId);
      const res = await this.fetch(`/api/embed/online-directory?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data: { members: DirectoryMember[] } = await res.json();
      this.members = data.members || [];
      this.emit("directorySearched", { count: this.members.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Search failed.";
      this.emit("directoryError", { error: msg });
      this.showResultsMessage("warning", msg);
      this.searching = false;
      return;
    }

    this.searching = false;
    this.composeFor = null;
    this.updateChip();
    this.updateResults();
  }

  // ── Listeners ──

  private attachShellListeners() {
    const login = this.root.querySelector('[data-action="login"]');
    if (login) login.addEventListener("click", () => this.requestLogin("online-directory"));
    const retry = this.root.querySelector('[data-action="retry"]');
    if (retry) retry.addEventListener("click", () => this.retryLoad());
  }

  private attachFormListeners() {
    const form = this.root.querySelector<HTMLFormElement>("#od-form");
    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        this.search();
      });
    }
    const cong = this.root.querySelector<HTMLSelectElement>("#od-congregation");
    if (cong) cong.addEventListener("change", () => this.search());

    const kw = this.root.querySelector<HTMLInputElement>("#od-keyword");
    if (kw) {
      kw.addEventListener("keyup", () => {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => this.search(), this.config.searchInputTimeout);
      });
    }

    const chipClear = this.root.querySelector('[data-action="clear-household"]');
    if (chipClear) {
      chipClear.addEventListener("click", (e) => {
        e.preventDefault();
        this.householdFilter = null;
        const input = this.root.querySelector<HTMLInputElement>("#od-keyword");
        if (input) input.value = "";
        this.keyword = "";
        this.search();
      });
    }
  }

  /** Bind listeners inside the (re-rendered) results area only. */
  private attachResultsListeners() {
    // Filter by household (family link).
    this.root.querySelectorAll<HTMLElement>('[data-action="filter-household"]').forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        const id = Number(el.getAttribute("data-household-id"));
        const name = el.getAttribute("data-household-name") || "";
        if (!id) return;
        this.householdFilter = { id, name };
        const input = this.root.querySelector<HTMLInputElement>("#od-keyword");
        if (input) input.value = `${this.config.householdPrefix}${id}`;
        this.keyword = `${this.config.householdPrefix}${id}`;
        this.search();
      });
    });

    // Toggle compose-email panel.
    this.root.querySelectorAll<HTMLElement>('[data-action="email"]').forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        const id = Number(el.getAttribute("data-contact-id"));
        this.composeFor = this.composeFor === id ? null : id;
        this.updateResults();
      });
    });
    this.root.querySelectorAll<HTMLElement>('[data-action="cancel-email"]').forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        this.composeFor = null;
        this.updateResults();
      });
    });
    this.root.querySelectorAll<HTMLElement>('[data-action="send-email"]').forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        const id = Number(el.getAttribute("data-contact-id"));
        this.sendEmail(id);
      });
    });
  }

  private async sendEmail(contactId: number) {
    const form = this.root.querySelector<HTMLFormElement>(`#od-email-form-${contactId}`);
    if (!form) return;
    if (!validateForm(form).valid) return;

    const subject = form.querySelector<HTMLInputElement>('[name="subject"]')?.value.trim() || "";
    const body = form.querySelector<HTMLTextAreaElement>('[name="body"]')?.value.trim() || "";

    const sendBtn = form.querySelector<HTMLButtonElement>('[data-action="send-email"]');
    if (sendBtn) sendBtn.disabled = true;

    try {
      const res = await this.fetch(`/api/embed/online-directory/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toContactId: contactId, subject, body }),
      });
      const data: { success: boolean; message?: string } = await res
        .json()
        .catch(() => ({ success: false }));
      if (!data.success) throw new Error(data.message || "Unable to send the message.");
      this.emailSentFor.add(contactId);
      this.composeFor = null;
      this.emit("directoryEmailSent", { contactId });
      this.updateResults();
    } catch (err) {
      const errEl = form.querySelector<HTMLElement>(".nw-od-email-error");
      if (errEl) errEl.textContent = err instanceof Error ? err.message : "Unable to send the message.";
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  // ── Render ──

  render() {
    if (this.access === "checking") {
      this.root.innerHTML = `<div class="nw-od">${this.state(this.spinnerSvg(), "Loading directory…")}</div>`;
      return;
    }
    if (this.access === "login") {
      this.root.innerHTML = `
        <div class="nw-od">
          <div class="nw-od-panel">
            <p>Please sign in to view the directory.</p>
            <button class="nw-od-btn" data-action="login">Sign In</button>
          </div>
        </div>`;
      return;
    }
    if (this.access === "denied") {
      this.root.innerHTML = `
        <div class="nw-od">
          <div class="nw-od-msg nw-od-msg--warning">You do not have access to the directory.</div>
        </div>`;
      return;
    }
    if (this.access === "error") {
      this.root.innerHTML = `
        <div class="nw-od">
          <div class="nw-od-msg nw-od-msg--warning">${this.escapeHtml(this.error || "Unable to load the directory.")}</div>
          <button class="nw-od-btn" data-action="retry">Try Again</button>
        </div>`;
      return;
    }

    // access === "ok"
    const congOptions = [`<option value="">All Congregations</option>`]
      .concat(
        this.config.congregations.map(
          (c) =>
            `<option value="${c.id}" ${String(c.id) === this.congregationId ? "selected" : ""}>${this.escapeHtml(c.name)}</option>`
        )
      )
      .join("");

    this.root.innerHTML = `
      <div class="nw-od">
        <h2 class="nw-od-title">Directory</h2>
        <form id="od-form" class="nw-od-form">
          <div class="nw-od-field">
            <label for="od-congregation">Congregation</label>
            <select id="od-congregation" class="nw-od-select">${congOptions}</select>
          </div>
          <div class="nw-od-field">
            <label for="od-keyword">Search by name, phone, or email</label>
            <div class="nw-od-search">
              <input id="od-keyword" type="search" class="nw-od-input" autocomplete="off"
                placeholder="Type at least ${this.config.minimumSearchLength} characters…"
                value="${this.escapeAttr(this.keyword)}">
              <div id="od-chip" class="nw-od-chip" style="display:none">
                <span id="od-chip-name"></span>
                <button type="button" class="nw-od-chip-clear" data-action="clear-household" aria-label="Clear family filter">&times;</button>
              </div>
            </div>
          </div>
        </form>
        <div id="od-results" class="nw-od-results"></div>
      </div>`;
  }

  private updateChip() {
    const chip = this.root.querySelector<HTMLElement>("#od-chip");
    const name = this.root.querySelector<HTMLElement>("#od-chip-name");
    if (!chip || !name) return;
    if (this.householdFilter) {
      chip.style.display = "";
      name.textContent = `${this.householdFilter.name} Family`.trim();
    } else {
      chip.style.display = "none";
    }
  }

  private showResultsMessage(type: "loading" | "info" | "warning", text: string) {
    const container = this.root.querySelector<HTMLElement>("#od-results");
    if (!container) return;
    if (type === "loading") {
      container.innerHTML = `<div class="nw-od-state">${this.spinnerSvg()}<span>Searching…</span></div>`;
      return;
    }
    container.innerHTML = `<div class="nw-od-msg nw-od-msg--${type}">${this.escapeHtml(text)}</div>`;
  }

  private updateResults() {
    const container = this.root.querySelector<HTMLElement>("#od-results");
    if (!container) return;

    if (this.members.length === 0) {
      container.innerHTML = `<div class="nw-od-msg nw-od-msg--warning">No results found.</div>`;
      return;
    }

    const cards = this.members.map((m) => this.renderCard(m)).join("");
    const viewMore =
      this.members.length > 20
        ? `<div class="nw-od-msg nw-od-msg--info">Showing the first results — refine your search to narrow them down.</div>`
        : "";
    container.innerHTML = `<div class="nw-od-grid">${cards}</div>${viewMore}`;
    this.attachResultsListeners();
    // Live-validate any open compose form.
    const openForm = this.root.querySelector<HTMLFormElement>("[id^='od-email-form-']");
    if (openForm) bindLiveValidation(openForm);
  }

  private renderCard(m: DirectoryMember): string {
    const img = m.contactImageUrl
      ? `<img class="nw-od-card-img" src="${this.escapeAttr(m.contactImageUrl)}" alt="" loading="lazy">`
      : `<div class="nw-od-card-img nw-od-card-img--placeholder">${this.personSvg()}</div>`;

    const position = m.householdPosition
      ? `<div class="nw-od-card-pos">${this.escapeHtml(m.householdPosition)}</div>`
      : "";

    const phones: string[] = [];
    if (m.mobilePhone) phones.push(`<span class="nw-od-phone"><b>m:</b> ${this.phoneLink(m.mobilePhone)}</span>`);
    if (m.homePhone) phones.push(`<span class="nw-od-phone"><b>h:</b> ${this.phoneLink(m.homePhone)}</span>`);
    const phonesHtml = phones.length ? `<div class="nw-od-phones">${phones.join("")}</div>` : "";

    const actions: string[] = [];
    if (!this.hideBirthdayIcon && m.dateOfBirthMonthDay && m.dateOfBirthShort) {
      const href = this.buildBirthdayIcs(m.displayName, m.dateOfBirthMonthDay);
      actions.push(
        `<a class="nw-od-action" href="${href}" download="birthday.ics" title="Add birthday to calendar">${this.cakeSvg()}<span>${this.escapeHtml(m.dateOfBirthShort)}</span></a>`
      );
    }
    if (!this.hideEmail && m.canEmail) {
      const sent = this.emailSentFor.has(m.contactId);
      actions.push(
        `<a class="nw-od-action" href="#" data-action="email" data-contact-id="${m.contactId}" title="Email">${this.mailSvg()}<span>${sent ? "Sent" : "Email"}</span></a>`
      );
    }
    if (!this.hideAddress && m.address) {
      const q = encodeURIComponent(m.address);
      actions.push(
        `<a class="nw-od-action" href="https://www.google.com/maps?q=${q}" target="_blank" rel="noopener" title="${this.escapeAttr(m.address)}">${this.mapSvg()}<span>Map</span></a>`
      );
    }
    if (!this.hideFamilyLink && m.householdId && m.householdId > 0) {
      actions.push(
        `<a class="nw-od-action" href="#" data-action="filter-household" data-household-id="${m.householdId}" data-household-name="${this.escapeAttr(m.householdName || "")}" title="View family">${this.familySvg()}<span>Family</span></a>`
      );
    }
    const actionsHtml = actions.length ? `<div class="nw-od-actions">${actions.join("")}</div>` : "";

    const compose = this.composeFor === m.contactId ? this.renderCompose(m) : "";

    return `
      <div class="nw-od-card" id="od-card-${m.contactId}">
        <div class="nw-od-card-row">
          <div class="nw-od-card-imgwrap">${img}</div>
          <div class="nw-od-card-body">
            <h3 class="nw-od-card-name">${this.escapeHtml(m.displayName)}</h3>
            ${position}
            ${phonesHtml}
          </div>
        </div>
        ${actionsHtml}
        ${compose}
      </div>`;
  }

  private renderCompose(m: DirectoryMember): string {
    return `
      <form id="od-email-form-${m.contactId}" class="nw-od-email" novalidate>
        <div class="nw-od-email-title">Email ${this.escapeHtml(m.displayName)}</div>
        <div class="nw-od-field">
          <label>Subject${requiredStar()}</label>
          <input class="nw-od-input" name="subject" required>
        </div>
        <div class="nw-od-field">
          <label>Message${requiredStar()}</label>
          <textarea class="nw-od-input" name="body" rows="3" maxlength="2000" required></textarea>
        </div>
        <div class="nw-od-email-error"></div>
        <div class="nw-od-email-buttons">
          <button type="button" class="nw-od-btn nw-od-btn--sm" data-action="send-email" data-contact-id="${m.contactId}">Send</button>
          <button type="button" class="nw-od-btn nw-od-btn--ghost nw-od-btn--sm" data-action="cancel-email">Cancel</button>
        </div>
      </form>`;
  }

  private phoneLink(phone: string): string {
    return `<a href="tel:${this.escapeAttr(phone)}">${this.escapeHtml(phone)}</a>`;
  }

  /** Build an all-day birthday ICS (current year) as a data: URL. */
  private buildBirthdayIcs(name: string, monthDay: string): string {
    const m = monthDay.match(/^(\d{2})-(\d{2})$/);
    if (!m) return "#";
    const year = new Date().getFullYear();
    const date = `${year}${m[1]}${m[2]}`;
    const nl = "%0A";
    const summary = `SUMMARY:${encodeURIComponent(`Happy Birthday ${name}!`)}`;
    return `data:text/calendar;charset=utf8,BEGIN:VCALENDAR${nl}VERSION:2.0${nl}BEGIN:VEVENT${nl}DTSTART;VALUE=DATE:${date}${nl}${summary}${nl}RRULE:FREQ=YEARLY${nl}END:VEVENT${nl}END:VCALENDAR${nl}`;
  }

  private state(icon: string, text: string): string {
    return `<div class="nw-od-state">${icon}<span>${this.escapeHtml(text)}</span></div>`;
  }

  // ── Helpers ──

  private escapeHtml(text: string): string {
    const el = document.createElement("span");
    el.textContent = text ?? "";
    return el.innerHTML;
  }

  private escapeAttr(text: string): string {
    return this.escapeHtml(text).replace(/"/g, "&quot;");
  }

  private spinnerSvg(): string {
    return `<svg class="nw-od-spinner" viewBox="0 0 24 24" fill="none" width="20" height="20">
      <circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
      <path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
    </svg>`;
  }
  private personSvg(): string {
    return `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>`;
  }
  private cakeSvg(): string {
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21h16v-7a3 3 0 0 0-3-3H7a3 3 0 0 0-3 3z"/><path d="M4 16c2 0 2 1.5 4 1.5S10 16 12 16s2 1.5 4 1.5S18 16 20 16"/><path d="M12 8V5"/><circle cx="12" cy="3.5" r="0.5" fill="currentColor"/></svg>`;
  }
  private mailSvg(): string {
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>`;
  }
  private mapSvg(): string {
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>`;
  }
  private familySvg(): string {
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2 20c0-3.3 2.7-5 6-5s6 1.7 6 5"/><path d="M15 20c0-2.5 1.5-4 4-4"/></svg>`;
  }

  private getStyles(): string {
    return `
      :host { all: initial; display: block; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color: #2D2926; }
      .nw-od { max-width: 1024px; margin: 0 auto; }
      .nw-od-title { font-size: 22px; font-weight: 800; color: #002855; margin: 0 0 16px; }

      .nw-od-form { background: white; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; margin-bottom: 20px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); display: grid; grid-template-columns: 1fr 2fr; gap: 12px; }
      .nw-od-field { display: flex; flex-direction: column; gap: 4px; }
      .nw-od-field label { font-size: 12px; font-weight: 600; color: #6b7280; }
      .nw-od-input, .nw-od-select { padding: 9px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; font-family: inherit; color: #2D2926; background: white; outline: none; }
      .nw-od-input:focus, .nw-od-select:focus { border-color: #004C97; box-shadow: 0 0 0 1px #004C97; }
      textarea.nw-od-input { resize: vertical; min-height: 64px; }
      .nw-od-search { position: relative; display: flex; flex-direction: column; gap: 6px; }
      .nw-od-chip { display: inline-flex; align-items: center; gap: 6px; align-self: flex-start; background: #eef2f7; color: #002855; font-size: 12px; font-weight: 600; padding: 3px 6px 3px 10px; border-radius: 9999px; }
      .nw-od-chip-clear { background: none; border: none; cursor: pointer; font-size: 16px; line-height: 1; color: #6b7280; padding: 0 2px; }

      .nw-od-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
      .nw-od-card { background: white; border: 1px solid #e5e7eb; border-radius: 12px; padding: 14px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
      .nw-od-card-row { display: flex; gap: 12px; }
      .nw-od-card-imgwrap { flex-shrink: 0; }
      .nw-od-card-img { width: 64px; height: 64px; border-radius: 9999px; object-fit: cover; display: block; }
      .nw-od-card-img--placeholder { display: flex; align-items: center; justify-content: center; background: #f3f4f6; color: #9ca3af; width: 64px; height: 64px; }
      .nw-od-card-body { flex: 1; min-width: 0; }
      .nw-od-card-name { font-size: 16px; font-weight: 700; color: #002855; margin: 0 0 2px; }
      .nw-od-card-pos { font-size: 13px; color: #6b7280; margin-bottom: 6px; }
      .nw-od-phones { display: flex; flex-direction: column; gap: 2px; font-size: 13px; color: #474747; }
      .nw-od-phone b { color: #6b7280; font-weight: 600; }
      .nw-od-phone a { color: #004C97; text-decoration: none; }
      .nw-od-phone a:hover { text-decoration: underline; }

      .nw-od-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; padding-top: 12px; border-top: 1px solid #f3f4f6; }
      .nw-od-action { display: inline-flex; flex-direction: column; align-items: center; gap: 2px; color: #004C97; text-decoration: none; font-size: 11px; font-weight: 600; cursor: pointer; }
      .nw-od-action:hover { color: #002855; }
      .nw-od-action span { white-space: nowrap; }

      .nw-od-email { margin-top: 12px; padding-top: 12px; border-top: 1px solid #f3f4f6; display: flex; flex-direction: column; gap: 8px; }
      .nw-od-email-title { font-size: 13px; font-weight: 700; color: #002855; }
      .nw-od-email-error { color: #b91c1c; font-size: 12px; }
      .nw-od-email-buttons { display: flex; gap: 8px; }

      .nw-od-btn { padding: 10px 20px; background: #004C97; color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; }
      .nw-od-btn:hover { background: #002855; }
      .nw-od-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .nw-od-btn--sm { padding: 7px 14px; font-size: 13px; }
      .nw-od-btn--ghost { background: white; color: #004C97; border: 1px solid #004C97; }
      .nw-od-btn--ghost:hover { background: #f0f6fc; }

      .nw-od-panel { text-align: center; background: white; border: 1px solid #e5e7eb; border-radius: 12px; padding: 32px 16px; }
      .nw-od-panel p { margin: 0 0 12px; font-size: 15px; color: #474747; }
      .nw-od-msg { padding: 12px 16px; border-radius: 8px; font-size: 14px; }
      .nw-od-msg--info { background: #e6f6fc; color: #015a7a; }
      .nw-od-msg--warning { background: #fdf6e3; color: #8a6d3b; }
      .nw-od-state { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 40px 16px; color: #6b7280; font-size: 15px; }
      .nw-od-spinner { animation: nw-od-spin 1s linear infinite; color: #004C97; }
      @keyframes nw-od-spin { to { transform: rotate(360deg); } }

      @media (max-width: 640px) {
        .nw-od-form { grid-template-columns: 1fr; }
        .nw-od-grid { grid-template-columns: 1fr; }
      }
    `;
  }
}

customElements.define("next-online-directory", OnlineDirectoryWidget);
