import { MPNextWidget } from "../shared/base-widget";
import {
  validateForm,
  bindLiveValidation,
  requiredStar,
  FORM_VALIDATION_STYLES,
} from "../shared/form-validation";

// ─────────────────────────────────────────────────────────────────────────
// Local type declarations (mirrors @mpnext/types pledge-campaign.ts — this
// package does not import that workspace package, so the shapes are redeclared
// here, matching the convention used by the other widgets).
// ─────────────────────────────────────────────────────────────────────────

interface PledgeCampaign {
  pledgeCampaignId: number;
  title: string;
  description: string | null;
  imageUrl: string | null;
  campaignGoal: number;
  fundraisingGoal: number | null;
  pledged: number;
  received: number;
  numberOfPledges: number;
  startDate: string;
  endDate: string | null;
  allowOnlinePledge: boolean;
  pledgeBeyondEndDate: boolean;
  onlineThankYouMessage: string | null;
  forceLogin: boolean;
  eventId: number | null;
  customFormId: number | null;
  customFormGuid: string | null;
}

interface PledgeFrequency {
  id: number;
  name: string;
}

interface BasicContact {
  contactId: number;
  firstName: string | null;
  lastName: string | null;
  emailAddress: string | null;
  mobilePhoneNumber: string | null;
  householdId: number | null;
}

interface HouseholdMemberLite {
  contactId: number;
  firstName: string;
  lastName: string;
  nickName: string | null;
  displayName: string | null;
  emailAddress: string | null;
  mobilePhoneNumber: string | null;
}

const CURRENCY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/**
 * `next-pledge-campaign` — campaign progress display + make-a-pledge form.
 *
 * Ported from the legacy `mpp-pledge-campaign` portal widget. Shows the
 * campaign image/title/description and a pledged/received progress bar, then an
 * authenticated or anonymous pledge form: suggested-amount buttons, an
 * installment amount, frequency, first/last installment dates, a live-computed
 * total, an optional "Make a Pledge As" household picker, and a blank-form
 * contact block for anonymous pledges.
 *
 * Simplifications relative to legacy (noted inline):
 *  - Confirmation email is sent server-side (best-effort); no client send.
 *  - The campaign custom form is not rendered (the legacy pledge widget didn't
 *    render it either; it lives on the event-registration path).
 */
export class PledgeCampaignWidget extends MPNextWidget {
  private campaign: PledgeCampaign | null = null;
  private frequencies: PledgeFrequency[] = [];

  private loading = true;
  private error: string | null = null;
  private message: { type: string; text: string } | null = null;

  private isAuthenticated = false;
  private contact: BasicContact | null = null;
  private householdMembers: HouseholdMemberLite[] = [];
  private userHasAlreadyPledged = false;

  // Submitted-pledge state: after a successful save the form fields collapse and
  // the submit button becomes a "Create Another Pledge" reset.
  private submitted = false;

  // Computed installment plan, refreshed by recalcTotal() and sent on submit.
  private totalPledge = 0;
  private installmentsPlanned = 0;
  private installmentsPerYear = 0;

  static get observedAttributes() {
    return [
      "api-host",
      "campaign-id",
      "id-parameter-name",
      "pledge-email-template",
      "suggested-amounts",
    ];
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null) {
    if (oldValue === newValue) return;
    if (name === "campaign-id" && this.campaign) {
      this.init();
    }
  }

  connectedCallback() {
    this.injectStyles(this.getStyles() + FORM_VALIDATION_STYLES);
    this.render();
    this.init();
  }

  /** Re-run the load — exposed so the demo page can refresh on sign-in. */
  public retryLoad() {
    this.init();
  }

  // ── Attribute helpers ───────────────────────────────────────────────────

  private get idParam(): string {
    return this.getAttribute("id-parameter-name") || "id";
  }
  private get pledgeEmailTemplate(): string {
    return (this.getAttribute("pledge-email-template") || "").trim();
  }
  private get suggestedAmountsAttr(): string | null {
    return this.getAttribute("suggested-amounts");
  }

  private resolveCampaignId(): string {
    const attr = this.getAttribute("campaign-id");
    if (attr) return attr;
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get(this.idParam) || params.get("id") || "";
    } catch {
      return "";
    }
  }

  // ── Init / load ─────────────────────────────────────────────────────────

  private async init() {
    this.loading = true;
    this.error = null;
    this.message = null;
    this.campaign = null;
    this.frequencies = [];
    this.contact = null;
    this.householdMembers = [];
    this.isAuthenticated = false;
    this.userHasAlreadyPledged = false;
    this.submitted = false;
    this.totalPledge = 0;
    this.installmentsPlanned = 0;
    this.installmentsPerYear = 0;
    this.render();

    const campaignId = this.resolveCampaignId();
    if (!campaignId) {
      this.error = "No pledge campaign specified.";
      this.loading = false;
      this.render();
      this.attachListeners();
      this.emit("pledgeCampaignError", { error: this.error });
      return;
    }

    try {
      // 1. Identify the user (drives household picker + already-pledged warning).
      await this.loadBasicContact();

      // 2. Load campaign + frequencies (+ household members when signed in).
      const [campaignRes, frequenciesRes] = await Promise.all([
        this.fetch(`/api/embed/pledge-campaign/${encodeURIComponent(campaignId)}`),
        this.fetch(`/api/embed/pledge-campaign/frequencies`),
        this.isAuthenticated ? this.loadHousehold() : Promise.resolve(),
      ]);

      if (!campaignRes.ok) {
        if (campaignRes.status === 404) throw new Error("Pledge campaign not found.");
        throw new Error(`HTTP ${campaignRes.status}`);
      }
      const data: { campaign: PledgeCampaign; userHasAlreadyPledged: boolean } =
        await campaignRes.json();
      this.campaign = data.campaign;
      this.userHasAlreadyPledged = !!data.userHasAlreadyPledged;

      if (frequenciesRes.ok) {
        const fd: { frequencies: PledgeFrequency[] } = await frequenciesRes.json();
        this.frequencies = fd.frequencies || [];
      }

      this.loading = false;
      this.evaluateCampaignState();
      this.emit("pledgeCampaignLoaded", {
        campaignId: this.campaign.pledgeCampaignId,
        title: this.campaign.title,
      });
    } catch (err) {
      this.error = err instanceof Error ? err.message : "No pledge campaign found.";
      this.campaign = null;
      this.loading = false;
      this.render();
      this.attachListeners();
      this.emit("pledgeCampaignError", { error: this.error });
      return;
    }

    this.render();
    this.attachListeners();
  }

  private async loadBasicContact() {
    try {
      const res = await this.fetch(`/api/embed/pledge-campaign/basic-contact`);
      if (!res.ok) {
        this.isAuthenticated = false;
        this.contact = null;
        return;
      }
      const data: { contact: BasicContact } = await res.json();
      this.contact = data.contact ?? null;
      this.isAuthenticated = !!this.contact;
    } catch {
      this.isAuthenticated = false;
      this.contact = null;
    }
  }

  /** Load the signed-in user's household members for the "Make a Pledge As" picker. */
  private async loadHousehold() {
    try {
      const res = await this.fetch(`/api/embed/household`);
      if (!res.ok) return;
      const data: { members?: HouseholdMemberLite[] } = await res.json();
      this.householdMembers = data.members ?? [];
    } catch {
      this.householdMembers = [];
    }
  }

  /** Set warning messages for a campaign that is closed / already pledged. */
  private evaluateCampaignState() {
    const c = this.campaign;
    if (!c) return;
    if (!this.isAcceptingPledges()) {
      this.message = {
        type: "warning",
        text: "This Campaign is no longer accepting new Pledges.",
      };
    } else if (this.userHasAlreadyPledged) {
      this.message = {
        type: "warning",
        text: "You have already made a Pledge for this Campaign. Please ensure you want to pledge again.",
      };
    }
  }

  private isAcceptingPledges(): boolean {
    const c = this.campaign;
    if (!c || !c.allowOnlinePledge) return false;
    if (c.endDate) {
      const end = this.parseMpDate(c.endDate);
      if (end && Date.now() > end.getTime()) return false;
    }
    return true;
  }

  // ── Submit ────────────────────────────────────────────────────────────

  private async submit() {
    const form = this.root.querySelector<HTMLFormElement>("#pc-form");
    if (!form) return;

    if (!validateForm(form).valid) {
      this.setMessage("warning", "Please complete the pledge campaign form.");
      return;
    }

    // Recompute the plan from the current inputs before reading it.
    this.recalcTotal();

    const last = this.fieldValue("#pc-last-installment");
    if (this.pastCampaignEndDate(last)) {
      const end = this.campaign?.endDate
        ? this.formatShortDate(this.campaign.endDate)
        : "";
      this.setMessage(
        "danger",
        `You cannot give past the campaign end date${end ? ` (${end})` : ""}.`
      );
      return;
    }

    const contactIdRaw = this.fieldValue("#pc-contact-id") || "0";
    const payload = {
      pledgeCampaignId: this.campaign!.pledgeCampaignId,
      pledgeEmailTemplateId: this.pledgeEmailTemplate
        ? Number(this.pledgeEmailTemplate)
        : undefined,
      contactId: Number(contactIdRaw) || 0,
      firstName: this.fieldValue("#pc-first-name"),
      lastName: this.fieldValue("#pc-last-name"),
      email: this.fieldValue("#pc-email"),
      mobilePhoneNumber: this.fieldValue("#pc-phone"),
      installmentAmount: this.numberValue("#pc-installment-amount"),
      frequency: this.numberValue("#pc-frequency") || 1,
      firstInstallmentDate: this.fieldValue("#pc-first-installment"),
      lastInstallmentDate: last || null,
      installmentsPlanned: this.installmentsPlanned,
      installmentsPerYear: this.installmentsPerYear,
      totalPledge: this.totalPledge,
    };

    this.setSubmitDisabled(true);
    try {
      const res = await this.fetch(`/api/embed/pledge-campaign/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data: { success: boolean; pledgeId: number | null; message?: string } =
        await res.json().catch(() => ({ success: false, pledgeId: null }));

      if (!data.success) {
        const msg = data.message || "Unable to save your pledge.";
        this.setMessage("danger", msg);
        this.emit("pledgeError", { error: msg });
        this.setSubmitDisabled(false);
        return;
      }

      const displayName = this.getDisplayName(payload.firstName, payload.lastName);
      const thankYou =
        this.campaign?.onlineThankYouMessage?.trim() ||
        `Thank you! Your response for ${displayName} has been received. If desired, click the button below to respond for another household member.`;

      this.submitted = true;
      this.emit("pledgeSaved", { pledgeId: data.pledgeId });
      this.render();
      this.attachListeners();
      this.setMessage("success", thankYou);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Pledge save failed.";
      this.setMessage("danger", msg);
      this.emit("pledgeError", { error: msg });
      this.setSubmitDisabled(false);
    }
  }

  private setSubmitDisabled(disabled: boolean) {
    const btn = this.root.querySelector<HTMLButtonElement>("#pc-submit");
    if (btn) btn.disabled = disabled;
  }

  private getDisplayName(firstName: string, lastName: string): string {
    const select = this.root.querySelector<HTMLSelectElement>("#pc-apply-as");
    if (select && select.selectedIndex > 0) {
      const text = select.options[select.selectedIndex]?.text ?? "";
      if (text.trim()) return text.replace(/,/g, "").trim();
    }
    return `${firstName} ${lastName}`.trim() || "your household";
  }

  // ── Total / installment math (port of CalculateTotalPledge) ─────────────

  private recalcTotal() {
    const amount = this.numberValue("#pc-installment-amount");
    const frequency = this.numberValue("#pc-frequency") || 1;
    const first = this.fieldValue("#pc-first-installment");
    const last = this.fieldValue("#pc-last-installment");

    if (!last) {
      this.useOneTime(amount);
    } else {
      switch (frequency) {
        case 1:
          this.useOneTime(amount);
          break;
        case 2: {
          // Annually
          const n = this.yearsBetween(first, last) + 1;
          this.setPlan(amount * n, n, 1);
          break;
        }
        case 12: {
          // Monthly
          const months = this.monthsBetween(first, last);
          this.setPlan(amount * months, months, Math.min(months, 12));
          break;
        }
        case 24: {
          // Twice per month
          const count = this.monthsBetween(first, last) * 2;
          this.setPlan(amount * count, count, Math.min(count, 24));
          break;
        }
        case 26: {
          // Every other week
          const count = Math.floor(this.weeksBetween(first, last) / 2);
          this.setPlan(amount * count, count, Math.min(count, 26));
          break;
        }
        case 52: {
          // Weekly
          const count = this.weeksBetween(first, last);
          this.setPlan(amount * count, count, Math.min(count, 52));
          break;
        }
        default:
          this.setPlan(0, 0, 0);
          break;
      }
    }

    const display = this.root.querySelector<HTMLElement>("#pc-total-value");
    if (display) display.textContent = CURRENCY.format(this.totalPledge);
  }

  private useOneTime(amount: number) {
    this.setPlan(amount, 1, 1);
  }

  private setPlan(total: number, planned: number, perYear: number) {
    this.totalPledge = Number(Math.max(0, total).toFixed(2));
    this.installmentsPlanned = planned;
    this.installmentsPerYear = perYear;
  }

  private orderDates(start: string, end: string): [Date, Date] {
    let sd = (start && this.parseMpDate(start)) || new Date();
    let ed = (end && this.parseMpDate(end)) || new Date();
    if (ed.getTime() < sd.getTime()) [sd, ed] = [ed, sd];
    return [sd, ed];
  }

  private weeksBetween(start: string, end: string): number {
    const [sd, ed] = this.orderDates(start, end);
    const WEEK = 7 * 24 * 60 * 60 * 1000;
    return Math.floor((ed.getTime() - sd.getTime()) / WEEK) + 1;
  }

  /** Port of DateTimeFormatter.GetTotalMonthsBetweenDates (inclusive of end month). */
  private monthsBetween(start: string, end: string): number {
    const [sd, ed] = this.orderDates(start, end);
    let months = (ed.getFullYear() - sd.getFullYear()) * 12 + (ed.getMonth() - sd.getMonth());
    if (ed.getDate() >= sd.getDate()) months += 1;
    return Math.max(1, months);
  }

  /** Full calendar years between two dates (GetDateDifference().years). */
  private yearsBetween(start: string, end: string): number {
    const [sd, ed] = this.orderDates(start, end);
    let years = ed.getFullYear() - sd.getFullYear();
    const beforeAnniversary =
      ed.getMonth() < sd.getMonth() ||
      (ed.getMonth() === sd.getMonth() && ed.getDate() < sd.getDate());
    if (beforeAnniversary) years -= 1;
    return Math.max(0, years);
  }

  private pastCampaignEndDate(lastInstallment: string): boolean {
    const c = this.campaign;
    if (!c || c.pledgeBeyondEndDate || !lastInstallment || !c.endDate) return false;
    const last = this.parseMpDate(lastInstallment);
    const end = this.parseMpDate(c.endDate);
    if (!last || !end) return false;
    return last.getTime() > end.getTime();
  }

  // ── Suggested amounts ───────────────────────────────────────────────────

  private suggestedAmounts(): number[] {
    let raw = this.suggestedAmountsAttr;
    if (raw == null || raw === "") raw = "30,50,100";
    if (raw.toLowerCase() === "null") return [];
    return raw
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
      .slice(0, 3);
  }

  // ── Message helper ──────────────────────────────────────────────────────

  private setMessage(type: string, text: string) {
    this.message = { type, text };
    const container = this.root.querySelector<HTMLElement>("#pc-message");
    if (container) {
      container.className = `pc-message pc-message--${type}`;
      container.textContent = text;
      container.style.display = "";
      container.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } else {
      this.render();
      this.attachListeners();
    }
  }

  // ── Listeners ───────────────────────────────────────────────────────────

  private attachListeners() {
    const form = this.root.querySelector<HTMLFormElement>("#pc-form");

    // Suggested amount buttons.
    this.root.querySelectorAll<HTMLButtonElement>(".pc-amount-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        this.root
          .querySelectorAll(".pc-amount-btn")
          .forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const input = this.root.querySelector<HTMLInputElement>("#pc-installment-amount");
        if (input) input.value = btn.getAttribute("data-amount") || "";
        this.recalcTotal();
      });
    });

    // Recompute on any plan-affecting input change.
    ["#pc-installment-amount", "#pc-frequency", "#pc-first-installment", "#pc-last-installment"].forEach(
      (sel) => {
        const el = this.root.querySelector<HTMLElement>(sel);
        if (el) el.addEventListener("change", () => this.recalcTotal());
      }
    );
    // Typing into the amount clears the active suggested button.
    const amountInput = this.root.querySelector<HTMLInputElement>("#pc-installment-amount");
    if (amountInput) {
      amountInput.addEventListener("input", () => {
        this.root.querySelectorAll(".pc-amount-btn").forEach((b) => b.classList.remove("active"));
        this.recalcTotal();
      });
    }

    // "Make a Pledge As" picker.
    const applyAs = this.root.querySelector<HTMLSelectElement>("#pc-apply-as");
    if (applyAs) {
      applyAs.addEventListener("change", () => this.applyPledgeAs(applyAs.value));
    }

    // Sign-in (force-login panel).
    const login = this.root.querySelector('[data-action="login"]');
    if (login) login.addEventListener("click", () => this.emit("loginRequired"));

    // Submit / create-another.
    const submitBtn = this.root.querySelector<HTMLButtonElement>("#pc-submit");
    if (submitBtn) {
      submitBtn.addEventListener("click", (e) => {
        e.preventDefault();
        if (this.submitted) {
          this.resetForAnother();
        } else {
          this.submit();
        }
      });
    }

    if (form) bindLiveValidation(form);
    this.recalcTotal();
  }

  private applyPledgeAs(value: string) {
    const contactIdInput = this.root.querySelector<HTMLInputElement>("#pc-contact-id");
    const blank = this.root.querySelector<HTMLElement>("#pc-blank-form");

    if (!value) {
      // Blank Form: show the contact fields, clear the contact id.
      if (contactIdInput) contactIdInput.value = "0";
      if (blank) blank.style.display = "";
      this.toggleBlankRequired(true);
      this.setBlankFields("", "", "", "");
      return;
    }

    if (contactIdInput) contactIdInput.value = value;
    if (blank) blank.style.display = "none";
    this.toggleBlankRequired(false);

    const member = this.householdMembers.find((m) => String(m.contactId) === value);
    if (member) {
      this.setBlankFields(
        member.nickName || member.firstName || "",
        member.lastName || "",
        member.emailAddress || "",
        member.mobilePhoneNumber || ""
      );
    }

    void this.checkAlreadyPledged(Number(value) || null);
  }

  private toggleBlankRequired(required: boolean) {
    ["#pc-first-name", "#pc-last-name", "#pc-email"].forEach((sel) => {
      const el = this.root.querySelector<HTMLInputElement>(sel);
      if (!el) return;
      if (required) el.setAttribute("required", "");
      else el.removeAttribute("required");
    });
  }

  private setBlankFields(first: string, last: string, email: string, phone: string) {
    const set = (sel: string, v: string) => {
      const el = this.root.querySelector<HTMLInputElement>(sel);
      if (el) el.value = v;
    };
    set("#pc-first-name", first);
    set("#pc-last-name", last);
    set("#pc-email", email);
    set("#pc-phone", phone);
  }

  private async checkAlreadyPledged(contactId: number | null) {
    const c = this.campaign;
    if (!c || !contactId) return;
    try {
      const res = await this.fetch(
        `/api/embed/pledge-campaign/has-pledged?campaignId=${c.pledgeCampaignId}&contactId=${contactId}`
      );
      if (!res.ok) return;
      const data: { hasPledged: boolean } = await res.json();
      if (data.hasPledged) {
        this.setMessage(
          "warning",
          "You have already made a Pledge for this Campaign. Please ensure you want to pledge again."
        );
      } else {
        const container = this.root.querySelector<HTMLElement>("#pc-message");
        if (container && this.isAcceptingPledges()) container.style.display = "none";
      }
    } catch {
      /* ignore */
    }
  }

  /** After a successful pledge, reset the form so another can be entered. */
  private resetForAnother() {
    this.submitted = false;
    this.message = null;
    this.render();
    this.attachListeners();
  }

  // ── Render ────────────────────────────────────────────────────────────

  render() {
    if (this.loading) {
      this.root.innerHTML = `<div class="pc">${this.renderState(this.spinnerSvg(), "Loading campaign…")}</div>`;
      return;
    }
    if (this.error || !this.campaign) {
      this.root.innerHTML = `
        <div class="pc">
          <div class="pc-state pc-error"><p>${this.escapeHtml(this.error || "No pledge campaign found.")}</p></div>
        </div>`;
      return;
    }

    this.root.innerHTML = `
      <div class="pc">
        ${this.renderCampaignDetails()}
        ${this.renderMessage()}
        ${this.renderForm()}
      </div>`;
  }

  private renderMessage(): string {
    if (!this.message) return `<div id="pc-message" class="pc-message" style="display:none"></div>`;
    return `<div id="pc-message" class="pc-message pc-message--${this.escapeAttr(this.message.type)}">${this.escapeHtml(this.message.text)}</div>`;
  }

  private renderCampaignDetails(): string {
    const c = this.campaign!;
    const img = c.imageUrl
      ? `<div class="pc-image" style="background-image:url('${this.escapeAttr(c.imageUrl)}')"></div>`
      : "";
    const description = c.description
      ? `<p class="pc-description">${this.escapeHtml(c.description).replace(/\r\n|\r|\n/g, "<br/>")}</p>`
      : "";

    const goal = c.campaignGoal || 0;
    const pledgedPct = goal > 0 ? (c.pledged / goal) * 100 : 0;
    const receivedPct = goal > 0 ? (c.received / goal) * 100 : 0;
    const pledgedW = Math.min(100, Math.max(0, pledgedPct));
    const receivedX = Math.min(100, Math.max(0, receivedPct));

    return `
      <div class="pc-detail">
        ${img}
        <h1 class="pc-title">${this.escapeHtml(c.title || "Pledge Campaign")}</h1>
        ${description}
        <h2 class="pc-progress-title">Progress</h2>
        <div class="pc-progress">
          <h4 class="pc-progress-sub">${CURRENCY.format(c.pledged)} pledged of ${CURRENCY.format(goal)} goal</h4>
          <svg width="100%" height="19" role="img" aria-label="Campaign progress">
            <defs>
              <linearGradient id="pc-gradient">
                <stop offset="0%" stop-color="#1b88b0"></stop>
                <stop offset="100%" stop-color="#1fb5ac"></stop>
              </linearGradient>
            </defs>
            <rect y="2" height="15" rx="4" ry="4" fill="#efefef" width="100%"></rect>
            <rect y="2" height="15" rx="4" ry="4" fill="url(#pc-gradient)" width="${pledgedW}%"></rect>
            <rect x="${receivedX}%" y="0" width="2" height="19" fill="#000"></rect>
          </svg>
          <p class="pc-legend">
            <span class="pc-dot pc-dot--received"></span>${Number(receivedPct).toLocaleString()}% received
            <span class="pc-dot pc-dot--pledged"></span>${Number(pledgedPct).toLocaleString()}% pledged
          </p>
        </div>
      </div>`;
  }

  private renderForm(): string {
    const c = this.campaign!;

    // forceLogin + anonymous → sign-in panel only.
    if (c.forceLogin && !this.isAuthenticated) {
      return `
        <div class="pc-form-wrap pc-login-panel">
          <p>Please sign in to make a pledge for this campaign.</p>
          <button class="pc-btn pc-btn--primary" type="button" data-action="login">Sign In</button>
        </div>`;
    }

    if (!this.isAcceptingPledges()) {
      // Warning is shown via the message banner; no form.
      return "";
    }

    return `
      <div class="pc-form-wrap">
        <h2 class="pc-form-title">Create a Pledge</h2>
        <form id="pc-form" class="pc-form" novalidate>
          <div id="pc-form-fields" style="${this.submitted ? "display:none" : ""}">
            <h3 class="pc-subtitle">Pledge Details</h3>
            <input type="hidden" id="pc-contact-id" name="ContactId" value="${this.isAuthenticated && this.contact ? this.contact.contactId : 0}">

            ${this.renderAmountRow()}
            ${this.renderScheduleRow()}
            ${this.renderTotalRow()}
            ${this.renderPledgeAs()}
            ${this.renderBlankForm()}
          </div>
          ${this.renderSubmit()}
        </form>
      </div>`;
  }

  private renderAmountRow(): string {
    const amounts = this.suggestedAmounts();
    const buttons = amounts.length
      ? `<div class="pc-amount-buttons">${amounts
          .map(
            (a) =>
              `<button type="button" class="pc-btn pc-btn--ghost pc-amount-btn" data-amount="${a}">$${a}</button>`
          )
          .join("")}</div>`
      : "";
    return `
      ${buttons}
      <div class="pc-field">
        <label for="pc-installment-amount">Pledge Amount${requiredStar()}</label>
        <input id="pc-installment-amount" class="pc-input" type="number" name="InstallmentAmount" min="0" step="0.01" inputmode="decimal" required>
      </div>`;
  }

  private renderScheduleRow(): string {
    const c = this.campaign!;
    const min = this.minInstallmentDate();
    const max = c.pledgeBeyondEndDate ? "" : this.dateOrEmpty(c.endDate);
    const lastValue = c.pledgeBeyondEndDate ? "" : this.futureDateOrEmpty(c.endDate);
    const freqOptions = this.frequencies
      .map((f) => `<option value="${f.id}">${this.escapeHtml(f.name)}</option>`)
      .join("");
    return `
      <div class="pc-grid3">
        <div class="pc-field">
          <label for="pc-frequency">Select Frequency${requiredStar()}</label>
          <select id="pc-frequency" class="pc-input" name="Frequency" required>
            <option value="">-- Select --</option>
            ${freqOptions}
          </select>
        </div>
        <div class="pc-field">
          <label for="pc-first-installment">Pledge Start Date${requiredStar()}</label>
          <input id="pc-first-installment" class="pc-input" type="date" name="FirstInstallmentDate"
            required min="${min}" ${max ? `max="${max}"` : ""} value="${min}">
        </div>
        <div class="pc-field">
          <label for="pc-last-installment">Pledge End Date</label>
          <input id="pc-last-installment" class="pc-input" type="date" name="LastInstallmentDate"
            min="${min}" ${max ? `max="${max}"` : ""} value="${lastValue}">
        </div>
      </div>`;
  }

  private renderTotalRow(): string {
    return `
      <div class="pc-total">
        <span class="pc-total-label">Total Pledge</span>
        <span class="pc-total-value" id="pc-total-value">${CURRENCY.format(0)}</span>
      </div>`;
  }

  private renderPledgeAs(): string {
    if (!this.isAuthenticated || !this.contact) return "";
    const members = this.householdMembers.length
      ? this.householdMembers
      : [
          {
            contactId: this.contact.contactId,
            firstName: this.contact.firstName || "",
            lastName: this.contact.lastName || "",
            nickName: null,
            displayName: null,
            emailAddress: this.contact.emailAddress,
            mobilePhoneNumber: this.contact.mobilePhoneNumber,
          },
        ];
    const opts = members
      .map(
        (m) =>
          `<option value="${m.contactId}" ${m.contactId === this.contact!.contactId ? "selected" : ""}>${this.escapeHtml(this.memberDisplayName(m))}</option>`
      )
      .join("");
    return `
      <h3 class="pc-subtitle">Personal Details</h3>
      <div class="pc-field">
        <label for="pc-apply-as">Make a Pledge as</label>
        <select id="pc-apply-as" class="pc-input">
          ${opts}
          <option value="">Blank Form</option>
        </select>
      </div>`;
  }

  private memberDisplayName(m: HouseholdMemberLite): string {
    if (m.displayName) return m.displayName;
    const first = m.nickName || m.firstName;
    return `${first} ${m.lastName}`.trim() || "My Info";
  }

  /**
   * Contact block. Hidden when an authenticated household member is selected
   * (the picker prefills it); always shown for anonymous visitors. Prefilled
   * from the signed-in contact when available.
   */
  private renderBlankForm(): string {
    const authedMemberSelected = this.isAuthenticated && !!this.contact;
    const c = this.contact;
    const star = authedMemberSelected ? "" : requiredStar();
    const req = authedMemberSelected ? "" : "required";
    return `
      <div id="pc-blank-form" style="${authedMemberSelected ? "display:none" : ""}">
        <h3 class="pc-subtitle">Contact</h3>
        <div class="pc-grid2">
          <div class="pc-field">
            <label for="pc-first-name">First Name${star}</label>
            <input id="pc-first-name" class="pc-input" name="FirstName" value="${this.escapeAttr(c?.firstName || "")}" ${req}>
          </div>
          <div class="pc-field">
            <label for="pc-last-name">Last Name${star}</label>
            <input id="pc-last-name" class="pc-input" name="LastName" value="${this.escapeAttr(c?.lastName || "")}" ${req}>
          </div>
        </div>
        <div class="pc-grid2">
          <div class="pc-field">
            <label for="pc-email">Email${star}</label>
            <input id="pc-email" class="pc-input" type="email" name="Email" value="${this.escapeAttr(c?.emailAddress || "")}" ${req}>
          </div>
          <div class="pc-field">
            <label for="pc-phone">Mobile Phone</label>
            <input id="pc-phone" class="pc-input" type="tel" name="MobilePhoneNumber" maxlength="50" value="${this.escapeAttr(c?.mobilePhoneNumber || "")}">
          </div>
        </div>
      </div>`;
  }

  private renderSubmit(): string {
    const label = this.submitted ? "Create Another Pledge" : "Create Pledge";
    return `
      <div class="pc-buttons">
        <button id="pc-submit" class="pc-btn pc-btn--primary" type="button">${label}</button>
      </div>`;
  }

  private renderState(icon: string, text: string): string {
    return `<div class="pc-state">${icon}<span>${this.escapeHtml(text)}</span></div>`;
  }

  // ── Field / date helpers ─────────────────────────────────────────────────

  private fieldValue(sel: string): string {
    const el = this.root.querySelector<HTMLInputElement | HTMLSelectElement>(sel);
    return el ? el.value.trim() : "";
  }

  private numberValue(sel: string): number {
    const v = this.fieldValue(sel).replace(/,/g, "");
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }

  /** Min selectable installment date: max(today, campaign start), as yyyy-mm-dd. */
  private minInstallmentDate(): string {
    const c = this.campaign!;
    const start = c.startDate ? this.parseMpDate(c.startDate) : null;
    const today = new Date();
    const d = start && start.getTime() > today.getTime() ? start : today;
    return this.toYmd(d);
  }

  /** Format an MP datetime as yyyy-mm-dd, or "" when missing/invalid. */
  private dateOrEmpty(value: string | null): string {
    if (!value) return "";
    const d = this.parseMpDate(value);
    return d ? this.toYmd(d) : "";
  }

  /** Same as dateOrEmpty but only returns dates that are today or later. */
  private futureDateOrEmpty(value: string | null): string {
    if (!value) return "";
    const d = this.parseMpDate(value);
    if (!d) return "";
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cmp = new Date(d);
    cmp.setHours(0, 0, 0, 0);
    return cmp.getTime() >= today.getTime() ? this.toYmd(d) : "";
  }

  private toYmd(d: Date): string {
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  }

  private formatShortDate(value: string): string {
    const d = this.parseMpDate(value);
    if (!d) return "";
    return d.toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit" });
  }

  /** Wall-clock parse of an MP datetime with no TZ day-shift. */
  private parseMpDate(value: string): Date | null {
    if (!value) return null;
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    if (!m) {
      const fallback = new Date(value);
      return isNaN(fallback.getTime()) ? null : fallback;
    }
    return new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      m[4] ? Number(m[4]) : 0,
      m[5] ? Number(m[5]) : 0
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
    return `<svg class="pc-spinner" viewBox="0 0 24 24" fill="none" width="20" height="20">
      <circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
      <path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
    </svg>`;
  }

  private getStyles(): string {
    return `
      :host { all: initial; display: block; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color: #2D2926; }
      .pc { max-width: 760px; margin: 0 auto; }

      .pc-message { padding: 12px 16px; border-radius: 8px; font-size: 14px; margin: 16px 0; }
      .pc-message--success { background: #ecf6e0; color: #4d6b1f; }
      .pc-message--warning { background: #fdf6e3; color: #8a6d3b; }
      .pc-message--info { background: #e6f6fc; color: #015a7a; }
      .pc-message--danger { background: #ffe9e9; color: #b91c1c; }

      .pc-image { width: 100%; height: 240px; background-size: cover; background-position: center; border-radius: 12px; margin-bottom: 16px; }
      .pc-title { font-size: 28px; font-weight: 800; color: #002855; margin: 0 0 10px; }
      .pc-description { font-size: 15px; line-height: 1.6; color: #474747; margin: 0 0 16px; }

      .pc-progress-title { font-size: 16px; font-weight: 700; color: #002855; margin: 16px 0 8px; }
      .pc-progress { margin-bottom: 8px; }
      .pc-progress-sub { font-size: 15px; font-weight: 700; color: #004C97; margin: 0 0 6px; }
      .pc-legend { font-size: 13px; color: #6b7280; margin: 8px 0 0; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
      .pc-dot { width: 10px; height: 10px; border-radius: 9999px; display: inline-block; }
      .pc-dot--received { background: #000; }
      .pc-dot--pledged { background: #1fb5ac; margin-left: 12px; }

      .pc-form-wrap { background: white; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); margin-top: 16px; }
      .pc-form-title { font-size: 20px; font-weight: 800; color: #002855; margin: 0 0 16px; }
      .pc-subtitle { font-size: 15px; font-weight: 700; color: #002855; margin: 16px 0 8px; }
      .pc-login-panel { text-align: center; }
      .pc-login-panel p { margin: 0 0 12px; font-size: 15px; }

      .pc-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
      .pc-field label { font-size: 13px; font-weight: 600; color: #6b7280; }
      .pc-input { padding: 9px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; font-family: inherit; color: #2D2926; background: white; outline: none; }
      .pc-input:focus { border-color: #004C97; box-shadow: 0 0 0 1px #004C97; }
      .pc-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .pc-grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }

      .pc-amount-buttons { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }

      .pc-btn { padding: 10px 18px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; border: none; }
      .pc-btn--primary { background: #004C97; color: white; }
      .pc-btn--primary:hover { background: #002855; }
      .pc-btn--ghost { background: white; color: #004C97; border: 1px solid #004C97; }
      .pc-btn--ghost:hover, .pc-btn--ghost.active { background: #004C97; color: white; }
      .pc-btn:disabled { opacity: 0.5; cursor: not-allowed; }

      .pc-total { display: flex; justify-content: space-between; align-items: center; padding: 14px 0; border-top: 2px solid #e5e7eb; margin: 16px 0; }
      .pc-total-label { font-size: 16px; font-weight: 700; color: #002855; }
      .pc-total-value { font-size: 20px; font-weight: 800; color: #004C97; }

      .pc-buttons { display: flex; justify-content: flex-end; gap: 12px; }

      .pc-state { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 48px 16px; color: #6b7280; font-size: 15px; }
      .pc-error { flex-direction: column; }
      .pc-error p { color: #b91c1c; }
      .pc-spinner { animation: pc-spin 1s linear infinite; color: #004C97; }
      @keyframes pc-spin { to { transform: rotate(360deg); } }

      @media (max-width: 640px) {
        .pc-grid2, .pc-grid3 { grid-template-columns: 1fr; }
        .pc-image { height: 170px; }
        .pc-title { font-size: 22px; }
        .pc-buttons { flex-direction: column; }
        .pc-buttons .pc-btn { width: 100%; }
      }
    `;
  }
}

customElements.define("next-pledge-campaign", PledgeCampaignWidget);
