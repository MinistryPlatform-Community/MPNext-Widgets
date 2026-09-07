import { MPNextWidget } from "../shared/base-widget";

type Status = "loading" | "success" | "pending" | "failed";

/**
 * `next-checkout-complete` — a minimal landing page for the gateway return
 * `returnUrl`. It reads the response `token` from the URL, processes it via the
 * payment-response endpoint, and shows a thank-you / pending / failed message.
 */
export class CheckoutCompleteWidget extends MPNextWidget {
  private status: Status = "loading";
  private message = "";
  private token: string | null = null;

  static get observedAttributes() {
    return ["api-host", "token"];
  }

  connectedCallback() {
    this.injectStyles(this.getStyles());
    this.render();
    this.process();
  }

  public retryLoad() {
    this.process();
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

  private async process() {
    this.status = "loading";
    this.render();

    this.token = this.resolveToken();
    if (!this.token) {
      this.status = "failed";
      this.message = "No payment information was found.";
      this.render();
      this.attachListeners();
      return;
    }

    try {
      const res = await this.fetch("/api/embed/checkout/payment-response", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: this.token }),
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
        this.status = "success";
        this.message = "Thank you! Your payment was received.";
      } else if (data.success) {
        this.status = "pending";
        this.message =
          "Thank you! Your payment is being processed and will be confirmed shortly.";
      } else {
        this.status = "failed";
        this.message =
          "We were unable to confirm your payment. Please try again or contact us.";
      }

      this.emit("paymentComplete", {
        invoiceId: data.invoiceId,
        paymentReceived: data.paymentReceived,
      });
    } catch (err) {
      this.status = "failed";
      this.message =
        err instanceof Error
          ? err.message
          : "We were unable to confirm your payment.";
      this.emit("paymentComplete", {
        invoiceId: null,
        paymentReceived: false,
      });
    } finally {
      this.render();
      this.attachListeners();
    }
  }

  private attachListeners() {
    const retry = this.root.querySelector('[data-action="retry"]');
    if (retry) {
      retry.addEventListener("click", () => this.retryLoad());
    }
  }

  render() {
    if (this.status === "loading") {
      this.root.innerHTML = `
        <div class="nw-cc">
          <div class="nw-cc-card">
            ${this.spinnerSvg()}
            <p class="nw-cc-msg">Confirming your payment…</p>
          </div>
        </div>`;
      return;
    }

    const icon =
      this.status === "success"
        ? this.checkSvg()
        : this.status === "pending"
          ? this.clockSvg()
          : this.errorSvg();

    const cardClass =
      this.status === "success"
        ? "nw-cc-card--success"
        : this.status === "pending"
          ? "nw-cc-card--pending"
          : "nw-cc-card--failed";

    const title =
      this.status === "success"
        ? "Payment Complete"
        : this.status === "pending"
          ? "Payment Pending"
          : "Payment Not Confirmed";

    this.root.innerHTML = `
      <div class="nw-cc">
        <div class="nw-cc-card ${cardClass}">
          <div class="nw-cc-icon">${icon}</div>
          <h2 class="nw-cc-title">${this.escapeHtml(title)}</h2>
          <p class="nw-cc-msg">${this.escapeHtml(this.message)}</p>
          ${
            this.status === "failed" && this.token
              ? `<button class="nw-cc-btn" data-action="retry">Try Again</button>`
              : ""
          }
        </div>
      </div>`;
  }

  // ── Helpers ──

  private escapeHtml(text: string): string {
    const el = document.createElement("span");
    el.textContent = text;
    return el.innerHTML;
  }

  private spinnerSvg(): string {
    return `<svg class="nw-cc-spinner" viewBox="0 0 24 24" fill="none" width="36" height="36">
      <circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
      <path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
    </svg>`;
  }

  private checkSvg(): string {
    return `<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
  }

  private clockSvg(): string {
    return `<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;
  }

  private errorSvg(): string {
    return `<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/></svg>`;
  }

  private getStyles(): string {
    return `
      :host { all: initial; display: block; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color: #2D2926; }
      .nw-cc { max-width: 480px; margin: 0 auto; }
      .nw-cc-card { background: white; border-radius: 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); padding: 40px 32px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 12px; border-top: 6px solid #004C97; }
      .nw-cc-card--success { border-top-color: #86AD3F; }
      .nw-cc-card--pending { border-top-color: #F1BE48; }
      .nw-cc-card--failed { border-top-color: #FF6D6A; }

      .nw-cc-icon { width: 72px; height: 72px; border-radius: 9999px; display: flex; align-items: center; justify-content: center; }
      .nw-cc-card--success .nw-cc-icon { background: rgba(134,173,63,0.15); color: #4d6a14; }
      .nw-cc-card--pending .nw-cc-icon { background: rgba(241,190,72,0.18); color: #8a6d10; }
      .nw-cc-card--failed .nw-cc-icon { background: rgba(255,109,106,0.15); color: #b91c1c; }

      .nw-cc-title { font-size: 22px; font-weight: 700; color: #002855; margin: 4px 0 0; }
      .nw-cc-msg { font-size: 15px; color: #474747; line-height: 1.5; margin: 0; }
      .nw-cc-spinner { animation: nw-cc-spin 1s linear infinite; color: #004C97; }
      @keyframes nw-cc-spin { to { transform: rotate(360deg); } }

      .nw-cc-btn { margin-top: 8px; padding: 12px 24px; background: #004C97; color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; }
      .nw-cc-btn:hover { background: #002855; }

      @media (max-width: 480px) {
        .nw-cc-card { padding: 32px 20px; }
      }
    `;
  }
}

customElements.define("next-checkout-complete", CheckoutCompleteWidget);
