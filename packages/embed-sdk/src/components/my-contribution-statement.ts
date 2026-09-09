import { MPNextWidget } from "../shared/base-widget";

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
  private selectedYear: Record<string, number> = {};

  connectedCallback() {
    this.injectStyles(this.getStyles());
    // Await the catalogue before the first paint so a Spanish visitor never
    // sees English swap to Spanish.
    void this.initLocale().then(() => {
      this.render();
      this.loadStatements();
    });
  }

  public retryLoad() {
    this.error = null;
    this.loadStatements();
  }

  private async loadStatements() {
    this.loading = true;
    this.error = null;
    this.render();

    try {
      const res = await this.fetch("/api/embed/contribution-statements");
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

  private downloadStatement(company: string) {
    const group = this.groups.find((g) => g.Accounting_Company_Name === company);
    if (!group) return;
    const year = this.selectedYear[company];
    const statement = group.statements.find((s) => s.Statement_Year === year);
    if (!statement) return;

    window.open(statement.Download_Url, "_blank", "noopener");
    this.emit("statementDownloaded", {
      statementId: statement.Statement_ID,
      year: statement.Statement_Year,
      accountingCompany: company,
    });
  }

  render() {
    if (this.loading) {
      this.root.innerHTML = `
        <div class="nw-statements">
          <div class="header">
            <div class="loading-row">
              ${this.spinnerSvg()}
              <span>${this.escapeHtml(this.t("contributionStatement.loading"))}</span>
            </div>
          </div>
        </div>`;
      return;
    }

    if (this.error) {
      this.root.innerHTML = `
        <div class="nw-statements">
          <div class="header">
            <div class="title">${this.escapeHtml(this.t("common.unableToLoad"))}</div>
            <p class="subtitle">${this.escapeHtml(this.error)}</p>
          </div>
          <div class="retry-section">
            <button class="retry-btn" data-action="retry">${this.escapeHtml(this.t("common.retry"))}</button>
          </div>
        </div>`;
      return;
    }

    const hasStatements = this.groups.some((g) => g.statements.length > 0);
    if (!hasStatements) {
      this.root.innerHTML = `
        <div class="nw-statements">
          <div class="header">
            <div class="title">${this.escapeHtml(this.t("contributionStatement.title"))}</div>
          </div>
          <div class="list-body">
            <div class="empty-state">${this.escapeHtml(this.t("contributionStatement.empty"))}</div>
          </div>
        </div>`;
      return;
    }

    this.root.innerHTML = this.renderList();
  }

  private renderList(): string {
    return `
      <div class="nw-statements">
        <div class="header">
          <div class="title">${this.escapeHtml(this.t("contributionStatement.title"))}</div>
        </div>
        <div class="list-body">
          ${this.groups
            .filter((g) => g.statements.length > 0)
            .map((g) => this.renderGroup(g))
            .join("")}
        </div>
      </div>`;
  }

  private renderGroup(group: ContributionStatementGroup): string {
    const company = group.Accounting_Company_Name;
    const selected = this.selectedYear[company];
    const years = group.statements
      .map((s) => s.Statement_Year)
      .sort((a, b) => b - a);

    return `
      <div class="company-section">
        <div class="company-name">${this.escapeHtml(company)}</div>
        <div class="year-label">${this.escapeHtml(this.t("contributionStatement.selectYear"))}</div>
        <div class="year-row">
          ${years
            .map(
              (year) => `
            <button
              class="year-btn ${year === selected ? "year-btn--active" : ""}"
              data-year-company="${this.escapeHtml(company)}"
              data-year="${year}">
              ${year}
            </button>`
            )
            .join("")}
        </div>
        <div class="download-section">
          <button class="download-btn" data-action="download" data-company="${this.escapeHtml(company)}">
            ${this.escapeHtml(this.t("contributionStatement.savePdf"))}
          </button>
        </div>
      </div>`;
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

  private getStyles(): string {
    return `
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
