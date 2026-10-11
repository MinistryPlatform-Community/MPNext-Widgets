import { MPNextWidget, WidgetError } from "../shared/base-widget";
import {
  validateForm,
  bindLiveValidation,
  field,
  FORM_VALIDATION_STYLES,
  type ValidateOptions,
} from "../shared/form-validation";
import { headingTag, HEADING_RESET_STYLES } from "../shared/heading-level";

interface PaymentRequestToken {
  invoiceId: string;
  amount: number;
  payorContactId: number | null;
  returnUrl: string;
  paymentNotifyUrl: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  mobilePhone: string | null;
  addressStreet: string | null;
  addressStreet2: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressZip: string | null;
  addressCountry: string | null;
  fundId: number | null;
}

const TEST_CARD = "4111 1111 1111 1111";

// ── Card format checks (C48) ────────────────────────────────────────────────
//
// The sandbox is what every demo, developer and E2E run exercises, so it
// validates formats the way a processor's hosted page would: `13/99` and CVV
// `abc` used to submit. Pure functions, exported for the unit tests.

/** Digits of a card number, with spaces and dashes allowed as separators. */
function cardDigits(value: string): string | null {
  const compact = value.replace(/[\s-]/g, "");
  return /^\d+$/.test(compact) ? compact : null;
}

/** 13–19 digits passing the Luhn checksum. */
export function isValidCardNumber(value: string): boolean {
  const digits = cardDigits(value);
  if (!digits || digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/**
 * `MM/YY` (or `MM/YYYY`) → whether it is malformed, past, or fine. A card is
 * good through the last day of its expiry month, so the current month passes.
 */
export function checkExpiry(value: string, now = new Date()): "invalid" | "expired" | "ok" {
  const m = /^\s*(\d{1,2})\s*\/\s*(\d{2}|\d{4})\s*$/.exec(value);
  if (!m) return "invalid";
  const month = Number(m[1]);
  if (month < 1 || month > 12) return "invalid";
  const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  const expiry = year * 12 + (month - 1);
  const current = now.getFullYear() * 12 + now.getMonth();
  return expiry < current ? "expired" : "ok";
}

/** 3 or 4 digits. */
export function isValidCvv(value: string): boolean {
  return /^\d{3,4}$/.test(value.trim());
}

/**
 * `next-pay` — a clearly-labeled SANDBOX payment gateway. It unpacks the
 * request token built by `next-checkout`, shows a read-only summary, collects
 * (fake) card details, asks the API to build a signed response token, then
 * redirects back to the request's `returnUrl` with that token appended.
 */
export class PayWidget extends MPNextWidget {
  private request: PaymentRequestToken | null = null;
  private token: string | null = null;
  private loading = true;
  private error: string | null = null;
  private submitting = false;
  private formError: string | null = null;
  /** Set when the request token is spent or expired (C43). */
  private linkState: "used" | "expired" | null = null;

  static get observedAttributes() {
    return ["api-host", "token"];
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

  /**
   * Per-field messages, built per call rather than held in a module constant:
   * a constant is evaluated at import time, before any locale is known.
   */
  private validationOpts(): ValidateOptions {
    return {
      wrapperSelector: ".nw-pay-field",
      t: this.t,
      messages: {
        "name-on-card": this.t("pay.enterName"),
        "card-number": this.t("pay.enterCard"),
        expiry: this.t("pay.enterExpiry"),
        cvv: this.t("pay.enterCvv"),
      },
      // Formats (C48). Empty is left to `required`, so its message stays the
      // "please enter…" one above.
      customValidators: {
        "card-number": (v) =>
          !v.trim() || isValidCardNumber(v) ? null : this.t("pay.invalidCard"),
        expiry: (v) => {
          if (!v.trim()) return null;
          const result = checkExpiry(v);
          if (result === "invalid") return this.t("pay.invalidExpiry");
          if (result === "expired") return this.t("pay.expiredCard");
          return null;
        },
        cvv: (v) => (!v.trim() || isValidCvv(v) ? null : this.t("pay.invalidCvv")),
      },
    };
  }

  public retryLoad() {
    this.error = null;
    this.init();
  }

  private async init() {
    this.token = this.resolveToken();
    await this.unpack();
  }

  private resolveToken(): string | null {
    const attr = this.getAttribute("token");
    if (attr) return attr;
    try {
      return new URL(window.location.href).searchParams.get("token");
    } catch {
      return null;
    }
  }

  private async unpack() {
    if (!this.token) {
      this.loading = false;
      this.error = this.t("pay.noRequest");
      this.render();
      return;
    }

    this.loading = true;
    this.error = null;
    this.render();

    try {
      const res = await this.fetch(
        `/api/embed/pay/unpack?token=${encodeURIComponent(this.token)}`,
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (this.isLinkState(data)) return;
        throw new WidgetError(this.errorText(data));
      }
      const data: { request: PaymentRequestToken } = await res.json();
      this.request = data.request;
    } catch (err) {
      this.error =
        this.caughtText(err, "pay.decodeFailed");
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private async submit() {
    // Double-submit guard. The in-flight paint disables the Pay button, but
    // since `render()` now re-binds, that paint's form carries a live submit
    // listener (a scripted `requestSubmit()`, say) — so refuse here as well.
    if (this.submitting) return;
    if (!this.request || !this.token) return;

    const form = this.root.querySelector<HTMLFormElement>("#nw-pay-form");
    if (!form || !validateForm(form, this.validationOpts()).valid) return;

    const nameOnCard = this.value('[name="name-on-card"]');
    const cardNumber = this.value('[name="card-number"]');
    const expiry = this.value('[name="expiry"]');
    const cvv = this.value('[name="cvv"]');

    this.formError = null;
    this.submitting = true;
    this.render();

    try {
      const res = await this.fetch("/api/embed/pay/response", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: this.token,
          cardNumber,
          nameOnCard,
          expiry,
          cvv,
          type: "CREDIT_DEBIT",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (this.isLinkState(data)) {
          this.submitting = false;
          this.render();
          return;
        }
        throw new WidgetError(this.errorText(data, "errors.payment_declined"));
      }
      const data: { token: string } = await res.json();

      this.emit("paymentSubmitted", { invoiceId: this.request.invoiceId });

      const redirect = this.buildReturnUrl(this.request.returnUrl, data.token);
      window.location.href = redirect;
    } catch (err) {
      this.submitting = false;
      this.formError =
        this.caughtText(err, "pay.submitFailed");
      this.render();
    }
  }

  /**
   * Recognise the single-use outcomes (C43) by their wire code and switch to
   * the designed "link" state. Returns false for anything else, which stays an
   * ordinary error.
   */
  private isLinkState(body: unknown): boolean {
    const code = (body as { error?: unknown } | null)?.error;
    if (code === "verification_used") this.linkState = "used";
    else if (code === "verification_expired") this.linkState = "expired";
    else return false;
    this.emit("paymentLinkUnavailable", { reason: this.linkState });
    return true;
  }

  /** The invoice page without any `token`, for the "return to invoice" link. */
  private invoiceUrl(): string | null {
    if (!this.request?.returnUrl) return null;
    try {
      const url = new URL(this.request.returnUrl, window.location.href);
      url.searchParams.delete("token");
      return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
    } catch {
      return null;
    }
  }

  private renderLinkState(): string {
    const used = this.linkState === "used";
    const href = this.invoiceUrl();
    return `
      <div class="nw-pay-state nw-pay-link" role="status">
        <p class="nw-pay-link-title">${this.escapeHtml(
          this.t(used ? "pay.linkUsedTitle" : "pay.linkExpiredTitle"),
        )}</p>
        <p>${this.escapeHtml(this.t(used ? "pay.linkUsed" : "pay.linkExpired"))}</p>
        ${
          href
            ? `<a class="nw-pay-btn" href="${this.escapeAttr(href)}">${this.escapeHtml(this.t("pay.returnToInvoice"))}</a>`
            : ""
        }
      </div>`;
  }

  private buildReturnUrl(returnUrl: string, responseToken: string): string {
    try {
      const url = new URL(returnUrl, window.location.href);
      url.searchParams.set("token", responseToken);
      return url.toString();
    } catch {
      const sep = returnUrl.includes("?") ? "&" : "?";
      return `${returnUrl}${sep}token=${encodeURIComponent(responseToken)}`;
    }
  }

  private value(selector: string): string {
    return (
      this.root.querySelector<HTMLInputElement>(selector)?.value.trim() || ""
    );
  }

  private attachListeners() {
    const retry = this.root.querySelector('[data-action="retry"]');
    if (retry) {
      retry.addEventListener("click", () => this.retryLoad());
    }

    const form = this.root.querySelector<HTMLFormElement>("#nw-pay-form");
    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        this.submit();
      });
      bindLiveValidation(form, this.validationOpts());
    }
  }

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
    // A spent or expired link is a designed state, not an error: no Try
    // Again (it would fail identically), and a way back to the invoice.
    if (this.linkState) {
      this.root.innerHTML = this.shell(this.renderLinkState());
      return;
    }

    if (this.loading) {
      this.root.innerHTML = this.shell(`
        <div class="nw-pay-state">
          ${this.spinnerSvg()}
          <span>${this.escapeHtml(this.t("pay.loading"))}</span>
        </div>`);
      return;
    }

    if (this.error || !this.request) {
      this.root.innerHTML = this.shell(`
        <div class="nw-pay-state nw-pay-error">
          <p>${this.escapeHtml(this.error || this.t("pay.unavailable"))}</p>
          ${this.token ? `<button class="nw-pay-btn" data-action="retry">${this.escapeHtml(this.t("common.retry"))}</button>` : ""}
        </div>`);
      return;
    }

    this.root.innerHTML = this.shell(this.renderForm(this.request));
  }

  private shell(body: string): string {
    // The title is a real heading (CROSS-3); `heading-level` places it in the
    // host page's outline (C35 convention, default h2).
    const h = headingTag(this.getAttribute("heading-level"));
    return `
      <div class="nw-pay">
        <${h} class="nw-pay-header">${this.escapeHtml(this.t("pay.header"))}</${h}>
        <div class="nw-pay-sandbox">
          ${this.escapeHtml(this.t("pay.sandboxNotice", { card: TEST_CARD }))}
        </div>
        <div class="nw-pay-body">${body}</div>
      </div>`;
  }

  private renderForm(req: PaymentRequestToken): string {
    const name = [req.firstName, req.lastName].filter(Boolean).join(" ") || "—";
    return `
      <div class="nw-pay-summary">
        <div class="nw-pay-summary-row">
          <span>${this.escapeHtml(this.t("pay.invoice"))}</span>
          <span>${this.escapeHtml(req.invoiceId)}</span>
        </div>
        <div class="nw-pay-summary-row">
          <span>${this.escapeHtml(this.t("fields.name"))}</span>
          <span>${this.escapeHtml(name)}</span>
        </div>
        <div class="nw-pay-summary-row">
          <span>${this.escapeHtml(this.t("fields.email"))}</span>
          <span>${this.escapeHtml(req.email || "—")}</span>
        </div>
        <div class="nw-pay-summary-row nw-pay-summary-row--amount">
          <span>${this.escapeHtml(this.t("pay.amountDue"))}</span>
          <span>${this.fmt.currency(req.amount)}</span>
        </div>
      </div>

      <form id="nw-pay-form" class="nw-pay-form" novalidate>
        ${field({
          name: "name-on-card",
          label: this.t("pay.nameOnCard"),
          required: true,
          autocomplete: "cc-name",
          placeholder: this.t("pay.namePlaceholder"),
          value: name === "—" ? "" : name,
          idPrefix: this.instanceId,
          wrapperClass: "nw-pay-field",
        })}
        ${field({
          name: "card-number",
          label: this.t("pay.cardNumber"),
          required: true,
          autocomplete: "cc-number",
          inputmode: "numeric",
          placeholder: TEST_CARD,
          attrs: { maxlength: 23 },
          idPrefix: this.instanceId,
          wrapperClass: "nw-pay-field",
        })}
        <div class="nw-pay-row">
          ${field({
            name: "expiry",
            label: this.t("pay.expiry"),
            required: true,
            autocomplete: "cc-exp",
            inputmode: "numeric",
            placeholder: this.t("pay.expiryPlaceholder"),
            attrs: { maxlength: 7 },
            idPrefix: this.instanceId,
            wrapperClass: "nw-pay-field",
          })}
          ${field({
            name: "cvv",
            label: this.t("pay.cvv"),
            required: true,
            autocomplete: "cc-csc",
            inputmode: "numeric",
            placeholder: "123",
            attrs: { maxlength: 4 },
            idPrefix: this.instanceId,
            wrapperClass: "nw-pay-field",
          })}
        </div>
        ${this.formError ? `<div class="nw-pay-inline-error">${this.escapeHtml(this.formError)}</div>` : ""}
        <button type="submit" class="nw-pay-btn nw-pay-btn--pay" ${this.submitting ? "disabled" : ""}>
          ${this.escapeHtml(
            this.submitting
              ? this.t("pay.processing")
              : this.t("pay.payAmount", { amount: this.fmt.currency(req.amount) })
          )}
        </button>
      </form>`;
  }

  // ── Helpers ──

  private escapeHtml(text: string): string {
    const el = document.createElement("span");
    el.textContent = text;
    return el.innerHTML;
  }

  private escapeAttr(text: string): string {
    return this.escapeHtml(text).replace(/"/g, "&quot;");
  }

  private spinnerSvg(): string {
    return `<svg class="nw-pay-spinner" viewBox="0 0 24 24" fill="none" width="22" height="22">
      <circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
      <path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
    </svg>`;
  }

  private getStyles(): string {
    return `${HEADING_RESET_STYLES}
      :host { all: initial; display: block; font-family: var(--_nw-font-family); color: var(--_nw-color-text); }
      .nw-pay { max-width: 480px; margin: 0 auto; background: var(--_nw-color-surface); border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
      .nw-pay-header { background: var(--_nw-color-secondary); color: var(--_nw-color-on-primary); padding: var(--_nw-space-6); font-size: 22px; font-weight: var(--_nw-font-weight-heading); text-align: center; }
      .nw-pay-sandbox { background: var(--_nw-color-warning); color: var(--_nw-color-text); padding: 10px var(--_nw-space-4); font-size: 13px; font-weight: 700; text-align: center; }
      .nw-pay-body { padding: var(--_nw-space-6); }

      .nw-pay-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--_nw-space-3); padding: 40px var(--_nw-space-4); color: var(--_nw-color-muted); font-size: 15px; text-align: center; }
      .nw-pay-spinner { animation: nw-pay-spin 1s linear infinite; color: var(--_nw-color-primary); }
      @keyframes nw-pay-spin { to { transform: rotate(360deg); } }
      .nw-pay-error p { color: var(--_nw-color-error-text); margin: 0 0 var(--_nw-space-3); }
      .nw-pay-link p { margin: 0; color: var(--_nw-color-text-subtle); }
      .nw-pay-link .nw-pay-link-title { font-size: 17px; font-weight: var(--_nw-font-weight-heading); color: var(--_nw-color-secondary); }
      .nw-pay-link a.nw-pay-btn { text-decoration: none; margin-top: var(--_nw-space-2); }

      .nw-pay-summary { background: #f9fafb; border: var(--_nw-border-width) solid var(--_nw-color-border); border-radius: 10px; padding: 14px var(--_nw-space-4); margin-bottom: var(--_nw-space-5); }
      .nw-pay-summary-row { display: flex; justify-content: space-between; gap: var(--_nw-space-3); font-size: var(--_nw-font-size-base); padding: var(--_nw-space-1) 0; color: var(--_nw-color-text-subtle); }
      .nw-pay-summary-row span:first-child { color: var(--_nw-color-muted); }
      .nw-pay-summary-row span:last-child { font-weight: 600; color: var(--_nw-color-text); text-align: right; word-break: break-word; }
      .nw-pay-summary-row--amount { border-top: var(--_nw-border-width) solid var(--_nw-color-border); margin-top: 6px; padding-top: 10px; font-size: 18px; }
      .nw-pay-summary-row--amount span:last-child { color: var(--_nw-color-primary); font-weight: 700; }

      .nw-pay-field { display: flex; flex-direction: column; gap: var(--_nw-space-1); margin-bottom: 14px; }
      .nw-pay-field label { font-size: 12px; font-weight: 600; color: var(--_nw-color-muted); }
      .nw-pay-field input { padding: 10px var(--_nw-space-3); border: var(--_nw-border-width) solid var(--_nw-color-border-strong); border-radius: var(--_nw-radius); font-size: var(--_nw-font-size-base); font-family: inherit; color: var(--_nw-color-text); outline: none; }
      .nw-pay-field input:focus { border-color: var(--_nw-color-primary); box-shadow: 0 0 0 1px var(--_nw-color-primary); }
      .nw-pay-row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--_nw-space-3); }

      .nw-pay-inline-error { color: var(--_nw-color-error-text); font-size: 13px; margin-bottom: var(--_nw-space-3); }

      .nw-pay-btn { padding: var(--_nw-space-3) var(--_nw-space-5); background: var(--_nw-button-bg); color: var(--_nw-button-fg); border: none; border-radius: var(--_nw-button-radius); font-size: var(--_nw-font-size-base); font-weight: 600; cursor: pointer; font-family: inherit; }
      .nw-pay-btn:hover { background: var(--_nw-button-bg-hover); }
      .nw-pay-btn:disabled { opacity: 0.6; cursor: default; }
      .nw-pay-btn--pay { display: block; width: 100%; padding: 14px; font-size: 15px; margin-top: 6px; }

      @media (max-width: 480px) {
        .nw-pay-header, .nw-pay-body { padding: var(--_nw-space-4); }
      }
    `;
  }
}

customElements.define("next-pay", PayWidget);
