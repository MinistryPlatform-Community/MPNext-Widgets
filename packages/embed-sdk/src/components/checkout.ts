import { MPNextWidget } from "../shared/base-widget";

interface CheckoutLineItem {
  invoiceDetailId: number;
  itemName: string | null;
  itemNote: string | null;
  recipientName: string | null;
  quantity: number;
  lineTotal: number;
  isSubItem: boolean;
  eventParticipantId: number | null;
}

interface CheckoutInvoice {
  invoiceId: number;
  invoiceGuid: string;
  invoiceDate: string;
  invoiceTotal: number;
  amountPaid: number;
  balanceDue: number;
  depositDue: number | null;
  statusId: number;
  status: string;
  canPay: boolean;
  payorContactId: number | null;
  payor: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    mobilePhone: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
  };
  lineItems: CheckoutLineItem[];
}

type PayChoice = "full" | "deposit" | "other";

/**
 * `next-checkout` — renders an invoice for payment and hands the payer off to a
 * payment processor page (e.g. `next-pay`). When the gateway returns with a
 * `token` query param it processes the payment response, shows a confirmation,
 * then reloads the now-updated invoice.
 */
export class CheckoutWidget extends MPNextWidget {
  private invoice: CheckoutInvoice | null = null;
  private loading = true;
  private error: string | null = null;
  private guid: string | null = null;

  private payChoice: PayChoice = "full";
  private otherAmount = "";
  private processing = false;

  private confirmation: { kind: "success" | "pending"; message: string } | null = null;

  static get observedAttributes() {
    return [
      "api-host",
      "payment-processor-url",
      "back-to-event-url",
      "invoice-id-parameter-name",
      "invoice-id",
    ];
  }

  connectedCallback() {
    this.injectStyles(this.getStyles());
    this.render();
    this.init();
  }

  public retryLoad() {
    this.error = null;
    this.init();
  }

  private async init() {
    this.guid = this.resolveGuid();

    // Returning from the gateway with a payment response token.
    const token = this.getUrlParam("token");
    if (token) {
      await this.processPaymentResponse(token);
      this.stripTokenFromUrl();
    }

    await this.loadInvoice();
  }

  private resolveGuid(): string | null {
    const attr = this.getAttribute("invoice-id");
    if (attr) return attr;

    const paramName = this.getAttribute("invoice-id-parameter-name") || "id";
    return (
      this.getUrlParam(paramName) ||
      this.getUrlParam("id") ||
      this.getUrlParam("invoiceid")
    );
  }

  private getUrlParam(name: string): string | null {
    try {
      return new URL(window.location.href).searchParams.get(name);
    } catch {
      return null;
    }
  }

  private stripTokenFromUrl() {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has("token")) {
        url.searchParams.delete("token");
        history.replaceState(null, "", url.toString());
      }
    } catch {
      /* no-op */
    }
  }

  private currentPageUrlWithoutToken(): string {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("token");
      return url.toString();
    } catch {
      return window.location.href;
    }
  }

  private async processPaymentResponse(token: string) {
    this.processing = true;
    this.render();
    try {
      const res = await this.fetch("/api/embed/checkout/payment-response", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data: {
        invoiceId: number | null;
        success: boolean;
        paymentReceived: boolean;
      } = await res.json();

      if (data.paymentReceived) {
        this.confirmation = {
          kind: "success",
          message: "Payment received — thank you!",
        };
      } else {
        this.confirmation = {
          kind: "pending",
          message:
            "Your payment is being processed. This invoice will update once the payment clears.",
        };
      }
      this.emit("paymentComplete", {
        invoiceId: data.invoiceId,
        paymentReceived: data.paymentReceived,
      });
    } catch (err) {
      this.confirmation = {
        kind: "pending",
        message:
          err instanceof Error
            ? `We could not confirm your payment: ${err.message}`
            : "We could not confirm your payment.",
      };
      this.emit("checkoutError", {
        error: err instanceof Error ? err.message : "Payment response failed",
      });
    } finally {
      this.processing = false;
      this.render();
    }
  }

  private async loadInvoice() {
    if (!this.guid) {
      this.loading = false;
      this.error = "No invoice was specified.";
      this.render();
      this.attachListeners();
      this.emit("checkoutError", { error: this.error });
      return;
    }

    this.loading = true;
    this.error = null;
    this.render();

    try {
      const res = await this.fetch(
        `/api/embed/checkout/invoice?guid=${encodeURIComponent(this.guid)}`,
      );
      if (res.status === 404) {
        throw new Error("Invoice not found.");
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data: { invoice: CheckoutInvoice } = await res.json();
      this.invoice = data.invoice;
      this.payChoice = "full";
      this.emit("invoiceLoaded", { invoiceId: this.invoice.invoiceId });
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Failed to load invoice";
      this.emit("checkoutError", { error: this.error });
    } finally {
      this.loading = false;
      this.render();
      this.attachListeners();
    }
  }

  private selectedAmount(): number {
    if (!this.invoice) return 0;
    if (this.payChoice === "deposit" && this.invoice.depositDue != null) {
      return this.invoice.depositDue;
    }
    if (this.payChoice === "other") {
      const n = parseFloat(this.otherAmount);
      return isNaN(n) || n < 0 ? 0 : n;
    }
    return this.invoice.balanceDue;
  }

  private async startPayment() {
    if (!this.invoice || !this.guid) return;
    const amount = this.selectedAmount();
    if (amount <= 0) {
      this.error = "Please enter a valid payment amount.";
      this.render();
      this.attachListeners();
      return;
    }

    const processorUrl = this.getAttribute("payment-processor-url");
    if (!processorUrl) {
      this.error = "Payment processor is not configured.";
      this.render();
      this.attachListeners();
      this.emit("checkoutError", { error: this.error });
      return;
    }

    this.processing = true;
    this.render();

    try {
      const returnUrl = encodeURIComponent(this.currentPageUrlWithoutToken());
      const res = await this.fetch(
        `/api/embed/checkout/payment-token?guid=${encodeURIComponent(
          this.guid,
        )}&amount=${encodeURIComponent(String(amount))}&returnUrl=${returnUrl}`,
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data: { token: string } = await res.json();
      const sep = processorUrl.includes("?") ? "&" : "?";
      window.location.href = `${processorUrl}${sep}token=${encodeURIComponent(
        data.token,
      )}`;
    } catch (err) {
      this.processing = false;
      this.error = err instanceof Error ? err.message : "Failed to start payment";
      this.render();
      this.attachListeners();
      this.emit("checkoutError", { error: this.error });
    }
  }

  private attachListeners() {
    const retry = this.root.querySelector('[data-action="retry"]');
    if (retry) {
      retry.addEventListener("click", () => this.retryLoad());
    }

    const payBtn = this.root.querySelector<HTMLButtonElement>('[data-action="pay"]');
    if (payBtn) {
      payBtn.addEventListener("click", () => this.startPayment());
    }

    this.root
      .querySelectorAll<HTMLInputElement>('input[name="nw-pay-choice"]')
      .forEach((radio) => {
        radio.addEventListener("change", () => {
          this.payChoice = radio.value as PayChoice;
          this.render();
          this.attachListeners();
          if (this.payChoice === "other") {
            const input = this.root.querySelector<HTMLInputElement>("#nw-other-amount");
            input?.focus();
          }
        });
      });

    const other = this.root.querySelector<HTMLInputElement>("#nw-other-amount");
    if (other) {
      other.addEventListener("input", () => {
        this.otherAmount = other.value;
        const total = this.root.querySelector("#nw-pay-total");
        if (total) total.textContent = this.formatCurrency(this.selectedAmount());
      });
    }
  }

  render() {
    if (this.processing && !this.loading) {
      this.root.innerHTML = this.shell(`
        <div class="nw-co-state">
          ${this.spinnerSvg()}
          <span>Processing…</span>
        </div>`);
      return;
    }

    if (this.loading) {
      this.root.innerHTML = this.shell(`
        <div class="nw-co-state">
          ${this.spinnerSvg()}
          <span>Loading invoice…</span>
        </div>`);
      return;
    }

    if (this.error && !this.invoice) {
      this.root.innerHTML = this.shell(`
        <div class="nw-co-state nw-co-error">
          <p>${this.escapeHtml(this.error)}</p>
          <button class="nw-co-btn" data-action="retry">Try Again</button>
        </div>`);
      return;
    }

    if (!this.invoice) {
      this.root.innerHTML = this.shell(`
        <div class="nw-co-state nw-co-empty">No invoice to display.</div>`);
      return;
    }

    this.root.innerHTML = this.shell(this.renderInvoice(this.invoice));
  }

  private shell(body: string): string {
    return `
      <div class="nw-co">
        <div class="nw-co-header">Invoice Details</div>
        <div class="nw-co-body">
          ${this.confirmation ? this.renderConfirmation() : ""}
          ${body}
        </div>
      </div>`;
  }

  private renderConfirmation(): string {
    if (!this.confirmation) return "";
    const cls = this.confirmation.kind === "success" ? "nw-co-confirm--success" : "nw-co-confirm--pending";
    return `
      <div class="nw-co-confirm ${cls}">
        ${this.escapeHtml(this.confirmation.message)}
      </div>`;
  }

  private renderInvoice(inv: CheckoutInvoice): string {
    const base = inv.lineItems.filter((li) => !li.isSubItem);
    const subs = inv.lineItems.filter((li) => li.isSubItem);

    return `
      <div class="nw-co-meta">
        <div>
          <span class="nw-co-meta-label">Invoice Date</span>
          <span class="nw-co-meta-value">${this.escapeHtml(this.formatDate(inv.invoiceDate))}</span>
        </div>
        <div>
          <span class="nw-co-meta-label">Status</span>
          <span class="nw-co-meta-value">${this.escapeHtml(inv.status)}</span>
        </div>
      </div>

      ${
        inv.lineItems.length > 0
          ? `<div class="nw-co-items">
              ${base.map((li) => this.renderLineItem(li, false)).join("")}
              ${subs.map((li) => this.renderLineItem(li, true)).join("")}
            </div>`
          : `<div class="nw-co-state nw-co-empty">No line items.</div>`
      }

      <div class="nw-co-totals">
        <div class="nw-co-total-row">
          <span>Total</span>
          <span>${this.formatCurrency(inv.invoiceTotal)}</span>
        </div>
        <div class="nw-co-total-row">
          <span>Amount Paid</span>
          <span>${this.formatCurrency(inv.amountPaid)}</span>
        </div>
        <div class="nw-co-total-row nw-co-total-row--due">
          <span>Balance Due</span>
          <span>${this.formatCurrency(inv.balanceDue)}</span>
        </div>
      </div>

      ${inv.canPay ? this.renderPaySection(inv) : this.renderStatusSection(inv)}
    `;
  }

  private renderLineItem(li: CheckoutLineItem, isSub: boolean): string {
    const name = li.itemName || "Item";
    const recipient = li.recipientName
      ? `<span class="nw-co-item-recipient">${this.escapeHtml(li.recipientName)}</span>`
      : "";
    const note = li.itemNote
      ? `<div class="nw-co-item-note">${this.escapeHtml(li.itemNote)}</div>`
      : "";
    return `
      <div class="nw-co-item ${isSub ? "nw-co-item--sub" : ""}">
        <div class="nw-co-item-main">
          <div class="nw-co-item-name">
            ${recipient}${recipient ? ' — ' : ""}${this.escapeHtml(name)}
          </div>
          ${note}
        </div>
        <div class="nw-co-item-qty">×${li.quantity}</div>
        <div class="nw-co-item-total">${this.formatCurrency(li.lineTotal)}</div>
      </div>`;
  }

  private renderPaySection(inv: CheckoutInvoice): string {
    const hasDeposit = inv.depositDue != null && inv.depositDue > 0;
    return `
      <div class="nw-co-pay">
        <div class="nw-co-pay-title">Payment Amount</div>
        <label class="nw-co-choice">
          <input type="radio" name="nw-pay-choice" value="full" ${this.payChoice === "full" ? "checked" : ""}>
          <span>Pay in full (${this.formatCurrency(inv.balanceDue)})</span>
        </label>
        ${
          hasDeposit
            ? `<label class="nw-co-choice">
                <input type="radio" name="nw-pay-choice" value="deposit" ${this.payChoice === "deposit" ? "checked" : ""}>
                <span>Pay deposit (${this.formatCurrency(inv.depositDue as number)})</span>
              </label>`
            : ""
        }
        <label class="nw-co-choice">
          <input type="radio" name="nw-pay-choice" value="other" ${this.payChoice === "other" ? "checked" : ""}>
          <span>Other amount</span>
        </label>
        ${
          this.payChoice === "other"
            ? `<div class="nw-co-other">
                <span class="nw-co-other-prefix">$</span>
                <input id="nw-other-amount" type="number" min="0" step="0.01"
                  inputmode="decimal" placeholder="0.00"
                  value="${this.escapeAttr(this.otherAmount)}">
              </div>`
            : ""
        }
        ${this.error ? `<div class="nw-co-inline-error">${this.escapeHtml(this.error)}</div>` : ""}
        <div class="nw-co-pay-summary">
          <span>You will pay</span>
          <span id="nw-pay-total" class="nw-co-pay-amount">${this.formatCurrency(this.selectedAmount())}</span>
        </div>
        <button class="nw-co-btn nw-co-btn--pay" data-action="pay">Pay</button>
        ${
          this.getAttribute("back-to-event-url")
            ? `<a class="nw-co-changes" href="${this.escapeAttr(this.getAttribute("back-to-event-url") as string)}">Make Changes</a>`
            : ""
        }
      </div>`;
  }

  private renderStatusSection(inv: CheckoutInvoice): string {
    const paid = inv.balanceDue <= 0;
    const cls = paid ? "nw-co-status--paid" : "nw-co-status--closed";
    const label = paid ? "Paid in full" : this.escapeHtml(inv.status);
    return `
      <div class="nw-co-status ${cls}">
        ${label}
      </div>`;
  }

  // ── Helpers ──

  private formatDate(value: string): string {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const d = m
      ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      : new Date(value);
    if (isNaN(d.getTime())) return value;
    return d.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }

  private formatCurrency(amount: number): string {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);
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
    return `<svg class="nw-co-spinner" viewBox="0 0 24 24" fill="none" width="22" height="22">
      <circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
      <path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
    </svg>`;
  }

  private getStyles(): string {
    return `
      :host { all: initial; display: block; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color: #2D2926; }
      .nw-co { max-width: 720px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
      .nw-co-header { background: #002855; color: white; padding: 24px; font-size: 22px; font-weight: 700; text-align: center; }
      .nw-co-body { padding: 24px; }

      .nw-co-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 40px 16px; color: #6b7280; font-size: 15px; text-align: center; }
      .nw-co-spinner { animation: nw-co-spin 1s linear infinite; color: #004C97; }
      @keyframes nw-co-spin { to { transform: rotate(360deg); } }
      .nw-co-error p { color: #b91c1c; margin: 0 0 12px; }
      .nw-co-empty { color: #9ca3af; }

      .nw-co-confirm { border-radius: 10px; padding: 14px 16px; font-size: 14px; font-weight: 600; margin-bottom: 20px; }
      .nw-co-confirm--success { background: rgba(134,173,63,0.15); color: #4d6a14; border: 1px solid rgba(134,173,63,0.4); }
      .nw-co-confirm--pending { background: rgba(241,190,72,0.18); color: #8a6d10; border: 1px solid rgba(241,190,72,0.5); }

      .nw-co-meta { display: flex; justify-content: space-between; gap: 16px; padding-bottom: 16px; border-bottom: 1px solid #e5e7eb; margin-bottom: 16px; }
      .nw-co-meta-label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #9ca3af; font-weight: 600; }
      .nw-co-meta-value { font-size: 15px; color: #002855; font-weight: 600; }

      .nw-co-items { border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; margin-bottom: 16px; }
      .nw-co-item { display: grid; grid-template-columns: 1fr 50px 90px; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid #f3f4f6; }
      .nw-co-item:last-child { border-bottom: none; }
      .nw-co-item--sub { background: #f9fafb; padding-left: 32px; }
      .nw-co-item-name { font-size: 14px; color: #2D2926; }
      .nw-co-item-recipient { font-weight: 600; color: #002855; }
      .nw-co-item-note { font-size: 12px; color: #6b7280; margin-top: 2px; }
      .nw-co-item-qty { text-align: center; font-size: 13px; color: #6b7280; }
      .nw-co-item-total { text-align: right; font-size: 14px; font-weight: 600; }

      .nw-co-totals { padding: 8px 4px 4px; }
      .nw-co-total-row { display: flex; justify-content: space-between; font-size: 14px; padding: 6px 0; color: #474747; }
      .nw-co-total-row--due { border-top: 1px solid #e5e7eb; margin-top: 6px; padding-top: 12px; font-size: 18px; font-weight: 700; color: #004C97; }

      .nw-co-pay { margin-top: 20px; padding-top: 20px; border-top: 1px solid #e5e7eb; }
      .nw-co-pay-title { font-size: 16px; font-weight: 700; color: #002855; margin-bottom: 12px; }
      .nw-co-choice { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 8px; cursor: pointer; font-size: 14px; }
      .nw-co-choice:hover { border-color: #004C97; }
      .nw-co-choice input { accent-color: #004C97; width: 16px; height: 16px; }

      .nw-co-other { display: flex; align-items: center; gap: 6px; margin: 0 0 8px; padding: 0 12px; }
      .nw-co-other-prefix { font-size: 15px; color: #6b7280; }
      .nw-co-other input { flex: 1; padding: 9px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; font-family: inherit; outline: none; }
      .nw-co-other input:focus { border-color: #004C97; box-shadow: 0 0 0 1px #004C97; }

      .nw-co-inline-error { color: #b91c1c; font-size: 13px; margin-bottom: 8px; }

      .nw-co-pay-summary { display: flex; justify-content: space-between; align-items: baseline; padding: 12px 0; font-size: 14px; color: #474747; }
      .nw-co-pay-amount { font-size: 22px; font-weight: 700; color: #004C97; }

      .nw-co-btn { padding: 10px 20px; background: #004C97; color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; }
      .nw-co-btn:hover { background: #002855; }
      .nw-co-btn--pay { display: block; width: 100%; padding: 14px; font-size: 15px; }

      .nw-co-changes { display: block; text-align: center; margin-top: 12px; font-size: 13px; font-weight: 600; color: #004C97; text-decoration: none; }
      .nw-co-changes:hover { text-decoration: underline; }

      .nw-co-status { margin-top: 20px; padding: 16px; border-radius: 10px; text-align: center; font-size: 16px; font-weight: 700; }
      .nw-co-status--paid { background: rgba(134,173,63,0.15); color: #4d6a14; }
      .nw-co-status--closed { background: #f3f4f6; color: #474747; }

      @media (max-width: 640px) {
        .nw-co-header, .nw-co-body { padding: 16px; }
        .nw-co-item { grid-template-columns: 1fr 40px 80px; gap: 8px; padding: 10px 12px; }
        .nw-co-meta { flex-direction: column; gap: 8px; }
      }
    `;
  }
}

customElements.define("next-checkout", CheckoutWidget);
