import { MPNextWidget } from "../shared/base-widget";
import {
  validateForm,
  bindLiveValidation,
  requiredStar,
  FORM_VALIDATION_STYLES,
} from "../shared/form-validation";

/**
 * `<next-prayer-feedback>` — prayer requests, praise reports and general
 * feedback, writing MP's `Feedback_Entries` (C69).
 *
 * The counterpart of legacy's `mpp-prayer-feedback-form`, which had no `next-*`
 * equivalent at all. A hand-built `next-custom-form` is **not** a substitute: it
 * writes `Form_Responses`, populates no Feedback Type and no Program, and never
 * reaches the tools staff use to work a prayer queue.
 *
 * ## No sign-in gate, deliberately
 *
 * `CROSS-1` does not apply here — the entire point is that a stranger can use
 * it, and for many churches this is the first thing on the website that writes
 * to MP. A sign-in *affordance* is useful (it turns the email round-trip off, so
 * a member's request is filed the moment they press Submit) and is rendered as
 * an aside above the form, never as a replacement for it.
 *
 * ## Three surfaces, one element
 *
 * 1. **The form.** Anonymous, or signed-in with legacy's "Provide Feedback As"
 *    household picker.
 * 2. **The verification landing.** When the page URL carries the verify
 *    parameter (`?mpp-verify-id=…`, legacy's spelling), the form never renders:
 *    the widget redeems the handle and reports the outcome. The handle is
 *    stripped from the address bar before anything awaits.
 * 3. **The misconfiguration notice.** An anonymous form with no
 *    `verification-email-template-id` cannot complete a submission, so it says
 *    so at load rather than after a visitor has typed 2000 characters.
 */

/** Legacy's parameter name, so an MP template and an old bookmark keep working. */
const DEFAULT_VERIFY_PARAM = "mpp-verify-id";

/** `Feedback_Entries.Description` — all 2000 characters, unlike legacy. */
const DESCRIPTION_MAX = 2000;

/** `Feedback_Entries.Entry_Title`. */
const SUMMARY_MAX = 50;

/** Below this many characters remaining, the counter starts showing. */
const COUNTER_THRESHOLD = 200;

type WidgetState =
  | "loading"
  | "unconfigured"
  | "form"
  | "verification-sent"
  | "submitted"
  | "verified"
  | "error";

interface FeedbackTypeOption {
  id: number;
  name: string;
  description: string | null;
}

interface SubmitterOption {
  contactId: number;
  displayName: string;
  hasEmail: boolean;
}

export class PrayerFeedbackWidget extends MPNextWidget {
  private state: WidgetState = "loading";
  private types: FeedbackTypeOption[] = [];
  private self: SubmitterOption | null = null;
  private household: SubmitterOption[] = [];
  private errorPayload: unknown = null;
  /** Form-level message under the heading (failed validation, mostly). */
  private formMessage: string | null = null;
  private submitting = false;
  /** The handle out of the page URL, read and stripped before the first await. */
  private verifyToken: string | null = null;
  /** Set on disconnect so an in-flight request never paints a detached root. */
  private detached = false;

  connectedCallback() {
    this.detached = false;
    this.injectStyles(`${this.getStyles()}${FORM_VALIDATION_STYLES}`);

    // Read and strip the verification handle synchronously, before anything
    // awaits: it must leave the address bar immediately so it does not survive
    // in history, in whatever the host page's analytics reads from
    // `location.search`, or in the `Referer` of a later navigation.
    this.readVerifyToken();

    // `initLocale()` before the first `render()`. Free here, because the widget
    // paints a loading state while it fetches the Feedback Type list anyway.
    void this.initLocale().then(() => {
      this.render();
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

  // ── Attributes ───────────────────────────────────────────────────────────

  /**
   * The configured `Feedback_Type_ID` allowlist, or `[]` for the safe default.
   *
   * A non-numeric entry is dropped with one warning rather than sent on: the
   * server would answer `invalid_request` for the whole list, which would take
   * the working ids down with the typo.
   */
  private get allowedTypeIds(): number[] {
    const raw = (this.getAttribute("feedback-type-ids") ?? "").trim();
    if (!raw) return [];

    const ids: number[] = [];
    const bad: string[] = [];
    for (const part of raw.split(",")) {
      const token = part.trim();
      if (token === "") continue;
      if (/^\d+$/.test(token) && Number(token) > 0) ids.push(Number(token));
      else bad.push(token);
    }
    if (bad.length > 0) {
      console.warn(
        `[mpnext] <next-prayer-feedback> ignored non-numeric feedback-type-ids: ${bad.join(", ")}`,
      );
    }
    return ids;
  }

  private get programId(): number | null {
    const raw = Number(this.getAttribute("program-id"));
    return Number.isInteger(raw) && raw > 0 ? raw : null;
  }

  private get verificationTemplateId(): number | null {
    const raw = Number(this.getAttribute("verification-email-template-id"));
    return Number.isInteger(raw) && raw > 0 ? raw : null;
  }

  private get acknowledgementTemplateId(): number | null {
    const raw = Number(this.getAttribute("acknowledgement-email-template-id"));
    return Number.isInteger(raw) && raw > 0 ? raw : null;
  }

  /** Where the emailed link lands. The current page, query stripped, by default. */
  private get returnUrl(): string {
    const attr = this.getAttribute("return-url");
    if (attr) return attr;
    try {
      const url = new URL(window.location.href);
      url.search = "";
      return url.toString();
    } catch {
      return window.location.href;
    }
  }

  private get verifyParam(): string {
    return this.getAttribute("verify-param-name") || DEFAULT_VERIFY_PARAM;
  }

  private get defaultPrivate(): boolean {
    return this.getAttribute("default-private") === "true";
  }

  /**
   * Hide the Private checkbox and force the value from `default-private`.
   *
   * For a page whose whole framing is confidential pastoral care: a church that
   * treats every request as staff-only should not have to explain a checkbox
   * nobody is meant to untick.
   */
  private get hidePrivateOption(): boolean {
    return this.getAttribute("hide-private-option") === "true";
  }

  private get signedIn(): boolean {
    return this.self !== null;
  }

  // ── Verification handle ──────────────────────────────────────────────────

  private readVerifyToken(): void {
    let url: URL | null = null;
    try {
      url = new URL(window.location.href);
    } catch {
      return;
    }

    const token = (url.searchParams.get(this.verifyParam) ?? "").trim();
    if (!token) return;
    this.verifyToken = token;

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
    // Both in parallel: the type list is public, and the submitter list decides
    // whether the identity fields render at all.
    const [types, submitters] = await Promise.all([
      this.loadTypes(),
      this.loadSubmitters(),
    ]);

    if (this.detached) return;

    if (types === null) {
      this.state = "error";
      this.paint();
      return;
    }

    this.types = types;
    this.self = submitters?.self ?? null;
    this.household = submitters?.household ?? [];

    // A signed-in submitter needs no verification template — their entry is
    // written immediately — so the notice is only for the anonymous form.
    this.state =
      !this.signedIn && this.verificationTemplateId === null ? "unconfigured" : "form";
    this.paint();
  }

  private async loadTypes(): Promise<FeedbackTypeOption[] | null> {
    const ids = this.allowedTypeIds;
    const query = ids.length > 0 ? `?ids=${ids.join(",")}` : "";
    try {
      const res = await this.fetch(`/api/embed/prayer-feedback/types${query}`);
      if (!res.ok) {
        this.errorPayload = await res.json().catch(() => ({}));
        return null;
      }
      const data = (await res.json()) as { types?: FeedbackTypeOption[] };
      return data.types ?? [];
    } catch {
      this.errorPayload = { error: "network" };
      return null;
    }
  }

  /**
   * The household picker's options, or `null` when nobody is signed in.
   *
   * Asking the server rather than inspecting the stored credential, because the
   * answer has to be right in all three auth modes: `legacy` has no `sid` to
   * read, so a client-side check would report every legacy member as anonymous
   * and hide the picker from exactly the people it exists for. A `401` here is
   * the normal, expected answer for a visitor and is not an error.
   */
  private async loadSubmitters(): Promise<{
    self: SubmitterOption;
    household: SubmitterOption[];
  } | null> {
    try {
      const res = await this.fetch("/api/embed/prayer-feedback/submitter");
      if (!res.ok) return null;
      return (await res.json()) as { self: SubmitterOption; household: SubmitterOption[] };
    } catch {
      return null;
    }
  }

  // ── Redeeming the emailed link ───────────────────────────────────────────

  private async redeem(): Promise<void> {
    try {
      const res = await this.fetch("/api/embed/prayer-feedback/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: this.verifyToken }),
      });
      const payload: unknown = await res.json().catch(() => ({}));

      if (!res.ok) {
        this.errorPayload = payload;
        this.state = "error";
        this.emit("feedbackError", { error: this.errorText(payload) });
      } else {
        const data = payload as { feedbackEntryId?: number };
        this.state = "verified";
        this.emit("feedbackVerified", { feedbackEntryId: data.feedbackEntryId ?? null });
      }
    } catch {
      this.errorPayload = { error: "network" };
      this.state = "error";
      this.emit("feedbackError", { error: this.errorText(this.errorPayload) });
    }
    this.paint();
  }

  /** Retry after an error. Also the demo page's re-run hook. */
  public retryLoad(): void {
    this.state = "loading";
    this.errorPayload = null;
    this.formMessage = null;
    this.paint();
    this.init();
  }

  // ── Submitting ───────────────────────────────────────────────────────────

  private async submit(form: HTMLFormElement): Promise<void> {
    if (this.submitting) return;

    // Native constraints only, and deliberately no phone `pattern` and no
    // custom phone validator. C24 is the cautionary tale: MP's *display* mask
    // `xxx-xxx-xxxx` pressed into service as a validation pattern made
    // `next-plan-your-visit` unsubmittable for anyone who typed their number
    // any other way.
    if (!validateForm(form, { t: this.t }).valid) {
      this.formMessage = this.t("validation.formIncomplete");
      this.paintFormMessage();
      return;
    }

    this.formMessage = null;
    this.submitting = true;
    this.paintSubmitState();

    const body = this.buildBody(form);

    try {
      const res = await this.fetch("/api/embed/prayer-feedback/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload: unknown = await res.json().catch(() => ({}));

      if (!res.ok) {
        this.errorPayload = payload;
        this.state = "error";
        this.emit("feedbackError", { error: this.errorText(payload) });
      } else {
        const data = payload as { status?: string; feedbackEntryId?: number };
        if (data.status === "verification_sent") {
          this.state = "verification-sent";
          this.emit("verificationSent", { email: body.email ?? null });
        } else {
          this.state = "submitted";
          this.emit("feedbackSubmitted", {
            feedbackEntryId: data.feedbackEntryId ?? null,
          });
        }
      }
    } catch {
      this.errorPayload = { error: "network" };
      this.state = "error";
      this.emit("feedbackError", { error: this.errorText(this.errorPayload) });
    } finally {
      this.submitting = false;
      this.paint();
    }
  }

  /**
   * The request body.
   *
   * The identity fields are sent only when they are live — a hidden field is
   * `disabled`, so it never reaches `FormData` at all, which is what keeps a
   * stale value the visitor typed before switching the picker from travelling
   * with a household submission.
   */
  private buildBody(form: HTMLFormElement): Record<string, unknown> {
    const data = new FormData(form);
    const text = (name: string): string => String(data.get(name) ?? "").trim();

    const body: Record<string, unknown> = {
      feedbackTypeId: Number(text("feedbackTypeId")),
      summary: text("summary"),
      isPrivate: this.hidePrivateOption
        ? this.defaultPrivate
        : data.get("isPrivate") !== null,
      acknowledgementEmailTemplateId: this.acknowledgementTemplateId,
    };

    const description = text("description");
    if (description) body.description = description;
    if (this.programId !== null) body.programId = this.programId;

    const allowed = this.allowedTypeIds;
    if (allowed.length > 0) body.allowedTypeIds = allowed;

    const onBehalfOf = text("onBehalfOf");
    if (onBehalfOf) {
      body.onBehalfOfContactId = Number(onBehalfOf);
    } else {
      // The blank form, or an anonymous visitor: the submission is about
      // someone the server cannot vouch for, so it needs the emailed link.
      body.returnUrl = this.returnUrl;
      body.verifyParamName = this.verifyParam;
      if (this.verificationTemplateId !== null) {
        body.verificationEmailTemplateId = this.verificationTemplateId;
      }
    }

    for (const [field, key] of [
      ["firstName", "firstName"],
      ["lastName", "lastName"],
      ["email", "email"],
      ["mobilePhone", "mobilePhone"],
    ] as const) {
      const value = text(field);
      if (value) body[key] = value;
    }

    return body;
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  /** Render, then re-attach the listeners the new markup needs. */
  private paint(): void {
    if (this.detached) return;
    this.render();
    this.attachListeners();
  }

  render() {
    if (this.state === "loading") {
      this.root.innerHTML = `
        <div class="pf">
          ${this.statusRegion(
            `<span class="pf-working">${this.spinnerSvg()}<span>${this.escapeHtml(
              this.t("common.loading"),
            )}</span></span>`,
          )}
        </div>`;
      return;
    }

    if (this.state === "error") {
      this.root.innerHTML = `
        <div class="pf">
          ${this.statusRegion(
            `<p class="pf-headline pf-headline--warn">${this.escapeHtml(
              this.errorText(this.errorPayload),
            )}</p>`,
          )}
          <div class="pf-actions">
            <button class="pf-btn" type="button" data-action="retry">${this.escapeHtml(
              this.t("common.retry"),
            )}</button>
          </div>
        </div>`;
      return;
    }

    if (this.state === "unconfigured") {
      this.root.innerHTML = `
        <div class="pf">
          ${this.renderHeader()}
          ${this.statusRegion(
            `<p class="pf-headline pf-headline--warn">${this.escapeHtml(
              this.t("prayerFeedback.notConfigured"),
            )}</p>`,
          )}
        </div>`;
      return;
    }

    if (this.state !== "form") {
      const key =
        this.state === "verification-sent"
          ? "prayerFeedback.verificationSent"
          : this.state === "verified"
            ? "prayerFeedback.verified"
            : "prayerFeedback.submitted";
      this.root.innerHTML = `
        <div class="pf">
          ${this.statusRegion(
            `<p class="pf-headline">${this.escapeHtml(this.t(key))}</p>`,
          )}
        </div>`;
      return;
    }

    this.root.innerHTML = `
      <div class="pf">
        ${this.renderHeader()}
        ${this.renderSignInAside()}
        <form class="pf-form" novalidate>
          <p class="pf-form-message" data-role="form-message" hidden></p>
          ${this.renderSubmitterPicker()}
          ${this.renderIdentityFields()}
          ${this.renderTypeField()}
          ${this.renderSummaryField()}
          ${this.renderDetailsField()}
          ${this.renderPrivateField()}
          <div class="pf-actions">
            <button class="pf-btn" type="submit" data-role="submit">${this.escapeHtml(
              this.t("common.submit"),
            )}</button>
          </div>
        </form>
      </div>`;
  }

  private renderHeader(): string {
    return `
      <h2 class="pf-title">${this.escapeHtml(this.t("prayerFeedback.title"))}</h2>
      <p class="pf-lead">${this.escapeHtml(this.t("prayerFeedback.lead"))}</p>`;
  }

  /**
   * The sign-in affordance: an aside, never a gate.
   *
   * Only for a visitor who is not signed in, and only when signing in would
   * actually change something for them — which it does, because it removes the
   * email confirmation step.
   */
  private renderSignInAside(): string {
    if (this.signedIn) return "";
    return `
      <p class="pf-aside">
        <span>${this.escapeHtml(this.t("prayerFeedback.signInHint"))}</span>
        <button class="pf-link" type="button" data-action="sign-in">${this.escapeHtml(
          this.t("common.signIn"),
        )}</button>
      </p>`;
  }

  /**
   * Legacy's "Provide Feedback As" picker.
   *
   * The blank-form option is offered only when a verification template is
   * configured, because filing for someone outside the household takes the
   * emailed round-trip and would otherwise fail at submit.
   */
  private renderSubmitterPicker(): string {
    if (!this.signedIn || !this.self) return "";

    const options = [this.self, ...this.household]
      .map(
        (option) =>
          `<option value="${option.contactId}" data-has-email="${
            option.hasEmail ? "true" : "false"
          }">${this.escapeHtml(option.displayName)}</option>`,
      )
      .join("");

    const blank =
      this.verificationTemplateId !== null
        ? `<option value="">${this.escapeHtml(this.t("prayerFeedback.blankForm"))}</option>`
        : "";

    return `
      <div class="pf-field nw-field">
        <label class="pf-label" for="pf-on-behalf">${this.escapeHtml(
          this.t("prayerFeedback.provideFeedbackAs"),
        )}${requiredStar()}</label>
        <select class="pf-input" id="pf-on-behalf" name="onBehalfOf" data-role="on-behalf" required>
          ${options}${blank}
        </select>
      </div>`;
  }

  /**
   * First name, last name, email, phone.
   *
   * Always rendered, so switching the picker never loses what the visitor
   * typed — `applyIdentityVisibility()` toggles `hidden` and `disabled`
   * instead. A `disabled` control is excluded from both validation
   * (`willValidate` is false) and `FormData`, which is why hiding alone would
   * not be enough.
   */
  private renderIdentityFields(): string {
    return `
      <div class="pf-identity" data-role="identity">
        <div class="pf-row">
          <div class="pf-field nw-field" data-role="field-firstName">
            <label class="pf-label" for="pf-first-name">${this.escapeHtml(
              this.t("fields.firstName"),
            )}${requiredStar()}</label>
            <input class="pf-input" id="pf-first-name" name="firstName" type="text" maxlength="50" autocomplete="given-name" required>
          </div>
          <div class="pf-field nw-field" data-role="field-lastName">
            <label class="pf-label" for="pf-last-name">${this.escapeHtml(
              this.t("fields.lastName"),
            )}${requiredStar()}</label>
            <input class="pf-input" id="pf-last-name" name="lastName" type="text" maxlength="50" autocomplete="family-name" required>
          </div>
        </div>
        <div class="pf-row">
          <div class="pf-field nw-field" data-role="field-email">
            <label class="pf-label" for="pf-email">${this.escapeHtml(
              this.t("fields.email"),
            )}${requiredStar()}</label>
            <input class="pf-input" id="pf-email" name="email" type="email" maxlength="254" autocomplete="email" required>
          </div>
          <div class="pf-field nw-field" data-role="field-mobilePhone">
            <label class="pf-label" for="pf-mobile-phone">${this.escapeHtml(
              this.t("fields.mobilePhone"),
            )} <span class="pf-optional">(${this.escapeHtml(
              this.t("common.optional"),
            )})</span></label>
            <input class="pf-input" id="pf-mobile-phone" name="mobilePhone" type="tel" maxlength="50" autocomplete="tel">
          </div>
        </div>
      </div>`;
  }

  private renderTypeField(): string {
    // Option labels come from `Feedback_Types` and are rendered as the church
    // typed them — MP-authored content is not translated by this catalogue.
    const options = this.types
      .map((type) => `<option value="${Number(type.id)}">${this.escapeHtml(type.name)}</option>`)
      .join("");

    return `
      <div class="pf-field nw-field">
        <label class="pf-label" for="pf-type">${this.escapeHtml(
          this.t("prayerFeedback.feedbackType"),
        )}${requiredStar()}</label>
        <select class="pf-input" id="pf-type" name="feedbackTypeId" required>
          <option value="">${this.escapeHtml(this.t("prayerFeedback.selectType"))}</option>
          ${options}
        </select>
      </div>`;
  }

  private renderSummaryField(): string {
    return `
      <div class="pf-field nw-field">
        <label class="pf-label" for="pf-summary">${this.escapeHtml(
          this.t("prayerFeedback.summary"),
        )}${requiredStar()}</label>
        <input class="pf-input" id="pf-summary" name="summary" type="text" maxlength="${SUMMARY_MAX}" aria-describedby="pf-summary-hint" required>
        <span class="pf-hint" id="pf-summary-hint">${this.escapeHtml(
          this.t("prayerFeedback.summaryHint"),
        )}</span>
      </div>`;
  }

  private renderDetailsField(): string {
    return `
      <div class="pf-field nw-field">
        <label class="pf-label" for="pf-details">${this.escapeHtml(
          this.t("prayerFeedback.details"),
        )} <span class="pf-optional">(${this.escapeHtml(
          this.t("common.optional"),
        )})</span></label>
        <textarea class="pf-input pf-textarea" id="pf-details" name="description" rows="5" maxlength="${DESCRIPTION_MAX}" aria-describedby="pf-details-counter" data-role="details"></textarea>
        <span class="pf-counter" id="pf-details-counter" data-role="counter" aria-live="polite"></span>
      </div>`;
  }

  private renderPrivateField(): string {
    if (this.hidePrivateOption) return "";
    const checked = this.defaultPrivate ? " checked" : "";
    return `
      <div class="pf-field nw-field pf-field--check">
        <label class="pf-check">
          <input type="checkbox" id="pf-private" name="isPrivate" value="true"${checked}>
          <span>${this.escapeHtml(this.t("prayerFeedback.private"))}</span>
        </label>
        <span class="pf-hint">${this.escapeHtml(
          this.t("prayerFeedback.privateHint"),
        )}</span>
      </div>`;
  }

  /**
   * The one live region, so a state change is announced (`CROSS-3`). The
   * headline *is* the announcement; `prayerFeedback.title` names the region.
   */
  private statusRegion(inner: string): string {
    return `<div class="pf-status" role="status" aria-live="polite" aria-label="${this.escapeAttr(
      this.t("prayerFeedback.title"),
    )}">${inner}</div>`;
  }

  // ── Listeners and partial repaints ───────────────────────────────────────

  private attachListeners(): void {
    const retry = this.root.querySelector('[data-action="retry"]');
    if (retry) retry.addEventListener("click", () => this.retryLoad());

    const signIn = this.root.querySelector('[data-action="sign-in"]');
    if (signIn) {
      signIn.addEventListener("click", () => this.requestLogin("prayer-feedback"));
    }

    const form = this.root.querySelector<HTMLFormElement>("form.pf-form");
    if (!form) return;

    bindLiveValidation(form, { t: this.t });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.submit(form);
    });

    const picker = this.root.querySelector<HTMLSelectElement>('[data-role="on-behalf"]');
    if (picker) {
      picker.addEventListener("change", () => this.applyIdentityVisibility());
    }

    const details = this.root.querySelector<HTMLTextAreaElement>('[data-role="details"]');
    if (details) {
      details.addEventListener("input", () => this.paintCounter());
    }

    this.applyIdentityVisibility();
    this.paintCounter();
  }

  /**
   * Which identity fields are live for the current picker selection.
   *
   * Legacy's `ShowHideEmailContainer`, generalised. The email field reappears
   * for a household member with no address on file — which is the case legacy's
   * UI was built for, and the value `backfillContactEmail` writes on the server.
   */
  private applyIdentityVisibility(): void {
    const identity = this.root.querySelector<HTMLElement>('[data-role="identity"]');
    if (!identity) return;

    const picker = this.root.querySelector<HTMLSelectElement>('[data-role="on-behalf"]');
    // No picker at all means nobody is signed in: the whole block is live.
    const selected = picker ? picker.value : "";
    const blankForm = selected === "";
    const option = picker?.selectedOptions[0];
    const targetHasEmail = option?.dataset.hasEmail === "true";

    const showNames = blankForm;
    const showEmail = blankForm || !targetHasEmail;

    this.setFieldLive("firstName", showNames, true);
    this.setFieldLive("lastName", showNames, true);
    this.setFieldLive("email", showEmail, true);
    this.setFieldLive("mobilePhone", showNames, false);

    identity.hidden = !showNames && !showEmail;
  }

  /**
   * Show or hide one identity field, and take it in or out of validation.
   *
   * `disabled` as well as `hidden`, because a hidden-but-enabled control still
   * has `willValidate === true` — so a `required` field the visitor cannot see
   * would silently block every submission with an error nobody can find.
   */
  private setFieldLive(name: string, live: boolean, requiredWhenLive: boolean): void {
    const wrapper = this.root.querySelector<HTMLElement>(`[data-role="field-${name}"]`);
    const control = this.root.querySelector<HTMLInputElement>(`[name="${name}"]`);
    if (!wrapper || !control) return;

    wrapper.hidden = !live;
    control.disabled = !live;
    if (live && requiredWhenLive) control.setAttribute("required", "");
    else control.removeAttribute("required");
  }

  private paintCounter(): void {
    const details = this.root.querySelector<HTMLTextAreaElement>('[data-role="details"]');
    const counter = this.root.querySelector<HTMLElement>('[data-role="counter"]');
    if (!details || !counter) return;

    const remaining = DESCRIPTION_MAX - details.value.length;
    // Silent until the limit is close: a counter that is always on reads as a
    // demand for a long answer, which a prayer request is not.
    counter.textContent =
      remaining <= COUNTER_THRESHOLD
        ? this.t("prayerFeedback.charactersLeft", { count: remaining })
        : "";
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
   * Not `pointer-events: none` plus a grey background, which is what legacy
   * does — that leaves a keyboard user able to submit the form twice.
   */
  private paintSubmitState(): void {
    const button = this.root.querySelector<HTMLButtonElement>('[data-role="submit"]');
    if (!button) return;
    button.disabled = this.submitting;
    button.textContent = this.submitting
      ? this.t("common.submitting")
      : this.t("common.submit");
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
    return `<svg class="pf-spinner" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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

      .pf {
        max-width: 640px;
        margin: 0 auto;
        padding: 28px 24px;
        background: white;
        border: 1px solid #e5e7eb;
        border-radius: 16px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.06);
        color: #2D2926;
      }

      .pf-title {
        margin: 0 0 6px;
        font-size: 22px;
        font-weight: 700;
        color: #004C97;
      }
      .pf-lead {
        margin: 0 0 18px;
        font-size: 15px;
        line-height: 1.55;
        color: #4b5563;
      }

      .pf-aside {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 6px;
        margin: 0 0 18px;
        padding: 10px 14px;
        border-radius: 8px;
        background: rgba(0, 156, 222, 0.1);
        border: 1px solid rgba(0, 156, 222, 0.35);
        font-size: 14px;
        color: #002855;
      }
      .pf-link {
        background: none;
        border: none;
        padding: 0;
        font: inherit;
        font-weight: 600;
        color: #004C97;
        text-decoration: underline;
        cursor: pointer;
      }
      .pf-link:hover { color: #002855; }

      .pf-status { margin: 0; }
      .pf-working {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        font-size: 16px;
      }
      .pf-spinner {
        width: 20px;
        height: 20px;
        color: #004C97;
        animation: pf-spin 1s linear infinite;
      }
      @keyframes pf-spin { to { transform: rotate(360deg); } }

      .pf-headline {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        line-height: 1.45;
        color: #002855;
      }
      .pf-headline--warn { color: #2D2926; font-weight: 500; }

      .pf-form { display: block; }
      .pf-form-message {
        margin: 0 0 16px;
        padding: 10px 14px;
        border-radius: 8px;
        font-size: 14px;
        background: rgba(255, 109, 106, 0.15);
        color: #b91c1c;
        border: 1px solid rgba(255, 109, 106, 0.4);
      }

      .pf-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
      }
      .pf-field { margin-bottom: 16px; }
      .pf-label {
        display: block;
        margin-bottom: 4px;
        font-size: 13px;
        font-weight: 600;
        color: #2D2926;
      }
      .pf-optional { font-weight: 400; color: #6b7280; }
      .pf-input {
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
      .pf-input:focus {
        outline: none;
        border-color: #004C97;
        box-shadow: 0 0 0 2px rgba(0, 76, 151, 0.2);
      }
      .pf-textarea { resize: vertical; min-height: 110px; }
      .pf-hint {
        display: block;
        margin-top: 4px;
        font-size: 12px;
        color: #6b7280;
      }
      .pf-counter {
        display: block;
        margin-top: 4px;
        font-size: 12px;
        color: #6b7280;
        font-variant-numeric: tabular-nums;
      }

      .pf-field--check { margin-top: 4px; }
      .pf-check {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        font-weight: 600;
      }
      .pf-check input { width: 16px; height: 16px; accent-color: #004C97; }

      .pf-actions { margin-top: 20px; }
      .pf-btn {
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
      .pf-btn:hover { background: #002855; }
      .pf-btn:focus-visible { outline: 3px solid rgba(0, 156, 222, 0.6); outline-offset: 2px; }
      .pf-btn:disabled { opacity: 0.6; cursor: not-allowed; }

      @media (max-width: 560px) {
        .pf { padding: 20px 16px; }
        .pf-row { grid-template-columns: 1fr; gap: 0; }
        .pf-title { font-size: 19px; }
      }
    `;
  }
}

customElements.define("next-prayer-feedback", PrayerFeedbackWidget);
