import { MPNextWidget, WidgetError } from "../shared/base-widget";
import {
  renderCustomFormFields,
  bindCustomFormDependsOn,
  CUSTOM_FORM_STYLES,
  type CustomFormField,
} from "../shared/custom-form";
import {
  validateForm,
  bindLiveValidation,
  field,
  FORM_VALIDATION_STYLES,
  type FieldOptions,
} from "../shared/form-validation";
import {
  loadGoogleMaps,
  attachAddressAutocomplete,
} from "../shared/google-places";

interface CustomFormHeader {
  formId: number;
  formGuid: string | null;
  title: string | null;
  instructions: string | null;
  completeMessage: string | null;
  getContactInfo: boolean;
  getAddressInfo: boolean;
  forceLogin: boolean;
  productId: number | null;
  isExpired: boolean;
  imageUrl: string | null;
  googleMapsApiKey: string | null;
}

/** Subset of the basic-contact response used to prefill the form for signed-in users. */
interface PrefillContact {
  contactId?: number | null;
  firstName: string | null;
  lastName: string | null;
  emailAddress: string | null;
  mobilePhoneNumber: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  stateRegion?: string | null;
  postalCode?: string | null;
}

/** One `GET /api/embed/household` member: the "Who is this form for?" roster (C26). */
interface HouseholdMemberLite {
  contactId: number;
  firstName: string;
  lastName: string;
  nickName: string | null;
  emailAddress: string | null;
  mobilePhoneNumber: string | null;
}

/** The contact-block inputs a picked member fills, keyed by input `name`. */
const CONTACT_FIELDS = ["FirstName", "LastName", "EmailAddress", "MobilePhoneNumber"] as const;

/**
 * `next-custom-form` — standalone MinistryPlatform custom form.
 *
 * Renders a form's fields (via the shared custom-form module that
 * `next-event-details` also uses) plus optional contact/address blocks, and
 * submits a Form_Response. Ported from the legacy `mpp-custom-form`.
 *
 * Note: forms with a Product_ID (paid forms → checkout) collect + save the
 * response here; the checkout hand-off is handled by the checkout widget.
 */
export class CustomFormWidget extends MPNextWidget {
  private header: CustomFormHeader | null = null;
  private fields: CustomFormField[] = [];
  private loading = true;
  private error: string | null = null;
  private submitted = false;
  private isAuthenticated = false;
  private contact: PrefillContact | null = null;
  /** The signed-in user's household, self included (C26). */
  private householdMembers: HouseholdMemberLite[] = [];
  /**
   * "Who is this form for?": a contact id, or `""` for "Someone else (blank
   * form)". Defaults to the signed-in user, so a signed-in submit is filed
   * against them exactly as before the picker existed.
   */
  private completeAs = "";
  /** Display name of the contact the last submit was filed against. */
  private submittedFor: string | null = null;

  static get observedAttributes() {
    return ["api-host", "form-id", "form-guid", "id-parameter-name", "checkout-url"];
  }

  connectedCallback() {
    this.injectStyles(this.getStyles() + CUSTOM_FORM_STYLES + FORM_VALIDATION_STYLES);
    // Await the catalogue before the first paint so a Spanish visitor never
    // sees English swap to Spanish; the fetch hides inside the loading state
    // this widget already paints while it fetches the form definition.
    void this.initLocale().then(() => {
      this.render();
      this.painted = true;
      this.init();
    });
  }

  /**
   * C39: only the attributes that pick *which form* reload it; `checkout-url`
   * and `api-host` are read when used. The old guard (`&& !this.loading`)
   * dropped a `form-id` set while the first load was still in flight, which
   * is exactly when a framework host sets it.
   */
  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null) {
    if (oldValue === newValue) return;
    if (name === "form-id" || name === "form-guid" || name === "id-parameter-name") {
      this.reconfigure();
    }
  }

  protected override reload(): void {
    this.error = null;
    this.init();
  }

  public retryLoad() {
    this.error = null;
    this.init();
  }

  private resolveFormRef(): { formId?: string; formGuid?: string } {
    const formId = this.getAttribute("form-id");
    if (formId) return { formId };
    const formGuid = this.getAttribute("form-guid");
    if (formGuid) return { formGuid };
    // Fall back to the URL query param (legacy default "id").
    try {
      const idParam = this.getAttribute("id-parameter-name") || "id";
      const params = new URLSearchParams(window.location.search);
      const fromUrl = params.get(idParam) || params.get("id");
      if (fromUrl) {
        // GUIDs contain hyphens; numeric ids do not.
        return /\D/.test(fromUrl) ? { formGuid: fromUrl } : { formId: fromUrl };
      }
    } catch {
      /* ignore */
    }
    return {};
  }

  private async init() {
    this.loading = true;
    this.error = null;
    this.submitted = false;
    this.render();

    const ref = this.resolveFormRef();
    if (!ref.formId && !ref.formGuid) {
      this.error = this.t("customForm.noFormSpecified");
      this.loading = false;
      this.render();
      this.emit("formError", { error: this.error });
      return;
    }

    try {
      const params = new URLSearchParams(ref as Record<string, string>);
      const res = await this.fetch(`/api/embed/custom-form?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new WidgetError(this.errorText(body, "errors.form_not_found"));
      }
      const data: { header: CustomFormHeader; fields: CustomFormField[] } = await res.json();
      this.header = data.header;
      this.fields = data.fields || [];
      await this.detectAuth();
      this.emit("formLoaded", { formId: this.header.formId });
    } catch (err) {
      // `errorText` has already produced a translated sentence; a thrown
      // non-Error (a dropped connection) becomes the generic network message
      // rather than leaking English.
      this.error = this.caughtText(err, "errors.network");
      this.emit("formError", { error: this.error });
    } finally {
      this.loading = false;
      this.render();
      this.prefillContact();
    }
  }

  private async detectAuth() {
    // Reuse the shared basic-contact endpoint to know auth state AND prefill the
    // signed-in contact's info. The form works anonymously, so failures are non-fatal.
    try {
      const res = await this.fetch(`/api/embed/event-details/basic-contact`);
      this.isAuthenticated = res.ok;
      if (res.ok) {
        const data: { contact?: PrefillContact } = await res.json().catch(() => ({}));
        this.contact = data.contact ?? null;
      } else {
        this.contact = null;
      }
    } catch {
      this.isAuthenticated = false;
      this.contact = null;
    }
    this.householdMembers = [];
    this.completeAs = "";
    if (this.isAuthenticated && this.contact) {
      await this.loadHousehold();
      this.completeAs = this.contact.contactId ? String(this.contact.contactId) : "";
    }
  }

  /**
   * The roster for "Who is this form for?" (C26), from the same endpoint
   * `next-opportunity-details`' "Respond As" uses. The signed-in user is put
   * first; a failure degrades to "just me", never to an error.
   */
  private async loadHousehold() {
    const self = this.contact;
    const selfMember: HouseholdMemberLite | null =
      self && self.contactId
        ? {
            contactId: self.contactId,
            firstName: self.firstName || "",
            lastName: self.lastName || "",
            nickName: null,
            emailAddress: self.emailAddress,
            mobilePhoneNumber: self.mobilePhoneNumber,
          }
        : null;
    let members: HouseholdMemberLite[] = [];
    try {
      const res = await this.fetch(`/api/embed/household`);
      if (res.ok) {
        const data: { members?: HouseholdMemberLite[] } = await res.json();
        members = data.members ?? [];
      }
    } catch {
      members = [];
    }
    const others = members.filter((m) => m.contactId !== selfMember?.contactId);
    const selfFromList = members.find((m) => m.contactId === selfMember?.contactId);
    const first = selfFromList ?? selfMember;
    this.householdMembers = first ? [first, ...others] : others;
  }

  private memberName(m: HouseholdMemberLite): string {
    return [m.nickName || m.firstName, m.lastName].filter(Boolean).join(" ").trim();
  }

  private selectedMember(): HouseholdMemberLite | null {
    return this.householdMembers.find((m) => String(m.contactId) === this.completeAs) ?? null;
  }

  /**
   * Fill the contact block from the chosen member (C26). A value the member's
   * record has is shown read-only, because the server files the response with
   * the record's value regardless of what is typed; an empty one stays
   * editable. "Someone else" clears the block and unlocks it.
   */
  private applyCompleteAs() {
    const m = this.selectedMember();
    const values: Record<(typeof CONTACT_FIELDS)[number], string> = {
      FirstName: m?.firstName ?? "",
      LastName: m?.lastName ?? "",
      EmailAddress: m?.emailAddress ?? "",
      MobilePhoneNumber: m?.mobilePhoneNumber ?? "",
    };
    for (const name of CONTACT_FIELDS) {
      const input = this.control(name);
      if (!input) continue;
      input.value = values[name];
      input.readOnly = !!m && !!values[name];
      input.classList.toggle("cf-readonly", input.readOnly);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  /**
   * Prefill the contact/address inputs from the signed-in contact. Only fills
   * empty fields, so it never clobbers anything the user has already typed.
   */
  private prefillContact() {
    if (!this.contact) return;
    // With the picker (C26) the contact block follows the chosen member; the
    // address block still prefills from the signed-in household's address.
    const picker = this.householdMembers.length > 0;
    if (picker) this.applyCompleteAs();
    const map: Record<string, string | null | undefined> = {
      ...(picker
        ? {}
        : {
            FirstName: this.contact.firstName,
            LastName: this.contact.lastName,
            EmailAddress: this.contact.emailAddress,
            MobilePhoneNumber: this.contact.mobilePhoneNumber,
          }),
      AddressLine1: this.contact.addressLine1,
      AddressLine2: this.contact.addressLine2,
      City: this.contact.city,
      StateRegion: this.contact.stateRegion,
      PostalCode: this.contact.postalCode,
    };
    for (const [name, value] of Object.entries(map)) {
      if (!value) continue;
      const input = this.root.querySelector<HTMLInputElement>(`input[name="${name}"]`);
      if (input && !input.value) input.value = value;
    }
  }

  // ── Submit ──────────────────────────────────────────────────────────────

  private async submit() {
    const form = this.root.querySelector<HTMLFormElement>("#cf-form");
    if (!form || !this.header) return;
    if (!validateForm(form, { t: this.t }).valid) return;

    const fd = new FormData(form);
    const payload: Record<string, string> = {};
    for (const [k, v] of fd.entries()) {
      if (typeof v === "string") payload[k] = v;
    }
    payload.mp_customformformid = String(this.header.formId);

    this.setSubmitDisabled(true);
    try {
      const res = await this.fetch(`/api/embed/custom-form/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data: { success: boolean; message?: string } = await res
        .json()
        .catch(() => ({ success: false }));
      if (!data.success) {
        // The route's `message` is English and debug-only, so render the
        // translated sentence instead.
        const msg = this.errorText(data, "errors.submitFailed");
        this.error = msg;
        this.emit("formError", { error: msg });
        this.setSubmitDisabled(false);
        this.render();
        this.prefillContact();
        return;
      }
      this.submitted = true;
      // Say who the response was filed against: silent attribution is how
      // C26 went unnoticed.
      const member = this.selectedMember();
      this.submittedFor = member ? this.memberName(member) : null;
      this.emit("formSubmitted", {
        formId: this.header.formId,
        contactId: member?.contactId ?? null,
      });
      this.render();
    } catch (err) {
      const msg =
        this.caughtText(err, "errors.submitFailed");
      this.error = msg;
      this.emit("formError", { error: msg });
      this.setSubmitDisabled(false);
    }
  }

  private setSubmitDisabled(disabled: boolean) {
    const btn = this.root.querySelector<HTMLButtonElement>(".cf-submit");
    if (btn) btn.disabled = disabled;
  }

  // ── Listeners ─────────────────────────────────────────────────────────

  private attachListeners() {
    const retry = this.root.querySelector('[data-action="retry"]');
    if (retry) retry.addEventListener("click", () => this.retryLoad());

    const login = this.root.querySelector('[data-action="login"]');
    if (login) login.addEventListener("click", () => this.requestLogin("custom-form"));

    const submit = this.root.querySelector(".cf-submit");
    if (submit) {
      submit.addEventListener("click", (e) => {
        e.preventDefault();
        this.submit();
      });
    }

    const completeAs = this.root.querySelector<HTMLSelectElement>('#cf-form [name="ContactId"]');
    if (completeAs) {
      completeAs.addEventListener("change", () => {
        this.completeAs = completeAs.value;
        this.applyCompleteAs();
      });
    }

    const form = this.root.querySelector<HTMLFormElement>("#cf-form");
    if (form) {
      bindCustomFormDependsOn(form, this.fields);
      bindLiveValidation(form, { t: this.t });
      this.initGooglePlaces();
    }
  }

  /**
   * Wire Google Places autocomplete onto the address block. No-op unless the
   * form collects an address and the tenant has a Google Maps key configured.
   * Fills only Line 1/City/State/Postal — the fields the submit endpoint
   * persists (Form_Responses has no country column).
   */
  private async initGooglePlaces() {
    const key = this.header?.googleMapsApiKey;
    if (!this.header?.getAddressInfo || !key || key.trim() === "") return;

    const line1 = this.control("AddressLine1");
    if (!line1) return;

    let loaded = false;
    try {
      loaded = await loadGoogleMaps(key);
    } catch {
      loaded = false;
    }
    if (!loaded) return;
    // Form may have been torn down (re-render) while the script loaded.
    if (!line1.isConnected) return;

    attachAddressAutocomplete(line1, (addr) => {
      const setVal = (name: string, value: string) => {
        const el = this.control(name);
        if (el && value) {
          el.value = value;
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
      };
      setVal("AddressLine1", addr.line1);
      setVal("City", addr.city);
      setVal("StateRegion", addr.state);
      setVal("PostalCode", addr.postalCode);
    });
  }

  // ── Render ──────────────────────────────────────────────────────────────

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
    if (this.loading) {
      this.root.innerHTML = `<div class="cf">${this.stateRow(this.spinner(), this.t("customForm.loading"))}</div>`;
      return;
    }
    if (this.error && !this.header) {
      this.root.innerHTML = `
        <div class="cf">
          <div class="cf-state cf-error"><p>${this.escapeHtml(this.error)}</p>
            <button class="cf-btn" data-action="retry">${this.escapeHtml(this.t("common.retry"))}</button></div>
        </div>`;
      return;
    }

    const h = this.header!;
    if (h.isExpired) {
      this.root.innerHTML = `<div class="cf"><div class="cf-card"><p class="cf-expired">${this.escapeHtml(this.t("customForm.expired"))}</p></div></div>`;
      return;
    }
    if (this.submitted) {
      // `completeMessage` is MP-authored copy from the church's own form
      // definition, so it renders as written; only the fallback is translated.
      const msg = h.completeMessage || this.t("customForm.completed");
      const forWhom = this.submittedFor
        ? `<p class="cf-submitted-for">${this.escapeHtml(this.t("customForm.submittedFor", { name: this.submittedFor }))}</p>`
        : "";
      this.root.innerHTML = `<div class="cf"><div class="cf-card"><div class="cf-complete">${this.escapeHtml(msg)}</div>${forWhom}</div></div>`;
      return;
    }
    if (h.forceLogin && !this.isAuthenticated) {
      this.root.innerHTML = `
        <div class="cf"><div class="cf-card cf-login">
          <p>${this.escapeHtml(this.t("customForm.signInToComplete"))}</p>
          <button class="cf-btn cf-btn--primary" type="button" data-action="login">${this.escapeHtml(this.t("common.signIn"))}</button>
        </div></div>`;
      return;
    }

    const img = h.imageUrl
      ? `<div class="cf-image" style="background-image:url('${this.escapeAttr(h.imageUrl)}')"></div>`
      : "";
    const instructions = h.instructions
      ? `<div class="cf-instructions-block">${this.sanitize(h.instructions)}</div>`
      : "";
    const errorBanner = this.error
      ? `<div class="cf-message cf-message--danger">${this.escapeHtml(this.error)}</div>`
      : "";

    this.root.innerHTML = `
      <div class="cf">
        <div class="cf-card">
          ${img}
          ${h.title ? `<h1 class="cf-title">${this.escapeHtml(h.title)}</h1>` : ""}
          ${instructions}
          ${errorBanner}
          <form id="cf-form" class="cf-form" novalidate>
            ${this.renderCompleteAs()}
            ${h.getContactInfo ? this.renderContactBlock() : ""}
            ${h.getAddressInfo ? this.renderAddressBlock() : ""}
            ${renderCustomFormFields(this.fields, { formId: h.formId, t: this.t, idPrefix: this.instanceId })}
            <div class="cf-actions">
              <button class="cf-btn cf-btn--primary cf-submit" type="button">${this.escapeHtml(this.t("common.submit"))}</button>
            </div>
          </form>
        </div>
      </div>`;
  }

  /**
   * "Who is this form for?" (C26, legacy "Complete Form As"). Signed-in only,
   * signed-in user first, "Someone else (blank form)" last. The value posts as
   * `ContactId`; the submit route checks it against the caller's household and
   * files the response against that contact. Absent when anonymous (legacy
   * rendered an empty select there, which helped nobody).
   */
  private renderCompleteAs(): string {
    if (!this.householdMembers.length) return "";
    const options = this.householdMembers
      .map((m) => ({ value: String(m.contactId), label: this.memberName(m) || this.t("customForm.myInfo") }))
      .concat([{ value: "", label: this.t("customForm.someoneElse") }]);
    return this.cf({
      name: "ContactId",
      label: this.t("customForm.completeAs"),
      type: "select",
      value: this.completeAs,
      options: options.map((o) => ({ ...o, selected: o.value === this.completeAs })),
    });
  }

  private renderContactBlock(): string {
    return `
      <fieldset class="cf-fieldset">
        <legend>${this.escapeHtml(this.t("customForm.yourInformation"))}</legend>
        <div class="cf-grid2">
          ${this.cf({ name: "FirstName", label: this.t("fields.firstName"), required: true, autocomplete: "given-name" })}
          ${this.cf({ name: "LastName", label: this.t("fields.lastName"), required: true, autocomplete: "family-name" })}
        </div>
        <div class="cf-grid2">
          ${this.cf({ name: "EmailAddress", label: this.t("fields.email"), type: "email", required: true, autocomplete: "email" })}
          ${this.cf({ name: "MobilePhoneNumber", label: this.t("fields.mobilePhone"), type: "tel" })}
        </div>
      </fieldset>`;
  }

  /**
   * The address block. `autocomplete="off"` stays on these inputs because
   * Google Places draws its own suggestion list over line 1, and a browser
   * autofill dropdown would sit on top of it.
   */
  private renderAddressBlock(): string {
    const off = "off";
    return `
      <fieldset class="cf-fieldset">
        <legend>${this.escapeHtml(this.t("fields.address"))}</legend>
        ${this.cf({ name: "AddressLine1", label: this.t("fields.addressLine1"), required: true, autocomplete: off })}
        ${this.cf({ name: "AddressLine2", label: this.t("fields.addressLine2"), autocomplete: off })}
        <div class="cf-grid3">
          ${this.cf({ name: "City", label: this.t("fields.city"), required: true, autocomplete: off })}
          ${this.cf({ name: "StateRegion", label: this.t("fields.stateRegion"), required: true, autocomplete: off })}
          ${this.cf({ name: "PostalCode", label: this.t("fields.postalCode"), required: true, autocomplete: off })}
        </div>
      </fieldset>`;
  }

  /** `field()` with this widget's id prefix and classes (C28). */
  private cf(opts: FieldOptions): string {
    return field({ idPrefix: this.instanceId, wrapperClass: "cf-field", inputClass: "cf-input", ...opts });
  }

  /** A control in this widget's own blocks, by `name`. */
  private control(name: string): HTMLInputElement | null {
    return this.root.querySelector<HTMLInputElement>(`#cf-form [name="${name}"]`);
  }

  private stateRow(icon: string, text: string): string {
    return `<div class="cf-state">${icon}<span>${this.escapeHtml(text)}</span></div>`;
  }

  private spinner(): string {
    return `<svg class="cf-spinner" viewBox="0 0 24 24" fill="none" width="20" height="20">
      <circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
      <path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
    </svg>`;
  }

  private escapeHtml(text: string): string {
    const el = document.createElement("span");
    el.textContent = text ?? "";
    return el.innerHTML;
  }

  private escapeAttr(text: string): string {
    return this.escapeHtml(text).replace(/"/g, "&quot;");
  }

  private sanitize(html: string): string {
    const t = document.createElement("template");
    t.innerHTML = html;
    t.content.querySelectorAll("script,style,iframe,object,embed").forEach((n) => n.remove());
    t.content.querySelectorAll("*").forEach((el) => {
      for (const attr of Array.from(el.attributes)) {
        if (attr.name.toLowerCase().startsWith("on")) el.removeAttribute(attr.name);
      }
    });
    return t.innerHTML;
  }

  private getStyles(): string {
    return `
      :host { all: initial; display: block; font-family: var(--_nw-font-family); color: var(--_nw-color-text); }
      .cf { max-width: 720px; margin: 0 auto; }
      .cf-card { background: var(--_nw-color-surface); border: var(--_nw-border-width) solid var(--_nw-color-border); border-radius: var(--_nw-radius-lg); padding: var(--_nw-space-6); box-shadow: var(--_nw-shadow); }
      .cf-image { width: 100%; height: 200px; background-size: cover; background-position: center; border-radius: var(--_nw-radius-lg); margin-bottom: var(--_nw-space-4); }
      .cf-title { font-size: 24px; font-weight: 800; color: var(--_nw-color-secondary); margin: 0 0 var(--_nw-space-3); }
      .cf-instructions-block { font-size: 15px; line-height: 1.6; color: var(--_nw-color-text-subtle); margin-bottom: var(--_nw-space-4); }
      .cf-form { display: block; }
      .cf-fieldset { border: var(--_nw-border-width) solid var(--_nw-color-border); border-radius: var(--_nw-radius); padding: var(--_nw-space-3) var(--_nw-space-4) var(--_nw-space-1); margin: 0 0 var(--_nw-space-4); }
      .cf-fieldset legend { font-size: 13px; font-weight: var(--_nw-font-weight-heading); color: var(--_nw-color-secondary); padding: 0 6px; }
      .cf-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: var(--_nw-space-3); }
      .cf-grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: var(--_nw-space-3); }
      .cf-actions { margin-top: var(--_nw-space-4); }
      .cf-btn { padding: 10px var(--_nw-space-5); border-radius: var(--_nw-radius); font-size: var(--_nw-font-size-base); font-weight: 600; cursor: pointer; font-family: inherit; border: none; }
      .cf-btn--primary { background: var(--_nw-button-bg); color: var(--_nw-button-fg); border-radius: var(--_nw-button-radius); }
      .cf-btn--primary:hover { background: var(--_nw-button-bg-hover); }
      .cf-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .cf-message { padding: var(--_nw-space-3) var(--_nw-space-4); border-radius: var(--_nw-radius); font-size: var(--_nw-font-size-base); margin-bottom: var(--_nw-space-4); }
      .cf-message--danger { background: #ffe9e9; color: var(--_nw-color-error-text); }
      .cf-complete { font-size: 16px; line-height: 1.6; color: #2D6B1F; }
      .cf-submitted-for { font-size: var(--_nw-font-size-base); color: var(--_nw-color-text-subtle); margin: var(--_nw-space-2) 0 0; }
      .cf-input.cf-readonly { background: var(--_nw-color-surface-muted); color: var(--_nw-color-muted); }
      .cf-expired { color: #8a6d3b; font-size: 15px; margin: 0; }
      .cf-login { text-align: center; }
      .cf-login p { margin: 0 0 var(--_nw-space-3); }
      .cf-state { display: flex; align-items: center; justify-content: center; gap: var(--_nw-space-3); padding: 48px var(--_nw-space-4); color: var(--_nw-color-muted); flex-direction: column; }
      .cf-error p { color: var(--_nw-color-error-text); }
      .cf-spinner { animation: cf-spin 1s linear infinite; color: var(--_nw-color-primary); }
      @keyframes cf-spin { to { transform: rotate(360deg); } }
      @media (max-width: 640px) { .cf-grid2, .cf-grid3 { grid-template-columns: 1fr; } }
    `;
  }
}

customElements.define("next-custom-form", CustomFormWidget);
