import { MPNextWidget } from "../shared/base-widget";

interface SubscriptionItem {
  Publication_ID: number;
  Title: string;
  Description: string | null;
  Online_Sort_Order: number | null;
  subscribed: boolean;
}

// Show the search box only once the list is long enough to warrant filtering.
const SEARCH_THRESHOLD = 6;

export class SubscriptionsWidget extends MPNextWidget {
  private items: SubscriptionItem[] = [];
  private loading = true;
  private error: string | null = null;
  private savingIds = new Set<number>();
  private message: { type: "success" | "error"; text: string } | null = null;
  private searchQuery = "";

  connectedCallback() {
    this.injectStyles(this.getStyles());
    // Await the catalogue before the first paint so a Spanish visitor never
    // sees English swap to Spanish.
    void this.initLocale().then(() => {
      this.render();
      this.loadSubscriptions();
    });
  }

  public retryLoad() {
    this.error = null;
    this.loadSubscriptions();
  }

  private async loadSubscriptions() {
    this.loading = true;
    this.error = null;
    this.render();

    try {
      const res = await this.fetch("/api/embed/subscriptions");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(this.errorText(data));
      }
      const data: { subscriptions: SubscriptionItem[] } = await res.json();
      this.items = data.subscriptions || [];
      this.emit("subscriptionsLoaded", { count: this.items.length });
    } catch (err) {
      this.error = err instanceof Error ? err.message : this.t("errors.network");
      this.emit("subscriptionError", { error: this.error });
    } finally {
      this.loading = false;
      this.render();
      this.attachListeners();
    }
  }

  private async toggleSubscription(pubId: number, nextChecked: boolean) {
    if (this.savingIds.has(pubId)) return;

    const item = this.items.find((i) => i.Publication_ID === pubId);
    if (!item) return;

    const previous = item.subscribed;
    // Optimistically reflect the new state while the request is in flight.
    item.subscribed = nextChecked;
    this.savingIds.add(pubId);
    this.message = null;
    this.render();
    this.attachListeners();

    try {
      // The endpoint is idempotent and diffs against existing state, so we send
      // the full set of publication IDs the user wants subscribed.
      const subscribedIds = this.items
        .filter((i) => i.subscribed)
        .map((i) => i.Publication_ID);

      const res = await this.fetch("/api/embed/subscriptions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscribedIds }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(this.errorText(data, "errors.saveFailed"));
      }
      const data: { success: boolean; error?: string } = await res.json();
      if (!data.success) {
        throw new Error(this.errorText(data, "errors.saveFailed"));
      }

      // The publication title is MP-authored, so only the sentence around it
      // is translated. Two keys rather than one with a verb placeholder: the
      // preposition and the participle agree differently in each direction.
      this.message = {
        type: "success",
        text: this.t(
          nextChecked ? "subscriptions.subscribed" : "subscriptions.unsubscribed",
          { title: item.Title }
        ),
      };
      this.emit("subscriptionChanged", { publicationId: pubId, subscribed: nextChecked });
    } catch (err) {
      // Revert the optimistic flip on failure.
      item.subscribed = previous;
      this.message = {
        type: "error",
        text: this.t("subscriptions.updateFailed"),
      };
      const errText = err instanceof Error ? err.message : this.t("errors.network");
      this.emit("subscriptionError", { error: errText });
    } finally {
      this.savingIds.delete(pubId);
      this.render();
      this.attachListeners();
    }
  }

  private attachListeners() {
    const retryBtn = this.root.querySelector('[data-action="retry"]');
    if (retryBtn) {
      retryBtn.addEventListener("click", () => this.retryLoad());
    }

    const searchInput = this.root.querySelector<HTMLInputElement>("#sub-search");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        this.searchQuery = searchInput.value;
        this.render();
        this.attachListeners();
        const newInput = this.root.querySelector<HTMLInputElement>("#sub-search");
        if (newInput) {
          newInput.focus();
          newInput.selectionStart = newInput.selectionEnd = newInput.value.length;
        }
      });
    }

    const checks = this.root.querySelectorAll<HTMLInputElement>(".sub-check");
    checks.forEach((el) => {
      el.addEventListener("change", () => {
        const id = parseInt(el.dataset.id || "0", 10);
        if (id) this.toggleSubscription(id, el.checked);
      });
    });
  }

  render() {
    if (this.loading) {
      this.root.innerHTML = `
        <div class="nw-subscriptions">
          <div class="header">
            <div class="loading-row">
              ${this.spinnerSvg()}
              <span>${this.escapeHtml(this.t("subscriptions.loading"))}</span>
            </div>
          </div>
        </div>`;
      return;
    }

    if (this.error) {
      this.root.innerHTML = `
        <div class="nw-subscriptions">
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

    this.root.innerHTML = this.renderMain();
  }

  private renderMain(): string {
    const showSearch = this.items.length > SEARCH_THRESHOLD;
    const filtered = this.getFilteredItems();

    const list =
      filtered.length === 0
        ? `<div class="empty-state">${this.escapeHtml(
            this.t(
              this.searchQuery
                ? "subscriptions.noMatches"
                : "subscriptions.empty"
            )
          )}</div>`
        : `<div class="sub-list">${filtered.map((i) => this.renderRow(i)).join("")}</div>`;

    return `
      <div class="nw-subscriptions">
        <div class="header">
          <div class="title">${this.escapeHtml(this.t("subscriptions.title"))}</div>
          <p class="subtitle">${this.escapeHtml(this.t("subscriptions.subtitle"))}</p>
        </div>
        <div class="body">
          ${this.message
            ? `<div class="message message--${this.message.type}">${this.escapeHtml(this.message.text)}</div>`
            : ""}
          ${showSearch
            ? `<div class="search-bar">
                <input type="text" id="sub-search" placeholder="${this.escapeAttr(this.t("subscriptions.searchPlaceholder"))}"
                  value="${this.escapeAttr(this.searchQuery)}">
              </div>`
            : ""}
          ${list}
        </div>
      </div>`;
  }

  private renderRow(item: SubscriptionItem): string {
    const saving = this.savingIds.has(item.Publication_ID);
    const desc = item.Description && item.Description.trim().length > 0
      ? `<span class="sub-desc">${this.escapeHtml(item.Description)}</span>`
      : "";

    return `
      <label class="sub-row">
        <input type="checkbox" class="sub-check" data-id="${item.Publication_ID}"
          ${item.subscribed ? "checked" : ""} ${saving ? "disabled" : ""}>
        <span class="sub-text">
          <span class="sub-title">${this.escapeHtml(item.Title)}</span>
          ${desc}
        </span>
        ${saving ? `<span class="sub-saving">${this.spinnerSvg()}</span>` : ""}
      </label>`;
  }

  private getFilteredItems(): SubscriptionItem[] {
    if (!this.searchQuery) return this.items;
    const q = this.searchQuery.toLowerCase();
    return this.items.filter(
      (i) =>
        i.Title.toLowerCase().includes(q) ||
        (i.Description ? i.Description.toLowerCase().includes(q) : false)
    );
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

      .nw-subscriptions {
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

      .sub-list {
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        overflow: hidden;
      }
      .sub-row {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 16px;
        border-bottom: 1px solid #f3f4f6;
        cursor: pointer;
        transition: background 0.15s;
      }
      .sub-row:last-child {
        border-bottom: none;
      }
      .sub-row:hover {
        background: rgba(0, 76, 151, 0.03);
      }
      .sub-check {
        width: 24px;
        height: 24px;
        flex-shrink: 0;
        accent-color: #004C97;
        cursor: pointer;
        margin: 0;
      }
      .sub-check:disabled {
        cursor: not-allowed;
        opacity: 0.6;
      }
      .sub-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex: 1;
        min-width: 0;
      }
      .sub-title {
        font-size: 15px;
        font-weight: 600;
        color: #2D2926;
      }
      .sub-desc {
        font-size: 13px;
        color: #6b7280;
        line-height: 1.4;
      }
      .sub-saving {
        flex-shrink: 0;
        color: #004C97;
        display: inline-flex;
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
        .sub-row {
          padding: 14px 12px;
        }
      }
    `;
  }
}

customElements.define("next-subscriptions", SubscriptionsWidget);
