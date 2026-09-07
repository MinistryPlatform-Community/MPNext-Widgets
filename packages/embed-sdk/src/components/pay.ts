import { MPNextWidget } from "../shared/base-widget";
import {
  validateForm,
  bindLiveValidation,
  requiredStar,
  FORM_VALIDATION_STYLES,
} from "../shared/form-validation";

const PAY_VALIDATION_OPTS = {
  wrapperSelector: ".nw-pay-field",
  messages: {
    "name-on-card": "Please enter the name on the card.",
    "card-number": "Please enter a card number.",
    expiry: "Please enter the expiry date.",
    cvv: "Please enter the CVV.",
  },
} as const;

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

  static get observedAttributes() {
    return ["api-host", "token"];
  }

  connectedCallback() {
    this.injectStyles(this.getStyles() + FORM_VALIDATION_STYLES);
    this.render();
    this.init();
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
      this.error = "No payment request was provided.";
      this.render();
      this.attachListeners();
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
        const data = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data: { request: PaymentRequestToken } = await res.json();
      this.request = data.request;
    } catch (err) {
      this.error =
        err instanceof Error ? err.message : "Could not decode the payment request.";
    } finally {
      this.loading = false;
      this.render();
      this.attachListeners();
    }
  }

  private async submit() {
    if (!this.request || !this.token) return;

    const form = this.root.querySelector<HTMLFormElement>("#nw-pay-form");
    if (!form || !validateForm(form, PAY_VALIDATION_OPTS).valid) return;

    const nameOnCard = this.value("#nw-pay-name");
    const cardNumber = this.value("#nw-pay-card");
    const expiry = this.value("#nw-pay-expiry");
    const cvv = this.value("#nw-pay-cvv");

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
        const data = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data: { token: string } = await res.json();

      this.emit("paymentSubmitted", { invoiceId: this.request.invoiceId });

      const redirect = this.buildReturnUrl(this.request.returnUrl, data.token);
      window.location.href = redirect;
    } catch (err) {
      this.submitting = false;
      this.formError =
        err instanceof Error ? err.message : "Payment could not be submitted.";
      this.render();
      this.attachListeners();
    }
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
      bindLiveValidation(form, PAY_VALIDATION_OPTS);
    }
  }

  render() {
    if (this.loading) {
      this.root.innerHTML = this.shell(`
        <div class="nw-pay-state">
          ${this.spinnerSvg()}
          <span>Loading payment request…</span>
        </div>`);
      return;
    }

    if (this.error || !this.request) {
      this.root.innerHTML = this.shell(`
        <div class="nw-pay-state nw-pay-error">
          <p>${this.escapeHtml(this.error || "Payment request unavailable.")}</p>
          ${this.token ? `<button class="nw-pay-btn" data-action="retry">Try Again</button>` : ""}
        </div>`);
      return;
    }

    this.root.innerHTML = this.shell(this.renderForm(this.request));
  }

  private shell(body: string): string {
    return `
      <div class="nw-pay">
        <div class="nw-pay-header">Secure Payment</div>
        <div class="nw-pay-sandbox">
          Sandbox payment — use test card ${TEST_CARD}
        </div>
        <div class="nw-pay-body">${body}</div>
      </div>`;
  }

  private renderForm(req: PaymentRequestToken): string {
    const name = [req.firstName, req.lastName].filter(Boolean).join(" ") || "—";
    return `
      <div class="nw-pay-summary">
        <div class="nw-pay-summary-row">
          <span>Invoice</span>
          <span>${this.escapeHtml(req.invoiceId)}</span>
        </div>
        <div class="nw-pay-summary-row">
          <span>Name</span>
          <span>${this.escapeHtml(name)}</span>
        </div>
        <div class="nw-pay-summary-row">
          <span>Email</span>
          <span>${this.escapeHtml(req.email || "—")}</span>
        </div>
        <div class="nw-pay-summary-row nw-pay-summary-row--amount">
          <span>Amount Due</span>
          <span>${this.formatCurrency(req.amount)}</span>
        </div>
      </div>

      <form id="nw-pay-form" class="nw-pay-form" autocomplete="off" novalidate>
        <div class="nw-pay-field">
          <label for="nw-pay-name">Name on Card${requiredStar()}</label>
          <input id="nw-pay-name" name="name-on-card" type="text" placeholder="Jane Doe"
            required value="${this.escapeAttr(name === "—" ? "" : name)}">
        </div>
        <div class="nw-pay-field">
          <label for="nw-pay-card">Card Number${requiredStar()}</label>
          <input id="nw-pay-card" name="card-number" type="text" inputmode="numeric"
            required placeholder="${TEST_CARD}">
        </div>
        <div class="nw-pay-row">
          <div class="nw-pay-field">
            <label for="nw-pay-expiry">Expiry${requiredStar()}</label>
            <input id="nw-pay-expiry" name="expiry" type="text" required placeholder="MM/YY">
          </div>
          <div class="nw-pay-field">
            <label for="nw-pay-cvv">CVV${requiredStar()}</label>
            <input id="nw-pay-cvv" name="cvv" type="text" inputmode="numeric" required placeholder="123">
          </div>
        </div>
        ${this.formError ? `<div class="nw-pay-inline-error">${this.escapeHtml(this.formError)}</div>` : ""}
        <button type="submit" class="nw-pay-btn nw-pay-btn--pay" ${this.submitting ? "disabled" : ""}>
          ${this.submitting ? "Processing…" : `Pay ${this.formatCurrency(req.amount)}`}
        </button>
      </form>`;
  }

  // ── Helpers ──

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
    return `<svg class="nw-pay-spinner" viewBox="0 0 24 24" fill="none" width="22" height="22">
      <circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
      <path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
    </svg>`;
  }

  private getStyles(): string {
    return `
      :host { all: initial; display: block; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color: #2D2926; }
      .nw-pay { max-width: 480px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
      .nw-pay-header { background: #002855; color: white; padding: 24px; font-size: 22px; font-weight: 700; text-align: center; }
      .nw-pay-sandbox { background: #F1BE48; color: #2D2926; padding: 10px 16px; font-size: 13px; font-weight: 700; text-align: center; }
      .nw-pay-body { padding: 24px; }

      .nw-pay-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 40px 16px; color: #6b7280; font-size: 15px; text-align: center; }
      .nw-pay-spinner { animation: nw-pay-spin 1s linear infinite; color: #004C97; }
      @keyframes nw-pay-spin { to { transform: rotate(360deg); } }
      .nw-pay-error p { color: #b91c1c; margin: 0 0 12px; }

      .nw-pay-summary { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px 16px; margin-bottom: 20px; }
      .nw-pay-summary-row { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; padding: 4px 0; color: #474747; }
      .nw-pay-summary-row span:first-child { color: #6b7280; }
      .nw-pay-summary-row span:last-child { font-weight: 600; color: #2D2926; text-align: right; word-break: break-word; }
      .nw-pay-summary-row--amount { border-top: 1px solid #e5e7eb; margin-top: 6px; padding-top: 10px; font-size: 18px; }
      .nw-pay-summary-row--amount span:last-child { color: #004C97; font-weight: 700; }

      .nw-pay-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px; }
      .nw-pay-field label { font-size: 12px; font-weight: 600; color: #6b7280; }
      .nw-pay-field input { padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; font-family: inherit; color: #2D2926; outline: none; }
      .nw-pay-field input:focus { border-color: #004C97; box-shadow: 0 0 0 1px #004C97; }
      .nw-pay-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

      .nw-pay-inline-error { color: #b91c1c; font-size: 13px; margin-bottom: 12px; }

      .nw-pay-btn { padding: 12px 20px; background: #004C97; color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; }
      .nw-pay-btn:hover { background: #002855; }
      .nw-pay-btn:disabled { opacity: 0.6; cursor: default; }
      .nw-pay-btn--pay { display: block; width: 100%; padding: 14px; font-size: 15px; margin-top: 6px; }

      @media (max-width: 480px) {
        .nw-pay-header, .nw-pay-body { padding: 16px; }
      }
    `;
  }
}

customElements.define("next-pay", PayWidget);
