import { MPNextWidget } from "../shared/base-widget";

interface Pledge {
  pledgeId: number;
  pledgeCampaignId: number;
  campaignName: string;
  pledgeDescription: string;
  contactFirstName: string | null;
  contactLastName: string | null;
  pledgeStatusId: number;
  pledgeStatus: string;
  installmentsPlanned: number;
  firstInstallmentDate: string;
  imageUrl: string | null;
  totalPledge: number;
  pledgeTotalToDate: number;
}

const STATUS_LABELS: Record<string, string> = {
  Active: "Active",
  Completed: "Completed",
  Discontinued: "Discontinued",
  Pending: "Pending",
};

export class MyPledgesWidget extends MPNextWidget {
  private pledges: Pledge[] = [];
  private loading = true;
  private error: string | null = null;
  private confirmingCancelId: number | null = null;
  private cancelingId: number | null = null;
  private message: { type: "success" | "error"; text: string } | null = null;

  static get observedAttributes() {
    return ["hidecancelbuttonpledge", "cancelpledgeemailtemplate", "congregationid"];
  }

  private get hideCancelButton(): boolean {
    return (this.getAttribute("hidecancelbuttonpledge") || "true").toLowerCase() !== "false";
  }

  private get cancelEmailTemplateId(): number | undefined {
    const raw = this.getAttribute("cancelpledgeemailtemplate");
    if (!raw) return undefined;
    const parsed = parseInt(raw, 10);
    return isNaN(parsed) ? undefined : parsed;
  }

  private get congregationId(): string | null {
    return this.getAttribute("congregationid");
  }

  connectedCallback() {
    this.injectStyles(this.getStyles());
    this.render();
    this.loadPledges();
  }

  attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null) {
    if (oldValue !== null && oldValue !== newValue) {
      this.loadPledges();
    }
  }

  public retryLoad() {
    this.error = null;
    this.loadPledges();
  }

  private async loadPledges() {
    this.loading = true;
    this.error = null;
    this.render();

    try {
      let url = "/api/embed/my-pledges";
      if (this.congregationId) {
        url += `?congregationId=${encodeURIComponent(this.congregationId)}`;
      }

      const res = await this.fetch(url);
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data: { pledges: Pledge[] } = await res.json();
      this.pledges = data.pledges || [];
      this.emit("pledgesLoaded", { count: this.pledges.length });
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Failed to load pledges";
      this.emit("pledgeError", { error: this.error });
    } finally {
      this.loading = false;
      this.confirmingCancelId = null;
      this.render();
      this.attachListeners();
    }
  }

  private async cancelPledge(pledgeId: number) {
    this.cancelingId = pledgeId;
    this.message = null;
    this.render();
    this.attachListeners();

    try {
      const body: {
        pledgeId: number;
        cancelEmailTemplateId?: number;
        congregationId?: number;
      } = { pledgeId };

      const templateId = this.cancelEmailTemplateId;
      if (templateId !== undefined) body.cancelEmailTemplateId = templateId;

      const congId = this.congregationId;
      if (congId) {
        const parsedCong = parseInt(congId, 10);
        if (!isNaN(parsedCong)) body.congregationId = parsedCong;
      }

      const res = await this.fetch("/api/embed/my-pledges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const data: { pledges: Pledge[] } = await res.json();
      this.pledges = data.pledges || [];
      this.message = { type: "success", text: "Pledge canceled" };
      this.emit("pledgeCanceled", { pledgeId });
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to cancel pledge";
      this.message = {
        type: "error",
        text: "Error canceling the pledge, please try again.",
      };
      this.emit("pledgeError", { error: errorText });
    } finally {
      this.cancelingId = null;
      this.confirmingCancelId = null;
      this.render();
      this.attachListeners();
    }
  }

  private attachListeners() {
    const retryBtn = this.root.querySelector('[data-action="retry"]');
    if (retryBtn) {
      retryBtn.addEventListener("click", () => this.retryLoad());
    }

    const requestBtns = this.root.querySelectorAll<HTMLButtonElement>('[data-action="request-cancel"]');
    requestBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = parseInt(btn.dataset.id || "0", 10);
        if (id) {
          this.confirmingCancelId = id;
          this.message = null;
          this.render();
          this.attachListeners();
        }
      });
    });

    const dismissBtns = this.root.querySelectorAll<HTMLButtonElement>('[data-action="dismiss-cancel"]');
    dismissBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        this.confirmingCancelId = null;
        this.render();
        this.attachListeners();
      });
    });

    const confirmBtns = this.root.querySelectorAll<HTMLButtonElement>('[data-action="confirm-cancel"]');
    confirmBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        if (this.cancelingId !== null) return;
        const id = parseInt(btn.dataset.id || "0", 10);
        if (id) this.cancelPledge(id);
      });
    });
  }

  render() {
    if (this.loading) {
      this.root.innerHTML = `
        <div class="nw-pledges">
          <div class="header">
            <div class="loading-row">
              ${this.spinnerSvg()}
              <span>Loading pledges...</span>
            </div>
          </div>
        </div>`;
      return;
    }

    if (this.error) {
      this.root.innerHTML = `
        <div class="nw-pledges">
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
    const body =
      this.pledges.length === 0
        ? `<div class="empty-state">You are not associated with any pledges.</div>`
        : `<div class="pledge-grid">${this.pledges.map((p) => this.renderPledgeCard(p)).join("")}</div>`;

    return `
      <div class="nw-pledges">
        <div class="header">
          <div class="title">My Pledges</div>
        </div>
        <div class="body">
          ${this.message
            ? `<div class="message message--${this.message.type}">${this.escapeHtml(this.message.text)}</div>`
            : ""}
          ${body}
        </div>
      </div>`;
  }

  private renderPledgeCard(p: Pledge): string {
    const statusLabel = STATUS_LABELS[p.pledgeStatus] || p.pledgeStatus;
    const statusClass = this.getStatusClass(p.pledgeStatus);

    const media = p.imageUrl
      ? `<img class="pledge-image" src="${this.escapeHtml(p.imageUrl)}" alt="${this.escapeHtml(p.campaignName)}">`
      : `<div class="pledge-image pledge-image--placeholder">${this.heartSvg()}</div>`;

    const owner = `${p.contactFirstName ?? ""} ${p.contactLastName ?? ""}`.trim();
    const showOwner = owner.length > 0 && owner.toLowerCase() !== "null null";

    const pct = this.computePercent(p.pledgeTotalToDate, p.totalPledge);
    const barText = `${this.formatCurrency(p.pledgeTotalToDate)} of ${this.formatCurrency(p.totalPledge)} (${pct}%)`;

    const description = `${p.installmentsPlanned} installments beginning ${this.formatInstallmentDate(p.firstInstallmentDate)}`;

    const showCancel = this.hideCancelButton === false && p.pledgeStatus === "Active";
    let cancelArea = "";
    if (showCancel) {
      if (this.confirmingCancelId === p.pledgeId) {
        const busy = this.cancelingId === p.pledgeId;
        cancelArea = `
          <div class="cancel-confirm">
            <span class="cancel-confirm-text">Cancel this pledge?</span>
            <div class="cancel-confirm-actions">
              <button class="cancel-btn cancel-btn--danger" data-action="confirm-cancel" data-id="${p.pledgeId}" ${busy ? "disabled" : ""}>
                ${busy ? `${this.spinnerSvg()}<span>Canceling...</span>` : "Cancel pledge"}
              </button>
              <button class="cancel-btn cancel-btn--ghost" data-action="dismiss-cancel" ${busy ? "disabled" : ""}>Keep</button>
            </div>
          </div>`;
      } else {
        cancelArea = `
          <div class="cancel-area">
            <button class="cancel-btn cancel-btn--request" data-action="request-cancel" data-id="${p.pledgeId}">Cancel Pledge</button>
          </div>`;
      }
    }

    return `
      <div class="pledge-card">
        <div class="pledge-card-top">
          ${media}
          <div class="pledge-card-head">
            <span class="badge ${statusClass}">${this.escapeHtml(statusLabel)}</span>
            <div class="pledge-name">${this.escapeHtml(p.campaignName)}</div>
            ${showOwner ? `<div class="pledge-owner">${this.escapeHtml(owner)}</div>` : ""}
          </div>
        </div>
        <div class="progress-section">
          <div class="progress-track">
            <div class="progress-fill" style="width:${pct}%"></div>
          </div>
          <div class="progress-text">${this.escapeHtml(barText)}</div>
        </div>
        <div class="pledge-desc">${this.escapeHtml(description)}</div>
        ${cancelArea}
      </div>`;
  }

  private computePercent(toDate: number, total: number): number {
    if (toDate <= 0) return 0;
    if (toDate >= total) return 100;
    return Math.trunc((toDate / total) * 100);
  }

  private getStatusClass(status: string): string {
    switch (status) {
      case "Active":
        return "badge-active";
      case "Completed":
        return "badge-completed";
      case "Discontinued":
        return "badge-discontinued";
      case "Pending":
        return "badge-pending";
      default:
        return "badge-default";
    }
  }

  /**
   * Parse the YYYY-MM-DD portion of a date defensively, avoiding the timezone
   * day-shift that `new Date(isoString)` introduces when the string carries a
   * trailing Z.
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

  private formatInstallmentDate(dateString: string): string {
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

  private heartSvg(): string {
    return `<svg viewBox="0 0 24 24" fill="#004C97" class="heart-icon" role="img" aria-label="Pledge">
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
    </svg>`;
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

      .nw-pledges {
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

      .message {
        margin-bottom: 16px;
        padding: 10px 14px;
        border-radius: 8px;
        font-size: 14px;
      }
      .message--success {
        background: rgba(134, 173, 63, 0.15);
        color: #5a7a1a;
        border: 1px solid rgba(134, 173, 63, 0.4);
      }
      .message--error {
        background: rgba(255, 109, 106, 0.15);
        color: #b91c1c;
        border: 1px solid rgba(255, 109, 106, 0.4);
      }

      .empty-state {
        text-align: center;
        padding: 40px 20px;
        color: #9E9E9E;
        font-size: 14px;
      }

      .pledge-grid {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .pledge-card {
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 16px;
        background: white;
      }
      .pledge-card-top {
        display: flex;
        align-items: flex-start;
        gap: 14px;
      }
      .pledge-image {
        width: 64px;
        height: 64px;
        border-radius: 10px;
        object-fit: cover;
        flex-shrink: 0;
        background: #f3f4f6;
      }
      .pledge-image--placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 76, 151, 0.08);
      }
      .heart-icon {
        width: 32px;
        height: 32px;
      }
      .pledge-card-head {
        flex: 1;
        min-width: 0;
      }
      .pledge-name {
        font-size: 16px;
        font-weight: 700;
        color: #002855;
        margin-top: 6px;
        line-height: 1.3;
      }
      .pledge-owner {
        font-size: 13px;
        color: rgba(45, 41, 38, 0.6);
        margin-top: 2px;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        padding: 3px 10px;
        border-radius: 9999px;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        white-space: nowrap;
      }
      .badge-active {
        background: rgba(134, 173, 63, 0.15);
        color: #5a7a1a;
      }
      .badge-completed {
        background: rgba(0, 76, 151, 0.12);
        color: #004C97;
      }
      .badge-discontinued {
        background: rgba(255, 109, 106, 0.15);
        color: #b91c1c;
      }
      .badge-pending {
        background: rgba(241, 190, 72, 0.2);
        color: #92700c;
      }
      .badge-default {
        background: #f3f4f6;
        color: #474747;
      }

      .progress-section {
        margin-top: 16px;
      }
      .progress-track {
        width: 100%;
        height: 12px;
        background: #f3f4f6;
        border-radius: 9999px;
        overflow: hidden;
      }
      .progress-fill {
        height: 100%;
        background: #004C97;
        border-radius: 9999px;
        transition: width 0.3s ease;
      }
      .progress-text {
        margin-top: 6px;
        font-size: 13px;
        font-weight: 600;
        color: #002855;
      }

      .pledge-desc {
        margin-top: 12px;
        font-size: 13px;
        color: rgba(45, 41, 38, 0.7);
      }

      .cancel-area {
        margin-top: 16px;
        padding-top: 14px;
        border-top: 1px solid #f3f4f6;
      }
      .cancel-confirm {
        margin-top: 16px;
        padding: 14px;
        border-top: 1px solid #f3f4f6;
        background: rgba(255, 109, 106, 0.06);
        border-radius: 8px;
      }
      .cancel-confirm-text {
        display: block;
        font-size: 14px;
        font-weight: 600;
        color: #2D2926;
        margin-bottom: 12px;
      }
      .cancel-confirm-actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }

      .cancel-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 9px 18px;
        font-size: 13px;
        font-weight: 600;
        border-radius: 8px;
        cursor: pointer;
        font-family: inherit;
        transition: all 0.15s;
      }
      .cancel-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .cancel-btn--request {
        background: white;
        color: #b91c1c;
        border: 1px solid rgba(255, 109, 106, 0.6);
      }
      .cancel-btn--request:hover {
        background: rgba(255, 109, 106, 0.1);
      }
      .cancel-btn--danger {
        background: #FF6D6A;
        color: white;
        border: none;
      }
      .cancel-btn--danger:hover:not(:disabled) {
        background: #b91c1c;
      }
      .cancel-btn--danger .spinner {
        width: 14px;
        height: 14px;
      }
      .cancel-btn--ghost {
        background: white;
        color: #004C97;
        border: 1px solid #e5e7eb;
      }
      .cancel-btn--ghost:hover:not(:disabled) {
        border-color: #004C97;
        background: rgba(0, 76, 151, 0.04);
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
        .pledge-card-top {
          gap: 12px;
        }
        .pledge-image {
          width: 52px;
          height: 52px;
        }
        .cancel-confirm-actions {
          flex-direction: column;
        }
        .cancel-btn {
          width: 100%;
        }
      }
    `;
  }
}

customElements.define("next-my-pledges", MyPledgesWidget);
