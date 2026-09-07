import { MPNextWidget } from "../shared/base-widget";

interface StatementPreference {
  donorId: number;
  statementMethodId: number;
  paperless: boolean;
}

export class StatementPreferencesWidget extends MPNextWidget {
  private loading = true;
  private saving = false;
  private error: string | null = null;
  private paperless = false;
  private hasDonor = true;
  private message: { type: "success" | "error"; text: string } | null = null;

  connectedCallback() {
    this.injectStyles(this.getStyles());
    this.render();
    this.loadPreference();
  }

  public retryLoad() {
    this.error = null;
    this.hasDonor = true;
    this.message = null;
    this.loadPreference();
  }

  private async loadPreference() {
    this.loading = true;
    this.error = null;
    this.render();

    try {
      const res = await this.fetch("/api/embed/statement-preferences");

      if (res.status === 404) {
        this.hasDonor = false;
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const data: StatementPreference = await res.json();
      this.hasDonor = true;
      this.paperless = data.paperless;
      this.emit("preferenceLoaded", { paperless: this.paperless });
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Failed to load preference";
      this.emit("preferenceError", { error: this.error });
    } finally {
      this.loading = false;
      this.render();
      this.attachListeners();
    }
  }

  private async savePreference(newValue: boolean) {
    const previous = this.paperless;
    this.saving = true;
    this.message = null;
    // Optimistically reflect the new value while saving.
    this.paperless = newValue;
    this.render();
    this.attachListeners();

    try {
      const res = await this.fetch("/api/embed/statement-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paperless: newValue }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const data: StatementPreference = await res.json();
      this.paperless = data.paperless;
      this.message = { type: "success", text: "Statement method updated" };
      this.emit("preferenceUpdated", { paperless: this.paperless });
    } catch (err) {
      // Revert the toggle on failure.
      this.paperless = previous;
      this.message = {
        type: "error",
        text: "Error updating the statement method, please try again.",
      };
      const errorText = err instanceof Error ? err.message : "Failed to update preference";
      this.emit("preferenceError", { error: errorText });
    } finally {
      this.saving = false;
      this.render();
      this.attachListeners();
    }
  }

  private attachListeners() {
    const toggle = this.root.querySelector<HTMLInputElement>("#paperless-toggle");
    if (toggle) {
      toggle.addEventListener("change", () => {
        if (this.saving) return;
        this.savePreference(toggle.checked);
      });
    }

    const retryBtn = this.root.querySelector('[data-action="retry"]');
    if (retryBtn) {
      retryBtn.addEventListener("click", () => this.retryLoad());
    }
  }

  render() {
    if (this.loading) {
      this.root.innerHTML = `
        <div class="nw-statement">
          <div class="header">
            <div class="loading-row">
              ${this.spinnerSvg()}
              <span>Loading preferences...</span>
            </div>
          </div>
        </div>`;
      return;
    }

    if (this.error) {
      this.root.innerHTML = `
        <div class="nw-statement">
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

    if (!this.hasDonor) {
      this.root.innerHTML = `
        <div class="nw-statement">
          <div class="header">
            <div class="title">Contribution Statements</div>
          </div>
          <div class="card-body">
            <div class="empty-state">No donor record found for your account.</div>
          </div>
        </div>`;
      return;
    }

    this.root.innerHTML = `
      <div class="nw-statement">
        <div class="header">
          <div class="title">Contribution Statements</div>
        </div>
        <div class="card-body">
          <label class="toggle-row" for="paperless-toggle">
            <span class="toggle-label">Go Paperless! Get statements online/via email.</span>
            <span class="switch">
              <input type="checkbox" id="paperless-toggle"
                ${this.paperless ? "checked" : ""}
                ${this.saving ? "disabled" : ""}>
              <span class="slider"></span>
            </span>
          </label>
          ${this.message
            ? `<div class="message message--${this.message.type}">${this.escapeHtml(this.message.text)}</div>`
            : ""}
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

      .nw-statement {
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

      .card-body {
        padding: 24px;
      }

      .empty-state {
        text-align: center;
        padding: 40px 20px;
        color: #9E9E9E;
        font-size: 14px;
      }

      .toggle-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        cursor: pointer;
      }
      .toggle-label {
        font-size: 15px;
        color: #2D2926;
        line-height: 1.5;
        font-weight: 500;
      }

      .switch {
        position: relative;
        display: inline-block;
        width: 52px;
        height: 28px;
        flex-shrink: 0;
      }
      .switch input {
        position: absolute;
        opacity: 0;
        width: 0;
        height: 0;
        margin: 0;
      }
      .slider {
        position: absolute;
        inset: 0;
        background: #cbd5e1;
        border-radius: 9999px;
        transition: background 0.2s;
      }
      .slider::before {
        content: "";
        position: absolute;
        height: 22px;
        width: 22px;
        left: 3px;
        top: 3px;
        background: white;
        border-radius: 50%;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
        transition: transform 0.2s;
      }
      .switch input:checked + .slider {
        background: #86AD3F;
      }
      .switch input:checked + .slider::before {
        transform: translateX(24px);
      }
      .switch input:focus-visible + .slider {
        box-shadow: 0 0 0 3px rgba(0, 76, 151, 0.4);
      }
      .switch input:disabled + .slider {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .message {
        margin-top: 16px;
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
        .header, .card-body {
          padding: 16px;
        }
        .toggle-row {
          gap: 12px;
        }
        .toggle-label {
          font-size: 14px;
        }
      }
    `;
  }
}

customElements.define("next-statement-preferences", StatementPreferencesWidget);
