import { MPNextWidget } from "../shared/base-widget";
import {
  validateForm,
  bindLiveValidation,
  requiredStar,
  FORM_VALIDATION_STYLES,
} from "../shared/form-validation";

/**
 * `<next-subscribe-to-publication>` — anonymous, email-verified newsletter
 * opt-in (C70).
 *
 * The counterpart of legacy's `mpp-subscribe-to-publication`, which had no
 * `next-*` equivalent at all: `next-subscriptions` is a *signed-in* management
 * surface whose route refuses `sub === "public"` outright, so before this the
 * only way onto a publication was to already have an MP account. "Sign up for
 * our newsletter" is the most common publication touchpoint a church has, and
 * it is anonymous by definition.
 *
 * ## One element, both hops
 *
 * Legacy read `mpp-verify-id` off `window.location.search` on mount and branched
 * (`mpp-subscribe-to-publication.js:141-151`); this keeps that shape, because
 * the emailed link lands back on the page that hosts the form. The parameter is
 * `nextwidgets_verify` rather than legacy's `mpp-verify-id` — the
 * `nextwidgets_*` convention covers every browser-visible key the SDK owns, and
 * a query parameter is one.
 *
 * The handle is read and stripped from the address bar **synchronously, before
 * anything awaits**, so it does not survive in history, in whatever the host
 * page's analytics reads from `location.search`, or in a later `Referer`.
 *
 * ## Three link states, not one "bad link"
 *
 * `linkExpired`, `linkInvalid` and `linkUsed` differ in **affordance**, which is
 * the whole reason they are not collapsed: the first two offer a fresh sign-up,
 * the error state offers the same link again, and `linkUsed` offers neither —
 * signing up again would be pointless and retrying would fail identically.
 *
 * `linkUsed` exists only because redemption is single-use and store-backed. It
 * is not an error: the visitor almost certainly confirmed successfully and is
 * simply seeing the page a second time, so the copy leads with reassurance and
 * offers the manage-preferences link rather than a button.
 *
 * ## What it never renders
 *
 * The server's English `message`. Every failure goes through
 * `this.errorText(payload)`, which resolves the machine code against the
 * catalogue and degrades an unmapped code to `errors.generic` — so a congregant
 * never reads "Missing publicationId" in any language. There is a test.
 */

/** The `nextwidgets_verify` default, matching `SUBSCRIBE_VERIFY_PARAM`. */
const DEFAULT_VERIFY_PARAM = "nextwidgets_verify";

type WidgetState =
  | "loading"
  | "form"
  | "sent"
  | "verifying"
  | "verified"
  | "link-expired"
  | "link-invalid"
  | "link-used"
  | "not-available"
  | "error";

interface PublicationSummary {
  Publication_ID: number;
  Title: string;
  Description: string | null;
}

export class SubscribeToPublicationWidget extends MPNextWidget {
  /**
   * Watched so a host page that swaps the publication re-renders.
   *
   * No `oldValue !== null` guard in `attributeChangedCallback` (CROSS-4/C39):
   * that guard is what makes several widgets in this repo ignore the *first*
   * set, and `reconfigure()` is already a no-op before the first render.
   */
  static get observedAttributes(): string[] {
    return ["publication-id", "verification-email-template-id", "my-subscriptions-url"];
  }

  private state: WidgetState = "loading";
  private publication: PublicationSummary | null = null;
  /** The address the visitor typed, for the `sent` state's sentence. */
  private submittedEmail = "";
  /** The address the server echoed from the handle, for `verified`. */
  private verifiedEmail = "";
  private verifiedTitle = "";
  private errorPayload: unknown = null;
  /** Form-level message under the heading — a failed client validation. */
  private formMessage: string | null = null;
  private submitting = false;
  /** The handle out of the page URL, read and stripped before the first await. */
  private verifyToken: string | null = null;
  /** True once `render()` has run, so `reconfigure()` knows to re-init. */
  private painted = false;
  /** Set on disconnect, so an in-flight request never paints a detached root. */
  private detached = false;

  connectedCallback() {
    this.detached = false;
    this.injectStyles(`${this.getStyles()}${FORM_VALIDATION_STYLES}`);

    // Before anything awaits — see the class note.
    this.readVerifyToken();

    // `initLocale()` before the first `render()`: a Spanish visitor must not see
    // English swap to Spanish. Free here, because the widget paints a loading
    // state while it fetches the publication anyway.
    void this.initLocale().then(() => {
      this.render();
      this.painted = true;
      this.init();
    });
  }

  disconnectedCallback(): void {
    // The base class unsubscribes the locale listener and disconnects the
    // `lang` MutationObserver here. Without this call each mount leaks one of
    // each.
    super.disconnectedCallback();
    this.detached = true;
  }

  attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null) {
    if (oldValue !== newValue) this.reconfigure();
  }

  /** A no-op before the first paint; a full re-init after it. */
  private reconfigure(): void {
    if (!this.painted || this.detached) return;
    this.publication = null;
    this.errorPayload = null;
    this.formMessage = null;
    this.state = this.verifyToken ? "verifying" : "loading";
    this.paint();
    this.init();
  }

  // ── Attributes ───────────────────────────────────────────────────────────

  private get publicationId(): number | null {
    const raw = Number(this.getAttribute("publication-id"));
    return Number.isInteger(raw) && raw > 0 ? raw : null;
  }

  private get verificationTemplateId(): number | null {
    const raw = Number(this.getAttribute("verification-email-template-id"));
    return Number.isInteger(raw) && raw > 0 ? raw : null;
  }

  /** Where the emailed link lands. The current page, query stripped, by default. */
  private get returnUrl(): string {
    const attr = this.getAttribute("return-url");
    if (attr) return attr;
    try {
      const url = new URL(window.location.href);
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      return window.location.href;
    }
  }

  private get verifyParam(): string {
    return this.getAttribute("verify-param-name") || DEFAULT_VERIFY_PARAM;
  }

  /** Deep link into `next-subscriptions`. Renders the manage link when set. */
  private get mySubscriptionsUrl(): string | null {
    const raw = (this.getAttribute("my-subscriptions-url") ?? "").trim();
    return raw === "" ? null : raw;
  }

  // ── The emailed handle ───────────────────────────────────────────────────

  private readVerifyToken(): void {
    let url: URL;
    try {
      url = new URL(window.location.href);
    } catch {
      return;
    }

    const token = (url.searchParams.get(this.verifyParam) ?? "").trim();
    if (!token) return;
    this.verifyToken = token;
    this.state = "verifying";

    try {
      url.searchParams.delete(this.verifyParam);
      history.replaceState(null, "", url.toString());
    } catch {
      /* no history API, or a sandboxed frame — nothing to recover */
    }
  }

  // ── Loading ──────────────────────────────────────────────────────────────

  private init(): void {
    if (this.verifyToken) {
      void this.redeem();
      return;
    }
    void this.load();
  }

  private async load(): Promise<void> {
    const publicationId = this.publicationId;
    if (publicationId === null) {
      // Host misconfiguration, phrased for the visitor who is looking at it.
      this.state = "not-available";
      this.paint();
      return;
    }

    try {
      const res = await this.fetch(
        `/api/embed/subscribe-to-publication/publication?publicationId=${publicationId}`,
      );
      if (this.detached) return;

      const payload: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = (payload as { error?: string }).error;
        this.errorPayload = payload;
        this.state = code === "publication_not_found" ? "not-available" : "error";
        this.paint();
        return;
      }

      this.publication = (payload as { publication: PublicationSummary }).publication;
      this.state = "form";
    } catch {
      this.errorPayload = { error: "network" };
      this.state = "error";
    }
    this.paint();
  }

  // ── Redeeming the emailed link ───────────────────────────────────────────

  private async redeem(): Promise<void> {
    try {
      const res = await this.fetch("/api/embed/subscribe-to-publication/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: this.verifyToken }),
      });
      if (this.detached) return;

      const payload: unknown = await res.json().catch(() => ({}));

      if (!res.ok) {
        const code = (payload as { error?: string }).error ?? "";
        this.errorPayload = payload;
        this.state = VERIFY_FAILURE_STATES[code] ?? "error";
        this.emit("subscribeFailed", { code });
      } else {
        const data = payload as {
          publicationTitle?: string;
          email?: string;
          alreadySubscribed?: boolean;
        };
        this.verifiedTitle = data.publicationTitle ?? "";
        this.verifiedEmail = data.email ?? "";
        this.state = "verified";
        this.emit("subscribed", {
          publicationId: this.publicationId,
          email: this.verifiedEmail,
          // For a host page's analytics. The copy says the same thing either
          // way — nothing actionable differs, and a double-clicked link is the
          // common cause.
          alreadySubscribed: data.alreadySubscribed === true,
        });
      }
    } catch {
      this.errorPayload = { error: "network" };
      this.state = "error";
      this.emit("subscribeFailed", { code: "network" });
    }
    this.paint();
  }

  /**
   * Retry.
   *
   * Re-POSTs the **same** handle when there is one, which is correct: the only
   * failure that reaches the error state with a handle in hand is a store
   * outage, and in that path `consumePendingAction` did not burn the record.
   */
  public retryLoad(): void {
    this.state = this.verifyToken ? "verifying" : "loading";
    this.errorPayload = null;
    this.formMessage = null;
    this.paint();
    this.init();
  }

  /** Drop out of a dead-link state and back to the form. */
  private signUpAgain(): void {
    this.verifyToken = null;
    this.state = "loading";
    this.errorPayload = null;
    this.paint();
    this.init();
  }

  // ── Submitting ───────────────────────────────────────────────────────────

  private async submit(form: HTMLFormElement): Promise<void> {
    if (this.submitting) return;

    // The shared validator, never native `reportValidity`: its popup is
    // unstyleable, escapes the shadow root and is not announced.
    if (!validateForm(form, { t: this.t }).valid) {
      this.formMessage = this.t("validation.formIncomplete");
      this.paintFormMessage();
      return;
    }

    this.formMessage = null;
    this.submitting = true;
    this.paintSubmitState();

    const data = new FormData(form);
    const text = (name: string): string => String(data.get(name) ?? "").trim();
    const email = text("email").toLowerCase();

    const body: Record<string, unknown> = {
      publicationId: this.publicationId,
      firstName: text("firstName"),
      lastName: text("lastName"),
      email,
      returnUrl: this.returnUrl,
      verifyParamName: this.verifyParam,
    };
    if (this.verificationTemplateId !== null) {
      body.verificationEmailTemplateId = this.verificationTemplateId;
    }

    try {
      const res = await this.fetch(
        "/api/embed/subscribe-to-publication/send-verification",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (this.detached) return;

      const payload: unknown = await res.json().catch(() => ({}));

      if (!res.ok) {
        const code = (payload as { error?: string }).error ?? "";
        this.errorPayload = payload;
        this.state = code === "publication_not_found" ? "not-available" : "error";
        this.emit("subscribeFailed", { code });
      } else {
        this.submittedEmail = email;
        this.state = "sent";
        this.emit("verificationSent", { email });
      }
    } catch {
      this.errorPayload = { error: "network" };
      this.state = "error";
      this.emit("subscribeFailed", { code: "network" });
    } finally {
      this.submitting = false;
      this.paint();
    }
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  /** Render, then re-attach the listeners the new markup needs. */
  private paint(): void {
    if (this.detached) return;
    this.render();
    this.painted = true;
    this.attachListeners();
  }

  render() {
    const inner = this.renderState();
    this.root.innerHTML = `<div class="sp">${inner}</div>`;
  }

  private renderState(): string {
    switch (this.state) {
      case "loading":
        return this.statusRegion(
          `<span class="sp-working">${this.spinnerSvg()}<span>${this.escapeHtml(
            this.t("subscribeToPublication.loading"),
          )}</span></span>`,
        );

      case "verifying":
        return this.statusRegion(
          `<span class="sp-working">${this.spinnerSvg()}<span>${this.escapeHtml(
            this.t("subscribeToPublication.verifying"),
          )}</span></span>`,
        );

      case "sent":
        return this.statusRegion(`
          <p class="sp-headline">${this.escapeHtml(
            this.t("subscribeToPublication.checkEmailTitle"),
          )}</p>
          <p class="sp-body">${this.escapeHtml(
            this.t("subscribeToPublication.checkEmail", {
              email: this.submittedEmail,
              title: this.publicationTitle,
            }),
          )}</p>`);

      case "verified":
        return `${this.statusRegion(`
          <p class="sp-headline">${this.escapeHtml(
            this.t("subscribeToPublication.verifiedTitle"),
          )}</p>
          <p class="sp-body">${this.escapeHtml(
            this.t("subscribeToPublication.verified", {
              title: this.verifiedTitle,
              email: this.verifiedEmail,
            }),
          )}</p>`)}${this.renderManageLink()}`;

      case "link-used":
        // No sign-up button: the likeliest cause is a second click on a link
        // that already worked, so signing up again would be pointless. The
        // manage link is where someone genuinely unsure should go.
        return `${this.statusRegion(
          `<p class="sp-headline">${this.escapeHtml(
            this.t("subscribeToPublication.linkUsed"),
          )}</p>`,
        )}${this.renderManageLink()}`;

      case "link-expired":
      case "link-invalid":
        return `${this.statusRegion(
          `<p class="sp-headline sp-headline--warn">${this.escapeHtml(
            this.t(
              this.state === "link-expired"
                ? "subscribeToPublication.linkExpired"
                : "subscribeToPublication.linkInvalid",
            ),
          )}</p>`,
        )}
          <div class="sp-actions">
            <button class="sp-btn" type="button" data-action="sign-up-again">${this.escapeHtml(
              this.t("subscribeToPublication.signUpAgain"),
            )}</button>
          </div>`;

      case "not-available":
        return this.statusRegion(
          `<p class="sp-headline sp-headline--warn">${this.escapeHtml(
            this.t("subscribeToPublication.notAvailable"),
          )}</p>`,
        );

      case "error":
        return `${this.statusRegion(`
          <p class="sp-headline sp-headline--warn">${this.escapeHtml(
            this.t("common.unableToLoad"),
          )}</p>
          <p class="sp-body">${this.escapeHtml(this.errorText(this.errorPayload))}</p>`)}
          <div class="sp-actions">
            <button class="sp-btn" type="button" data-action="retry">${this.escapeHtml(
              this.t("common.retry"),
            )}</button>
          </div>`;

      case "form":
      default:
        return this.renderForm();
    }
  }

  private renderForm(): string {
    const description = this.publication?.Description;
    return `
      <h2 class="sp-title">${this.escapeHtml(
        this.t("subscribeToPublication.heading", { title: this.publicationTitle }),
      )}</h2>
      ${
        description
          ? // MP-authored copy, rendered as the church wrote it: this catalogue
            // translates our chrome, never their content.
            `<p class="sp-description">${this.escapeHtml(description)}</p>`
          : ""
      }
      <p class="sp-lead">${this.escapeHtml(this.t("subscribeToPublication.lead"))}</p>
      <form class="sp-form" novalidate>
        <p class="sp-form-message" data-role="form-message" hidden></p>
        <div class="sp-row">
          <div class="sp-field nw-field">
            <label class="sp-label" for="sp-first-name">${this.escapeHtml(
              this.t("fields.firstName"),
            )}${requiredStar()}</label>
            <input class="sp-input" id="sp-first-name" name="firstName" type="text" maxlength="50" autocomplete="given-name" required>
          </div>
          <div class="sp-field nw-field">
            <label class="sp-label" for="sp-last-name">${this.escapeHtml(
              this.t("fields.lastName"),
            )}${requiredStar()}</label>
            <input class="sp-input" id="sp-last-name" name="lastName" type="text" maxlength="50" autocomplete="family-name" required>
          </div>
        </div>
        <div class="sp-field nw-field">
          <label class="sp-label" for="sp-email">${this.escapeHtml(
            this.t("fields.email"),
          )}${requiredStar()}</label>
          <input class="sp-input" id="sp-email" name="email" type="email" maxlength="254" autocomplete="email" required>
        </div>
        <div class="sp-actions">
          <button class="sp-btn" type="submit" data-role="submit">${this.escapeHtml(
            this.t("subscribeToPublication.submit"),
          )}</button>
        </div>
        <p class="sp-privacy">${this.escapeHtml(
          this.t("subscribeToPublication.privacyNote", { title: this.publicationTitle }),
        )}</p>
      </form>`;
  }

  /**
   * The link into `next-subscriptions`, when the host configured one.
   *
   * Closes the loop: the same URL contract `next-unsubscribe` uses, so a church
   * points both widgets at one preferences page.
   */
  private renderManageLink(): string {
    const url = this.mySubscriptionsUrl;
    if (!url) return "";
    return `
      <p class="sp-manage">
        <a class="sp-link" href="${this.escapeAttr(url)}">${this.escapeHtml(
          this.t("subscribeToPublication.managePreferences"),
        )}</a>
      </p>`;
  }

  /**
   * The one live region, so every state change is announced (CROSS-3).
   *
   * Named by `subscribeToPublication.title` rather than by the heading, because
   * the heading interpolates a publication title that does not exist yet while
   * the widget is loading or verifying.
   */
  private statusRegion(inner: string): string {
    return `<div class="sp-status" role="status" aria-live="polite" aria-label="${this.escapeAttr(
      this.t("subscribeToPublication.title"),
    )}">${inner}</div>`;
  }

  /** The publication's own title, or the empty string before it loads. */
  private get publicationTitle(): string {
    return this.publication?.Title ?? this.verifiedTitle;
  }

  // ── Listeners and partial repaints ───────────────────────────────────────

  private attachListeners(): void {
    const retry = this.root.querySelector('[data-action="retry"]');
    if (retry) retry.addEventListener("click", () => this.retryLoad());

    const again = this.root.querySelector('[data-action="sign-up-again"]');
    if (again) again.addEventListener("click", () => this.signUpAgain());

    const form = this.root.querySelector<HTMLFormElement>("form.sp-form");
    if (!form) return;

    bindLiveValidation(form, { t: this.t });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.submit(form);
    });
  }

  private paintFormMessage(): void {
    const node = this.root.querySelector<HTMLElement>('[data-role="form-message"]');
    if (!node) return;
    if (this.formMessage) {
      node.textContent = this.formMessage;
      node.hidden = false;
      node.setAttribute("role", "alert");
    } else {
      node.textContent = "";
      node.hidden = true;
    }
  }

  /**
   * Disable the submit button through the `disabled` property.
   *
   * Not legacy's `pointer-events: none` plus a grey background, which leaves a
   * keyboard user able to submit twice.
   */
  private paintSubmitState(): void {
    const button = this.root.querySelector<HTMLButtonElement>('[data-role="submit"]');
    if (!button) return;
    button.disabled = this.submitting;
    button.textContent = this.submitting
      ? this.t("common.submitting")
      : this.t("subscribeToPublication.submit");
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private escapeHtml(text: string): string {
    const el = document.createElement("span");
    el.textContent = text;
    return el.innerHTML;
  }

  private escapeAttr(text: string): string {
    return this.escapeHtml(text).replace(/"/g, "&quot;");
  }

  private spinnerSvg(): string {
    return `<svg class="sp-spinner" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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

      .sp {
        max-width: 560px;
        margin: 0 auto;
        padding: 28px 24px;
        background: white;
        border: 1px solid #e5e7eb;
        border-radius: 16px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.06);
        color: #2D2926;
      }

      .sp-title {
        margin: 0 0 6px;
        font-size: 22px;
        font-weight: 700;
        color: #004C97;
      }
      .sp-description {
        margin: 0 0 10px;
        font-size: 15px;
        line-height: 1.55;
        color: #2D2926;
      }
      .sp-lead {
        margin: 0 0 18px;
        font-size: 14px;
        line-height: 1.55;
        color: #4b5563;
      }

      .sp-status { margin: 0; }
      .sp-working {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        font-size: 16px;
      }
      .sp-spinner {
        width: 20px;
        height: 20px;
        color: #004C97;
        animation: sp-spin 1s linear infinite;
      }
      @keyframes sp-spin { to { transform: rotate(360deg); } }

      .sp-headline {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        line-height: 1.45;
        color: #002855;
      }
      .sp-headline--warn { color: #2D2926; font-weight: 500; }
      .sp-body {
        margin: 8px 0 0;
        font-size: 15px;
        line-height: 1.55;
        color: #4b5563;
      }

      .sp-form { display: block; }
      .sp-form-message {
        margin: 0 0 16px;
        padding: 10px 14px;
        border-radius: 8px;
        font-size: 14px;
        background: rgba(255, 109, 106, 0.15);
        color: #b91c1c;
        border: 1px solid rgba(255, 109, 106, 0.4);
      }

      .sp-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
      }
      .sp-field { margin-bottom: 16px; }
      .sp-label {
        display: block;
        margin-bottom: 4px;
        font-size: 13px;
        font-weight: 600;
        color: #2D2926;
      }
      .sp-input {
        display: block;
        width: 100%;
        box-sizing: border-box;
        padding: 9px 12px;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        font-family: inherit;
        font-size: 14px;
        color: #2D2926;
        background: white;
      }
      .sp-input:focus {
        outline: none;
        border-color: #004C97;
        box-shadow: 0 0 0 2px rgba(0, 76, 151, 0.2);
      }

      .sp-actions { margin-top: 20px; }
      .sp-btn {
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
      .sp-btn:hover { background: #002855; }
      .sp-btn:focus-visible { outline: 3px solid rgba(0, 156, 222, 0.6); outline-offset: 2px; }
      .sp-btn:disabled { opacity: 0.6; cursor: not-allowed; }

      .sp-privacy {
        margin: 14px 0 0;
        font-size: 12px;
        line-height: 1.5;
        color: #6b7280;
      }
      .sp-manage { margin: 16px 0 0; font-size: 14px; }
      .sp-link {
        color: #004C97;
        font-weight: 600;
        text-decoration: underline;
      }
      .sp-link:hover { color: #002855; }

      @media (max-width: 560px) {
        .sp { padding: 20px 16px; }
        .sp-row { grid-template-columns: 1fr; gap: 0; }
        .sp-title { font-size: 19px; }
      }
    `;
  }
}

/**
 * Which state each redemption failure lands in.
 *
 * Kept as a table rather than a chain of `if`s because the mapping *is* the
 * design: three codes, three affordances, and anything else — including a
 * store outage's `internal_error` — falls through to the retryable error state.
 */
const VERIFY_FAILURE_STATES: Record<string, WidgetState> = {
  verification_expired: "link-expired",
  verification_invalid: "link-invalid",
  verification_used: "link-used",
  publication_not_found: "not-available",
};

customElements.define("next-subscribe-to-publication", SubscribeToPublicationWidget);
