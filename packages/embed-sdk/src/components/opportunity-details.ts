import { MPNextWidget } from "../shared/base-widget";
import { parseWallClock } from "../i18n";
import {
  renderCustomFormFields,
  bindCustomFormDependsOn,
  CUSTOM_FORM_STYLES,
  type CustomFormField,
} from "../shared/custom-form";
import {
  validateForm,
  bindLiveValidation,
  requiredStar,
  FORM_VALIDATION_STYLES,
} from "../shared/form-validation";

interface OpportunityContact {
  displayName: string | null;
  imageUrl: string | null;
  emailAddress: string | null;
}

interface OpportunityDetail {
  id: number;
  title: string;
  description: string | null;
  imageUrl: string | null;
  location: string | null;
  address: string | null;
  startDate: string;
  meetingDay: string | null;
  requiredGender: string | null;
  minimumAge: string | null;
  remainingNeeded: number | null;
  maximumNeeded: number | null;
  numberOfResponses: number;
  visibilityLevel: number;
  eventId: number | null;
  customFormId: number | null;
  customFormGuid: string | null;
  forceLogin: boolean;
  contacts: OpportunityContact[];
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
  emailAddress: string | null;
  mobilePhoneNumber: string | null;
}

/**
 * `next-opportunity-details` — single volunteer-opportunity view + response form.
 *
 * Ported from the legacy `mpp-opportunity-details` portal widget. Supports
 * opportunity display (image / date / description / contacts / location / map),
 * a "remaining needed" gate, an authenticated/anonymous response form with a
 * "Respond As" household picker, an optional depends-on custom form, and a
 * has-responded notice. Built on the `next-event-details` model.
 *
 * Simplifications relative to legacy (noted inline):
 *  - "Respond As" is populated from the signed-in household members endpoint.
 *  - Custom-form FileUpload renders an input but is not submitted in v1.
 */
export class OpportunityDetailsWidget extends MPNextWidget {
  private opportunity: OpportunityDetail | null = null;
  private customFields: CustomFormField[] = [];

  private loading = true;
  private error: string | null = null;
  private message: { type: string; text: string } | null = null;
  private submitted = false;

  private isAuthenticated = false;
  private contact: BasicContact | null = null;
  private householdMembers: HouseholdMemberLite[] = [];
  /** Selected ContactId in the Respond As picker; "" = blank form. */
  private respondAs = "";
  private hasResponded = false;

  static get observedAttributes() {
    return [
      "api-host",
      "opportunity-id",
      "id-parameter-name",
      "return-url",
      "response-email-template",
    ];
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null) {
    if (oldValue === newValue) return;
    if (name === "opportunity-id" && this.opportunity) {
      this.init();
    }
  }

  connectedCallback() {
    this.injectStyles(this.getStyles() + CUSTOM_FORM_STYLES + FORM_VALIDATION_STYLES);
    // Await the catalogue before the first paint so a Spanish visitor never
    // sees English swap to Spanish; the fetch hides inside the loading state
    // this widget already paints while it queries the API.
    void this.initLocale().then(() => {
      this.render();
      this.init();
    });
  }

  /** Public hook so demo pages can force a reload (e.g. after sign-in). */
  public retryLoad() {
    this.error = null;
    this.init();
  }

  // ── Attribute helpers ──

  private get idParam(): string {
    return this.getAttribute("id-parameter-name") || "id";
  }
  private get returnUrl(): string {
    return this.getAttribute("return-url") || "";
  }

  private resolveOpportunityId(): string {
    const attr = this.getAttribute("opportunity-id");
    if (attr) return attr;
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get(this.idParam) || params.get("id") || "";
    } catch {
      return "";
    }
  }

  // ── Init / load ──

  private async init() {
    this.loading = true;
    this.error = null;
    this.message = null;
    this.opportunity = null;
    this.customFields = [];
    this.submitted = false;
    this.hasResponded = false;
    this.respondAs = "";
    this.render();

    const opportunityId = this.resolveOpportunityId();
    if (!opportunityId) {
      this.error = this.t("opportunityDetails.noOpportunitySpecified");
      this.loading = false;
      this.render();
      this.attachListeners();
      this.emit("opportunityDetailError", { error: this.error });
      return;
    }

    try {
      const res = await this.fetch(
        `/api/embed/opportunity-details/${encodeURIComponent(opportunityId)}`
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(this.errorText(body, "errors.opportunity_not_found"));
      }
      const data: { opportunity: OpportunityDetail } = await res.json();
      if (!data || !data.opportunity) {
        throw new Error(this.t("errors.opportunity_not_found"));
      }
      this.opportunity = data.opportunity;

      await this.loadBasicContact();
      if (this.isAuthenticated) {
        await this.loadHousehold();
        // Default the picker to the signed-in contact.
        if (this.contact) this.respondAs = String(this.contact.contactId);
      }

      this.loading = false;
      this.emit("opportunityDetailLoaded", {
        opportunityId: this.opportunity.id,
        title: this.opportunity.title,
      });

      // Load the custom form (if any) and the has-responded notice.
      await this.loadCustomForm();
      if (this.respondAs) {
        await this.checkHasResponded(Number(this.respondAs) || null);
      }
    } catch (err) {
      // `errorText` has already produced a translated sentence; a thrown
      // non-Error (a dropped connection) becomes the generic network message
      // rather than leaking English.
      this.error = err instanceof Error ? err.message : this.t("errors.network");
      this.opportunity = null;
      this.loading = false;
      this.render();
      this.attachListeners();
      this.emit("opportunityDetailError", { error: this.error });
      return;
    }

    this.render();
    this.attachListeners();
  }

  private async loadBasicContact() {
    try {
      const res = await this.fetch(`/api/embed/event-details/basic-contact`);
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

  private async loadCustomForm() {
    if (!this.opportunity || !this.opportunity.customFormId) {
      this.customFields = [];
      return;
    }
    try {
      const res = await this.fetch(
        `/api/embed/custom-form?formId=${this.opportunity.customFormId}`
      );
      if (!res.ok) {
        this.customFields = [];
        return;
      }
      const data: { fields: CustomFormField[] } = await res.json();
      this.customFields = (data.fields || []).sort((a, b) => a.fieldOrder - b.fieldOrder);
    } catch {
      this.customFields = [];
    }
  }

  private async checkHasResponded(contactId: number | null) {
    const op = this.opportunity;
    if (!op || !contactId) {
      this.hasResponded = false;
      return;
    }
    try {
      const res = await this.fetch(
        `/api/embed/opportunity-details/has-responded?opportunityId=${op.id}&contactId=${contactId}`
      );
      if (!res.ok) {
        this.hasResponded = false;
        return;
      }
      const data: { hasResponded: boolean } = await res.json();
      this.hasResponded = !!data.hasResponded;
    } catch {
      this.hasResponded = false;
    }
    const el = this.root.querySelector<HTMLElement>("#od-has-responded");
    if (el) el.style.display = this.hasResponded ? "" : "none";
  }

  // ── Response submit ──

  private async submit() {
    const form = this.root.querySelector<HTMLFormElement>("#od-form");
    if (!form) return;

    if (!validateForm(form).valid) {
      this.setMessage("warning", this.t("opportunityDetails.verifyDetails"));
      return;
    }

    const payload = this.gatherFormData(form);

    this.setSubmitDisabled(true);
    try {
      const res = await this.fetch(`/api/embed/opportunity-details/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data: { success: boolean; responseId?: number; message?: string } = await res
        .json()
        .catch(() => ({ success: false }));

      if (!data.success) {
        // The route's `message` is English and debug-only, so render the
        // translated sentence instead.
        const msg = this.errorText(data, "opportunityDetails.responseFailed");
        this.setMessage("danger", msg);
        this.emit("responseError", { error: msg });
        this.setSubmitDisabled(false);
        return;
      }

      this.submitted = true;
      this.emit("responseSaved", { responseId: data.responseId ?? null });
      // Two whole sentences rather than one with an optional clause: the
      // greeting's punctuation and word order differ by language, so splicing a
      // name into the middle of a translated string does not travel.
      const name = this.responderName(payload);
      this.message = {
        type: "success",
        text: name
          ? this.t("opportunityDetails.responseReceivedNamed", { name })
          : this.t("opportunityDetails.responseReceived"),
      };
      this.render();
      this.attachListeners();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : this.t("errors.submitFailed");
      this.setMessage("danger", msg);
      this.emit("responseError", { error: msg });
      this.setSubmitDisabled(false);
    }
  }

  private responderName(payload: Record<string, string>): string {
    const id = Number(payload.ContactId);
    if (id > 0) {
      const m = this.householdMembers.find((x) => x.contactId === id);
      if (m) return `${m.nickName || m.firstName} ${m.lastName}`.trim();
    }
    return `${payload.FirstName ?? ""} ${payload.LastName ?? ""}`.trim();
  }

  /** Flatten all form fields into a string→string map. */
  private gatherFormData(form: HTMLFormElement): Record<string, string> {
    const out: Record<string, string> = {};
    const fd = new FormData(form);
    for (const [key, value] of fd.entries()) {
      if (typeof value === "string") out[key] = value;
    }
    const op = this.opportunity;
    if (op) {
      out.OpportunityId = String(op.id);
      if (op.customFormId) out.mp_customformformid = String(op.customFormId);
    }
    // ContactId blank/sentinel means anonymous — drop it.
    if (out.ContactId === "" || out.ContactId === "Blank Form") {
      delete out.ContactId;
    }
    return out;
  }

  private setSubmitDisabled(disabled: boolean) {
    this.root
      .querySelectorAll<HTMLButtonElement>(".od-submit")
      .forEach((b) => (b.disabled = disabled));
  }

  private setMessage(type: string, text: string) {
    this.message = { type, text };
    const container = this.root.querySelector<HTMLElement>("#od-message");
    if (container) {
      container.className = `od-message od-message--${type}`;
      container.textContent = text;
      container.style.display = "";
    } else {
      this.render();
      this.attachListeners();
    }
  }

  // ── Listeners ──

  private attachListeners() {
    const back = this.root.querySelector('[data-action="back"]');
    if (back) back.addEventListener("click", () => this.init());

    const login = this.root.querySelector('[data-action="login"]');
    if (login) login.addEventListener("click", () => this.requestLogin("opportunity-details"));

    const respondAs = this.root.querySelector<HTMLSelectElement>("#od-respond-as");
    if (respondAs) {
      respondAs.addEventListener("change", () => {
        this.respondAs = respondAs.value;
        this.render();
        this.attachListeners();
        void this.checkHasResponded(Number(this.respondAs) || null);
      });
    }

    this.root.querySelectorAll<HTMLButtonElement>(".od-submit").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        this.submit();
      });
    });

    const respondAgain = this.root.querySelector('[data-action="respond-again"]');
    if (respondAgain) {
      respondAgain.addEventListener("click", (e) => {
        e.preventDefault();
        this.submitted = false;
        this.message = null;
        this.render();
        this.attachListeners();
      });
    }

    const form = this.root.querySelector<HTMLFormElement>("#od-form");
    if (form) {
      bindCustomFormDependsOn(form, this.customFields);
      bindLiveValidation(form);
    }
  }

  // ── Render ──

  render() {
    if (this.loading) {
      this.root.innerHTML = `<div class="od">${this.renderState(this.spinnerSvg(), this.t("opportunityDetails.loading"))}</div>`;
      return;
    }
    if (this.error || !this.opportunity) {
      this.root.innerHTML = `
        <div class="od">
          ${this.renderBackLink()}
          <div class="od-state od-error"><p>${this.escapeHtml(this.error || this.t("errors.opportunity_not_found"))}</p></div>
        </div>`;
      return;
    }

    this.root.innerHTML = `
      <div class="od">
        ${this.renderBackLink()}
        ${this.renderMessage()}
        ${this.renderDetails()}
        ${this.renderResponse()}
      </div>`;
  }

  private renderBackLink(): string {
    if (!this.returnUrl) return "";
    return `<div class="od-back"><a href="${this.escapeAttr(this.returnUrl)}">&larr; ${this.escapeHtml(this.t("opportunityDetails.backToOpportunities"))}</a></div>`;
  }

  private renderMessage(): string {
    if (!this.message) return `<div id="od-message" class="od-message" style="display:none"></div>`;
    return `<div id="od-message" class="od-message od-message--${this.escapeAttr(this.message.type)}">${this.escapeHtml(this.message.text)}</div>`;
  }

  private renderDetails(): string {
    const op = this.opportunity!;
    const img = op.imageUrl
      ? `<div class="od-image" style="background-image:url('${this.escapeAttr(op.imageUrl)}')"></div>`
      : "";
    const pills =
      [op.requiredGender, op.minimumAge].filter(Boolean).length
        ? `<ul class="od-labels">${[op.requiredGender, op.minimumAge]
            .filter(Boolean)
            .map((a) => `<li>${this.escapeHtml(a!)}</li>`)
            .join("")}</ul>`
        : "";
    const description = op.description
      ? `<section class="od-description">${this.sanitizeHtml(op.description)}</section>`
      : "";

    const remaining =
      op.remainingNeeded != null
        ? this.specialText(
            this.t("opportunityDetails.volunteersNeeded"),
            this.fmt.number(op.remainingNeeded)
          )
        : "";
    const contacts = this.renderContacts();
    // The location *value* is MP-authored and stays as MP supplies it; only its
    // label is translated.
    const location = op.location
      ? this.specialText(this.t("fields.location"), op.location)
      : "";
    const map = this.renderMap();

    return `
      <div class="od-detail">
        ${img}
        <h1 class="od-title">${this.escapeHtml(op.title)}</h1>
        ${pills}
        <div class="od-datetime">${this.escapeHtml(this.formatDateTime(op))}</div>
        ${description}
        ${remaining}
        ${contacts}
        ${location}
        ${map}
      </div>`;
  }

  private specialText(title: string, body: string): string {
    return `<div class="od-special"><div class="od-special-title">${this.escapeHtml(title)}</div><div class="od-special-body">${this.escapeHtml(body)}</div></div>`;
  }

  private renderContacts(): string {
    const op = this.opportunity!;
    if (!op.contacts || op.contacts.length === 0) return "";
    const items = op.contacts
      .map((c) => {
        const name = this.escapeHtml(c.displayName || "");
        const inner = c.emailAddress
          ? `<a href="mailto:${this.escapeAttr(c.emailAddress)}">${name}</a>`
          : name;
        const badge = c.imageUrl
          ? `<span class="od-contact-badge" style="background-image:url('${this.escapeAttr(c.imageUrl)}')"></span>`
          : `<span class="od-contact-badge">${name.charAt(0)}</span>`;
        return `<li class="od-contact">${badge}<span>${inner}</span></li>`;
      })
      .join("");
    return `<div class="od-special"><div class="od-special-title">${this.escapeHtml(this.t("fields.contact"))}</div><ul class="od-contacts">${items}</ul></div>`;
  }

  private renderMap(): string {
    const op = this.opportunity!;
    if (!op.address) return "";
    const q = encodeURIComponent(op.address);
    return `
      <div class="od-map">
        <iframe
          title="${this.escapeAttr(this.t("opportunityDetails.mapTitle"))}"
          src="https://www.google.com/maps?q=${q}&output=embed"
          loading="lazy"
          referrerpolicy="no-referrer-when-downgrade"></iframe>
        <a class="od-link" href="https://www.google.com/maps?q=${q}" target="_blank" rel="noopener">${this.escapeHtml(this.t("common.getDirections"))} &rsaquo;</a>
      </div>`;
  }

  // ── Render: response form ──

  private renderResponse(): string {
    const op = this.opportunity!;

    if (this.submitted) {
      return `
        <div class="od-reg">
          <button class="od-btn od-btn--secondary" type="button" data-action="respond-again">${this.escapeHtml(this.t("opportunityDetails.submitAnother"))}</button>
        </div>`;
    }

    // Maximum-needed gate.
    if (op.remainingNeeded != null && op.remainingNeeded <= 0) {
      return `<div class="od-reg"><div class="od-message od-message--warning">${this.escapeHtml(this.t("opportunityDetails.maximumReached"))}</div></div>`;
    }

    // forceLogin + anonymous → sign-in panel only.
    if (op.forceLogin && !this.isAuthenticated) {
      return `
        <div class="od-reg od-login-panel">
          <p>${this.escapeHtml(this.t("opportunityDetails.signInToRespond"))}</p>
          <button class="od-btn od-btn--primary" type="button" data-action="login">${this.escapeHtml(this.t("common.signIn"))}</button>
        </div>`;
    }

    return `
      <div class="od-reg">
        <h2 class="od-reg-title">${this.escapeHtml(this.t("opportunityDetails.respondTitle"))}</h2>
        <div id="od-has-responded" class="od-message od-message--info" style="display:${this.hasResponded ? "" : "none"}">${this.escapeHtml(this.t("opportunityDetails.alreadyResponded"))}</div>
        <form id="od-form" class="od-form" novalidate>
          ${this.renderHiddenInputs()}
          ${this.renderRespondAs()}
          ${this.renderBlankForm()}
          ${this.renderMessageField()}
          ${this.renderCustomFormSection()}
          <div class="od-buttons">
            <button class="od-btn od-btn--primary od-submit" type="button">${this.escapeHtml(this.t("opportunityDetails.submitResponse"))}</button>
          </div>
        </form>
      </div>`;
  }

  private renderHiddenInputs(): string {
    const op = this.opportunity!;
    const template = this.getAttribute("response-email-template") || "";
    return `
      <input type="hidden" name="OpportunityId" value="${op.id}">
      <input type="hidden" name="UseEmailTemplate" value="${this.escapeAttr(template)}">
      <input type="hidden" id="od-contact-id" name="ContactId" value="${this.escapeAttr(this.blankForm ? "" : this.respondAs)}">`;
  }

  /** Whether the blank (name/email/phone) form is showing. */
  private get blankForm(): boolean {
    return !this.isAuthenticated || this.respondAs === "";
  }

  private renderRespondAs(): string {
    if (!this.isAuthenticated || !this.contact) return "";
    const optionList: HouseholdMemberLite[] = this.householdMembers.length
      ? this.householdMembers
      : [
          {
            contactId: this.contact.contactId,
            firstName: this.contact.firstName || "",
            lastName: this.contact.lastName || "",
            nickName: null,
            emailAddress: this.contact.emailAddress,
            mobilePhoneNumber: this.contact.mobilePhoneNumber,
          },
        ];
    const opts = optionList
      .map(
        (m) =>
          `<option value="${m.contactId}" ${String(m.contactId) === this.respondAs ? "selected" : ""}>${this.escapeHtml(this.memberDisplayName(m))}</option>`
      )
      .join("");
    return `
      <div class="od-field">
        <label for="od-respond-as">${this.escapeHtml(this.t("opportunityDetails.respondAs"))}${requiredStar()}</label>
        <select id="od-respond-as" class="od-input">
          ${opts}
          <option value="" ${this.respondAs === "" ? "selected" : ""}>${this.escapeHtml(this.t("opportunityDetails.someoneElse"))}</option>
        </select>
      </div>`;
  }

  private memberDisplayName(m: HouseholdMemberLite): string {
    const first = m.nickName || m.firstName;
    return `${first} ${m.lastName}`.trim() || this.t("opportunityDetails.myInfo");
  }

  private renderBlankForm(): string {
    if (!this.blankForm) return "";
    return `
      <fieldset class="od-fieldset">
        <legend>${this.escapeHtml(this.t("opportunityDetails.yourInformation"))}</legend>
        <div class="od-grid2">
          <div class="od-field"><label>${this.escapeHtml(this.t("fields.firstName"))}${requiredStar()}</label><input class="od-input" name="FirstName" required></div>
          <div class="od-field"><label>${this.escapeHtml(this.t("fields.lastName"))}${requiredStar()}</label><input class="od-input" name="LastName" required></div>
        </div>
        <div class="od-grid2">
          <div class="od-field"><label>${this.escapeHtml(this.t("fields.email"))}${requiredStar()}</label><input class="od-input" type="email" name="EmailAddress" required></div>
          <div class="od-field"><label>${this.escapeHtml(this.t("fields.mobilePhone"))}${requiredStar()}</label><input class="od-input" name="MobilePhoneNumber" required></div>
        </div>
      </fieldset>`;
  }

  private renderMessageField(): string {
    return `
      <div class="od-field">
        <label for="od-message-field">${this.escapeHtml(this.t("fields.message"))}</label>
        <textarea id="od-message-field" class="od-input" name="Message" maxlength="500" placeholder="${this.escapeAttr(this.t("opportunityDetails.messagePlaceholder"))}"></textarea>
      </div>`;
  }

  private renderCustomFormSection(): string {
    if (!this.customFields.length) return "";
    const op = this.opportunity!;
    return `
      <div class="od-customform">
        <h3 class="od-reg-subtitle">${this.escapeHtml(this.t("opportunityDetails.additionalInformation"))}</h3>
        ${renderCustomFormFields(this.customFields, { formId: op.customFormId, t: this.t })}
      </div>`;
  }

  private renderState(icon: string, text: string): string {
    return `<div class="od-state">${icon}<span>${this.escapeHtml(text)}</span></div>`;
  }

  // ── Date / text helpers ──

  /**
   * MP stores `meetingDay` as its own text — the sentinel "Ongoing", or a day
   * name used when the opportunity carries no concrete start. The sentinel and
   * the recurrence wrapper are translated; the day name itself stays as MP
   * supplies it, since "Mondays" pluralises in a way no other language copies.
   *
   * `parseWallClock` replaces the local `parseMpDate`: same calendar-parts
   * parse into a local Date, so MP's wall clock survives and `fmt` formats it
   * with no time zone.
   */
  private formatDateTime(op: OpportunityDetail): string {
    const day = (op.meetingDay ?? "").toLowerCase();
    if (day === "ongoing") return this.t("opportunityDetails.ongoing");
    const d = parseWallClock(op.startDate);
    if (!d) {
      return op.meetingDay
        ? this.t("opportunityDetails.everyDay", { day: op.meetingDay })
        : "";
    }
    const dateStr = this.fmt.date(d, "full");
    // Midnight means the record has a date but no real time component.
    if (d.getHours() === 0 && d.getMinutes() === 0) return dateStr;
    return `${dateStr}, ${this.fmt.time(d)}`;
  }

  private sanitizeHtml(html: string): string {
    const template = document.createElement("template");
    template.innerHTML = html;
    const walk = (node: Element) => {
      const tag = node.tagName.toLowerCase();
      if (["script", "style", "iframe", "object", "embed"].includes(tag)) {
        node.remove();
        return;
      }
      for (const attr of Array.from(node.attributes)) {
        const n = attr.name.toLowerCase();
        if (n.startsWith("on") || (n === "href" && attr.value.trim().toLowerCase().startsWith("javascript:"))) {
          node.removeAttribute(attr.name);
        }
      }
      Array.from(node.children).forEach(walk);
    };
    Array.from(template.content.children).forEach((c) => walk(c as Element));
    return template.innerHTML;
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
    return `<svg class="od-spinner" viewBox="0 0 24 24" fill="none" width="20" height="20">
      <circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
      <path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
    </svg>`;
  }

  private getStyles(): string {
    return `
      :host { all: initial; display: block; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color: #2D2926; }
      .od { max-width: 880px; margin: 0 auto; }

      .od-back { margin-bottom: 12px; }
      .od-back a { color: #004C97; text-decoration: none; font-weight: 600; font-size: 14px; cursor: pointer; }
      .od-back a:hover { text-decoration: underline; }

      .od-message { padding: 12px 16px; border-radius: 8px; font-size: 14px; margin-bottom: 16px; }
      .od-message--success { background: #ecf6e0; color: #4d6b1f; }
      .od-message--warning { background: #fdf6e3; color: #8a6d3b; }
      .od-message--info { background: #e6f6fc; color: #015a7a; }
      .od-message--danger { background: #ffe9e9; color: #b91c1c; }

      .od-image { width: 100%; height: 260px; background-size: cover; background-position: center; border-radius: 12px; margin-bottom: 16px; }
      .od-title { font-size: 28px; font-weight: 800; color: #002855; margin: 0 0 10px; }
      .od-labels { list-style: none; padding: 0; margin: 0 0 12px; display: flex; flex-wrap: wrap; gap: 8px; }
      .od-labels li { background: #F1BE48; color: #2D2926; font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 9999px; }
      .od-datetime { font-size: 16px; font-weight: 600; color: #004C97; margin-bottom: 16px; }
      .od-description { font-size: 15px; line-height: 1.6; color: #474747; margin-bottom: 16px; }
      .od-description img { max-width: 100%; height: auto; }

      .od-special { margin-bottom: 16px; }
      .od-special-title { font-size: 13px; font-weight: 700; color: #002855; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 4px; }
      .od-special-body { font-size: 15px; color: #474747; line-height: 1.5; }

      .od-contacts { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 16px; }
      .od-contact { display: flex; align-items: center; gap: 8px; font-size: 14px; }
      .od-contact a { color: #004C97; text-decoration: none; }
      .od-contact a:hover { text-decoration: underline; }
      .od-contact-badge { width: 36px; height: 36px; border-radius: 9999px; background: #004C97; color: white; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; background-size: cover; background-position: center; }

      .od-map { margin-bottom: 16px; }
      .od-map iframe { width: 100%; height: 280px; border: 0; border-radius: 12px; }
      .od-link { color: #004C97; font-weight: 600; text-decoration: none; font-size: 14px; }
      .od-link:hover { text-decoration: underline; }

      .od-btn { padding: 10px 18px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; border: none; text-decoration: none; display: inline-block; }
      .od-btn--primary { background: #004C97; color: white; }
      .od-btn--primary:hover { background: #002855; }
      .od-btn--secondary { background: #009CDE; color: white; }
      .od-btn--secondary:hover { background: #007bb0; }
      .od-btn:disabled { opacity: 0.5; cursor: not-allowed; }

      .od-reg { background: white; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); margin-top: 8px; }
      .od-reg-title { font-size: 20px; font-weight: 800; color: #002855; margin: 0 0 16px; }
      .od-reg-subtitle { font-size: 16px; font-weight: 700; color: #002855; margin: 16px 0 8px; }
      .od-login-panel { text-align: center; }
      .od-login-panel p { margin: 0 0 12px; font-size: 15px; }

      .od-form { display: block; }
      .od-fieldset { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px 16px; margin: 0 0 16px; }
      .od-fieldset legend { font-size: 13px; font-weight: 700; color: #002855; padding: 0 6px; }
      .od-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
      .od-field label { font-size: 13px; font-weight: 600; color: #6b7280; }
      .od-input { padding: 9px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; font-family: inherit; color: #2D2926; background: white; outline: none; }
      .od-input:focus { border-color: #004C97; box-shadow: 0 0 0 1px #004C97; }
      textarea.od-input { min-height: 80px; resize: vertical; }
      .od-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .od-buttons { display: flex; flex-wrap: wrap; gap: 12px; }

      .od-state { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 48px 16px; color: #6b7280; font-size: 15px; }
      .od-error { flex-direction: column; }
      .od-error p { color: #b91c1c; }
      .od-spinner { animation: od-spin 1s linear infinite; color: #004C97; }
      @keyframes od-spin { to { transform: rotate(360deg); } }

      @media (max-width: 640px) {
        .od-grid2 { grid-template-columns: 1fr; }
        .od-image { height: 180px; }
        .od-title { font-size: 22px; }
        .od-buttons .od-btn { width: 100%; text-align: center; }
      }
    `;
  }
}

customElements.define("next-opportunity-details", OpportunityDetailsWidget);
