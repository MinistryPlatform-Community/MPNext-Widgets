import { MPNextWidget } from "../shared/base-widget";
import {
  validateForm,
  bindLiveValidation,
  requiredStar,
  FORM_VALIDATION_STYLES,
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
  phoneMask: string | null;
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
interface ChildState {
  key: number;
  dob: string;
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
 *  - Phone-mask config is fetched but applied only as an input hint.
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
      "collect-address",
      "milestone-to-assign-id",
      "milestone-program-id",
      "verify-param-name",
    ];
  }

  connectedCallback() {
    this.injectStyles(this.getStyles() + FORM_VALIDATION_STYLES);
    this.render();
    this.init();
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
        text: err instanceof Error ? err.message : "Something went wrong.",
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
    const sel = this.root.querySelector<HTMLSelectElement>("#pyv-congregation");
    if (sel && sel.value) return Number(sel.value);
    return this.config.congregations[0]?.id ?? 0;
  }

  // ── Step 1: verification email ──

  private async submitVerification(form: HTMLFormElement) {
    if (!validateForm(form).valid) return;
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
        this.setMessage("warning", data.message || "An account already exists for that email.");
        this.render();
        this.attachListeners();
        return;
      }
      if (!data.success) {
        this.setMessage("danger", data.message || "We couldn't send the verification email.");
        this.setButtonsDisabled(false);
        return;
      }

      this.emit("verificationSent", { email: payload.email });
      this.setMessage("success", "Check your email — we've sent you a link to finish planning your visit.");
      form.reset();
    } catch (err) {
      this.setMessage("danger", err instanceof Error ? err.message : "Submission failed.");
    } finally {
      this.setButtonsDisabled(false);
    }
  }

  // ── Step 2: visit details ──

  private async submitDetails(form: HTMLFormElement) {
    if (!validateForm(form).valid) {
      this.setMessage("warning", "Please complete the required fields.");
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
        this.setMessage("danger", data.message || "We couldn't save your information.");
        this.setButtonsDisabled(false);
        return;
      }
      this.emit("visitPlanned", { email: this.verify.email });
      this.setMessage("success", "Thank you! Your visit details have been received. We can't wait to meet you.");
      this.hideDetailsForm();
    } catch (err) {
      this.setMessage("danger", err instanceof Error ? err.message : "Submission failed.");
      this.setButtonsDisabled(false);
    }
  }

  private hideDetailsForm() {
    const form = this.root.querySelector<HTMLElement>("#pyv-details-form");
    if (form) form.style.display = "none";
  }

  // ── Children state ──

  private syncChildren() {
    for (const c of this.childRows) {
      const dob = this.root.querySelector<HTMLInputElement>(`[name="child-${c.key}-dob"]`);
      if (dob) c.dob = dob.value;
    }
  }

  private addChild() {
    this.syncChildren();
    this.childRows.push({ key: this.childSeq++, dob: "" });
    this.renderChildren();
  }

  private deleteChild(key: number) {
    this.syncChildren();
    this.childRows = this.childRows.filter((c) => c.key !== key);
    this.renderChildren();
  }

  /** Re-render just the children container (preserves the rest of the form). */
  private renderChildren() {
    const container = this.root.querySelector<HTMLElement>("#pyv-children");
    if (!container) return;
    container.innerHTML = this.childRows.map((c) => this.renderChild(c)).join("");
    this.attachChildListeners();
  }

  // ── Listeners ──

  private attachListeners() {
    const login = this.root.querySelector('[data-action="login"]');
    if (login) login.addEventListener("click", () => this.emit("loginRequired"));

    const verForm = this.root.querySelector<HTMLFormElement>("#pyv-verify-form");
    if (verForm) {
      bindLiveValidation(verForm);
      verForm.addEventListener("submit", (e) => {
        e.preventDefault();
        this.submitVerification(verForm);
      });
    }

    const detForm = this.root.querySelector<HTMLFormElement>("#pyv-details-form");
    if (detForm) {
      bindLiveValidation(detForm);
      detForm.addEventListener("submit", (e) => {
        e.preventDefault();
        this.submitDetails(detForm);
      });

      const cong = this.root.querySelector<HTMLSelectElement>("#pyv-congregation");
      if (cong) {
        cong.addEventListener("change", async () => {
          await this.loadAgeGroups(Number(cong.value) || 0);
          this.renderChildren();
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

  private attachChildListeners() {
    this.root.querySelectorAll<HTMLElement>('[data-action="remove-child"]').forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        this.deleteChild(Number(el.getAttribute("data-child-key")));
      });
    });
    // Re-sort a child's age/grade options when its DOB changes.
    this.root.querySelectorAll<HTMLInputElement>('[data-role="child-dob"]').forEach((el) => {
      el.addEventListener("change", () => {
        const key = Number(el.getAttribute("data-child-key"));
        const sel = this.root.querySelector<HTMLSelectElement>(`[name="child-${key}-ageGroup"]`);
        if (sel) sel.innerHTML = this.ageGroupOptions(el.value);
      });
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
    if (this.loading) {
      this.root.innerHTML = `<div class="pyv">${this.stateBlock(this.spinnerSvg(), "Loading…")}</div>`;
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
      ? `<div class="pyv-signin"><button type="button" class="pyv-btn pyv-btn--ghost" data-action="login">Sign In</button></div>`
      : "";
    return `
      <h2 class="pyv-title">Plan Your Visit</h2>
      <p class="pyv-lead">Tell us a little about you and we'll email you a link to finish planning your first visit.</p>
      <form id="pyv-verify-form" class="pyv-form" novalidate>
        <div class="pyv-grid2">
          <div class="pyv-field"><label>First Name${requiredStar()}</label><input class="pyv-input" name="firstName" required></div>
          <div class="pyv-field"><label>Last Name${requiredStar()}</label><input class="pyv-input" name="lastName" required></div>
        </div>
        <div class="pyv-field"><label>Email${requiredStar()}</label><input class="pyv-input" type="email" name="email" required></div>
        <div class="pyv-actions">
          <button type="submit" class="pyv-btn pyv-btn--primary pyv-submit">Send Verification Email</button>
        </div>
      </form>
      ${signIn}`;
  }

  private renderVerifyPhase(): string {
    if (!this.verify) {
      const text =
        this.verifyFailed === "exists"
          ? "An account already exists for this email. Please sign in instead."
          : "This link is invalid or has expired. Please start again.";
      const signIn =
        this.verifyFailed === "exists"
          ? `<div class="pyv-signin"><button type="button" class="pyv-btn pyv-btn--ghost" data-action="login">Sign In</button></div>`
          : "";
      return `<h2 class="pyv-title">Plan Your Visit</h2><p class="pyv-lead">${this.escapeHtml(text)}</p>${signIn}`;
    }
    return this.renderDetailsForm();
  }

  private renderDetailsForm(): string {
    const v = this.verify!;
    const congOptions = this.config.congregations
      .map((c) => `<option value="${c.id}">${this.escapeHtml(c.name)}</option>`)
      .join("");

    return `
      <h2 class="pyv-title">Plan Your Visit</h2>
      <p class="pyv-lead">Please fill out the information below so we can make your visit special.</p>
      <form id="pyv-details-form" class="pyv-form" novalidate>
        <h3 class="pyv-section">Visit Details</h3>
        <div class="pyv-field">
          <label for="pyv-congregation">Congregation${requiredStar()}</label>
          <select id="pyv-congregation" class="pyv-input" name="congregationId" required>
            <option value="">Select a congregation</option>
            ${congOptions}
          </select>
        </div>
        <div class="pyv-field"><label>When can we expect you?${requiredStar()}</label><input class="pyv-input" name="whenCanWeExpectYou" required></div>

        <h3 class="pyv-section">Your Details</h3>
        <div class="pyv-grid2">
          <div class="pyv-field"><label>First Name${requiredStar()}</label><input class="pyv-input" name="headFirstName" value="${this.escapeAttr(v.firstName || "")}" required></div>
          <div class="pyv-field"><label>Last Name${requiredStar()}</label><input class="pyv-input" name="headLastName" value="${this.escapeAttr(v.lastName || "")}" required></div>
        </div>
        <div class="pyv-grid2">
          <div class="pyv-field"><label>Email</label><input class="pyv-input pyv-readonly" type="email" value="${this.escapeAttr(v.email || "")}" readonly></div>
          <div class="pyv-field"><label>Mobile Phone${requiredStar()}</label><input class="pyv-input" type="tel" name="headMobilePhone" ${this.phonePattern()} required></div>
        </div>
        ${this.renderAddress()}

        <h3 class="pyv-section">Additional Family Members</h3>
        ${this.renderSpouse()}
        <div id="pyv-children">${this.childRows.map((c) => this.renderChild(c)).join("")}</div>
        <div class="pyv-add-child"><button type="button" class="pyv-link" data-action="add-child">+ Add child</button></div>

        ${this.hiddenMilestones()}
        <div class="pyv-actions">
          <button type="submit" class="pyv-btn pyv-btn--primary pyv-submit">Submit</button>
        </div>
      </form>`;
  }

  private renderSpouse(): string {
    return `
      <fieldset class="pyv-fieldset">
        <legend>Spouse</legend>
        <div class="pyv-field"><label>First Name</label><input class="pyv-input" name="spouseFirstName"></div>
        <div class="pyv-grid2">
          <div class="pyv-field"><label>Email</label><input class="pyv-input" type="email" name="spouseEmail"></div>
          <div class="pyv-field"><label>Mobile Phone</label><input class="pyv-input" type="tel" name="spousePhone" ${this.phonePattern()}></div>
        </div>
      </fieldset>`;
  }

  private renderChild(c: ChildState): string {
    const genderOptions = [`<option value="">Gender</option>`]
      .concat(this.config.genders.map((g) => `<option value="${g.id}">${this.escapeHtml(g.name)}</option>`))
      .join("");
    return `
      <fieldset class="pyv-fieldset" id="pyv-child-${c.key}">
        <legend>Child <button type="button" class="pyv-remove" data-action="remove-child" data-child-key="${c.key}" aria-label="Remove child">&times;</button></legend>
        <div class="pyv-grid2">
          <div class="pyv-field"><label>First Name${requiredStar()}</label><input class="pyv-input" name="child-${c.key}-firstName" required></div>
          <div class="pyv-field"><label>Last Name${requiredStar()}</label><input class="pyv-input" name="child-${c.key}-lastName" value="${this.escapeAttr(this.verify?.lastName || "")}" required></div>
        </div>
        <div class="pyv-grid2">
          <div class="pyv-field"><label>Date of Birth${requiredStar()}</label><input class="pyv-input" type="date" name="child-${c.key}-dob" data-role="child-dob" data-child-key="${c.key}" value="${this.escapeAttr(c.dob || "")}" required></div>
          <div class="pyv-field"><label>Gender</label><select class="pyv-input" name="child-${c.key}-gender">${genderOptions}</select></div>
        </div>
        <div class="pyv-field"><label>Age or Grade Group</label><select class="pyv-input" name="child-${c.key}-ageGroup">${this.ageGroupOptions(c.dob)}</select></div>
      </fieldset>`;
  }

  private ageGroupOptions(dob: string): string {
    const groups = dob ? this.sortAgeGroups([...this.ageGroups], dob) : this.ageGroups;
    return [`<option value="">Select a group</option>`]
      .concat(groups.map((g) => `<option value="${g.id}">${this.escapeHtml(g.value)}</option>`))
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
    const countryOptions = [`<option value="">Country</option>`]
      .concat(
        this.config.countries.map(
          (c) =>
            `<option value="${this.escapeAttr(c.code)}" ${/united states/i.test(c.name) ? "selected" : ""}>${this.escapeHtml(c.name)}</option>`
        )
      )
      .join("");
    return `
      <h3 class="pyv-section">Address</h3>
      <div class="pyv-field"><label>Address${requiredStar()}</label><input class="pyv-input" name="addressLine1" required></div>
      <div class="pyv-grid2">
        <div class="pyv-field"><label>City${requiredStar()}</label><input class="pyv-input" name="addressCity" required></div>
        <div class="pyv-field"><label>State / Province${requiredStar()}</label><input class="pyv-input" name="addressState" required></div>
      </div>
      <div class="pyv-grid2">
        <div class="pyv-field"><label>Zip / Postal Code${requiredStar()}</label><input class="pyv-input" name="addressPostal" required></div>
        <div class="pyv-field"><label>Country</label><select class="pyv-input" name="addressCountry">${countryOptions}</select></div>
      </div>`;
  }

  private hiddenMilestones(): string {
    const milestone = this.getAttribute("milestone-to-assign-id") || "";
    const program = this.getAttribute("milestone-program-id") || "";
    return `
      <input type="hidden" name="__milestoneToAssignId" value="${this.escapeAttr(milestone)}">
      <input type="hidden" name="__milestoneProgramId" value="${this.escapeAttr(program)}">`;
  }

  private phonePattern(): string {
    const mask = this.config.phoneMask;
    return mask ? `pattern="${this.escapeAttr(mask)}"` : "";
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
