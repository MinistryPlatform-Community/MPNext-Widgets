import { MPNextWidget, SIGN_IN_REQUIRED_STYLES } from "../shared/base-widget";
import { escapeAttr } from "../shared/html";
import {
  GIVING_SIGNED_OUT_STYLES,
  HEADING_RESET_STYLES,
  givingSignedOut,
  headingTag,
} from "./giving-shared";
// C38: the Go Paperless control is this element, nested (`show-paperless-toggle`).
import "./statement-preferences";

interface ContributionStatement {
  Statement_ID: number;
  Statement_Year: number;
  File_Name: string;
  Unique_Name: string;
  Extension: string;
  Download_Url: string;
}

interface ContributionStatementGroup {
  Accounting_Company_Name: string;
  statements: ContributionStatement[];
}

export class MyContributionStatementWidget extends MPNextWidget {
  private groups: ContributionStatementGroup[] = [];
  private loading = true;
  private error: string | null = null;
  /** Signed out is a state, not an error (C30 / CROSS-1). */
  private signedOut = false;
  private selectedYear: Record<string, number> = {};
  /** Companies whose statement is being fetched (C34). */
  private downloading = new Set<string>();
  /** A statement URL to offer as a link when the browser blocked the new tab (C34). */
  private fallbackLinks: Record<string, string> = {};

  static get observedAttributes() {
    return ["heading-level", "show-paperless-toggle", "my-giving-url"];
  }

  connectedCallback() {
    this.injectStyles(this.getStyles());
    // Await the catalogue before the first paint so a Spanish visitor never
    // sees English swap to Spanish.
    void this.initLocale().then(() => {
      this.render();
      this.painted = true;
      this.loadStatements();
    });
  }

  /**
   * An observed attribute changed after the first paint (C39 convention). Every
   * attribute this widget reads only changes how loaded data is drawn, so a
   * re-render is enough; a load still in flight reads them when it lands.
   */
  protected override reload(): void {
    if (this.loading) return;
    this.render();
    this.attachListeners();
  }

  public retryLoad() {
    this.error = null;
    this.loadStatements();
  }

  private async loadStatements() {
    this.loading = true;
    this.error = null;
    this.signedOut = false;
    this.render();

    try {
      const res = await this.fetch("/api/embed/contribution-statements");
      if (this.isNeedsAuth(res)) {
        // An anonymous visitor: offer sign-in, never "Unable to Load" + a
        // Try Again that can only fail again. A 401 reaching a signed-in
        // visitor is not this state and falls through to the error.
        this.signedOut = true;
        this.groups = [];
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(this.errorText(data));
      }
      const data: { groups: ContributionStatementGroup[] } = await res.json();
      this.groups = data.groups || [];

      // Default selected year per group = most recent (max) Statement_Year
      this.selectedYear = {};
      let total = 0;
      for (const group of this.groups) {
        total += group.statements.length;
        if (group.statements.length > 0) {
          const maxYear = Math.max(...group.statements.map((s) => s.Statement_Year));
          this.selectedYear[group.Accounting_Company_Name] = maxYear;
        }
      }

      this.emit("statementsLoaded", { count: total });
    } catch (err) {
      this.error = err instanceof Error ? err.message : this.t("errors.network");
      this.emit("statementError", { error: this.error });
    } finally {
      this.loading = false;
      this.render();
      this.attachListeners();
    }
  }

  private attachListeners() {
    const retryBtn = this.root.querySelector('[data-action="retry"]');
    if (retryBtn) {
      retryBtn.addEventListener("click", () => this.retryLoad());
    }

    const yearBtns = this.root.querySelectorAll<HTMLButtonElement>("[data-year-company]");
    yearBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const company = btn.dataset.yearCompany || "";
        const year = parseInt(btn.dataset.year || "0");
        if (company && year) {
          this.selectedYear[company] = year;
          this.render();
          this.attachListeners();
        }
      });
    });

    const downloadBtns = this.root.querySelectorAll<HTMLButtonElement>('[data-action="download"]');
    downloadBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const company = btn.dataset.company || "";
        this.downloadStatement(company);
      });
    });
  }

  /**
   * "Save as PDF" saves a file (C34) rather than opening a tab.
   *
   * The statement lives on MP's file host, a different origin, where a plain
   * `<a download>` is ignored by browsers (they navigate instead — this tab,
   * away from the church's page). So the file is fetched as a blob and saved
   * through a same-origin `blob:` URL, which `download` does honour, under the
   * statement's own `File_Name` rather than a GUID.
   *
   * If MP's file host refuses the cross-origin read (no CORS), fall back to
   * opening the statement in a new tab — legacy-adjacent and still the right
   * file. That open happens after an `await`, outside the click's user
   * gesture, so a popup blocker may stop it; when it does, the widget renders
   * a real link the donor can press themselves instead of failing silently.
   */
  private async downloadStatement(company: string) {
    const group = this.groups.find((g) => g.Accounting_Company_Name === company);
    if (!group) return;
    const year = this.selectedYear[company];
    const statement = group.statements.find((s) => s.Statement_Year === year);
    if (!statement || this.downloading.has(company)) return;

    this.downloading.add(company);
    delete this.fallbackLinks[company];
    this.setDownloadBusy(company, true);
    let method: "download" | "tab" | "link" = "download";
    try {
      const res = await fetch(statement.Download_Url, { credentials: "omit", mode: "cors" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.saveBlob(await res.blob(), this.fileName(statement));
    } catch {
      const tab = window.open(statement.Download_Url, "_blank");
      if (tab) {
        tab.opener = null;
        method = "tab";
      } else {
        method = "link";
        this.fallbackLinks[company] = statement.Download_Url;
      }
    } finally {
      this.downloading.delete(company);
      this.render();
      this.attachListeners();
    }

    this.emit("statementDownloaded", {
      statementId: statement.Statement_ID,
      year: statement.Statement_Year,
      accountingCompany: company,
      method,
    });
  }

  /** The statement's own name, with its extension when MP stored it apart. */
  private fileName(s: ContributionStatement): string {
    const name = (s.File_Name || "").trim() || `${s.Statement_Year}`;
    const ext = (s.Extension || "").trim();
    if (!ext || name.toLowerCase().endsWith(ext.toLowerCase())) return name;
    return `${name}${ext.startsWith(".") ? "" : "."}${ext}`;
  }

  private saveBlob(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    a.style.display = "none";
    this.root.appendChild(a);
    a.click();
    a.remove();
    // Revoke on the next task: some browsers start the save asynchronously.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  private setDownloadBusy(company: string, busy: boolean): void {
    this.root
      .querySelectorAll<HTMLButtonElement>('[data-action="download"]')
      .forEach((btn) => {
        if (btn.dataset.company === company) btn.disabled = busy;
      });
  }

  /**
   * Paint the widget. The shadow root holds two regions: the statements card,
   * which is re-rendered freely, and — when `show-paperless-toggle` is set — a
   * persistent `<next-statement-preferences>` beneath it (C38). Keeping that
   * element out of the re-rendered region means a year click does not destroy
   * it, refetch the preference, or drop its "updated" message.
   */
  render() {
    this.ensureLayout();
    this.mainEl!.innerHTML = this.renderMainHtml();
    this.syncPaperless();
  }

  private mainEl: HTMLDivElement | null = null;
  private extrasEl: HTMLDivElement | null = null;
  private prefsEl: HTMLElement | null = null;

  private ensureLayout(): void {
    if (this.mainEl?.parentNode === this.root && this.extrasEl?.parentNode === this.root) return;
    this.mainEl = document.createElement("div");
    this.mainEl.className = "nw-main";
    this.extrasEl = document.createElement("div");
    this.extrasEl.className = "nw-extras";
    this.root.append(this.mainEl, this.extrasEl);
  }

  /** `show-paperless-toggle` (C38): opt-in, any value but "false" turns it on. */
  private get showPaperlessToggle(): boolean {
    const raw = this.getAttribute("show-paperless-toggle");
    return raw !== null && raw.trim().toLowerCase() !== "false";
  }

  /**
   * C38: embed the Go Paperless control by **reusing** `next-statement-preferences`
   * — the element itself, not a copy of its logic — so `Statement_Method_ID` is
   * read and written by exactly one implementation (the one that reads it
   * correctly, unlike legacy). It follows this widget's locale and heading level,
   * and is hidden while this widget is loading, signed out or in error, so a
   * signed-out visitor sees one sign-in prompt, not two.
   */
  private syncPaperless(): void {
    const extras = this.extrasEl!;
    if (!this.showPaperlessToggle) {
      this.prefsEl?.remove();
      this.prefsEl = null;
      extras.hidden = true;
      return;
    }
    if (!this.prefsEl) {
      const el = document.createElement("next-statement-preferences");
      if (this.apiHost) el.setAttribute("api-host", this.apiHost);
      this.prefsEl = el;
      extras.appendChild(el);
    }
    const el = this.prefsEl;
    const level = this.getAttribute("heading-level");
    if (level === null) el.removeAttribute("heading-level");
    else if (el.getAttribute("heading-level") !== level) el.setAttribute("heading-level", level);
    if (el.getAttribute("lang") !== this.locale) el.setAttribute("lang", this.locale);
    extras.hidden = this.loading || this.signedOut || this.error !== null;
  }

  private renderMainHtml(): string {
    if (this.loading) {
      return `
        <div class="nw-statements">
          <div class="header">
            <div class="loading-row">
              ${this.spinnerSvg()}
              <span>${this.escapeHtml(this.t("contributionStatement.loading"))}</span>
            </div>
          </div>
        </div>`;
    }

    if (this.signedOut) {
      return `
        <div class="nw-statements">
          <div class="header">
            <${this.h(0)} class="title">${this.escapeHtml(this.t("contributionStatement.title"))}</${this.h(0)}>
          </div>
          <div class="list-body">
            ${givingSignedOut(
              this.renderSignInRequired({
                subject: "my-contribution-statement",
                message: this.t("contributionStatement.signInPrompt"),
              }),
              2,
            )}
          </div>
        </div>`;
    }

    if (this.error) {
      return `
        <div class="nw-statements">
          <div class="header">
            <div class="title">${this.escapeHtml(this.t("common.unableToLoad"))}</div>
            <p class="subtitle">${this.escapeHtml(this.error)}</p>
          </div>
          <div class="retry-section">
            <button class="retry-btn" data-action="retry">${this.escapeHtml(this.t("common.retry"))}</button>
          </div>
        </div>`;
    }

    const hasStatements = this.groups.some((g) => g.statements.length > 0);
    if (!hasStatements) {
      return `
        <div class="nw-statements">
          <div class="header">
            <${this.h(0)} class="title">${this.escapeHtml(this.t("contributionStatement.title"))}</${this.h(0)}>
          </div>
          <div class="list-body">
            <div class="empty-state">${this.escapeHtml(this.t("contributionStatement.empty"))}</div>
          </div>
          ${this.renderMyGivingLink()}
        </div>`;
    }

    return this.renderList();
  }

  private renderList(): string {
    return `
      <div class="nw-statements">
        <div class="header">
          <${this.h(0)} class="title">${this.escapeHtml(this.t("contributionStatement.title"))}</${this.h(0)}>
        </div>
        <div class="list-body">
          ${this.groups
            .filter((g) => g.statements.length > 0)
            .map((g) => this.renderGroup(g))
            .join("")}
        </div>
        ${this.renderMyGivingLink()}
      </div>`;
  }

  /**
   * `my-giving-url` (C62): where the page hosting `next-my-giving` lives, so a
   * member reading a per-year statement is one click from the gifts behind it.
   * Legacy's only option (`mygivingwidgettargeturl`), deliberately not copied
   * in spelling. Absent, empty, or not an http(s)/relative URL → no link at
   * all, so nothing changes for hosts that do not set it.
   */
  private get myGivingUrl(): string | null {
    const raw = (this.getAttribute("my-giving-url") || "").trim();
    if (!raw || ["null", "undefined", "#"].includes(raw.toLowerCase())) return null;
    try {
      const resolved = new URL(raw, window.location.href);
      return resolved.protocol === "http:" || resolved.protocol === "https:" ? raw : null;
    } catch {
      return null;
    }
  }

  private renderMyGivingLink(): string {
    const url = this.myGivingUrl;
    if (!url) return "";
    return `<div class="footer-links"><a class="my-giving-link" href="${escapeAttr(url)}">${this.escapeHtml(this.t("contributionStatement.myGivingLink"))}</a></div>`;
  }

  private renderGroup(group: ContributionStatementGroup): string {
    const company = group.Accounting_Company_Name;
    const selected = this.selectedYear[company];
    const years = group.statements
      .map((s) => s.Statement_Year)
      .sort((a, b) => b - a);

    return `
      <div class="company-section">
        <${this.h(1)} class="company-name">${this.escapeHtml(company)}</${this.h(1)}>
        <div class="year-label">${this.escapeHtml(this.t("contributionStatement.selectYear"))}</div>
        <div class="year-row">
          ${years
            .map(
              (year) => `
            <button
              class="year-btn ${year === selected ? "year-btn--active" : ""}"
              data-year-company="${escapeAttr(company)}"
              data-year="${year}">
              ${year}
            </button>`
            )
            .join("")}
        </div>
        <div class="download-section">
          <button class="download-btn" data-action="download" data-company="${escapeAttr(company)}" ${this.downloading.has(company) ? "disabled" : ""}>
            ${this.escapeHtml(this.t("contributionStatement.savePdf"))}
          </button>
          ${this.renderFallbackLink(group)}
        </div>
      </div>`;
  }

  /** C34: the manual link, shown only for the selected year's statement. */
  private renderFallbackLink(group: ContributionStatementGroup): string {
    const company = group.Accounting_Company_Name;
    const url = this.fallbackLinks[company];
    const current = group.statements.find((s) => s.Statement_Year === this.selectedYear[company]);
    if (!url || !current || current.Download_Url !== url || !/^https?:/i.test(url)) return "";
    return `<p class="download-fallback" role="status">${this.escapeHtml(this.t("contributionStatement.popupBlocked"))} <a href="${escapeAttr(url)}" target="_blank" rel="noopener">${this.escapeHtml(this.t("contributionStatement.openStatement"))}</a></p>`;
  }

  private escapeHtml(text: string): string {
    const el = document.createElement("span");
    el.textContent = text;
    return el.innerHTML;
  }

  private spinnerSvg(): string {
    return `<svg class="spinner" viewBox="0 0 24 24" fill="none">
      <circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
      <path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
    </svg>`;
  }

  /** Heading tag `offset` levels below this widget's `heading-level` (C35). */
  private h(offset = 0): string {
    return headingTag(this.getAttribute("heading-level"), offset);
  }

  private getStyles(): string {
    return `${HEADING_RESET_STYLES}${SIGN_IN_REQUIRED_STYLES}${GIVING_SIGNED_OUT_STYLES}
      :host {
        all: initial;
        display: block;
        font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
      }

      .nw-statements {
        max-width: 800px;
        margin: 0 auto;
        background: white;
        border-radius: 16px;
        overflow: hidden;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      }

      .header {
        background: #002855;
        color: white;
        padding: 24px;
      }
      .title {
        font-size: 24px;
        font-weight: bold;
        text-align: center;
        margin-bottom: 4px;
      }
      .subtitle {
        text-align: center;
        opacity: 0.8;
        font-size: 14px;
        margin: 0;
      }
      .loading-row {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        font-size: 18px;
      }

      .spinner {
        width: 20px;
        height: 20px;
        animation: spin 1s linear infinite;
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }

      .nw-extras {
        display: block;
        margin-top: 16px;
      }
      .nw-extras[hidden] {
        display: none;
      }

      .list-body {
        padding: 20px;
      }

      .empty-state {
        text-align: center;
        padding: 40px 20px;
        color: #9E9E9E;
        font-size: 14px;
      }

      .company-section {
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 20px;
        margin-bottom: 16px;
        border-left: 3px solid #F1BE48;
      }
      .company-section:last-child {
        margin-bottom: 0;
      }
      .company-name {
        font-size: 18px;
        font-weight: 700;
        color: #002855;
        margin-bottom: 16px;
      }
      .year-label {
        font-size: 12px;
        font-weight: 600;
        color: rgba(45, 41, 38, 0.7);
        text-transform: uppercase;
        letter-spacing: 0.03em;
        margin-bottom: 8px;
      }
      .year-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 20px;
      }
      .year-btn {
        padding: 8px 18px;
        background: white;
        color: #004C97;
        font-size: 14px;
        font-weight: 600;
        border: 1px solid #e5e7eb;
        border-radius: 9999px;
        cursor: pointer;
        font-family: inherit;
        transition: all 0.15s;
      }
      .year-btn:hover {
        border-color: #004C97;
        background: rgba(0, 76, 151, 0.04);
      }
      .year-btn--active {
        background: #004C97;
        color: white;
        border-color: #004C97;
      }
      .year-btn--active:hover {
        background: #002855;
        border-color: #002855;
      }

      .download-section {
        border-top: 1px solid #e5e7eb;
        padding-top: 16px;
      }
      .download-btn {
        display: inline-block;
        padding: 12px 28px;
        background: #004C97;
        color: white;
        font-weight: bold;
        font-size: 14px;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-family: inherit;
        transition: background 0.15s;
      }
      .download-btn:hover {
        background: #002855;
      }
      .download-btn:disabled {
        opacity: 0.6;
        cursor: progress;
      }
      .download-fallback {
        margin: 12px 0 0;
        font-size: 14px;
        color: #2D2926;
      }
      .footer-links {
        padding: 0 20px 20px;
        text-align: right;
      }
      .my-giving-link {
        color: #004C97;
        font-size: 14px;
        font-weight: 600;
        text-decoration: none;
      }
      .my-giving-link:hover {
        text-decoration: underline;
      }
      .my-giving-link:focus-visible {
        outline: 2px solid #009CDE;
        outline-offset: 2px;
        border-radius: 2px;
      }
      .download-fallback a {
        color: #004C97;
        font-weight: 600;
      }

      .retry-section {
        padding: 20px;
        text-align: center;
      }
      .retry-btn {
        display: inline-block;
        padding: 10px 24px;
        background: #004C97;
        color: white;
        font-weight: 600;
        font-size: 14px;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-family: inherit;
        transition: background 0.15s;
      }
      .retry-btn:hover {
        background: #002855;
      }

      @media (max-width: 640px) {
        .header, .list-body {
          padding: 16px;
        }
        .company-section {
          padding: 16px;
        }
        .download-btn {
          display: block;
          width: 100%;
          text-align: center;
        }
      }
    `;
  }
}

customElements.define("next-my-contribution-statement", MyContributionStatementWidget);
