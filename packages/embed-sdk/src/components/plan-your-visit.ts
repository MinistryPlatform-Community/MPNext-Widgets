import { MPNextWidget } from "../shared/base-widget";
import {
  validateForm,
  bindLiveValidation,
  field,
  fieldId,
  FORM_VALIDATION_STYLES,
  type CustomValidator,
  type FieldOptions,
} from "../shared/form-validation";

interface PyvOption {
  id: number;
  name: string;
}
interface PyvCountry {
  code: string;
  name: string;
}
interface Config {
  congregations: PyvOption[];
  genders: PyvOption[];
  countries: PyvCountry[];
  /**
   * MP's `PhoneMask` (`xxx-xxx-xxxx`). A **display** hint, rendered as the
   * phone placeholder and never as a `pattern` (C24).
   */
  phoneMask: string | null;
}

/** Fewest / most digits a phone number may carry (E.164 caps at 15). */
const PHONE_MIN_DIGITS = 7;
const PHONE_MAX_DIGITS = 15;

/**
 * True when `value` is a plausible phone number: 7-15 digits once separators
 * (`-`, spaces, parentheses, dots, slashes, a leading `+`) are ignored.
 *
 * C24: this widget once used MP's *display* mask `xxx-xxx-xxxx` as an HTML
 * `pattern` (an anchored regex matching only that literal text), so no real
 * number validated and the form could not be submitted. Counting digits accepts
 * every way a person writes their number and still rejects `abc`.
 */
export function isPlausiblePhone(value: string): boolean {
  const v = value.trim();
  if (!/^\+?[0-9\s().\-/]+$/.test(v)) return false;
  const digits = v.replace(/\D/g, "").length;
  return digits >= PHONE_MIN_DIGITS && digits <= PHONE_MAX_DIGITS;
}
interface AgeGroup {
  id: number;
  value: string;
  ageInMonthsToPromote: number | null;
}
interface VerifyResult {
  firstName: string;
  lastName: string;
  email: string;
}
/**
 * One child row. `values` mirrors **every** `child-<key>-<field>` control,
 * keyed by `<field>` (`firstName`, `lastName`, `dob`, `gender`, `ageGroup`),
 * so a re-render can restore all of it (C82: it once kept only `dob`).
 */
interface ChildState {
  key: number;
  values: Record<string, string>;
}

/**
 * `next-plan-your-visit` — two-step first-time-visitor registration.
 *
 * Ported from the legacy `mpp-plan-your-visit` portal widget:
 *   1. Initial form — a visitor enters name + email; we email them a verified
 *      link back to this page (`?mpp-verify-id=<token>`). Existing contacts are
 *      offered sign-in instead.
 *   2. Visit-details form (shown when the page loads with a valid token) —
 *      congregation, when-to-expect-you, head-of-household, optional address,
 *      spouse and children (each placed in an age/grade group). Submitting
 *      creates the household + members and sends notification emails.
 *
 * Simplifications relative to legacy (noted inline):
 *  - Address entry is plain fields (no Google Places autocomplete in v1).
 *  - MP's `PhoneMask` is only the phone placeholder; phones validate by digit
 *    count (`isPlausiblePhone`), never by a `pattern` built from the mask (C24).
 */
export class PlanYourVisitWidget extends MPNextWidget {
  private loading = true;
  private message: { type: string; text: string } | null = null;
  private contactExists = false;

  private mode: "initial" | "verify" = "initial";
  private token = "";
  private verify: VerifyResult | null = null;
  private verifyFailed: string | null = null;

  private config: Config = { congregations: [], genders: [], countries: [], phoneMask: null };
  private ageGroups: AgeGroup[] = [];
  private childRows: ChildState[] = [];
  private childSeq = 0;

  static get observedAttributes() {
    return [
      "api-host",
      "return-url",
      "verification-email-template-id",
      "church-notification-email-template-id",
      "user-notification-email-template-id",
      "collect-address",
      "milestone-to-assign-id",
      "milestone-program-id",
      "verify-param-name",
    ];
  }

  connectedCallback() {
    this.injectStyles(this.getStyles() + FORM_VALIDATION_STYLES);
    // Await the catalogue before the first paint so a Spanish visitor never
    // sees English swap to Spanish; the fetch hides inside the loading state
    // this widget already paints while it verifies the token.
    void this.initLocale().then(() => {
      this.render();
      this.init();
    });
  }

  // ── Attribute helpers ──

  private get returnUrl(): string {
    const attr = this.getAttribute("return-url");
    if (attr) return attr;
    try {
      const u = new URL(window.location.href);
      u.search = "";
      return u.toString();
    } catch {
      return window.location.href;
    }
  }
  private get verifyParam(): string {
    return this.getAttribute("verify-param-name") || "mpp-verify-id";
  }
  private get collectAddress(): boolean {
    return this.getAttribute("collect-address") === "true";
  }

  private resolveToken(): string {
    try {
      return new URLSearchParams(window.location.search).get(this.verifyParam) || "";
    } catch {
      return "";
    }
  }

  // ── Init ──

  private async init() {
    this.loading = true;
    this.message = null;
    this.render();

    this.token = this.resolveToken();
    this.mode = this.token ? "verify" : "initial";

    try {
      if (this.mode === "verify") {
        await this.runVerify();
        if (this.verify) await this.loadConfig();
        if (this.verify) await this.loadAgeGroups(this.selectedCongregationId());
      }
      // Initial form needs no preload (templates come from attributes).
    } catch (err) {
      this.message = {
        type: "danger",
        text: err instanceof Error ? err.message : this.t("errors.generic"),
      };
    } finally {
      this.loading = false;
      this.render();
      this.attachListeners();
    }
  }

  private async runVerify() {
    const res = await this.fetch(
      `/api/embed/plan-your-visit/verify?token=${encodeURIComponent(this.token)}`
    );
    const data = await res.json().catch(() => ({ success: false }));
    if (data.success) {
      this.verify = { firstName: data.firstName, lastName: data.lastName, email: data.email };
      this.verifyFailed = null;
      this.emit("verified", { email: data.email });
    } else {
      this.verify = null;
      this.verifyFailed = data.reason || "invalid";
    }
  }

  private async loadConfig() {
    const res = await this.fetch(`/api/embed/plan-your-visit/config`);
    if (!res.ok) return;
    const data = await res.json();
    this.config = {
      congregations: data.congregations || [],
      genders: data.genders || [],
      countries: data.countries || [],
      phoneMask: data.phoneMask ?? null,
    };
  }

  private async loadAgeGroups(congregationId: number) {
    try {
      const res = await this.fetch(
        `/api/embed/plan-your-visit/age-groups?congregationId=${congregationId || 0}`
      );
      if (!res.ok) return;
      const data = await res.json();
      this.ageGroups = data.ageOrGradeGroups || [];
    } catch {
      this.ageGroups = [];
    }
  }

  private selectedCongregationId(): number {
    const sel = this.root.querySelector<HTMLSelectElement>('[name="congregationId"]');
    if (sel && sel.value) return Number(sel.value);
    return this.config.congregations[0]?.id ?? 0;
  }

  // ── Step 1: verification email ──

  private async submitVerification(form: HTMLFormElement) {
    if (!validateForm(form, { t: this.t }).valid) return;
    const fd = new FormData(form);
    const payload = {
      firstName: String(fd.get("firstName") || "").trim(),
      lastName: String(fd.get("lastName") || "").trim(),
      email: String(fd.get("email") || "").trim(),
      returnUrl: this.returnUrl,
      verificationEmailTemplate: this.getAttribute("verification-email-template-id") || "",
    };

    this.setButtonsDisabled(true);
    this.message = null;
    try {
      const res = await this.fetch(`/api/embed/plan-your-visit/send-verification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({ success: false }));

      if (data.contactExists) {
        this.contactExists = true;
        this.emit("contactExists", {});
        // The route's `message` is English and debug-only, so render the
        // translated sentence instead.
        this.setMessage("warning", this.t("planYourVisit.accountExists"));
        this.render();
        this.attachListeners();
        return;
      }
      if (!data.success) {
        this.setMessage(
          "danger",
          this.errorText(data, "planYourVisit.verificationFailed")
        );
        this.setButtonsDisabled(false);
        return;
      }

      this.emit("verificationSent", { email: payload.email });
      this.setMessage("success", this.t("planYourVisit.verificationSent"));
      form.reset();
    } catch (err) {
      this.setMessage(
        "danger",
        err instanceof Error ? err.message : this.t("errors.submitFailed")
      );
    } finally {
      this.setButtonsDisabled(false);
    }
  }

  // ── Step 2: visit details ──

  /** Digit-count check on both phones; an empty optional phone passes (C24). */
  private phoneValidators(): Record<string, CustomValidator> {
    const check: CustomValidator = (value) =>
      value.trim() && !isPlausiblePhone(value) ? this.t("validation.phone") : null;
    return { headMobilePhone: check, spousePhone: check };
  }

  private async submitDetails(form: HTMLFormElement) {
    if (!validateForm(form, { t: this.t, customValidators: this.phoneValidators() }).valid) {
      this.setMessage("warning", this.t("validation.formIncomplete"));
      return;
    }
    if (!this.verify) return;
    this.syncChildren();

    const fd = new FormData(form);
    const str = (k: string) => String(fd.get(k) || "").trim();
    const numOrNull = (k: string): number | null => {
      const v = str(k);
      return v ? Number(v) : null;
    };

    const spouseFirst = str("spouseFirstName");
    const payload: Record<string, unknown> = {
      token: this.token,
      email: this.verify.email,
      congregationId: Number(str("congregationId")) || 0,
      whenCanWeExpectYou: str("whenCanWeExpectYou"),
      headOfHousehold: {
        firstName: str("headFirstName"),
        lastName: str("headLastName"),
        mobilePhoneNumber: str("headMobilePhone") || null,
      },
      spouse: spouseFirst
        ? {
            firstName: spouseFirst,
            emailAddress: str("spouseEmail") || null,
            mobilePhoneNumber: str("spousePhone") || null,
          }
        : null,
      children: this.childRows.map((c) => ({
        firstName: str(`child-${c.key}-firstName`),
        lastName: str(`child-${c.key}-lastName`),
        dateOfBirth: str(`child-${c.key}-dob`) || null,
        genderId: numOrNull(`child-${c.key}-gender`),
        ageAndGradeGroup: numOrNull(`child-${c.key}-ageGroup`),
      })),
      milestoneToAssignId: numOrNull("__milestoneToAssignId"),
      milestoneProgramId: numOrNull("__milestoneProgramId"),
      churchNotificationEmailTemplate:
        this.getAttribute("church-notification-email-template-id") || null,
      // C63: the visitor's own confirmation. Absent, the server falls back to
      // the congregation's Plan_A_Visit_Template.
      userNotificationEmailTemplate:
        this.getAttribute("user-notification-email-template-id") || null,
    };

    if (this.collectAddress) {
      payload.address = {
        addressLine1: str("addressLine1") || null,
        city: str("addressCity") || null,
        stateRegion: str("addressState") || null,
        postalCode: str("addressPostal") || null,
        countryCode: str("addressCountry") || null,
      };
    }

    this.setButtonsDisabled(true);
    this.message = null;
    try {
      const res = await this.fetch(`/api/embed/plan-your-visit/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({ success: false }));
      if (!data.success) {
        this.setMessage("danger", this.errorText(data, "planYourVisit.saveFailed"));
        this.setButtonsDisabled(false);
        return;
      }
      this.emit("visitPlanned", { email: this.verify.email });
      this.setMessage("success", this.t("planYourVisit.submitted"));
      this.hideDetailsForm();
    } catch (err) {
      this.setMessage(
        "danger",
        err instanceof Error ? err.message : this.t("errors.submitFailed")
      );
      this.setButtonsDisabled(false);
    }
  }

  private hideDetailsForm() {
    const form = this.root.querySelector<HTMLElement>("#pyv-details-form");
    if (form) form.style.display = "none";
  }

  // ── Children state ──

  /**
   * Snapshot every rendered child control back into `childRows`, by iterating
   * the row's controls rather than naming the fields to keep: a field added to
   * the row later is preserved without touching this method (C82).
   */
  private syncChildren() {
    for (const c of this.childRows) {
      const prefix = `child-${c.key}-`;
      this.root
        .querySelectorAll<HTMLInputElement | HTMLSelectElement>(`#pyv-child-${c.key} [name^="${prefix}"]`)
        .forEach((el) => {
          c.values[el.name.slice(prefix.length)] = el.value;
        });
    }
  }

  /**
   * Add a child by **appending** its row. Existing rows are never re-rendered,
   * so nothing a visitor typed into them can be lost (C82).
   */
  private addChild() {
    const row: ChildState = { key: this.childSeq++, values: {} };
    this.childRows.push(row);
    const container = this.root.querySelector<HTMLElement>("#pyv-children");
    if (!container) return;
    container.insertAdjacentHTML("beforeend", this.renderChild(row));
    this.root.querySelector<HTMLElement>(`[name="child-${row.key}-firstName"]`)?.focus();
  }

  /** Remove one child's row node; the others are untouched (C82). */
  private deleteChild(key: number) {
    this.syncChildren();
    this.childRows = this.childRows.filter((c) => c.key !== key);
    this.root.querySelector(`#pyv-child-${key}`)?.remove();
    this.root.querySelector<HTMLElement>('[data-action="add-child"]')?.focus();
  }

  /**
   * Congregation changed, so the age/grade groups did: rebuild each child's
   * group `<select>` options in place, keeping its selection when the group is
   * still offered. No row is re-rendered.
   */
  private refreshAgeGroupSelects() {
    this.syncChildren();
    for (const c of this.childRows) {
      const sel = this.root.querySelector<HTMLSelectElement>(`[name="child-${c.key}-ageGroup"]`);
      if (sel) sel.innerHTML = this.ageGroupOptions(c.values.dob ?? "", c.values.ageGroup ?? "");
    }
  }

  // ── Listeners ──

  private attachListeners() {
    const login = this.root.querySelector('[data-action="login"]');
    if (login) login.addEventListener("click", () => this.requestLogin("plan-your-visit"));

    const verForm = this.root.querySelector<HTMLFormElement>("#pyv-verify-form");
    if (verForm) {
      bindLiveValidation(verForm, { t: this.t });
      verForm.addEventListener("submit", (e) => {
        e.preventDefault();
        this.submitVerification(verForm);
      });
    }

    const detForm = this.root.querySelector<HTMLFormElement>("#pyv-details-form");
    if (detForm) {
      bindLiveValidation(detForm, { t: this.t, customValidators: this.phoneValidators() });
      detForm.addEventListener("submit", (e) => {
        e.preventDefault();
        this.submitDetails(detForm);
      });

      const cong = this.root.querySelector<HTMLSelectElement>('[name="congregationId"]');
      if (cong) {
        cong.addEventListener("change", async () => {
          await this.loadAgeGroups(Number(cong.value) || 0);
          this.refreshAgeGroupSelects();
        });
      }

      const addBtn = this.root.querySelector('[data-action="add-child"]');
      if (addBtn) {
        addBtn.addEventListener("click", (e) => {
          e.preventDefault();
          this.addChild();
        });
      }
      this.attachChildListeners();
    }
  }

  /**
   * Delegated once on the children container, so rows appended later need no
   * binding of their own (and existing rows are never bound twice).
   */
  private attachChildListeners() {
    const container = this.root.querySelector<HTMLElement>("#pyv-children");
    if (!container) return;
    container.addEventListener("click", (e) => {
      const btn = (e.target as Element | null)?.closest<HTMLElement>('[data-action="remove-child"]');
      if (!btn) return;
      e.preventDefault();
      this.deleteChild(Number(btn.getAttribute("data-child-key")));
    });
    // Re-sort a child's age/grade options when its DOB changes.
    container.addEventListener("change", (e) => {
      const el = e.target as HTMLInputElement | null;
      if (!el || el.getAttribute("data-role") !== "child-dob") return;
      const key = Number(el.getAttribute("data-child-key"));
      const sel = this.root.querySelector<HTMLSelectElement>(`[name="child-${key}-ageGroup"]`);
      if (sel) sel.innerHTML = this.ageGroupOptions(el.value, sel.value);
    });
  }

  private setButtonsDisabled(disabled: boolean) {
    this.root.querySelectorAll<HTMLButtonElement>(".pyv-submit").forEach((b) => (b.disabled = disabled));
  }

  private setMessage(type: string, text: string) {
    this.message = { type, text };
    const el = this.root.querySelector<HTMLElement>("#pyv-message");
    if (el) {
      el.className = `pyv-message pyv-message--${type}`;
      el.textContent = text;
      el.style.display = "";
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      this.render();
      this.attachListeners();
    }
  }

  // ── Render ──

  render() {
    // A full repaint rebuilds the child rows from `childRows`; snapshot them
    // first so a repaint can never cost a visitor what they typed (C82).
    this.syncChildren();
    if (this.loading) {
      this.root.innerHTML = `<div class="pyv">${this.stateBlock(this.spinnerSvg(), this.t("common.loading"))}</div>`;
      return;
    }
    this.root.innerHTML = `
      <div class="pyv">
        ${this.renderMessage()}
        ${this.mode === "verify" ? this.renderVerifyPhase() : this.renderInitialPhase()}
      </div>`;
  }

  private renderMessage(): string {
    if (!this.message) return `<div id="pyv-message" class="pyv-message" style="display:none"></div>`;
    return `<div id="pyv-message" class="pyv-message pyv-message--${this.escapeAttr(this.message.type)}">${this.escapeHtml(this.message.text)}</div>`;
  }

  private renderInitialPhase(): string {
    const signIn = this.contactExists
      ? `<div class="pyv-signin"><button type="button" class="pyv-btn pyv-btn--ghost" data-action="login">${this.escapeHtml(this.t("common.signIn"))}</button></div>`
      : "";
    return `
      <h2 class="pyv-title">${this.escapeHtml(this.t("planYourVisit.title"))}</h2>
      <p class="pyv-lead">${this.escapeHtml(this.t("planYourVisit.lead"))}</p>
      <form id="pyv-verify-form" class="pyv-form" novalidate>
        <div class="pyv-grid2">
          ${this.pf({ name: "firstName", label: this.t("fields.firstName"), required: true, autocomplete: "given-name" })}
          ${this.pf({ name: "lastName", label: this.t("fields.lastName"), required: true, autocomplete: "family-name" })}
        </div>
        ${this.pf({ name: "email", label: this.t("fields.email"), type: "email", required: true, autocomplete: "email" })}
        <div class="pyv-actions">
          <button type="submit" class="pyv-btn pyv-btn--primary pyv-submit">${this.escapeHtml(this.t("planYourVisit.sendVerification"))}</button>
        </div>
      </form>
      ${signIn}`;
  }

  private renderVerifyPhase(): string {
    if (!this.verify) {
      const text = this.t(
        this.verifyFailed === "exists"
          ? "planYourVisit.linkAccountExists"
          : "planYourVisit.linkInvalid"
      );
      const signIn =
        this.verifyFailed === "exists"
          ? `<div class="pyv-signin"><button type="button" class="pyv-btn pyv-btn--ghost" data-action="login">${this.escapeHtml(this.t("common.signIn"))}</button></div>`
          : "";
      return `<h2 class="pyv-title">${this.escapeHtml(this.t("planYourVisit.title"))}</h2><p class="pyv-lead">${this.escapeHtml(text)}</p>${signIn}`;
    }
    return this.renderDetailsForm();
  }

  private renderDetailsForm(): string {
    const v = this.verify!;
    const congOptions = [{ value: "", label: this.t("planYourVisit.selectCongregation") }].concat(
      this.config.congregations.map((c) => ({ value: String(c.id), label: c.name }))
    );

    return `
      <h2 class="pyv-title">${this.escapeHtml(this.t("planYourVisit.title"))}</h2>
      <p class="pyv-lead">${this.escapeHtml(this.t("planYourVisit.detailsLead"))}</p>
      <form id="pyv-details-form" class="pyv-form" novalidate>
        <h3 class="pyv-section">${this.escapeHtml(this.t("planYourVisit.visitDetails"))}</h3>
        ${this.pf({ name: "congregationId", label: this.t("fields.congregation"), type: "select", required: true, options: congOptions })}
        ${this.pf({ name: "whenCanWeExpectYou", label: this.t("planYourVisit.whenCanWeExpectYou"), required: true })}

        <h3 class="pyv-section">${this.escapeHtml(this.t("planYourVisit.yourDetails"))}</h3>
        <div class="pyv-grid2">
          ${this.pf({ name: "headFirstName", label: this.t("fields.firstName"), required: true, autocomplete: "given-name", value: v.firstName || "" })}
          ${this.pf({ name: "headLastName", label: this.t("fields.lastName"), required: true, autocomplete: "family-name", value: v.lastName || "" })}
        </div>
        <div class="pyv-grid2">
          ${this.pf({ name: "headEmail", label: this.t("fields.email"), type: "email", value: v.email || "", inputClass: "pyv-input pyv-readonly", attrs: { readonly: true } })}
          ${this.phoneField("headMobilePhone", true)}
        </div>
        ${this.renderAddress()}

        <h3 class="pyv-section">${this.escapeHtml(this.t("planYourVisit.familyMembers"))}</h3>
        ${this.renderSpouse()}
        <div id="pyv-children">${this.childRows.map((c) => this.renderChild(c)).join("")}</div>
        <div class="pyv-add-child"><button type="button" class="pyv-link" data-action="add-child">+ ${this.escapeHtml(this.t("planYourVisit.addChild"))}</button></div>

        ${this.hiddenMilestones()}
        <div class="pyv-actions">
          <button type="submit" class="pyv-btn pyv-btn--primary pyv-submit">${this.escapeHtml(this.t("common.submit"))}</button>
        </div>
      </form>`;
  }

  private renderSpouse(): string {
    return `
      <fieldset class="pyv-fieldset">
        <legend>${this.escapeHtml(this.t("planYourVisit.spouse"))}</legend>
        ${this.pf({ name: "spouseFirstName", label: this.t("fields.firstName") })}
        <div class="pyv-grid2">
          ${this.pf({ name: "spouseEmail", label: this.t("fields.email"), type: "email" })}
          ${this.phoneField("spousePhone", false)}
        </div>
      </fieldset>`;
  }

  private renderChild(c: ChildState): string {
    const v = c.values;
    const name = (f: string) => `child-${c.key}-${f}`;
    // The gender and age/grade *values* come from MP and stay as MP supplies
    // them; the empty first option is the widget's own placeholder.
    const genderOptions = [{ value: "", label: this.t("fields.gender") }].concat(
      this.config.genders.map((g) => ({ value: String(g.id), label: g.name }))
    );
    return `
      <fieldset class="pyv-fieldset" id="pyv-child-${c.key}">
        <legend>${this.escapeHtml(this.t("planYourVisit.child"))} <button type="button" class="pyv-remove" data-action="remove-child" data-child-key="${c.key}" aria-label="${this.escapeAttr(this.t("planYourVisit.removeChild"))}">&times;</button></legend>
        <div class="pyv-grid2">
          ${this.pf({ name: name("firstName"), label: this.t("fields.firstName"), required: true, value: v.firstName })}
          ${this.pf({ name: name("lastName"), label: this.t("fields.lastName"), required: true, value: v.lastName ?? this.verify?.lastName ?? "" })}
        </div>
        <div class="pyv-grid2">
          ${this.pf({ name: name("dob"), label: this.t("fields.dateOfBirth"), type: "date", required: true, value: v.dob, attrs: { "data-role": "child-dob", "data-child-key": c.key } })}
          ${this.pf({ name: name("gender"), label: this.t("fields.gender"), type: "select", value: v.gender ?? "", options: genderOptions })}
        </div>
        <div class="pyv-field" data-mpx-field>
          <label for="${fieldId(name("ageGroup"), this.instanceId)}">${this.escapeHtml(this.t("planYourVisit.ageOrGradeGroup"))}</label>
          <select id="${fieldId(name("ageGroup"), this.instanceId)}" class="pyv-input" name="${name("ageGroup")}">${this.ageGroupOptions(v.dob ?? "", v.ageGroup ?? "")}</select>
        </div>
      </fieldset>`;
  }

  /** Age/grade `<option>`s, nearest to the child's age first, keeping `selected`. */
  private ageGroupOptions(dob: string, selected = ""): string {
    const groups = dob ? this.sortAgeGroups([...this.ageGroups], dob) : this.ageGroups;
    return [
      `<option value="">${this.escapeHtml(this.t("planYourVisit.selectGroup"))}</option>`,
    ]
      .concat(
        groups.map(
          (g) =>
            `<option value="${g.id}"${String(g.id) === selected ? " selected" : ""}>${this.escapeHtml(g.value)}</option>`
        )
      )
      .join("");
  }

  /** Port of the legacy sort: nearest promote-age to the child's age first. */
  private sortAgeGroups(groups: AgeGroup[], dob: string): AgeGroup[] {
    const age = this.monthsBetween(new Date(dob), new Date());
    return groups.sort((a, b) => {
      const da = (a.ageInMonthsToPromote ?? 0) - age;
      const db = (b.ageInMonthsToPromote ?? 0) - age;
      if (da < 0 || db < 0) return db - da;
      return da - db;
    });
  }

  private monthsBetween(a: Date, b: Date): number {
    if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
    return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  }

  private renderAddress(): string {
    if (!this.collectAddress) return "";
    // Default to the United States entry, chosen once: a name regex alone also
    // marks "United States Minor Outlying Islands" selected, and the browser
    // then keeps the *last* selected option.
    const countries = this.config.countries;
    const us =
      countries.find((c) => c.code.toUpperCase() === "US") ??
      countries.find((c) => /^united states/i.test(c.name));
    const countryOptions = [{ value: "", label: this.t("fields.country") }].concat(
      countries.map((c) => ({ value: c.code, label: c.name }))
    );
    return `
      <h3 class="pyv-section">${this.escapeHtml(this.t("fields.address"))}</h3>
      ${this.pf({ name: "addressLine1", label: this.t("fields.address"), required: true, autocomplete: "address-line1" })}
      <div class="pyv-grid2">
        ${this.pf({ name: "addressCity", label: this.t("fields.city"), required: true, autocomplete: "address-level2" })}
        ${this.pf({ name: "addressState", label: this.t("planYourVisit.stateProvince"), required: true, autocomplete: "address-level1" })}
      </div>
      <div class="pyv-grid2">
        ${this.pf({ name: "addressPostal", label: this.t("planYourVisit.zipPostalCode"), required: true, autocomplete: "postal-code" })}
        ${this.pf({ name: "addressCountry", label: this.t("fields.country"), type: "select", autocomplete: "country", value: us?.code ?? "", options: countryOptions })}
      </div>`;
  }

  /** `field()` with this widget's id prefix and classes (C28). */
  private pf(opts: FieldOptions): string {
    return field({ idPrefix: this.instanceId, wrapperClass: "pyv-field", inputClass: "pyv-input", ...opts });
  }

  private hiddenMilestones(): string {
    const milestone = this.getAttribute("milestone-to-assign-id") || "";
    const program = this.getAttribute("milestone-program-id") || "";
    return `
      <input type="hidden" name="__milestoneToAssignId" value="${this.escapeAttr(milestone)}">
      <input type="hidden" name="__milestoneProgramId" value="${this.escapeAttr(program)}">`;
  }

  /**
   * A phone control: `type="tel"` (keypad, `autocomplete="tel"`) with MP's
   * display mask as the placeholder only. **Never a `pattern`**: see
   * `isPlausiblePhone` and C24.
   */
  private phoneField(name: string, required: boolean): string {
    return field({
      name,
      label: this.t("fields.mobilePhone"),
      type: "tel",
      required,
      placeholder: this.config.phoneMask || undefined,
      idPrefix: this.instanceId,
      wrapperClass: "pyv-field",
      inputClass: "pyv-input",
    });
  }

  private stateBlock(icon: string, text: string): string {
    return `<div class="pyv-state">${icon}<span>${this.escapeHtml(text)}</span></div>`;
  }

  // ── Text helpers ──

  private escapeHtml(text: string): string {
    const el = document.createElement("span");
    el.textContent = text;
    return el.innerHTML;
  }
  private escapeAttr(text: string): string {
    return this.escapeHtml(text).replace(/"/g, "&quot;");
  }

  private spinnerSvg(): string {
    return `<svg class="pyv-spinner" viewBox="0 0 24 24" fill="none" width="20" height="20">
      <circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
      <path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
    </svg>`;
  }

  private getStyles(): string {
    return `
      :host { all: initial; display: block; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color: #2D2926; }
      .pyv { max-width: 640px; margin: 0 auto; }
      .pyv-title { font-size: 24px; font-weight: 800; color: #002855; margin: 0 0 6px; }
      .pyv-lead { font-size: 15px; color: #474747; margin: 0 0 18px; line-height: 1.5; }
      .pyv-section { font-size: 15px; font-weight: 700; color: #002855; margin: 20px 0 10px; padding-bottom: 6px; border-bottom: 1px solid #e5e7eb; }

      .pyv-message { padding: 12px 16px; border-radius: 8px; font-size: 14px; margin-bottom: 16px; }
      .pyv-message--success { background: #ecf6e0; color: #4d6b1f; }
      .pyv-message--warning { background: #fdf6e3; color: #8a6d3b; }
      .pyv-message--info { background: #e6f6fc; color: #015a7a; }
      .pyv-message--danger { background: #ffe9e9; color: #b91c1c; }

      .pyv-form { background: white; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
      .pyv-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
      .pyv-field label { font-size: 13px; font-weight: 600; color: #6b7280; }
      .pyv-input { padding: 9px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; font-family: inherit; color: #2D2926; background: white; outline: none; }
      .pyv-input:focus { border-color: #004C97; box-shadow: 0 0 0 1px #004C97; }
      .pyv-readonly { background: #f3f4f6; color: #6b7280; }
      .pyv-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

      .pyv-fieldset { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px 4px; margin: 0 0 12px; }
      .pyv-fieldset legend { font-size: 13px; font-weight: 700; color: #002855; padding: 0 6px; display: flex; align-items: center; gap: 8px; }
      .pyv-remove { background: none; border: none; color: #FF6D6A; font-size: 18px; line-height: 1; cursor: pointer; padding: 0 4px; }

      .pyv-add-child { margin-bottom: 12px; }
      .pyv-link { background: none; border: none; color: #004C97; font-weight: 600; font-size: 14px; cursor: pointer; font-family: inherit; padding: 0; }
      .pyv-link:hover { text-decoration: underline; }

      .pyv-actions { margin-top: 8px; }
      .pyv-signin { margin-top: 12px; }
      .pyv-btn { padding: 10px 18px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; border: none; }
      .pyv-btn--primary { background: #004C97; color: white; }
      .pyv-btn--primary:hover { background: #002855; }
      .pyv-btn--ghost { background: white; color: #004C97; border: 1px solid #004C97; }
      .pyv-btn--ghost:hover { background: #f0f6fc; }
      .pyv-btn:disabled { opacity: 0.5; cursor: not-allowed; }

      .pyv-state { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 48px 16px; color: #6b7280; font-size: 15px; }
      .pyv-spinner { animation: pyv-spin 1s linear infinite; color: #004C97; }
      @keyframes pyv-spin { to { transform: rotate(360deg); } }

      @media (max-width: 640px) { .pyv-grid2 { grid-template-columns: 1fr; } }
    `;
  }
}

customElements.define("next-plan-your-visit", PlanYourVisitWidget);
