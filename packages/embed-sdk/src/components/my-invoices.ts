import { MPNextWidget } from "../shared/base-widget";
import { cardButton, CARD_LINK_STYLES } from "../shared/card-link";

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

/**
 * `next-my-invoices` — the signed-in member's invoices, with a detail view.
 *
 * ## Paying (C44 / C45, Route A of `Plans/my-invoices.md`)
 *
 * "Pay" is a real `<a href>` to the church's checkout page —
 * `<checkout-url>?id=<Invoice_GUID>`, which is what `next-checkout` (default
 * `invoice-id-parameter-name="id"`) and legacy's own "Pay Balance" link read.
 * It used to inject the legacy `<mpp-checkout invoiceid="<numeric id>">` into
 * a page overlay: an element that never upgrades on a site loading only this
 * SDK, keyed on the wrong id. No `mpp-*` tag is injected anywhere now. With no
 * `checkout-url` there is no Pay affordance, rather than a dead one.
 *
 * Rows open the in-widget detail view, so each is a real `<button>`
 * (`cardButton`). The row-level Pay link sits **beside** the button, never
 * inside it: an anchor inside a button is invalid and unreachable by keyboard.
 *
 * ## Configuration (C60) — legacy `mpp-my-invoices`' six options, kebab-case
 *
 * | attribute | legacy | effect |
 * |---|---|---|
 * | `congregation-id` | `congregationid` | server-side: only that congregation's invoices |
 * | `month-id` | `monthid` | server-side: invoices dated in that month (1–12) |
 * | `invoice-status-id` | `invoiceStatusId` | server-side, legacy values: `1` balance due, `2` paid in full, `0`/absent all |
 * | `keyword` | `keyword` | seeds the search box |
 * | `hide-free-events-checkbox` | `hidefreeeventscheckbox` | hides the "Show free registrations" toggle |
 * | `checkout-url` | `targeturl` | the checkout page "Pay" links to |
 *
 * plus `show-free-events="false"` for legacy's default of hiding zero-total
 * invoices (ours lists them, badged "Free" — see C60's resolution).
 * Attribute changes after the first paint reload, per the W0 reconfigure
 * convention.
 */
export class MyInvoicesWidget extends MPNextWidget {
  private invoices: InvoiceListItem[] = [];
  private selectedDetail: InvoiceDetailResponse | null = null;
  private loading = true;
  private detailLoading = false;
  private needsAuth = false;
  private error: string | null = null;
  private searchQuery = "";
  /** The "Show free registrations" toggle; seeded from `show-free-events`. */
  private showFree = true;
  private view: "list" | "detail" = "list";
  /** The row that opened the detail view, so Back can return focus to it. */
  private lastRowId: number | null = null;

  static get observedAttributes() {
    return [
      "api-host",
      "congregation-id",
      "month-id",
      "invoice-status-id",
      "keyword",
      "hide-free-events-checkbox",
      "show-free-events",
      "checkout-url",
    ];
  }

  connectedCallback() {
    this.injectStyles(`${this.getStyles()}${CARD_LINK_STYLES}`);
    this.seedFromAttributes();
    // Await the catalogue before the first paint so a Spanish visitor never
    // sees English swap to Spanish; it hides inside the loading state this
    // widget paints anyway while it queries the API.
    void this.initLocale().then(() => {
      this.render();
      this.painted = true;
      void this.loadInvoices();
    });
  }

  /** W0 reconfigure convention: an attribute change after first paint reloads. */
  protected override reload(): void {
    this.seedFromAttributes();
    this.view = "list";
    this.selectedDetail = null;
    void this.loadInvoices();
  }

  public retryLoad() {
    this.error = null;
    this.view = "list";
    void this.loadInvoices();
  }

  // ── Attributes ──

  private seedFromAttributes(): void {
    this.searchQuery = this.getAttribute("keyword")?.trim() ?? "";
    this.showFree = this.getAttribute("show-free-events") !== "false";
  }

  private get hideFreeToggle(): boolean {
    const v = this.getAttribute("hide-free-events-checkbox");
    return v !== null && v !== "false";
  }

  /** `<checkout-url>?id=<Invoice_GUID>`, or null when not configured / unsafe. */
  private checkoutHref(inv: InvoiceListItem): string | null {
    const base = this.getAttribute("checkout-url")?.trim();
    if (!base) return null;
    try {
      const url = new URL(base, window.location.href);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      url.searchParams.set("id", inv.Invoice_GUID);
      return url.toString();
    } catch {
      return null;
    }
  }

  /** Query string for the server-side filters (C60). */
  private listQuery(): string {
    const params = new URLSearchParams();
    const add = (attr: string, param: string) => {
      const v = this.getAttribute(attr)?.trim();
      if (v && /^\d+$/.test(v)) params.set(param, v);
    };
    add("congregation-id", "congregationId");
    add("month-id", "monthId");
    add("invoice-status-id", "invoiceStatusId");
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }

  // ── Data ──

  private async loadInvoices() {
    this.loading = true;
    this.needsAuth = false;
    this.error = null;
    this.render();

    try {
      const res = await this.fetch(`/api/embed/invoices${this.listQuery()}`);
      // An anonymous visitor is this widget's *normal* first state — members
      // arrive from an emailed link — so it is a sign-in prompt, never
      // "Unable to Load" with a Try Again that fails identically (C46).
      if (this.isNeedsAuth(res)) {
        this.needsAuth = true;
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(this.errorText(data));
      }
      const data: { invoices: InvoiceListItem[] } = await res.json();
      this.invoices = data.invoices;
      this.emit("invoicesLoaded", { count: data.invoices.length });
    } catch (err) {
      // `errorText` has already turned an API machine code into a translated
      // sentence; anything else (a dropped connection) becomes the generic
      // network message rather than leaking English.
      this.error = err instanceof Error ? err.message : this.t("errors.network");
      this.emit("invoiceError", { error: this.error });
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private async loadInvoiceDetail(invoiceId: number) {
    this.view = "detail";
    this.lastRowId = invoiceId;
    this.detailLoading = true;
    this.selectedDetail = null;
    this.error = null;
    this.render();

    try {
      const res = await this.fetch(`/api/embed/invoices/${invoiceId}`);
      if (this.isNeedsAuth(res)) {
        this.view = "list";
        this.needsAuth = true;
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(this.errorText(data, "errors.invoice_not_found"));
      }
      const data: InvoiceDetailResponse = await res.json();
      this.selectedDetail = data;
      this.emit("invoiceSelected", { invoiceId });
    } catch (err) {
      this.error = err instanceof Error ? err.message : this.t("errors.network");
      this.emit("invoiceError", { error: this.error });
    } finally {
      this.detailLoading = false;
      this.render();
      // Keyboard users land on the view they asked for, not on <body>.
      this.root.querySelector<HTMLElement>('[data-action="back"]')?.focus();
    }
  }

  private attachListeners() {
    const searchInput = this.root.querySelector<HTMLInputElement>("#invoice-search");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        this.searchQuery = searchInput.value;
        this.render();
        const newInput = this.root.querySelector<HTMLInputElement>("#invoice-search");
        if (newInput) {
          newInput.focus();
          newInput.selectionStart = newInput.selectionEnd = newInput.value.length;
        }
      });
    }

    const freeToggle = this.root.querySelector<HTMLInputElement>("#invoice-show-free");
    if (freeToggle) {
      freeToggle.addEventListener("change", () => {
        this.showFree = freeToggle.checked;
        this.render();
        this.root.querySelector<HTMLInputElement>("#invoice-show-free")?.focus();
      });
    }

    // Rows are real buttons: click, Enter and Space all arrive as `click`.
    this.root.querySelectorAll<HTMLElement>("button[data-invoice-id]").forEach((row) => {
      row.addEventListener("click", () => {
        const id = parseInt(row.dataset.invoiceId || "0", 10);
        if (id) void this.loadInvoiceDetail(id);
      });
    });

    // The Pay links navigate by themselves; this only announces it.
    this.root.querySelectorAll<HTMLAnchorElement>("a[data-pay-guid]").forEach((a) => {
      a.addEventListener("click", () => {
        this.emit("invoicePay", { invoiceGuid: a.dataset.payGuid });
      });
    });

    const backBtn = this.root.querySelector<HTMLButtonElement>('[data-action="back"]');
    if (backBtn) {
      backBtn.addEventListener("click", () => {
        this.view = "list";
        this.selectedDetail = null;
        this.error = null;
        this.render();
        if (this.lastRowId !== null) {
          this.root
            .querySelector<HTMLElement>(`button[data-invoice-id="${this.lastRowId}"]`)
            ?.focus();
        }
      });
    }

    const retryBtn = this.root.querySelector('[data-action="retry"]');
    if (retryBtn) {
      retryBtn.addEventListener("click", () => this.retryLoad());
    }
  }

  // ── Rendering ──

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
    if (this.loading) {
      this.root.innerHTML = `
        <div class="nw-invoices">
          <div class="header">
            <div class="loading-row">
              ${this.spinnerSvg()}
              <span>${this.escapeHtml(this.t("myInvoices.loading"))}</span>
            </div>
          </div>
        </div>`;
      return;
    }

    if (this.needsAuth) {
      // The base class delegates the `[data-action="login"]` button; no Try
      // Again here, ever.
      this.root.innerHTML = `
        <div class="nw-invoices">
          <div class="header">
            <div class="title">${this.escapeHtml(this.t("myInvoices.title"))}</div>
          </div>
          ${this.renderSignInRequired({
            subject: "my-invoices",
            message: this.t("myInvoices.signInPrompt"),
            className: "retry-section",
            buttonClass: "retry-btn",
          })}
        </div>`;
      return;
    }

    if (this.error && this.view === "list") {
      this.root.innerHTML = `
        <div class="nw-invoices">
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

    if (this.view === "detail") {
      this.root.innerHTML = this.renderDetail();
      return;
    }

    this.root.innerHTML = this.renderList();
  }

  /** Payable: open balance, not paid, not cancelled, not a free registration. */
  private isPayable(inv: InvoiceListItem): boolean {
    return (
      inv.Invoice_Status_ID !== PAID_STATUS_ID &&
      inv.Invoice_Status_ID !== CANCELLED_STATUS_ID &&
      inv.Invoice_Total > 0
    );
  }

  private renderList(): string {
    const filtered = this.getFilteredInvoices();
    const hasFree = this.invoices.some((inv) => inv.Invoice_Total <= 0);
    const showSearch = this.invoices.length > 3 || this.searchQuery !== "";
    const showFreeToggle = hasFree && !this.hideFreeToggle;
    const payColumn = Boolean(this.getAttribute("checkout-url"));
    return `
      <div class="nw-invoices">
        <div class="header">
          <div class="title">${this.escapeHtml(this.t("myInvoices.title"))}</div>
          <p class="subtitle">${this.escapeHtml(this.t("myInvoices.invoiceCount", { count: filtered.length }))}</p>
        </div>
        <div class="list-body">
          ${showSearch || showFreeToggle
            ? `<div class="search-bar">
                ${showSearch
                  ? `<input type="search" id="invoice-search"
                      aria-label="${this.escapeHtml(this.t("myInvoices.searchLabel"))}"
                      placeholder="${this.escapeHtml(this.t("myInvoices.searchPlaceholder"))}"
                      value="${this.escapeHtml(this.searchQuery)}">`
                  : ""}
                ${showFreeToggle
                  ? `<label class="free-toggle">
                      <input type="checkbox" id="invoice-show-free" ${this.showFree ? "checked" : ""}>
                      <span>${this.escapeHtml(this.t("myInvoices.showFree"))}</span>
                    </label>`
                  : ""}
              </div>`
            : ""}
          ${filtered.length === 0
            ? `<div class="empty-state">
                ${this.escapeHtml(this.t(this.searchQuery ? "myInvoices.noMatches" : "myInvoices.empty"))}
              </div>`
            : `<div class="invoice-table ${payColumn ? "invoice-table--pay" : ""}" role="list">
                <div class="table-header" aria-hidden="true">
                  <span class="col-date">${this.escapeHtml(this.t("fields.date"))}</span>
                  <span class="col-desc">${this.escapeHtml(this.t("myInvoices.description"))}</span>
                  <span class="col-status">${this.escapeHtml(this.t("myInvoices.status"))}</span>
                  <span class="col-total">${this.escapeHtml(this.t("common.total"))}</span>
                </div>
                ${filtered.map((inv) => this.renderInvoiceRow(inv, payColumn)).join("")}
              </div>`}
        </div>
      </div>`;
  }

  private renderInvoiceRow(inv: InvoiceListItem, payColumn: boolean): string {
    const description = this.getInvoiceDescription(inv);
    const statusClass = this.getStatusClass(inv.Invoice_Status_ID);
    const payable = this.isPayable(inv);
    const payHref = payable ? this.checkoutHref(inv) : null;
    const isFree = inv.Invoice_Total <= 0;
    // Phrasing content only inside the button (`cardButton`): spans, not divs.
    const body = `
      <span class="col-date">${this.escapeHtml(this.fmt.date(inv.Invoice_Date))}</span>
      <span class="col-desc">${this.escapeHtml(description)}</span>
      <span class="col-status">
        <span class="badge ${statusClass}">${this.escapeHtml(inv.Invoice_Status)}</span>
      </span>
      <span class="col-total">${
        // A free registration is badged, not "$0.00" (C60, with C47's vocabulary).
        isFree
          ? `<span class="badge badge-free">${this.escapeHtml(this.t("myInvoices.free"))}</span>`
          : this.escapeHtml(this.fmt.currency(inv.Invoice_Total, inv.Currency))
      }</span>`;
    const pay = payHref
      ? `<a class="row-pay" href="${this.escapeHtml(payHref)}" data-pay-guid="${this.escapeHtml(inv.Invoice_GUID)}"
          aria-label="${this.escapeHtml(this.t("myInvoices.payLabel", { description }))}">${this.escapeHtml(this.t("myInvoices.pay"))} &rarr;</a>`
      : payColumn
        ? `<span class="row-pay row-pay--none"></span>`
        : "";
    return `
      <div class="row-item ${payable ? "row-item--payable" : ""}" role="listitem">
        ${cardButton({
          className: "table-row",
          body,
          attrs: { "data-invoice-id": inv.Invoice_ID },
        })}
        ${pay}
      </div>`;
  }

  private renderDetail(): string {
    if (this.detailLoading) {
      return `
        <div class="nw-invoices">
          <div class="header">
            <div class="loading-row">
              ${this.spinnerSvg()}
              <span>${this.escapeHtml(this.t("myInvoices.loadingDetail"))}</span>
            </div>
          </div>
        </div>`;
    }

    if (this.error || !this.selectedDetail) {
      return `
        <div class="nw-invoices">
          <div class="header">
            <div class="title">${this.escapeHtml(this.t("common.unableToLoad"))}</div>
            <p class="subtitle">${this.escapeHtml(this.error || this.t("errors.invoice_not_found"))}</p>
          </div>
          <div class="detail-body">
            <button class="back-btn" data-action="back">&larr; ${this.escapeHtml(this.t("myInvoices.backToList"))}</button>
          </div>
        </div>`;
    }

    const inv = this.selectedDetail.invoice;
    const items = this.selectedDetail.lineItems;
    const statusClass = this.getStatusClass(inv.Invoice_Status_ID);
    const payHref = this.isPayable(inv) ? this.checkoutHref(inv) : null;
    const isFree = inv.Invoice_Total <= 0;

    return `
      <div class="nw-invoices">
        <div class="header">
          <div class="title">${this.escapeHtml(this.t("myInvoices.detailTitle"))}</div>
        </div>
        <div class="detail-body">
          <button class="back-btn" data-action="back">&larr; ${this.escapeHtml(this.t("myInvoices.backToList"))}</button>
          <div class="detail-header">
            <div class="detail-meta">
              <div class="detail-field">
                <span class="detail-label">${this.escapeHtml(this.t("myInvoices.invoiceDate"))}:</span>
                ${this.escapeHtml(this.fmt.date(inv.Invoice_Date, "long"))}
              </div>
              <div class="detail-field">
                <span class="detail-label">${this.escapeHtml(this.t("myInvoices.status"))}:</span>
                <span class="badge ${statusClass}">${this.escapeHtml(inv.Invoice_Status)}</span>
              </div>
            </div>
            <div class="detail-total">
              <span class="detail-total-label">${this.escapeHtml(this.t("common.total"))}:</span>
              <span class="detail-total-amount">${
                isFree
                  ? this.escapeHtml(this.t("myInvoices.free"))
                  : this.escapeHtml(this.fmt.currency(inv.Invoice_Total, inv.Currency))
              }</span>
            </div>
          </div>
          ${items.length > 0
            ? `<div class="line-items-section">
                <div class="section-label">${this.escapeHtml(this.t("myInvoices.lineItems"))}</div>
                <div class="line-items-table">
                  <div class="li-header">
                    <span class="li-col-product">${this.escapeHtml(this.t("myInvoices.product"))}</span>
                    <span class="li-col-desc">${this.escapeHtml(this.t("myInvoices.description"))}</span>
                    <span class="li-col-qty">${this.escapeHtml(this.t("myInvoices.quantity"))}</span>
                    <span class="li-col-price">${this.escapeHtml(this.t("myInvoices.unitPrice"))}</span>
                    <span class="li-col-total">${this.escapeHtml(this.t("common.total"))}</span>
                  </div>
                  ${items.map((item) => this.renderLineItem(item)).join("")}
                </div>
              </div>`
            : ""}
          ${inv.Notes
            ? `<div class="notes-section">
                <div class="section-label">${this.escapeHtml(this.t("fields.notes"))}</div>
                <div class="notes-content">${this.escapeHtml(inv.Notes)}</div>
              </div>`
            : ""}
          ${payHref
            ? `<div class="pay-section">
                <a class="pay-btn" href="${this.escapeHtml(payHref)}" data-pay-guid="${this.escapeHtml(inv.Invoice_GUID)}">${this.escapeHtml(this.t("myInvoices.payNow"))}</a>
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
        <span class="li-col-qty">${this.escapeHtml(this.fmt.number(item.Item_Quantity))}</span>
        <span class="li-col-price">${this.escapeHtml(this.fmt.currency(unitPrice))}</span>
        <span class="li-col-total">${this.escapeHtml(this.fmt.currency(item.Line_Total))}</span>
      </div>`;
  }

  private getFilteredInvoices(): InvoiceListItem[] {
    const visible = this.showFree
      ? this.invoices
      : this.invoices.filter((inv) => inv.Invoice_Total > 0);
    if (!this.searchQuery) return visible;
    const q = this.searchQuery.toLowerCase();
    return visible.filter(
      (inv) =>
        this.getInvoiceDescription(inv).toLowerCase().includes(q) ||
        inv.Invoice_Status.toLowerCase().includes(q) ||
        this.fmt.date(inv.Invoice_Date).toLowerCase().includes(q) ||
        String(inv.Invoice_Total).includes(q) ||
        (inv.Product_Summary && inv.Product_Summary.toLowerCase().includes(q))
    );
  }

  private getInvoiceDescription(inv: InvoiceListItem): string {
    // `Product_Summary` is MP-authored and stays as MP wrote it; only the
    // fallback is ours to translate.
    if (inv.Product_Summary) return inv.Product_Summary;
    return this.t("myInvoices.invoiceNumber", { id: inv.Invoice_ID });
  }

  private getStatusClass(statusId: number): string {
    switch (statusId) {
      case PAID_STATUS_ID: return "badge-paid";
      case 1: case 2: return "badge-pending";
      case CANCELLED_STATUS_ID: return "badge-cancelled";
      default: return "badge-default";
    }
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
        font-family: var(--_nw-font-family);
      }

      .nw-invoices {
        max-width: 800px;
        margin: 0 auto;
        background: var(--_nw-color-surface);
        border-radius: 16px;
        overflow: hidden;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      }

      .header {
        background: var(--_nw-color-secondary);
        color: var(--_nw-color-on-primary);
        padding: var(--_nw-space-6);
      }
      .title {
        font-size: 24px;
        font-weight: var(--_nw-font-weight-heading);
        text-align: center;
        margin-bottom: var(--_nw-space-1);
      }
      .subtitle {
        text-align: center;
        opacity: 0.8;
        font-size: var(--_nw-font-size-base);
        margin: 0;
      }
      .loading-row {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--_nw-space-3);
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
        padding: var(--_nw-space-5);
      }

      .search-bar {
        margin-bottom: var(--_nw-space-4);
      }
      .search-bar input {
        width: 100%;
        padding: 10px 14px;
        border: var(--_nw-border-width) solid var(--_nw-color-border);
        border-radius: var(--_nw-radius);
        font-size: var(--_nw-font-size-base);
        font-family: inherit;
        outline: none;
        transition: border-color 0.15s;
      }
      .search-bar input:focus {
        border-color: var(--_nw-color-primary);
      }

      .empty-state {
        text-align: center;
        padding: 40px var(--_nw-space-5);
        color: #9E9E9E;
        font-size: var(--_nw-font-size-base);
      }

      .invoice-table {
        border: var(--_nw-border-width) solid var(--_nw-color-border);
        border-radius: var(--_nw-radius);
        overflow: hidden;
      }
      .table-header, .table-row {
        display: grid;
        grid-template-columns: 120px 1fr 110px 90px;
        align-items: center;
        padding: var(--_nw-space-3) var(--_nw-space-4);
        gap: var(--_nw-space-3);
      }
      .table-header {
        background: #f9fafb;
        font-size: 12px;
        font-weight: 600;
        color: rgba(45, 41, 38, 0.7);
        text-transform: uppercase;
        letter-spacing: 0.03em;
        border-bottom: var(--_nw-border-width) solid var(--_nw-color-border);
      }
      .row-item {
        display: flex;
        align-items: center;
        border-bottom: var(--_nw-border-width) solid var(--_nw-color-surface-muted);
        border-left: 3px solid transparent;
      }
      .row-item:last-child {
        border-bottom: none;
      }
      .row-item--payable {
        border-left-color: var(--_nw-color-accent);
      }
      .table-row {
        flex: 1;
        min-width: 0;
        font-size: var(--_nw-font-size-base);
        color: var(--_nw-color-text);
        cursor: pointer;
        transition: background 0.15s;
      }
      .table-row:hover {
        background: rgba(0, 76, 151, 0.03);
      }
      .row-pay {
        flex: 0 0 64px;
        box-sizing: border-box;
        padding: var(--_nw-space-3) var(--_nw-space-2);
        text-align: center;
        font-size: 12px;
        font-weight: 600;
        color: var(--_nw-color-primary);
        text-decoration: none;
      }
      a.row-pay:hover {
        color: var(--_nw-color-secondary);
        text-decoration: underline;
      }
      a.row-pay:focus-visible, a.pay-btn:focus-visible {
        outline: var(--_nw-focus-ring);
        outline-offset: 2px;
      }
      .invoice-table--pay .table-header {
        padding-right: 80px;
      }
      .free-toggle {
        display: inline-flex;
        align-items: center;
        gap: var(--_nw-space-2);
        margin-top: 10px;
        font-size: 13px;
        color: var(--_nw-color-text-subtle);
        cursor: pointer;
      }
      .free-toggle input {
        accent-color: var(--_nw-color-primary);
        width: 16px;
        height: 16px;
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
        color: var(--_nw-color-error-text);
      }
      .badge-default {
        background: var(--_nw-color-surface-muted);
        color: var(--_nw-color-text-subtle);
      }
      .badge-free {
        background: rgba(0, 156, 222, 0.12);
        color: var(--_nw-color-primary);
      }

      .detail-body {
        padding: var(--_nw-space-5);
      }
      .back-btn {
        background: none;
        border: none;
        color: var(--_nw-color-primary);
        font-size: var(--_nw-font-size-base);
        font-weight: 600;
        cursor: pointer;
        padding: var(--_nw-space-2) 0;
        margin-bottom: var(--_nw-space-4);
        font-family: inherit;
      }
      .back-btn:hover {
        color: var(--_nw-color-secondary);
      }

      .detail-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        padding: var(--_nw-space-4) 0;
        border-bottom: var(--_nw-border-width) solid var(--_nw-color-border);
        margin-bottom: var(--_nw-space-6);
      }
      .detail-meta {
        display: flex;
        flex-direction: column;
        gap: var(--_nw-space-2);
      }
      .detail-field {
        font-size: var(--_nw-font-size-base);
        color: var(--_nw-color-text-subtle);
        display: flex;
        align-items: center;
        gap: var(--_nw-space-2);
      }
      .detail-label {
        font-weight: 600;
        color: var(--_nw-color-secondary);
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
        color: var(--_nw-color-primary);
      }

      .section-label {
        font-size: 16px;
        font-weight: var(--_nw-font-weight-heading);
        color: var(--_nw-color-secondary);
        margin-bottom: var(--_nw-space-3);
      }

      .line-items-section {
        margin-bottom: var(--_nw-space-6);
      }
      .line-items-table {
        border: var(--_nw-border-width) solid var(--_nw-color-border);
        border-radius: var(--_nw-radius);
        overflow: hidden;
      }
      .li-header, .li-row {
        display: grid;
        grid-template-columns: 1fr 1fr 60px 90px 90px;
        align-items: center;
        padding: 10px var(--_nw-space-4);
        gap: var(--_nw-space-3);
      }
      .li-header {
        background: #f9fafb;
        font-size: 12px;
        font-weight: 600;
        color: rgba(45, 41, 38, 0.7);
        text-transform: uppercase;
        letter-spacing: 0.03em;
        border-bottom: var(--_nw-border-width) solid var(--_nw-color-border);
      }
      .li-row {
        font-size: var(--_nw-font-size-base);
        color: var(--_nw-color-text);
        border-bottom: var(--_nw-border-width) solid var(--_nw-color-surface-muted);
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
        margin-bottom: var(--_nw-space-6);
      }
      .notes-content {
        font-size: var(--_nw-font-size-base);
        color: var(--_nw-color-text-subtle);
        line-height: 1.6;
        white-space: pre-line;
        background: #f9fafb;
        padding: var(--_nw-space-4);
        border-radius: var(--_nw-radius);
      }

      .pay-section {
        padding: var(--_nw-space-5) 0 0;
        border-top: var(--_nw-border-width) solid var(--_nw-color-border);
      }
      .pay-btn {
        display: block;
        box-sizing: border-box;
        text-align: center;
        text-decoration: none;
        width: 100%;
        max-width: 320px;
        margin: 0 auto;
        padding: 14px 32px;
        background: var(--_nw-button-bg);
        color: var(--_nw-button-fg);
        font-weight: bold;
        font-size: var(--_nw-font-size-base);
        border: none;
        border-radius: var(--_nw-button-radius);
        cursor: pointer;
        font-family: inherit;
        transition: background 0.15s;
      }
      .pay-btn:hover {
        background: var(--_nw-button-bg-hover);
      }

      .retry-section {
        padding: var(--_nw-space-5);
        text-align: center;
      }
      .retry-btn {
        display: inline-block;
        padding: 10px var(--_nw-space-6);
        background: var(--_nw-button-bg);
        color: var(--_nw-button-fg);
        font-weight: 600;
        font-size: var(--_nw-font-size-base);
        border: none;
        border-radius: var(--_nw-button-radius);
        cursor: pointer;
        font-family: inherit;
        transition: background 0.15s;
      }
      .retry-btn:hover {
        background: var(--_nw-button-bg-hover);
      }

      @media (max-width: 640px) {
        .header, .list-body, .detail-body {
          padding: var(--_nw-space-4);
        }
        .table-header, .table-row {
          grid-template-columns: 80px 1fr 80px 70px;
          gap: var(--_nw-space-2);
          padding: 10px var(--_nw-space-3);
          font-size: 13px;
        }
        .detail-header {
          flex-direction: column;
          gap: var(--_nw-space-4);
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
