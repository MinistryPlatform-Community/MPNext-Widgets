import { MPNextWidget, SIGN_IN_REQUIRED_STYLES } from "../shared/base-widget";

/**
 * `<next-contact-attributes>` (C52) — the congregant's own attributes.
 *
 * Legacy was `mpp-about-me`, two modes over one shadow root, and the two modes
 * survive: a **view** of what the contact holds, and an **edit** grid of every
 * member-visible attribute. Three things about it do not survive.
 *
 * 1. **The client no longer computes the delta.** Legacy tracked
 *    `_addedAttributes` / `_removedAttributes` from click events and posted the
 *    difference, so two open tabs silently clobbered each other. This widget
 *    PUTs the complete set it wants and the server diffs against the database.
 * 2. **The server decides what is writable.** Rendering only visible types is a
 *    convenience here; the guard is `invalid_attribute` on the route.
 * 3. **The empty state is not a failed form.** Legacy dropped a contact with no
 *    attributes into edit mode with `Cancel` hidden and `Submit` disabled — a
 *    wall of unchecked boxes and two dead buttons, with no explanation (D5).
 *    The behaviour is right and is kept; the heading and `emptyIntro` are what
 *    make it legible.
 *
 * Type and attribute names come from MP and are rendered as staff typed them —
 * a Spanish page shows "Spiritual Gifts". Everything this file authors goes
 * through `this.t`.
 */

interface ContactAttributeItem {
  attributeId: number;
  attributeName: string;
  selected: boolean;
}

interface ContactAttributeGroup {
  attributeTypeId: number;
  attributeTypeName: string;
  attributes: ContactAttributeItem[];
}

/** How long the success notice stays up. Legacy parity. */
const SAVED_NOTICE_MS = 5000;

type Phase = "loading" | "signedOut" | "ready" | "error";

export class ContactAttributesWidget extends MPNextWidget {
  private phase: Phase = "loading";
  private types: ContactAttributeGroup[] = [];
  /** The selection as the server last reported it. The Cancel target. */
  private loaded = new Set<number>();
  /** The selection the visitor is building. Equal to `loaded` outside edit. */
  private draft = new Set<number>();
  private editing = false;
  private saving = false;
  private error: string | null = null;
  private notice: { kind: "success" | "error"; text: string } | null = null;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;

  connectedCallback() {
    // The shared sign-in sheet goes first so this widget's own button classes win.
    this.injectStyles(SIGN_IN_REQUIRED_STYLES + this.getStyles());
    // Catalogue before the first paint, so a Spanish visitor never watches
    // English swap to Spanish.
    void this.initLocale().then(() => {
      this.render();
      void this.load();
    });
  }

  disconnectedCallback(): void {
    // The base class unsubscribes the locale listener and the MutationObserver
    // here; skipping the super call leaks one of each per mount.
    super.disconnectedCallback();
    this.clearNoticeTimer();
  }

  public retryLoad() {
    this.error = null;
    void this.load();
  }

  // ── Data ─────────────────────────────────────────────────────────────────

  private async load() {
    this.phase = "loading";
    this.error = null;
    this.paint();

    try {
      const res = await this.fetch("/api/embed/contact-attributes");

      if (this.isNeedsAuth(res)) {
        // Signed out is an ordinary state for this widget, not an error: it is
        // signed-in-only by design, so the answer is the shared sign-in panel.
        this.phase = "signedOut";
        this.paint();
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        this.phase = "error";
        this.error = this.errorText(body);
        this.emit("contactAttributesError", { error: this.error });
        this.paint();
        return;
      }

      const data: { types?: ContactAttributeGroup[] } = await res.json();
      this.adopt(data.types ?? []);
      this.phase = "ready";
      this.emit("contactAttributesLoaded", {
        types: this.types.length,
        selected: this.loaded.size,
      });
    } catch {
      // A thrown error here is a transport failure or a missing token — never a
      // translated sentence, so it must not be rendered. `errorText` owns every
      // string a visitor reads.
      this.phase = "error";
      this.error = this.t("errors.network");
      this.emit("contactAttributesError", { error: this.error });
    }

    this.paint();
  }

  /**
   * Take a server payload as the new truth.
   *
   * A contact holding nothing opens straight in edit mode — legacy's own
   * behaviour, and the only sensible one: there is no view to return to.
   */
  private adopt(types: ContactAttributeGroup[]) {
    this.types = types;
    this.loaded = new Set(
      types.flatMap((group) =>
        group.attributes.filter((a) => a.selected).map((a) => a.attributeId)
      )
    );
    this.draft = new Set(this.loaded);
    this.editing = this.loaded.size === 0;
  }

  private async save() {
    if (this.saving || !this.dirty) return;

    this.saving = true;
    this.setNotice(null);
    this.paint();

    try {
      const res = await this.fetch("/api/embed/contact-attributes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // The complete desired set. The server diffs it against the database,
        // so a replay is a no-op rather than a resurrection.
        body: JSON.stringify({ attributeIds: [...this.draft] }),
      });

      if (this.isNeedsAuth(res)) {
        this.phase = "signedOut";
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // `errorText` renders the machine code's sentence; the server's English
        // `message` is never shown. An `invalid_attribute` reaches the visitor
        // as "reload the page and try again", which is the only useful advice.
        //
        // The draft is left alone: a failed save must not discard the visitor's
        // edits, and staying in edit mode is what lets them retry.
        const text = this.errorText(body, "errors.saveFailed");
        this.setNotice("error", text);
        this.emit("contactAttributesError", { error: text });
        return;
      }

      const data: { types?: ContactAttributeGroup[] } = await res.json();
      // Re-render from the server's recomputed payload rather than from what we
      // hoped we wrote.
      this.adopt(data.types ?? []);
      this.setNotice("success", this.t("contactAttributes.saved"), SAVED_NOTICE_MS);
      this.emit("contactAttributesSaved", { selected: this.loaded.size });
    } catch {
      const text = this.t("errors.network");
      this.setNotice("error", text);
      this.emit("contactAttributesError", { error: text });
    } finally {
      this.saving = false;
      this.paint();
    }
  }

  // ── Selection state ──────────────────────────────────────────────────────

  /** Does the draft differ from what the server last reported? */
  private get dirty(): boolean {
    if (this.draft.size !== this.loaded.size) return true;
    for (const id of this.draft) if (!this.loaded.has(id)) return true;
    return false;
  }

  /** Types that have at least one selected attribute, for the view mode. */
  private get selectedGroups(): ContactAttributeGroup[] {
    return this.types
      .map((group) => ({
        ...group,
        attributes: group.attributes.filter((a) => this.loaded.has(a.attributeId)),
      }))
      .filter((group) => group.attributes.length > 0);
  }

  private setNotice(
    kind: "success" | "error" | null,
    text = "",
    dismissAfter = 0
  ) {
    this.clearNoticeTimer();
    this.notice = kind === null ? null : { kind, text };
    if (dismissAfter > 0) {
      this.noticeTimer = setTimeout(() => {
        this.notice = null;
        this.noticeTimer = null;
        if (this.isConnected) this.paint();
      }, dismissAfter);
    }
  }

  private clearNoticeTimer() {
    if (this.noticeTimer !== null) {
      clearTimeout(this.noticeTimer);
      this.noticeTimer = null;
    }
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  /** `render()` plus the listener pass every repaint needs. */
  private paint() {
    this.render();
  }

  private attachListeners() {
    // `[data-action="login"]` is delegated by the base class (renderSignInRequired).
    const retry = this.root.querySelector('[data-action="retry"]');
    if (retry) retry.addEventListener("click", () => this.retryLoad());

    const edit = this.root.querySelector('[data-action="edit"]');
    if (edit) {
      edit.addEventListener("click", () => {
        this.editing = true;
        this.draft = new Set(this.loaded);
        this.setNotice(null);
        this.paint();
      });
    }

    const cancel = this.root.querySelector('[data-action="cancel"]');
    if (cancel) {
      cancel.addEventListener("click", () => {
        // Cancel restores the loaded set, discarding every edit.
        this.draft = new Set(this.loaded);
        this.editing = false;
        this.setNotice(null);
        this.paint();
      });
    }

    const form = this.root.querySelector<HTMLFormElement>("#ca-form");
    if (form) {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        void this.save();
      });
    }

    this.root.querySelectorAll<HTMLInputElement>(".ca-check").forEach((input) => {
      input.addEventListener("change", () => {
        const id = Number(input.dataset.id);
        if (!Number.isFinite(id)) return;
        if (input.checked) this.draft.add(id);
        else this.draft.delete(id);
        // Only the Submit button's disabled state depends on this, so update it
        // in place: a full repaint would move focus off the checkbox the
        // visitor just used.
        this.syncSubmitState();
      });
    });
  }

  private syncSubmitState() {
    const submit = this.root.querySelector<HTMLButtonElement>('[data-action="submit"]');
    if (submit) submit.disabled = this.saving || !this.dirty;
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
    if (this.phase === "loading") {
      this.root.innerHTML = this.shell(`
        <div class="ca-loading">
          ${this.spinnerSvg()}
          <span>${this.escapeHtml(this.t("contactAttributes.loading"))}</span>
        </div>`);
      return;
    }

    if (this.phase === "signedOut") {
      this.root.innerHTML = this.shell(
        this.renderSignInRequired({
          subject: "contact-attributes",
          message: this.t("contactAttributes.signedOut"),
          className: "ca-signin",
          buttonClass: "ca-btn ca-btn--primary",
        })
      );
      return;
    }

    if (this.phase === "error") {
      this.root.innerHTML = this.shell(`
        <p class="ca-notice ca-notice--error" role="alert">
          ${this.escapeHtml(this.error ?? this.t("errors.generic"))}
        </p>
        <div class="ca-actions">
          <button type="button" class="ca-btn ca-btn--primary" data-action="retry">
            ${this.escapeHtml(this.t("common.retry"))}
          </button>
        </div>`);
      return;
    }

    if (this.types.length === 0) {
      // No `Available_Online` attribute type — the default on a fresh MP
      // domain, and a 200 from the server rather than an error.
      this.root.innerHTML = this.shell(`
        <p class="ca-intro">${this.escapeHtml(this.t("contactAttributes.notConfigured"))}</p>`);
      return;
    }

    this.root.innerHTML = this.shell(
      this.editing ? this.renderEdit() : this.renderView()
    );
  }

  /** Heading, notice slot and body — every state shares this frame. */
  private shell(body: string): string {
    return `
      <section class="ca">
        <h2 class="ca-title">${this.escapeHtml(this.t("contactAttributes.title"))}</h2>
        ${this.renderNotice()}
        ${body}
      </section>`;
  }

  private renderNotice(): string {
    if (!this.notice) return "";
    const role = this.notice.kind === "success" ? "status" : "alert";
    return `<p class="ca-notice ca-notice--${this.notice.kind}" role="${role}">
      ${this.escapeHtml(this.notice.text)}
    </p>`;
  }

  private renderView(): string {
    const groups = this.selectedGroups;

    return `
      <p class="ca-intro">${this.escapeHtml(this.t("contactAttributes.intro"))}</p>
      ${groups
        .map(
          (group) => `
        <section class="ca-group">
          <h3 class="ca-group-title">${this.escapeHtml(group.attributeTypeName)}</h3>
          <ul class="ca-list">
            ${group.attributes
              .map((a) => `<li class="ca-item">${this.escapeHtml(a.attributeName)}</li>`)
              .join("")}
          </ul>
        </section>`
        )
        .join("")}
      <div class="ca-actions">
        <button type="button" class="ca-btn ca-btn--primary" data-action="edit">
          ${this.escapeHtml(this.t("common.edit"))}
        </button>
      </div>`;
  }

  private renderEdit(): string {
    // Empty means "nothing selected yet", which is the state a contact with no
    // attributes lands in. There is no view to cancel back to, so no Cancel.
    const empty = this.loaded.size === 0;
    const introKey = empty ? "contactAttributes.emptyIntro" : "contactAttributes.intro";

    return `
      <form id="ca-form" novalidate>
        <p class="ca-intro">${this.escapeHtml(this.t(introKey))}</p>
        ${this.types.map((group) => this.renderFieldset(group)).join("")}
        <div class="ca-actions">
          <button type="submit" class="ca-btn ca-btn--primary" data-action="submit"
            ${this.saving || !this.dirty ? "disabled" : ""}>
            ${this.escapeHtml(this.t(this.saving ? "common.saving" : "common.submit"))}
          </button>
          ${empty
            ? ""
            : `<button type="button" class="ca-btn ca-btn--ghost" data-action="cancel"
                ${this.saving ? "disabled" : ""}>
                ${this.escapeHtml(this.t("common.cancel"))}
              </button>`}
        </div>
      </form>`;
  }

  /**
   * One attribute type.
   *
   * A `<fieldset>` with a real `<legend>` rather than a `<div>` with a bold
   * `<div>`, and every checkbox carries a `<label for>`: a group of checkboxes
   * with no group name is exactly the accessibility gap C05, C10, C22, C28 and
   * C45 filed against this catalogue's other list widgets.
   */
  private renderFieldset(group: ContactAttributeGroup): string {
    return `
      <fieldset class="ca-group">
        <legend class="ca-group-title">${this.escapeHtml(group.attributeTypeName)}</legend>
        <div class="ca-grid">
          ${group.attributes.map((a) => this.renderCheckbox(a)).join("")}
        </div>
      </fieldset>`;
  }

  private renderCheckbox(item: ContactAttributeItem): string {
    const id = `ca-attr-${item.attributeId}`;
    return `
      <div class="ca-choice">
        <input type="checkbox" class="ca-check" id="${id}" data-id="${item.attributeId}"
          ${this.draft.has(item.attributeId) ? "checked" : ""} ${this.saving ? "disabled" : ""}>
        <label for="${id}">${this.escapeHtml(item.attributeName)}</label>
      </div>`;
  }

  private escapeHtml(text: string): string {
    const el = document.createElement("span");
    el.textContent = text;
    return el.innerHTML;
  }

  private spinnerSvg(): string {
    return `<svg class="ca-spinner" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
      <path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
    </svg>`;
  }

  private getStyles(): string {
    return `
      :host {
        all: initial;
        display: block;
        font-family: var(--_nw-font-family);
        color: var(--_nw-color-text);
      }

      .ca {
        max-width: 800px;
        margin: 0 auto;
        background: var(--_nw-color-surface);
        border: var(--_nw-border-width) solid var(--_nw-color-border);
        border-radius: 16px;
        padding: var(--_nw-space-6);
        box-sizing: border-box;
      }

      .ca-title {
        margin: 0 0 var(--_nw-space-2);
        font-size: 22px;
        font-weight: var(--_nw-font-weight-heading);
        color: var(--_nw-color-primary);
      }

      .ca-intro {
        margin: 0 0 var(--_nw-space-5);
        font-size: var(--_nw-font-size-base);
        line-height: var(--_nw-line-height);
        color: var(--_nw-color-muted);
      }

      .ca-loading {
        display: flex;
        align-items: center;
        gap: 10px;
        color: var(--_nw-color-muted);
        font-size: 15px;
      }
      .ca-spinner {
        width: 20px;
        height: 20px;
        animation: ca-spin 1s linear infinite;
        color: var(--_nw-color-primary);
      }
      @keyframes ca-spin { to { transform: rotate(360deg); } }

      .ca-notice {
        margin: 0 0 var(--_nw-space-4);
        padding: 10px 14px;
        border-radius: var(--_nw-radius);
        font-size: var(--_nw-font-size-base);
        line-height: 1.4;
      }
      .ca-notice--success {
        background: rgba(134, 173, 63, 0.15);
        border: 1px solid rgba(134, 173, 63, 0.4);
        color: #4d6b16;
      }
      .ca-notice--error {
        background: rgba(255, 109, 106, 0.15);
        border: 1px solid rgba(255, 109, 106, 0.4);
        color: var(--_nw-color-error-text);
      }

      .ca-group {
        border: var(--_nw-border-width) solid var(--_nw-color-border);
        border-radius: var(--_nw-radius-lg);
        padding: var(--_nw-space-4);
        margin: 0 0 var(--_nw-space-4);
      }
      .ca-group-title {
        margin: 0 0 var(--_nw-space-3);
        padding: 0 var(--_nw-space-1);
        font-size: 15px;
        font-weight: 600;
        color: var(--_nw-color-secondary);
      }

      .ca-list {
        margin: 0;
        padding: 0 0 0 var(--_nw-space-5);
      }
      .ca-item {
        font-size: var(--_nw-font-size-base);
        line-height: 1.6;
      }

      .ca-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: var(--_nw-space-2) var(--_nw-space-4);
      }
      .ca-choice {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .ca-check {
        width: 18px;
        height: 18px;
        flex-shrink: 0;
        accent-color: var(--_nw-color-primary);
        margin: 0;
        cursor: pointer;
      }
      .ca-check:disabled { cursor: not-allowed; opacity: 0.6; }
      .ca-choice label {
        font-size: var(--_nw-font-size-base);
        line-height: 1.4;
        cursor: pointer;
      }

      .ca-actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--_nw-space-3);
        margin-top: var(--_nw-space-5);
      }
      .ca-btn {
        padding: 10px 22px;
        border-radius: var(--_nw-radius);
        border: 1px solid transparent;
        font-family: inherit;
        font-size: var(--_nw-font-size-base);
        font-weight: 600;
        cursor: pointer;
      }
      .ca-btn--primary {
        background: var(--_nw-button-bg);
        color: var(--_nw-button-fg);
      }
      .ca-btn--primary:hover:not(:disabled) { background: var(--_nw-button-bg-hover); }
      .ca-btn--ghost {
        background: var(--_nw-color-surface);
        color: var(--_nw-color-primary);
        border-color: var(--_nw-color-primary);
      }
      .ca-btn--ghost:hover:not(:disabled) { background: rgba(0, 76, 151, 0.06); }
      .ca-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      @media (max-width: 640px) {
        .ca { padding: var(--_nw-space-4); }
        .ca-grid { grid-template-columns: 1fr; }
      }
    `;
  }
}

customElements.define("next-contact-attributes", ContactAttributesWidget);
