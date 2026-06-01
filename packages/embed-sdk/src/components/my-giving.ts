import { MPNextWidget } from "../shared/base-widget";

interface DonationRecord {
  donationDate: string;
  amount: number;
  programId: number;
  programName: string;
  statementTitle: string;
  isTaxDeductible: boolean;
  isSpouseDonation: boolean;
  isSoftCredit: boolean;
  isPending: boolean;
  isOmitAmount: boolean;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTH_LABELS_SHORT = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

// Brand-derived palette cycled across programs in the doughnut chart.
const PROGRAM_COLORS = [
  "#004C97", // primary blue
  "#009CDE", // info light blue
  "#F1BE48", // gold
  "#86AD3F", // success green
  "#002855", // navy
  "#FF6D6A", // coral
  "#2D2926", // black
];

const MIN_YEAR_OFFSET = 4; // allow going back this many years from current

export class MyGivingWidget extends MPNextWidget {
  private selectedYear = new Date().getFullYear();
  private selectedMonth = -1; // -1 = all months
  private donations: DonationRecord[] = [];
  private includeSoftCredits = false;
  private showFullList = false;
  private loading = true;
  private error: string | null = null;

  static get observedAttributes() {
    return ["hidesoftcredits", "congregationid"];
  }

  private get hideSoftCredits(): boolean {
    return (this.getAttribute("hidesoftcredits") || "").toLowerCase() === "true";
  }

  private get congregationId(): string | null {
    return this.getAttribute("congregationid");
  }

  connectedCallback() {
    this.injectStyles(this.getStyles());
    this.render();
    this.loadDonations();
  }

  attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null) {
    if (oldValue !== null && oldValue !== newValue) {
      this.loadDonations();
    }
  }

  public retryLoad() {
    this.error = null;
    this.loadDonations();
  }

  private async loadDonations() {
    this.loading = true;
    this.error = null;
    this.render();

    try {
      let url = `/api/embed/my-giving?year=${this.selectedYear}`;
      if (this.selectedMonth > 0) url += `&month=${this.selectedMonth}`;
      if (this.congregationId) url += `&congregationId=${encodeURIComponent(this.congregationId)}`;

      const res = await this.fetch(url);
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data: { donations: DonationRecord[] } = await res.json();
      this.donations = data.donations || [];

      const total = this.donations
        .filter((d) => !d.isSoftCredit)
        .reduce((sum, d) => sum + d.amount, 0);
      this.emit("donationsLoaded", {
        count: this.donations.length,
        year: this.selectedYear,
        month: this.selectedMonth,
        total,
      });
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Failed to load giving history";
      this.emit("givingError", { error: this.error });
    } finally {
      this.loading = false;
      this.showFullList = false;
      this.render();
      this.attachListeners();
    }
  }

  private attachListeners() {
    const retryBtn = this.root.querySelector('[data-action="retry"]');
    if (retryBtn) {
      retryBtn.addEventListener("click", () => this.retryLoad());
    }

    const prevYearBtn = this.root.querySelector<HTMLButtonElement>('[data-action="prev-year"]');
    if (prevYearBtn && !prevYearBtn.classList.contains("disabled")) {
      prevYearBtn.addEventListener("click", () => {
        this.selectedYear -= 1;
        this.loadDonations();
      });
    }

    const nextYearBtn = this.root.querySelector<HTMLButtonElement>('[data-action="next-year"]');
    if (nextYearBtn && !nextYearBtn.classList.contains("disabled")) {
      nextYearBtn.addEventListener("click", () => {
        this.selectedYear += 1;
        this.loadDonations();
      });
    }

    const monthSelect = this.root.querySelector<HTMLSelectElement>("#giving-month-select");
    if (monthSelect) {
      monthSelect.addEventListener("change", () => {
        this.selectedMonth = parseInt(monthSelect.value, 10);
        this.loadDonations();
      });
    }

    const softToggle = this.root.querySelector<HTMLInputElement>("#giving-soft-toggle");
    if (softToggle) {
      softToggle.addEventListener("change", () => {
        this.includeSoftCredits = softToggle.checked;
        this.render();
        this.attachListeners();
      });
    }

    const showMoreBtn = this.root.querySelector<HTMLButtonElement>('[data-action="show-more"]');
    if (showMoreBtn) {
      showMoreBtn.addEventListener("click", () => {
        this.showFullList = true;
        this.render();
        this.attachListeners();
      });
    }
  }

  render() {
    if (this.loading) {
      this.root.innerHTML = `
        <div class="nw-giving">
          <div class="header">
            <div class="loading-row">
              ${this.spinnerSvg()}
              <span>Loading giving history...</span>
            </div>
          </div>
        </div>`;
      return;
    }

    if (this.error) {
      this.root.innerHTML = `
        <div class="nw-giving">
          <div class="header">
            <div class="title">Unable to Load</div>
            <p class="subtitle">${this.escapeHtml(this.error)}</p>
          </div>
          <div class="retry-section">
            <button class="retry-btn" data-action="retry">Try Again</button>
          </div>
        </div>`;
      return;
    }

    this.root.innerHTML = this.renderMain();
  }

  private renderMain(): string {
    const filtered = this.getFilteredDonations();
    const hasSoftCredits = this.donations.some((d) => d.isSoftCredit);
    const showSoftToggle = !this.hideSoftCredits && hasSoftCredits;

    // Total Giving is always computed from NON-soft-credit donations.
    const totalGiving = this.donations
      .filter((d) => !d.isSoftCredit)
      .reduce((sum, d) => sum + d.amount, 0);

    return `
      <div class="nw-giving">
        <div class="header">
          <div class="title">My Giving</div>
        </div>
        <div class="body">
          ${this.renderControls()}
          ${showSoftToggle ? this.renderSoftToggle() : ""}
          <div class="total-row">
            <span class="total-label">Total Giving</span>
            <span class="total-amount">${this.formatCurrency(totalGiving)}</span>
          </div>
          ${this.renderCharts(filtered)}
          ${this.renderDonationsList(filtered)}
        </div>
      </div>`;
  }

  private renderControls(): string {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1; // 1-12

    const prevDisabled = this.selectedYear <= currentYear - MIN_YEAR_OFFSET;
    const nextDisabled = this.selectedYear >= currentYear;

    const monthOptions = [
      `<option value="-1" ${this.selectedMonth === -1 ? "selected" : ""}>All Months ${this.selectedYear}</option>`,
    ];
    for (let m = 1; m <= 12; m++) {
      const futureInCurrentYear = this.selectedYear === currentYear && m > currentMonth;
      monthOptions.push(
        `<option value="${m}" ${this.selectedMonth === m ? "selected" : ""} ${futureInCurrentYear ? "disabled" : ""}>${MONTH_NAMES[m - 1]}</option>`
      );
    }

    return `
      <div class="controls-row">
        <button
          class="year-nav-btn ${prevDisabled ? "disabled" : ""}"
          data-action="prev-year"
          ${prevDisabled ? "disabled" : ""}>
          &#9664; ${this.selectedYear - 1}
        </button>
        <select id="giving-month-select" class="month-select">
          ${monthOptions.join("")}
        </select>
        <button
          class="year-nav-btn ${nextDisabled ? "disabled" : ""}"
          data-action="next-year"
          ${nextDisabled ? "disabled" : ""}>
          ${this.selectedYear + 1} &#9654;
        </button>
      </div>`;
  }

  private renderSoftToggle(): string {
    return `
      <label class="soft-toggle-row">
        <input type="checkbox" id="giving-soft-toggle" ${this.includeSoftCredits ? "checked" : ""}>
        <span>Include Soft Credit Donations</span>
      </label>`;
  }

  private renderCharts(filtered: DonationRecord[]): string {
    const showByMonth = this.selectedMonth <= 0;
    const byMonth = showByMonth ? this.renderByMonthChart(filtered) : "";
    const byProgram = this.renderByProgramChart(filtered);

    if (!byMonth && !byProgram) return "";

    return `
      <div class="graphs-container">
        ${byMonth}
        ${byProgram}
      </div>`;
  }

  private renderByMonthChart(filtered: DonationRecord[]): string {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    const monthsToShow = this.selectedYear === currentYear ? currentMonth : 12;

    const totals = new Array(monthsToShow).fill(0) as number[];
    for (const d of filtered) {
      const parts = this.parseDateParts(d.donationDate);
      if (!parts) continue;
      const idx = parts.month - 1;
      if (idx >= 0 && idx < monthsToShow) {
        totals[idx] += d.amount;
      }
    }

    const max = Math.max(...totals, 0);
    if (max <= 0) {
      return `
        <div class="chart-card">
          <div class="chart-title">By Month</div>
          <div class="chart-empty">No giving to chart.</div>
        </div>`;
    }

    const chartW = 320;
    const chartH = 160;
    const labelH = 18;
    const plotH = chartH - labelH;
    const slot = chartW / monthsToShow;
    const barW = slot * 0.6;

    let bars = "";
    for (let i = 0; i < monthsToShow; i++) {
      const h = max > 0 ? (totals[i] / max) * (plotH - 8) : 0;
      const x = i * slot + (slot - barW) / 2;
      const y = plotH - h;
      bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="#009CDE"></rect>`;
      bars += `<text x="${(i * slot + slot / 2).toFixed(1)}" y="${chartH - 4}" text-anchor="middle" class="chart-axis-label">${MONTH_LABELS_SHORT[i]}</text>`;
    }

    return `
      <div class="chart-card">
        <div class="chart-title">By Month</div>
        <svg viewBox="0 0 ${chartW} ${chartH}" class="chart-svg" role="img" aria-label="Giving by month">
          ${bars}
        </svg>
      </div>`;
  }

  private renderByProgramChart(filtered: DonationRecord[]): string {
    // Group totals by programId.
    const groups = new Map<number, { name: string; total: number }>();
    for (const d of filtered) {
      const existing = groups.get(d.programId);
      if (existing) {
        existing.total += d.amount;
      } else {
        groups.set(d.programId, { name: d.programName, total: d.amount });
      }
    }

    const entries = Array.from(groups.values()).filter((g) => g.total > 0);
    const grandTotal = entries.reduce((sum, g) => sum + g.total, 0);

    if (grandTotal <= 0) {
      return `
        <div class="chart-card">
          <div class="chart-title">By Program</div>
          <div class="chart-empty">No giving to chart.</div>
        </div>`;
    }

    const size = 160;
    const cx = size / 2;
    const cy = size / 2;
    const r = 64;
    const innerR = 38;
    const stroke = r - innerR;
    const ringR = (r + innerR) / 2;
    const circumference = 2 * Math.PI * ringR;

    let offset = 0;
    let segments = "";
    let legend = "";
    entries.forEach((g, i) => {
      const color = PROGRAM_COLORS[i % PROGRAM_COLORS.length];
      const fraction = g.total / grandTotal;
      const dash = fraction * circumference;
      segments += `<circle
        cx="${cx}" cy="${cy}" r="${ringR}"
        fill="none"
        stroke="${color}"
        stroke-width="${stroke}"
        stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}"
        stroke-dashoffset="${(-offset).toFixed(2)}"
        transform="rotate(-90 ${cx} ${cy})"></circle>`;
      offset += dash;

      legend += `
        <div class="legend-item">
          <span class="legend-swatch" style="background:${color}"></span>
          <span class="legend-label">${this.escapeHtml(g.name)} - ${this.formatCurrency(g.total)}</span>
        </div>`;
    });

    return `
      <div class="chart-card">
        <div class="chart-title">By Program</div>
        <div class="doughnut-wrap">
          <svg viewBox="0 0 ${size} ${size}" class="doughnut-svg" role="img" aria-label="Giving by program">
            ${segments}
          </svg>
          <div class="legend">${legend}</div>
        </div>
      </div>`;
  }

  private renderDonationsList(filtered: DonationRecord[]): string {
    const showSoftDisclaimer = this.includeSoftCredits && filtered.some((d) => d.isSoftCredit);

    const subtitle = `
      <p class="list-subtitle">The following list of Donations is informational and should not be used for tax purposes.</p>
      ${showSoftDisclaimer
        ? `<p class="list-subtitle">Soft credit donations are included below and reflect gifts you are credited with but did not personally contribute.</p>`
        : ""}`;

    if (filtered.length === 0) {
      return `
        <div class="donations-section">
          <div class="section-label">Donations</div>
          ${subtitle}
          <div class="empty-state">No donations</div>
        </div>`;
    }

    const limited = !this.showFullList && filtered.length > 4;
    const rows = (limited ? filtered.slice(0, 4) : filtered)
      .map((d) => this.renderDonationRow(d))
      .join("");

    return `
      <div class="donations-section">
        <div class="section-label">Donations</div>
        ${subtitle}
        <div class="donation-list">
          ${rows}
        </div>
        ${limited
          ? `<div class="show-more-section">
              <button class="show-more-btn" data-action="show-more">SHOW MORE DONATIONS</button>
            </div>`
          : ""}
      </div>`;
  }

  private renderDonationRow(d: DonationRecord): string {
    const dateText = d.isPending ? "PENDING" : this.formatDonationDate(d.donationDate);
    const amountText = d.isOmitAmount ? "" : this.formatCurrency(d.amount);

    const badges: string[] = [];
    if (d.isSpouseDonation) badges.push(`<span class="badge badge-spouse">Spouse</span>`);
    if (d.isSoftCredit) badges.push(`<span class="badge badge-soft">SOFT CREDIT</span>`);
    if (!d.isTaxDeductible) badges.push(`<span class="badge badge-nondeductible">NON-DEDUCTIBLE</span>`);

    return `
      <div class="donation-row">
        <span class="don-date ${d.isPending ? "don-date--pending" : ""}">${this.escapeHtml(dateText)}</span>
        <span class="don-title">
          ${this.escapeHtml(d.statementTitle)}
          ${badges.length ? `<span class="badge-group">${badges.join("")}</span>` : ""}
        </span>
        <span class="don-amount">${amountText}</span>
      </div>`;
  }

  private getFilteredDonations(): DonationRecord[] {
    if (this.includeSoftCredits) return this.donations;
    return this.donations.filter((d) => !d.isSoftCredit);
  }

  /**
   * Parse the YYYY-MM-DD portion of a donation date defensively, avoiding the
   * timezone day-shift that `new Date(isoString)` introduces when the string
   * carries a trailing Z.
   */
  private parseDateParts(dateString: string): { year: number; month: number; day: number } | null {
    if (!dateString) return null;
    const match = dateString.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) {
      const fallback = new Date(dateString);
      if (isNaN(fallback.getTime())) return null;
      return {
        year: fallback.getFullYear(),
        month: fallback.getMonth() + 1,
        day: fallback.getDate(),
      };
    }
    return {
      year: parseInt(match[1], 10),
      month: parseInt(match[2], 10),
      day: parseInt(match[3], 10),
    };
  }

  private formatDonationDate(dateString: string): string {
    const parts = this.parseDateParts(dateString);
    if (!parts) return dateString;
    const date = new Date(parts.year, parts.month - 1, parts.day);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  private formatCurrency(amount: number): string {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
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

      .nw-giving {
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

      .body {
        padding: 20px;
      }

      .controls-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 16px;
      }
      .year-nav-btn {
        padding: 8px 14px;
        background: white;
        color: #004C97;
        font-size: 14px;
        font-weight: 600;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        cursor: pointer;
        font-family: inherit;
        white-space: nowrap;
        transition: all 0.15s;
      }
      .year-nav-btn:hover {
        border-color: #004C97;
        background: rgba(0, 76, 151, 0.04);
      }
      .year-nav-btn.disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
      .year-nav-btn.disabled:hover {
        border-color: #e5e7eb;
        background: white;
      }
      .month-select {
        flex: 1;
        padding: 9px 12px;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        font-size: 14px;
        font-family: inherit;
        color: #2D2926;
        background: white;
        outline: none;
        cursor: pointer;
        transition: border-color 0.15s;
      }
      .month-select:focus {
        border-color: #004C97;
      }

      .soft-toggle-row {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        color: #474747;
        margin-bottom: 16px;
        cursor: pointer;
      }
      .soft-toggle-row input {
        width: 16px;
        height: 16px;
        accent-color: #004C97;
        cursor: pointer;
      }

      .total-row {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        padding: 16px;
        background: #f9fafb;
        border-radius: 8px;
        border-left: 3px solid #F1BE48;
        margin-bottom: 24px;
      }
      .total-label {
        font-size: 14px;
        font-weight: 600;
        color: #002855;
        text-transform: uppercase;
        letter-spacing: 0.03em;
      }
      .total-amount {
        font-size: 28px;
        font-weight: 700;
        color: #004C97;
      }

      .graphs-container {
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
        margin-bottom: 24px;
      }
      .chart-card {
        flex: 1 1 280px;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 16px;
      }
      .chart-title {
        font-size: 14px;
        font-weight: 700;
        color: #002855;
        margin-bottom: 12px;
        text-transform: uppercase;
        letter-spacing: 0.03em;
      }
      .chart-svg {
        width: 100%;
        height: auto;
        display: block;
      }
      .chart-axis-label {
        font-size: 9px;
        fill: rgba(45, 41, 38, 0.6);
        font-family: ui-sans-serif, system-ui, sans-serif;
      }
      .chart-empty {
        text-align: center;
        padding: 24px 8px;
        color: #9E9E9E;
        font-size: 13px;
      }

      .doughnut-wrap {
        display: flex;
        align-items: center;
        gap: 16px;
        flex-wrap: wrap;
      }
      .doughnut-svg {
        width: 120px;
        height: 120px;
        flex-shrink: 0;
      }
      .legend {
        display: flex;
        flex-direction: column;
        gap: 6px;
        flex: 1;
        min-width: 120px;
      }
      .legend-item {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        color: #474747;
      }
      .legend-swatch {
        width: 12px;
        height: 12px;
        border-radius: 3px;
        flex-shrink: 0;
      }
      .legend-label {
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .donations-section {
        margin-top: 8px;
      }
      .section-label {
        font-size: 16px;
        font-weight: 700;
        color: #002855;
        margin-bottom: 8px;
      }
      .list-subtitle {
        font-size: 12px;
        color: rgba(45, 41, 38, 0.6);
        line-height: 1.5;
        margin: 0 0 8px;
      }
      .donation-list {
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        overflow: hidden;
        margin-top: 8px;
      }
      .donation-row {
        display: grid;
        grid-template-columns: 110px 1fr 100px;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        font-size: 14px;
        color: #2D2926;
        border-bottom: 1px solid #f3f4f6;
      }
      .donation-row:last-child {
        border-bottom: none;
      }
      .don-date {
        color: rgba(45, 41, 38, 0.7);
        font-size: 13px;
      }
      .don-date--pending {
        color: #92700c;
        font-weight: 600;
      }
      .don-title {
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .badge-group {
        display: inline-flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-left: 6px;
        vertical-align: middle;
      }
      .don-amount {
        text-align: right;
        font-weight: 500;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        padding: 2px 8px;
        border-radius: 9999px;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        white-space: nowrap;
      }
      .badge-spouse {
        background: rgba(0, 156, 222, 0.15);
        color: #006b99;
      }
      .badge-soft {
        background: rgba(241, 190, 72, 0.2);
        color: #92700c;
      }
      .badge-nondeductible {
        background: rgba(255, 109, 106, 0.15);
        color: #b91c1c;
      }

      .empty-state {
        text-align: center;
        padding: 40px 20px;
        color: #9E9E9E;
        font-size: 14px;
      }

      .show-more-section {
        text-align: center;
        margin-top: 16px;
      }
      .show-more-btn {
        display: inline-block;
        padding: 10px 24px;
        background: white;
        color: #004C97;
        font-weight: 600;
        font-size: 13px;
        letter-spacing: 0.03em;
        border: 1px solid #004C97;
        border-radius: 8px;
        cursor: pointer;
        font-family: inherit;
        transition: all 0.15s;
      }
      .show-more-btn:hover {
        background: #004C97;
        color: white;
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
        .header, .body {
          padding: 16px;
        }
        .controls-row {
          flex-wrap: wrap;
        }
        .month-select {
          order: -1;
          flex: 1 1 100%;
        }
        .graphs-container {
          flex-direction: column;
        }
        .donation-row {
          grid-template-columns: 90px 1fr 80px;
          gap: 8px;
          padding: 10px 12px;
          font-size: 13px;
        }
        .total-amount {
          font-size: 24px;
        }
      }
    `;
  }
}

customElements.define("next-my-giving", MyGivingWidget);
