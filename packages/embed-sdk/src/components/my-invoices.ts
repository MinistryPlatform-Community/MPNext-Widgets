import { MPNextWidget } from "../shared/base-widget";

interface InvoiceListItem {
  Invoice_ID: number;
  Invoice_Date: string;
  Invoice_Total: number;
  Invoice_Status_ID: number;
  Invoice_Status: string;
  Notes: string | null;
  Currency: string | null;
  Invoice_GUID: string;
  Product_Summary: string | null;
}

interface InvoiceLineItem {
  Invoice_Detail_ID: number;
  Product_Name: string;
  Description: string | null;
  Item_Quantity: number;
  Line_Total: number;
  Item_Note: string | null;
  Recipient_Name: string | null;
}

interface InvoiceDetailResponse {
  invoice: InvoiceListItem;
  lineItems: InvoiceLineItem[];
}

const PAID_STATUS_ID = 3;
const CANCELLED_STATUS_ID = 7;

export class MyInvoicesWidget extends MPNextWidget {
  private invoices: InvoiceListItem[] = [];
  private selectedDetail: InvoiceDetailResponse | null = null;
  private loading = true;
  private detailLoading = false;
  private error: string | null = null;
  private searchQuery = "";
  private view: "list" | "detail" | "checkout" = "list";
  private checkoutPortalEl: HTMLDivElement | null = null;
  private checkoutPortalStyleEl: HTMLStyleElement | null = null;

  connectedCallback() {
    this.injectStyles(this.getStyles());
    this.render();
    this.loadInvoices();
  }

  disconnectedCallback() {
    this.cleanupCheckoutPortal();
  }

  public retryLoad() {
    this.error = null;
    this.view = "list";
    this.loadInvoices();
  }

  private async loadInvoices() {
    this.loading = true;
    this.error = null;
    this.render();

    try {
      const res = await this.fetch("/api/embed/invoices");
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data: { invoices: InvoiceListItem[] } = await res.json();
      this.invoices = data.invoices;
      this.emit("invoicesLoaded", { count: data.invoices.length });
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Failed to load invoices";
      this.emit("invoiceError", { error: this.error });
    } finally {
      this.loading = false;
      this.render();
      this.attachListeners();
    }
  }

  private async loadInvoiceDetail(invoiceId: number) {
    this.view = "detail";
    this.detailLoading = true;
    this.selectedDetail = null;
    this.render();
    this.attachListeners();

    try {
      const res = await this.fetch(`/api/embed/invoices/${invoiceId}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data: InvoiceDetailResponse = await res.json();
      this.selectedDetail = data;
      this.emit("invoiceSelected", { invoiceId });
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Failed to load invoice details";
      this.emit("invoiceError", { error: this.error });
    } finally {
      this.detailLoading = false;
      this.render();
      this.attachListeners();
    }
  }

  private attachListeners() {
    const searchInput = this.root.querySelector<HTMLInputElement>("#invoice-search");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        this.searchQuery = searchInput.value;
        this.render();
        this.attachListeners();
        const newInput = this.root.querySelector<HTMLInputElement>("#invoice-search");
        if (newInput) {
          newInput.focus();
          newInput.selectionStart = newInput.selectionEnd = newInput.value.length;
        }
      });
    }

    const rows = this.root.querySelectorAll<HTMLElement>("[data-invoice-id]");
    rows.forEach((row) => {
      row.addEventListener("click", () => {
        const id = parseInt(row.dataset.invoiceId || "0");
        if (id) this.loadInvoiceDetail(id);
      });
    });

    const backBtn = this.root.querySelector<HTMLButtonElement>('[data-action="back"]');
    if (backBtn) {
      backBtn.addEventListener("click", () => {
        this.cleanupCheckoutPortal();
        this.view = "list";
        this.selectedDetail = null;
        this.error = null;
        this.render();
        this.attachListeners();
      });
    }

    const payBtn = this.root.querySelector<HTMLButtonElement>('[data-action="pay"]');
    if (payBtn) {
      payBtn.addEventListener("click", () => {
        this.showCheckout();
      });
    }
  }

  private showCheckout() {
    if (!this.selectedDetail) return;
    this.view = "checkout";
    const invoiceId = this.selectedDetail.invoice.Invoice_ID;
    const url = new URL(window.location.href);
    url.searchParams.set("invoiceId", String(invoiceId));
    history.replaceState(null, "", url.toString());
    this.render();
    this.attachListeners();
    this.injectCheckoutPortalStyles();
    const portal = document.createElement("div");
    portal.id = "nw-invoice-checkout-portal";
    portal.className = "nw-invoice-checkout-overlay";
    portal.innerHTML = `
      <div class="nw-invoice-checkout-container">
        <button class="nw-invoice-checkout-back" id="nw-checkout-back-btn">
          &larr; Back to Invoice
        </button>
        <mpp-checkout invoiceid="${invoiceId}"></mpp-checkout>
      </div>
    `;
    document.body.appendChild(portal);
    this.checkoutPortalEl = portal;
    const backBtn = portal.querySelector("#nw-checkout-back-btn");
    if (backBtn) {
      backBtn.addEventListener("click", () => {
        this.cleanupCheckoutPortal();
        this.view = "detail";
        this.render();
        this.attachListeners();
      });
    }
  }

  private injectCheckoutPortalStyles() {
    if (document.getElementById("nw-invoice-checkout-portal-styles")) return;
    const style = document.createElement("style");
    style.id = "nw-invoice-checkout-portal-styles";
    style.textContent = `
      .nw-invoice-checkout-overlay {
        padding: 20px;
      }
      .nw-invoice-checkout-container {
        max-width: 800px;
        margin: 0 auto;
      }
      .nw-invoice-checkout-back {
        background: none;
        border: none;
        color: #004C97;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        padding: 8px 0;
        margin-bottom: 16px;
        font-family: ui-sans-serif, system-ui, sans-serif;
      }
      .nw-invoice-checkout-back:hover {
        color: #002855;
      }
    `;
    document.head.appendChild(style);
    this.checkoutPortalStyleEl = style;
  }

  private cleanupCheckoutPortal() {
    const url = new URL(window.location.href);
    if (url.searchParams.has("invoiceId")) {
      url.searchParams.delete("invoiceId");
      history.replaceState(null, "", url.toString());
    }
    if (this.checkoutPortalEl) {
      this.checkoutPortalEl.remove();
      this.checkoutPortalEl = null;
    }
    if (this.checkoutPortalStyleEl) {
      this.checkoutPortalStyleEl.remove();
      this.checkoutPortalStyleEl = null;
    }
  }

  render() {
    if (this.loading) {
      this.root.innerHTML = `
        <div class="nw-invoices">
          <div class="header">
            <div class="loading-row">
              ${this.spinnerSvg()}
              <span>Loading invoices...</span>
            </div>
          </div>
        </div>`;
      return;
    }

    if (this.error && this.view === "list") {
      this.root.innerHTML = `
        <div class="nw-invoices">
          <div class="header">
            <div class="title">Unable to Load</div>
            <p class="subtitle">${this.escapeHtml(this.error)}</p>
          </div>
          <div class="retry-section">
            <button class="retry-btn" data-action="retry">Try Again</button>
          </div>
        </div>`;
      const retryBtn = this.root.querySelector('[data-action="retry"]');
      if (retryBtn) {
        retryBtn.addEventListener("click", () => this.retryLoad());
      }
      return;
    }

    if (this.view === "detail" || this.view === "checkout") {
      this.root.innerHTML = this.renderDetail();
      return;
    }

    this.root.innerHTML = this.renderList();
  }

  private renderList(): string {
    const filtered = this.getFilteredInvoices();
    return `
      <div class="nw-invoices">
        <div class="header">
          <div class="title">My Invoices</div>
          <p class="subtitle">${this.invoices.length} invoice${this.invoices.length !== 1 ? "s" : ""}</p>
        </div>
        <div class="list-body">
          ${this.invoices.length > 3
            ? `<div class="search-bar">
                <input type="text" id="invoice-search" placeholder="Search invoices..."
                  value="${this.escapeHtml(this.searchQuery)}">
              </div>`
            : ""}
          ${filtered.length === 0
            ? `<div class="empty-state">
                ${this.searchQuery ? "No invoices match your search." : "No invoices found."}
              </div>`
            : `<div class="invoice-table">
                <div class="table-header">
                  <span class="col-date">Date</span>
                  <span class="col-desc">Description</span>
                  <span class="col-status">Status</span>
                  <span class="col-total">Total</span>
                </div>
                ${filtered.map((inv) => this.renderInvoiceRow(inv)).join("")}
              </div>`}
        </div>
      </div>`;
  }

  private renderInvoiceRow(inv: InvoiceListItem): string {
    const description = this.getInvoiceDescription(inv);
    const statusClass = this.getStatusClass(inv.Invoice_Status_ID);
    const isPaid = inv.Invoice_Status_ID === PAID_STATUS_ID;
    const isCancelled = inv.Invoice_Status_ID === CANCELLED_STATUS_ID;
    const hasBalance = !isPaid && !isCancelled && inv.Invoice_Total > 0;
    return `
      <div class="table-row ${hasBalance ? "table-row--payable" : ""}" data-invoice-id="${inv.Invoice_ID}">
        <span class="col-date">${this.formatDate(inv.Invoice_Date)}</span>
        <span class="col-desc">${this.escapeHtml(description)}</span>
        <span class="col-status">
          <span class="badge ${statusClass}">${this.escapeHtml(inv.Invoice_Status)}</span>
        </span>
        <span class="col-total">
          ${this.formatCurrency(inv.Invoice_Total, inv.Currency)}
          ${hasBalance ? `<span class="pay-link">Pay &rarr;</span>` : ""}
        </span>
      </div>`;
  }

  private renderDetail(): string {
    if (this.detailLoading) {
      return `
        <div class="nw-invoices">
          <div class="header">
            <div class="loading-row">
              ${this.spinnerSvg()}
              <span>Loading invoice details...</span>
            </div>
          </div>
        </div>`;
    }

    if (this.error || !this.selectedDetail) {
      return `
        <div class="nw-invoices">
          <div class="header">
            <div class="title">Unable to Load</div>
            <p class="subtitle">${this.escapeHtml(this.error || "Invoice not found")}</p>
          </div>
          <div class="detail-body">
            <button class="back-btn" data-action="back">&larr; Back to Invoices</button>
          </div>
        </div>`;
    }

    const inv = this.selectedDetail.invoice;
    const items = this.selectedDetail.lineItems;
    const isPaid = inv.Invoice_Status_ID === PAID_STATUS_ID;
    const statusClass = this.getStatusClass(inv.Invoice_Status_ID);

    return `
      <div class="nw-invoices">
        <div class="header">
          <div class="title">Invoice Details</div>
        </div>
        <div class="detail-body">
          <button class="back-btn" data-action="back">&larr; Back to Invoices</button>
          <div class="detail-header">
            <div class="detail-meta">
              <div class="detail-field">
                <span class="detail-label">Invoice Date:</span>
                ${this.formatDateLong(inv.Invoice_Date)}
              </div>
              <div class="detail-field">
                <span class="detail-label">Status:</span>
                <span class="badge ${statusClass}">${this.escapeHtml(inv.Invoice_Status)}</span>
              </div>
            </div>
            <div class="detail-total">
              <span class="detail-total-label">Total:</span>
              <span class="detail-total-amount">${this.formatCurrency(inv.Invoice_Total, inv.Currency)}</span>
            </div>
          </div>
          ${items.length > 0
            ? `<div class="line-items-section">
                <div class="section-label">Line Items</div>
                <div class="line-items-table">
                  <div class="li-header">
                    <span class="li-col-product">Product</span>
                    <span class="li-col-desc">Description</span>
                    <span class="li-col-qty">Qty</span>
                    <span class="li-col-price">Unit Price</span>
                    <span class="li-col-total">Total</span>
                  </div>
                  ${items.map((item) => this.renderLineItem(item)).join("")}
                </div>
              </div>`
            : ""}
          ${inv.Notes
            ? `<div class="notes-section">
                <div class="section-label">Notes</div>
                <div class="notes-content">${this.escapeHtml(inv.Notes)}</div>
              </div>`
            : ""}
          ${!isPaid
            ? `<div class="pay-section">
                <button class="pay-btn" data-action="pay">Pay Now</button>
              </div>`
            : ""}
        </div>
      </div>`;
  }

  private renderLineItem(item: InvoiceLineItem): string {
    const unitPrice = item.Item_Quantity > 0 ? item.Line_Total / item.Item_Quantity : item.Line_Total;
    return `
      <div class="li-row">
        <span class="li-col-product">${this.escapeHtml(item.Product_Name)}</span>
        <span class="li-col-desc">${this.escapeHtml(item.Description || "")}</span>
        <span class="li-col-qty">${item.Item_Quantity}</span>
        <span class="li-col-price">${this.formatCurrency(unitPrice)}</span>
        <span class="li-col-total">${this.formatCurrency(item.Line_Total)}</span>
      </div>`;
  }

  private getFilteredInvoices(): InvoiceListItem[] {
    if (!this.searchQuery) return this.invoices;
    const q = this.searchQuery.toLowerCase();
    return this.invoices.filter(
      (inv) =>
        this.getInvoiceDescription(inv).toLowerCase().includes(q) ||
        inv.Invoice_Status.toLowerCase().includes(q) ||
        this.formatDate(inv.Invoice_Date).toLowerCase().includes(q) ||
        String(inv.Invoice_Total).includes(q) ||
        (inv.Product_Summary && inv.Product_Summary.toLowerCase().includes(q))
    );
  }

  private getInvoiceDescription(inv: InvoiceListItem): string {
    if (inv.Product_Summary) return inv.Product_Summary;
    return `Invoice #${inv.Invoice_ID}`;
  }

  private getStatusClass(statusId: number): string {
    switch (statusId) {
      case PAID_STATUS_ID: return "badge-paid";
      case 1: case 2: return "badge-pending";
      case CANCELLED_STATUS_ID: return "badge-cancelled";
      default: return "badge-default";
    }
  }

  private formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  private formatDateLong(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  }

  private formatCurrency(amount: number, currency?: string | null): string {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(amount);
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

  // ALL STYLES - keep identical
  private getStyles(): string {
    return `
      :host {
        all: initial;
        display: block;
        font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
      }

      .nw-invoices {
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

      .search-bar {
        margin-bottom: 16px;
      }
      .search-bar input {
        width: 100%;
        padding: 10px 14px;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        font-size: 14px;
        font-family: inherit;
        outline: none;
        transition: border-color 0.15s;
      }
      .search-bar input:focus {
        border-color: #004C97;
      }

      .empty-state {
        text-align: center;
        padding: 40px 20px;
        color: #9E9E9E;
        font-size: 14px;
      }

      .invoice-table {
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        overflow: hidden;
      }
      .table-header, .table-row {
        display: grid;
        grid-template-columns: 120px 1fr 110px 90px;
        align-items: center;
        padding: 12px 16px;
        gap: 12px;
      }
      .table-header {
        background: #f9fafb;
        font-size: 12px;
        font-weight: 600;
        color: rgba(45, 41, 38, 0.7);
        text-transform: uppercase;
        letter-spacing: 0.03em;
        border-bottom: 1px solid #e5e7eb;
      }
      .table-row {
        font-size: 14px;
        color: #2D2926;
        border-bottom: 1px solid #f3f4f6;
        cursor: pointer;
        transition: background 0.15s;
      }
      .table-row:last-child {
        border-bottom: none;
      }
      .table-row:hover {
        background: rgba(0, 76, 151, 0.03);
      }
      .col-date {
        color: rgba(45, 41, 38, 0.7);
        font-size: 13px;
      }
      .col-desc {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .col-total {
        text-align: right;
        font-weight: 500;
      }
      .pay-link {
        display: block;
        font-size: 12px;
        font-weight: 600;
        color: #004C97;
        margin-top: 2px;
      }
      .table-row--payable {
        border-left: 3px solid #F1BE48;
      }
      .table-row--payable:hover .pay-link {
        color: #002855;
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
      .badge-paid {
        background: rgba(134, 173, 63, 0.15);
        color: #5a7a1a;
      }
      .badge-pending {
        background: rgba(241, 190, 72, 0.2);
        color: #92700c;
      }
      .badge-cancelled {
        background: rgba(255, 109, 106, 0.15);
        color: #b91c1c;
      }
      .badge-default {
        background: #f3f4f6;
        color: #474747;
      }

      .detail-body {
        padding: 20px;
      }
      .back-btn {
        background: none;
        border: none;
        color: #004C97;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        padding: 8px 0;
        margin-bottom: 16px;
        font-family: inherit;
      }
      .back-btn:hover {
        color: #002855;
      }

      .detail-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        padding: 16px 0;
        border-bottom: 1px solid #e5e7eb;
        margin-bottom: 24px;
      }
      .detail-meta {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .detail-field {
        font-size: 14px;
        color: #474747;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .detail-label {
        font-weight: 600;
        color: #002855;
      }
      .detail-total {
        text-align: right;
      }
      .detail-total-label {
        font-size: 13px;
        color: rgba(45, 41, 38, 0.6);
        display: block;
      }
      .detail-total-amount {
        font-size: 28px;
        font-weight: 700;
        color: #004C97;
      }

      .section-label {
        font-size: 16px;
        font-weight: 700;
        color: #002855;
        margin-bottom: 12px;
      }

      .line-items-section {
        margin-bottom: 24px;
      }
      .line-items-table {
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        overflow: hidden;
      }
      .li-header, .li-row {
        display: grid;
        grid-template-columns: 1fr 1fr 60px 90px 90px;
        align-items: center;
        padding: 10px 16px;
        gap: 12px;
      }
      .li-header {
        background: #f9fafb;
        font-size: 12px;
        font-weight: 600;
        color: rgba(45, 41, 38, 0.7);
        text-transform: uppercase;
        letter-spacing: 0.03em;
        border-bottom: 1px solid #e5e7eb;
      }
      .li-row {
        font-size: 14px;
        color: #2D2926;
        border-bottom: 1px solid #f3f4f6;
      }
      .li-row:last-child {
        border-bottom: none;
      }
      .li-col-qty {
        text-align: center;
      }
      .li-col-price, .li-col-total {
        text-align: right;
      }

      .notes-section {
        margin-bottom: 24px;
      }
      .notes-content {
        font-size: 14px;
        color: #474747;
        line-height: 1.6;
        white-space: pre-line;
        background: #f9fafb;
        padding: 16px;
        border-radius: 8px;
      }

      .pay-section {
        padding: 20px 0 0;
        border-top: 1px solid #e5e7eb;
      }
      .pay-btn {
        display: block;
        width: 100%;
        max-width: 320px;
        margin: 0 auto;
        padding: 14px 32px;
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
      .pay-btn:hover {
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
        .header, .list-body, .detail-body {
          padding: 16px;
        }
        .table-header, .table-row {
          grid-template-columns: 80px 1fr 80px 70px;
          gap: 8px;
          padding: 10px 12px;
          font-size: 13px;
        }
        .detail-header {
          flex-direction: column;
          gap: 16px;
        }
        .detail-total {
          text-align: left;
        }
        .detail-total-amount {
          font-size: 24px;
        }
        .li-header, .li-row {
          grid-template-columns: 1fr 60px 70px;
          font-size: 13px;
        }
        .li-col-desc, .li-col-price {
          display: none;
        }
      }
    `;
  }
}

customElements.define("next-my-invoices", MyInvoicesWidget);
