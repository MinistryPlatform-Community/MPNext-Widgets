import { MPNextWidget } from "../shared/base-widget";
import {
  validateForm,
  bindLiveValidation,
  requiredStar,
  FORM_VALIDATION_STYLES,
  type ValidateOptions,
} from "../shared/form-validation";
import { paymentOutcomeView, type PaymentTone } from "./checkout-status";

interface CheckoutLineItem {
  invoiceDetailId: number;
  itemName: string | null;
  itemNote: string | null;
  recipientName: string | null;
  quantity: number;
  lineTotal: number;
  isSubItem: boolean;
  eventParticipantId: number | null;
  eventId?: number | null;
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
  /** The registration's event (C49); absent from an older server. */
  eventId?: number | null;
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

  private confirmation: { tone: PaymentTone; message: string } | null = null;
  /**
   * True after a payment response we could not record (`error`) or could not
   * read: the card may have been charged, so the Pay form is not offered again
   * until the payer reloads. A decline does not set it.
   */
  private holdPayForm = false;

  static get observedAttributes() {
    return [
      "api-host",
      "payment-processor-url",
      "back-to-event-url",
      "back-to-event-id-parameter-name",
      "invoice-id-parameter-name",
      "invoice-id",
      "receipt-template-id",
    ];
  }

  connectedCallback() {
    this.injectStyles(this.getStyles() + FORM_VALIDATION_STYLES);
    // Await the catalogue before the first paint so a Spanish visitor never
    // sees English swap to Spanish.
    void this.initLocale().then(() => {
      this.render();
      this.init();
    });
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
        const data = await res.json().catch(() => ({}));
        throw new Error(this.errorText(data));
      }
      const data: { invoiceId?: number | null; status?: unknown } = await res.json();

      // One mapper for both payment widgets (C41): a decline is coral and
      // keeps the Pay form; an error is coral and holds it back.
      const view = paymentOutcomeView(data);
      this.confirmation = { tone: view.tone, message: this.t(view.bannerKey) };
      this.holdPayForm = view.status === "error";
      this.emit("paymentComplete", {
        invoiceId: data.invoiceId ?? null,
        status: view.status,
        paymentReceived: view.status === "received",
      });
    } catch (err) {
      // We do not know whether it was recorded, so this is never the amber
      // "processing" banner (C41), and the form is held back.
      this.holdPayForm = true;
      this.confirmation = {
        tone: "failed",
        // `err.message` is itself already a translated sentence from
        // `errorText`, so it is safe to quote inside this one.
        message:
          err instanceof Error
            ? this.t("checkout.paymentUnconfirmedDetail", { detail: err.message })
            : this.t("checkout.paymentUnconfirmed"),
      };
      this.emit("checkoutError", {
        error: err instanceof Error ? err.message : this.t("errors.network"),
      });
    } finally {
      this.processing = false;
      this.render();
    }
  }

  private async loadInvoice() {
    if (!this.guid) {
      this.loading = false;
      this.error = this.t("checkout.noInvoiceSpecified");
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
        throw new Error(this.t("errors.invoice_not_found"));
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(this.errorText(data));
      }
      const data: { invoice: CheckoutInvoice } = await res.json();
      this.invoice = data.invoice;
      this.payChoice = "full";
      this.emit("invoiceLoaded", { invoiceId: this.invoice.invoiceId });
    } catch (err) {
      this.error = err instanceof Error ? err.message : this.t("errors.network");
      this.emit("checkoutError", { error: this.error });
    } finally {
      this.loading = false;
      this.render();
      this.attachListeners();
    }
  }

  private validationOpts(): ValidateOptions {
    return {
      wrapperSelector: ".nw-co-field",
      // Passing this widget's own translator keeps a form inside a
      // `<div lang="es">` validating in Spanish on an otherwise English page.
      t: this.t,
      customValidators: {
        "nw-other-amount": (value) => {
          const n = parseFloat(value);
          if (isNaN(n) || n <= 0) {
            return this.t("checkout.invalidAmount");
          }
          // A courtesy cap (C43) — `checkout/payment-token` enforces it.
          const due = this.invoice?.balanceDue ?? 0;
          if (Math.round(n * 100) > Math.round(due * 100)) {
            return this.t("checkout.amountTooHigh", { amount: this.fmt.currency(due) });
          }
          return null;
        },
      },
    };
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

    const form = this.root.querySelector<HTMLFormElement>("#nw-co-pay-form");
    if (form && !validateForm(form, this.validationOpts()).valid) return;

    const amount = this.selectedAmount();
    if (amount <= 0) {
      this.error = this.t("checkout.invalidAmount");
      this.render();
      this.attachListeners();
      return;
    }

    const processorUrl = this.getAttribute("payment-processor-url");
    if (!processorUrl) {
      this.error = this.t("checkout.processorMissing");
      this.render();
      this.attachListeners();
      this.emit("checkoutError", { error: this.error });
      return;
    }

    this.processing = true;
    this.render();

    try {
      const params = new URLSearchParams({
        guid: this.guid,
        amount: String(amount),
        returnUrl: this.currentPageUrlWithoutToken(),
      });
      // Legacy `receipttemplateid` (C66): threaded into the request token so
      // the server sends the receipt wherever the payment is recorded.
      const receipt = this.getAttribute("receipt-template-id")?.trim();
      if (receipt) params.set("receiptTemplateId", receipt);
      const res = await this.fetch(`/api/embed/checkout/payment-token?${params.toString()}`);
      if (res.status === 422) {
        // The server refused an amount above the balance due (C43). The form
        // already caps it, so the balance has most likely moved under us — a
        // payment from another tab. Reload and say so.
        this.processing = false;
        await this.loadInvoice();
        this.error = this.t("checkout.balanceChanged");
        this.render();
        this.attachListeners();
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(this.errorText(data));
      }
      const data: { token: string } = await res.json();
      const sep = processorUrl.includes("?") ? "&" : "?";
      window.location.href = `${processorUrl}${sep}token=${encodeURIComponent(
        data.token,
      )}`;
    } catch (err) {
      this.processing = false;
      this.error = err instanceof Error ? err.message : this.t("errors.network");
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

    const form = this.root.querySelector<HTMLFormElement>("#nw-co-pay-form");
    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        this.startPayment();
      });
      bindLiveValidation(form, this.validationOpts());
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
        if (total) total.textContent = this.fmt.currency(this.selectedAmount());
      });
    }
  }

  render() {
    if (this.processing && !this.loading) {
      this.root.innerHTML = this.shell(`
        <div class="nw-co-state">
          ${this.spinnerSvg()}
          <span>${this.escapeHtml(this.t("checkout.processing"))}</span>
        </div>`);
      return;
    }

    if (this.loading) {
      this.root.innerHTML = this.shell(`
        <div class="nw-co-state">
          ${this.spinnerSvg()}
          <span>${this.escapeHtml(this.t("checkout.loading"))}</span>
        </div>`);
      return;
    }

    if (this.error && !this.invoice) {
      this.root.innerHTML = this.shell(`
        <div class="nw-co-state nw-co-error">
          <p>${this.escapeHtml(this.error)}</p>
          <button class="nw-co-btn" data-action="retry">${this.escapeHtml(this.t("common.retry"))}</button>
        </div>`);
      return;
    }

    if (!this.invoice) {
      this.root.innerHTML = this.shell(`
        <div class="nw-co-state nw-co-empty">${this.escapeHtml(this.t("checkout.empty"))}</div>`);
      return;
    }

    this.root.innerHTML = this.shell(this.renderInvoice(this.invoice));
  }

  private shell(body: string): string {
    return `
      <div class="nw-co">
        <div class="nw-co-header">${this.escapeHtml(this.t("checkout.header"))}</div>
        <div class="nw-co-body">
          ${this.confirmation ? this.renderConfirmation() : ""}
          ${body}
        </div>
      </div>`;
  }

  private renderConfirmation(): string {
    if (!this.confirmation) return "";
    const { tone } = this.confirmation;
    // A failure is announced assertively; success and pending politely.
    const role = tone === "failed" ? "alert" : "status";
    return `
      <div class="nw-co-confirm nw-co-confirm--${tone}" role="${role}">
        ${this.escapeHtml(this.confirmation.message)}
      </div>`;
  }

  private renderInvoice(inv: CheckoutInvoice): string {
    const base = inv.lineItems.filter((li) => !li.isSubItem);
    const subs = inv.lineItems.filter((li) => li.isSubItem);

    return `
      <div class="nw-co-meta">
        <div>
          <span class="nw-co-meta-label">${this.escapeHtml(this.t("checkout.invoiceDate"))}</span>
          <span class="nw-co-meta-value">${this.escapeHtml(this.fmt.date(inv.invoiceDate, "long"))}</span>
        </div>
        ${
          // MP's status vocabulary is about payment; a free registration has
          // no payment to describe, so "Status: None Paid" is left out (C47).
          inv.invoiceTotal > 0
            ? `<div>
                <span class="nw-co-meta-label">${this.escapeHtml(this.t("checkout.status"))}</span>
                <span class="nw-co-meta-value">${this.escapeHtml(inv.status)}</span>
              </div>`
            : ""
        }
      </div>

      ${
        inv.lineItems.length > 0
          ? `<div class="nw-co-items">
              ${base.map((li) => this.renderLineItem(li, false)).join("")}
              ${subs.map((li) => this.renderLineItem(li, true)).join("")}
            </div>`
          : `<div class="nw-co-state nw-co-empty">${this.escapeHtml(this.t("checkout.noLineItems"))}</div>`
      }

      <div class="nw-co-totals">
        <div class="nw-co-total-row">
          <span>${this.escapeHtml(this.t("common.total"))}</span>
          <span>${this.fmt.currency(inv.invoiceTotal)}</span>
        </div>
        <div class="nw-co-total-row">
          <span>${this.escapeHtml(this.t("checkout.amountPaid"))}</span>
          <span>${this.fmt.currency(inv.amountPaid)}</span>
        </div>
        <div class="nw-co-total-row nw-co-total-row--due">
          <span>${this.escapeHtml(this.t("checkout.balanceDue"))}</span>
          <span>${this.fmt.currency(inv.balanceDue)}</span>
        </div>
      </div>

      ${inv.canPay ? (this.holdPayForm ? "" : this.renderPaySection(inv)) : this.renderStatusSection(inv)}
    `;
  }

  private renderLineItem(li: CheckoutLineItem, isSub: boolean): string {
    // Item names are MP-authored; only the fallback is ours to translate.
    const name = li.itemName || this.t("checkout.item");
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
        <div class="nw-co-item-total">${this.fmt.currency(li.lineTotal)}</div>
      </div>`;
  }

  private renderPaySection(inv: CheckoutInvoice): string {
    // A deposit at or above what is left is not a deposit any more — and
    // offering it would ask for more than the balance (C43).
    const hasDeposit =
      inv.depositDue != null && inv.depositDue > 0 && inv.depositDue < inv.balanceDue;
    const changesHref = this.makeChangesHref(inv);
    return `
      <form id="nw-co-pay-form" class="nw-co-pay" novalidate>
        <div class="nw-co-pay-title">${this.escapeHtml(this.t("checkout.paymentAmount"))}</div>
        <label class="nw-co-choice">
          <input type="radio" name="nw-pay-choice" value="full" ${this.payChoice === "full" ? "checked" : ""}>
          <span>${this.escapeHtml(
            this.t("checkout.payInFull", {
              amount: this.fmt.currency(inv.balanceDue),
            })
          )}</span>
        </label>
        ${
          hasDeposit
            ? `<label class="nw-co-choice">
                <input type="radio" name="nw-pay-choice" value="deposit" ${this.payChoice === "deposit" ? "checked" : ""}>
                <span>${this.escapeHtml(
                  this.t("checkout.payDeposit", {
                    amount: this.fmt.currency(inv.depositDue as number),
                  })
                )}</span>
              </label>`
            : ""
        }
        <label class="nw-co-choice">
          <input type="radio" name="nw-pay-choice" value="other" ${this.payChoice === "other" ? "checked" : ""}>
          <span>${this.escapeHtml(this.t("checkout.otherAmount"))}</span>
        </label>
        ${
          this.payChoice === "other"
            ? `<div class="nw-co-field nw-co-other">
                <span class="nw-co-other-prefix">${this.escapeHtml(this.currencySymbol())}</span>
                <input id="nw-other-amount" name="nw-other-amount" type="number" min="0" step="0.01"
                  inputmode="decimal" placeholder="0.00" required
                  value="${this.escapeAttr(this.otherAmount)}">
              </div>`
            : ""
        }
        ${this.error ? `<div class="nw-co-inline-error">${this.escapeHtml(this.error)}</div>` : ""}
        <div class="nw-co-pay-summary">
          <span>${this.escapeHtml(this.t("checkout.youWillPay"))}</span>
          <span id="nw-pay-total" class="nw-co-pay-amount">${this.fmt.currency(this.selectedAmount())}</span>
        </div>
        <button type="submit" class="nw-co-btn nw-co-btn--pay" data-action="pay">${this.escapeHtml(this.t("checkout.pay"))}</button>
        ${
          changesHref
            ? `<a class="nw-co-changes" href="${this.escapeAttr(changesHref)}">${this.escapeHtml(this.t("checkout.makeChanges"))}</a>`
            : ""
        }
      </form>`;
  }

  /**
   * The closing line for an invoice with nothing to pay (C47). Three cases,
   * because "nothing to pay" and "has been paid" are different facts:
   *
   * - a zero-total invoice (a free registration) → neutral "registration is
   *   complete". It never had a balance, so "Paid in full" — in the success
   *   colour, under "Status: None Paid" — was false on its face;
   * - money paid and no balance left → "Paid in full";
   * - otherwise → MP's own status wording (Cancelled, say), as written.
   */
  private renderStatusSection(inv: CheckoutInvoice): string {
    let cls: string;
    let label: string;
    if (inv.invoiceTotal <= 0) {
      cls = "nw-co-status--complete";
      label = this.t("checkout.registrationComplete");
    } else if (inv.amountPaid > 0 && inv.balanceDue <= 0) {
      cls = "nw-co-status--paid";
      label = this.t("checkout.paidInFull");
    } else {
      cls = "nw-co-status--closed";
      label = inv.status;
    }
    return `
      <div class="nw-co-status ${cls}" role="status">
        ${this.escapeHtml(label)}
      </div>`;
  }

  /**
   * "Make Changes" (C49): back to the event's registration with this invoice
   * re-opened — `<back-to-event-url>?id=<eventId>&invoiceid=<guid>`, legacy's
   * shape and exactly what `next-event-details` reads (`id-parameter-name`,
   * default `id`; `invoiceid`). The event-id parameter name follows the
   * destination's: `back-to-event-id-parameter-name`, default `id`.
   *
   * Built with `URL` / `URLSearchParams`, so a configured URL that already has
   * a query string keeps it. A non-event invoice gets the bare URL. A
   * `javascript:` / `data:` URL is refused. The label stays "Make Changes":
   * clearer than legacy's "Back to Event Details", and deliberate.
   */
  private makeChangesHref(inv: CheckoutInvoice): string | null {
    const base = this.getAttribute("back-to-event-url")?.trim();
    if (!base) return null;
    let url: URL;
    try {
      url = new URL(base, window.location.href);
    } catch {
      return null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (inv.eventId == null) return base;
    const idParam = this.getAttribute("back-to-event-id-parameter-name")?.trim() || "id";
    url.searchParams.set(idParam, String(inv.eventId));
    url.searchParams.set("invoiceid", inv.invoiceGuid);
    return url.toString();
  }

  // ── Helpers ──

  /**
   * The locale's currency symbol, for the amount input's prefix.
   *
   * Derived from a formatted zero rather than hardcoded, because "$" is only
   * right for an English page: the same USD amount prefixes as "US$" in
   * Spanish. Stripping the digits and separators leaves the symbol whatever
   * `Intl` chose, without a second currency table to keep in step.
   */
  private currencySymbol(): string {
    // The character class covers the non-breaking space `Intl` puts between
    // the symbol and the number in several locales.
    return this.fmt.currency(0).replace(/[\s\d.,]/g, "");
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
      .nw-co-confirm--failed { background: rgba(255,109,106,0.15); color: #b91c1c; border: 1px solid rgba(255,109,106,0.5); }

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
      .nw-co-status--complete { background: rgba(0,76,151,0.08); color: #002855; }

      @media (max-width: 640px) {
        .nw-co-header, .nw-co-body { padding: 16px; }
        .nw-co-item { grid-template-columns: 1fr 40px 80px; gap: 8px; padding: 10px 12px; }
        .nw-co-meta { flex-direction: column; gap: 8px; }
      }
    `;
  }
}

customElements.define("next-checkout", CheckoutWidget);
